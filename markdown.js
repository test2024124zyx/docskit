"use strict";

const path = require("node:path");
const YAML = require("yaml");
const hljs = require("highlight.js/lib/common");
const katex = require("katex");
const { classifyAsset, isDownloadableAsset } = require("./media-types");

const DEFAULT_SECTION_PREFIX = "section";
const DEFAULT_CODE_LANGUAGE = "code";
const MAX_INLINE_RECURSION = 32;
const MATH_LANGUAGES = new Set(["math", "latex", "tex"]);
const DEFAULT_CODE_OPTIONS = {
  highlight: true,
  lineNumbers: true,
  copy: true,
  wrap: false
};
const FOOTNOTE_LABELS = {
  note: "提示",
  tip: "建议",
  important: "重要",
  warning: "注意",
  caution: "注意"
};
const ESCAPABLE_CHARACTERS = new Set("\\`*{}[]()#+-.!_>~|$");
const SAFE_LINK_SCHEMES = /^(?:https?:|mailto:|tel:)/i;
const SAFE_IMAGE_SCHEMES = /^(?:https?:|data:image\/(?:gif|jpeg|jpg|png|svg\+xml|webp);|blob:)/i;
const INLINE_AUTOLINK_PATTERN = /^(https?:\/\/[^\s<]+|www\.[^\s<]+)/i;
const EMAIL_AUTOLINK_PATTERN = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;
const AUTOLINK_TRAILING_PUNCTUATION = /[.,!?;:，。！？；：、…\]}}>"'’”»】》」』）]+$/;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function normalizeSource(source) {
  return String(source ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function parseValue(value) {
  const trimmed = String(value ?? "").trim();
  try {
    const parsed = YAML.parse(trimmed, { schema: "core" });
    if (parsed === null || ["string", "number", "boolean"].includes(typeof parsed) || Array.isArray(parsed)) return parsed;
  } catch (error) {
    // 单个字段解析失败时保留原文，避免一处错误让整篇文档无法显示。
  }
  return trimmed;
}

function splitFrontMatter(source) {
  const normalized = normalizeSource(source);
  const lines = normalized.split("\n");
  if (lines[0].trim() !== "---") return { attributes: {}, body: source };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { attributes: {}, body: source };
  const frontMatter = lines.slice(1, end).join("\n");
  let attributes = {};
  try {
    const parsed = YAML.parse(frontMatter, { schema: "core", prettyErrors: false });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attributes = parsed;
  } catch (error) {
    // 兼容历史文档：标准 YAML 失败时仍解析简单字段，不丢失正文。
    lines.slice(1, end).forEach((line) => {
      const match = line.match(/^\s*([\w-]+)\s*:\s*(.*)$/);
      if (match && !match[1].startsWith("#")) attributes[match[1]] = parseValue(match[2]);
    });
  }
  return { attributes, body: lines.slice(end + 1).join("\n") };
}

function stripMarkdown(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gi, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-+*] |^[ \t]*\d+[.)] /gm, "")
    .replace(/[>*_`~]/g, "")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>~|])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeName(value) {
  const withoutExtension = String(value || "").replace(/\.(markdown|md)$/i, "");
  const clean = withoutExtension.replace(/^\d+[-_. ]*/, "").replace(/[-_]+/g, " ").trim();
  if (!clean) return String(value || "");
  if (/^(readme|index)$/i.test(clean)) return "首页";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function firstHeading(source) {
  const match = normalizeSource(source).match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? stripMarkdown(match[1]) : "";
}

function firstParagraph(source) {
  const lines = normalizeSource(source).split("\n");
  const paragraph = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (paragraph.length) break;
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*(```|~~~)/.test(line)) continue;
    paragraph.push(line.trim());
  }
  return stripMarkdown(paragraph.join(" ")).slice(0, 130);
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeReferenceLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function leadingIndent(line) {
  const match = String(line || "").match(/^[ \t]*/)[0];
  return match.replace(/\t/g, "    ").length;
}

function stripIndent(line, amount) {
  let removed = 0;
  let index = 0;
  while (index < line.length && removed < amount && (line[index] === " " || line[index] === "\t")) {
    removed += line[index] === "\t" ? 4 : 1;
    index += 1;
  }
  return line.slice(index);
}

function isBlank(line) {
  return !String(line || "").trim();
}

function isEscaped(source, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) slashCount += 1;
  return slashCount % 2 === 1;
}

function isWordCharacter(character) {
  return Boolean(character) && /[\p{L}\p{N}_]/u.test(character);
}

