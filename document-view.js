(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DocsKitDocument = factory();
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
  }

  function comparableText(value) { return String(value || "").replace(/\s+/g, "").trim(); }

  function renderDescription(data, presentation) {
    const description = comparableText(data.description);
    const opening = comparableText(presentation?.openingParagraph);
    const title = comparableText(presentation?.titleText || data.title);
    // 索引可能从首段自动生成摘要；阅读页保留原段落，避免首屏重复叙述。
    if (!description || description === title || (opening && opening.startsWith(description))) return "";
    return `<p class="lead doc-description">${escapeHtml(data.description)}</p>`;
  }

  function renderDocumentSection(data) {
    const documentPath = String(data.path || "");
    const category = documentPath.includes("/") ? documentPath.split("/").slice(0, -1).join(" / ") : "DOCUMENT";
    const html = String(data.html || "");
    const presentation = data.presentation;
    const hasHeading = (data.headings || []).some((heading) => heading.level === 1);
    // 偏移由 Markdown AST 的同一次渲染生成，既不解析 HTML，也不移动作者正文中的标题。
    const hasPromotedTitle = Boolean(presentation?.titleHtml) && Number.isInteger(presentation.bodyOffset) && presentation.bodyOffset > 0 && presentation.bodyOffset <= html.length && html.startsWith(presentation.titleHtml);
    const title = hasPromotedTitle ? presentation.titleHtml : hasHeading ? "" : `<h1 class="doc-title">${escapeHtml(data.title)}</h1>`;
    const body = hasPromotedTitle ? html.slice(presentation.bodyOffset) : html;
    const date = data.updatedAt ? new Date(data.updatedAt) : null;
    const updatedAt = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("zh-CN") : "";
    const metadata = `<div class="doc-meta"><span>${escapeHtml(documentPath)}</span>${updatedAt ? `<span aria-hidden="true">·</span><span>更新于 ${escapeHtml(updatedAt)}</span>` : ""}</div>`;
    return `<section class="doc-section markdown-section" id="doc-page" data-title="${escapeHtml(data.title)}"><header class="doc-header"><div class="section-kicker"><span class="kicker-line"></span>${escapeHtml(category)}</div>${title}${renderDescription(data, presentation)}${metadata}</header><div class="markdown-body">${body}</div></section>`;
  }

  return { renderDocumentSection };
});
