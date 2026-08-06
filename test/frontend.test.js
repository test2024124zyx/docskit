const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

const PROJECT_DIR = path.resolve(__dirname, "..");
const HTML = fs.readFileSync(path.join(PROJECT_DIR, "index.html"), "utf8");
const SCRIPT_PATH = path.join(PROJECT_DIR, "script.js");

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(check) {
  for (let index = 0; index < 50; index += 1) {
    const result = check();
    if (result) return result;
    await flush();
  }
  throw new Error("等待前端初始化超时");
}

function replaceGlobal(name, value, previous) {
  previous[name] = { exists: Object.prototype.hasOwnProperty.call(global, name), value: global[name] };
  global[name] = value;
}

async function mountFrontend({ config, tree, documents, defaultPath, documentData, searchResults = [], fetchMode = "normal", omitCanonical = false, omitHeadMetadata = false, disableAbortController = false, staticPayload = null, staticDocuments = {} }) {
  let initialHtml = HTML;
  if (omitCanonical || omitHeadMetadata) initialHtml = initialHtml.replace(/\s*<link rel="canonical" href="" \/>/, "");
  if (omitHeadMetadata) initialHtml = initialHtml.replace(/^\s*<meta (?:name|property)="(?:description|keywords|author|robots|theme-color|og:[^"]+|twitter:[^"]+)"[^>]*\/>\s*$/gm, "");
  if (staticPayload) {
    const serialized = JSON.stringify(staticPayload).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
    initialHtml = initialHtml.replace("</body>", `<script id="docskit-static-data" type="application/json">${serialized}</script></body>`);
  }
  const staticBase = staticPayload?.staticBuild?.base || "/";
  const dom = new JSDOM(initialHtml, { url: `http://127.0.0.1:3000${staticBase}`, pretendToBeVisual: true });
  const { window } = dom;
  const previous = {};
  const bootstrap = { config, tree, documents, defaultPath };
  const requests = [];
  const normalizedStaticBase = staticBase === "/" ? "/" : `/${staticBase.replace(/^\/+|\/+$/g, "")}/`;
  const responseFor = (endpoint) => {
    const url = new URL(endpoint, window.location.href);
    if (staticPayload) {
      if (url.pathname === `${normalizedStaticBase}search-index.json`) return { documents: searchResults };
      const dataPrefix = `${normalizedStaticBase}data/documents/`;
      if (url.pathname.startsWith(dataPrefix)) {
        const pathValue = decodeURIComponent(url.pathname.slice(dataPrefix.length)).replace(/\.json$/i, "");
        return staticDocuments[pathValue] || { error: "静态文档不存在" };
      }
    }
    if (url.pathname === "/api/bootstrap") return bootstrap;
    if (url.pathname === "/api/document") return documentData;
    if (url.pathname === "/api/search") return { query: url.searchParams.get("q") || "", results: searchResults };
    return { error: "测试路由不存在" };
  };
  const fetchStub = async (endpoint, options) => {
    requests.push(String(endpoint));
    if (typeof fetchMode === "function") {
      const customResponse = await fetchMode(endpoint, responseFor(endpoint), options);
      if (customResponse) return customResponse;
    }
    return { ok: true, status: 200, json: async () => responseFor(endpoint) };
  };

  window.scrollTo = () => {};
  window.__scrollIntoViewCalls = [];
  window.HTMLElement.prototype.scrollIntoView = function (options) {
    window.__scrollIntoViewCalls.push({ id: this.id, options });
  };
  window.requestAnimationFrame = (callback) => callback();
  if (disableAbortController) window.AbortController = undefined;
  window.__intersectionObservers = [];
  window.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
      window.__intersectionObservers.push(this);
    }
    observe() {}
    disconnect() {}
  };
  window.fetch = fetchStub;
  replaceGlobal("window", window, previous);
  replaceGlobal("document", window.document, previous);
  replaceGlobal("navigator", window.navigator, previous);
  replaceGlobal("IntersectionObserver", window.IntersectionObserver, previous);
  replaceGlobal("fetch", fetchStub, previous);
  delete require.cache[require.resolve(SCRIPT_PATH)];
  require(SCRIPT_PATH);
  await waitFor(() => window.document.querySelector("#doc-content .doc-section"));

  return {
    dom,
    window,
      document: window.document,
    requests,
    cleanup() {
      delete require.cache[require.resolve(SCRIPT_PATH)];
      dom.window.close();
      Object.entries(previous).forEach(([name, state]) => {
        if (state.exists) global[name] = state.value;
        else delete global[name];
      });
    }
  };
}

