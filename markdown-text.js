"use strict";

const YAML = require("yaml");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function normalizeSource(source) {
  return String(source ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

function parseValue(value) {
  const trimmed = String(value ?? "").trim();
  try {
    const parsed = YAML.parse(trimmed, { schema: "core" });
    if (parsed === null || ["string", "number", "boolean"].includes(typeof parsed) || Array.isArray(parsed)) return parsed;
  } catch { /* 宽容阅读损坏字段，发布校验另行报告准确位置。 */ }
  return trimmed;
}

function splitFrontMatter(source) {
  const lines = normalizeSource(source).split("\n");
  if (lines[0].trim() !== "---") return { attributes: {}, body: source };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) return { attributes: {}, body: source };
  let attributes = {};
  try {
    const parsed = YAML.parse(lines.slice(1, end).join("\n"), { schema: "core", prettyErrors: false });
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) attributes = parsed;
  } catch {
    // 阅读模式兼容历史简单字段；构建检查使用严格 YAML 校验。
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
    .replace(/\s+/g, " ").trim();
}

function humanizeName(value) {
  const clean = String(value || "").replace(/\.(markdown|md)$/i, "").replace(/^\d+[-_. ]*/, "").replace(/[-_]+/g, " ").trim();
  if (!clean) return String(value || "");
  if (/^(readme|index)$/i.test(clean)) return "首页";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function firstHeading(source) {
  const match = normalizeSource(source).match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? stripMarkdown(match[1]) : "";
}

function firstParagraph(source) {
  const paragraph = [];
  for (const line of normalizeSource(source).split("\n")) {
    if (!line.trim()) { if (paragraph.length) break; continue; }
    if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*(```|~~~)/.test(line)) continue;
    paragraph.push(line.trim());
  }
  return stripMarkdown(paragraph.join(" ")).slice(0, 130);
}

module.exports = { escapeHtml, normalizeSource, parseValue, splitFrontMatter, stripMarkdown, humanizeName, firstHeading, firstParagraph };
