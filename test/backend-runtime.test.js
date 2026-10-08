"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { Writable } = require("node:stream");
const { ByteBudgetCache } = require("../server-cache");
const { createDocumentIndexStore, preferredDocument } = require("../server-index");
const { normalizeSiteUrl, documentPageUrl, trustedSiteOrigin } = require("../server-seo");
const { mergeConfig, readConfigFile, configFileStatus } = require("../server-config");
const { sendFile } = require("../server-assets");

async function withFixture(callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-backend-"));
  try { await callback(directory); }
  finally { await fs.rm(directory, { recursive: true, force: true }); }
}

function memoryResponse() {
  const chunks = [];
  const response = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
  response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; };
  response.body = () => Buffer.concat(chunks).toString();
  return response;
}

test("按字节限制缓存、淘汰最久未读项目并拒绝超大条目", () => {
  const cache = new ByteBudgetCache(6, 3);
  cache.set("a", "甲", 3);
  cache.set("b", "乙", 3);
  assert.equal(cache.get("a"), "甲");
  cache.set("c", "丙", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.bytes, 6);
  cache.set("a", "超大值", 7);
  assert.equal(cache.get("a"), undefined);
  cache.setBudget(2);
  assert.equal(cache.size, 0);
  cache.set("d", "d", 1);
  cache.clear();
  assert.equal(cache.bytes, 0);
  assert.throws(() => new ByteBudgetCache(0), /预算/);
});

test("可信地址忽略任意 Host，并为每个文档生成独立 HTTPS 地址", () => {
  const config = { site: { url: "https://docs.example.org/" } };
  assert.equal(normalizeSiteUrl("https://docs.example.org/docs"), "https://docs.example.org/docs/");
  assert.equal(trustedSiteOrigin(config, new URL("http://untrusted.example/")), "https://docs.example.org/");
  assert.equal(documentPageUrl(config, "guide/a.md"), "https://docs.example.org/?doc=guide%2Fa.md");
  assert.notEqual(documentPageUrl(config, "a.md"), documentPageUrl(config, "b.md"));
  assert.equal(trustedSiteOrigin({}, new URL("http://untrusted.example/")), "");
  assert.equal(trustedSiteOrigin({}, new URL("http://127.0.0.1:3000/")), "http://127.0.0.1:3000/");
  for (const value of ["javascript:alert(1)", "https://u:p@example.org/", "https://example.org/?x=1", "https://example.org/#part"]) {
    assert.throws(() => normalizeSiteUrl(value), /站点地址/);
  }
});

test("显式首页及根目录概览优先，错误配置不会静默切换首页", () => {
  const documents = [{ path: "guides/index.md" }, { path: "README.md" }, { path: "index.md" }];
  assert.equal(preferredDocument(documents).path, "index.md");
  assert.equal(preferredDocument(documents.slice(0, 2)).path, "README.md");
  assert.equal(preferredDocument(documents, { home: "guides/index.md" }).path, "guides/index.md");
  assert.throws(() => preferredDocument(documents, { home: "missing.md" }), /首页文档不存在/);
  assert.equal(preferredDocument([]), undefined);
});

test("配置变更只有完整且合法才替换，损坏、缺失和无效地址保留上一版", async () => {
  await withFixture(async (root) => {
    const file = path.join(root, "docs.config.json");
    await fs.writeFile(file, JSON.stringify({ docsDir: "published", site: { url: "https://docs.example.org/" } }));
    const published = await readConfigFile(file);
    for (const content of ["{", "[]", '{"site":{"url":"javascript:alert(1)"}}', '{"docsDir":123}', '{"docsDir":" "}']) {
      await fs.writeFile(file, content);
      assert.deepEqual(await readConfigFile(file), published);
      assert.equal(configFileStatus(file).status, "degraded");
    }
    await fs.unlink(file);
    assert.deepEqual(await readConfigFile(file), published);
    await fs.writeFile(file, '{"docsDir":"next"}');
    assert.equal((await readConfigFile(file)).docsDir, "next");
    assert.equal(configFileStatus(file).status, "ready");
    const missing = path.join(root, "missing.json");
    assert.deepEqual(await readConfigFile(missing), {});
    await fs.writeFile(missing, "{");
    assert.deepEqual(await readConfigFile(missing), {});
    const invalid = path.join(root, "invalid.json");
    await fs.writeFile(invalid, "{");
    await assert.rejects(() => readConfigFile(invalid), /配置/);
  });
  assert.throws(() => mergeConfig({ limits: { indexBytes: -1 } }), /预算/);
  assert.throws(() => mergeConfig({ home: "../outside.md" }), /首页/);
});