function findGroup(document, groupPath) {
  return Array.from(document.querySelectorAll(".side-nav__group[data-group-path]")).find((group) => group.dataset.groupPath === groupPath);
}

function setScrollHeight(element, value) {
  Object.defineProperty(element, "scrollHeight", { configurable: true, value });
}

function baseDocument(pathValue = "guide/intro.md") {
  return {
    path: pathValue,
    title: "指南入口",
    description: "文档摘要",
    updatedAt: "2026-01-01T00:00:00.000Z",
    html: '<h1 id="指南入口">指南入口</h1><p>正文</p><p><span class="markdown-icon" data-icon-name="rocket" role="img" aria-label="rocket"></span></p>',
    headings: [{ id: "指南入口", level: 1, title: "指南入口" }],
    icon: "file-markdown",
    iconColor: "",
    iconColors: []
  };
}

function baseTree() {
  return [
    {
      type: "directory",
      path: "guide",
      title: "指南",
      icon: "folder",
      iconColor: "",
      iconColors: ["#3370ff", "#7c3aed", "#0f9d8a"],
      children: [
        {
          type: "directory",
          path: "guide/nested",
          title: "深入",
          icon: "folder",
          iconColor: "",
          iconColors: [],
          children: [{ type: "file", path: "guide/nested/deep.md", title: "深入文档", icon: "file-markdown", iconColors: [] }]
        },
        { type: "file", path: "guide/intro.md", title: "指南入口", icon: "file-markdown", iconColors: [] }
      ]
    },
    {
      type: "directory",
      path: "components",
      title: "组件",
      icon: "folder",
      iconColor: "",
      iconColors: ["#d97706", "#d95850", "#0891b2"],
      children: [{ type: "file", path: "components/button.md", title: "按钮", icon: "file-markdown", iconColors: [] }]
    }
  ];
}

const baseConfig = {
  site: {
    brand: { name: "docs", accent: "kit" },
    context: "文档",
    eyebrow: "DOCUMENTATION",
    title: "我的文档",
    description: "默认描述",
    logo: "",
    favicon: "",
    seo: {},
    footer: {}
  },
  topbar: { version: "", links: [], search: true, themeToggle: true },
  sidebar: { indent: 12, iconColor: "", iconPalette: ["#3370ff", "#7c3aed", "#0f9d8a"], expandMode: "all" }
};

