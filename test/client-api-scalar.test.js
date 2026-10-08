"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");
const { createConfiguration } = require("../client-api");

test("真实 Scalar 使用内存合同加载器，普通 payload 引用被阻止且原文保留", async (t) => {
  const { createWorkspaceStore } = await import("@scalar/workspace-store/client");
  const { getRaw } = await import("@scalar/json-magic/magic-proxy");
  const window = new JSDOM("", { url: "https://docs.test/manual/" }).window;
  t.after(() => window.close());
  const payload = { $ref: "https://docs.test/private.json", externalValue: "https://docs.test/example.json", label: "必须保留" };
  const spec = { openapi: "3.1.0", info: { title: "完整示例", version: "1" }, paths: { "/items": { get: { responses: { "200": { description: "成功", content: { "application/json": { examples: { demo: { value: payload } } } } } } } } } };
  const reference = { spec, connectSources: [] };
  const calls = [];
  window.fetch = async (input) => { calls.push(String(input)); throw new Error("不能访问真实网络"); };
  t.mock.method(globalThis, "fetch", window.fetch);
  const config = createConfiguration(reference, { window });
  const second = createConfiguration(reference, { window });
  assert.notEqual(config.url, second.url);
  const store = createWorkspaceStore();
  await store.addDocument({ name: "docs", url: config.url, fetch: config.customFetch });
  assert.deepEqual(calls, []);
  assert.deepEqual(reference.spec, spec);
  const displayed = getRaw(store.workspace.documents.docs).paths["/items"].get.responses["200"].content["application/json"].examples.demo.value;
  assert.deepEqual(JSON.parse(JSON.stringify(displayed)), payload);
});