function isFenceStart(line) {
  return String(line || "").match(/^\s{0,3}(`{3,}|~{3,})(?:[ \t]*(.*))?$/);
}

function isMathBlockDelimiter(line) {
  return /^\s{0,3}\$\$\s*$/.test(String(line || ""));
}

function isFenceClose(line, character, length) {
  const pattern = new RegExp(`^\\s{0,3}${character}{${length},}\\s*$`);
  return pattern.test(line);
}

function getListMarker(line) {
  const match = String(line || "").match(/^([ \t]*)([-+*]|\d+[.)])(?:[ \t]+)(.*)$/);
  if (!match) return null;
  return {
    indent: match[1].replace(/\t/g, "    ").length,
    marker: match[2],
    ordered: /^\d/.test(match[2]),
    start: /^\d/.test(match[2]) ? Number.parseInt(match[2], 10) : 1,
    content: match[3]
  };
}

function isThematicBreak(line) {
  return /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function splitTableRow(line) {
  const source = String(line || "").trim();
  const cells = [];
  let cell = "";
  let index = 0;
  const start = source.startsWith("|") ? 1 : 0;
  const end = source.endsWith("|") && !isEscaped(source, source.length - 1) ? source.length - 1 : source.length;
  for (index = start; index < end; index += 1) {
    if (source[index] === "\\" && index + 1 < end && source[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (source[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += source[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseTableAlignment(line) {
  const cells = splitTableRow(line);
  if (!cells.length || cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) return null;
  return cells.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
}

function isBlockStart(lines, index) {
  const line = lines[index];
  if (isBlank(line) || isFenceStart(line) || isMathBlockDelimiter(line) || /^\s{0,3}#{1,6}\s+/.test(line) || isThematicBreak(line) || /^\s{0,3}>/.test(line) || getListMarker(line)) return true;
  return index + 1 < lines.length && parseTableAlignment(lines[index + 1]);
}

function buildInlineScanState(source) {
  const escaped = new Uint8Array(source.length);
  let slashCount = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\\") {
      slashCount += 1;
      continue;
    }
    if (slashCount % 2 === 1) escaped[index] = 1;
    slashCount = 0;
  }
  const bracketClosings = new Int32Array(source.length);
  bracketClosings.fill(-1);
  const bracketStack = [];
  for (let index = 0; index < source.length; index += 1) {
    if (escaped[index]) continue;
    if (source[index] === "[") bracketStack.push(index);
    if (source[index] === "]" && bracketStack.length) bracketClosings[bracketStack.pop()] = index;
  }
  const delimiterClosings = new Map();
  ["***", "___", "**", "__", "~~", "*", "_"].forEach((delimiter) => {
    const closings = new Int32Array(source.length);
    closings.fill(-1);
    let nextClosing = -1;
    for (let index = source.length - delimiter.length; index >= 0; index -= 1) {
      if (source.startsWith(delimiter, index) && !escaped[index]) {
        const previous = source[index - 1];
        const next = source[index + delimiter.length];
        if (previous && !/\s/.test(previous) && (!next || !isWordCharacter(next))) nextClosing = index;
      }
      closings[index] = nextClosing;
    }
    delimiterClosings.set(delimiter, closings);
  });
  return { bracketClosings, delimiterClosings };
}

function findClosingBracket(source, start, scanState) {
  if (scanState?.bracketClosings) return scanState.bracketClosings[start] ?? -1;
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (isEscaped(source, index)) continue;
    if (source[index] === "[") depth += 1;
    if (source[index] === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function findClosingDelimiter(source, start, delimiter, scanState) {
  const closings = scanState?.delimiterClosings?.get(delimiter);
  if (closings) return closings[start] ?? -1;
  for (let index = start; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) {
      const previous = source[index - 1];
      const next = source[index + delimiter.length];
      if (previous && !/\s/.test(previous) && (!next || !isWordCharacter(next))) return index;
    }
  }
  return -1;
}

function readBalancedLink(source, openIndex) {
  let depth = 0;
  let quote = "";
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];
    if (isEscaped(source, index)) continue;
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (["\"", "'"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function parseLinkDestination(source, openIndex) {
  const closeIndex = readBalancedLink(source, openIndex);
  if (closeIndex < 0) return null;
  const inner = source.slice(openIndex + 1, closeIndex).trim();
  if (!inner) return null;
  let target = "";
  let title = "";
  let index = 0;
  if (inner.startsWith("<")) {
    const end = inner.indexOf(">");
    if (end < 0) return null;
    target = inner.slice(1, end);
    index = end + 1;
  } else {
    let depth = 0;
    while (index < inner.length) {
      if (inner[index] === "\\" && index + 1 < inner.length) {
        index += 2;
        continue;
      }
      if (inner[index] === "(") depth += 1;
      if (inner[index] === ")") depth -= 1;
      if (depth === 0 && /\s/.test(inner[index])) break;
      index += 1;
    }
    target = inner.slice(0, index);
  }
  while (index < inner.length && /\s/.test(inner[index])) index += 1;
  if (index < inner.length) {
    const quote = inner[index];
    const closing = quote === "\"" || quote === "'" ? quote : ")";
    if (quote !== "\"" && quote !== "'" && quote !== "(") return null;
    const titleStart = quote === "(" ? index + 1 : index + 1;
    const titleEnd = inner.lastIndexOf(closing);
    if (titleEnd <= titleStart) return null;
    title = inner.slice(titleStart, titleEnd);
    if (inner.slice(titleEnd + 1).trim()) return null;
  }
  return { target, title, nextIndex: closeIndex + 1 };
}

function createContext(currentPath, references = new Map(), footnotes = new Map(), links = {}) {
  return {
    currentPath: normalizeRelative(currentPath),
    references,
    footnotes,
    links,
    usedFootnotes: [],
    footnoteNumbers: new Map(),
    footnoteCounts: new Map(),
    inlineRecursion: 0
  };
}

function safeExternalTarget(target) {
  return SAFE_LINK_SCHEMES.test(target) ? target : "";
}

function markdownTarget(rawTarget, currentPath, kind, links = {}) {
  const target = String(rawTarget || "").trim();
  if (!target) return { href: "#", external: false };
  const external = safeExternalTarget(target);
  if (external) return { href: external, external: true };
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) return { href: "#", external: false };
  if (target.startsWith("#")) return { href: target, external: false };
  const hashIndex = target.indexOf("#");
  const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(currentPath)), pathPart));
  if (!resolved || resolved.startsWith("../") || resolved === ".." || resolved.includes("\0")) return { href: "#", external: false };
  if (/\.(md|markdown)$/i.test(pathPart)) {
    const href = typeof links.document === "function"
      ? links.document(resolved, hash)
      : `/?doc=${encodeURIComponent(resolved)}${hash}`;
    return { href, docPath: resolved, external: false };
  }
  const assetKind = classifyAsset(resolved);
  const endpoint = assetKind === "download" ? "/api/download" : "/api/asset";
  const href = typeof links.asset === "function"
    ? links.asset(resolved, assetKind)
    : `${endpoint}?path=${encodeURIComponent(resolved)}`;
  return {
    href,
    assetKind,
    assetPath: resolved,
    download: isDownloadableAsset(resolved),
    external: false
  };
}

function imageTarget(rawTarget, currentPath, links = {}) {
  const target = String(rawTarget || "").trim();
  const remoteMediaKind = classifyAsset(target);
  if (/^https?:/i.test(target) && ["video", "audio"].includes(remoteMediaKind)) {
    return { href: target, external: true, assetKind: remoteMediaKind };
  }
  if (SAFE_IMAGE_SCHEMES.test(target)) return { href: target, external: true };
  if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) return { href: "#", external: false };
  return markdownTarget(target, currentPath, "asset", links);
}

function renderCodeSpan(source, index) {
  let length = 0;
  while (source[index + length] === "`") length += 1;
  const marker = "`".repeat(length);
  const closeIndex = source.indexOf(marker, index + length);
  if (closeIndex < 0) return null;
  let code = source.slice(index + length, closeIndex).replace(/\n/g, " ");
  if (/^\s[\s\S]*\s$/.test(code) && /\S/.test(code)) code = code.slice(1, -1);
  return { html: `<code>${escapeHtml(code)}</code>`, nextIndex: closeIndex + length };
}

function renderAutolink(source, index) {
  const rest = source.slice(index);
  const match = rest.match(INLINE_AUTOLINK_PATTERN);
  if (match) {
    let value = match[1];
    while (AUTOLINK_TRAILING_PUNCTUATION.test(value)) value = value.slice(0, -1);
    while (value.endsWith(")") && (value.match(/\(/g) || []).length < (value.match(/\)/g) || []).length) {
      value = value.slice(0, -1);
    }
    if (value) {
      const href = value.startsWith("www.") ? `https://${value}` : value;
      return { html: `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`, nextIndex: index + value.length };
    }
  }
  return null;
}

function renderAngleAutolink(source, index) {
  const closeIndex = source.indexOf(">", index + 1);
  if (closeIndex < 0) return null;
  const value = source.slice(index + 1, closeIndex);
  if (SAFE_LINK_SCHEMES.test(value)) return { html: `<a href="${escapeHtml(value)}" target="_blank" rel="noreferrer">${escapeHtml(value)}</a>`, nextIndex: closeIndex + 1 };
  if (EMAIL_AUTOLINK_PATTERN.test(value) && EMAIL_AUTOLINK_PATTERN.exec(value)[0] === value) {
    return { html: `<a href="mailto:${escapeHtml(value)}">${escapeHtml(value)}</a>`, nextIndex: closeIndex + 1 };
  }
  return null;
}

function renderFootnoteReference(label, context) {
  const key = normalizeReferenceLabel(label);
  if (!context.footnotes.has(key)) return null;
  let number = context.footnoteNumbers.get(key);
  if (!number) {
    number = context.usedFootnotes.length + 1;
    context.footnoteNumbers.set(key, number);
    context.usedFootnotes.push(key);
  }
  const count = (context.footnoteCounts.get(key) || 0) + 1;
  context.footnoteCounts.set(key, count);
  const id = `fn-${slugify(key, number)}`;
  const referenceId = `${id}-ref${count > 1 ? `-${count}` : ""}`;
  return `<sup class="footnote-ref"><a href="#${id}" id="${referenceId}">[${number}]</a></sup>`;
}

function renderMathFormula(source, displayMode) {
  try {
    return katex.renderToString(String(source), { displayMode, throwOnError: false, trust: false, output: "htmlAndMathml" });
  } catch (error) {
    // 公式解析失败时仍展示经过转义的原文，保证正文可读且不执行输入内容。
    return `<code class="markdown-math__fallback">${escapeHtml(source)}</code>`;
  }
}

function findMathEnd(source, start, delimiter) {
  for (let index = start; index <= source.length - delimiter.length; index += 1) {
    if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index;
    if (source[index] === "\n") return -1;
  }
  return -1;
}

function renderMathAt(source, index) {
  let opening = "";
  let closing = "";
  let contentStart = index;
  if (source.startsWith("\\(", index)) {
    opening = "\\(";
    closing = "\\)";
    contentStart += opening.length;
  } else if (source[index] === "$" && source[index + 1] !== "$" && source[index + 1] && !/\s/.test(source[index + 1])) {
    opening = "$";
    closing = "$";
    contentStart += opening.length;
  } else {
    return null;
  }
  const end = findMathEnd(source, contentStart, closing);
  if (end < 0 || end === contentStart) return null;
  const formula = source.slice(contentStart, end);
  return { html: `<span class="markdown-math" role="img" aria-label="${escapeHtml(formula)}">${renderMathFormula(formula, false)}</span>`, nextIndex: end + closing.length };
}

function renderMathBlock(source) {
  return `<div class="markdown-math markdown-math--block" role="img" aria-label="${escapeHtml(source)}">${renderMathFormula(source, true)}</div>`;
}

function renderMedia(label, target, title, kind) {
  const mediaLabel = stripMarkdown(label).trim() || (kind === "video" ? "视频" : "音频");
  const tag = kind === "video" ? "video" : "audio";
  const inline = kind === "video" ? " playsinline" : "";
  const fallback = `<a href="${escapeHtml(target.href)}"${target.external ? ' target="_blank" rel="noreferrer"' : ""}>${escapeHtml(mediaLabel)}</a>`;
  const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
  return `<figure class="markdown-media markdown-media--${kind}"><${tag} class="markdown-media__player" controls preload="metadata"${inline} aria-label="${escapeHtml(mediaLabel)}" src="${escapeHtml(target.href)}"${titleAttribute}>${fallback}</${tag}><figcaption>${escapeHtml(mediaLabel)}</figcaption></figure>`;
}

function renderLinkAt(source, index, context, image = false, scanState) {
  const labelStart = image ? index + 2 : index + 1;
  if (image && source[index] !== "!" || source[labelStart - 1] !== "[") return null;
  const labelEnd = findClosingBracket(source, labelStart - 1, scanState);
  if (labelEnd < 0) return null;
  const label = source.slice(labelStart, labelEnd);
  let cursor = labelEnd + 1;
  let destination = null;
  if (source[cursor] === "(") destination = parseLinkDestination(source, cursor);
  else if (source[cursor] === "[") {
    const referenceEnd = findClosingBracket(source, cursor, scanState);
    if (referenceEnd >= 0) {
      const referenceLabel = source.slice(cursor + 1, referenceEnd) || label;
      const reference = context.references.get(normalizeReferenceLabel(referenceLabel));
      if (reference) destination = { ...reference, nextIndex: referenceEnd + 1 };
    }
  } else if (context.references.has(normalizeReferenceLabel(label))) {
    destination = { ...context.references.get(normalizeReferenceLabel(label)), nextIndex: labelEnd + 1 };
  }
  if (!destination) return null;
  const target = image
    ? imageTarget(destination.target, context.currentPath, context.links)
    : markdownTarget(destination.target, context.currentPath, "document", context.links);
  const title = destination.title ? ` title="${escapeHtml(destination.title)}"` : "";
  if (image) {
    if (target.assetKind === "video" || target.assetKind === "audio") {
      return { html: renderMedia(label, target, destination.title, target.assetKind), nextIndex: destination.nextIndex };
    }
    return { html: `<img src="${escapeHtml(target.href)}" alt="${escapeHtml(stripMarkdown(label))}"${title} loading="lazy" />`, nextIndex: destination.nextIndex };
  }
  const external = target.external ? ' target="_blank" rel="noreferrer"' : "";
  const docPath = target.docPath ? ` data-doc-path="${escapeHtml(target.docPath)}"` : "";
  const download = target.download ? " download" : "";
  return { html: `<a href="${escapeHtml(target.href)}"${external}${docPath}${download}${title}>${renderInlineTokens(label, context)}</a>`, nextIndex: destination.nextIndex };
}

function renderDelimiter(source, index, context, scanState) {
  const combinedDelimiter = source.startsWith("***", index) ? "***" : source.startsWith("___", index) ? "___" : "";
  if (combinedDelimiter) {
    const next = source[index + combinedDelimiter.length];
    const previous = source[index - 1];
    if (!next || /\s/.test(next) || (combinedDelimiter === "___" && isWordCharacter(previous) && isWordCharacter(next))) return null;
    const closeIndex = findClosingDelimiter(source, index + combinedDelimiter.length, combinedDelimiter, scanState);
    if (closeIndex >= 0) {
      const content = source.slice(index + combinedDelimiter.length, closeIndex);
      if (content.trim()) {
        // 三字符分隔符同时表达粗体和斜体，必须先于二字符规则匹配。
        return { html: `<strong><em>${renderInlineTokens(content, context)}</em></strong>`, nextIndex: closeIndex + combinedDelimiter.length };
      }
    }
  }
  const candidates = ["**", "__", "~~", "*", "_"];
  const delimiter = candidates.find((item) => source.startsWith(item, index));
  if (!delimiter) return null;
  const next = source[index + delimiter.length];
  const previous = source[index - 1];
  if (!next || /\s/.test(next) || (delimiter === "_" && isWordCharacter(previous) && isWordCharacter(next))) return null;
  const closeIndex = findClosingDelimiter(source, index + delimiter.length, delimiter, scanState);
  if (closeIndex < 0) return null;
  const content = source.slice(index + delimiter.length, closeIndex);
  if (!content.trim()) return null;
  const tag = delimiter === "**" || delimiter === "__" ? "strong" : delimiter === "~~" ? "del" : "em";
  return { html: `<${tag}>${renderInlineTokens(content, context)}</${tag}>`, nextIndex: closeIndex + delimiter.length };
}

function renderIcon(source, index) {
  const match = source.slice(index).match(/^:icon\[([A-Za-z][\w-]*)\]/);
  if (!match) return null;
  const name = escapeHtml(match[1]);
  return { html: `<span class="markdown-icon" data-icon-name="${name}" role="img" aria-label="${name}"></span>`, nextIndex: index + match[0].length };
}

function renderInlineTokens(source, context) {
  if (context.inlineRecursion >= MAX_INLINE_RECURSION) return escapeHtml(source);
  const scanState = buildInlineScanState(source);
  context.inlineRecursion += 1;
  let output = "";
  let textStart = 0;
  let index = 0;
  const append = (nextIndex, html) => {
    output += escapeHtml(source.slice(textStart, index)) + html;
    index = nextIndex;
    textStart = index;
  };
  while (index < source.length) {
    if (source.startsWith("\\(", index)) {
      const math = renderMathAt(source, index);
      if (math) {
        append(math.nextIndex, math.html);
        continue;
      }
    }
    if (source[index] === "\\") {
      if (source[index + 1] === "\n") {
        append(index + 2, "<br />\n");
      } else if (ESCAPABLE_CHARACTERS.has(source[index + 1])) {
        append(index + 2, escapeHtml(source[index + 1]));
      } else {
        index += 1;
      }
      continue;
    }
    if (source[index] === "\n") {
      const text = source.slice(textStart, index).replace(/ {2,}$/, "");
      const hardBreak = text.length !== source.slice(textStart, index).length;
      output += escapeHtml(text) + (hardBreak ? "<br />\n" : "\n");
      index += 1;
      textStart = index;
      continue;
    }
    let token = null;
    if (source[index] === "`") token = renderCodeSpan(source, index);
    else if (source[index] === "!" && source[index + 1] === "[") token = renderLinkAt(source, index, context, true, scanState);
    else if (source[index] === "[") {
      const footnoteEnd = source[index + 1] === "^" ? findClosingBracket(source, index, scanState) : -1;
      if (footnoteEnd >= 0) {
        const footnote = renderFootnoteReference(source.slice(index + 2, footnoteEnd), context);
        if (footnote) token = { html: footnote, nextIndex: footnoteEnd + 1 };
      }
      if (!token) token = renderLinkAt(source, index, context, false, scanState);
    } else if (source[index] === "<") token = renderAngleAutolink(source, index);
    else if (source[index] === ":") token = renderIcon(source, index);
    else if (source[index] === "$") token = renderMathAt(source, index);
    else if (["*", "_", "~"].includes(source[index])) token = renderDelimiter(source, index, context, scanState);
    else if ((index === 0 || !isWordCharacter(source[index - 1])) && /[hw]/i.test(source[index])) token = renderAutolink(source, index);
    if (token) {
      append(token.nextIndex, token.html);
      continue;
    }
    index += 1;
  }
  output += escapeHtml(source.slice(textStart));
  context.inlineRecursion -= 1;
  return output;
}

function collectDefinitions(lines) {
  const references = new Map();
  const footnotes = new Map();
  const skipped = new Set();
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const fenceStart = isFenceStart(lines[index]);
    if (fenceStart && !fence) {
      fence = { character: fenceStart[1][0], length: fenceStart[1].length };
      continue;
    }
    if (fence && isFenceClose(lines[index], fence.character, fence.length)) {
      fence = null;
      continue;
    }
    if (fence) continue;
    const footnote = lines[index].match(/^\s{0,3}\[\^([^\]]+)\]:\s*(.*)$/);
    if (footnote) {
      const content = [footnote[2]];
      skipped.add(index);
      index += 1;
      while (index < lines.length && (isBlank(lines[index]) || leadingIndent(lines[index]) >= 2)) {
        content.push(isBlank(lines[index]) ? "" : stripIndent(lines[index], 2));
        skipped.add(index);
        index += 1;
      }
      index -= 1;
      footnotes.set(normalizeReferenceLabel(footnote[1]), content);
      continue;
    }
    const reference = lines[index].match(/^\s{0,3}\[([^\]^]+)\]:\s*(?:<([^>]+)>|(\S+))(?:\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\)))?\s*$/);
    if (reference) {
      skipped.add(index);
      references.set(normalizeReferenceLabel(reference[1]), { target: reference[2] || reference[3], title: reference[4] || reference[5] || reference[6] || "" });
    }
  }
  return { references, footnotes, skipped };
}

