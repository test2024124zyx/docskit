const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const { JSDOM } = require("jsdom");

const root = path.resolve(__dirname, "..");
const delay = (time = 0) => new Promise((resolve) => setTimeout(resolve, time));
const documentData = (file = "guide/intro.md") => ({ path: file, title: file === "guide/intro.md" ? "入门" : "接口", updatedAt: "2026-01-01", headings: [{ id: "auth", level: 2, title: "认证" }], html: '<h2 id="auth">认证</h2><p>正文</p>' });

async function mount({ response, width = 1200, site = {}, health, api } = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), { url: "http://docs.test/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const requests = [];
  window.innerWidth = width;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () { this.dataset.scrolled = "true"; };
  window.IntersectionObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = (callback) => callback();
  if (api) window.DocsKitApi = api;
  const tree = [{ type: "directory", path: "guide", title: "指南", children: [{ type: "file", path: "guide/intro.md", title: "入门" }, { type: "file", path: "guide/api.md", title: "接口" }] }];
  window.fetch = async (endpoint, options) => {
    requests.push(String(endpoint));
    if (response) {
      const custom = await response(endpoint, options);
      if (custom) return custom;
    }
    const url = new URL(endpoint, window.location.href);
    const payload = url.pathname === "/api/bootstrap" ? { config: { site, topbar: { version: "v1", links: [{ label: "官网", href: "https://example.com" }] }, sidebar: {} }, tree, documents: [], defaultPath: "guide/intro.md", health }
      : url.pathname === "/api/document" ? documentData(url.searchParams.get("path"))
        : { results: [{ path: "guide/api.md", title: "接口", snippet: "认证接口" }] };
    return { ok: true, status: 200, json: async () => payload };
  };
  for (const file of ["search-core.js", "client-search.js", "client-navigation.js", "script.js"]) {
    if (fs.existsSync(path.join(root, file))) vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), dom.getInternalVMContext(), { filename: pathToFileURL(path.join(root, file)).href });
  }
  for (let attempt = 0; attempt < 30 && !window.document.querySelector("#doc-page"); attempt += 1) await delay();
  return { window, document: window.document, requests, cleanup: () => dom.window.close() };
}

test("新关键词输入后和请求失败时不能操作旧搜索结果", async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const mounted = await mount({ response: (endpoint) => endpoint.includes("q=new") ? pending : null });
  try {
    const { window, document, requests } = mounted;
    document.querySelector('[data-action="open-search"]').click();
    const input = document.querySelector("#search-input");
    input.value = "old";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await delay(220);
    assert.ok(document.querySelector(".search-result"));
    input.value = "new";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const before = requests.filter((url) => url.startsWith("/api/document")).length;
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await delay(220);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(document.querySelector(".search-result"), null);
    assert.equal(requests.filter((url) => url.startsWith("/api/document")).length, before);
    release({ ok: false, status: 503, json: async () => ({ error: "搜索暂不可用" }) });
    await delay();
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    assert.equal(requests.filter((url) => url.startsWith("/api/document")).length, before);
    assert.match(document.querySelector("#search-results").textContent, /搜索暂不可用/);
  } finally { release?.({ ok: true, json: async () => ({ results: [] }) }); mounted.cleanup(); }
});

test("文档链接保留修饰键和新窗口语义，普通点击继续站内导航", async () => {
  const mounted = await mount();
  try {
    const { window, document, requests } = mounted;
    const anchor = document.querySelector('[data-doc-path="guide/api.md"]');
    for (const options of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }]) {
      const event = new window.MouseEvent("click", { bubbles: true, cancelable: true, ...options });
      anchor.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false);
    }
    anchor.target = "_blank";
    const external = new window.MouseEvent("click", { bubbles: true, cancelable: true });
    anchor.dispatchEvent(external);
    assert.equal(external.defaultPrevented, false);
    anchor.removeAttribute("target");
    const before = requests.length;
    anchor.click();
    await delay();
    assert.equal(requests.length, before + 1);
    assert.equal(window.location.search, "?doc=guide%2Fapi.md");
  } finally { mounted.cleanup(); }
});

test("折叠目录不可聚焦，移动抽屉管理背景及焦点恢复", async () => {
  const mounted = await mount({ width: 600 });
  try {
    const { document, window } = mounted;
    const sidebar = document.querySelector("#sidebar");
    assert.equal(sidebar.hasAttribute("inert"), true);
    const trigger = document.querySelector('[data-action="toggle-sidebar"]');
    trigger.focus();
    trigger.click();
    assert.equal(sidebar.hasAttribute("inert"), false);
    assert.equal(document.querySelector("main").hasAttribute("inert"), true);
    const heading = sidebar.querySelector(".side-nav__heading");
    heading.click();
    const children = sidebar.querySelector(".side-nav__children");
    assert.equal(children.hasAttribute("inert"), true);
    assert.equal(children.getAttribute("aria-hidden"), "true");
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(document.activeElement, trigger);
    assert.equal(document.querySelector("main").hasAttribute("inert"), false);
    window.innerWidth = 1200;
    window.dispatchEvent(new window.Event("resize"));
    assert.equal(sidebar.hasAttribute("inert"), false);
  } finally { mounted.cleanup(); }
});

