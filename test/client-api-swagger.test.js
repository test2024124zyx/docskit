"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const SwaggerClient = require("swagger-client");
const { createConfiguration } = require("../client-api");
const { createSwaggerWindow, waitFor } = require("./helpers/swagger");

test("真实 Swagger UI 在 OpenAPI 3.0 和 3.1 中完整展示普通 payload 引用且不自动联网", async (t) => {
  for (const openapi of ["3.0.3", "3.1.0"]) {
    const { window, container, errors, networkRequests } = createSwaggerWindow(t);
    const payload = { $ref: "https://docs.test/private.json", externalValue: "https://docs.test/example.json", label: "必须保留", nested: [{ $ref: "#/not-a-reference", other: 7 }] };
    const spec = { openapi, info: { title: "完整示例", version: "1" }, paths: { "/items": { get: { responses: { "200": { description: "成功", content: { "application/json": { examples: { demo: { $ref: "#/components/examples/Demo" } } } } } } } } }, components: { examples: { Demo: { value: payload } } } };
    const original = JSON.stringify(spec);
    const config = createConfiguration({ spec, connectSources: [] }, { window });
    window.SwaggerUIBundle({ ...config, domNode: container, docExpansion: "full", syntaxHighlight: { activated: false } });
    await waitFor(() => container.textContent.includes("必须保留"), `${openapi} 未完整渲染示例`);
    assert.ok(container.textContent.includes("https://docs.test/private.json"));
    assert.ok(container.textContent.includes("externalValue"));
    assert.ok(container.textContent.includes("#/not-a-reference"));
    assert.ok(container.textContent.includes('"other": 7'));
    assert.equal(JSON.stringify(spec), original);
    assert.deepEqual(networkRequests, []);
    assert.deepEqual(errors, []);
    window.close();
  }
});

test("真实 Swagger 请求构建遵循服务器层级、相对路径和变量 default/enum", () => {
  const contextUrl = "http://192.0.2.10/manual/api.html?doc=reference#operation";
  const response = { responses: { "204": { description: "成功" } } };
  const spec = { openapi: "3.1.0", info: { title: "服务器", version: "1" }, servers: [{ url: "/" }], paths: {
    "/root": { get: { operationId: "root", ...response } },
    "/items": { servers: [{ url: "../{version}", variables: { version: { default: "v1", enum: ["v1", "v2"] } } }], get: { operationId: "read", ...response }, post: { operationId: "write", servers: [{ url: "./write" }], ...response } },
    "/remote": { get: { operationId: "remote", servers: [{ url: "{scheme}://api.test/{version}", variables: { scheme: { default: "https", enum: ["http", "https"] }, version: { default: "v1", enum: ["v1", "v2"] } } }], ...response } },
    "/variable": { get: { operationId: "variable", servers: [{ url: "{base}", variables: { base: { default: "./v1", enum: ["./v1", "../service", "https://api.test/v2"] } } }], ...response } }
  } };
  const original = JSON.stringify(spec);
  const request = (operationId, serverVariables) => SwaggerClient.buildRequest({ spec, contextUrl, operationId, serverVariables });
  assert.equal(request("root").url, "http://192.0.2.10/root");
  assert.equal(request("read").url, "http://192.0.2.10/v1/items");
  assert.equal(request("read", { version: "v2" }).url, "http://192.0.2.10/v2/items");
  assert.equal(request("write").url, "http://192.0.2.10/manual/write/items");
  assert.equal(request("remote").url, "https://api.test/v1/remote");
  assert.equal(request("remote", { scheme: "http", version: "v2" }).url, "http://api.test/v2/remote");
  for (const value of spec.paths["/variable"].get.servers[0].variables.base.enum) {
    assert.equal(request("variable", { base: value }).url, `${new URL(value, contextUrl).href}/variable`);
  }
  assert.equal(JSON.stringify(spec), original);
});

test("局域网 HTTP 无 randomUUID 时保留当前页面作为规范解析基址", async (t) => {
  const { window } = createSwaggerWindow(t, "http://192.0.2.10/manual/api.html?doc=reference#operation");
  Object.defineProperty(window.crypto, "randomUUID", { value: undefined });
  const spec = { openapi: "3.1.0", info: { title: "本地合同", version: "1" }, servers: [{ url: "./v1" }], paths: { "/items": { get: { operationId: "items", responses: { "204": { description: "成功" } } } } } };
  const config = createConfiguration({ spec }, { window });
  assert.equal(new URL(config.url).pathname, "/manual/api.html");
  assert.deepEqual(config.spec, spec);
  assert.equal(SwaggerClient.buildRequest({ spec: config.spec, contextUrl: config.url, operationId: "items" }).url, "http://192.0.2.10/manual/v1/items");
});
