"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const api = require("../client-api");
const view = require("../client-api-view");
const { createSwaggerWindow, waitFor, button } = require("./helpers/swagger");

async function mountSnippets(t, snippetOptions = {}) {
  const context = createSwaggerWindow(t);
  const { window, container } = context;
  const requests = [];
  window.fetch = async (input) => { requests.push(String(input)); return new Response("完成", { headers: { "Content-Type": "text/plain" } }); };
  const spec = { openapi: "3.1.0", info: { title: "代码示例", version: "1" }, servers: [{ url: "/" }], paths: { "/items": { get: { responses: { "200": { description: "成功" } } } } } };
  const config = api.createConfiguration({ spec }, { window });
  window.SwaggerUIBundle({ ...config, domNode: container, docExpansion: "full", syntaxHighlight: { activated: false }, requestSnippets: { ...config.requestSnippets, ...snippetOptions }, plugins: [...config.plugins, view.plugin] });
  await waitFor(() => button(container, "Try it out"), "调试入口未加载");
  button(container, "Try it out").click();
  await waitFor(() => button(container, "Execute"), "发送操作未启用");
  button(container, "Execute").click();
  await waitFor(() => container.textContent.includes("完成"), "请求未完成");
  return { ...context, requests };
}

test("真实请求代码使用原生页签，方向键与 Home/End 同步焦点、选择和代码面板", async (t) => {
  const { window, container, requests, errors } = await mountSnippets(t);
  const list = container.querySelector('[role="tablist"][aria-label="请求示例语言"]');
  assert.ok(list);
  const tabs = Array.from(list.querySelectorAll('[role="tab"]'));
  assert.equal(tabs.length, 5);
  assert.ok(tabs.every((tab) => tab.tagName === "BUTTON" && tab.type === "button"));
  assert.equal(tabs.filter((tab) => tab.tabIndex === 0).length, 1);
  // JSDOM 不计算布局，用窄视口几何值验证真实页签事件只滚动语言条。
  const tabWidth = 100;
  const viewportWidth = 240;
  const viewportLeft = 20;
  const focusOptions = [];
  Object.defineProperties(list, { clientWidth: { value: viewportWidth }, clientLeft: { value: 0 } });
  list.getBoundingClientRect = () => ({ left: viewportLeft, right: viewportLeft + viewportWidth });
  list.scrollTop = 73;
  tabs.forEach((tab, index) => {
    tab.getBoundingClientRect = () => ({ left: viewportLeft + index * tabWidth - list.scrollLeft, right: viewportLeft + (index + 1) * tabWidth - list.scrollLeft });
    const originalFocus = tab.focus.bind(tab);
    tab.focus = (options) => { focusOptions.push(options); originalFocus(options); };
  });
  const panel = () => container.querySelector('[role="tabpanel"]');
  const press = async (tab, key, target) => {
    tab.focus();
    const event = new window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    tab.dispatchEvent(event);
    await waitFor(() => tabs[target].getAttribute("aria-selected") === "true", "键盘选择未更新");
    assert.equal(event.defaultPrevented, true);
    assert.equal(window.document.activeElement, tabs[target]);
    assert.equal(panel().getAttribute("aria-labelledby"), tabs[target].id);
    assert.equal(tabs[target].getAttribute("aria-controls"), panel().id);
    assert.deepEqual(focusOptions.at(-1), { preventScroll: true });
    assert.equal(list.scrollTop, 73);
    assert.ok(tabs[target].getBoundingClientRect().left >= viewportLeft);
    assert.ok(tabs[target].getBoundingClientRect().right <= viewportLeft + viewportWidth);
  };
  await press(tabs[0], "End", 4);
  assert.ok(panel().textContent.includes("import requests"));
  await press(tabs[4], "Home", 0);
  await press(tabs[0], "ArrowLeft", 4);
  await press(tabs[4], "ArrowRight", 0);
  const ignored = new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
  tabs[0].dispatchEvent(ignored);
  assert.equal(ignored.defaultPrevented, false);
  tabs[3].click();
  await waitFor(() => panel().textContent.includes("const response = await fetch"), "JavaScript 页签未显示代码");
  assert.equal(tabs[3].tabIndex, 0);
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(requests.length, 1);
  assert.deepEqual(errors, []);
});

test("复制成功提示在切换语言及重新执行请求后清空", async (t) => {
  const { window, container, requests } = await mountSnippets(t);
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => {} } });
  const status = () => container.querySelector('[role="status"]').textContent;
  const copy = () => container.querySelector('[aria-label="复制请求代码"]').click();
  copy();
  await waitFor(() => status().includes("已复制"), "首次复制未完成");
  button(container, "Python").click();
  await waitFor(() => container.querySelector('[role="tabpanel"] pre').textContent.includes("import requests"), "语言未切换");
  assert.equal(status(), "");
  copy();
  await waitFor(() => status().includes("已复制"), "新语言复制未完成");
  button(container, "Execute").click();
  await waitFor(() => requests.length === 2 && !button(container, "Execute")?.disabled, "新请求未完成");
  assert.equal(status(), "");
});

