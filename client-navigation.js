(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.DocsKitNavigation = factory;
})(typeof window === "undefined" ? globalThis : window, function createNavigation(context) {
  const { state, window, document, docUrl, staticBuildData, staticUrl, iconSvg, copyTextToClipboard, showToast } = context;
  const $ = (selector) => document.querySelector(selector);
  const sidebar = $("#sidebar");
  const overlay = $(".mobile-overlay");
  const mobileToc = $(".mobile-toc");
  const MOBILE_WIDTH = 680;
  const COMPACT_TOPBAR_WIDTH = 1100;
  const DEFAULT_NAV_INDENT = 12;
  const COPY_FEEDBACK_MS = 1800;
  const TOC_SCROLL_IDLE_MS = 160;
  const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
  let sidebarPreviousFocus = null;
  let tocScrollTimer;

  function config() { return state.config?.sidebar || {}; }
  function applyNavDepth(element, depth) {
    const value = Number(config().indent);
    const indent = Number.isFinite(value) ? Math.max(0, value) : DEFAULT_NAV_INDENT;
    element.style.setProperty("--nav-depth", depth);
    element.style.setProperty("--nav-offset", `${depth * indent}px`);
  }
  function applyNodeIconColor(element, node) {
    if (node.iconColor) element.style.setProperty("--nav-icon-color", node.iconColor);
  }
  function refreshNavHeight(group) {
    const children = group.querySelector(":scope > .side-nav__children");
    if (!children) return;
    const heading = group.querySelector(":scope > .side-nav__heading");
    children.style.maxHeight = heading?.getAttribute("aria-expanded") === "true" ? `${children.scrollHeight}px` : "0px";
    const parent = group.parentElement?.closest(".side-nav__group");
    if (parent) refreshNavHeight(parent);
  }
  function setGroupExpanded(group, expanded) {
    const heading = group.querySelector(":scope > .side-nav__heading");
    const children = group.querySelector(":scope > .side-nav__children");
    if (!heading || !children) return;
    if (!expanded && children.contains(document.activeElement)) heading.focus();
    heading.setAttribute("aria-expanded", String(expanded));
    children.classList.toggle("is-collapsed", !expanded);
    children.toggleAttribute("inert", !expanded);
    children.setAttribute("aria-hidden", String(!expanded));
    refreshNavHeight(group);
  }
  function collapseSiblingGroups(group) {
    group.parentElement?.querySelectorAll(":scope > .side-nav__group").forEach((sibling) => {
      if (sibling !== group) setGroupExpanded(sibling, false);
    });
  }
  function createSideLink(node, depth) {
    const link = document.createElement("a");
    link.className = "side-nav__link";
    link.href = docUrl(node.path);
    link.dataset.docPath = node.path;
    link.title = node.title;
    applyNavDepth(link, depth);
    applyNodeIconColor(link, node);
    link.innerHTML = iconSvg(node.icon, "side-nav__icon", node.iconColors);
    const label = document.createElement("span");
    label.className = "side-nav__label";
    label.textContent = node.title;
    link.appendChild(label);
    return link;
  }
  function createSideGroup(node, depth) {
    const group = document.createElement("div");
    group.className = "side-nav__group side-nav__group--dynamic";
    group.dataset.groupPath = node.path;
    const heading = document.createElement("button");
    heading.className = "side-nav__heading";
    heading.type = "button";
    heading.setAttribute("aria-expanded", "true");
    applyNavDepth(heading, depth);
    applyNodeIconColor(heading, node);
    heading.innerHTML = `<span class="side-nav__heading-label">${iconSvg(node.icon, "side-nav__icon", node.iconColors)}</span>`;
    heading.querySelector("span").appendChild(document.createTextNode(node.title));
    heading.insertAdjacentHTML("beforeend", iconSvg("chevron-down", "side-nav__chevron"));
    const children = document.createElement("div");
    children.className = "side-nav__children side-nav__children--dynamic";
    children.id = `nav-group-${encodeURIComponent(node.path)}`;
    heading.setAttribute("aria-controls", children.id);
    (node.children || []).forEach((child) => children.appendChild(child.type === "directory" ? createSideGroup(child, depth + 1) : createSideLink(child, depth + 1)));
    group.append(heading, children);
    const refreshParent = (event) => {
      if (event.target === children && event.propertyName === "max-height") refreshNavHeight(group);
    };
    children.addEventListener("transitionend", refreshParent);
    children.addEventListener("transitioncancel", refreshParent);
    return group;
  }
  function renderSidebar() {
    const site = state.config.site || {};
    const intro = $("#sidebar-intro");
    intro.replaceChildren();
    const eyebrow = document.createElement("span");
    eyebrow.className = "sidebar__eyebrow";
    eyebrow.textContent = site.eyebrow || "DOCUMENTATION";
    const title = document.createElement("h2");
    title.textContent = site.title || "我的文档";
    intro.append(eyebrow, title);
    const nav = $("#sidebar-nav");
    nav.replaceChildren();
    if (!state.tree.length) nav.innerHTML = '<div class="nav-empty">文档目录中还没有 Markdown 文件</div>';
    state.tree.forEach((node) => nav.appendChild(node.type === "directory" ? createSideGroup(node, 0) : createSideLink(node, 0)));
    const indent = Number(config().indent);
    nav.style.setProperty("--nav-indent", `${Number.isFinite(indent) ? Math.max(0, indent) : DEFAULT_NAV_INDENT}px`);
    const groups = Array.from(nav.querySelectorAll(".side-nav__group"));
    groups.forEach((group) => setGroupExpanded(group, config().expandMode !== "accordion"));
    if (config().expandMode === "accordion") {
      const active = state.currentPath || state.defaultPath || "";
      const matched = groups.filter((group) => active.startsWith(`${group.dataset.groupPath}/`));
      if (matched.length) matched.forEach((group) => { collapseSiblingGroups(group); setGroupExpanded(group, true); });
      else if (groups[0]) setGroupExpanded(groups[0], true);
    }
    $("#sidebar-footer").replaceChildren();
    syncSidebar();
  }
  function firstDocument(node) {
    if (node.type === "file") return node;
    // 目录首页优先采用直接子级的 README/index，其他目录落到首篇可见文档。
    return (node.children || []).find((child) => child.type === "file" && /(?:^|\/)(?:readme|index)\.md$/i.test(child.path))
      || (node.children || []).map(firstDocument).find(Boolean);
  }
  function renderBreadcrumb(data) {
    const breadcrumb = $("#breadcrumb");
    breadcrumb.replaceChildren();
    const home = document.createElement("a");
    home.href = staticBuildData() ? staticUrl("") : "/";
    home.textContent = "文档";
    breadcrumb.append(home);
    let nodes = state.tree;
    const parts = data.path.split("/");
    parts.slice(0, -1).forEach((part, index) => {
      const groupPath = parts.slice(0, index + 1).join("/");
      const group = nodes.find((node) => node.path === groupPath);
      const destination = group && firstDocument(group);
      const element = document.createElement(destination ? "a" : "span");
      element.textContent = group?.title || part.replace(/[-_]+/g, " ");
      if (destination) { element.href = docUrl(destination.path); element.dataset.docPath = destination.path; }
      breadcrumb.append(document.createTextNode("/"), element);
      nodes = group?.children || [];
    });
    const current = document.createElement("strong");
    current.textContent = data.title;
    current.setAttribute("aria-current", "page");
    breadcrumb.append(document.createTextNode("/"), current);
  }
  function motionBehavior() { return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"; }
  function saveReadingPosition() {
    if (!state.currentDocument || state.failedDocument || $("#doc-content").getAttribute("aria-busy") === "true") return;
    const position = { x: window.scrollX, y: window.scrollY };
    window.history.replaceState({ ...window.history.state, docskitScroll: position }, "");
  }
  function restoreReadingPosition(position, hash) {
    // 历史记录中的阅读位置优先于章节锚点，重新点击章节则使用锚点。
    window.requestAnimationFrame(() => {
      if (position && Number.isFinite(position.x) && Number.isFinite(position.y)) window.scrollTo({ left: Math.max(0, position.x), top: Math.max(0, position.y), behavior: "instant" });
      else scrollToHash(hash, "instant");
    });
  }
  function setActiveToc(id) {
    document.querySelectorAll(".toc__link").forEach((link) => {
      const active = link.dataset.headingId === id;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  }
  function releaseTocScroll(requestId = state.tocScrollRequestId) {
    if (requestId !== state.tocScrollRequestId) return;
    window.clearTimeout(tocScrollTimer);
    state.tocScrollTarget = "";
  }
  function interruptTocScroll() {
    if (!state.tocScrollTarget) return;
    state.tocScrollRequestId += 1;
    releaseTocScroll();
  }
  function scheduleTocScrollRelease() {
    if (!state.tocScrollTarget) return;
    window.clearTimeout(tocScrollTimer);
    const requestId = state.tocScrollRequestId;
    // 页尾可能无法把目标送入观察区域，滚动稳定后必须恢复普通目录追踪。
    tocScrollTimer = window.setTimeout(() => releaseTocScroll(requestId), TOC_SCROLL_IDLE_MS);
  }
  function navigateToHeading(id, href) {
    const target = document.getElementById(id);
    if (!target) return;
    state.tocScrollTarget = id;
    const requestId = ++state.tocScrollRequestId;
    window.clearTimeout(tocScrollTimer);
    setActiveToc(id);
    saveReadingPosition();
    window.history.pushState({}, "", href || `#${encodeURIComponent(id)}`);
    // 先将焦点移到正文，避免关闭目录后仍停留在不可见的链接中。
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
    if (mobileToc) mobileToc.open = false;
    window.requestAnimationFrame(() => {
      if (requestId !== state.tocScrollRequestId || state.tocScrollTarget !== id) return;
      target.scrollIntoView({ behavior: motionBehavior(), block: "start" });
      scheduleTocScrollRelease();
    });
  }
  function renderToc(headings) {
    releaseTocScroll();
    state.tocScrollRequestId += 1;
    const visible = (headings || []).filter((heading) => heading.level >= 2 && heading.level <= 4);
    if (mobileToc) {
      // 保留同一个目录节点；切换文档清理正文后再接到新首屏下方。
      const header = $("#doc-content .doc-header");
      if (header) header.after(mobileToc);
      else $("#doc-content").before(mobileToc);
      mobileToc.hidden = !visible.length;
      mobileToc.open = false;
    }
    for (const list of [$("#toc-list"), $("#mobile-toc-list")].filter(Boolean)) {
      list.replaceChildren();
      if (!visible.length) list.innerHTML = '<span class="toc-empty">当前页面没有小节</span>';
      visible.forEach((heading) => {
        const link = document.createElement("a");
        link.className = "toc__link";
        link.href = `#${encodeURIComponent(heading.id)}`;
        link.dataset.headingId = heading.id;
        link.style.setProperty("--toc-level", Math.max(0, heading.level - 2));
        link.textContent = heading.title;
        link.addEventListener("click", (event) => {
          if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          navigateToHeading(heading.id, link.getAttribute("href"));
        });
        list.appendChild(link);
      });
    }
  }
  function observeHeadings() {
    state.headingObserver?.disconnect();
    const headings = Array.from($("#doc-content").querySelectorAll("h2[id], h3[id], h4[id]"));
    if (!headings.length || typeof window.IntersectionObserver !== "function") return;
    state.headingObserver = new window.IntersectionObserver((entries) => {
      const requested = entries.find((entry) => entry.isIntersecting && entry.target.id === state.tocScrollTarget);
      if (requested) { releaseTocScroll(); setActiveToc(requested.target.id); return; }
      if (state.tocScrollTarget) return;
      const current = entries.filter((entry) => entry.isIntersecting).sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      if (current) setActiveToc(current.target.id);
    }, { rootMargin: "-96px 0px -62% 0px", threshold: [0, .2, .5, .9] });
    headings.forEach((heading) => state.headingObserver.observe(heading));
  }
  function scrollToHash(value, behavior) {
    const raw = String(value || "").replace(/^#/, "");
    if (!raw) { window.scrollTo({ top: 0, behavior: behavior || "instant" }); return; }
    let id = raw;
    try { id = decodeURIComponent(raw); } catch { /* 不合法编码保留原锚点。 */ }
    document.getElementById(id)?.scrollIntoView({ behavior: behavior === "smooth" ? motionBehavior() : behavior || motionBehavior(), block: "start" });
  }
  function setActiveNav(pathValue) {
    let active;
    document.querySelectorAll(".side-nav__link[data-doc-path]").forEach((link) => {
      const selected = link.dataset.docPath === pathValue;
      link.classList.toggle("is-active", selected);
      if (selected) { link.setAttribute("aria-current", "page"); active = link; }
      else link.removeAttribute("aria-current");
    });
    document.querySelectorAll(".side-nav__group[data-group-path]").forEach((group) => {
      if (pathValue.startsWith(`${group.dataset.groupPath}/`)) {
        if (config().expandMode === "accordion") collapseSiblingGroups(group);
        setGroupExpanded(group, true);
      }
    });
    if (active?.scrollIntoView && !sidebar.hasAttribute("inert")) window.requestAnimationFrame(() => active.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }
  function syncSidebar() {
    const mobile = window.innerWidth <= MOBILE_WIDTH;
    const open = mobile && sidebar.classList.contains("is-open");
    sidebar.toggleAttribute("inert", mobile && !open);
    sidebar.setAttribute("aria-hidden", String(mobile && !open));
    for (const target of [$("main"), $(".toc")].filter(Boolean)) target.toggleAttribute("inert", open);
    document.body.classList.toggle("is-sidebar-open", open);
    if (!mobile) {
      sidebar.classList.remove("is-open");
      overlay.classList.remove("is-open");
      $('[data-action="toggle-sidebar"]')?.setAttribute("aria-expanded", "false");
      sidebarPreviousFocus = null;
    }
  }
  function toggleSidebar(force, restoreFocus = true) {
    const trigger = $('[data-action="toggle-sidebar"]');
    const open = typeof force === "boolean" ? force : !sidebar.classList.contains("is-open");
    if (open) closeMenus();
    if (open && !sidebar.classList.contains("is-open")) sidebarPreviousFocus = document.activeElement;
    sidebar.classList.toggle("is-open", open);
    overlay.classList.toggle("is-open", open);
    trigger?.setAttribute("aria-expanded", String(open));
    syncSidebar();
    if (open && window.innerWidth <= MOBILE_WIDTH) sidebar.querySelector('a:not([inert] a), button:not([inert] button)')?.focus();
    if (!open && sidebarPreviousFocus) {
      const previous = sidebarPreviousFocus;
      sidebarPreviousFocus = null;
      if (restoreFocus && document.contains(previous)) previous.focus();
    }
  }
  function renderTopbarMenu(links, appendLink) {
    const menu = $("#mobile-topbar-links");
    const trigger = $('[data-action="toggle-topbar-menu"]');
    if (!menu || !trigger) return;
    menu.replaceChildren();
    links.forEach((link) => appendLink(menu, link));
    menu.querySelectorAll(".topbar-link").forEach((link) => { link.className = "mobile-topbar-link"; });
    trigger.hidden = !menu.children.length;
    menu.hidden = true;
  }
  function closeMenus() {
    const menu = $("#mobile-topbar-links");
    const focusedLink = menu?.contains(document.activeElement) ? document.activeElement.closest("a") : null;
    if (menu) menu.hidden = true;
    const trigger = $('[data-action="toggle-topbar-menu"]');
    trigger?.setAttribute("aria-expanded", "false");
    if (focusedLink) {
      // 横向扩大后更多按钮已隐藏，焦点接续到对应的桌面链接。
      const desktopLink = Array.from(document.querySelectorAll(".topbar-link")).find((link) => link.href === focusedLink.href);
      const destination = window.innerWidth > COMPACT_TOPBAR_WIDTH ? desktopLink || $(".brand") : trigger;
      destination?.focus({ preventScroll: true });
    }
  }
  function toggleTopbarMenu() {
    const menu = $("#mobile-topbar-links");
    const trigger = $('[data-action="toggle-topbar-menu"]');
    if (!menu || !trigger) return;
    if (!menu.hidden) { closeMenus(); return; }
    toggleSidebar(false, false);
    menu.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    menu.querySelector("a")?.focus();
  }
  function handleKeydown(event) {
    if (!event.defaultPrevented && SCROLL_KEYS.has(event.key) && !event.target.closest?.("input, textarea, select, button, [contenteditable]:not([contenteditable='false'])")) interruptTocScroll();
    if (event.key === "Escape") {
      if ($( "#mobile-topbar-links") && !$("#mobile-topbar-links").hidden) {
        closeMenus();
      }
      toggleSidebar(false);
    }
    if (event.key !== "Tab" || window.innerWidth > MOBILE_WIDTH || !sidebar.classList.contains("is-open")) return;
    const focusable = [$('[data-action="toggle-sidebar"]'), ...sidebar.querySelectorAll("a[href], button")].filter((element) => element && !element.closest("[inert]") && !element.hidden);
    const index = focusable.indexOf(document.activeElement);
    event.preventDefault();
    focusable[(index + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
  }
  function bindCopyFeedback(button, value, successMessage, errorMessage, iconOnly = false) {
    const original = { html: button.innerHTML, label: button.getAttribute("aria-label"), title: button.title };
    let copying = false;
    let resetTimer;
    const update = (phase, label, icon) => {
      button.dataset.copyState = phase;
      if (iconOnly) {
        button.innerHTML = iconSvg(icon, "heading-copy__icon");
        button.setAttribute("aria-label", `${original.label}：${label}`);
      } else button.textContent = label;
      button.title = label;
    };
    button.addEventListener("click", async () => {
      if (copying) return;
      copying = true;
      window.clearTimeout(resetTimer);
      button.setAttribute("aria-busy", "true");
      update("pending", "正在复制…", "clock");
      let success = false;
      try { await copyTextToClipboard(value()); success = true; }
      catch { /* 错误同时呈现在操作按钮及站点消息区域，方便就地重试。 */ }
      finally { copying = false; button.removeAttribute("aria-busy"); }
      // 已离开的文档不再显示过期复制反馈。
      if (!button.isConnected) return;
      update(success ? "success" : "error", success ? "已复制" : "复制失败", success ? "check" : "x-circle");
      showToast(success ? successMessage : errorMessage, success ? undefined : "error");
      resetTimer = window.setTimeout(() => {
        button.innerHTML = original.html;
        button.title = original.title;
        if (original.label !== null) button.setAttribute("aria-label", original.label);
        button.removeAttribute("data-copy-state");
      }, COPY_FEEDBACK_MS);
    });
  }
  function renderReadingTools(data) {
    const article = $("#doc-content");
    renderCodeGroups(article);
    const toolbar = document.createElement("div");
    toolbar.className = "document-toolbar";
    if (typeof data.markdown === "string") {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.dataset.action = "copy-markdown";
      copy.textContent = "复制 Markdown";
      bindCopyFeedback(copy, () => data.markdown, "Markdown 已复制", "复制失败，请下载 Markdown");
      toolbar.appendChild(copy);
    }
    if (data.markdownUrl) {
      const download = document.createElement("a");
      download.href = data.markdownUrl;
      download.download = data.path.split("/").at(-1);
      download.textContent = "下载 Markdown";
      toolbar.appendChild(download);
    }
    if (data.apiReference) {
      const api = document.createElement("a");
      api.href = "#docskit-api-reference";
      api.textContent = "查看 API 与在线调试";
      toolbar.appendChild(api);
    }
    if (toolbar.children.length) article.querySelector(".doc-meta")?.after(toolbar);
    const flattened = [];
    const visit = (nodes) => nodes.forEach((node) => node.type === "directory" ? visit(node.children || []) : flattened.push(node));
    visit(state.tree);
    const index = flattened.findIndex((node) => node.path === data.path);
    const pagination = document.createElement("nav");
    pagination.className = "doc-pagination";
    pagination.setAttribute("aria-label", "相邻文档");
    for (const [offset, relation, label] of [[-1, "prev", "上一篇"], [1, "next", "下一篇"]]) {
      const node = index >= 0 ? flattened[index + offset] : null;
      if (!node) continue;
      const link = document.createElement("a");
      link.href = docUrl(node.path);
      link.dataset.docPath = node.path;
      link.rel = relation;
      const caption = document.createElement("span");
      caption.textContent = label;
      const title = document.createElement("strong");
      title.textContent = node.title;
      link.append(caption, title);
      pagination.appendChild(link);
    }
    if (pagination.children.length) article.appendChild(pagination);
    article.querySelectorAll(".doc-header h1[id], .markdown-body h1[id], .markdown-body h2[id], .markdown-body h3[id], .markdown-body h4[id]").forEach((heading) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "heading-copy";
      button.dataset.action = "copy-heading-link";
      button.setAttribute("aria-label", `复制“${heading.textContent}”章节链接`);
      button.title = "复制章节链接";
      button.innerHTML = iconSvg("link", "heading-copy__icon");
      bindCopyFeedback(button, () => new URL(docUrl(data.path, encodeURIComponent(heading.id)), window.location.href).href, "章节链接已复制", "复制失败，请复制地址栏链接", true);
      heading.appendChild(button);
    });
  }

  function renderCodeGroups(article) {
    const groups = Array.from(article.querySelectorAll(".markdown-code-group"));
    const keyOf = (group) => group.dataset.codeGroup || "default";
    const storageKey = (group) => `docs-code-language:${keyOf(group)}`;
    const tabsOf = (group) => Array.from(group.querySelectorAll("[data-code-tab]"));
    const select = (group, tab) => {
      tabsOf(group).forEach((candidate) => {
        const selected = candidate === tab;
        candidate.setAttribute("aria-selected", String(selected));
        candidate.tabIndex = selected ? 0 : -1;
        const panel = document.getElementById(candidate.getAttribute("aria-controls"));
        if (panel && group.contains(panel)) panel.hidden = !selected;
      });
    };
    const activate = (group, tab, focus) => {
      const language = tab.dataset.codeLanguage;
      // 当前组按具体标签切换；其他组只同步语言，不覆盖同语言下已经选择的示例。
      select(group, tab);
      for (const related of groups.filter((entry) => entry !== group && keyOf(entry) === keyOf(group))) {
        const matches = tabsOf(related).filter((candidate) => candidate.dataset.codeLanguage === language);
        const match = matches.find((candidate) => candidate.getAttribute("aria-selected") === "true") || matches[0];
        if (match) select(related, match);
      }
      // 仅记录展示语言，不保存文档内容、请求参数或任何凭据。
      try { window.localStorage.setItem(storageKey(group), language); } catch { /* 隐私模式中保留本页切换。 */ }
      if (focus) tab.focus();
    };
    for (const group of groups) {
      const tabs = tabsOf(group);
      let preferred;
      try { preferred = window.localStorage.getItem(storageKey(group)); } catch { /* 存储不可用时使用默认语言。 */ }
      const selected = tabs.find((tab) => tab.dataset.codeLanguage === preferred) || tabs.find((tab) => tab.getAttribute("aria-selected") === "true") || tabs[0];
      if (selected) select(group, selected);
      tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => activate(group, tab, false));
        tab.addEventListener("keydown", (event) => {
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : -1;
          if (next < 0) return;
          event.preventDefault();
          activate(group, tabs[next], true);
        });
      });
    }
  }
  window.addEventListener("resize", () => { syncSidebar(); if (window.innerWidth > COMPACT_TOPBAR_WIDTH) closeMenus(); });
  if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  let saveScheduled = false;
  window.addEventListener("scroll", () => {
    scheduleTocScrollRelease();
    if (saveScheduled) return;
    saveScheduled = true;
    window.requestAnimationFrame(() => { saveScheduled = false; saveReadingPosition(); });
  }, { passive: true });
  window.addEventListener("scrollend", () => releaseTocScroll());
  window.addEventListener("wheel", interruptTocScroll, { passive: true });
  window.addEventListener("touchmove", interruptTocScroll, { passive: true });
  window.addEventListener("pagehide", saveReadingPosition);
  document.addEventListener("click", (event) => {
    if (event.target.closest("#mobile-topbar-links a") || !event.target.closest("#mobile-topbar-links, [data-action='toggle-topbar-menu']")) closeMenus();
  });
  return { renderSidebar, renderBreadcrumb, renderToc, observeHeadings, scrollToHash, setActiveNav, setGroupExpanded, collapseSiblingGroups, toggleSidebar, renderTopbarMenu, toggleTopbarMenu, closeMenus, handleKeydown, renderReadingTools, saveReadingPosition, restoreReadingPosition };
});
