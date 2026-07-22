const assert = require("node:assert/strict");
const fsp = require("node:fs").promises;
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_CONFIG,
  parseArgs,
  mergeConfig,
  resolveFromRoot,
  pathSetting,
  configFileSignature,
  readConfigFile,
  normalizeRelative,
  safeResolve,
  toPosix,
  splitFrontMatter,
  stripMarkdown,
  humanizeName,
  firstHeading,
  firstParagraph,
  compareNames,
  stableHash,
  iconValue,
  selectStableIcon,
  creationTime,
  findConfiguredIcon,
  strategyIconColors,
  resolveIcon,
  scanDocuments,
  sortNodes,
  createTree,
  renderInline,
  renderMarkdown,
  publicDocument,
  makeSearchSnippet,
  makeSearchResults,
  createServer
} = require("../server");

const PROJECT_DIR = path.resolve(__dirname, "..");

async function withTempDir(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "docskit-unit-"));
  try {
    return await callback(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function withHttpServer(options, callback) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    return await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function request(baseUrl, pathname, options) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch (error) { /* 保留文本响应 */ }
  return { response, body };
}

test("配置、参数、路径和 Markdown 辅助函数处理边界值", async () => {
  assert.deepEqual(parseArgs(["--docs", "docs-a", "--config", "config.json", "--port", "3100"]), { docsDir: "docs-a", configPath: "config.json", port: "3100" });
  assert.deepEqual(parseArgs([]), {});

  const config = mergeConfig({
    docsDir: "custom-docs",
    site: { brand: { name: "知识", accent: "库" }, footer: { links: "invalid" } },
    topbar: { search: false },
    sidebar: { sort: "title", iconStrategy: "modern", expandMode: "accordion", indent: 100, iconPalette: [" #fff ", "", 42] }
  });
  assert.equal(config.docsDir, "custom-docs");
  assert.deepEqual(config.site.brand, { name: "知识", accent: "库" });
  assert.deepEqual(config.site.footer.links, []);
  assert.equal(config.sidebar.sort, "locale");
  assert.equal(config.sidebar.iconStrategy, "modern");
  assert.equal(config.sidebar.expandMode, "accordion");
  assert.equal(config.sidebar.indent, 48);
  assert.deepEqual(config.sidebar.iconPalette, ["#fff"]);
  assert.equal(mergeConfig(null).sidebar.sort, DEFAULT_CONFIG.sidebar.sort);

  assert.equal(resolveFromRoot(), PROJECT_DIR);
  assert.equal(resolveFromRoot("docs"), path.join(PROJECT_DIR, "docs"));
  assert.equal(resolveFromRoot(path.join(PROJECT_DIR, "docs")), path.join(PROJECT_DIR, "docs"));
  assert.equal(pathSetting(" docs ", "fallback"), " docs ");
  assert.equal(pathSetting("", "fallback"), "fallback");
  assert.equal(pathSetting(null, "fallback"), "fallback");
  assert.equal(configFileSignature({ dev: 1, ino: 2, size: 3, mtimeMs: 4, ctimeMs: 5 }), "1:2:3:4:5");

  const normalized = normalizeRelative("\\guide\\intro.md");
  assert.equal(normalized, "guide/intro.md");
  assert.equal(toPosix(path.join("guide", "intro.md")), "guide/intro.md");
  assert.equal(safeResolve(PROJECT_DIR, "docs/README.md"), path.join(PROJECT_DIR, "docs", "README.md"));
  assert.throws(() => safeResolve(PROJECT_DIR, ""), /无效路径/);
  assert.throws(() => safeResolve(PROJECT_DIR, "\0"), /无效路径/);
  assert.throws(() => safeResolve(PROJECT_DIR, "../outside"), /路径超出文档目录/);

  const front = splitFrontMatter("\uFEFF---\ntitle: \"标题\"\norder: 2\nhidden: true\n---\n# 正文");
  assert.deepEqual(front.attributes, { title: "标题", order: 2, hidden: true });
  assert.equal(front.body, "# 正文");
  assert.deepEqual(splitFrontMatter("---\ntitle: 未闭合"), { attributes: {}, body: "---\ntitle: 未闭合" });
  assert.deepEqual(splitFrontMatter("# 无配置"), { attributes: {}, body: "# 无配置" });
  assert.equal(stripMarkdown("# 标题\n[链接](a.md) **加粗** `代码` ![图](a.png)"), "标题 链接 加粗 代码 图");
  assert.equal(humanizeName("001-getting_started.md"), "Getting started");
  assert.equal(humanizeName("README.md"), "首页");
  assert.equal(firstHeading("前言\n## 章节 ##"), "章节");
  assert.equal(firstHeading("没有标题"), "");
  assert.equal(firstParagraph("\n# 标题\n```js\n代码\n```\n正文说明"), "代码 正文说明");
  assert.equal(compareNames("文档2", "文档10") < 0, true);
  assert.equal(stableHash("same"), stableHash("same"));
  assert.notEqual(stableHash("same"), stableHash("other"));
  assert.equal(iconValue("  rocket "), "rocket");
  assert.equal(iconValue(""), "");
  assert.equal(selectStableIcon(["a", "b"], "guide", "directory", "test"), selectStableIcon(["a", "b"], "guide", "directory", "test"));
  assert.equal(creationTime({ birthtimeMs: 0, ctimeMs: 20, mtimeMs: 10 }).createdAtMs, 20);
  assert.equal(creationTime({}).createdAtMs, Number.MAX_SAFE_INTEGER);

  await withTempDir(async (root) => {
    const configPath = path.join(root, "docs.config.json");
    assert.deepEqual(await readConfigFile(configPath), {});
    await fsp.writeFile(configPath, "{ invalid", "utf8");
    assert.deepEqual(await readConfigFile(configPath), {});
    await fsp.writeFile(configPath, JSON.stringify({ site: { title: "测试" } }), "utf8");
    assert.deepEqual(await readConfigFile(configPath), { site: { title: "测试" } });
    assert.deepEqual(await readConfigFile(configPath), { site: { title: "测试" } });
  });
});

test("图标策略、排序树和文档索引扫描覆盖配置优先级", async () => {
  const settings = {
    icons: { "guide/intro.md": "generic-file", guide: "generic-folder" },
    fileIcons: { "guide/intro.md": "specific-file" },
    folderIcons: { guide: "specific-folder" }
  };
  assert.equal(findConfiguredIcon(settings, "guide/intro.md", "file", "front-file"), "specific-file");
  assert.equal(findConfiguredIcon(settings, "guide/other.md", "file", "front-file"), "front-file");
  assert.equal(findConfiguredIcon(settings, "guide", "directory", ""), "specific-folder");
  assert.equal(findConfiguredIcon({}, "guide", "directory", ""), "");

  assert.deepEqual(strategyIconColors({ iconColor: "#111" }, "guide", "directory", 0, "modern"), ["#111"]);
  assert.deepEqual(strategyIconColors({}, "guide/child", "directory", 1, "modern"), []);
  assert.deepEqual(strategyIconColors({}, "guide", "directory", 0, "default"), []);
  assert.deepEqual(strategyIconColors({ iconPalette: ["#111"] }, "guide", "directory", 0, "modern"), ["#111"]);

  const defaultSidebar = mergeConfig({}).sidebar;
  assert.equal(resolveIcon(defaultSidebar, "guide", "directory", "", 0).name, "folder");
  assert.equal(resolveIcon(defaultSidebar, "guide/intro.md", "file", "", 1).name, "file-markdown");
  assert.equal(resolveIcon({ ...defaultSidebar, defaultFileIcon: "book-open" }, "guide/intro.md", "file", "", 1).name, "book-open");
  assert.equal(resolveIcon({ ...defaultSidebar, icons: { "guide/intro.md": "rocket" } }, "guide/intro.md", "file", "front-file", 1).name, "rocket");
  assert.equal(resolveIcon({ ...defaultSidebar, iconColor: "#123" }, "guide/intro.md", "file", "", 1).color, "#123");

  const modern = mergeConfig({ sidebar: { iconStrategy: "modern", iconPalette: ["#111", "#222", "#333"] } }).sidebar;
  assert.equal(resolveIcon(modern, "guide", "directory", "", 0).colors.length, 3);
  assert.ok(["folder", "folder-open", "folder-tree", "folder-cog", "folder-git-2", "layers", "network", "workflow", "package", "blocks"].includes(resolveIcon(modern, "guide", "directory", "", 0).name));
  assert.equal(resolveIcon(modern, "guide/nested", "directory", "", 1).colors.length, 0);
  assert.ok(["file-markdown", "file-text", "file", "file-plus", "file-code", "file-check", "file-cog", "file-search", "book-open", "scroll-text", "newspaper", "notebook-tabs", "text"].includes(resolveIcon(modern, "guide/intro.md", "file", "", 1).name));

  const mixed = mergeConfig({ sidebar: { iconStrategy: "mixed", iconPalette: ["#111", "#222", "#333"] } }).sidebar;
  assert.equal(resolveIcon(mixed, "guide", "directory", "", 0).name, "folder");
  assert.equal(resolveIcon(mixed, "guide/nested", "directory", "", 1).name, "folder");
  assert.equal(resolveIcon(mixed, "README.md", "file", "", 0).colors.length, 3);
  assert.equal(resolveIcon(mixed, "guide/intro.md", "file", "", 1).colors.length, 0);

  await withTempDir(async (root) => {
    await writeFixture(root, "README.md", "# 首页\n\n首页说明\n");
    await writeFixture(root, "guide/intro.md", "---\ntitle: 指南入口\ndescription: 指南说明\norder: 1\n---\n# 指南入口\n\n正文\n");
    await writeFixture(root, "guide/hidden.md", "---\nhidden: true\n---\n# 隐藏\n");
    await writeFixture(root, "guide/nested/deep.markdown", "# 深入\n");
    await writeFixture(root, "guide/readme.txt", "不是 Markdown\n");
    await writeFixture(root, ".hidden.md", "# 不应扫描\n");
    const scanned = await scanDocuments(root);
    assert.deepEqual(scanned.documents.map((document) => document.path).sort(), ["README.md", "guide/intro.md", "guide/nested/deep.markdown"]);
    assert.equal(scanned.documents.find((document) => document.path === "guide/intro.md").description, "指南说明");
    assert.equal(scanned.directoryMetadata.has("guide"), true);

    const tree = createTree(scanned.documents, mergeConfig({ sidebar: { sort: "locale" } }), scanned.directoryMetadata);
    assert.equal(tree[0].type, "directory");
    assert.equal(tree[0].path, "guide");
    assert.deepEqual(tree[0].children.map((node) => node.path), ["guide/intro.md", "guide/nested"]);
    assert.equal(tree[0].children[1].children[0].path, "guide/nested/deep.markdown");
    assert.equal(tree[1].path, "README.md");
  });

  const sorted = [
    { type: "file", title: "二", order: 1, createdAtMs: 20 },
    { type: "directory", title: "目录", order: 1, createdAtMs: 30 },
    { type: "file", title: "一", order: 1, createdAtMs: 10 },
    { type: "file", title: "最后", order: 2, createdAtMs: 1 }
  ];
  assert.deepEqual(sortNodes(sorted, "createdAt").map((node) => node.title), ["目录", "一", "二", "最后"]);
  const localeNodes = [
    { type: "file", title: "zeta", order: 1, createdAtMs: 1 },
    { type: "file", title: "alpha", order: 1, createdAtMs: 2 }
  ];
  assert.deepEqual(sortNodes(localeNodes, "locale").map((node) => node.title), ["alpha", "zeta"]);
});

test("Markdown 渲染、搜索和公开文档结果覆盖用户可见内容", () => {
  const inline = renderInline(
    '![图片](images/a.png "图片标题") [站内](../other.md#章节) [外部](https://example.com) [资源](../assets/a.png) [越界](../../secret.md) `:icon[file]` **粗体** __强调__ ~~删除~~ *斜体* :icon[rocket] <安全文本>',
    "guide/intro.md"
  );
  assert.match(inline, /<img src="\/api\/asset\?path=guide%2Fimages%2Fa.png" alt="图片" title="图片标题" loading="lazy" \/>/);
  assert.match(inline, /<a href="\/\?doc=other\.md#章节" data-doc-path="other\.md">站内<\/a>/);
  assert.match(inline, /<a href="https:\/\/example\.com" target="_blank" rel="noreferrer">外部<\/a>/);
  assert.match(inline, /<a href="\/\?doc=assets%2Fa\.png" data-doc-path="assets\/a\.png">资源<\/a>/);
  assert.match(inline, /<a href="#">越界<\/a>/);
  assert.match(inline, /<code>:icon\[file\]<\/code>/);
  assert.match(inline, /<strong>粗体<\/strong>\s+<strong>强调<\/strong>\s+<del>删除<\/del>\s+<em>斜体<\/em>/);
  assert.match(inline, /data-icon-name="rocket"/);
  assert.match(inline, /&lt;安全文本&gt;/);

  const rendered = renderMarkdown(`# 标题\n# 标题\n\n---\n\n| 名称 | 左 | 中 | 右 |\n| :--- | :---: | ---: | --- |\n| 值 | 1 | 2 | 3 |\n\n> 普通引用\n\n> [!WARNING]\n> 注意内容\n\n- [x] 已完成\n- [ ] 待办\n\n1. 第一项\n2. 第二项\n\n\`\`\`js\n:icon[file-markdown]\n<代码>\n\`\`\`\n\n普通段落。`, "guide/intro.md");
  assert.equal(rendered.headings.length, 2);
  assert.equal(rendered.headings[0].id, "标题");
  assert.equal(rendered.headings[1].id, "标题-2");
  assert.match(rendered.html, /<hr \/>/);
  assert.match(rendered.html, /text-align:center/);
  assert.match(rendered.html, /<blockquote>/);
  assert.match(rendered.html, /markdown-callout--warning/);
  assert.match(rendered.html, /checked \/>/);
  assert.match(rendered.html, /<ol>/);
  assert.match(rendered.html, /<span>js<\/span>/);
  assert.match(rendered.html, /:icon\[file-markdown\]/);
  assert.match(rendered.html, /&lt;代码&gt;/);

  const config = mergeConfig({ sidebar: { iconStrategy: "modern", iconPalette: ["#111", "#222", "#333"] } });
  const document = {
    path: "guide/intro.md",
    title: "指南入口",
    description: "摘要",
    body: "# 指南入口\n\n正文关键词",
    plainBody: "指南入口 正文关键词",
    updatedAt: "2026-01-01T00:00:00.000Z",
    createdAt: "2026-01-01T00:00:00.000Z",
    createdAtMs: 1,
    order: 0,
    icon: ""
  };
  const publicResult = publicDocument(document, config);
  assert.equal(publicResult.path, document.path);
  assert.equal(publicResult.headings[0].title, "指南入口");
  assert.ok(publicResult.html.includes("正文关键词"));
  assert.ok(publicResult.icon);

  assert.equal(makeSearchSnippet("这是一个很长的正文关键词内容", "不存在"), "这是一个很长的正文关键词内容");
  assert.equal(makeSearchResults([document], "", config).length, 0);
  document.searchText = "指南入口\nguide/intro.md\n正文关键词";
  const results = makeSearchResults([document], "指南 关键词", config);
  assert.equal(results.length, 1);
  assert.equal(results[0].path, "guide/intro.md");
  assert.ok(results[0].snippet.includes("正文关键词"));
});

test("应用服务器覆盖接口、静态资源和异常响应", async () => {
  await withTempDir(async (root) => {
    await writeFixture(root, "asset.txt", "静态资源");
    const config = mergeConfig({ site: { title: "测试站点" } });
    const document = {
      type: "file",
      path: "guide/intro.md",
      title: "指南入口",
      description: "摘要",
      order: 0,
      icon: "",
      body: "# 指南入口\n\n接口正文",
      plainBody: "指南入口 接口正文",
      searchText: "指南入口\nguide/intro.md\n接口正文",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
      createdAtMs: 1
    };
    const loadIndex = async () => ({ documents: [document], directoryMetadata: new Map() });
    await withHttpServer({
      rootDir: PROJECT_DIR,
      loadConfig: async () => ({ config, docsDir: root }),
      getDocumentIndex: loadIndex
    }, async (baseUrl) => {
      let result = await request(baseUrl, "/healthz");
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, { status: "ok", service: "docs-kit" });

      result = await request(baseUrl, "/api/bootstrap");
      assert.equal(result.response.status, 200);
      assert.equal(result.body.defaultPath, "guide/intro.md");
      assert.equal(result.body.tree[0].path, "guide");

      result = await request(baseUrl, "/api/document?path=guide%2Fintro.md");
      assert.equal(result.response.status, 200);
      assert.match(result.body.html, /接口正文/);

      result = await request(baseUrl, "/api/document?path=guide%2Fintro.txt");
      assert.equal(result.response.status, 400);
      result = await request(baseUrl, "/api/document?path=missing.md");
      assert.equal(result.response.status, 404);

      result = await request(baseUrl, "/api/search?q=接口");
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body.results.map((item) => item.path), ["guide/intro.md"]);

      result = await request(baseUrl, "/api/asset?path=asset.txt");
      assert.equal(result.response.status, 200);
      assert.equal(result.body, "静态资源");
      result = await request(baseUrl, "/api/asset?path=guide%2Fintro.md");
      assert.equal(result.response.status, 403);

      result = await request(baseUrl, "/api/unknown");
      assert.equal(result.response.status, 404);
      result = await request(baseUrl, "/styles.css");
      assert.equal(result.response.status, 200);
      assert.match(result.body, /side-nav__children\.is-collapsed/);
      result = await request(baseUrl, "/missing-file.js");
      assert.equal(result.response.status, 200);
      assert.match(result.body, /<!doctype html>/i);
      result = await request(baseUrl, "/api/asset?path=..%2Foutside.txt");
      assert.equal(result.response.status, 500);
      result = await request(baseUrl, "/", { method: "POST" });
      assert.equal(result.response.status, 405);
    });
  });

  await withHttpServer({ handleRequest: async () => { throw new Error("测试异常"); } }, async (baseUrl) => {
    const result = await request(baseUrl, "/");
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "测试异常" });
  });
});
