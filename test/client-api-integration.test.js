"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const SwaggerClient = require("swagger-client");
const api = require("../client-api");
const { createSwaggerWindow, waitFor, button } = require("./helpers/swagger");

test("真实 Swagger 配置使用内存合同，禁用远程校验、URL配置覆盖和认证保存", async (t) => {
  const { window, container, errors, networkRequests } = createSwaggerWindow(t);
  const spec = { openapi: "3.1.0", info: { title: "安全配置", version: "1" }, paths: {} };
  const config = api.createConfiguration({ spec, connectSources: [] }, { window });
  const ui = window.SwaggerUIBundle({ ...config, domNode: container, syntaxHighlight: { activated: false } });
  await waitFor(() => container.textContent.includes("安全配置"), "Swagger 未加载内存合同");
  const normalized = ui.getConfigs();
  // 真实浏览器 bundle 创建另一 JS realm 的对象，比较完整 JSON 合同而非对象原型。
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.spec)), spec);
  assert.equal(normalized.validatorUrl, null);
  assert.equal(normalized.persistAuthorization, false);
  assert.equal(normalized.queryConfigEnabled, false);
  assert.equal(normalized.deepLinking, false);
  assert.equal(normalized.requestSnippetsEnabled, true);
  assert.equal(normalized.requestInterceptor, config.requestInterceptor);
  assert.deepEqual(networkRequests, []);
  assert.deepEqual(errors, []);
});

test("真实 Swagger UI 主动发送保留认证头及示例请求体，五种代码页签采用实际请求", async (t) => {
  const { window, container, errors } = createSwaggerWindow(t);
  const calls = [];
  window.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init.method, headers: new Headers(init.headers), body: init.body, credentials: init.credentials, redirect: init.redirect });
    return new Response('{"created":true}', { headers: { "Content-Type": "application/json" } });
  };
  const payload = { $ref: "https://docs.test/payload.json", label: "请求原文" };
  const spec = { openapi: "3.1.0", info: { title: "真实试调", version: "1" }, servers: [{ url: "./v1" }], security: [{ bearer: [] }], components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } }, paths: {
    "/items": { post: { operationId: "createItem", requestBody: { required: true, content: { "application/json": { schema: { type: "object" }, example: payload } } }, responses: { "200": { description: "成功" } } } }
  } };
  const config = api.createConfiguration({ spec, connectSources: [] }, { window });
  const ui = window.SwaggerUIBundle({ ...config, domNode: container, docExpansion: "full", syntaxHighlight: { activated: false } });
  await waitFor(() => button(container, "Try it out"), "Swagger 未显示调试入口");
  assert.deepEqual(calls, []);
  ui.preauthorizeApiKey("bearer", "test-token");
  button(container, "Try it out").click();
  await waitFor(() => button(container, "Execute"), "Swagger 未启用发送操作");
  button(container, "Execute").click();
  await waitFor(() => container.textContent.includes('"created": true'), "Swagger 未显示真实响应");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://docs.test/manual/v1/items");
  assert.equal(calls[0].method.toUpperCase(), "POST");
  assert.equal(calls[0].headers.get("Authorization"), "Bearer test-token");
  assert.deepEqual(JSON.parse(calls[0].body), payload);
  assert.equal(calls[0].credentials, "omit");
  assert.equal(calls[0].redirect, "error");
  assert.ok(container.textContent.includes("cURL (bash)"));
  assert.ok(container.textContent.includes("cURL (PowerShell)"));
  assert.ok(container.textContent.includes("cURL (CMD)"));
  assert.ok(container.textContent.includes("https://docs.test/manual/v1/items"));
  assert.ok(container.textContent.includes("Authorization: Bearer test-token"));
  const snippets = container.querySelector(".request-snippets");
  for (const [language, marker] of [["JavaScript (Node.js)", "const response = await fetch"], ["Python", "import requests"]]) {
    const tab = Array.from(snippets.querySelectorAll(".btn")).find((node) => node.textContent.trim() === language);
    assert.ok(tab, `未提供 ${language} 代码页签`);
    tab.click();
    await waitFor(() => snippets.querySelector("pre")?.textContent.includes(marker), `${language} 代码未显示`);
    const code = snippets.querySelector("pre").textContent;
    assert.ok(code.includes(calls[0].url));
    assert.ok(code.includes("Bearer test-token"));
    assert.ok(code.includes("https://docs.test/payload.json"));
    assert.ok(code.includes("$ref"));
    assert.ok(code.includes("请求原文"));
  }
  assert.equal(calls.length, 1, "切换代码页签不应发送请求");
  assert.deepEqual(errors, []);
});

test("Swagger 规范及外部引用加载在实际 HTTP 管线到达网络前拒绝", async (t) => {
  const { window, networkRequests } = createSwaggerWindow(t);
  const config = api.createConfiguration({ spec: {}, connectSources: ["https://api.test"] }, { window });
  assert.equal(typeof config.requestInterceptor, "function");
  for (const url of ["https://docs.test/private.json", "https://api.test/openapi.json"]) {
    await assert.rejects(SwaggerClient.http({ url, loadSpec: true, requestInterceptor: config.requestInterceptor }), /规范|引用|自动/);
  }
  await assert.rejects(SwaggerClient.http({ url: "https://undeclared.test/token", method: "POST", requestInterceptor: config.requestInterceptor }), /未声明/);
  assert.deepEqual(networkRequests, []);
});

test("Swagger 真实 HTTP 管线在响应头前及正文读取期间均可取消，取消后释放控制器", async (t) => {
  for (const afterHeaders of [false, true]) {
    const { window } = createSwaggerWindow(t);
    const controllers = new Set();
    let requestSignal;
    let canceledBody = false;
    window.fetch = (input, init) => {
      requestSignal = init.signal;
      if (afterHeaders) return Promise.resolve(new Response(new ReadableStream({ cancel() { canceledBody = true; } }), { headers: { "Content-Type": "text/plain" } }));
      return new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("底层请求取消")), { once: true }));
    };
    const config = api.createConfiguration({ spec: {}, connectSources: [] }, { window, controllers });
    assert.equal(typeof config.requestInterceptor, "function");
    const pending = SwaggerClient.http({ url: "https://docs.test/slow", method: "GET", requestInterceptor: config.requestInterceptor });
    const rejection = assert.rejects(pending, (error) => /取消|abort/i.test(error.responseError?.message || error.message));
    await waitFor(() => requestSignal && controllers.size === 1, "请求未进入受控生命周期");
    // 真实页面切换使用同一组控制器；等一轮微任务，确保正文测试已经开始消费流。
    await new Promise((resolve) => setImmediate(resolve));
    for (const controller of controllers) controller.abort();
    await rejection;
    assert.equal(requestSignal.aborted, true);
    assert.equal(controllers.size, 0);
    assert.equal(canceledBody, afterHeaders);
    window.close();
  }
});
