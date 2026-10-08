"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const api = require("../client-api");
const renderer = require("../client-api-renderer");
const reference = { connectSources: ["https://api.docs.test"], spec: { openapi: "3.1.0", info: { title: "查询接口", version: "1" }, servers: [{ url: "https://api.docs.test" }], paths: {} } };

function fixture(t, cold = false) {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/manual/" }).window;
  const container = window.document.querySelector("#api");
  const state = { mounted: 0, unmounted: 0, configuration: null };
  const factory = (configuration) => { state.configuration = configuration; return {}; };
  t.mock.method(renderer, "create", () => ({ plugin() { return {}; }, async mount() { state.mounted += 1; container.textContent = "接口已就绪"; }, unmount() { state.unmounted += 1; } }));
  if (!cold) {
    window.SwaggerUIBundle = factory;
    const style = window.document.createElement("link");
    style.dataset.docskitSwaggerStyle = "true";
    style.dataset.loaded = "true";
    window.document.head.append(style);
  }
  const load = () => {
    window.SwaggerUIBundle = factory;
    window.document.querySelector('script[data-docskit-swagger]')?.onload();
    window.document.querySelector('link[data-docskit-swagger-style]')?.onload();
  };
  t.after(() => { api.unmount(); window.close(); });
  return { window, container, state, factory, load };
}

test("内存合同保持原文，认证回调与静态部署基址一致", (t) => {
  const { window } = fixture(t);
  const config = api.createConfiguration(reference, { window, base: "/manual/" });
  assert.deepEqual(config.spec, reference.spec);
  assert.notEqual(config.spec, reference.spec);
  assert.equal(config.oauth2RedirectUrl, "https://docs.test/manual/vendor/oauth2-redirect.html");
  for (const key of ["persistAuthorization", "queryConfigEnabled", "deepLinking", "withCredentials"]) assert.equal(config[key], false);
  assert.equal(config.validatorUrl, null);
});

test("主动请求保留认证头，拒绝隐式Cookie、重定向和非法来源", async (t) => {
  const { window } = fixture(t);
  const calls = [];
  window.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true }; };
  const config = api.createConfiguration(reference, { window });
  assert.equal(calls.length, 0);
  await config.customFetch("https://api.docs.test/users", { method: "GET", credentials: "include", headers: { Authorization: "Bearer test-token" } });
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
  await config.customFetch("/api/search");
  for (const [url, error] of [["file:///private", /HTTP/], ["https://user:password@api.docs.test/users", /用户名/], ["https://api.docs.test.evil.test/", /未声明/]]) await assert.rejects(config.customFetch(url), error);
  assert.equal(calls.length, 2);
  await assert.rejects(api.createConfiguration({ spec: reference.spec }, { window }).customFetch("https://api.docs.test/"), /未声明/);
});

test("离开页面正式卸载视图、取消请求，并拒绝迟到的发送动作", async (t) => {
  const { window, container, state } = fixture(t);
  window.fetch = (input, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("底层已取消")), { once: true }));
  await api.mount(container, reference);
  const rejected = assert.rejects(state.configuration.customFetch("https://api.docs.test/users"), /取消/);
  api.unmount();
  await rejected;
  assert.equal(state.unmounted, 1);
  assert.equal(container.childElementCount, 0);
  await assert.rejects(state.configuration.customFetch("https://api.docs.test/users"), /页面已关闭/);
});

test("样式和脚本全部就绪才挂载，切换主题不重建表单", async (t) => {
  const { window, container, state, factory } = fixture(t, true);
  const pending = api.mount(container, reference, { base: "/manual/", theme: "light" });
  const script = window.document.querySelector('script[data-docskit-swagger]');
  assert.equal(script.getAttribute("src"), "/manual/vendor/swagger-ui-bundle.js");
  api.updateTheme("dark");
  window.SwaggerUIBundle = factory;
  script.onload();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.mounted, 0);
  window.document.querySelector('link[data-docskit-swagger-style]').onload();
  await pending;
  assert.equal(window.document.documentElement.classList.contains("dark-mode"), true);
  const input = window.document.createElement("input");
  input.value = "未发送的参数";
  container.append(input);
  api.updateTheme("light");
  assert.equal(window.document.documentElement.classList.contains("dark-mode"), false);
  assert.equal(input.value, "未发送的参数");
  assert.equal(state.mounted, 1);
});

test("脚本和样式失败都能重试，迟到加载不会重挂已经离开的文档", async (t) => {
  for (const resource of ["script[data-docskit-swagger]", "link[data-docskit-swagger-style]"]) {
    const { window, container, state, load } = fixture(t, true);
    const pending = api.mount(container, reference, { theme: "light" });
    window.document.querySelector(resource).onerror();
    await pending;
    assert.match(container.textContent, /重新加载/);
    api.updateTheme("dark");
    container.querySelector("button").click();
    load();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.mounted, 1);
    assert.equal(window.document.documentElement.classList.contains("dark-mode"), true);
    api.unmount();
    window.close();
  }
  const { container, state, load } = fixture(t, true);
  const late = api.mount(container, reference);
  api.unmount();
  load();
  await late;
  assert.equal(state.mounted, 0);
});

test("组件初始化失败可恢复，库加载超时给出明确信息", async (t) => {
  const { window, container, factory } = fixture(t);
  window.SwaggerUIBundle = () => { throw new Error("规范展示失败"); };
  await api.mount(container, reference);
  assert.match(container.textContent, /规范展示失败/);
  window.SwaggerUIBundle = factory;
  container.querySelector("button").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.textContent, "接口已就绪");
  assert.equal(container.hasAttribute("aria-busy"), false);
  api.unmount();
  const cold = fixture(t, true);
  let timeout;
  cold.window.setTimeout = (callback) => { timeout = callback; return 1; };
  const pending = api.mount(cold.container, reference);
  timeout();
  await pending;
  assert.match(cold.container.textContent, /加载超时/);
});

test("网络错误、调用方取消及超时都提供可操作错误并释放控制器", async (t) => {
  const { window } = fixture(t);
  const controllers = new Set();
  const config = api.createConfiguration(reference, { window, controllers });
  window.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(config.customFetch("https://api.docs.test/users"), /跨域/);
  const aborted = new window.AbortController();
  aborted.abort();
  await assert.rejects(config.customFetch("https://api.docs.test/users", { signal: aborted.signal }), /取消/);
  window.fetch = (input, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("底层取消")), { once: true }));
  const controller = new window.AbortController();
  const rejection = assert.rejects(config.customFetch("https://api.docs.test/", { signal: controller.signal }), /取消/);
  controller.abort();
  await rejection;
  let timeout;
  window.setTimeout = (callback) => { timeout = callback; return 1; };
  const timedOut = assert.rejects(config.customFetch("https://api.docs.test/"), /30 秒/);
  timeout();
  await timedOut;
  assert.equal(controllers.size, 0);
});