test("索引失败保留最近发布版本，退避合并重试，并在修复后恢复", async () => {
  let now = 100;
  let attempts = 0;
  let fail = false;
  const store = createDocumentIndexStore({
    now: () => now,
    retryDelayMs: 1000,
    pollIntervalMs: 100,
    watch: () => ({ on() {}, close() {} }),
    scan: async () => {
      attempts++;
      if (fail) throw Object.assign(new Error("文档数量超限"), { statusCode: 422, publicMessage: "文档数量超限" });
      return { documents: [{ path: `${attempts}.md` }], directories: new Set(["/docs"]), directoryMetadata: new Map(), filesystemSignature: String(attempts) };
    },
    signature: async () => "changed"
  });
  const first = await store.getDocumentIndex("/docs");
  fail = true;
  store.markDocumentIndexDirty(store.states.get(path.resolve("/docs")));
  const results = await Promise.all([store.getDocumentIndex("/docs"), store.getDocumentIndex("/docs")]);
  assert.equal(attempts, 2);
  assert.equal(results[0].documents, first.documents);
  assert.equal(results[0].health.status, "degraded");
  assert.equal(results[0].health.error.code, 422);
  await store.getDocumentIndex("/docs");
  assert.equal(attempts, 2);
  now += 1001;
  fail = false;
  const recovered = await store.getDocumentIndex("/docs");
  assert.equal(recovered.health.status, "ready");
  assert.equal(recovered.documents[0].path, "3.md");
  store.closeDocumentIndexWatchers();
  assert.equal(store.states.size, 0);
});

test("首次索引错误明确失败，退避期间复用错误而不重复扫描", async () => {
  let attempts = 0;
  const store = createDocumentIndexStore({ scan: async () => { attempts++; throw new Error("磁盘不可读"); } });
  await assert.rejects(() => store.getDocumentIndex("/missing"), /磁盘不可读/);
  await assert.rejects(() => store.getDocumentIndex("/missing"), /磁盘不可读/);
  assert.equal(attempts, 1);
  store.closeDocumentIndexWatchers();
});

test("If-Range 只在强校验值或有效修改日期匹配时返回分片", async () => {
  await withFixture(async (root) => {
    const file = path.join(root, "example.txt");
    await fs.writeFile(file, "0123456789");
    const initial = memoryResponse();
    await sendFile(initial, file);
    const etag = initial.headers.ETag;
    const modified = initial.headers["Last-Modified"];
    for (const [ifRange, expectedStatus, expectedBody] of [
      [etag, 206, "2345"], [modified, 206, "2345"], ['"old"', 200, "0123456789"],
      [`W/${etag}`, 200, "0123456789"], ["invalid", 200, "0123456789"],
      ["Wed, 01 Jan 2020 00:00:00 GMT", 200, "0123456789"]
    ]) {
      const response = memoryResponse();
      await sendFile(response, file, { request: { method: "GET", headers: { range: "bytes=2-5", "if-range": ifRange } } });
      assert.equal(response.statusCode, expectedStatus, ifRange);
      assert.equal(response.body(), expectedBody, ifRange);
    }
  });
});

module.exports = { memoryResponse };