test("前端静态模式使用构建数据、静态文档 JSON 和离线搜索", async () => {
  const currentDocument = baseDocument("guide/intro.md");
  const otherDocument = { ...baseDocument("components/button.md"), title: "按钮文档" };
  const staticPayload = {
    staticBuild: {
      base: "/docs/",
      documentUrls: { "guide/intro.md": "/docs/guide/intro.html", "components/button.md": "/docs/components/button.html" },
      routeDocuments: { "/docs/": "guide/intro.md", "/docs/guide/intro.html": "guide/intro.md", "/docs/components/button.html": "components/button.md" }
    },
    config: baseConfig,
    tree: baseTree(),
    documents: [{ path: currentDocument.path, title: currentDocument.title, icon: currentDocument.icon }, { path: otherDocument.path, title: otherDocument.title, icon: otherDocument.icon }],
    defaultPath: currentDocument.path,
    currentPath: currentDocument.path,
    currentDocument
  };
  const mounted = await mountFrontend({
    config: baseConfig,
    tree: baseTree(),
    documents: [],
    defaultPath: currentDocument.path,
    documentData: currentDocument,
    staticPayload,
    staticDocuments: { [currentDocument.path]: currentDocument, [otherDocument.path]: otherDocument },
    searchResults: [{ path: otherDocument.path, title: otherDocument.title, description: "按钮摘要", plainBody: "按钮正文", searchText: "按钮文档\ncomponents/button.md\n按钮正文", icon: "file-markdown", iconColors: [] }]
  });
  try {
    assert.equal(mounted.document.querySelector("#doc-page").dataset.title, currentDocument.title);
    assert.equal(mounted.requests.length, 0);

    mounted.document.querySelector('[data-doc-path="components/button.md"]').click();
    await waitFor(() => mounted.document.querySelector("#doc-page")?.dataset.title === otherDocument.title);
    assert.ok(mounted.requests.some((endpoint) => endpoint.includes("/docs/data/documents/components/button.md.json")));

    mounted.document.querySelector('[data-action="open-search"]').click();
    const input = mounted.document.querySelector("#search-input");
    input.value = "按钮";
    input.dispatchEvent(new mounted.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    await waitFor(() => mounted.document.querySelector(".search-result"));
    assert.equal(mounted.document.querySelector(".search-result").getAttribute("href"), "/docs/components/button.html");
    assert.ok(mounted.requests.some((endpoint) => endpoint.includes("/docs/search-index.json")));
    assert.doesNotMatch(mounted.requests.join("\n"), /\/api\//);
  } finally {
    mounted.cleanup();
  }
});

test("前端菜单收缩会归零高度并递归刷新父级，手风琴只折叠同级目录", async () => {
  const mounted = await mountFrontend({ config: baseConfig, tree: baseTree(), documents: [], defaultPath: "guide/intro.md", documentData: baseDocument() });
  try {
    const guide = findGroup(mounted.document, "guide");
    const nested = findGroup(mounted.document, "guide/nested");
    const guideHeading = guide.querySelector(":scope > .side-nav__heading");
    const guideChildren = guide.querySelector(":scope > .side-nav__children");
    const nestedHeading = nested.querySelector(":scope > .side-nav__heading");
    const nestedChildren = nested.querySelector(":scope > .side-nav__children");
    setScrollHeight(guideChildren, 180);
    setScrollHeight(nestedChildren, 80);

    guideHeading.click();
    assert.equal(guideHeading.getAttribute("aria-expanded"), "false");
    assert.equal(guideChildren.classList.contains("is-collapsed"), true);
    assert.equal(guideChildren.style.maxHeight, "0px");

    guideHeading.click();
    assert.equal(guideHeading.getAttribute("aria-expanded"), "true");
    assert.equal(guideChildren.classList.contains("is-collapsed"), false);
    assert.equal(guideChildren.style.maxHeight, "180px");

    nestedHeading.click();
    assert.equal(nestedChildren.style.maxHeight, "0px");
    assert.equal(guideChildren.style.maxHeight, "180px");
  } finally {
    mounted.cleanup();
  }

  const accordionConfig = { ...baseConfig, sidebar: { ...baseConfig.sidebar, expandMode: "accordion" } };
  const accordion = await mountFrontend({ config: accordionConfig, tree: baseTree(), documents: [], defaultPath: "guide/intro.md", documentData: baseDocument() });
  try {
    const guide = findGroup(accordion.document, "guide");
    const components = findGroup(accordion.document, "components");
    const guideHeading = guide.querySelector(":scope > .side-nav__heading");
    const guideChildren = guide.querySelector(":scope > .side-nav__children");
    const componentsHeading = components.querySelector(":scope > .side-nav__heading");
    const componentsChildren = components.querySelector(":scope > .side-nav__children");
    setScrollHeight(guideChildren, 180);
    setScrollHeight(componentsChildren, 100);

    componentsHeading.click();
    assert.equal(componentsHeading.getAttribute("aria-expanded"), "true");
    assert.equal(componentsChildren.style.maxHeight, "100px");
    assert.equal(guideHeading.getAttribute("aria-expanded"), "false");
    assert.equal(guideChildren.style.maxHeight, "0px");
  } finally {
    accordion.cleanup();
  }

  const accordionFallback = await mountFrontend({
    config: accordionConfig,
    tree: baseTree(),
    documents: [],
    defaultPath: "missing.md",
    documentData: baseDocument("outside.md")
  });
  try {
    const firstGroup = findGroup(accordionFallback.document, "guide");
    assert.equal(firstGroup.querySelector(":scope > .side-nav__heading").getAttribute("aria-expanded"), "true");
  } finally {
    accordionFallback.cleanup();
  }
});

test("前端嵌套目录过渡完成后会刷新父级高度", async () => {
  const mounted = await mountFrontend({ config: baseConfig, tree: baseTree(), documents: [], defaultPath: "guide/intro.md", documentData: baseDocument() });
  try {
    const guide = findGroup(mounted.document, "guide");
    const nested = findGroup(mounted.document, "guide/nested");
    const nestedHeading = nested.querySelector(":scope > .side-nav__heading");
    const nestedChildren = nested.querySelector(":scope > .side-nav__children");
    const guideChildren = guide.querySelector(":scope > .side-nav__children");
    let guideHeight = 120;
    Object.defineProperty(guideChildren, "scrollHeight", { configurable: true, get: () => guideHeight });
    setScrollHeight(nestedChildren, 80);

    nestedHeading.click();
    assert.equal(guideChildren.style.maxHeight, "120px");
    nestedHeading.click();
    assert.equal(guideChildren.style.maxHeight, "120px");

    guideHeight = 180;
    const transitionEnd = new mounted.window.Event("transitionend", { bubbles: true });
    Object.defineProperty(transitionEnd, "propertyName", { value: "max-height" });
    nestedChildren.dispatchEvent(transitionEnd);
    assert.equal(guideChildren.style.maxHeight, "180px");
  } finally {
    mounted.cleanup();
  }
});

test("前端渲染站点品牌、SEO、页脚、图标和常用交互", async () => {
  const config = {
    ...baseConfig,
    site: {
      ...baseConfig.site,
      brand: { name: "测试", accent: "站点" },
      context: "知识库",
      title: "测试站点",
      logo: { src: "https://example.com/logo.png", alt: "测试 Logo" },
      favicon: "https://example.com/favicon.ico",
      seo: { title: "默认 SEO", description: "SEO 描述", keywords: ["文档", "测试"], author: "作者", robots: "noindex", canonical: "https://example.com/docs", themeColor: "#123456" },
      footer: { copyright: "版权信息", icp: "ICP备案", beian: "公安备案", links: [{ label: "隐私", href: "https://example.com/privacy", external: true }] }
    },
    topbar: {
      version: "v1.0.0",
      search: true,
      themeToggle: true,
      links: [{ label: "指南", path: "guide/intro.md", icon: "rocket" }, { label: "仓库", href: "https://example.com/repo", external: true, icon: "github" }]
    },
    sidebar: { ...baseConfig.sidebar, iconPalette: ["#111", "#222", "#333"] }
  };
  const mounted = await mountFrontend({ config, tree: baseTree(), documents: [], defaultPath: "guide/intro.md", documentData: baseDocument() , searchResults: [{ path: "guide/intro.md", title: "指南入口", description: "摘要", snippet: "正文", icon: "rocket", iconColors: [] }] });
  try {
    const logo = mounted.document.querySelector("#brand-logo img");
    assert.equal(logo.src, "https://example.com/logo.png");
    assert.equal(logo.alt, "测试 Logo");
    assert.equal(mounted.document.querySelector("#brand-context").textContent, "知识库");
    assert.equal(mounted.document.querySelector("#site-favicon").href, "https://example.com/favicon.ico");
    assert.equal(mounted.document.title, "指南入口 - 默认 SEO");
    assert.equal(mounted.document.querySelector('meta[name="description"]').content, "文档摘要");
    assert.equal(mounted.document.querySelector('meta[name="keywords"]').content, "文档, 测试");
    assert.equal(mounted.document.querySelector('meta[name="robots"]').content, "noindex");
    assert.equal(mounted.document.querySelector('link[rel="canonical"]').href, "https://example.com/docs");
    assert.equal(mounted.document.querySelector('meta[name="theme-color"]').content, "#123456");

    const footer = mounted.document.querySelector("#doc-footer");
    assert.equal(footer.hidden, false);
    assert.match(footer.textContent, /版权信息/);
    assert.match(footer.textContent, /ICP备案/);
    assert.equal(footer.querySelector("a").target, "_blank");
    assert.equal(footer.querySelector("a").rel, "noreferrer");
    assert.equal(mounted.document.querySelectorAll(".topbar-link").length, 2);
    assert.equal(mounted.document.querySelector(".topbar-link[data-doc-path]").getAttribute("href"), "/?doc=guide%2Fintro.md");
    const gradientIcon = mounted.document.querySelector(".side-nav__icon[data-icon-gradient]");
    assert.ok(gradientIcon);
    const gradientId = gradientIcon.dataset.iconGradient;
    const gradientPaint = gradientIcon.querySelector("g");
    assert.ok(gradientPaint);
    assert.equal(gradientPaint.style.stroke, `url(#${gradientId})`);
    assert.deepEqual(
      Array.from(gradientIcon.querySelectorAll("stop")).map((stop) => stop.getAttribute("stop-color")),
      ["#3370ff", "#7c3aed", "#0f9d8a"]
    );
    assert.ok(mounted.document.querySelector(".markdown-icon__svg"));

    const themeButton = mounted.document.querySelector('[data-action="toggle-theme"]');
    themeButton.click();
    assert.equal(mounted.document.body.dataset.theme, "dark");
    const searchButton = mounted.document.querySelector('[data-action="open-search"]');
    searchButton.click();
    const searchModal = mounted.document.querySelector(".search-modal");
    assert.equal(searchModal.classList.contains("is-open"), true);
    assert.equal(searchModal.getAttribute("aria-hidden"), "false");
    mounted.document.querySelector("#search-input").value = "指南";
    mounted.document.querySelector("#search-input").dispatchEvent(new mounted.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.ok(mounted.document.querySelector(".search-result"));

    mounted.document.dispatchEvent(new mounted.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(searchModal.classList.contains("is-open"), false);
    const menuButton = mounted.document.querySelector('[data-action="toggle-sidebar"]');
    menuButton.click();
    assert.equal(mounted.document.querySelector("#sidebar").classList.contains("is-open"), true);
    mounted.document.querySelector('[data-action="close-sidebar"]').click();
    assert.equal(mounted.document.querySelector("#sidebar").classList.contains("is-open"), false);
  } finally {
    mounted.cleanup();
  }

});

test("前端覆盖空目录、加载失败、目录锚点和键盘搜索状态", async () => {
  const emptyConfig = {
    ...baseConfig,
    site: { ...baseConfig.site, brand: "docs", logo: "assets/logo.png", favicon: "assets/favicon.ico", footer: {} }
  };
  const empty = await mountFrontend({ config: emptyConfig, tree: [], documents: [], defaultPath: "", documentData: baseDocument(), omitCanonical: true });
  try {
    assert.ok(empty.document.querySelector(".nav-empty"));
    assert.ok(empty.document.querySelector(".empty-document"));
    assert.equal(empty.document.querySelector("#brand-logo img").src, "http://127.0.0.1:3000/api/asset?path=assets%2Flogo.png");
    assert.equal(empty.document.querySelector("#site-favicon").href, "http://127.0.0.1:3000/api/asset?path=assets%2Ffavicon.ico");
    assert.equal(empty.document.querySelector("#doc-footer").hidden, true);
  } finally {
    empty.cleanup();
  }

  const failureResponse = (message, status = 500) => ({ ok: false, status, json: async () => ({ error: message }) });
  const bootstrapFailure = await mountFrontend({
    config: baseConfig,
    tree: [],
    documents: [],
    defaultPath: "",
    documentData: baseDocument(),
    fetchMode: (endpoint) => endpoint === "/api/bootstrap" ? failureResponse("启动失败", 503) : null
  });
  try {
    assert.ok(bootstrapFailure.document.querySelector(".empty-document"));
    assert.match(bootstrapFailure.document.querySelector(".toast--error").textContent, /无法连接文档服务|启动失败/);
  } finally {
    bootstrapFailure.cleanup();
  }

  const documentFailure = await mountFrontend({
    config: baseConfig,
    tree: baseTree(),
    documents: [],
    defaultPath: "guide/intro.md",
    documentData: baseDocument(),
    fetchMode: (endpoint) => endpoint.startsWith("/api/document") ? failureResponse("文档加载失败", 404) : null
  });
  try {
    assert.ok(documentFailure.document.querySelector(".empty-document"));
    assert.match(documentFailure.document.querySelector(".toast--error").textContent, /文档加载失败/);
  } finally {
    documentFailure.cleanup();
  }

  const richDocument = {
    ...baseDocument(),
    html: '<h1 id="指南入口">指南入口</h1><h2 id="section">章节</h2><h3 id="subsection">子章节</h3><div class="code-block"><button class="copy-button" type="button" data-copy="代码"><span>复制</span></button></div>',
    headings: [
      { id: "指南入口", level: 1, title: "指南入口" },
      { id: "section", level: 2, title: "章节" },
      { id: "subsection", level: 3, title: "子章节" }
    ]
  };
  const rich = await mountFrontend({
    config: { ...baseConfig, topbar: { ...baseConfig.topbar, version: "v1.0.0" } },
    tree: baseTree(),
    documents: [],
    defaultPath: "guide/intro.md",
    documentData: richDocument,
    searchResults: [{ path: "guide/intro.md", title: "指南入口", description: "摘要", snippet: "正文", icon: "rocket", iconColors: [] }],
    fetchMode: (endpoint) => {
      const url = new URL(endpoint, "http://127.0.0.1:3000/");
      if (url.pathname !== "/api/search") return null;
      if (url.searchParams.get("q") === "无结果") return { ok: true, status: 200, json: async () => ({ results: [] }) };
      if (url.searchParams.get("q") === "搜索失败") return { ok: false, status: 500, json: async () => ({ error: "搜索失败" }) };
      return null;
    }
  });
  try {
    assert.equal(rich.document.querySelectorAll(".toc__link").length, 2);
    assert.equal(rich.window.__intersectionObservers.length, 1);
    const section = rich.document.getElementById("section");
    rich.window.__intersectionObservers[0].callback([
      { isIntersecting: false, intersectionRatio: 0, target: section },
      { isIntersecting: true, intersectionRatio: 0.8, target: section }
    ]);
    assert.equal(rich.document.querySelector('.toc__link[data-heading-id="section"]').classList.contains("is-active"), true);
    rich.window.__intersectionObservers[0].callback([{ isIntersecting: false, intersectionRatio: 0, target: section }]);

    const tocLink = rich.document.querySelector('.toc__link[data-heading-id="section"]');
    const scrollCallCount = rich.window.__scrollIntoViewCalls.length;
    tocLink.click();
    assert.equal(rich.window.location.hash, "#section");
    assert.equal(rich.window.__scrollIntoViewCalls.length, scrollCallCount + 1);
    assert.deepEqual(rich.window.__scrollIntoViewCalls.at(-1), { id: "section", options: { behavior: "smooth", block: "start" } });
    const subsection = rich.document.getElementById("subsection");
    rich.window.__intersectionObservers[0].callback([{ isIntersecting: true, intersectionRatio: 0.9, target: subsection }]);
    assert.equal(tocLink.classList.contains("is-active"), true);
    rich.window.__intersectionObservers[0].callback([{ isIntersecting: true, intersectionRatio: 0.9, target: section }]);
    assert.equal(tocLink.classList.contains("is-active"), true);
    rich.document.querySelector('.version-select[data-action="version-info"]').click();
    assert.ok(rich.document.querySelector(".toast"));

    const searchInput = rich.document.querySelector("#search-input");
    rich.document.querySelector('[data-action="open-search"]').click();
    searchInput.value = "   ";
    searchInput.dispatchEvent(new rich.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.match(rich.document.querySelector("#search-results").textContent, /输入关键词/);

    searchInput.value = "无结果";
    searchInput.dispatchEvent(new rich.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.match(rich.document.querySelector("#search-results").textContent, /没有找到相关内容/);

    searchInput.value = "搜索失败";
    searchInput.dispatchEvent(new rich.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.match(rich.document.querySelector("#search-results").textContent, /搜索失败/);

    searchInput.value = "指南";
    searchInput.dispatchEvent(new rich.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    searchInput.dispatchEvent(new rich.window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    searchInput.dispatchEvent(new rich.window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    searchInput.dispatchEvent(new rich.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await waitFor(() => rich.document.querySelector(".doc-article h1"));
    assert.equal(rich.window.location.search, "?doc=guide%2Fintro.md");

    rich.document.querySelector(".copy-button").click();
    await flush();
    assert.match(rich.document.querySelector(".toast-region").textContent, /复制失败/);

    rich.window.history.pushState({}, "", "/?doc=guide%2Fintro.md");
    rich.window.dispatchEvent(new rich.window.PopStateEvent("popstate"));
    rich.window.history.pushState({}, "", "/?doc=guide%2Fintro.md#%E0%A4%A");
    rich.window.dispatchEvent(new rich.window.PopStateEvent("popstate"));
    await flush();
    assert.equal(rich.document.querySelector(".doc-article h1").textContent, "指南入口");
  } finally {
    rich.cleanup();
  }
});

test("前端保留跨文档锚点并忽略过期文档、搜索响应", async () => {
  let releaseSlowDocument;
  let releaseOldSearch;
  let slowDocumentCalls = 0;
  const slowDocumentResponse = new Promise((resolve) => { releaseSlowDocument = resolve; });
  const oldSearchResponse = new Promise((resolve) => { releaseOldSearch = resolve; });
  const fastDocument = {
    ...baseDocument("guide/fast.md"),
    title: "快速文档",
    html: '<h1 id="快速文档">快速文档</h1><h2 id="chapter">章节</h2><button class="copy-button" type="button" data-copy="代码"><span>复制</span></button>',
    headings: [{ id: "快速文档", level: 1, title: "快速文档" }, { id: "chapter", level: 2, title: "章节" }]
  };
  const expiredDocument = {
    ...fastDocument,
    title: "过期文档",
    html: '<h1 id="过期文档">过期文档</h1><h2 id="chapter">章节</h2>',
    headings: [{ id: "过期文档", level: 1, title: "过期文档" }, { id: "chapter", level: 2, title: "章节" }]
  };
  const introDocument = {
    ...baseDocument(),
    html: '<h1 id="指南入口">指南入口</h1><a href="/?doc=guide%2Ffast.md#chapter" data-doc-path="guide/fast.md">打开章节</a>'
  };
  const config = {
    ...baseConfig,
    topbar: {
      ...baseConfig.topbar,
      links: [{ label: "慢文档", path: "guide/slow.md" }, { label: "快文档", path: "guide/fast.md" }]
    }
  };
  const mounted = await mountFrontend({
    config,
    tree: baseTree(),
    documents: [],
    defaultPath: "guide/intro.md",
    documentData: introDocument,
    fetchMode: (endpoint) => {
      const url = new URL(endpoint, "http://127.0.0.1:3000/");
      if (url.pathname === "/api/document" && url.searchParams.get("path") === "guide/slow.md") {
        slowDocumentCalls += 1;
        return slowDocumentCalls === 1 ? slowDocumentResponse : { ok: true, status: 200, json: async () => expiredDocument };
      }
      if (url.pathname === "/api/document" && url.searchParams.get("path") === "guide/fast.md") return { ok: true, status: 200, json: async () => fastDocument };
      if (url.pathname === "/api/search" && url.searchParams.get("q") === "旧关键词") return oldSearchResponse;
      if (url.pathname === "/api/search" && url.searchParams.get("q") === "新关键词") return { ok: true, status: 200, json: async () => ({ results: [{ path: "guide/fast.md", title: "快速文档", snippet: "新结果", icon: "rocket", iconColors: [] }] }) };
      return null;
    }
  });
  try {
    const crossDocumentLink = mounted.document.querySelector('.markdown-body [data-doc-path="guide/fast.md"]');
    crossDocumentLink.click();
    await waitFor(() => mounted.document.querySelector(".doc-article h1")?.textContent === "快速文档");
    assert.equal(mounted.window.location.search, "?doc=guide%2Ffast.md");
    assert.equal(mounted.window.location.hash, "#chapter");
    Object.defineProperty(mounted.window.navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
    mounted.document.querySelector(".copy-button").click();
    await waitFor(() => mounted.document.querySelector(".copy-button span")?.textContent === "已复制");
    assert.equal(mounted.document.querySelector('.side-nav__link[data-doc-path="guide/intro.md"]')?.getAttribute("aria-current"), null);

    const slowLink = mounted.document.querySelector('.topbar-link[data-doc-path="guide/slow.md"]');
    const fastLink = mounted.document.querySelector('.topbar-link[data-doc-path="guide/fast.md"]');
    slowLink.click();
    await flush();
    fastLink.click();
    await waitFor(() => mounted.document.querySelector(".doc-article h1")?.textContent === "快速文档");
    releaseSlowDocument({ ok: true, status: 200, json: async () => expiredDocument });
    await flush();
    assert.equal(mounted.document.querySelector(".doc-article h1").textContent, "快速文档");

    const searchButton = mounted.document.querySelector('[data-action="open-search"]');
    searchButton.focus();
    searchButton.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const searchInput = mounted.document.querySelector("#search-input");
    assert.equal(mounted.document.activeElement, searchInput);
    searchInput.value = "旧关键词";
    searchInput.dispatchEvent(new mounted.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    searchInput.value = "新关键词";
    searchInput.dispatchEvent(new mounted.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.match(mounted.document.querySelector("#search-results").textContent, /新结果/);
    releaseOldSearch({ ok: true, status: 200, json: async () => ({ results: [{ path: "guide/slow.md", title: "旧结果", snippet: "旧结果", icon: "file", iconColors: [] }] }) });
    await flush();
    assert.match(mounted.document.querySelector("#search-results").textContent, /新结果/);

    searchInput.dispatchEvent(new mounted.window.KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    mounted.document.dispatchEvent(new mounted.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(mounted.document.querySelector(".search-modal").classList.contains("is-open"), false);
    assert.equal(mounted.document.activeElement, searchButton);
    mounted.window.history.pushState({}, "", "/?doc=guide%2Fslow.md");
    mounted.window.dispatchEvent(new mounted.window.PopStateEvent("popstate"));
    await waitFor(() => mounted.document.querySelector(".doc-article h1")?.textContent === "过期文档");
  } finally {
    mounted.cleanup();
  }

});

test("前端兼容不完整配置、无标题文档、取消请求和缺失元标签", async () => {
  const abortError = () => {
    const error = new Error("请求已取消");
    error.name = "AbortError";
    return Promise.reject(error);
  };
  const documentData = {
    ...baseDocument("root.md"),
    title: "根文档",
    description: "根文档摘要",
    html: '<p>正文 <a href="http://[invalid" data-doc-path="root.md">重新打开</a></p>',
    headings: []
  };
  const config = {
    ...baseConfig,
    site: {
      ...baseConfig.site,
      brand: "单字品牌",
      seo: { keywords: "关键词", image: "/logo.png", author: "作者" },
      footer: { links: [null, { text: "文本页脚" }, { label: "" }] }
    },
    topbar: {
      search: true,
      themeToggle: false,
      links: [null, { label: "锚点", href: "#help" }, { label: "取消文档", path: "abort.md" }]
    },
    sidebar: { indent: "invalid", expandMode: "accordion", iconPalette: "invalid" }
  };
  const mounted = await mountFrontend({
    config,
    tree: [{ type: "file", path: "root.md", title: "根文档", icon: "file-markdown", iconColors: [] }],
    documents: [],
    defaultPath: "root.md",
    documentData,
    omitHeadMetadata: true,
    fetchMode: (endpoint) => {
      const url = new URL(endpoint, "http://127.0.0.1:3000/");
      if (url.pathname === "/api/document" && url.searchParams.get("path") === "abort.md") return abortError();
      if (url.pathname === "/api/search" && url.searchParams.get("q") === "中断") return abortError();
      return null;
    }
  });
  try {
    assert.equal(mounted.document.querySelector(".doc-title").textContent, "根文档");
    assert.equal(mounted.document.querySelectorAll(".toc__link").length, 0);
    assert.equal(mounted.document.querySelector('meta[name="keywords"]').content, "关键词");
    assert.equal(mounted.document.querySelector('meta[name="author"]').content, "作者");
    assert.equal(mounted.document.querySelector('link[rel="canonical"]').href, "http://127.0.0.1:3000/");
    assert.equal(mounted.document.querySelectorAll(".topbar-link").length, 2);
    assert.equal(mounted.document.querySelector('.topbar-link[href="#help"]').target, "");
    assert.match(mounted.document.querySelector("#doc-footer").textContent, /文本页脚/);

    mounted.document.querySelector('.topbar-link[data-doc-path="abort.md"]').click();
    await flush();
    assert.equal(mounted.document.querySelector(".doc-title").textContent, "根文档");

    const malformedLink = mounted.document.querySelector('.markdown-body [data-doc-path="root.md"]');
    malformedLink.click();
    await waitFor(() => mounted.document.querySelector(".doc-title")?.textContent === "根文档");

    const searchInput = mounted.document.querySelector("#search-input");
    searchInput.value = "中断";
    searchInput.dispatchEvent(new mounted.window.Event("input", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.doesNotMatch(mounted.document.querySelector("#search-results").textContent, /中断/);
  } finally {
    mounted.cleanup();
  }

  const emptyAbort = await mountFrontend({
    config: { ...baseConfig, topbar: { ...baseConfig.topbar, links: [{ label: "取消", path: "abort.md" }] } },
    tree: [],
    documents: [],
    defaultPath: "",
    documentData: baseDocument(),
    fetchMode: (endpoint) => endpoint.includes("abort.md") ? abortError() : null
  });
  try {
    emptyAbort.document.querySelector('.topbar-link[data-doc-path="abort.md"]').click();
    await flush();
    assert.ok(emptyAbort.document.querySelector(".empty-document"));
  } finally {
    emptyAbort.cleanup();
  }

  const minimal = await mountFrontend({
    config: {
      ...baseConfig,
      site: { ...baseConfig.site, brand: null, favicon: "https://example.com/icon.png", logo: { url: "data:image/png;base64,AA", alt: "Logo" }, seo: { image: "blob:https://example.com/image", keywords: "" }, footer: "invalid" },
      topbar: { version: "", search: false, themeToggle: false, links: [{ label: "纯文本" }] },
      sidebar: { indent: NaN, iconPalette: [] }
    },
    tree: [],
    documents: [],
    defaultPath: "root.md",
    documentData: { ...baseDocument("root.md"), headings: [], html: '<p><span data-icon-name=""></span><button class="copy-button" type="button" data-copy="代码"></button></p>' },
    disableAbortController: true
  });
  try {
    assert.equal(minimal.document.querySelector(".search-trigger"), null);
    assert.equal(minimal.document.querySelector(".theme-button"), null);
    assert.equal(minimal.document.querySelector("#site-favicon").type, "image/png");
    assert.equal(minimal.document.querySelector(".markdown-icon__svg").classList.contains("markdown-icon__svg"), true);
    assert.equal(minimal.document.querySelector("#doc-footer").hidden, true);
    assert.equal(minimal.document.querySelector(".topbar-link").getAttribute("href"), "#");
    Object.defineProperty(minimal.window.navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } });
    const copyButton = minimal.document.querySelector(".copy-button");
    copyButton.click();
    await waitFor(() => copyButton.classList.contains("is-copied"));
    await new Promise((resolve) => setTimeout(resolve, 1850));
    assert.equal(copyButton.classList.contains("is-copied"), false);
  } finally {
    minimal.cleanup();
  }
});
