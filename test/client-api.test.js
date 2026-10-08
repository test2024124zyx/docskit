"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const api = require("../client-api");

const reference = { title: "查询接口", connectSources: ["https://api.docs.test"], spec: { openapi: "3.1.0", info: { title: "查询接口", version: "1" }, servers: [{ url: "https://api.docs.test" }], paths: {} } };

test("API组件只使用本地传入规范，禁用代理、遥测、外部AI及凭据保存", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  const config = api.createConfiguration(reference, { window, theme: "dark" });
  assert.equal(config.content, undefined);
  assert.equal(new URL(config.url).origin, window.location.origin);
  assert.deepEqual(await (await config.customFetch(config.url, { headers: undefined })).json(), reference.spec);
  assert.equal(config.persistAuth, false);
  assert.equal(config.telemetry, false);
  assert.equal(config.agent.disabled, true);
  assert.equal(config.mcp.disabled, true);
  assert.equal(config.proxyUrl, "");
  assert.equal(config.withDefaultFonts, false);
  assert.equal(config.localization.locale, "zh-CN");
  assert.equal(config.darkMode, true);
  assert.deepEqual(config.defaultHttpClient, { targetKey: "shell", clientKey: "curl" });
  window.close();
});

test("请求由调用动作触发，默认不带浏览器凭据，拒绝非HTTP地址和跳转", async () => {
  const window = new JSDOM("", { url: "https://docs.test/" }).window;
  const calls = [];
  window.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true }; };
  const config = api.createConfiguration(reference, { window });
  assert.equal(calls.length, 0);
  await config.customFetch("https://api.docs.test/users", { method: "GET", credentials: "include", headers: { Authorization: "Bearer test-token" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.credentials, "omit");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-token");
  await assert.rejects(() => config.customFetch("file:///private"), /HTTP/);
  await assert.rejects(() => config.customFetch("https://user:password@api.docs.test/users"), /用户名/);
  window.close();
});

test("切换文档销毁API实例并取消仍在进行的请求", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  let configuration;
  let destroyed = false;
  window.Scalar = { createApiReference(container, config) { configuration = config; return { destroy() { destroyed = true; } }; } };
  window.fetch = (input, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(Object.assign(new Error("请求已取消"), { name: "AbortError" })), { once: true }));
  await api.mount(window.document.querySelector("#api"), reference);
  const request = configuration.customFetch("https://api.docs.test/users");
  const rejected = assert.rejects(request, /取消/);
  api.unmount();
  await rejected;
  assert.equal(destroyed, true);
  window.close();
});

test("组件加载失败显示重试，页面切换后迟到的加载不会挂载旧API", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/manual/" }).window;
  const container = window.document.querySelector("#api");
  const mounting = api.mount(container, reference, { base: "/manual/" });
  const script = window.document.querySelector('script[data-docskit-scalar]');
  assert.equal(script.getAttribute("src"), "/manual/vendor/scalar.js");
  script.onerror();
  await mounting;
  assert.match(container.textContent, /重新加载/);
  const retry = api.mount(container, reference, { base: "/manual/" });
  let mounted = false;
  window.Scalar = { createApiReference() { mounted = true; return { destroy() {} }; } };
  const pending = window.document.querySelector('script[data-docskit-scalar]');
  api.unmount();
  pending.onload();
  await retry;
  assert.equal(mounted, false);
  window.close();
});

test("API网络错误提供可行动的信息，调用方取消立即生效", async () => {
  const window = new JSDOM("", { url: "https://docs.test/" }).window;
  window.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const config = api.createConfiguration(reference, { window });
  await assert.rejects(() => config.customFetch("https://api.docs.test/users"), /跨域/);
  const controller = new window.AbortController();
  controller.abort();
  await assert.rejects(() => config.customFetch("https://api.docs.test/users", { signal: controller.signal }), /取消/);
  window.close();
});

test("主题更新保留组件实例，主动取消和超时都会中止底层请求", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  const updates = [];
  window.Scalar = { createApiReference() { return { updateConfiguration(config) { updates.push(config); }, destroy() {} }; } };
  await api.mount(window.document.querySelector("#api"), reference);
  api.updateTheme("dark");
  assert.equal(window.document.body.classList.contains("dark-mode"), true);
  api.updateTheme("light");
  assert.equal(window.document.body.classList.contains("light-mode"), true);
  assert.deepEqual(updates.map((config) => config.darkMode), [true, false]);
  assert.equal(updates[1].url, updates[0].url);
  assert.deepEqual(await (await updates[1].customFetch(updates[1].url)).json(), reference.spec);
  assert.equal(updates[1].persistAuth, false);
  assert.equal(typeof updates[1].customFetch, "function");
  window.fetch = (input, options) => new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("底层取消")), { once: true }));
  const config = api.createConfiguration(reference, { window });
  const controller = new window.AbortController();
  const canceled = config.customFetch("https://api.docs.test/", { signal: controller.signal });
  const rejection = assert.rejects(canceled, /取消/);
  controller.abort();
  await rejection;
  let timeout;
  window.setTimeout = (callback) => { timeout = callback; return 1; };
  const pending = config.customFetch("https://api.docs.test/");
  const timedOut = assert.rejects(pending, /30 秒/);
  timeout();
  await timedOut;
  api.unmount();
  assert.equal(window.document.body.classList.contains("light-mode"), false);
  api.updateTheme("dark");
  window.close();
});

test("API初始化失败可以通过重试按钮恢复", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  const container = window.document.querySelector("#api");
  window.Scalar = { createApiReference() { throw new Error("规范展示失败"); } };
  await api.mount(container, reference);
  assert.match(container.textContent, /规范展示失败/);
  window.Scalar.createApiReference = () => { container.textContent = "已恢复"; return { destroy() {} }; };
  container.querySelector("button").click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(container.textContent, "已恢复");
  assert.equal(container.hasAttribute("aria-busy"), false);
  api.unmount();
  window.close();
});

test("在线调试仅允许当前站点和已验证合同声明的来源", async () => {
  const window = new JSDOM("", { url: "https://docs.test/manual/" }).window;
  const calls = [];
  window.fetch = async (input) => { calls.push(input); return { ok: true }; };
  const config = api.createConfiguration(reference, { window });
  await config.customFetch("/api/search");
  await assert.rejects(() => config.customFetch("https://undeclared.test/"), /未声明/);
  await assert.rejects(() => config.customFetch("https://api.docs.test.evil.test/"), /未声明/);
  assert.equal(calls.length, 1);
  const legacy = api.createConfiguration({ spec: reference.spec }, { window });
  await assert.rejects(() => legacy.customFetch("https://api.docs.test/"), /未声明/);
  window.close();
});

test("库冷加载和加载失败后重试都采用读者最近选择的主题", async (t) => {
  for (const failFirst of [false, true]) {
    const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
    const container = window.document.querySelector("#api");
    t.after(() => { api.unmount(); window.close(); });
    const pending = api.mount(container, reference, { theme: "light" });
    api.updateTheme("dark");
    let script = window.document.querySelector('script[data-docskit-scalar]');
    if (failFirst) {
      script.onerror();
      await pending;
      api.updateTheme("light");
      api.updateTheme("dark");
      container.querySelector("button").click();
      script = window.document.querySelector('script[data-docskit-scalar]');
    }
    let initial;
    window.Scalar = { createApiReference(element, config) { initial = config; return { destroy() {} }; } };
    script.onload();
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(initial.darkMode, true);
    assert.equal(window.document.body.classList.contains("dark-mode"), true);
    assert.equal(window.document.body.classList.contains("light-mode"), false);
    api.unmount();
    window.close();
  }
});