test("自动元数据读取被拒绝，Request 与显式 method 的读者请求仍可发送", async (t) => {
  const window = new JSDOM("", { url: "https://docs.test/" }).window;
  t.after(() => window.close());
  const calls = [];
  window.fetch = async (input, init) => { calls.push({ input, init }); return { ok: true }; };
  const config = createConfiguration({ spec: {}, connectSources: ["https://api.test"] }, { window });
  await assert.rejects(config.customFetch("https://docs.test/private.json", { headers: undefined }), /自动读取/);
  await assert.rejects(config.customFetch("https://api.test/example.json", { headers: { Authorization: "不应发送" } }), /自动读取/);
  assert.equal(calls.length, 0);
  await config.customFetch(new Request("https://api.test/items"));
  await config.customFetch("https://api.test/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.init.credentials === "omit" && call.init.redirect === "error"));
});

test("局域网 HTTP 无 randomUUID 也能加载合同，相对 servers 保持当前页面基址", async (t) => {
  const { getServers, requestFactory, buildRequest } = await import("@scalar/workspace-store/request-example");
  const window = new JSDOM("", { url: "http://192.0.2.10/manual/api.html?doc=reference#operation" }).window;
  t.after(() => window.close());
  Object.defineProperty(window.crypto, "randomUUID", { value: undefined });
  const spec = { openapi: "3.1.0", info: { title: "本地合同", version: "1" }, servers: [{ url: "./v1" }, { url: "../service" }], paths: {} };
  const config = createConfiguration({ spec }, { window });
  const url = new URL(config.url);
  assert.equal(url.pathname, "/manual/api.html");
  assert.equal(url.hash, "");
  assert.equal(url.searchParams.get("doc"), "reference");
  const display = await (await config.customFetch(config.url)).json();
  const servers = getServers(display.servers, { documentUrl: config.url });
  assert.deepEqual(servers.map((server) => server.url), ["http://192.0.2.10/manual/v1", "http://192.0.2.10/service"]);
  for (const server of servers) {
    const { request } = requestFactory({ server, operation: {}, path: "/items", method: "get", globalCookies: [], selectedSecuritySchemes: [], defaultHeaders: {} });
    const built = buildRequest(request, { envVariables: {}, allowMissingRequestServerBase: false });
    assert.equal(built.ok, true);
    assert.equal(built.data.requestPayload[0], `${server.url}/items`);
  }
  assert.deepEqual(spec.servers, [{ url: "./v1" }, { url: "../service" }]);
});

test("展示副本只归一化实际 servers，保留变量、层级优先级和原始合同", async (t) => {
  const { requestFactory, buildRequest } = await import("@scalar/workspace-store/request-example");
  const window = new JSDOM("", { url: "https://docs.test/manual/api.html" }).window;
  t.after(() => window.close());
  const variables = { version: { default: "v1", enum: ["v1", "v2"] } };
  const payload = { servers: [{ url: "./payload" }] };
  const spec = { openapi: "3.1.0", info: { title: "服务器", version: "1" }, servers: [{ url: "/" }], paths: {
    "/items": { servers: [{ url: "../{version}", variables }], get: { responses: { "200": { description: "成功", content: { "application/json": { example: payload } } } } }, post: { servers: [{ url: "./write" }], responses: { "204": { description: "成功" } } } },
    "/remote": { get: { servers: [{ url: "{scheme}://api.test/{version}", variables: { scheme: { default: "https", enum: ["http", "https"] }, ...variables } }], responses: { "204": { description: "成功" } } } }
  } };
  const original = JSON.stringify(spec);
  const config = createConfiguration({ spec }, { window });
  const display = await (await config.customFetch(config.url)).json();
  assert.equal(display.servers[0].url, "https://docs.test/");
  assert.equal(display.paths["/items"].get.servers[0].url, "https://docs.test/{version}");
  assert.equal(display.paths["/items"].post.servers[0].url, "https://docs.test/manual/write");
  assert.equal(display.paths["/remote"].get.servers[0].url, "{scheme}://api.test/{version}");
  assert.deepEqual(display.paths["/items"].get.responses["200"].content["application/json"].example, payload);
  const server = display.paths["/items"].get.servers[0];
  assert.deepEqual(server.variables, variables);
  for (const version of server.variables.version.enum) {
    server.variables.version.default = version;
    const { request } = requestFactory({ server, operation: {}, path: "/items", method: "get", globalCookies: [], selectedSecuritySchemes: [], defaultHeaders: {} });
    const built = buildRequest(request, { envVariables: {}, allowMissingRequestServerBase: false });
    assert.equal(built.data.requestPayload[0], `https://docs.test/${version}/items`);
  }
  assert.equal(JSON.stringify(spec), original);
});

test("实际 Scalar 发送前钩子以页面基址解析服务器变量的 default 和 enum", async (t) => {
  const { requestFactory, buildRequest } = await import("@scalar/workspace-store/request-example");
  const { ref, effectScope } = await import("vue");
  const { mapConfigPlugins } = await import(pathToFileURL(path.join(__dirname, "../node_modules/@scalar/api-reference/dist/helpers/map-config-plugins.js")).href);
  const window = new JSDOM("", { url: "https://docs.test/manual/api.html" }).window;
  const scope = effectScope();
  t.after(() => { scope.stop(); window.close(); });
  const server = { url: "{base}", variables: { base: { default: "./v1", enum: ["./v1", "../service", "/root", "https://api.test/v2"] } } };
  const spec = { openapi: "3.1.0", info: { title: "变量", version: "1" }, servers: [server], paths: {} };
  const config = createConfiguration({ spec }, { window });
  const [plugin] = scope.run(() => mapConfigPlugins(ref(config), ref({ variables: [] })));
  const display = await (await config.customFetch(config.url)).json();
  for (const value of server.variables.base.enum) {
    display.servers[0].variables.base.default = value;
    const { request } = requestFactory({ server: display.servers[0], operation: {}, path: "/items", method: "get", globalCookies: [], selectedSecuritySchemes: [], defaultHeaders: {} });
    await plugin.hooks.beforeRequest({ requestBuilder: request });
    const built = buildRequest(request, { envVariables: {}, allowMissingRequestServerBase: false });
    assert.equal(built.ok, true);
    assert.equal(built.data.requestPayload[0], `${new URL(value, window.location.href).href}/items`);
  }
  assert.equal(server.variables.base.default, "./v1");
});

test("展示副本遍历内部路径引用和回调，普通业务 payload 不被当作服务器定义", async (t) => {
  const window = new JSDOM("", { url: "https://docs.test/manual/api.html" }).window;
  t.after(() => window.close());
  const spec = { openapi: "3.1.0", info: { title: "引用路径", version: "1" }, paths: { "/shared": { $ref: "#/components/pathItems/A~1B" } }, components: {
    pathItems: { "A/B": { servers: [{ url: "./shared" }], get: { responses: { "204": { description: "成功" } }, callbacks: { saved: { $ref: "#/components/callbacks/Saved" } } } } },
    callbacks: { Saved: { "{$request.body#/callback}": { servers: [{ url: "../callback" }], post: { responses: { "204": { description: "成功" } } } } } }
  } };
  const config = createConfiguration({ spec }, { window });
  const display = await (await config.customFetch(config.url)).json();
  assert.equal(display.components.pathItems["A/B"].get.servers[0].url, "https://docs.test/manual/shared");
  assert.equal(display.components.callbacks.Saved["{$request.body#/callback}"].post.servers[0].url, "https://docs.test/callback");
  assert.equal(spec.components.pathItems["A/B"].servers[0].url, "./shared");
});
