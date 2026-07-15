const assert = require("node:assert/strict");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const fsp = fs.promises;
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PROJECT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(PROJECT_DIR, "server.js");

function getIconNames() {
  const source = fs.readFileSync(path.join(PROJECT_DIR, "script.js"), "utf8");
  const iconBlock = source.match(/const ICON_PATHS = \{([\s\S]*?)\n  \};/);
  if (!iconBlock) throw new Error("无法读取前端图标注册表");
  return [...iconBlock[1].matchAll(/^    (?:"([^"]+)"|([A-Za-z][\w-]*)):/gm)].map((match) => match[1] || match[2]);
}

const ICON_NAMES = new Set(getIconNames());

async function getFreePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  const port = address.port;
  listener.close();
  await once(listener, "close");
  return port;
}

async function createFixture(options = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "docs-kit-test-"));
  const docsDir = path.join(root, "docs");
  const guideDir = path.join(docsDir, "guide");
  await fsp.mkdir(guideDir, { recursive: true });
  await fsp.writeFile(path.join(docsDir, "README.md"), "# 测试首页\n\n这是首页内容。\n", "utf8");
  await fsp.writeFile(path.join(guideDir, "intro.md"), "---\ntitle: 指南入口\ndescription: 指南摘要\norder: 1\n---\n\n# 指南入口\n\n这里包含正文搜索词。\n", "utf8");
  if (options.config !== undefined) {
    const content = typeof options.config === "string" ? options.config : JSON.stringify(options.config, null, 2);
    await fsp.writeFile(path.join(docsDir, "docs.config.json"), content, "utf8");
  }
  return { root, docsDir, configPath: path.join(docsDir, "docs.config.json") };
}

async function requestJson(baseUrl, pathname) {
  const response = await fetch(`${baseUrl}${pathname}`);
  const payload = await response.json();
  assert.equal(response.ok, true, `${pathname} 返回 ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function waitForServer(child, baseUrl) {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/healthz`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError || new Error("等待文档服务启动超时");
}

async function waitFor(check, message) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(message);
}

async function withServer(options, callback) {
  const fixture = await createFixture(options);
  const port = await getFreePort();
  const child = spawn(process.execPath, [SERVER_PATH, "--docs", fixture.docsDir, "--port", String(port)], {
    cwd: PROJECT_DIR,
    env: { ...process.env, HOST: "127.0.0.1" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs += chunk.toString(); });
  child.stderr.on("data", (chunk) => { logs += chunk.toString(); });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForServer(child, baseUrl);
    return await callback({ fixture, baseUrl });
  } catch (error) {
    error.message = `${error.message}\n${logs}`;
    throw error;
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 500))]);
    }
    await fsp.rm(fixture.root, { recursive: true, force: true });
  }
}

function flattenTree(nodes) {
  return nodes.flatMap((node) => node.type === "directory" ? [node, ...flattenTree(node.children || [])] : [node]);
}

test("健康检查不依赖配置文件和文档目录", async () => {
  await withServer({ config: "{ invalid" }, async ({ baseUrl }) => {
    const response = await fetch(`${baseUrl}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "docs-kit" });
  });
});

test("缺少配置时使用默认导航和稳定内置图标", async () => {
  await withServer({}, async ({ baseUrl }) => {
    const payload = await requestJson(baseUrl, "/api/bootstrap");
    assert.equal(payload.defaultPath, "README.md");
    assert.deepEqual(payload.config.topbar.links, []);
    assert.equal(payload.config.topbar.version, "");
    assert.ok(flattenTree(payload.tree).every((node) => ICON_NAMES.has(node.icon)));
    assert.equal(flattenTree(payload.tree).some((node) => node.path === "docs.config.json"), false);
  });
});

test("README 和配置文档列出全部内置图标", async () => {
  assert.equal(ICON_NAMES.size, 62);
  const documents = await Promise.all([
    fsp.readFile(path.join(PROJECT_DIR, "README.md"), "utf8"),
    fsp.readFile(path.join(PROJECT_DIR, "docs", "api", "configuration.md"), "utf8")
  ]);
  ICON_NAMES.forEach((name) => documents.forEach((document) => assert.equal(document.includes(`\`${name}\``), true, `文档缺少图标 ${name}`)));
});

test("配置、全文搜索和并发请求正常工作", async () => {
  await withServer({
    config: {
      site: { title: "测试站点" },
      topbar: { links: [{ label: "指南", path: "guide/intro.md", icon: "rocket" }] },
      sidebar: { icons: { guide: "blocks", "guide/intro.md": "pencil-line" } }
    }
  }, async ({ baseUrl }) => {
    const payloads = await Promise.all(Array.from({ length: 12 }, () => requestJson(baseUrl, "/api/bootstrap")));
    assert.equal(payloads.length, 12);
    assert.equal(payloads[0].config.site.title, "测试站点");
    assert.equal(payloads[0].config.topbar.links[0].label, "指南");
    const guide = flattenTree(payloads[0].tree).find((node) => node.path === "guide");
    const intro = flattenTree(payloads[0].tree).find((node) => node.path === "guide/intro.md");
    assert.equal(guide.icon, "blocks");
    assert.equal(intro.icon, "pencil-line");

    const search = await requestJson(baseUrl, `/api/search?q=${encodeURIComponent("正文搜索词")}`);
    assert.deepEqual(search.results.map((result) => result.path), ["guide/intro.md"]);
    const document = await requestJson(baseUrl, `/api/document?path=${encodeURIComponent("guide/intro.md")}`);
    assert.match(document.html, /这里包含正文搜索词/);
  });
});

test("文档和配置变化会让缓存索引在下一次请求时更新", async () => {
  await withServer({ config: { topbar: { links: [] } } }, async ({ fixture, baseUrl }) => {
    const initial = await requestJson(baseUrl, "/api/bootstrap");
    assert.equal(flattenTree(initial.tree).some((node) => node.path === "guide/new.md"), false);

    await fsp.writeFile(path.join(fixture.docsDir, "guide", "new.md"), "# 新文档\n\ncache-invalidation-token\n", "utf8");
    const updated = await waitFor(async () => {
      const payload = await requestJson(baseUrl, "/api/bootstrap");
      return flattenTree(payload.tree).some((node) => node.path === "guide/new.md") ? payload : null;
    }, "新增文档没有触发索引更新");
    assert.equal(flattenTree(updated.tree).find((node) => node.path === "guide/new.md").title, "新文档");

    const search = await waitFor(async () => {
      const payload = await requestJson(baseUrl, "/api/search?q=cache-invalidation-token");
      return payload.results.length ? payload : null;
    }, "新增文档没有进入全文搜索");
    assert.deepEqual(search.results.map((result) => result.path), ["guide/new.md"]);

    await fsp.writeFile(fixture.configPath, JSON.stringify({ topbar: { links: [{ label: "新增入口", href: "https://example.com" }] } }), "utf8");
    const changedConfig = await waitFor(async () => {
      const payload = await requestJson(baseUrl, "/api/bootstrap");
      return payload.config.topbar.links[0]?.label === "新增入口" ? payload : null;
    }, "配置变化没有生效");
    assert.equal(changedConfig.config.topbar.links[0].label, "新增入口");
  });
});
