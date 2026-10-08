"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadApiReference, MAX_TOTAL_SPEC_BYTES, MAX_SPEC_FILES, MAX_SPEC_DEPTH, MAX_SPEC_NODES } = require("../openapi");

function baseSpec(version = "3.0.3") {
  return { openapi: version, info: { title: "测试 API", version: "1.0.0" }, paths: { "/items": { get: { responses: { "200": { description: "成功" } } } } } };
}

async function fixture(t, files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-openapi-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    const file = path.join(root, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof value === "string" ? value : JSON.stringify(value));
  }
  return root;
}

test("OpenAPI 3.0 和 3.1 使用真实校验器并返回可序列化合同", async (t) => {
  const root = await fixture(t, { "spec/api.json": baseSpec(), "spec/new.json": baseSpec("3.1.0") });
  for (const file of ["api.json", "new.json"]) {
    const result = await loadApiReference(root, "guides/api.md", `../spec/${file}`);
    assert.equal(result.title, "测试 API");
    assert.equal(result.sourcePath, `spec/${file}`);
    assert.equal(result.spec.info.version, "1.0.0");
    assert.equal(result.dependencies.length, 1);
    assert.doesNotThrow(() => JSON.stringify(result));
  }
});

test("本地 YAML 相对引用与循环 schema 打包为内部引用", async (t) => {
  const spec = baseSpec();
  spec.components = { schemas: { Node: { $ref: "./models/node.yaml" } } };
  const root = await fixture(t, {
    "api/root.json": spec,
    "api/models/node.yaml": "type: object\nproperties:\n  name:\n    type: string\n  next:\n    $ref: '#/'\n"
  });
  await fs.writeFile(path.join(root, "api/models/node.yaml"), "type: object\nproperties:\n  name:\n    type: string\n  next:\n    $ref: '#'\n");
  const result = await loadApiReference(root, "README.md", "/api/root.json");
  assert.equal(result.dependencies.length, 2);
  const encoded = JSON.stringify(result.spec);
  assert.match(encoded, /\$ref/);
  assert.doesNotMatch(encoded, /docskit:|node\.yaml/);
});

test("缺失必填字段、错误 schema 和损坏 YAML 会拒绝发布", async (t) => {
  const invalid = baseSpec();
  delete invalid.info.title;
  const schema = baseSpec();
  schema.components = { schemas: { Item: { type: "object", required: "id" } } };
  const root = await fixture(t, { "missing.json": invalid, "schema.json": schema, "broken.yaml": "openapi: [broken" });
  for (const file of ["missing.json", "schema.json", "broken.yaml"]) {
    await assert.rejects(loadApiReference(root, "README.md", file), /校验|解析|schema|title|required/i);
  }
});

test("远程及绝对文件引用在任何读取前被拒绝", async (t) => {
  const root = await fixture(t, { "api.json": baseSpec() });
  t.mock.method(globalThis, "fetch", () => { throw new Error("禁止外网请求"); });
  for (const reference of ["https://invalid.example/api.yaml", "file:///etc/passwd", "C:\\secret.json", "//remote/api.json", "../outside.json"]) {
    await assert.rejects(loadApiReference(root, "README.md", reference), /不允许|无效|越界/);
  }
  const spec = baseSpec();
  spec.components = { schemas: { Leak: { $ref: "https://invalid.example/schema.json" } } };
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(spec));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /https:\/\/invalid\.example\/schema\.json/);
});

test("隐藏文件、配置文件、目录逃逸、坏编码和缺失引用不能读取", async (t) => {
  const spec = baseSpec();
  const root = await fixture(t, { "api.json": spec, "docs.config.json": spec, ".private.json": spec });
  for (const reference of ["docs.config.json", ".private.json", "%2e%2e/secret.json", "%ZZ.json", "spec.txt", "absent.json"]) {
    await assert.rejects(loadApiReference(root, "README.md", reference));
  }
  spec.components = { schemas: { Missing: { $ref: "absent.yaml" } } };
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(spec));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /absent\.yaml/);
});

