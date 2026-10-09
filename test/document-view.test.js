"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const { renderMarkdown } = require("../markdown");
const { mergeConfig, publicDocument, renderPage } = require("../server");

const root = path.resolve(__dirname, "..");
const documentData = (body, description = "") => publicDocument({
  path: "guide/start.md", title: "文档标题", body, description,
  updatedAt: "2026-10-09T00:00:00.000Z", cacheKey: `header:${body}:${description}`
}, mergeConfig({}));

test("标题布局来自顶层 Markdown 节点，保留内联内容、重复标题锚点及完整正文合同", () => {
  const source = "# **安装** `v1`\n\n安装步骤说明。\n\n```html\n<h1>代码中的标题</h1>\n```\n\n# 安装 v1\n\n> # 引用内标题\n\n参考[^note]\n\n[^note]: 脚注内容";
  const rendered = renderMarkdown(source, "guide/start.md");
  assert.ok(rendered.presentation, "渲染器应提供结构化首屏布局");
  const original = new JSDOM(rendered.html).window.document;
  const split = new JSDOM(rendered.presentation.titleHtml + rendered.html.slice(rendered.presentation.bodyOffset)).window.document;
  assert.deepEqual([...split.querySelectorAll("[id]")].map((node) => node.id), [...original.querySelectorAll("[id]")].map((node) => node.id));
  assert.equal(rendered.presentation.titleHtml, original.querySelector("h1").outerHTML);
  assert.match(rendered.presentation.titleHtml, /<strong>安装<\/strong> <code>v1<\/code>/);
  assert.equal(rendered.presentation.openingParagraph, "安装步骤说明。");
  assert.equal(split.querySelectorAll("h1").length, 3);
  assert.equal(split.querySelector("blockquote h1").textContent, "引用内标题");
  assert.match(split.querySelector("pre").textContent, /<h1>代码中的标题<\/h1>/);
  assert.equal(split.querySelector(".footnotes").textContent.includes("脚注内容"), true);
});

test("仅提升开头的一级标题，不移动正文中间或引用中的标题", () => {
  for (const source of ["导言内容。\n\n# 正文标题\n\n后续内容。", "> # 引用标题\n\n正文内容。", "## 概览\n\n# 中间标题"]) {
    const rendered = renderMarkdown(source, "guide/start.md");
    assert.equal(rendered.presentation.titleHtml, "");
    assert.equal(rendered.presentation.bodyOffset, 0);
  }
  const leading = renderMarkdown("\n\n# 首标题\n\n正文", "guide/start.md");
  assert.match(leading.presentation.titleHtml, /^<h1 /);
});

test("首屏标题、独立摘要及元信息顺序一致，重复开篇摘要只保留正文", () => {
  const { renderDocumentSection } = require("../document-view");
  const data = documentData("# 开始使用\n\n安装说明。执行以下步骤。", "先准备运行环境，再安装项目。");
  const document = new JSDOM(renderDocumentSection(data)).window.document;
  const header = document.querySelector(".doc-header");
  assert.equal(header.querySelector("h1").textContent, "开始使用");
  assert.equal(document.querySelectorAll("h1").length, 1);
  assert.equal(header.querySelector(".doc-description").textContent, data.description);
  assert.ok(header.querySelector("h1").compareDocumentPosition(header.querySelector(".doc-description")) & 4);
  assert.ok(header.querySelector(".doc-description").compareDocumentPosition(header.querySelector(".doc-meta")) & 4);
  assert.ok(header.compareDocumentPosition(document.querySelector(".markdown-body")) & 4);
  for (const description of ["安装说明。执行以下步骤。", "安装说明。", "安装说明。\n执行以下步骤。", "开始使用"]) {
    const duplicate = new JSDOM(renderDocumentSection(documentData("# 开始使用\n\n安装说明。执行以下步骤。", description))).window.document;
    assert.equal(duplicate.querySelector(".doc-description"), null, description);
    assert.equal(duplicate.querySelector(".markdown-body p").textContent, "安装说明。执行以下步骤。");
  }
});

test("无一级标题和空文档仍有安全标题，异常日期不展示无效标签", () => {
  const { renderDocumentSection } = require("../document-view");
  const data = { ...documentData("## 步骤\n\n正文"), title: '<img src=x onerror="alert(1)">', path: '目录/"文档".md', updatedAt: "invalid" };
  const document = new JSDOM(renderDocumentSection(data)).window.document;
  assert.equal(document.querySelector("h1").textContent, data.title);
  assert.equal(document.querySelector(".doc-header img"), null);
  assert.equal(document.querySelector(".doc-meta").textContent, data.path);
  assert.doesNotMatch(document.body.textContent, /Invalid Date|更新于/);
  const empty = new JSDOM(renderDocumentSection(documentData(""))).window.document;
  assert.equal(empty.querySelectorAll("h1").length, 1);
  assert.equal(empty.querySelector(".markdown-body").textContent, "");
  const legacy = new JSDOM(renderDocumentSection({ path: "old.md", title: "旧页", headings: [{ level: 1 }], html: '<h1 id="old">旧页</h1>' })).window.document;
  assert.equal(legacy.querySelectorAll("h1").length, 1);
});

test("动态 SSR、静态预渲染及浏览器共享同一标题布局", () => {
  const { renderDocumentSection } = require("../document-view");
  const data = documentData("# 标题 [指南](next.md)\n\n第一段。", "独立的文档摘要。");
  const template = '<!doctype html><html><head><title></title></head><body><article class="doc-article" id="doc-content">加载中</article></body></html>';
  const config = mergeConfig({});
  const dynamic = new JSDOM(renderPage(template, config, data, "/?doc=guide/start.md")).window.document;
  const staticPage = new JSDOM(renderPage(template, config, data, "/guide/start.html", { staticData: { currentDocument: data } })).window.document;
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { runScripts: "outside-only" });
  try {
    vm.runInContext(fs.readFileSync(path.join(root, "document-view.js"), "utf8"), dom.getInternalVMContext());
    const browser = dom.window.DocsKitDocument.renderDocumentSection(JSON.parse(JSON.stringify(data)));
    assert.equal(browser, renderDocumentSection(data));
    assert.equal(dynamic.querySelector("#doc-content").innerHTML, browser);
    assert.equal(staticPage.querySelector("#doc-content").innerHTML, browser);
    assert.equal(staticPage.querySelector(".doc-header h1 a").getAttribute("href"), "/?doc=guide%2Fnext.md");
  } finally { dom.window.close(); }
});
