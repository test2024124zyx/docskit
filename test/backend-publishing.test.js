"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { Writable } = require("node:stream");
const { handleRequest, mergeConfig, renderPage } = require("../server");
const { scanDocuments, scanFilesystemSignature, createDocumentIndexStore } = require("../server-index");
const { renderLlms, exportMarkdown } = require("../server-exports");
const { seoValues, imageSource, renderRobots, renderSitemap } = require("../server-seo");

async function fixture(callback) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-publishing-"));
  try { await callback(root); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
}

async function request(pathname, options, headers = {}) {
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.writeHead = (status, values) => { response.statusCode = status; response.headers = values; };
  await handleRequest({ url: pathname, method: "GET", headers: { host: "untrusted.example", ...headers } }, response, options);
  response.body = Buffer.concat(chunks).toString();
  return response;
}

test("真实扫描包含代码检索、隐藏过滤与统一字节预算，超限保留可诊断错误", async () => {
  await fixture(async (root) => {
    await fs.mkdir(path.join(root, "guide"));
    await fs.writeFile(path.join(root, "README.md"), "# 首页\n\n```sh\ncurl /v1/payments\n```");
    await fs.writeFile(path.join(root, "guide", "hidden.md"), "---\nhidden: true\n---\n秘密内容");
    await fs.writeFile(path.join(root, "spec.yaml"), "openapi: 3.1.0");
    await fs.writeFile(path.join(root, ".private.md"), "私人内容");
    const first = await scanDocuments(root);
    assert.deepEqual(first.documents.map((item) => item.path), ["README.md"]);
    assert.match(first.documents[0].searchText, /\/v1\/payments/);
    assert.equal(first.documents[0].raw, undefined);
    assert.ok(first.contentBytes > Buffer.byteLength(first.documents[0].body));
    assert.equal(first.filesystemSignature, await scanFilesystemSignature(root));
    await assert.rejects(() => scanDocuments(root, { maxBytes: 10 }), /字节预算/);
    await assert.rejects(() => scanDocuments(root, { maxBytes: Buffer.byteLength(first.documents[0].body) + 1 }), /字节预算/);
    const previousSignature = first.filesystemSignature;
    await fs.writeFile(path.join(root, "spec.yaml"), "openapi: 3.1.0\ninfo: changed");
    assert.notEqual(await scanFilesystemSignature(root), previousSignature);
    await assert.rejects(() => scanDocuments(path.join(root, "missing")), { code: "ENOENT" });
  });
});

test("元数据轮询也能恢复索引，失败退避与监听事件不会丢失更新", async () => {
  let tick = 0;
  let scanCount = 0;
  let filesystemVersion = "a";
  let signatureError = false;
  const handlers = [];
  const store = createDocumentIndexStore({
    now: () => tick, pollIntervalMs: 10, retryDelayMs: 20,
    watch: (directory, settings, changed) => {
      const watcher = { close() {}, on(event, callback) { handlers.push({ changed, failed: callback }); } };
      return watcher;
    },
    signature: async () => { if (signatureError) throw new Error("读取失败"); return filesystemVersion; },
    scan: async (directory, settings) => {
      scanCount++;
      assert.ok(settings.maxBytes > 0);
      return { documents: [{ path: `${filesystemVersion}.md` }], directories: new Set([directory]), directoryMetadata: new Map(), filesystemSignature: filesystemVersion };
    }
  });
  await store.getDocumentIndex("/docs");
  await store.getDocumentIndex("/docs");
  tick = 11;
  await store.getDocumentIndex("/docs");
  assert.equal(scanCount, 1);
  filesystemVersion = "b";
  tick = 22;
  assert.equal((await store.getDocumentIndex("/docs")).documents[0].path, "b.md");
  signatureError = true;
  tick = 33;
  assert.equal((await store.getDocumentIndex("/docs")).health.status, "degraded");
  signatureError = false;
  filesystemVersion = "c";
  handlers[0].failed();
  tick = 60;
  assert.equal((await store.getDocumentIndex("/docs")).documents[0].path, "c.md");
  handlers.at(-1).changed();
  await store.getDocumentIndex("/docs", { maxBytes: 2048 });
  assert.equal(store.states.get(path.resolve("/docs")).maxBytes, 2048);
  store.closeDocumentIndexWatchers();
});

