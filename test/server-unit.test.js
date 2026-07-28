const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs").promises;
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { classifyAsset, isDownloadableAsset, mediaMimeType } = require("../media-types");
const { assetMaxBytes, isPublicAssetPath, parseByteRange, vendorResourcePath } = require("../server-assets");

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
  parseMarkdown,
  renderMarkdown,
  publicDocument,
  makeSearchSnippet,
  makeSearchResults,
  assertNoSymlink,
  resolveExistingFile,
  MAX_MARKDOWN_BYTES,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  MAX_DOWNLOAD_BYTES,
  INDEX_POLL_INTERVAL_MS,
  getDocumentIndex,
  closeDocumentIndexWatchers,
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
    topbar: { search: false, links: [null, { label: "无效目标" }, { label: "危险链接", href: "javascript:alert(1)" }, { label: "有效链接", href: "https://example.com" }] },
    sidebar: { sort: "title", iconStrategy: "modern", expandMode: "accordion", indent: 100, iconPalette: [" #fff ", "", 42] }
  });
  assert.equal(config.docsDir, "custom-docs");
  assert.deepEqual(config.site.brand, { name: "知识", accent: "库" });
  assert.deepEqual(config.site.footer.links, []);
  assert.deepEqual(config.topbar.links, [{ label: "有效链接", href: "https://example.com" }]);
  assert.equal(config.sidebar.sort, "locale");
  assert.equal(config.sidebar.iconStrategy, "modern");
  assert.equal(config.sidebar.expandMode, "accordion");
  assert.equal(config.sidebar.indent, 48);
  assert.deepEqual(config.sidebar.iconPalette, ["#fff"]);
  assert.deepEqual(config.markdown.code, { highlight: true, lineNumbers: true, copy: true, wrap: false });
  const customCodeConfig = mergeConfig({ markdown: { code: { highlight: "yes", lineNumbers: false, copy: false, wrap: true } } });
  assert.deepEqual(customCodeConfig.markdown.code, { highlight: true, lineNumbers: false, copy: false, wrap: true });
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
  const yamlFront = splitFrontMatter("---\ntags: [docs, guide]\ndescription: >\n  第一行\n  第二行\nmetadata:\n  audience: public\n---\n正文");
  assert.deepEqual(yamlFront.attributes.tags, ["docs", "guide"]);
  assert.equal(yamlFront.attributes.description, "第一行 第二行\n");
  assert.deepEqual(yamlFront.attributes.metadata, { audience: "public" });
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
  assert.match(inline, /<a href="\/api\/asset\?path=assets%2Fa\.png">资源<\/a>/);
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

