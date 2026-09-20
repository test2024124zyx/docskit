"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = fs.promises;
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const hljs = require("highlight.js/lib/common");
const markdown = require("../markdown");
const { sendFile } = require("../server-assets");
const { mergeConfig, publicDocument, renderPage } = require("../server");
const { buildStaticSite, assertUniqueDocumentOutputs } = require("../static-build");

const ROOT = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const clientSource = fs.readFileSync(path.join(ROOT, "script.js"), "utf8");

function documentFixture(body, name = "review-regression.md") {
  return {
    path: name, title: "Review regression", description: "Test document", body,
    updatedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z", icon: ""
  };
}

async function temporaryDirectory(t) {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "docskit-review-"));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  return directory;
}

function readCodeLines(code) {
  return Array.from(code.children).map((line) => line.hasAttribute("data-code-empty") ? "" : line.textContent);
}

function extractClientFunctions() {
  const start = clientSource.indexOf("  function wrapHighlightedCode(");
  const end = clientSource.indexOf("\n  function renderDocument(", start);
  assert.ok(start >= 0 && end > start, "客户端应包含平衡高亮标签的分行函数");
  return clientSource.slice(start, end);
}

test("客户端取消下载后源流关闭，sendFile 不再悬挂", { timeout: 10000 }, async (t) => {
  const root = await temporaryDirectory(t);
  const filename = path.join(root, "large.bin");
  const handle = await fsp.open(filename, "w");
  try { await handle.truncate(32 * 1024 * 1024); } finally { await handle.close(); }
  let source;
  const original = fs.createReadStream;
  t.mock.method(fs, "createReadStream", function (...args) {
    const stream = original.apply(this, args);
    if (args[0] === filename) source = stream;
    return stream;
  });
  const handled = Promise.withResolvers();
  // Attach rejection handling before starting the request.
  handled.promise.catch(() => {});
  const server = http.createServer((request, response) => {
    sendFile(response, filename, { request }).then(handled.resolve, handled.reject);
  });
  t.after(async () => {
    source?.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  await new Promise((resolve, reject) => {
    const request = http.get(`http://127.0.0.1:${server.address().port}/`, (response) => {
      response.once("data", () => {
        response.destroy();
        request.destroy();
        resolve();
      });
      response.once("error", reject);
    });
    request.once("error", reject);
  });
  await handled.promise;
  assert.ok(source, "应创建实际文件读取流");
  assert.equal(source.destroyed, true);
  assert.equal(source.closed, true);
  assert.equal(source.fd, null);
});

test("下载流正常完成、Range 和 HEAD 保持正确", { timeout: 10000 }, async (t) => {
  const root = await temporaryDirectory(t);
  const filename = path.join(root, "small.txt");
  await fsp.writeFile(filename, "0123456789");
  const server = http.createServer((request, response) => {
    sendFile(response, filename, { request }).catch((error) => response.destroy(error));
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), "0123456789");
  const range = await fetch(url, { headers: { Range: "bytes=2-4" } });
  assert.equal(range.status, 206);
  assert.equal(await range.text(), "234");
  const head = await fetch(url, { method: "HEAD" });
  assert.equal(head.headers.get("content-length"), "10");
  assert.equal(await head.text(), "");
});

test("服务端模板保留正文、标题、元信息中的替换字符串符号", () => {
  const literal = "$& $$ $` $'";
  const rendered = markdown.renderMarkdown("```text\n" + literal + "\n```", "literal.md");
  const document = { ...documentFixture("", "literal.md"), title: literal, description: literal, ...rendered };
  const config = mergeConfig({ site: { title: "Site", seo: { canonical: "https://example.com/?q=$&" }, favicon: "/icon$&.png" } });
  for (const pageTemplate of [template, template.replace(/<script\s+src="script\.js"[^>]*><\/script>/i, "")]) {
    const html = renderPage(pageTemplate, config, document, "https://example.com/", { staticData: { value: literal } });
    const dom = new JSDOM(html);
    try {
      assert.equal(dom.window.document.querySelectorAll("#doc-content").length, 1);
      assert.equal(dom.window.document.querySelector(".markdown-body code").textContent, literal);
      assert.equal(dom.window.document.title, `${literal} - Site`);
      assert.equal(dom.window.document.querySelector('meta[name="description"]').content, literal);
      assert.equal(dom.window.document.querySelector('link[rel="canonical"]').getAttribute("href"), "https://example.com/?q=$&");
      assert.equal(dom.window.document.querySelector("#site-favicon").getAttribute("href"), "/icon$&.png");
      assert.equal(JSON.parse(dom.window.document.querySelector("#docskit-static-data").textContent).value, literal);
    } finally { dom.window.close(); }
  }
});

test("真实语法高亮的跨行注释、字符串、空行被包装为独立代码行", () => {
  for (const source of ["/* first\n\nlast */\nconst x = 1;", "const text = `first\n\nlast`;", "\n\n", "<script>&\ntext"]) {
    const html = markdown.renderMarkdown("```js\n" + source + "\n```", "highlight.md").html;
    const dom = new JSDOM(html);
    try {
      const code = dom.window.document.querySelector("code.markdown-code__content");
      assert.deepEqual(readCodeLines(code), source.split("\n"));
      assert.equal(code.querySelectorAll(".markdown-code__line .markdown-code__line").length, 0);
      assert.equal(code.children.length, source.split("\n").length);
    } finally { dom.window.close(); }
  }
});

test("服务端与客户端的高亮分行算法输出一致并保留嵌套标签", () => {
  const wrap = vm.runInNewContext(extractClientFunctions() + "\nwrapHighlightedCode;");
  for (const html of [
    '<span class="hljs-comment">/* first\n\nlast */</span>',
    '<span class="outer">a<span class="inner">b\nc</span>d\ne</span>',
    "plain\n\ntext\n", ""
  ]) {
    assert.equal(wrap(html), markdown.wrapHighlightedCode(html));
    const dom = new JSDOM(`<code>${wrap(html)}</code>`);
    try {
      const code = dom.window.document.querySelector("code");
      assert.equal(code.querySelectorAll(".markdown-code__line .markdown-code__line").length, 0);
      assert.equal(code.children.length, html.split("\n").length);
    } finally { dom.window.close(); }
  }
});

test("超过 100 行的客户端延迟高亮保留源码、空行和跨行标签", async () => {
  const source = ["/* start", "", ...Array.from({ length: 101 }, (_, index) => `comment ${index}`), "end */"].join("\n");
  const rendered = markdown.renderMarkdown("```js\n" + source + "\n```", "lazy.md", { code: { copy: false } });
  const dom = new JSDOM(`<main>${rendered.html}</main>`);
  try {
    const container = dom.window.document.querySelector("main");
    assert.ok(container.querySelector("[data-lazy-highlight]"));
    let highlightedSource;
    const highlight = vm.runInNewContext(extractClientFunctions() + "\nhighlightCodeBlocks;", {
      window: { requestIdleCallback: (callback) => callback() },
      loadHighlightJs: async () => ({
        getLanguage: (language) => hljs.getLanguage(language),
        highlight: (text, options) => { highlightedSource = text; return hljs.highlight(text, options); }
      })
    });
    highlight(container);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(highlightedSource, source);
    assert.equal(container.querySelector("[data-lazy-highlight]"), null);
    const code = container.querySelector("code.markdown-code__content");
    assert.deepEqual(readCodeLines(code), source.split("\n"));
    assert.equal(code.querySelectorAll(".markdown-code__line .markdown-code__line").length, 0);
    assert.ok(Array.from(code.childNodes).every((node) => node.nodeType === 1), "行节点间不应出现额外换行文本");
  } finally { dom.window.close(); }
});

test("文档链接解码一次并正确处理根相对路径和锚点", () => {
  for (const [target, current, expected] of [
    ["hello%20world.md", "README.md", "hello world.md"],
    ["%E4%B8%AD%E6%96%87.md", "README.md", "中文.md"],
    ["percent%2520.md", "README.md", "percent%20.md"],
    ["/README.md", "guide/intro.md", "README.md"],
    ["../README.md", "guide/intro.md", "README.md"],
    ["/%E4%B8%AD%E6%96%87.md#section", "guide/intro.md", "中文.md"]
  ]) {
    const resolved = markdown.markdownTarget(target, current, "document");
    assert.equal(resolved.docPath, expected);
    assert.equal(new URL(resolved.href, "https://example.com").searchParams.get("doc"), expected);
  }
  assert.equal(markdown.markdownTarget("/README.md#heading", "guide/intro.md", "document").href, "/?doc=README.md#heading");
  const asset = markdown.markdownTarget("/images/demo%20image.png", "guide/intro.md", "asset");
  assert.equal(new URL(asset.href, "https://example.com").searchParams.get("path"), "images/demo image.png");
  const custom = markdown.markdownTarget("hello%20world.md#section", "README.md", "document", { document: (value, hash) => `/docs/${encodeURIComponent(value)}${hash}` });
  assert.equal(custom.href, "/docs/hello%20world.md#section");
});

test("编码后的目录逃逸、分隔符、空字节和损坏编码仍被拒绝", () => {
  for (const target of ["../outside.md", "%2e%2e/outside.md", "/%2e%2e/outside.md", "dir%2ffile.md", "dir%5cfile.md", "bad%00.md", "bad%ZZ.md", "//example.com/a.md", "javascript:alert(1)"]) {
    assert.equal(markdown.markdownTarget(target, "README.md", "document").href, "#", target);
  }
});

test("超深块引用、列表和混合嵌套安全降级，普通嵌套正常显示", () => {
  for (const source of [">".repeat(5000) + " text", "- ".repeat(5000) + "text", "> - ".repeat(5000) + "text"]) {
    const rendered = markdown.renderMarkdown(source, "deep.md");
    assert.match(rendered.html, /text/);
    assert.match(rendered.html, /data-language="text"/);
    assert.ok((rendered.html.match(/<blockquote>/g) || []).length <= 64);
  }
  const normal = markdown.renderMarkdown("> outer\n> > inner\n\n- first\n  - nested", "normal.md");
  assert.match(normal.html, /<blockquote>/);
  assert.match(normal.html, /<ul>/);
  assert.doesNotMatch(normal.html, /data-language="text"/);
});

test("静态文档渲染不复用其他部署基路径的链接缓存", () => {
  const document = documentFixture("[Guide](guide.md)\n\n![Image](demo.png)", "static-cache-review.md");
  const config = mergeConfig({});
  const render = (base) => publicDocument(document, config, { links: {
    document: (name, hash) => `${base}${name}${hash || ""}`,
    asset: (name) => `${base}assets/${name}`
  } });
  const first = render("/first/");
  const second = render("/second/");
  assert.match(first.html, /href="\/first\/guide\.md"/);
  assert.match(second.html, /href="\/second\/guide\.md"/);
  assert.match(second.html, /src="\/second\/assets\/demo\.png"/);
  const dynamic = publicDocument(document, config);
  assert.match(dynamic.html, /href="\/\?doc=guide\.md"/);
  assert.strictEqual(publicDocument(document, config), dynamic, "动态缓存仍然可用");
});

test("同进程不同 base 的完整静态构建使用各自部署链接", { timeout: 30000 }, async (t) => {
  const root = await temporaryDirectory(t);
  const docs = path.join(root, "docs");
  await fsp.mkdir(docs);
  await fsp.writeFile(path.join(docs, "README.md"), "# Home\n\n[Guide](guide.md)\n");
  await fsp.writeFile(path.join(docs, "guide.md"), "# Guide\n\n[Home](/README.md)\n");
  for (const base of ["/first/", "/second/"]) {
    const outDir = path.join(root, base.slice(1, -1));
    await buildStaticSite({ docsDir: docs, outDir, base, config: {} });
    const page = await fsp.readFile(path.join(outDir, "README.html"), "utf8");
    assert.ok(page.includes(`href="${base}guide.html"`));
    const data = JSON.parse(await fsp.readFile(path.join(outDir, "data/documents/guide.md.json"), "utf8"));
    assert.ok(data.html.includes(`href="${base}README.html"`));
  }
});

test("静态页面输出冲突在写入前被拒绝并保留旧产物", async (t) => {
  const root = await temporaryDirectory(t);
  const docs = path.join(root, "docs");
  const outDir = path.join(root, "site");
  await fsp.mkdir(docs);
  await fsp.mkdir(outDir);
  await fsp.writeFile(path.join(outDir, "keep.txt"), "previous successful build");
  await fsp.writeFile(path.join(docs, "guide.md"), "# First");
  await fsp.writeFile(path.join(docs, "guide.markdown"), "# Second");
  await assert.rejects(buildStaticSite({ docsDir: docs, outDir, config: {} }), /输出路径冲突/);
  assert.equal(await fsp.readFile(path.join(outDir, "keep.txt"), "utf8"), "previous successful build");
  assert.throws(() => assertUniqueDocumentOutputs([{ path: "Guide.md" }, { path: "guide.markdown" }]), /输出路径冲突/);
  assert.throws(() => assertUniqueDocumentOutputs([{ path: "guide.md" }, { path: "guide.html/child.md" }]), /输出路径冲突/);
  assert.doesNotThrow(() => assertUniqueDocumentOutputs([{ path: "index.md" }, { path: "guide/intro.markdown" }]));
});


test("Markdown 转义括号与 URL 编码可以组合使用", () => {
  const target = markdown.markdownTarget("assets/file\\(v1\\)%20copy.md", "guide/index.md", "document");
  assert.equal(target.docPath, "guide/assets/file(v1) copy.md");
  const result = markdown.renderMarkdown("[guide]: assets/file\\(v1\\).md\n\n[guide]", "guide/index.md");
  assert.match(result.html, /data-doc-path="guide\/assets\/file\(v1\)\.md"/);
});