test("文档未找到与网络错误提供可恢复状态并能原地重试", async () => {
  let fail = true;
  const mounted = await mount({ response: (endpoint) => fail && endpoint.includes("path=guide%2Fapi.md") ? { ok: false, status: 404, json: async () => ({ error: "文档不存在" }) } : null });
  try {
    mounted.document.querySelector('[data-doc-path="guide/api.md"]').click();
    await delay();
    assert.match(mounted.document.querySelector("#doc-content").textContent, /找不到文档/);
    assert.doesNotMatch(mounted.document.querySelector("#doc-content").textContent, /还没有 Markdown/);
    fail = false;
    mounted.document.querySelector('[data-action="retry-document"]').click();
    await delay();
    assert.equal(mounted.document.querySelector("#doc-page").dataset.title, "接口");
  } finally { mounted.cleanup(); }
});

test("阅读入口复用导航标题并提供前后篇、章节链接和移动目录", async () => {
  const mounted = await mount({ width: 600 });
  try {
    const { document, window } = mounted;
    assert.equal(document.querySelector(".version-select").tagName, "SPAN");
    assert.equal(document.querySelector(".version-select svg"), null);
    assert.equal(document.querySelector('#breadcrumb [data-doc-path="guide/intro.md"]').textContent, "指南");
    assert.equal(document.querySelector('.doc-pagination [rel="next"]').dataset.docPath, "guide/api.md");
    assert.ok(document.querySelector(".mobile-toc .toc__link"));
    document.querySelector('[data-action="toggle-topbar-menu"]').click();
    assert.equal(document.querySelector("#mobile-topbar-links").hidden, false);
    assert.match(document.querySelector("#mobile-topbar-links").textContent, /官网/);
    let copied = "";
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (value) => { copied = value; } } });
    document.querySelector('[data-action="copy-heading-link"]').click();
    await delay();
    assert.equal(copied, "http://docs.test/?doc=guide%2Fintro.md#auth");
  } finally { mounted.cleanup(); }
});

test("键盘搜索选项关联输入框并保持可见，输入法确认不会打开文档", async () => {
  const mounted = await mount();
  try {
    const { document, window, requests } = mounted;
    document.querySelector('[data-action="open-search"]').click();
    const input = document.querySelector("#search-input");
    input.value = "认证";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await delay(220);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assert.equal(input.getAttribute("role"), "combobox");
    const selected = document.getElementById(input.getAttribute("aria-activedescendant"));
    assert.equal(selected.getAttribute("aria-selected"), "true");
    assert.equal(selected.dataset.scrolled, "true");
    const before = requests.length;
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true }));
    assert.equal(requests.length, before);
  } finally { mounted.cleanup(); }
});

test("代码组同步语言并支持方向键，复制Markdown保留原始正文", async () => {
  const group = (suffix) => `<div class="markdown-code-group" data-code-group="sdk"><div role="tablist"><button role="tab" data-code-tab data-code-language="js" id="tab-js-${suffix}" aria-controls="panel-js-${suffix}" aria-selected="true">JavaScript</button><button role="tab" data-code-tab data-code-language="go" id="tab-go-${suffix}" aria-controls="panel-go-${suffix}" aria-selected="false" tabindex="-1">Go</button></div><div role="tabpanel" data-code-panel id="panel-js-${suffix}">js示例</div><div role="tabpanel" data-code-panel id="panel-go-${suffix}" hidden>go示例</div></div>`;
  const original = "## 接口\n\n```go\nfmt.Println(1)\n```";
  const mounted = await mount({ response: (endpoint) => endpoint.startsWith("/api/document") ? { ok: true, json: async () => ({ ...documentData(), markdown: original, markdownUrl: "/raw/guide/intro.md", html: group("a") + group("b") }) } : null });
  try {
    const { document, window } = mounted;
    document.querySelector("#tab-go-a").click();
    assert.equal(document.querySelector("#panel-go-a").hidden, false);
    assert.equal(document.querySelector("#panel-go-b").hidden, false);
    assert.equal(document.querySelector("#panel-js-b").hidden, true);
    document.querySelector("#tab-go-a").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(document.activeElement.id, "tab-js-a");
    assert.equal(document.querySelector("#tab-js-b").getAttribute("aria-selected"), "true");
    let copied;
    Object.defineProperty(window.navigator, "clipboard", { value: { writeText: async (value) => { copied = value; } } });
    document.querySelector('[data-action="copy-markdown"]').click();
    await delay();
    assert.equal(copied, original);
    assert.equal(document.querySelector('.document-toolbar a[download]').getAttribute("href"), "/raw/guide/intro.md");
  } finally { mounted.cleanup(); }
});

