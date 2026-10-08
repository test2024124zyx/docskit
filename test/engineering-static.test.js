"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildStaticSite } = require("../static-build");
const { MAX_ASSET_BYTES } = require("../server-config");

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-engineering-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const docsDir = path.join(root, "docs");
  await fs.mkdir(docsDir);
  await fs.writeFile(path.join(docsDir, "README.md"), "---\ntitle: 工程首页\n---\n# 首页\n\n可公开的内容。\n");
  return { root, docsDir, outDir: path.join(root, "nested", "site"), config: {} };
}

test("静态构建创建缺失父目录并只替换已登记的旧产物", async (t) => {
  const options = await fixture(t);
  await buildStaticSite(options);
  const first = JSON.parse(await fs.readFile(path.join(options.outDir, ".docskit-build.json"), "utf8"));
  assert.equal(first.generator, "docskit");
  await fs.writeFile(path.join(options.docsDir, "README.md"), "# 更新后的首页\n\n新版内容。\n");
  await buildStaticSite(options);
  assert.match(await fs.readFile(path.join(options.outDir, "index.html"), "utf8"), /更新后的首页/);
  assert.deepEqual((await fs.readdir(path.dirname(options.outDir))).filter((name) => name.startsWith(".docskit-")), []);
});

test("输出目录含有非构建文件时拒绝覆盖并保留文件", async (t) => {
  const options = await fixture(t);
  await fs.mkdir(options.outDir, { recursive: true });
  const unrelated = path.join(options.outDir, "important.txt");
  await fs.writeFile(unrelated, "用户数据");
  await assert.rejects(buildStaticSite(options), /不是 DocsKit|非构建|无法确认/);
  assert.equal(await fs.readFile(unrelated, "utf8"), "用户数据");
});

test("切换新产物失败后恢复上一版并清理构建临时目录", async (t) => {
  const options = await fixture(t);
  await buildStaticSite(options);
  const previous = await fs.readFile(path.join(options.outDir, "index.html"), "utf8");
  await fs.writeFile(path.join(options.docsDir, "README.md"), "# 不应发布的新内容\n");
  const rename = fs.rename.bind(fs);
  t.mock.method(fs, "rename", async (source, target) => {
    if (path.basename(source).startsWith(".docskit-build-") && target === options.outDir) {
      throw Object.assign(new Error("模拟切换失败"), { code: "EACCES" });
    }
    return rename(source, target);
  });
  await assert.rejects(buildStaticSite(options), /模拟切换失败/);
  assert.equal(await fs.readFile(path.join(options.outDir, "index.html"), "utf8"), previous);
  assert.deepEqual((await fs.readdir(path.dirname(options.outDir))).filter((name) => name.startsWith(".docskit-")), []);
});

test("静态资源超过动态服务限制时构建失败且保留旧产物", async (t) => {
  const options = await fixture(t);
  await buildStaticSite(options);
  const previous = await fs.readFile(path.join(options.outDir, "index.html"), "utf8");
  const largeImage = await fs.open(path.join(options.docsDir, "large.png"), "w");
  await largeImage.truncate(MAX_ASSET_BYTES + 1);
  await largeImage.close();
  await assert.rejects(buildStaticSite(options), /资源过大.*large\.png/);
  assert.equal(await fs.readFile(path.join(options.outDir, "index.html"), "utf8"), previous);
});

