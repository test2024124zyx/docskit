"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const { renderMarkdown, parseMarkdown } = require("../markdown");
const { buildSearchFields } = require("../content-search");

test("代码组保留语言、文件标签、代码文本和无障碍关联", () => {
  const source = '::: code-group request\n```bash [cURL]\ncurl /v1/payments\n```\n```go [main.go]\nfmt.Println("支付")\n```\n:::';
  const html = renderMarkdown(source, "api.md").html;
  const document = new JSDOM(html).window.document;
  const group = document.querySelector('[data-code-group="request"]');
  assert.ok(group);
  const tabs = group.querySelectorAll('[role="tab"]');
  assert.equal(tabs.length, 2);
  assert.equal(tabs[1].textContent, "main.go");
  assert.equal(tabs[1].dataset.codeLanguage, "go");
  assert.equal(document.getElementById(tabs[1].getAttribute("aria-controls")).hidden, true);
  assert.equal(tabs[0].getAttribute("aria-selected"), "true");
  assert.ok(group.textContent.includes("/v1/payments"));
  assert.ok(buildSearchFields(source, "api.md").plainBody.includes('/v1/payments'));
});

test("多个代码组 ID 不重复，代码内的 ::: 不会提前关闭容器", () => {
  const source = '::: code-group\n```text\n::: 不应截断\n```\n:::冷门行\n:::';
  const parsed = parseMarkdown(source, "group.md");
  assert.ok(JSON.stringify(parsed.nodes).includes("不应截断"));
  const valid = '::: code-group\n```text\nfirst\n```\n:::';
  const document = new JSDOM(renderMarkdown(`${valid}\n\n${valid}`, "groups.md").html).window.document;
  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("标签里的 HTML 安全转义，大型单行代码不会同步高亮", () => {
  const source = '::: code-group\n```js [<img src=x onerror=alert(1)>]\nconst value = 1;\n```\n:::';
  const document = new JSDOM(renderMarkdown(source, "safe.md").html).window.document;
  assert.equal(document.querySelector("img"), null);
  const huge = renderMarkdown('```json\n' + ' '.repeat(25000) + '{"ok":true}\n```', "huge.md").html;
  assert.match(huge, /data-lazy-highlight="json"/);
});

test("代码组可以紧接段落且不会被吞入段落", () => {
  const source = '示例：\n::: code-group\n```js\nconst ready = true;\n```\n:::';
  const html = renderMarkdown(source, "group.md").html;
  assert.match(html, /role="tablist"/);
  assert.doesNotMatch(html, /<p>[^<]*:::/);
});
