"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createServer, mergeConfig } = require("../server");

test("应用和 vendor 代码每次使用前重新验证，发布更新后相同 URL 返回新内容", { timeout: 10000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "docskit-resource-cache-"));
  const codeResources = [
    ["/script.js", "script.js"],
    ["/client-api.js", "client-api.js"],
    ["/styles.css", "styles.css"],
    ["/vendor/highlight.min.js", "dist/vendor/highlight.min.js"],
    ["/vendor/scalar.js", "node_modules/@scalar/api-reference/dist/browser/standalone.js"],
    ["/vendor/katex/katex.min.css", "node_modules/katex/dist/katex.min.css"]
  ];
  const config = mergeConfig({});
  const server = createServer({ rootDir: root, loadConfig: async () => ({ config, docsDir: root }) });
  try {
    for (const [, relative] of codeResources) {
      const file = path.join(root, relative);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, "第一版代码");
    }
    await fs.mkdir(path.join(root, "node_modules/katex/dist/fonts"), { recursive: true });
    await fs.writeFile(path.join(root, "node_modules/katex/dist/fonts/example.woff2"), "字体内容");
    await fs.writeFile(path.join(root, "logo.png"), "图片内容");
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const [url, relative] of codeResources) {
      const initial = await fetch(`${origin}${url}`);
      assert.equal(initial.status, 200, url);
      assert.equal(initial.headers.get("cache-control"), "no-cache, must-revalidate", url);
      assert.equal(await initial.text(), "第一版代码");
      const etag = initial.headers.get("etag");
      assert.ok(etag, url);
      const unchanged = await fetch(`${origin}${url}`, { headers: { "If-None-Match": etag } });
      assert.equal(unchanged.status, 304, url);
      assert.equal(unchanged.headers.get("cache-control"), "no-cache, must-revalidate", url);
      assert.equal(await unchanged.text(), "");
      await fs.writeFile(path.join(root, relative), "第二版代码，包含新功能");
      const updated = await fetch(`${origin}${url}`, { headers: { "If-None-Match": etag } });
      assert.equal(updated.status, 200, url);
      assert.notEqual(updated.headers.get("etag"), etag, url);
      assert.equal(updated.headers.get("cache-control"), "no-cache, must-revalidate", url);
      assert.equal(await updated.text(), "第二版代码，包含新功能");
    }
    const font = await fetch(`${origin}/vendor/katex/fonts/example.woff2`);
    assert.equal(font.headers.get("cache-control"), "public, max-age=3600, must-revalidate");
    await font.text();
    const image = await fetch(`${origin}/api/asset?path=logo.png`);
    assert.equal(image.headers.get("cache-control"), "public, max-age=300, must-revalidate");
    await image.text();
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