test("Markdown 媒体和附件链接输出可访问的播放与下载节点", () => {
  assert.equal(classifyAsset("assets/demo.mp4"), "video");
  assert.equal(classifyAsset("assets/theme.mp3"), "audio");
  assert.equal(isDownloadableAsset("assets/manual.pdf"), true);
  assert.equal(mediaMimeType("assets/demo.mp4"), "video/mp4");
  assert.equal(assetMaxBytes("assets/demo.mp4"), MAX_MEDIA_BYTES);
  assert.equal(assetMaxBytes("assets/manual.pdf"), MAX_DOWNLOAD_BYTES);
  assert.equal(assetMaxBytes("assets/image.png"), MAX_ASSET_BYTES);
  assert.deepEqual(parseByteRange("bytes=2-5", 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.equal(parseByteRange("bytes=20-", 10).invalid, true);
  assert.equal(parseByteRange("bytes=", 10).invalid, true);
  assert.equal(parseByteRange("bytes=0-1", 0).invalid, true);
  assert.equal(parseByteRange("", 10), null);
  assert.equal(isPublicAssetPath("assets/manual.pdf"), true);
  assert.equal(isPublicAssetPath(".env"), false);
  assert.equal(isPublicAssetPath("docs.config.json"), false);
  assert.equal(isPublicAssetPath("assets/unknown.bin"), false);
  assert.equal(vendorResourcePath("/vendor/mermaid.min.js"), "node_modules/mermaid/dist/mermaid.min.js");
  assert.equal(vendorResourcePath("/vendor/katex/katex.min.css"), "node_modules/katex/dist/katex.min.css");
  assert.equal(vendorResourcePath("/vendor/katex/%2e%2e/server.js"), "");
  assert.equal(vendorResourcePath("/vendor/katex/%E0%A4%A"), "");

  const rendered = renderMarkdown([
    "![演示视频](assets/demo.mp4 \"演示视频\")",
    "",
    "![背景音乐](assets/theme.mp3)",
    "",
    "[下载手册](assets/manual.pdf)"
  ].join("\n"), "guide/index.md");

  assert.match(rendered.html, /<video[^>]+controls[^>]+preload=\"metadata\"[^>]+src=\"\/api\/asset\?path=guide%2Fassets%2Fdemo\.mp4\"/);
  assert.match(rendered.html, /aria-label=\"演示视频\"/);
  assert.match(rendered.html, /<audio[^>]+controls[^>]+src=\"\/api\/asset\?path=guide%2Fassets%2Ftheme\.mp3\"/);
  assert.match(rendered.html, /<a href=\"\/api\/download\?path=guide%2Fassets%2Fmanual\.pdf\" download>/);
  assert.doesNotMatch(rendered.html, /<script|onerror=/i);
});

test("Markdown 标题编号和脚注编号在大规模文档中保持稳定", () => {
  const headings = Array.from({ length: 1800 }, (_, index) => `## 第 ${index} 节`).join("\n\n");
  const rendered = renderMarkdown(`${headings}\n\n引用[^note]\n\n[^note]: 脚注`, "large.md");
  assert.equal(rendered.headings.length, 1800);
  assert.equal(new Set(rendered.headings.map((heading) => heading.id)).size, 1800);
  assert.match(rendered.html, /<sup class=\"footnote-ref\"><a href=\"#fn-note\"/);
});

test("Markdown AST 与代码高亮入口可独立复用", () => {
  const parsed = parseMarkdown("## 标题\n\n正文", "guide/index.md");
  assert.equal(parsed.nodes[0].type, "heading");
  assert.equal(parsed.nodes[1].type, "paragraph");
  const rendered = renderMarkdown("```javascript\nconst answer = 42;\n```", "code.md");
  assert.match(rendered.html, /data-language="javascript"/);
  assert.match(rendered.html, /class="hljs-keyword">const<\/span>/);
  assert.match(rendered.html, /class="markdown-code__pre markdown-code__pre--line-numbers"/);
  assert.match(rendered.html, /class="markdown-code__line-number">1<\/span>/);
  assert.match(rendered.html, /class="copy-button"/);

  const plainCode = renderMarkdown("```javascript\nconst answer = 42;\n```", "code.md", { code: { highlight: false, lineNumbers: false, copy: false, wrap: true } });
  assert.doesNotMatch(plainCode.html, /class="hljs-keyword"|markdown-code__gutter|class="copy-button"/);
  assert.match(plainCode.html, /markdown-code__pre markdown-code__pre--wrap/);
  assert.match(plainCode.html, />const answer = 42;<\/code>/);

  const formulas = renderMarkdown("行内公式 $x^2 + y^2$。\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n```math\n\\frac{1}{2}\n```", "math.md");
  assert.match(formulas.html, /class="markdown-math"/);
  assert.match(formulas.html, /class="markdown-math markdown-math--block"/);
  assert.match(formulas.html, /class="katex"/);
  assert.doesNotMatch(formulas.html, /<script|onerror=/i);

  const diagram = renderMarkdown("```mermaid\ngraph TD\n  A-->B\n```", "diagram.md");
  assert.match(diagram.html, /data-language="mermaid"/);
  assert.match(diagram.html, /data-mermaid-source/);
  assert.match(diagram.html, /A--&gt;B/);
});

test("代码块布局不会拉伸行号栏并覆盖常见高亮 token", () => {
  const styles = fs.readFileSync(path.join(PROJECT_DIR, "styles.css"), "utf8");
  const rendered = renderMarkdown("```json\n{\"enabled\": true, \"count\": 1}\n```", "code.md");

  assert.match(rendered.html, /class="hljs-punctuation">\{/);
  assert.match(rendered.html, /class="hljs-attr">&quot;enabled&quot;<\/span>/);
  assert.match(rendered.html, /class="hljs-literal"><span class="hljs-keyword">true<\/span>/);
  assert.match(rendered.html, /class="hljs-number">1<\/span>/);
  assert.match(styles, /\.markdown-body \.markdown-code__pre \{[^}]*display: flex;/s);
  assert.match(styles, /\.markdown-body \.markdown-code__gutter \{[^}]*flex: 0 0 auto;/s);
  assert.match(styles, /\.markdown-body \.markdown-code__content \.hljs-punctuation/);
  assert.match(styles, /\.markdown-body \.markdown-code__content \.hljs-operator/);
  assert.match(styles, /\.markdown-body \.markdown-code__pre--wrap \.markdown-code__content \{[^}]*flex: 1 1 0;/s);
  assert.doesNotMatch(styles, /grid-template-columns: auto minmax\(0, max-content\)/);
});

test("Markdown 解析器支持嵌套结构、引用链接、脚注和安全行内语法", () => {
  const source = [
    "[guide]: ../getting-started/installation.md \"安装说明\"",
    "[image]: images/example.png \"示例图片\"",
    "",
    "Setext 标题",
    "=============",
    "",
    "***重点***、~~删除~~、\\*字面星号\\*、行尾空格  ",
    "下一行包含 https://example.com、<https://example.com> 和 <user@example.com>。",
    "",
    "[安装][guide] ![示例][image] [危险](javascript:alert(1)) <script>alert(1)</script>",
    "",
    "- 父项",
    "  - 子项",
    "    1. 深层有序项",
    "- [ ] 未完成",
    "- [x] 已完成",
    "",
    "> 引用第一段",
    ">",
    "> 引用第二段",
    "",
    "| 名称 | 内容 |",
    "| --- | :---: |",
    "| 带\\|管道 | 居中 |",
    "",
    "    缩进代码",
    "",
    "脚注说明[^note]。",
    "",
    "[^note]: 脚注正文。"
  ].join("\n");
  const rendered = renderMarkdown(source, "guide/index.md");

  assert.match(rendered.html, /<h1 id="setext-标题">Setext 标题<\/h1>/);
  assert.match(rendered.html, /<strong><em>重点<\/em><\/strong>/);
  assert.match(rendered.html, /<del>删除<\/del>/);
  assert.match(rendered.html, /\*字面星号\*/);
  assert.doesNotMatch(rendered.html, /https:\/\/example\.com、/);
  assert.match(rendered.html, /<sup class="footnote-ref"><a href="#fn-note"/);
  assert.match(rendered.html, /<br \/>/);
  assert.match(rendered.html, /href="\/\?doc=getting-started%2Finstallation\.md"/);
  assert.match(rendered.html, /src="\/api\/asset\?path=guide%2Fimages%2Fexample\.png"/);
  assert.match(rendered.html, /href="#"[^>]*>危险<\/a>/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(rendered.html, /<ul><li><p>父项<\/p>\s*<ul><li><p>子项<\/p>\s*<ol><li><p>深层有序项<\/p><\/li><\/ol><\/li><\/ul><\/li>/);
  assert.match(rendered.html, /<input type="checkbox" disabled \/>/);
  assert.match(rendered.html, /<input type="checkbox" disabled checked \/>/);
  assert.match(rendered.html, /<blockquote><p>引用第一段<\/p>\n<p>引用第二段<\/p><\/blockquote>/);
  assert.match(rendered.html, /带\|管道/);
  assert.match(rendered.html, /markdown-code__line-number">1<\/span>/);
  assert.match(rendered.html, /<code class="markdown-code__content hljs">缩进代码<\/code>/);
  assert.match(rendered.html, /class="footnotes"/);
  assert.equal(rendered.headings[0].id, "setext-标题");
});

test("Markdown 解析器对大文档保持线性扫描并完整转义代码内容", () => {
  const source = Array.from({ length: 3000 }, (_, index) => `第 ${index} 行 **内容**`).join("\n");
  const rendered = renderMarkdown(source, "large.md");
  assert.equal((rendered.html.match(/<p>/g) || []).length, 1);
  assert.match(rendered.html, /第 2999 行 <strong>内容<\/strong>/);
  assert.equal(rendered.headings.length, 0);
});

test("Markdown 解析器对损坏行内结构安全回退", () => {
  const front = splitFrontMatter("---\nitems: [invalid\n---\n正文");
  assert.equal(front.attributes.items, "[invalid");

  const source = [
    "[guide]: assets/file\\(v1\\).md",
    "",
    "[guide] [未闭合",
    "[坏角链](<https://example.com)",
    "[坏链接](https://example.com",
    "hello **未闭合",
    "括号链接 https://example.com/path(foo))",
    "> 第一段",
    "",
    "> 第二段"
  ].join("\n");
  const rendered = renderMarkdown(source, "guide/index.md");

  assert.match(rendered.html, /<a href="\/\?doc=guide%2Fassets%2Ffile/);
  assert.match(rendered.html, /括号链接 <a href="https:\/\/example\.com\/path\(foo\)"/);
  assert.match(rendered.html, /<blockquote><p>第一段<\/p>\n<p>第二段<\/p><\/blockquote>/);
  assert.match(rendered.html, /未闭合/);
  assert.equal(renderInline("hello", "guide/index.md"), "hello");
});

test("Markdown 解析器对恶意和随机损坏输入保持安全回退", () => {
  const corpus = [
    "<script>alert(1)</script><img src=x onerror=alert(1)>",
    "[危险](javascript:alert(1)) ![危险](data:image/svg+xml,<svg onload=alert(1)>)",
    "[a".repeat(800) + "**b".repeat(800) + "$$\\htmlClass{evil}{x}$$",
    "```javascript\n</code><script>alert(1)</script>\n```",
    "```mermaid\ngraph TD\n  A-->B\n  B-->|<script>|C\n```"
  ];
  let seed = 17;
  const alphabet = "[]()<>\\*_~$`:'\";{}|/";
  for (let index = 0; index < 120; index += 1) {
    let value = "";
    for (let character = 0; character < 80; character += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      value += alphabet[seed % alphabet.length];
    }
    corpus.push(value);
  }
  corpus.forEach((source) => {
    const html = renderMarkdown(source, "security.md").html;
    assert.doesNotMatch(html, /<script\b|<iframe\b|<[^>]+\son\w+\s*=/i);
    assert.doesNotMatch(html, /href="(?:javascript|vbscript|file):/i);
  });
});

test("官方文档中的仓库和站内相对链接都指向真实目标", async () => {
  const linkSources = [
    { file: "README.md", base: PROJECT_DIR },
    { file: "docs/README.md", base: path.join(PROJECT_DIR, "docs") }
  ];
  for (const source of linkSources) {
    const content = await fsp.readFile(path.join(PROJECT_DIR, source.file), "utf8");
    assert.equal(/example\.com/i.test(content), false, `${source.file} 不应保留占位域名`);
    const links = [...content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
    links.filter((link) => !/^(?:https?:|mailto:|#|<)/i.test(link)).forEach((link) => {
      const target = link.split("#", 1)[0];
      assert.equal(fs.existsSync(path.resolve(source.base, target)), true, `${source.file} 链接目标不存在: ${link}`);
    });
  }
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
      assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");

      result = await request(baseUrl, "/readyz");
      assert.equal(result.response.status, 200);
      assert.deepEqual(result.body, { status: "ready", service: "docs-kit", documents: 1 });

      result = await request(baseUrl, "/api/bootstrap");
      assert.equal(result.response.status, 200);
      assert.equal(result.body.defaultPath, "guide/intro.md");
      assert.equal(result.body.tree[0].path, "guide");
      assert.equal(Object.prototype.hasOwnProperty.call(result.body.config, "docsDir"), false);
      assert.deepEqual(result.body.config.markdown.code, { highlight: true, lineNumbers: true, copy: true, wrap: false });

      result = await request(baseUrl, "/?doc=guide%2Fintro.md");
      assert.equal(result.response.status, 200);
      assert.match(result.body, /<title>指南入口 - 测试站点<\/title>/);
      assert.match(result.body, /接口正文/);
      assert.match(result.body, /<link rel="canonical" href="http:\/\/127\.0\.0\.1:[0-9]+\/\?doc=guide%2Fintro\.md" \/>/);

      result = await request(baseUrl, "/robots.txt");
      assert.equal(result.response.status, 200);
      assert.match(result.body, /Sitemap: http:\/\/127\.0\.0\.1:[0-9]+\/sitemap\.xml/);

      result = await request(baseUrl, "/sitemap.xml");
      assert.equal(result.response.status, 200);
      assert.match(result.body, /guide%2Fintro\.md/);

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
      const styleEtag = result.response.headers.get("etag");
      assert.ok(styleEtag);
      result = await request(baseUrl, "/vendor/katex/katex.min.css");
      assert.equal(result.response.status, 200);
      result = await request(baseUrl, "/vendor/mermaid.min.js");
      assert.equal(result.response.status, 200);
      assert.match(result.response.headers.get("content-type"), /^text\/javascript/);
      const cachedStyle = await request(baseUrl, "/styles.css", { headers: { "If-None-Match": styleEtag } });
      assert.equal(cachedStyle.response.status, 304);
      result = await request(baseUrl, "/missing-file.js");
      assert.equal(result.response.status, 404);
      assert.deepEqual(result.body, { error: "页面不存在" });
      result = await request(baseUrl, "/server.js");
      assert.equal(result.response.status, 404);
      result = await request(baseUrl, "/api/asset?path=..%2Foutside.txt");
      assert.equal(result.response.status, 404);
      result = await request(baseUrl, "/", { method: "POST" });
      assert.equal(result.response.status, 405);
    });
  });

  await withHttpServer({ handleRequest: () => { throw new Error("测试异常"); } }, async (baseUrl) => {
    const result = await request(baseUrl, "/");
    assert.equal(result.response.status, 500);
    assert.deepEqual(result.body, { error: "服务器内部错误" });
  });

  await withHttpServer({ handleRequest: () => {
    const error = new Error("参数错误");
    error.statusCode = 400;
    error.publicMessage = "参数错误";
    throw error;
  } }, async (baseUrl) => {
    const result = await request(baseUrl, "/");
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { error: "参数错误" });
  });
});

test("资源接口拒绝敏感文件、未知扩展名、目录和符号链接", async () => {
  await withTempDir(async (root) => {
    await writeFixture(root, "asset.png", "图片");
    await writeFixture(root, "asset.svg", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10" /></svg>');
    await writeFixture(root, "docs.config.json", "配置");
    await writeFixture(root, ".env", "密钥");
    await writeFixture(root, "notes.bin", "未知");
    await fsp.writeFile(path.join(root, "large.png"), Buffer.alloc(MAX_ASSET_BYTES + 1));
    await fsp.mkdir(path.join(root, "folder"));
    const outside = path.join(path.dirname(root), "docskit-outside-asset.txt");
    await fsp.writeFile(outside, "外部", "utf8");
    try { await fsp.symlink(outside, path.join(root, "link.txt")); } catch (error) { /* 当前系统不允许创建符号链接时跳过该分支 */ }
    const config = mergeConfig({});
    await withHttpServer({ loadConfig: async () => ({ config, docsDir: root }) }, async (baseUrl) => {
      for (const requestedPath of ["docs.config.json", ".env", "notes.bin", "folder", "link.txt"]) {
        const result = await request(baseUrl, `/api/asset?path=${encodeURIComponent(requestedPath)}`);
        assert.equal(result.response.status, 404, requestedPath);
      }
    const image = await request(baseUrl, "/api/asset?path=asset.png");
    assert.equal(image.response.status, 200);
    assert.equal(image.body, "图片");
    const svg = await request(baseUrl, "/api/asset?path=asset.svg");
    assert.equal(svg.response.status, 200);
    assert.match(svg.response.headers.get("content-type"), /^image\/svg\+xml/);
    assert.match(svg.response.headers.get("content-security-policy"), /script-src 'none'/);
    assert.equal(svg.response.headers.get("content-disposition"), "inline");
    assert.match(svg.body, /<script>alert\(1\)<\/script>/);
      const large = await request(baseUrl, "/api/asset?path=large.png");
      assert.equal(large.response.status, 413);
    });
    await fsp.rm(outside, { force: true });
  });
});

test("资源接口支持附件下载、音视频 MIME 和 Range 分片请求", async () => {
  await withTempDir(async (root) => {
    await writeFixture(root, "manual.pdf", "PDF 内容");
    await writeFixture(root, "demo.mp4", "0123456789");
    const config = mergeConfig({});
    await withHttpServer({ loadConfig: async () => ({ config, docsDir: root }) }, async (baseUrl) => {
      const download = await request(baseUrl, "/api/download?path=manual.pdf");
      assert.equal(download.response.status, 200);
      assert.equal(download.body, "PDF 内容");
      assert.match(download.response.headers.get("content-disposition"), /^attachment;/);
      assert.match(download.response.headers.get("content-disposition"), /filename\*=UTF-8''manual\.pdf/);

      const head = await request(baseUrl, "/api/download?path=manual.pdf", { method: "HEAD" });
      assert.equal(head.response.status, 200);
      assert.equal(head.body, "");
      assert.equal(head.response.headers.get("content-length"), String(Buffer.byteLength("PDF 内容")));

      const range = await request(baseUrl, "/api/asset?path=demo.mp4", { headers: { Range: "bytes=2-5" } });
      assert.equal(range.response.status, 206);
      assert.equal(String(range.body), "2345");
      assert.equal(range.response.headers.get("content-range"), "bytes 2-5/10");
      assert.equal(range.response.headers.get("accept-ranges"), "bytes");
      assert.equal(range.response.headers.get("content-type"), "video/mp4");

      const invalidRange = await request(baseUrl, "/api/asset?path=demo.mp4", { headers: { Range: "bytes=20-25" } });
      assert.equal(invalidRange.response.status, 416);
      assert.equal(invalidRange.response.headers.get("content-range"), "bytes */10");
    });
  });
});

test("根目录公开 skill 安装说明并以附件方式提供 skill 压缩包", async () => {
  await withTempDir(async (root) => {
    await writeFixture(root, "skills/install.md", "# 安装 DocsKit skill\n");
    await writeFixture(root, "docskit-doc-writing.zip", "PK\\x03\\x04");
    const config = mergeConfig({});
    await withHttpServer({ rootDir: root, loadConfig: async () => ({ config, docsDir: root }) }, async (baseUrl) => {
      const install = await request(baseUrl, "/skills/install.md");
      assert.equal(install.response.status, 200);
      assert.equal(install.response.headers.get("content-type"), "text/markdown; charset=utf-8");
      assert.match(install.body, /安装 DocsKit skill/);

      const archive = await request(baseUrl, "/docskit-doc-writing.zip");
      assert.equal(archive.response.status, 200);
      assert.equal(archive.response.headers.get("content-type"), "application/zip");
      assert.match(archive.response.headers.get("content-disposition"), /^attachment;/);
    });
  });
});

test("文件系统安全辅助函数拒绝越界、缺失和目录目标", async () => {
  await withTempDir(async (root) => {
    await fsp.mkdir(path.join(root, "folder"));
    await assert.rejects(() => assertNoSymlink(root, path.join(root, "missing.txt")), (error) => error.statusCode === 404);
    await assert.rejects(() => assertNoSymlink(root, path.join(root, "..")), (error) => error.statusCode === 404);
    await assert.rejects(() => resolveExistingFile(root, "folder"), (error) => error.statusCode === 404);
  });
});

test("索引在监听不可用时按间隔轮询文档元数据，并跳过超大文档和符号链接", async () => {
  await withTempDir(async (root) => {
    await writeFixture(root, "small.md", "# 小文档");
    const outside = path.join(path.dirname(root), "docskit-outside-document.md");
    await fsp.writeFile(outside, "# 外部文档", "utf8");
    try { await fsp.symlink(outside, path.join(root, "link.md")); } catch (error) { /* 当前系统不允许创建符号链接时跳过该分支 */ }
    await fsp.writeFile(path.join(root, "large.md"), Buffer.alloc(MAX_MARKDOWN_BYTES + 1, "a"));
    const originalWatch = fs.watch;
    fs.watch = () => { throw new Error("测试环境不支持监听"); };
    try {
      const initial = await getDocumentIndex(root);
      assert.deepEqual(initial.documents.map((document) => document.path), ["small.md"]);
      await writeFixture(root, "new.md", "# 新文档");
      await new Promise((resolve) => setTimeout(resolve, INDEX_POLL_INTERVAL_MS + 80));
      const updated = await getDocumentIndex(root);
      assert.deepEqual(updated.documents.map((document) => document.path).sort(), ["new.md", "small.md"]);
    } finally {
      fs.watch = originalWatch;
      closeDocumentIndexWatchers();
      await fsp.rm(outside, { force: true });
    }
  });
});