test("旧复制异步结果不能覆盖新语言的反馈或触发过期兼容复制", async (t) => {
  const { window, container } = await mountSnippets(t);
  const pending = [];
  let compatibilityCopies = 0;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) } });
  window.document.execCommand = () => { compatibilityCopies += 1; return true; };
  const status = () => container.querySelector('[role="status"]').textContent;
  const copy = () => container.querySelector('[aria-label="复制请求代码"]').click();
  copy();
  button(container, "Python").click();
  await waitFor(() => container.querySelector('[role="tabpanel"] pre').textContent.includes("import requests"), "语言未切换");
  pending[0].resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(status(), "");
  copy();
  button(container, "JavaScript (Node.js)").click();
  await waitFor(() => container.querySelector('[role="tabpanel"] pre').textContent.includes("const response"), "JavaScript 未显示");
  copy();
  pending[2].resolve();
  await waitFor(() => status().includes("已复制"), "当前复制未完成");
  pending[1].reject(new Error("旧请求已失去权限"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(status(), "已复制请求代码");
  assert.equal(compatibilityCopies, 0);
});

test("重新执行相同请求后，旧复制结果不能标记新请求代码已复制", async (t) => {
  const { window, container, requests } = await mountSnippets(t);
  let resolveCopy;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: () => new Promise((resolve) => { resolveCopy = resolve; }) } });
  container.querySelector('[aria-label="复制请求代码"]').click();
  const status = () => container.querySelector('[role="status"]').textContent;
  await waitFor(() => status().includes("正在复制"), "未显示复制进行中状态");
  button(container, "Execute").click();
  await waitFor(() => requests.length === 2 && !button(container, "Execute")?.disabled, "重复请求未完成");
  assert.equal(status(), "");
  resolveCopy();
  // 等待真实 React 更新队列，确保迟到反馈不能重新出现。
  await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
  assert.equal(status(), "");
});

test("折叠恢复保留所选语言，兼容复制保留完整代码并恢复焦点", async (t) => {
  const { window, container, requests, errors } = await mountSnippets(t);
  const python = Array.from(container.querySelectorAll('[role="tab"]')).find((tab) => tab.textContent === "Python");
  python.click();
  await waitFor(() => container.querySelector('[role="tabpanel"]')?.textContent.includes("import requests"), "Python 页签未生效");
  const selectedCode = container.querySelector('[role="tabpanel"] pre').textContent;
  const collapse = button(container, "收起请求代码");
  const regionId = collapse.getAttribute("aria-controls");
  collapse.click();
  await waitFor(() => !window.document.getElementById(regionId), "代码区未折叠");
  const expand = button(container, "展开请求代码");
  assert.equal(expand.getAttribute("aria-expanded"), "false");
  expand.click();
  await waitFor(() => window.document.getElementById(regionId), "代码区未恢复");
  assert.equal(container.querySelector('[role="tab"][aria-selected="true"]').textContent, "Python");
  let copied;
  Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async () => { throw new Error("权限受限"); } } });
  window.document.execCommand = (command) => { assert.equal(command, "copy"); copied = window.document.querySelector('textarea[aria-hidden="true"]').value; return true; };
  const copy = container.querySelector('[aria-label="复制请求代码"]');
  copy.focus();
  copy.click();
  await waitFor(() => container.querySelector('[role="status"]').textContent.includes("已复制"), "未播报复制成功");
  assert.equal(copied, selectedCode);
  assert.equal(window.document.activeElement, copy);
  assert.equal(window.document.querySelector('textarea[aria-hidden="true"]'), null);
  assert.equal(requests.length, 1);
  assert.deepEqual(errors, []);
});

test("标准剪贴板复制成功及完全拒绝时均向键盘读者播报结果", async (t) => {
  const { window, container } = await mountSnippets(t);
  const clipboard = { writeText: async (text) => { clipboard.copied = text; } };
  Object.defineProperty(window.navigator, "clipboard", { value: clipboard, configurable: true });
  const copy = container.querySelector('[aria-label="复制请求代码"]');
  copy.click();
  await waitFor(() => container.querySelector('[role="status"]').textContent.includes("已复制"), "标准复制未成功");
  assert.equal(clipboard.copied, container.querySelector('[role="tabpanel"] pre').textContent);
  Object.defineProperty(window.navigator, "clipboard", { value: undefined });
  copy.click();
  await waitFor(() => container.querySelector('[role="status"]').textContent.includes("复制失败"), "复制失败未播报");
  assert.equal(window.document.querySelector('textarea[aria-hidden="true"]'), null);
});

test("未提供可用代码语言时不生成失效页签", async (t) => {
  const { container, errors } = await mountSnippets(t, { languages: ["unavailable"] });
  assert.equal(container.querySelector('[role="tablist"][aria-label="请求示例语言"]'), null);
  assert.deepEqual(errors, []);
});
