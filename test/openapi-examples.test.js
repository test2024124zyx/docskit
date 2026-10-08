"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadApiReference, MAX_SPEC_FILES, MAX_TOTAL_SPEC_BYTES, MAX_SPEC_DEPTH, MAX_SPEC_NODES } = require("../openapi");

function contract(example) {
  return { openapi: "3.1.0", info: { title: "示例安全", version: "1" }, paths: { "/items": { get: { responses: { "200": { description: "成功", content: { "application/json": { examples: { demo: example } } } } } } } } };
}

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-example-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, data] of Object.entries(files)) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof data === "string" ? data : JSON.stringify(data));
  }
  return root;
}

function responseExample(result) { return result.spec.paths["/items"].get.responses["200"].content["application/json"].examples.demo; }

test("本地外部示例在发布前内联，组件及引用文件使用各自来源路径", async (t) => {
  const spec = contract({ $ref: "examples/demo.yaml" });
  spec.components = { examples: { Inline: { externalValue: "payload.json" } } };
  const root = await fixture(t, {
    "api.json": spec, "payload.json": [1, 2],
    "examples/demo.yaml": "summary: 本地示例\nexternalValue: data.yaml\n", "examples/data.yaml": "items:\n  - id: 7\n"
  });
  const result = await loadApiReference(root, "README.md", "api.json");
  assert.deepEqual(responseExample(result).value, { items: [{ id: 7 }] });
  assert.deepEqual(result.spec.components.examples.Inline.value, [1, 2]);
  assert.doesNotMatch(JSON.stringify(result.spec), /externalValue/);
  assert.deepEqual(result.dependencies.map((item) => item.path).sort(), ["api.json", "examples/data.yaml", "examples/demo.yaml", "payload.json"]);
});

test("远程、同源接口、隐藏和越界示例不能触发文件或网络读取", async (t) => {
  const root = await fixture(t, { "api.json": contract({ externalValue: "blocked.json" }), ".secret.json": { secret: true } });
  const readFile = fs.readFile.bind(fs);
  const reads = [];
  t.mock.method(fs, "readFile", async (file, ...args) => { reads.push(path.relative(root, file)); return readFile(file, ...args); });
  t.mock.method(globalThis, "fetch", () => { throw new Error("不允许网络读取"); });
  for (const value of ["https://remote.example/data.json", "//remote.example/data.json", "/api/private", ".secret.json", "../outside.json", "%2e%2e/outside.json", "file:///secret.json"]) {
    reads.length = 0;
    await fs.writeFile(path.join(root, "api.json"), JSON.stringify(contract({ externalValue: value })));
    await assert.rejects(loadApiReference(root, "README.md", "api.json"), /externalValue.*内联 value/);
    assert.deepEqual(reads, ["api.json"]);
  }
});

test("schema 与示例数据中的同名普通字段完整保留且不会解析引用", async (t) => {
  const payload = { externalValue: "https://example.org/private", examples: { nested: { externalValue: "https://example.org/second" } }, $ref: "https://example.org/data" };
  const spec = contract({ value: payload });
  spec.components = { schemas: { Data: { type: "object", properties: { externalValue: { type: "string" }, examples: { type: "object" } }, example: payload, examples: [payload], default: payload } } };
  const root = await fixture(t, { "api.json": spec, "data.json": payload });
  const first = await loadApiReference(root, "README.md", "api.json");
  assert.deepEqual(responseExample(first).value, payload);
  assert.deepEqual(first.spec.components.schemas.Data.example, payload);
  assert.deepEqual(first.spec.components.schemas.Data.examples, [payload]);
  assert.deepEqual(first.spec.components.schemas.Data.default, payload);
  assert.equal(first.dependencies.length, 1);
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(contract({ externalValue: "data.json" })));
  assert.deepEqual(responseExample(await loadApiReference(root, "README.md", "api.json")).value, payload);
});