function parseBlockquote(lines, start, context) {
  const quoteLines = [];
  let index = start;
  while (index < lines.length) {
    if (/^\s{0,3}>/.test(lines[index])) {
      quoteLines.push(lines[index].replace(/^\s{0,3}>[ \t]?/, ""));
      index += 1;
    } else if (isBlank(lines[index]) && /^\s{0,3}>/.test(lines[index + 1] || "")) {
      const nextQuote = (lines[index + 1] || "").replace(/^\s{0,3}>[ \t]?/, "");
      if (/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(nextQuote)) break;
      quoteLines.push("");
      index += 1;
    } else {
      break;
    }
  }
  const callout = quoteLines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
  const body = callout ? quoteLines.slice(1) : quoteLines;
  return { node: { type: "blockquote", callout: callout ? callout[1].toLowerCase() : "", children: parseBlocks(body, 0, body.length, context, new Set()) }, nextIndex: index };
}

function parseList(lines, start, context) {
  const first = getListMarker(lines[start]);
  const items = [];
  let current = null;
  let index = start;
  while (index < lines.length) {
    const marker = getListMarker(lines[index]);
    if (marker && marker.indent === first.indent && marker.ordered === first.ordered) {
      if (current) items.push(current);
      current = { lines: [marker.content], task: null };
      index += 1;
      continue;
    }
    if (!current || (!isBlank(lines[index]) && leadingIndent(lines[index]) <= first.indent)) break;
    current.lines.push(isBlank(lines[index]) ? "" : stripIndent(lines[index], first.indent + 2));
    index += 1;
  }
  if (current) items.push(current);
  items.forEach((item) => {
    const task = item.lines[0]?.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      item.task = task[1].toLowerCase() === "x";
      item.lines[0] = task[2];
    }
    item.children = parseBlocks(item.lines, 0, item.lines.length, context, new Set());
  });
  return { node: { type: "list", ordered: first.ordered, start: first.start, items }, nextIndex: index };
}