test("同语言代码示例可独立切换，语言同步保留其他组已选的示例", async () => {
  const { renderMarkdown } = require("../markdown");
  const source = ["::: code-group sdk", "```javascript [fetch]", "fetch('/api')", "```", "```javascript [axios]", "axios.get('/api')", "```", "```go [Go]", "client.Get()", "```", ":::"].join("\n");
  const html = renderMarkdown(`${source}\n\n${source}`).html;
  const mounted = await mount({ response: (endpoint) => endpoint.startsWith("/api/document") ? { ok: true, json: async () => ({ ...documentData(), html }) } : null });
  try {
    const { document, window } = mounted;
    const groups = Array.from(document.querySelectorAll(".markdown-code-group"));
    const tabs = groups.map((group) => Array.from(group.querySelectorAll("[data-code-tab]")));
    const expectSelected = (groupIndex, tabIndex) => {
      tabs[groupIndex].forEach((tab, index) => {
        const selected = index === tabIndex;
        assert.equal(tab.getAttribute("aria-selected"), String(selected));
        assert.equal(tab.tabIndex, selected ? 0 : -1);
        assert.equal(document.getElementById(tab.getAttribute("aria-controls")).hidden, !selected);
      });
    };
    tabs[1][1].click();
    expectSelected(0, 0);
    expectSelected(1, 1);
    tabs[0][1].click();
    expectSelected(0, 1);
    expectSelected(1, 1);
    tabs[0][0].click();
    expectSelected(0, 0);
    expectSelected(1, 1);
    tabs[0][0].dispatchEvent(new window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    assert.equal(document.activeElement, tabs[0][2]);
    expectSelected(0, 2);
    expectSelected(1, 2);
    tabs[0][2].dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    assert.equal(document.activeElement, tabs[0][1]);
    expectSelected(0, 1);
    expectSelected(1, 0);
    assert.equal(window.localStorage.getItem("docs-code-language:sdk"), "javascript");
  } finally { mounted.cleanup(); }
});

test("章节搜索保留锚点并安全高亮用户文本", async () => {
  const mounted = await mount({ response: (endpoint) => endpoint.startsWith("/api/search") ? { ok: true, json: async () => ({ results: [{ path: "guide/api.md", title: "接口", sectionTitle: "认证", hash: "#auth", snippet: '<img src=x onerror="alert(1)">认证' }] }) } : null });
  try {
    const { document, window } = mounted;
    document.querySelector('[data-action="open-search"]').click();
    const input = document.querySelector("#search-input");
    input.value = "认证";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    await delay(220);
    assert.equal(document.querySelector(".search-result").hash, "#auth");
    assert.match(document.querySelector(".search-result strong").textContent, /接口 · 认证/);
    assert.equal(document.querySelector(".search-result mark").textContent, "认证");
    assert.equal(document.querySelector(".search-result img"), null);
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await delay();
    assert.equal(window.location.hash, "#auth");
  } finally { mounted.cleanup(); }
});

test("可信站点地址生成逐文档canonical并显示内容更新延迟提示", async () => {
  const mounted = await mount({ site: { url: "https://docs.example.com/manual", seo: { canonical: "https://old.example.com/" } }, health: { index: { status: "degraded" }, configuration: { status: "ready" } } });
  try {
    assert.equal(mounted.document.querySelector('link[rel="canonical"]').href, "https://docs.example.com/manual/?doc=guide%2Fintro.md");
    assert.equal(mounted.document.querySelector('meta[property="og:url"]').content, "https://docs.example.com/manual/?doc=guide%2Fintro.md");
    assert.equal(mounted.document.querySelector("#site-status").hidden, false);
    assert.match(mounted.document.querySelector("#site-status").textContent, /最近可用内容/);
    mounted.document.querySelector('[data-doc-path="guide/api.md"]').click();
    await delay();
    assert.equal(mounted.document.querySelector('link[rel="canonical"]').href, "https://docs.example.com/manual/?doc=guide%2Fapi.md");
  } finally { mounted.cleanup(); }
});

test("返回已阅读文档时恢复历史滚动位置", async () => {
  const mounted = await mount();
  try {
    const { window, document } = mounted;
    window.scrollY = 640;
    window.dispatchEvent(new window.Event("scroll"));
    assert.equal(window.history.state.docskitScroll.y, 640);
    document.querySelector('[data-doc-path="guide/api.md"]').click();
    await delay();
    const calls = [];
    window.scrollTo = (options) => calls.push(options);
    window.history.replaceState({ docskitScroll: { x: 0, y: 640 } }, "", "/?doc=guide%2Fintro.md");
    window.dispatchEvent(new window.PopStateEvent("popstate", { state: window.history.state }));
    await delay();
    assert.equal(calls.at(-1).top, 640);
  } finally { mounted.cleanup(); }
});

test("搜索弹层隔离背景，移动端跳转后聚焦正文并同步API主题", async () => {
  const themes = [];
  const mounted = await mount({ width: 600, api: { unmount() {}, updateTheme(theme) { themes.push(theme); } } });
  try {
    const { document } = mounted;
    document.querySelector('[data-action="open-search"]').click();
    assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), true);
    document.querySelector('[data-action="close-search"]').click();
    assert.equal(document.querySelector(".app-shell").hasAttribute("inert"), false);
    document.querySelector('[data-action="toggle-theme"]').click();
    assert.equal(themes.at(-1), "dark");
    document.querySelector('[data-action="toggle-sidebar"]').click();
    document.querySelector('[data-doc-path="guide/api.md"]').click();
    await delay();
    assert.equal(document.activeElement, document.querySelector("#doc-content"));
    assert.equal(document.querySelector("#sidebar").hasAttribute("inert"), true);
  } finally { mounted.cleanup(); }
});

