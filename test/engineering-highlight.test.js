"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { createBundle, buildBundle } = require("../build-highlight");

test("真实高亮产物在浏览器环境执行且不包含构建机绝对路径", () => {
  const result = createBundle();
  const browser = { window: {} };
  vm.runInNewContext(result.code, browser);
  const highlighted = browser.window.hljs.highlight("const answer = 42;", { language: "javascript" });
  assert.match(highlighted.value, /hljs-keyword/);
  assert.equal(browser.window.hljs.getLanguage("go").name, "Go");
  assert.doesNotMatch(result.code, new RegExp(__dirname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(result.modules > 1);
});

test("模块按完整依赖关系解析，同名文件不串包且不同目录构建一致", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-bundle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const artifacts = [];
  for (const directory of ["first", "second"]) {
    const fixture = path.join(root, directory);
    await fs.mkdir(path.join(fixture, "one"), { recursive: true });
    await fs.mkdir(path.join(fixture, "two"), { recursive: true });
    await fs.writeFile(path.join(fixture, "common.js"), "module.exports = [require('./one/shared'), require('./two/shared')];");
    await fs.writeFile(path.join(fixture, "one", "shared.js"), "module.exports = 'first';");
    await fs.writeFile(path.join(fixture, "two", "shared.js"), "module.exports = 'second';");
    const result = createBundle(path.join(fixture, "common.js"));
    const browser = { window: {} };
    vm.runInNewContext(result.code, browser);
    assert.deepEqual(Array.from(browser.window.hljs), ["first", "second"]);
    artifacts.push(result.code);
  }
  assert.equal(artifacts[0], artifacts[1]);
});

test("缺失依赖会令构建失败，成功构建可以写入指定产物目录", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-bundle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const brokenEntry = path.join(root, "common.js");
  await fs.writeFile(brokenEntry, "module.exports = require('./missing');");
  assert.throws(() => createBundle(brokenEntry), /missing|ENOENT/);
  const outputPath = path.join(root, "vendor", "highlight.js");
  const result = buildBundle({ outputPath });
  const code = await fs.readFile(outputPath, "utf8");
  assert.equal(result.size, Buffer.byteLength(code));
  const browser = { window: {} };
  vm.runInNewContext(code, browser);
  assert.ok(browser.window.hljs.getLanguage("json"));
});