function preserveHardBreakSpaces(line) {
  const value = String(line || "");
  // 保留两个及以上的行尾空格，交给行内解析器生成 Markdown 硬换行。
  return / {2,}$/.test(value) ? value : value.trimEnd();
}

function parseBlocks(lines, start, end, context, skipped) {
  const nodes = [];
  let index = start;
  while (index < end) {
    if (skipped.has(index) || isBlank(lines[index])) {
      index += 1;
      continue;
    }
    if (isMathBlockDelimiter(lines[index])) {
      const formula = [];
      index += 1;
      while (index < end && !isMathBlockDelimiter(lines[index])) {
        formula.push(lines[index]);
        index += 1;
      }
      if (index < end) index += 1;
      nodes.push({ type: "math", code: formula.join("\n") });
      continue;
    }
    const fence = isFenceStart(lines[index]);
    if (fence) {
      const character = fence[1][0];
      const length = fence[1].length;
      const code = [];
      const language = (fence[2] || "").trim().split(/[ \t]+/)[0] || DEFAULT_CODE_LANGUAGE;
      index += 1;
      while (index < end && !isFenceClose(lines[index], character, length)) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < end) index += 1;
      nodes.push({ type: "code", language, code: code.join("\n") });
      continue;
    }
    const indentedCode = leadingIndent(lines[index]) >= 4;
    if (indentedCode) {
      const code = [];
      while (index < end && (isBlank(lines[index]) || leadingIndent(lines[index]) >= 4)) {
        code.push(isBlank(lines[index]) ? "" : stripIndent(lines[index], 4));
        index += 1;
      }
      while (code.length && !code[code.length - 1]) code.pop();
      nodes.push({ type: "code", language: DEFAULT_CODE_LANGUAGE, code: code.join("\n") });
      continue;
    }
    const heading = lines[index].match(/^\s{0,3}(#{1,6})[ \t]+(.+?)\s*#*\s*$/);
    if (heading) {
      nodes.push({ type: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }
    if (index + 1 < end && lines[index].trim() && /^(?:\s{0,3}=+|\s{0,3}-+)\s*$/.test(lines[index + 1])) {
      nodes.push({ type: "heading", level: lines[index + 1].trim().startsWith("=") ? 1 : 2, text: lines[index].trim() });
      index += 2;
      continue;
    }
    if (isThematicBreak(lines[index])) {
      nodes.push({ type: "thematicBreak" });
      index += 1;
      continue;
    }
    if (/^\s{0,3}>/.test(lines[index])) {
      const parsed = parseBlockquote(lines, index, context);
      nodes.push(parsed.node);
      index = parsed.nextIndex;
      continue;
    }
    if (getListMarker(lines[index])) {
      const parsed = parseList(lines, index, context);
      nodes.push(parsed.node);
      index = parsed.nextIndex;
      continue;
    }
    if (index + 1 < end && lines[index].includes("|")) {
      const alignment = parseTableAlignment(lines[index + 1]);
      if (alignment) {
        const header = splitTableRow(lines[index]);
        const rows = [];
        index += 2;
        while (index < end && !isBlank(lines[index]) && lines[index].includes("|") && !isBlockStart(lines, index)) {
          rows.push(splitTableRow(lines[index]));
          index += 1;
        }
        nodes.push({ type: "table", header, alignment, rows });
        continue;
      }
    }
    const paragraph = [preserveHardBreakSpaces(lines[index])];
    index += 1;
    while (index < end && !isBlank(lines[index]) && !skipped.has(index) && !isBlockStart(lines, index)) {
      paragraph.push(preserveHardBreakSpaces(lines[index]));
      index += 1;
    }
    nodes.push({ type: "paragraph", lines: paragraph });
  }
  return nodes;
}

function slugify(value, index) {
  const clean = stripMarkdown(value).toLocaleLowerCase().replace(/[^\w\u4e00-\u9fff -]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || `${DEFAULT_SECTION_PREFIX}-${index}`;
}

function renderInline(source, currentPath) {
  return renderInlineTokens(String(source ?? ""), createContext(currentPath));
}

function highlightedCode(code, language) {
  const normalizedLanguage = String(language || "").toLowerCase();
  if (!["code", "plain", "text", "txt"].includes(normalizedLanguage) && hljs.getLanguage(normalizedLanguage)) {
    try {
      return hljs.highlight(code, { language: normalizedLanguage, ignoreIllegals: true }).value;
    } catch (error) {
      // 语言插件遇到异常输入时回退到纯文本，不能让文档渲染失败。
    }
  }
  return escapeHtml(code);
}

function normalizeCodeOptions(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    ...DEFAULT_CODE_OPTIONS,
    highlight: typeof input.highlight === "boolean" ? input.highlight : DEFAULT_CODE_OPTIONS.highlight,
    lineNumbers: typeof input.lineNumbers === "boolean" ? input.lineNumbers : DEFAULT_CODE_OPTIONS.lineNumbers,
    copy: typeof input.copy === "boolean" ? input.copy : DEFAULT_CODE_OPTIONS.copy,
    wrap: typeof input.wrap === "boolean" ? input.wrap : DEFAULT_CODE_OPTIONS.wrap
  };
}

function normalizeRenderOptions(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const links = input.links && typeof input.links === "object" && !Array.isArray(input.links) ? input.links : {};
  return {
    code: normalizeCodeOptions(input.code),
    links: {
      document: typeof links.document === "function" ? links.document : null,
      asset: typeof links.asset === "function" ? links.asset : null
    }
  };
}

function renderCodeHeader(node, codeOptions) {
  const copyButton = codeOptions.copy
    ? `<button class="copy-button" type="button" data-copy="${escapeHtml(node.code)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 16V5a1 1 0 0 1 1-1h11" /></svg><span>复制</span></button>`
    : "";
  return `<div class="code-header"><span>${escapeHtml(node.language)}</span>${copyButton}</div>`;
}

function renderLineNumberGutter(code) {
  const lineCount = String(code ?? "").split("\n").length;
  const numbers = Array.from({ length: lineCount }, (_, index) => `<span class="markdown-code__line-number">${index + 1}</span>`).join("");
  return `<span class="markdown-code__gutter" aria-hidden="true">${numbers}</span>`;
}

function renderCodeBlock(node, options = {}) {
  const codeOptions = normalizeCodeOptions(options);
  const language = String(node.language || DEFAULT_CODE_LANGUAGE).toLowerCase();
  const header = renderCodeHeader(node, codeOptions);
  if (MATH_LANGUAGES.has(language)) return `<div class="code-block markdown-code" data-language="${escapeHtml(language)}">${header}${renderMathBlock(node.code)}</div>`;
  if (language === "mermaid") {
    return `<div class="code-block markdown-code markdown-diagram" data-language="mermaid">${header}<div class="markdown-mermaid__source" data-mermaid-source>${escapeHtml(node.code)}</div><pre class="markdown-mermaid__fallback"><code>${escapeHtml(node.code)}</code></pre></div>`;
  }
  const preClasses = ["markdown-code__pre", codeOptions.lineNumbers ? "markdown-code__pre--line-numbers" : "", codeOptions.wrap ? "markdown-code__pre--wrap" : ""].filter(Boolean).join(" ");
  const codeClasses = ["markdown-code__content", codeOptions.highlight ? "hljs" : ""].filter(Boolean).join(" ");
  const highlighted = codeOptions.highlight ? highlightedCode(node.code, language) : escapeHtml(node.code);
  const gutter = codeOptions.lineNumbers ? renderLineNumberGutter(node.code) : "";
  return `<div class="code-block markdown-code" data-language="${escapeHtml(language)}">${header}<pre class="${preClasses}">${gutter}<code class="${codeClasses}">${highlighted}</code></pre></div>`;
}

function renderListItem(item, context, state, renderOptions) {
  if (item.task === null) return renderBlocks(item.children, context, { inList: true }, state, renderOptions);
  const first = item.children[0];
  if (!first || first.type !== "paragraph") return renderBlocks(item.children, context, { inList: true }, state, renderOptions);
  const task = `<label class="task-item"><input type="checkbox" disabled${item.task ? " checked" : ""} />${renderInlineTokens(first.lines.join("\n"), context)}</label>`;
  return task + renderBlocks(item.children.slice(1), context, { inList: true }, state, renderOptions);
}

function createRenderState() {
  return { headings: [], headingIds: new Set() };
}

function renderBlocks(nodes, context, options = {}, state = createRenderState(), renderOptions = normalizeRenderOptions()) {
  const { headings, headingIds } = state;
  return nodes.map((node) => {
    if (node.type === "heading") {
      const id = slugify(node.text, headings.length + 1);
      let uniqueId = id;
      let suffix = 2;
      while (headingIds.has(uniqueId)) {
        uniqueId = `${id}-${suffix}`;
        suffix += 1;
      }
      headingIds.add(uniqueId);
      headings.push({ id: uniqueId, level: node.level, title: stripMarkdown(node.text) });
      return `<h${node.level} id="${escapeHtml(uniqueId)}">${renderInlineTokens(node.text, context)}</h${node.level}>`;
    }
    if (node.type === "paragraph") {
      const content = renderInlineTokens(node.lines.join("\n"), context);
      if (!options.inList && node.lines.length === 1 && /^<figure class="markdown-media /.test(content)) return content;
      return `<p>${content}</p>`;
    }
    if (node.type === "code") return renderCodeBlock(node, renderOptions.code);
    if (node.type === "math") return renderMathBlock(node.code);
    if (node.type === "thematicBreak") return "<hr />";
    if (node.type === "blockquote") {
      const content = renderBlocks(node.children, context, {}, state, renderOptions);
      if (node.callout) return `<aside class="markdown-callout markdown-callout--${node.callout}"><strong>${FOOTNOTE_LABELS[node.callout] || "提示"}</strong>${content}</aside>`;
      return `<blockquote>${content}</blockquote>`;
    }
    if (node.type === "list") {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start !== 1 ? ` start="${node.start}"` : "";
      return `<${tag}${start}>${node.items.map((item) => `<li>${renderListItem(item, context, state, renderOptions)}</li>`).join("")}</${tag}>`;
    }
    if (node.type === "table") {
      const align = (cell, index) => node.alignment[index] ? ` style="text-align:${node.alignment[index]}"` : "";
      const header = node.header.map((cell, index) => `<th${align(cell, index)}>${renderInlineTokens(cell, context)}</th>`).join("");
      const rows = node.rows.map((row) => `<tr>${node.header.map((_, index) => `<td${align(row[index], index)}>${renderInlineTokens(row[index] || "", context)}</td>`).join("")}</tr>`).join("");
      return `<div class="markdown-table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    return "";
  }).join("\n");
}

function renderFootnotes(context, state, renderOptions) {
  if (!context.usedFootnotes.length) return "";
  const { headings } = state;
  const entries = context.usedFootnotes.map((key, index) => {
    const id = `fn-${slugify(key, index + 1)}`;
    const content = parseBlocks(context.footnotes.get(key) || [], 0, (context.footnotes.get(key) || []).length, context, new Set());
    const body = renderBlocks(content, context, {}, state, renderOptions);
    const backLinks = Array.from({ length: context.footnoteCounts.get(key) || 1 }, (_, count) => `<a href="#${id}-ref${count ? `-${count + 1}` : ""}" class="footnote-backref">返回</a>`).join(" ");
    return `<li id="${id}">${body} ${backLinks}</li>`;
  }).join("");
  return `<section class="footnotes" aria-label="脚注"><hr /><ol>${entries}</ol></section>`;
}

function parseMarkdown(source, currentPath) {
  const lines = normalizeSource(source).split("\n");
  const definitions = collectDefinitions(lines);
  const context = createContext(currentPath, definitions.references, definitions.footnotes);
  const nodes = parseBlocks(lines, 0, lines.length, context, definitions.skipped);
  return { nodes, references: definitions.references, footnotes: definitions.footnotes };
}

function renderMarkdown(source, currentPath, options = {}) {
  const parsed = parseMarkdown(source, currentPath);
  const renderOptions = normalizeRenderOptions(options);
  const context = createContext(currentPath, parsed.references, parsed.footnotes, renderOptions.links);
  const state = createRenderState();
  const html = renderBlocks(parsed.nodes, context, {}, state, renderOptions) + renderFootnotes(context, state, renderOptions);
  return { html, headings: state.headings };
}

module.exports = {
  escapeHtml,
  parseValue,
  splitFrontMatter,
  stripMarkdown,
  humanizeName,
  firstHeading,
  firstParagraph,
  markdownTarget,
  renderInline,
  parseMarkdown,
  renderMarkdown
};
