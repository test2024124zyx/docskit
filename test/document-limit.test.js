"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { MAX_DOCUMENT_COUNT, mergeConfig } = require("../server-config");
const { scanDocuments, scanFilesystemSignature, createTree } = require("../server");

test("默认上限为 1000 篇，扫描和导航树接受上限并拒绝第 1001 篇", { timeout: 30000 }, async () => {
  assert.equal(MAX_DOCUMENT_COUNT, 1000);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-limit-"));
  try {
    // 分批写入，避免测试本身同时打开过多文件；两种 Markdown 扩展名合计计数。
    for (let start = 0; start < MAX_DOCUMENT_COUNT; start += 50) {
      await Promise.all(Array.from({ length: Math.min(50, MAX_DOCUMENT_COUNT - start) }, (_, offset) => {
        const index = start + offset;
        const extension = index % 2 === 0 ? "md" : "markdown";
        return fs.writeFile(path.join(root, `doc-${index}.${extension}`), `# 文档 ${index}\n`, "utf8");
      }));
    }
    const { documents, directoryMetadata } = await scanDocuments(root);
    const config = mergeConfig({});
    assert.equal(documents.length, 1000);
    assert.equal(createTree(documents, config, directoryMetadata).length, 1000);
    assert.ok(await scanFilesystemSignature(root));

    await fs.writeFile(path.join(root, "overflow.md"), "# 超限文档\n", "utf8");
    const isLimitError = (error) => error.statusCode === 422 && /Markdown 文档数量超过上限 1000 篇/.test(error.message);
    await assert.rejects(() => scanDocuments(root), isLimitError);
    await assert.rejects(() => scanFilesystemSignature(root), isLimitError);
    assert.throws(() => createTree([
      ...documents,
      { ...documents[0], path: "overflow.md" }
    ], config, directoryMetadata), isLimitError);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
