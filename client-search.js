(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory;
  else root.DocsKitSearchUI = factory;
})(typeof window === "undefined" ? globalThis : window, function createSearch(context) {
  const { state, window, document, docUrl, iconSvg, escapeHtml, requestJson, staticBuildData, staticUrl, createAbortController, loadDocument, beforeOpen } = context;
  const modal = document.querySelector(".search-modal");
  const input = document.querySelector("#search-input");
  const results = document.querySelector("#search-results");
  const status = document.querySelector("#search-status");
  const SEARCH_DELAY_MS = 180;
  const SEARCH_LIMIT = 30;
  const searchCore = window.DocsKitSearch || (typeof require === "function" ? require("./search-core.js") : null);
  let currentQuery = "";
  let phase = "idle";
  let focusTimer;

  function announce(message) {
    if (status) status.textContent = message;
  }

  function clearSelection(nextPhase) {
    phase = nextPhase;
    state.searchResults = [];
    state.selectedSearchIndex = 0;
    input.removeAttribute("aria-activedescendant");
    results.setAttribute("aria-busy", String(nextPhase === "loading"));
  }

  function cancelSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = null;
    state.searchRequestId += 1;
    if (state.searchAbortController) state.searchAbortController.abort();
    state.searchAbortController = null;
  }

  function openSearch() {
    if (modal.classList.contains("is-open")) { input.focus(); return; }
    beforeOpen?.();
    cancelSearch();
    state.searchPreviousFocus = document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("is-modal-open");
    document.querySelector(".app-shell").setAttribute("inert", "");
    input.setAttribute("aria-expanded", "true");
    input.value = currentQuery = "";
    clearSelection("idle");
    results.innerHTML = '<span class="search-empty">输入关键词，搜索全部 Markdown 文档</span>';
    announce("输入关键词搜索文档");
    focusTimer = window.setTimeout(() => input.focus(), 20);
  }

  function closeSearch() {
    window.clearTimeout(focusTimer);
    cancelSearch();
    clearSelection("idle");
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    input.setAttribute("aria-expanded", "false");
    document.body.classList.remove("is-modal-open");
    document.querySelector(".app-shell").removeAttribute("inert");
    const previous = state.searchPreviousFocus;
    state.searchPreviousFocus = null;
    if (previous && document.contains(previous) && !previous.closest("[inert]")) previous.focus();
  }

  function syncSelection(scroll) {
    const options = Array.from(results.querySelectorAll('[role="option"]'));
    options.forEach((option, index) => {
      const selected = index === state.selectedSearchIndex;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-selected", String(selected));
    });
    const selected = options[state.selectedSearchIndex];
    if (!selected) return;
    input.setAttribute("aria-activedescendant", selected.id);
    if (scroll && typeof selected.scrollIntoView === "function") selected.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderSearchResults(items) {
    results.innerHTML = "";
    if (!items.length) {
      results.innerHTML = '<span class="search-empty">没有找到相关内容，试试其他关键词</span>';
      announce("没有找到相关内容");
      return;
    }
    items.forEach((result, index) => {
      const item = document.createElement("a");
      item.id = `search-option-${state.searchRequestId}-${index}`;
      item.className = "search-result";
      item.setAttribute("role", "option");
      item.tabIndex = -1;
      item.href = docUrl(result.path, result.hash);
      item.dataset.docPath = result.path;
      if (result.iconColor) item.style.setProperty("--nav-icon-color", result.iconColor);
      item.innerHTML = iconSvg(result.icon, "search-result__icon", result.iconColors);
      const copy = document.createElement("span");
      copy.className = "search-result__copy";
      // 文档一级标题常与页面同名，只为不同章节补充定位信息。
      const title = result.sectionTitle && result.sectionTitle !== result.title ? `${result.title} · ${result.sectionTitle}` : result.title;
      for (const [tag, value] of [["strong", title], ["small", result.path], ["em", result.snippet || result.description || ""]]) {
        const text = document.createElement(tag);
        appendHighlightedText(text, String(value || ""));
        copy.appendChild(text);
      }
      item.appendChild(copy);
      item.insertAdjacentHTML("beforeend", iconSvg("chevron-right", "search-result__arrow"));
      results.appendChild(item);
    });
    syncSelection(false);
    announce(`找到 ${items.length} 条结果，使用上下方向键选择`);
  }

  function appendHighlightedText(element, text) {
    // 只通过文本节点及 mark 创建高亮，查询内容不能进入 HTML 模板。
    const terms = currentQuery.toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const lower = text.toLocaleLowerCase();
    let offset = 0;
    while (offset < text.length) {
      const matches = terms.map((term) => ({ index: lower.indexOf(term, offset), length: term.length })).filter((match) => match.index >= 0).sort((a, b) => a.index - b.index || b.length - a.length);
      const match = matches[0];
      if (!match) { element.appendChild(document.createTextNode(text.slice(offset))); break; }
      element.appendChild(document.createTextNode(text.slice(offset, match.index)));
      const mark = document.createElement("mark");
      mark.textContent = text.slice(match.index, match.index + match.length);
      element.appendChild(mark);
      offset = match.index + match.length;
    }
  }

  function loadStaticSearchIndex() {
    if (!state.staticSearchPromise) {
      state.staticSearchPromise = requestJson(staticUrl("search-index.json")).then((payload) => Array.isArray(payload) ? payload : payload.documents || []).catch((error) => {
        state.staticSearchPromise = null;
        throw error;
      });
    }
    return state.staticSearchPromise;
  }

  async function runSearch(query) {
    cancelSearch();
    const requestId = state.searchRequestId;
    const normalized = query.trim();
    currentQuery = normalized;
    clearSelection(normalized ? "loading" : "idle");
    if (!normalized) {
      results.innerHTML = '<span class="search-empty">输入关键词，搜索全部 Markdown 文档</span>';
      announce("输入关键词搜索文档");
      return;
    }
    const controller = createAbortController();
    state.searchAbortController = controller;
    results.innerHTML = '<span class="search-empty"><span class="loading-spinner"></span>正在搜索正文...</span>';
    announce("正在搜索");
    try {
      const payload = staticBuildData()
        ? { results: searchCore.searchDocuments(await loadStaticSearchIndex(), normalized, { limit: SEARCH_LIMIT }) }
        : await requestJson(`/api/search?q=${encodeURIComponent(normalized)}`, controller ? { signal: controller.signal } : {});
      if (requestId !== state.searchRequestId) return;
      phase = "ready";
      results.setAttribute("aria-busy", "false");
      state.searchResults = payload.results || [];
      renderSearchResults(state.searchResults);
    } catch (error) {
      if (requestId !== state.searchRequestId || error.name === "AbortError") return;
      clearSelection("error");
      results.innerHTML = `<span class="search-empty">${escapeHtml(error.message || "搜索失败")}<button type="button" class="search-retry">重试搜索</button></span>`;
      announce(error.message || "搜索失败，可以重试");
      results.querySelector(".search-retry").addEventListener("click", () => runSearch(input.value));
    } finally {
      if (state.searchAbortController === controller) state.searchAbortController = null;
    }
  }

  input.addEventListener("input", (event) => {
    // 输入变化立即废弃旧结果，不能等防抖计时器启动后才取消旧查询。
    cancelSearch();
    currentQuery = input.value.trim();
    clearSelection(currentQuery ? "loading" : "idle");
    results.innerHTML = `<span class="search-empty">${currentQuery ? "正在搜索正文..." : "输入关键词，搜索全部 Markdown 文档"}</span>`;
    if (!event.isComposing) state.searchTimer = window.setTimeout(() => runSearch(input.value), SEARCH_DELAY_MS);
  });
  input.addEventListener("compositionend", () => { cancelSearch(); state.searchTimer = window.setTimeout(() => runSearch(input.value), SEARCH_DELAY_MS); });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing || phase !== "ready" || input.value.trim() !== currentQuery || !state.searchResults.length) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      state.selectedSearchIndex = (state.selectedSearchIndex + (event.key === "ArrowDown" ? 1 : -1) + state.searchResults.length) % state.searchResults.length;
      syncSelection(true);
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = state.searchResults[state.selectedSearchIndex];
      closeSearch();
      loadDocument(result.path, true, result.hash);
    }
  });
  return { openSearch, closeSearch };
});
