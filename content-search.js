"use strict";

const { parseMarkdown, stripMarkdown, slugify } = require("./markdown");

// 直接遍历渲染器的语法树，确保代码内容与章节锚点不会在索引时丢失。
function buildSearchFields(body, documentPath) {
  const parsed = parseMarkdown(body, documentPath);
  const sections = [];
  const headingIds = new Set();
  let current = { id: "", title: "", text: "", code: "" };
  let headingCount = 0;
  const append = (value, isCode = false) => {
    const source = String(value || "");
    if (isCode) current.code += `\n${source}`;
    else {
      current.text += `\n${stripMarkdown(source)}`;
      // 行内代码同样包含接口标识；保留其中的下划线等语义字符。
      for (const match of source.matchAll(/(`+)([\s\S]*?)\1/g)) current.code += `\n${match[2]}`;
    }
  };
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.type === "heading") {
        if (current.id || current.text.trim() || current.code.trim()) sections.push(current);
        const base = slugify(node.text, ++headingCount);
        let id = base;
        let suffix = 2;
        while (headingIds.has(id)) id = `${base}-${suffix++}`;
        headingIds.add(id);
        current = { id, title: stripMarkdown(node.text), text: "", code: "" };
      } else if (node.type === "code" || node.type === "math") append(node.code, true);
      else if (node.type === "paragraph") append(node.lines.join("\n"));
      else if (node.type === "table") {
        append(node.header.join(" "));
        node.rows.forEach((row) => append(row.join(" ")));
      } else if (node.type === "list") node.items.forEach((item) => visit(item.children));
      else if (node.children) visit(node.children);
    }
  };
  visit(parsed.nodes);
  if (current.id || current.text.trim() || current.code.trim()) sections.push(current);
  const normalized = sections.map((section) => ({ ...section, text: section.text.trim(), code: section.code.trim() }));
  const plainBody = normalized.map((section) => [section.title, section.text, section.code].filter(Boolean).join("\n")).join("\n");
  return { plainBody, searchText: plainBody.toLocaleLowerCase(), sections: normalized };
}

module.exports = { buildSearchFields };
