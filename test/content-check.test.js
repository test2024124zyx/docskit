"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { checkContent, assertContentValid, parseCheckArgs } = require("../content-check");

async function fixture(t, files, config) {
  const docsDir = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-content-"));
  t.after(() => fs.rm(docsDir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(docsDir, name)), { recursive: true });
    await fs.writeFile(path.join(docsDir, name), value);
  }
  const configPath = path.join(docsDir, "docs.config.json");
  if (config !== undefined) await fs.writeFile(configPath, typeof config === "string" ? config : JSON.stringify(config));
  return { docsDir, configPath };
}

test("内容检查验证真实链接并忽略代码示例与外部链接", async (t) => {
  const options = await fixture(t, {
    "README.md": "# 首页\n\n[指南](guide/intro%20one.md#步骤)\n\n![演示](image.png)\n\n[引用][guide]\n\n[guide]: guide/intro%20one.md#步骤\n\n[外部](https://external.invalid/unreachable)\n\n```md\n[示例](absent.md)\n```\n\n`[行内示例](absent.md)`\n",
    "guide/intro one.md": "# 指南\n\n## 步骤\n\n[首页](../README.md#首页)\n",
    "image.png": Buffer.from([0, 1, 2]),
    "draft.md": "---\nhidden: true\n---\n[未完成](missing.md)\n"
  });
  t.mock.method(globalThis, "fetch", () => { throw new Error("内容检查不应请求外网"); });
  const result = await checkContent(options);
  assert.deepEqual(result.errors, []);
  assert.equal(result.documents, 2);
  assert.doesNotThrow(() => assertContentValid(result));
});

test("丢失文档、资源及本页和跨页锚点都有源文件行号", async (t) => {
  const options = await fixture(t, {
    "README.md": "---\ntitle: 首页\n---\n# 首页\n\n[丢失文档](absent.md)\n![丢失图片](absent.png)\n[跨页锚点](guide.md#不存在)\n[本页锚点](#不存在)\n",
    "guide.md": "# 指南\n"
  });
  const result = await checkContent(options);
  assert.deepEqual(result.errors.map((item) => item.line).sort((a, b) => a - b), [6, 7, 8, 9]);
  assert.ok(result.errors.every((item) => item.file === path.join(options.docsDir, "README.md")));
  assert.throws(() => assertContentValid(result), /README\.md:6/);
});

test("front matter 语法和字段类型严格校验，未知字段给出可追踪提示", async (t) => {
  const options = await fixture(t, {
    "bad-yaml.md": "---\ntitle: [broken\n---\n# 正文\n",
    "bad-type.md": "---\ntitle: 123\nhidden: yes\norder: wrong\n---\n# 正文\n",
    "unclosed.md": "---\ntitle: missing-end\n# 正文\n",
    "future.md": "---\ncustomField: metadata\n---\n# 正文\n"
  });
  const result = await checkContent(options);
  assert.ok(result.errors.some((item) => item.code === "front-matter-syntax"));
  assert.equal(result.errors.filter((item) => item.code === "front-matter-type").length, 3);
  assert.ok(result.errors.some((item) => item.code === "front-matter-unclosed"));
  assert.ok(result.warnings.some((item) => item.code === "front-matter-unknown"));
});

test("损坏 JSON 和错误配置类型不能悄悄回退通过检查", async (t) => {
  const options = await fixture(t, { "README.md": "# 首页\n" }, "{\n  \"site\":\n}");
  const invalidJson = await checkContent(options);
  assert.ok(invalidJson.errors.some((item) => item.code === "config-json"));
  await fs.writeFile(options.configPath, JSON.stringify({ topbar: { search: "true" }, markdown: { code: { copy: 1 } }, home: "missing.md" }));
  const wrongTypes = await checkContent(options);
  assert.equal(wrongTypes.errors.filter((item) => item.code === "config-type").length, 2);
  assert.ok(wrongTypes.errors.some((item) => item.code === "config-document"));
});

test("目录逃逸、隐藏文档和不允许公开的资源被准确拒绝", async (t) => {
  const options = await fixture(t, {
    "README.md": "# 首页\n\n[越界](../secret.md)\n[隐藏](draft.md)\n[配置](docs.config.json)\n",
    "draft.md": "---\nhidden: true\n---\n# 草稿\n"
  }, {});
  const result = await checkContent(options);
  assert.ok(result.errors.some((item) => item.code === "link-invalid"));
  assert.ok(result.errors.some((item) => item.code === "document-missing"));
  assert.ok(result.errors.some((item) => item.code === "asset-invalid"));
});

test("导航和站点资源使用同一内容检查合同", async (t) => {
  const options = await fixture(t, { "README.md": "# 首页\n" }, {
    site: { logo: "missing.png" }, topbar: { links: [{ label: "失效导航", path: "missing.md" }] }
  });
  const result = await checkContent(options);
  assert.ok(result.errors.some((item) => item.code === "config-asset"));
  assert.ok(result.errors.some((item) => item.code === "config-document"));
});

test("内容检查命令行拒绝未知参数及缺失值", () => {
  assert.deepEqual(parseCheckArgs(["--docs", "custom", "--config=site.json"]), { docsDir: "custom", configPath: "site.json" });
  assert.deepEqual(parseCheckArgs(["--help"]), { help: true });
  assert.throws(() => parseCheckArgs(["--docs"]), /缺少/);
  assert.throws(() => parseCheckArgs(["--unknown"]), /未知/);
});

test("内容检查与发布使用同一 API 服务器来源规则", async (t) => {
  const contract = { openapi: "3.0.3", info: { title: "接口", version: "1" }, paths: {}, servers: [{ url: "ftp://api.test" }] };
  const options = await fixture(t, {
    "api.md": "---\nopenapi: contract.json\n---\n# 接口\n",
    "contract.json": JSON.stringify(contract)
  });
  const invalid = await checkContent(options);
  assert.ok(invalid.errors.some((item) => item.code === "openapi-invalid" && /HTTP\(S\)/.test(item.message)));
  contract.servers = [{ url: "https://api.test/v1" }, { url: "./v1" }];
  await fs.writeFile(path.join(options.docsDir, "contract.json"), JSON.stringify(contract));
  assert.deepEqual((await checkContent(options)).errors, []);
});

test("内容检查拒绝多个 API 合同累计超过站点来源上限", async (t) => {
  const files = {};
  for (let index = 0; index < 2; index += 1) {
    files[`api-${index}.md`] = `---\nopenapi: contract-${index}.json\n---\n# 接口\n`;
    files[`contract-${index}.json`] = JSON.stringify({
      openapi: "3.0.3", info: { title: "接口", version: "1" }, paths: {},
      servers: Array.from({ length: 65 }, (_, item) => ({ url: `https://api-${index}-${item}.test` }))
    });
  }
  const options = await fixture(t, files);
  assert.ok((await checkContent(options)).errors.some((item) => /来源超过上限/.test(item.message)));
});
