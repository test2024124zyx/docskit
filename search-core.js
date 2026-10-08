(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DocsKitSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const DEFAULT_LIMIT = 30;
  const MAX_QUERY_LENGTH = 200;
  const SNIPPET_LENGTH = 180;
  const SNIPPET_CONTEXT = 54;
  const TITLE_WEIGHT = 80;
  const PATH_WEIGHT = 45;
  const SECTION_WEIGHT = 30;
  const PROSE_WEIGHT = 4;
  const CODE_WEIGHT = 2;

  function snippet(value, terms) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    const lower = text.toLocaleLowerCase();
    const hits = terms.map((term) => lower.indexOf(term)).filter((index) => index >= 0);
    const start = Math.max(0, (hits.length ? Math.min(...hits) : 0) - SNIPPET_CONTEXT);
    const end = Math.min(text.length, start + SNIPPET_LENGTH);
    return `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }

  function searchDocuments(documents, query, options = {}) {
    const normalized = String(query || "").trim().toLocaleLowerCase();
    if (!normalized || normalized.length > MAX_QUERY_LENGTH) return [];
    const terms = [...new Set(normalized.split(/\s+/))];
    const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : DEFAULT_LIMIT;
    const results = [];
    for (const document of documents || []) {
      if (document.hidden) continue;
      const title = String(document.title || "");
      const path = String(document.path || "");
      const description = String(document.description || "");
      const titleLower = title.toLocaleLowerCase();
      const pathLower = path.toLocaleLowerCase();
      const fullText = `${title}\n${path}\n${description}\n${document.searchText || document.plainBody || ""}`.toLocaleLowerCase();
      if (!terms.every((term) => fullText.includes(term))) continue;
      const baseScore = (titleLower.includes(normalized) ? TITLE_WEIGHT : 0) + (pathLower.includes(normalized) ? PATH_WEIGHT : 0);
      const sections = document.sections?.length ? document.sections : [{ id: "", title: "", text: document.plainBody || description, code: "" }];
      let best = null;
      for (const section of sections) {
        const heading = String(section.title || "").toLocaleLowerCase();
        const text = String(section.text || "").toLocaleLowerCase();
        const code = String(section.code || "").toLocaleLowerCase();
        const sectionScore = terms.reduce((score, term) => score + (heading.includes(term) ? SECTION_WEIGHT : 0) + (text.includes(term) ? PROSE_WEIGHT : 0) + (code.includes(term) ? CODE_WEIGHT : 0), 0);
        if (!best || sectionScore > best.score) best = { section, score: sectionScore };
      }
      const section = best.section;
      const content = [section.text, section.code].filter(Boolean).join("\n") || document.plainBody || description;
      results.push({
        path, title, description, snippet: snippet(content, terms), score: baseScore + best.score,
        hash: best.score > 0 && section.id ? `#${section.id}` : "",
        sectionTitle: best.score > 0 ? section.title || "" : "",
        icon: document.icon, iconColor: document.iconColor, iconColors: document.iconColors
      });
    }
    return results.sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN") || left.path.localeCompare(right.path)).slice(0, limit);
  }

  return { searchDocuments, snippet, MAX_QUERY_LENGTH };
});
