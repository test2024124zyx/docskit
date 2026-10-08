"use strict";

const { documentPageUrl, normalizeSiteUrl } = require("./server-seo");
const MIN_CODE_FENCE_LENGTH = 3;
const JSON_INDENT_SPACES = 2;

function exportMarkdown(document) {
  const body = String(document.body || "");
  if (!document.apiReference?.spec) return body;
  // 只导出公开契约，避免把引用文件元数据或浏览器请求权限混入文档。
  const contract = JSON.stringify(document.apiReference.spec, null, JSON_INDENT_SPACES);
  let fenceLength = MIN_CODE_FENCE_LENGTH;
  for (const match of contract.matchAll(/`+/g)) fenceLength = Math.max(fenceLength, match[0].length + 1);
  const fence = "`".repeat(fenceLength);
  return `${body}${body ? "\n\n" : ""}## OpenAPI 合同\n\n${fence}json\n${contract}\n${fence}\n`;
}

function markdownLabel(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/([\\[\]])/g, "\\$1");
}

function markdownDocumentUrl(config, documentPath) {
  const relative = `api/markdown?path=${encodeURIComponent(documentPath)}`;
  return config.site?.url ? new URL(relative, normalizeSiteUrl(config.site.url)).href : `/${relative}`;
}

function renderLlms(documents, config, options = {}) {
  const title = markdownLabel(config.site?.title || "文档");
  const description = String(config.site?.description || "").replace(/[\r\n]+/g, " ");
  const lines = [`# ${title}`, "", ...(description ? [`> ${description}`, ""] : []), "## 文档", ""];
  for (const document of documents) {
    if (document.hidden) continue;
    const pageUrl = options.documentUrl ? options.documentUrl(document) : documentPageUrl(config, document.path);
    const sourceUrl = options.markdownUrl ? options.markdownUrl(document) : markdownDocumentUrl(config, document.path);
    if (options.full) {
      lines.push(`## ${markdownLabel(document.title)}`, "", `来源：${pageUrl}`, "", exportMarkdown(document), "");
    } else {
      const summary = String(document.description || "").replace(/[\r\n]+/g, " ");
      lines.push(`- [${markdownLabel(document.title)}](${sourceUrl})${summary ? `: ${summary}` : ""}`);
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

module.exports = { exportMarkdown, renderLlms, markdownDocumentUrl };