test("API增强失败不破坏正文并可重试，切文档清理旧实例", async () => {
  let mounts = 0;
  let unmounts = 0;
  const mounted = await mount({ api: { unmount() { unmounts += 1; }, mount: async () => { mounts += 1; if (mounts === 1) throw new Error("组件加载失败"); } }, response: (endpoint) => endpoint.includes("path=guide%2Fintro.md") ? { ok: true, json: async () => ({ ...documentData(), apiReference: { path: "openapi.yaml" } }) } : null });
  try {
    await delay();
    assert.ok(mounted.document.querySelector(".markdown-body h2"));
    assert.equal(mounted.document.getElementById("api-reference"), null);
    assert.ok(mounted.document.getElementById("docskit-api-reference"));
    assert.ok(mounted.document.querySelector('.document-toolbar a[href="#docskit-api-reference"]'));
    assert.match(mounted.document.querySelector(".api-reference").textContent, /API 参考暂时无法加载/);
    mounted.document.querySelector(".api-reference button").click();
    await delay();
    assert.equal(mounts, 2);
    mounted.document.querySelector('[data-doc-path="guide/api.md"]').click();
    await delay();
    assert.ok(unmounts >= 2);
  } finally { mounted.cleanup(); }
});

test("文档全局样式不会覆盖API组件的填充图标和代码排版", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const dom = new JSDOM(`<style>${css}</style><svg id="document-icon"></svg><code id="document-code">示例</code><section class="api-reference"><svg id="api-icon" fill="currentColor"></svg><code id="api-code">示例</code></section>`);
  try {
    const { window } = dom;
    const style = (id) => window.getComputedStyle(window.document.getElementById(id));
    assert.equal(style("document-icon").fill, "rgba(0, 0, 0, 0)");
    assert.notEqual(style("api-icon").fill, style("document-icon").fill);
    assert.equal(style("document-code").padding, "2px 5px");
    assert.notEqual(style("api-code").padding, "2px 5px");
  } finally { dom.window.close(); }
});

test("宽表保留独立滚动边界且表头不被挤成竖排", () => {
  const { renderMarkdown } = require("../markdown");
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const source = fs.readFileSync(path.join(root, "docs/api/http/search.md"), "utf8");
  const html = renderMarkdown(source).html;
  const dom = new JSDOM(`<style>${css}</style><main class="main-content" style="width:390px"><div class="content-wrap"><article class="doc-article"><section class="markdown-section"><div class="markdown-body">${html}</div></section></article></div></main>`);
  try {
    const { window } = dom;
    const wrap = window.document.querySelector(".markdown-table-wrap");
    assert.equal(wrap.querySelectorAll("thead th").length, 6);
    const style = window.getComputedStyle(wrap);
    assert.equal(style.overflowX, "auto");
    assert.equal(style.maxWidth, "100%");
    assert.equal(style.minWidth, "0px");
    assert.equal(window.getComputedStyle(wrap.querySelector("th")).whiteSpace, "nowrap");
    assert.equal(window.getComputedStyle(wrap.querySelector("table")).minWidth, "440px");
    assert.equal(window.getComputedStyle(wrap.querySelector("td:last-child")).whiteSpace, "normal");
  } finally { dom.window.close(); }
});
