"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");
const vue = require("vue");
const api = require("../client-api");

const dependencyPath = (file) => path.join(__dirname, "..", "node_modules", "@scalar", file);
const reference = { connectSources: ["https://api.docs.test"], spec: { openapi: "3.1.0", info: { title: "接口", version: "1" }, paths: {} } };
const sendRequestPromise = import(pathToFileURL(dependencyPath("api-client/dist/v2/blocks/operation-block/helpers/send-request.js")).href).then((module) => module.sendRequest);

function scalarLifecycle(window) {
  // 直接执行锁定依赖的生命周期实现；跳过整棵界面依赖，只创建未挂载的真实 Vue 实例。
  const source = fs.readFileSync(dependencyPath("api-reference/dist/standalone/lib/html-api.js"), "utf8")
    .replace(/^import .+;\r?$/gm, "").replace(/^export .+;\r?$/gm, "");
  const context = vm.createContext({ ...vue, document: window.document, HTMLStyleElement: window.HTMLStyleElement, AbortController: window.AbortController, ApiReference_default: {}, createHead: () => ({ install() {} }), console });
  vm.runInContext(source, context);
  return context.createApiReference;
}

test("主题切换遵循Scalar实际全量替换契约并保留规范和请求保护", async () => {
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  const create = scalarLifecycle(window);
  let instance;
  window.Scalar = { createApiReference(container, configuration) { instance = create(configuration); return instance; } };
  try {
    await api.mount(window.document.querySelector("#api"), reference);
    const originalFetch = instance.getConfiguration().customFetch;
    api.updateTheme("dark");
    const configuration = instance.getConfiguration();
    assert.deepEqual(await (await configuration.customFetch(configuration.url)).json(), reference.spec);
    assert.equal(configuration.customFetch, originalFetch);
    assert.equal(configuration.darkMode, true);
    assert.equal(configuration.persistAuth, false);
    assert.equal(configuration.telemetry, false);
    assert.equal(configuration.agent.disabled, true);
    assert.equal(configuration.proxyUrl, "");
  } finally { api.unmount(); window.close(); }
});

test("Scalar真实发送流程经过保护层且保留Request的方法请求体和认证头", async () => {
  const window = new JSDOM("", { url: "https://docs.test/" }).window;
  let captured;
  window.fetch = async (request, options) => {
    captured = { request, options, body: await request.clone().text() };
    return new Response('{"ok":true}', { headers: { "Content-Type": "application/json" } });
  };
  try {
    const configuration = api.createConfiguration(reference, { window });
    const sendRequest = await sendRequestPromise;
    const [error, result] = await sendRequest({ isUsingProxy: false, requestPayload: ["https://api.docs.test/users", { method: "POST", headers: { Authorization: "Bearer test-token", "Content-Type": "application/json" }, body: '{"name":"张三"}', credentials: "include" }], customFetch: configuration.customFetch });
    assert.equal(error, null);
    assert.equal(result.response.status, 200);
    assert.equal(result.response.data, '{"ok":true}');
    assert.equal(captured.request.url, "https://api.docs.test/users");
    assert.equal(captured.request.method, "POST");
    assert.equal(captured.request.headers.get("Authorization"), "Bearer test-token");
    assert.equal(captured.body, '{"name":"张三"}');
    assert.equal(captured.options.credentials, "omit");
    assert.equal(captured.options.redirect, "error");
  } finally { window.close(); }
});

test("实际Scalar配置归一化保留cURL默认客户端及安全开关", async () => {
  const window = new JSDOM("", { url: "https://docs.test/" }).window;
  try {
    const { apiReferenceConfigurationWithSourceSchema } = await import(pathToFileURL(dependencyPath("schemas/dist/api-reference/api-reference-configuration.js")).href);
    const original = api.createConfiguration(reference, { window });
    const normalized = apiReferenceConfigurationWithSourceSchema(original);
    assert.deepEqual(normalized.defaultHttpClient, { targetKey: "shell", clientKey: "curl" });
    assert.equal(normalized.customFetch, original.customFetch);
    assert.equal(normalized.persistAuth, false);
    assert.equal(normalized.proxyUrl, "");
    assert.equal(normalized.telemetry, false);
    assert.equal(normalized.agent.disabled, true);
  } finally { window.close(); }
});

test("Scalar已收到响应头仍读取正文时，切换文档会取消真实发送流程", async (context) => {
  const logged = [];
  context.mock.method(console, "error", (error) => logged.push(error));
  const window = new JSDOM('<div id="api"></div>', { url: "https://docs.test/" }).window;
  let configuration;
  let requestSignal;
  let finishBody;
  window.Scalar = { createApiReference(container, config) { configuration = config; return { destroy() {} }; } };
  window.fetch = async (input, options) => {
    requestSignal = options.signal;
    return new Response(new ReadableStream({ start(controller) { finishBody = () => { controller.enqueue(new TextEncoder().encode("完成")); controller.close(); }; } }), { headers: { "Content-Type": "text/plain" } });
  };
  try {
    await api.mount(window.document.querySelector("#api"), reference);
    const sendRequest = await sendRequestPromise;
    const pending = sendRequest({ isUsingProxy: false, requestPayload: ["https://api.docs.test/users", { method: "GET" }], customFetch: configuration.customFetch });
    await new Promise((resolve) => setImmediate(resolve));
    api.unmount();
    const aborted = requestSignal.aborted;
    // 旧实现取消失效时主动结束假响应，确保失败测试不会留下挂起读取。
    if (!aborted) finishBody();
    const [error, result] = await pending;
    assert.equal(aborted, true);
    assert.ok(error);
    assert.match(logged[0].message, /取消/);
    assert.equal(result, null);
  } finally { api.unmount(); window.close(); }
});