test("文件监听不可用时仍定期更新，多个文档根只保留有限监听与索引", async () => {
  let tick = 0;
  const store = createDocumentIndexStore({
    now: () => tick, pollIntervalMs: 10,
    watch: () => { throw new Error("不支持监听"); },
    signature: async () => String(tick),
    scan: async (root) => ({ documents: [{ path: `${tick}.md` }], directories: new Set([root]), directoryMetadata: new Map(), filesystemSignature: String(tick) })
  });
  await store.getDocumentIndex("/docs");
  tick = 20;
  assert.equal((await store.getDocumentIndex("/docs")).documents[0].path, "20.md");
  for (let index = 0; index < 6; index++) await store.getDocumentIndex(`/root-${index}`);
  assert.ok(store.states.size <= 4);
  store.closeDocumentIndexWatchers();
});

test("动态页面、canonical、OG、robots 和 sitemap 使用同一可信地址", async () => {
  const config = mergeConfig({ site: { url: "https://docs.example.org/", title: "接口文档" } });
  const document = { path: "guide/a.md", title: "付款", description: "说明", body: "# 付款", updatedAt: "2026-01-01T00:00:00.000Z" };
  const options = { loadConfig: async () => ({ config, docsDir: path.resolve("docs") }), getDocumentIndex: async () => ({ documents: [document] }) };
  const page = await request("/?doc=guide%2Fa.md", options);
  assert.match(page.body, /rel="canonical" href="https:\/\/docs\.example\.org\/\?doc=guide%2Fa.md"/);
  assert.match(page.body, /property="og:url" content="https:\/\/docs\.example\.org\/\?doc=guide%2Fa.md"/);
  assert.doesNotMatch(page.body, /untrusted\.example/);
  const robots = await request("/robots.txt", options);
  assert.match(robots.body, /Sitemap: https:\/\/docs\.example\.org\/sitemap.xml/);
  const sitemap = await request("/sitemap.xml", options);
  assert.match(sitemap.body, /https:\/\/docs\.example\.org\/\?doc=guide%2Fa.md/);
  const staticHtml = renderPage('<title></title><link rel="canonical" href="" />', config, null, "https://docs.example.org/guide/a.html", { staticData: {} });
  assert.match(staticHtml, /href="https:\/\/docs\.example\.org\/guide\/a.html"/);
  assert.match(renderRobots({ site: { seo: { robots: "noindex" } } }, ""), /Disallow: \//);
  assert.match(renderSitemap([{ ...document, updatedAt: "invalid" }], ""), /<loc>\/\?doc=guide%2Fa.md<\/loc>/);
  assert.equal(seoValues({ site: { seo: { canonical: "https://legacy.example/" } } }, null, "/").canonical, "https://legacy.example/");
  assert.equal(imageSource({ src: "logo.png" }), "/api/asset?path=logo.png");
  assert.equal(imageSource("logo.png", { assetUrl: (value) => `/assets/${value}` }), "/assets/logo.png");
  assert.equal(imageSource("https://example.org/logo.png"), "https://example.org/logo.png");
  const accessibleTemplate = '<article class="doc-article" id="doc-content" tabindex="-1" aria-live="polite">loading</article>';
  const prerendered = renderPage(accessibleTemplate, config, { ...document, html: "<p>预渲染正文</p>", headings: [] }, "/");
  assert.match(prerendered, /tabindex="-1"/);
  assert.match(prerendered, /预渲染正文/);
  assert.doesNotMatch(prerendered, /loading/);
});

test("原文和 AI 导出只访问公开索引，支持条件请求且暴露索引降级状态", async () => {
  const config = mergeConfig({ home: "README.md", site: { url: "https://docs.example.org/", title: "开发文档" } });
  const document = { path: "README.md", title: "开始", body: "# 开始\n\n公开内容", description: "上手", updatedAt: "2026-01-01T00:00:00.000Z" };
  const options = { loadConfig: async () => ({ config, docsDir: path.resolve("docs"), configStatus: { status: "degraded", error: "配置更新失败" } }), getDocumentIndex: async () => ({ documents: [document], health: { status: "degraded", error: { code: 422, message: "索引更新失败" } } }) };
  const markdown = await request("/api/markdown?path=README.md", options);
  assert.equal(markdown.statusCode, 200);
  assert.match(markdown.headers["Content-Type"], /text\/markdown/);
  assert.equal(markdown.body, document.body);
  const unchanged = await request("/api/markdown?path=README.md", options, { "if-none-match": markdown.headers.ETag });
  assert.equal(unchanged.statusCode, 304);
  assert.equal((await request("/api/markdown?path=hidden.md", options)).statusCode, 404);
  assert.equal((await request("/api/markdown?path=..%2Foutside.md", options)).statusCode, 400);
  const llms = await request("/llms.txt", options);
  assert.match(llms.body, /https:\/\/docs\.example\.org\/api\/markdown\?path=README.md/);
  assert.match((await request("/llms-full.txt", options)).body, /公开内容/);
  assert.doesNotMatch(renderLlms([{ path: "hidden.md", hidden: true, body: "秘密" }], config, { full: true }), /秘密/);
  const bootstrap = JSON.parse((await request("/api/bootstrap", options)).body);
  assert.equal(bootstrap.health.index.status, "degraded");
  assert.equal(bootstrap.health.configuration.status, "degraded");
  assert.equal((await request("/readyz", options)).statusCode, 503);
  const publicDocument = JSON.parse((await request("/api/document?path=README.md", options)).body);
  assert.equal(publicDocument.markdown, document.body);
  assert.equal(publicDocument.markdownUrl, "/api/markdown?path=README.md");
});

test("OpenAPI 真实扫描、搜索、公开响应和权限更新采用同一个有效版本", async () => {
  await fixture(async (root) => {
    const config = mergeConfig({});
    const specPath = path.join(root, "public.json");
    const spec = {
      openapi: "3.0.3", info: { title: "订单接口", version: "1.0.0" },
      servers: [{ url: "https://api.example.org" }],
      paths: { "/v1/orders": { get: { summary: "查订单", responses: { 200: { description: "查询成功" } } } } }
    };
    await fs.writeFile(path.join(root, "api.md"), "---\nopenapi: public.json\n---\n# 接口参考");
    await fs.writeFile(specPath, JSON.stringify(spec));
    let now = 0;
    const store = createDocumentIndexStore({ now: () => now, retryDelayMs: 10, watch: () => ({ on() {}, close() {} }) });
    const options = { loadConfig: async () => ({ config, docsDir: root }), getDocumentIndex: store.getDocumentIndex };
    try {
      const index = await store.getDocumentIndex(root);
      assert.deepEqual(index.connectSources, ["https://api.example.org"]);
      const data = JSON.parse((await request("/api/document?path=api.md", options)).body);
      assert.equal(data.apiReference.spec.info.title, "订单接口");
      assert.deepEqual(data.apiReference.connectSources, ["https://api.example.org"]);
      assert.ok(data.apiReference.spec.paths["/v1/orders"]);
      const markdown = (await request("/api/markdown?path=api.md", options)).body;
      assert.equal(data.markdown, markdown);
      assert.match(markdown, /## OpenAPI 合同/);
      assert.match(markdown, /"\/v1\/orders"/);
      assert.doesNotMatch(markdown, /"(?:dependencies|connectSources|sourcePath)"/);
      assert.ok((await request("/llms-full.txt", options)).body.includes(markdown.trimEnd()));
      const search = JSON.parse((await request("/api/search?q=%2Fv1%2Forders", options)).body);
      assert.equal(search.results[0].path, "api.md");
      spec.servers = [{ url: "javascript:alert(1)" }];
      await fs.writeFile(specPath, JSON.stringify(spec));
      store.markDocumentIndexDirty(store.states.get(path.resolve(root)));
      const degraded = await store.getDocumentIndex(root);
      assert.equal(degraded.health.status, "degraded");
      assert.equal(degraded.documents, index.documents);
      assert.deepEqual(degraded.connectSources, index.connectSources);
      spec.servers = [{ url: "https://next.example.org" }];
      await fs.writeFile(specPath, JSON.stringify(spec));
      now += 11;
      const recovered = await store.getDocumentIndex(root);
      assert.equal(recovered.health.status, "ready");
      assert.deepEqual(recovered.connectSources, ["https://next.example.org"]);
      const refreshed = JSON.parse((await request("/api/document?path=api.md", options)).body);
      assert.equal(refreshed.apiReference.spec.servers[0].url, "https://next.example.org");
      assert.deepEqual(refreshed.apiReference.connectSources, ["https://next.example.org"]);
    } finally { store.closeDocumentIndexWatchers(); }
  });
});

test("AI 导出保留静态部署链接、转义标题并处理空站点", () => {
  const documents = [{ path: "guide/a.md", title: "入门 [中文]\n换行", description: "第一行\n第二行", body: "正文" }];
  const options = { documentUrl: () => "/manual/guide/a.html", markdownUrl: () => "/manual/markdown/guide/a.md" };
  const list = renderLlms(documents, {}, options);
  assert.match(list, /\(\/manual\/markdown\/guide\/a\.md\): 第一行 第二行/);
  assert.ok(list.includes("入门 \\[中文\\] 换行"));
  assert.doesNotMatch(list, /api\/markdown/);
  assert.match(renderLlms(documents, {}, { ...options, full: true }), /来源：\/manual\/guide\/a\.html\n\n正文/);
  assert.equal(renderLlms([], {}), "# 文档\n\n## 文档\n");
  assert.match(renderLlms([{ path: "a.md" }], {}, { full: true }), /来源：\/\?doc=a.md/);
});

test("完整 API Markdown 导出保留契约语义、防止围栏截断且不输出内部元数据", () => {
  const body = "# 示例\r\n\r\n正文保留。\r\n";
  assert.equal(exportMarkdown({ body }), body);
  assert.equal(exportMarkdown({}), "");
  const spec = { openapi: "3.1.0", info: { title: "示例", version: "1", description: "代码示例\n``````\n# 仍是契约内容" }, paths: {} };
  const document = {
    body, apiReference: { spec, dependencies: [{ path: "内部依赖路径" }], sourcePath: "内部来源路径", connectSources: ["https://private.example.org"] }
  };
  const markdown = exportMarkdown(document);
  assert.ok(markdown.startsWith(body));
  const opening = markdown.match(/^(`{3,})json\n/m);
  assert.ok(opening);
  assert.ok(opening[1].length > 6);
  assert.ok(markdown.endsWith(`\n${opening[1]}\n`));
  const json = markdown.slice(opening.index + opening[0].length, -(opening[1].length + 2));
  assert.deepEqual(JSON.parse(json), spec);
  assert.doesNotMatch(markdown, /内部依赖路径|内部来源路径|private\.example/);
  const ordinarySpec = exportMarkdown({ apiReference: { spec: { openapi: "3.0.3", paths: {} } } });
  assert.match(ordinarySpec, /^## OpenAPI 合同\n\n```json\n/);
});

test("找不到指定文档的服务端首屏返回 404，并区别于空站点", async () => {
  const config = mergeConfig({});
  const options = { loadConfig: async () => ({ config, docsDir: path.resolve("docs") }), getDocumentIndex: async () => ({ documents: [] }) };
  const missing = await request("/?doc=missing.md", options);
  assert.equal(missing.statusCode, 404);
  assert.match(missing.body, /文档不存在/);
  assert.doesNotMatch(missing.body, /还没有 Markdown 文档/);
  const empty = await request("/", options);
  assert.equal(empty.statusCode, 200);
  assert.match(empty.body, /还没有 Markdown 文档/);
});
