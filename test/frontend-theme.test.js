const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const THEME_KEY = "docs-theme";
const SYSTEM_THEME_QUERY = "(prefers-color-scheme: dark)";
const MAX_BOOTSTRAP_ATTEMPTS = 30;

async function mountTheme({ stored = null, dark = false, readFailure = false, writeFailure = false, mediaMode = "modern", themeToggle = true } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"), { url: "https://docs.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const writes = [];
  const apiThemes = [];
  const listeners = new Set();
  const media = { matches: dark, media: SYSTEM_THEME_QUERY };
  if (mediaMode === "legacy") media.addListener = (listener) => listeners.add(listener);
  else media.addEventListener = (event, listener) => { assert.equal(event, "change"); listeners.add(listener); };
  if (mediaMode !== "missing") window.matchMedia = (query) => {
    assert.equal(query, SYSTEM_THEME_QUERY);
    if (mediaMode === "throwing") throw new Error("系统主题 API 不可用");
    return media;
  };
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem(key) { assert.equal(key, THEME_KEY); if (readFailure) throw new Error("禁止读取存储"); return stored; },
    setItem(key, value) { assert.equal(key, THEME_KEY); if (writeFailure) throw new Error("禁止写入存储"); writes.push(value); stored = value; }
  } });
  window.DocsKitApi = { updateTheme: (theme) => apiThemes.push(theme), unmount() {} };
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.requestAnimationFrame = (callback) => callback();
  window.fetch = async () => ({ ok: true, json: async () => ({ config: { topbar: { themeToggle }, site: {}, sidebar: {} }, tree: [], documents: [], defaultPath: "" }) });
  try {
    for (const file of ["search-core.js", "client-search.js", "client-navigation.js", "script.js"]) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), dom.getInternalVMContext(), { filename: pathToFileURL(path.join(ROOT, file)).href });
    }
    for (let attempt = 0; attempt < MAX_BOOTSTRAP_ATTEMPTS && !window.document.querySelector('[data-action="open-search"]'); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(window.document.querySelector('[data-action="open-search"]'), "站点应正常完成初始化");
    return {
      document: window.document, writes, apiThemes,
      changeSystem(nextDark) { media.matches = nextDark; for (const listener of listeners) listener({ matches: nextDark, media: SYSTEM_THEME_QUERY }); },
      cleanup() { window.close(); }
    };
  } catch (error) { window.close(); throw error; }
}

function assertTheme(mounted, theme) {
  assert.equal(mounted.document.body.dataset.theme, theme);
  const button = mounted.document.querySelector('[data-action="toggle-theme"]');
  const targetLabel = theme === "dark" ? "切换到浅色主题" : "切换到深色主题";
  assert.equal(button.getAttribute("aria-label"), targetLabel);
  assert.equal(button.title, targetLabel);
  assert.equal(button.getAttribute("aria-pressed"), String(theme === "dark"));
  assert.equal(mounted.apiThemes.at(-1), theme);
}

test("未设置偏好时跟随系统主题及后续变化，不将系统主题写成显式偏好", async () => {
  const mounted = await mountTheme({ dark: true });
  try {
    assertTheme(mounted, "dark");
    mounted.changeSystem(false);
    assertTheme(mounted, "light");
    mounted.changeSystem(true);
    assertTheme(mounted, "dark");
    assert.deepEqual(mounted.writes, []);
  } finally { mounted.cleanup(); }
});

test("合法保存偏好优先，手动切换更新按钮和存储且不被系统覆盖", async () => {
  for (const stored of ["light", "dark"]) {
    const mounted = await mountTheme({ stored, dark: stored === "light" });
    try {
      assertTheme(mounted, stored);
      mounted.changeSystem(stored === "light");
      assertTheme(mounted, stored);
      assert.deepEqual(mounted.writes, []);
      mounted.document.querySelector('[data-action="toggle-theme"]').click();
      const chosen = stored === "light" ? "dark" : "light";
      assertTheme(mounted, chosen);
      assert.deepEqual(mounted.writes, [chosen]);
      mounted.changeSystem(stored === "dark");
      assertTheme(mounted, chosen);
    } finally { mounted.cleanup(); }
  }
});

test("非法或空存储值采用系统主题，用户选择后立即停止跟随", async () => {
  for (const stored of ["sepia", "DARK", ""]) {
    const mounted = await mountTheme({ stored, dark: true });
    try {
      assertTheme(mounted, "dark");
      mounted.document.querySelector('[data-action="toggle-theme"]').click();
      assertTheme(mounted, "light");
      mounted.changeSystem(true);
      assertTheme(mounted, "light");
    } finally { mounted.cleanup(); }
  }
});

test("存储读写失败时保留系统默认和当前页面内的显式选择", async () => {
  const mounted = await mountTheme({ dark: true, readFailure: true, writeFailure: true });
  try {
    assertTheme(mounted, "dark");
    mounted.changeSystem(false);
    assertTheme(mounted, "light");
    mounted.document.querySelector('[data-action="toggle-theme"]').click();
    assertTheme(mounted, "dark");
    mounted.changeSystem(false);
    assertTheme(mounted, "dark");
  } finally { mounted.cleanup(); }
});

test("系统主题 API 缺失或异常时以浅色安全启动，手动选择仍可用", async () => {
  for (const mediaMode of ["missing", "throwing"]) {
    const mounted = await mountTheme({ mediaMode });
    try {
      assertTheme(mounted, "light");
      mounted.document.querySelector('[data-action="toggle-theme"]').click();
      assertTheme(mounted, "dark");
    } finally { mounted.cleanup(); }
  }
});

test("旧版媒体查询监听及关闭主题按钮配置仍可同步系统主题", async () => {
  const mounted = await mountTheme({ dark: false, mediaMode: "legacy", themeToggle: false });
  try {
    assert.equal(mounted.document.querySelector('[data-action="toggle-theme"]'), null);
    assert.equal(mounted.document.body.dataset.theme, "light");
    mounted.changeSystem(true);
    assert.equal(mounted.document.body.dataset.theme, "dark");
    assert.equal(mounted.apiThemes.at(-1), "dark");
    assert.deepEqual(mounted.writes, []);
  } finally { mounted.cleanup(); }
});