test("累计文件大小与文件数量预算限制引用图", async (t) => {
  const root = await fixture(t, { "large.json": baseSpec(), "api.json": baseSpec() });
  const large = await fs.open(path.join(root, "large.json"), "r+");
  await large.truncate(MAX_TOTAL_SPEC_BYTES + 1);
  await large.close();
  await assert.rejects(loadApiReference(root, "README.md", "large.json"), /字节|大小/);
  const spec = baseSpec();
  spec.components = { schemas: {} };
  for (let index = 0; index < MAX_SPEC_FILES; index += 1) {
    const name = `schema-${index}.json`;
    await fs.writeFile(path.join(root, name), JSON.stringify({ type: "string" }));
    spec.components.schemas[`Schema${index}`] = { $ref: name };
  }
  await fs.writeFile(path.join(root, "api.json"), JSON.stringify(spec));
  await assert.rejects(loadApiReference(root, "README.md", "api.json"), /文件数量/);
});

test("JSON 指针缺失和不支持的协议版本给出可定位错误", async (t) => {
  const spec = baseSpec();
  spec.components = { schemas: { Missing: { $ref: "#/components/schemas/Absent" } } };
  const root = await fixture(t, { "missing.json": spec, "old.json": { swagger: "2.0", info: { title: "旧协议", version: "1" }, paths: {} } });
  await assert.rejects(loadApiReference(root, "README.md", "missing.json"), /Absent|校验/);
  await assert.rejects(loadApiReference(root, "README.md", "old.json"), /3\.0.*3\.1/);
});

test("嵌套、节点和 YAML 循环预算阻止解析器资源失控", async (t) => {
  const nested = baseSpec();
  let cursor = nested;
  for (let index = 0; index <= MAX_SPEC_DEPTH; index += 1) cursor = cursor.child = {};
  const wide = baseSpec();
  wide["x-values"] = Array(MAX_SPEC_NODES).fill(1);
  const root = await fixture(t, {
    "nested.json": nested, "wide.json": wide,
    "loop.yaml": "openapi: 3.1.0\ninfo: &loop\n  title: 测试\n  version: '1'\n  child: *loop\npaths: {}\n"
  });
  await assert.rejects(loadApiReference(root, "README.md", "nested.json"), /深度/);
  await assert.rejects(loadApiReference(root, "README.md", "wide.json"), /节点/);
  await assert.rejects(loadApiReference(root, "README.md", "loop.yaml"), /循环/);
});

test("相同文件多次引用只计一次预算且不会改变调用方文档", async (t) => {
  const spec = baseSpec();
  spec.components = { schemas: { First: { $ref: "./schema.json" }, Second: { $ref: "schema.json" } } };
  const root = await fixture(t, { "api.json": spec, "schema.json": { type: "string" } });
  const result = await loadApiReference(root, "README.md", "api.json");
  assert.deepEqual(result.dependencies.map((item) => item.path).sort(), ["api.json", "schema.json"]);
  assert.match(await fs.readFile(path.join(root, "api.json"), "utf8"), /\.\/schema\.json/);
  for (const reference of ["%252e%252e/secret.json", "nested/.secret.json", "node_modules/schema.json", "api.json?secret", "api.json#fragment"]) {
    await assert.rejects(loadApiReference(root, "README.md", reference));
  }
});

test("OpenAPI 3.1 支持独立文件中的布尔 schema", async (t) => {
  const spec = baseSpec("3.1.0");
  spec.components = { schemas: { Anything: { $ref: "anything.json" }, Nothing: { $ref: "nothing.yaml" } } };
  const root = await fixture(t, { "api.json": spec, "anything.json": "true", "nothing.yaml": "false" });
  const result = await loadApiReference(root, "README.md", "api.json");
  assert.equal(result.spec.components.schemas.Anything, true);
  assert.equal(result.spec.components.schemas.Nothing, false);
});

test("目录符号链接不能作为引用路径或文档根目录", async (t) => {
  const root = await fixture(t, { "real/api.json": baseSpec() });
  const alias = path.join(root, "alias");
  await fs.symlink(path.join(root, "real"), alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(loadApiReference(root, "README.md", "alias/api.json"), /alias\/api.json/);
  await assert.rejects(loadApiReference(alias, "README.md", "api.json"), /符号链接/);
});
