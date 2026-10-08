"use strict";

const hljs = require("highlight.js/lib/common");
const { escapeHtml } = require("./markdown-text");
const DEFAULT_CODE_LANGUAGE = "code";
const LAZY_HIGHLIGHT_LINE_THRESHOLD = 100;
const LAZY_HIGHLIGHT_CHARACTER_THRESHOLD = 20000;
const MATH_LANGUAGES = new Set(["math", "latex", "tex"]);
const DEFAULT_CODE_OPTIONS = { highlight: true, lineNumbers: true, copy: true, wrap: false };

function highlightedCode(code, language) {
  const normalized = String(language || "").toLowerCase();
  if (!["code", "plain", "text", "txt"].includes(normalized) && hljs.getLanguage(normalized)) {
    try { return hljs.highlight(code, { language: normalized, ignoreIllegals: true }).value; }
    catch { /* 语言插件失败时保留安全的原始代码。 */ }
  }
  return escapeHtml(code);
}

function normalizeCodeOptions(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(Object.entries(DEFAULT_CODE_OPTIONS).map(([key, fallback]) => [key, typeof input[key] === "boolean" ? input[key] : fallback]));
}

function renderCodeHeader(node, options) {
  const copy = options.copy ? `<button class="copy-button" type="button" data-copy="${escapeHtml(node.code)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 16V5a1 1 0 0 1 1-1h11" /></svg><span>复制</span></button>` : "";
  return `<div class="code-header"><span>${escapeHtml(node.label || node.language)}</span>${copy}</div>`;
}

// 跨行高亮标签逐行闭合并重开，复制内容和行号不受嵌套 span 影响。
function wrapHighlightedCode(html) {
  const source = String(html);
  const openTags = [];
  const lines = [];
  let line = "";
  let offset = 0;
  const append = () => {
    const empty = line.replace(/<\/?span\b[^>]*>/g, "") === "";
    lines.push(`<span class="markdown-code__line"${empty ? ' data-code-empty=""' : ""}>${line}${empty ? " " : ""}${"</span>".repeat(openTags.length)}</span>`);
    line = openTags.join("");
  };
  for (const token of source.matchAll(/<\/?span\b[^>]*>|\n/g)) {
    line += source.slice(offset, token.index);
    if (token[0] === "\n") append();
    else {
      line += token[0];
      if (token[0].startsWith("</")) openTags.pop();
      else openTags.push(token[0]);
    }
    offset = token.index + token[0].length;
  }
  line += source.slice(offset);
  append();
  return lines.join("");
}

function renderCodeBlock(node, options = {}, renderMathBlock) {
  const settings = normalizeCodeOptions(options);
  const language = String(node.language || DEFAULT_CODE_LANGUAGE).toLowerCase();
  const header = renderCodeHeader(node, settings);
  if (MATH_LANGUAGES.has(language)) return `<div class="code-block markdown-code" data-language="${escapeHtml(language)}">${header}${renderMathBlock(node.code)}</div>`;
  if (language === "mermaid") return `<div class="code-block markdown-code markdown-diagram" data-language="mermaid">${header}<div class="markdown-mermaid__source" data-mermaid-source>${escapeHtml(node.code)}</div><pre class="markdown-mermaid__fallback"><code>${escapeHtml(node.code)}</code></pre></div>`;
  const source = String(node.code || "");
  const lazy = settings.highlight && (source.length > LAZY_HIGHLIGHT_CHARACTER_THRESHOLD || source.split("\n").length > LAZY_HIGHLIGHT_LINE_THRESHOLD);
  const highlighted = settings.highlight && !lazy;
  const preClasses = ["markdown-code__pre", settings.lineNumbers ? "markdown-code__pre--line-numbers" : "", settings.wrap ? "markdown-code__pre--wrap" : ""].filter(Boolean).join(" ");
  const codeClasses = ["markdown-code__content", highlighted ? "hljs" : ""].filter(Boolean).join(" ");
  const content = wrapHighlightedCode(highlighted ? highlightedCode(source, language) : escapeHtml(source));
  return `<div class="code-block markdown-code" data-language="${escapeHtml(language)}"${lazy ? ` data-lazy-highlight="${escapeHtml(language)}"` : ""}>${header}<pre class="${preClasses}"><code class="${codeClasses}">${content}</code></pre></div>`;
}

function renderCodeGroup(node, groupIndex, options, renderMathBlock) {
  const groupId = `code-group-${groupIndex}`;
  const tabs = node.children.map((child, index) => `<button type="button" role="tab" id="${groupId}-tab-${index}" data-code-tab data-code-language="${escapeHtml(child.language)}" aria-controls="${groupId}-panel-${index}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}">${escapeHtml(child.label || child.language)}</button>`).join("");
  const panels = node.children.map((child, index) => `<div role="tabpanel" data-code-panel id="${groupId}-panel-${index}" aria-labelledby="${groupId}-tab-${index}"${index ? " hidden" : ""}>${renderCodeBlock(child, options, renderMathBlock)}</div>`).join("");
  return `<div class="markdown-code-group" data-code-group="${escapeHtml(node.key || "language")}"><div role="tablist" aria-label="代码示例语言">${tabs}</div>${panels}</div>`;
}

module.exports = { renderCodeBlock, renderCodeGroup, wrapHighlightedCode, normalizeCodeOptions };