test("公开 Markdown 和模型索引排除隐藏文档及 front matter，支持部署基路径", async (t) => {
  const options = await fixture(t);
  await fs.writeFile(path.join(options.docsDir, "hidden.md"), "---\nhidden: true\n---\n# 隐藏标题\n内部内容\n");
  await buildStaticSite({ ...options, base: "/reference/", siteUrl: "https://docs.example.org" });
  const markdown = await fs.readFile(path.join(options.outDir, "markdown", "README.md"), "utf8");
  assert.match(markdown, /^# 首页/);
  assert.doesNotMatch(markdown, /title:|---/);
  await assert.rejects(fs.access(path.join(options.outDir, "markdown", "hidden.md")));
  const llms = await fs.readFile(path.join(options.outDir, "llms.txt"), "utf8");
  assert.match(llms, /https:\/\/docs\.example\.org\/reference\/markdown\/README\.md/);
  const full = await fs.readFile(path.join(options.outDir, "llms-full.txt"), "utf8");
  assert.match(full, /可公开的内容/);
  assert.doesNotMatch(llms + full, /隐藏标题|内部内容|hidden:/);
  const bootstrap = JSON.parse(await fs.readFile(path.join(options.outDir, "bootstrap.json"), "utf8"));
  assert.equal(bootstrap.staticBuild.markdownUrls["README.md"], "/reference/markdown/README.md");
});

test("静态 API 页面使用本地资源、完整合同、相同搜索字段和受限跨域策略", async (t) => {
  const options = await fixture(t);
  const spec = { openapi: "3.1.0", info: { title: "静态查询 API", version: "1" }, servers: [{ url: "https://api.example.org/v1" }], paths: { "/items": { get: { responses: { "200": { description: "成功" } } } } } };
  await fs.writeFile(path.join(options.docsDir, "api.json"), JSON.stringify(spec));
  await fs.writeFile(path.join(options.docsDir, "api.md"), "---\nopenapi: api.json\n---\n# API 文档\n\n## 请求示例\n\n```bash\ncurl /items\n```\n");
  await fs.writeFile(path.join(options.docsDir, "private.json"), JSON.stringify({ ...spec, info: { title: "不可公开的私有合同", version: "1" } }));
  await fs.writeFile(path.join(options.docsDir, "private.md"), "---\nhidden: true\nopenapi: private.json\n---\n# 不可公开的说明\n");
  await buildStaticSite({ ...options, config: { site: { url: "https://docs.example.org/reference/" } } });
  for (const asset of ["search-core.js", "client-api.js", "vendor/scalar.js"]) await fs.access(path.join(options.outDir, asset));
  const html = await fs.readFile(path.join(options.outDir, "api.html"), "utf8");
  assert.match(html, /src="\/reference\/search-core\.js"/);
  assert.match(html, /src="\/reference\/client-api\.js"/);
  assert.match(html, /https:\/\/docs\.example\.org\/reference\/api\.html/);
  const data = JSON.parse(await fs.readFile(path.join(options.outDir, "data", "documents", "api.md.json"), "utf8"));
  assert.deepEqual(data.apiReference.spec, spec);
  assert.deepEqual(data.apiReference.connectSources, ["https://api.example.org"]);
  const markdown = await fs.readFile(path.join(options.outDir, "markdown", "api.md"), "utf8");
  assert.equal(markdown, data.markdown);
  assert.match(markdown, /## OpenAPI 合同/);
  assert.match(markdown, /"openapi": "3\.1\.0"/);
  assert.match(markdown, /"\/items"/);
  const full = await fs.readFile(path.join(options.outDir, "llms-full.txt"), "utf8");
  assert.ok(full.includes(markdown));
  assert.doesNotMatch(full, /不可公开的私有合同|不可公开的说明|"dependencies"|"sourcePath"|"connectSources"/);
  await assert.rejects(fs.access(path.join(options.outDir, "markdown", "private.md")));
  const search = JSON.parse(await fs.readFile(path.join(options.outDir, "search-index.json"), "utf8"));
  assert.ok(search.documents.find((document) => document.path === "api.md").sections.some((section) => section.code.includes("curl /items")));
  const headers = await fs.readFile(path.join(options.outDir, "_headers"), "utf8");
  assert.match(headers, /connect-src 'self' https:\/\/api\.example\.org/);
  assert.match(headers, /\/reference\/assets\/\*\.svg/);
  for (const resource of ["client-api.js", "script.js", "styles.css", "search-core.js", "vendor/scalar.js", "vendor/katex/katex.min.css"]) {
    assert.ok(headers.includes(`/reference/${resource}\n  Cache-Control: no-cache, must-revalidate\n`));
  }
  assert.doesNotMatch(headers, /no-store|fonts\/.*Cache-Control/);
  assert.doesNotMatch(headers, /connect-src 'self' https:;/);
  assert.match(await fs.readFile(path.join(options.outDir, "robots.txt"), "utf8"), /https:\/\/docs\.example\.org\/reference\/sitemap\.xml/);
});