test("参数、请求、响应头、回调与组件中的 Example Object 都会处理", async (t) => {
  const example = () => ({ externalValue: "data.json" });
  const spec = contract(example());
  spec.paths["/items"].parameters = [{ name: "q", in: "query", schema: { type: "string" }, examples: { q: example() } }];
  spec.paths["/items"].get.responses["200"].headers = { Result: { schema: { type: "string" }, examples: { header: example() } } };
  spec.paths["/items"].post = { requestBody: { content: { "application/json": { examples: { body: example() } } } }, responses: { "200": { description: "成功" } }, callbacks: { updated: { "{$request.body#/callback}": { post: { requestBody: { content: { "application/json": { examples: { callback: example() } } } }, responses: { "204": { description: "成功" } } } } } } };
  spec.components = { parameters: { Saved: { name: "saved", in: "query", schema: { type: "string" }, examples: { saved: example() } } }, headers: { Saved: { schema: { type: "string" }, examples: { saved: example() } } } };
  const root = await fixture(t, { "api.json": spec, "data.json": '"本地内容"' });
  const result = await loadApiReference(root, "README.md", "api.json");
  assert.doesNotMatch(JSON.stringify(result.spec), /externalValue/);
  assert.equal((JSON.stringify(result.spec).match(/本地内容/g) || []).length, 7);
  assert.equal(result.dependencies.length, 2);
});

test("外部示例受同一文件、字节、节点和深度预算约束", async (t) => {
  const root = await fixture(t, { "api.json": contract({ externalValue: "data.json" }), "data.json": {} });
  const large = await fs.open(path.join(root, "data.json"), "r+");
  await large.truncate(MAX_TOTAL_SPEC_BYTES + 1);
  await large.close();
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /字节|大小/);
  await fs.writeFile(path.join(root, "data.json"), JSON.stringify(Array(MAX_SPEC_NODES).fill(1)));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /节点/);
  const deep = {};
  let cursor = deep;
  for (let index = 0; index < MAX_SPEC_DEPTH; index += 1) cursor = cursor.child = {};
  await fs.writeFile(path.join(root, "data.json"), JSON.stringify(deep));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /深度/);
  const spec = contract({ value: 0 });
  spec.components = { examples: {} };
  for (let index = 0; index < MAX_SPEC_FILES; index += 1) {
    const name = `data-${index}.json`;
    await fs.writeFile(path.join(root, name), "null");
    spec.components.examples[`Data${index}`] = { externalValue: name };
  }
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(spec));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /文件数量/);
});

test("真实 Swagger 读取内联示例、未知 format 和 schema 声明时不自动发送网络请求", async (t) => {
  const SwaggerClient = require("swagger-client");
  const spec = contract({ externalValue: "data.json" });
  spec.components = { schemas: { RemoteFormat: { type: "string", format: "https://example.org/format", $schema: "https://example.org/schema" } } };
  const payload = { externalValue: "https://example.org/payload" };
  const root = await fixture(t, { "api.json": spec, "data.json": payload });
  const result = await loadApiReference(root, "README.md", "api.json");
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => { calls.push(String(url)); throw new Error("组件不允许自动联网"); });
  const resolved = await SwaggerClient.resolve({ spec: result.spec, baseDoc: "https://docs.test/manual/api.html", requestInterceptor: (request) => { calls.push(request.url); throw new Error("组件不允许自动联网"); } });
  assert.deepEqual(resolved.errors, []);
  assert.deepEqual(responseExample(resolved).value, payload);
  assert.deepEqual(calls, []);
});

test("符号目录外部示例在打开目标文件前拒绝，双重取值定义也拒绝发布", async (t) => {
  const root = await fixture(t, { "api.json": contract({ externalValue: "alias/data.json" }), "real/data.json": { secret: true } });
  await fs.symlink(path.join(root, "real"), path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
  const readFile = fs.readFile.bind(fs);
  const reads = [];
  t.mock.method(fs, "readFile", async (file, ...args) => { reads.push(path.relative(root, file)); return readFile(file, ...args); });
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /externalValue.*内联 value/);
  assert.deepEqual(reads, ["api.json"]);
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(contract({ value: null, externalValue: "real/data.json" })));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /不能同时设置/);
});
