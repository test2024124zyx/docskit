const http = require("node:http");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
const DEFAULT_CONFIG = {
  docsDir: "docs",
  site: {
    brand: { name: "docs", accent: "kit" },
    context: "文档",
    eyebrow: "DOCUMENTATION",
    title: "我的文档",
    description: "按目录组织的 Markdown 知识库"
  },
  topbar: {
    version: "v1.0.0",
    links: [],
    search: true,
    themeToggle: true
  },
  sidebar: {
    defaultFileIcon: "file-text",
    defaultFolderIcon: "folder",
    icons: {},
    footer: {}
  }
};

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--docs") args.docsDir = argv[index + 1];
    if (argv[index] === "--config") args.configPath = argv[index + 1];
    if (argv[index] === "--port") args.port = argv[index + 1];
  }
  return args;
}

const cliArgs = parseArgs(process.argv.slice(2));
const port = Number(cliArgs.port || process.env.PORT || 3000);

function mergeConfig(source) {
  const input = source && typeof source === "object" ? source : {};
  return {
    ...DEFAULT_CONFIG,
    ...input,
    site: { ...DEFAULT_CONFIG.site, ...(input.site || {}) },
    topbar: { ...DEFAULT_CONFIG.topbar, ...(input.topbar || {}) },
    sidebar: { ...DEFAULT_CONFIG.sidebar, ...(input.sidebar || {}) }
  };
}

function resolveFromRoot(value) {
  if (!value) return ROOT_DIR;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT_DIR, value);
}

async function loadConfig() {
  const configPath = resolveFromRoot(cliArgs.configPath || process.env.DOCS_CONFIG || "docs.config.json");
  let parsed = {};
  try {
    parsed = JSON.parse(await fsp.readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`无法读取配置文件 ${configPath}: ${error.message}`);
  }
  const config = mergeConfig(parsed);
  const docsSetting = cliArgs.docsDir || process.env.DOCS_DIR || config.docsDir || "docs";
  return { config, configPath, docsDir: resolveFromRoot(docsSetting) };
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function safeResolve(root, input) {
  const normalized = normalizeRelative(input);
  if (!normalized || normalized.includes("\0")) throw new Error("无效路径");
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("路径超出文档目录");
  return resolved;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function parseValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function splitFrontMatter(source) {
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (lines[0].trim() !== "---") return { attributes: {}, body: source };
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (end < 0) return { attributes: {}, body: source };
  const attributes = {};
  lines.slice(1, end).forEach((line) => {
    const match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (match) attributes[match[1]] = parseValue(match[2]);
  });
  return { attributes, body: lines.slice(end + 1).join("\n") };
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/[>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeName(value) {
  const withoutExtension = value.replace(/\.(markdown|md)$/i, "");
  const clean = withoutExtension.replace(/^\d+[-_. ]*/, "").replace(/[-_]+/g, " ").trim();
  if (!clean) return value;
  if (/^(readme|index)$/i.test(clean)) return "首页";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function firstHeading(source) {
  const match = source.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m);
  return match ? stripMarkdown(match[1]) : "";
}

function firstParagraph(source) {
  const lines = source.split(/\r?\n/);
  const paragraph = [];
  for (const line of lines) {
    if (!line.trim()) {
      if (paragraph.length) break;
      continue;
    }
    if (/^\s{0,3}#{1,6}\s+/.test(line) || /^\s*```/.test(line)) continue;
    paragraph.push(line.trim());
  }
  return stripMarkdown(paragraph.join(" ")).slice(0, 130);
}

function compareNames(left, right) {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

function configuredIcon(sidebar, relativePath, type, frontMatterIcon) {
  const settings = sidebar || {};
  const generic = settings.icons || {};
  const specific = type === "directory" ? settings.folderIcons || {} : settings.fileIcons || {};
  const noExtension = relativePath.replace(/\.(markdown|md)$/i, "");
  const candidates = [relativePath, noExtension];
  if (type === "directory") candidates.push(relativePath.replace(/\/$/, ""));
  for (const key of candidates) {
    if (specific[key]) return specific[key];
    if (generic[key]) return generic[key];
  }
  if (frontMatterIcon) return frontMatterIcon;
  return type === "directory" ? settings.defaultFolderIcon : settings.defaultFileIcon;
}

async function scanDocuments(docsDir) {
  const documents = [];
  async function walk(directory, prefix) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return compareNames(left.name, right.name);
    });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!/\.(md|markdown)$/i.test(entry.name)) continue;
      const raw = await fsp.readFile(absolutePath, "utf8");
      const front = splitFrontMatter(raw);
      const baseName = entry.name.replace(/\.(markdown|md)$/i, "");
      const parent = prefix ? prefix.split("/").pop() : "";
      const inferredTitle = /^(readme|index)$/i.test(baseName) && parent ? humanizeName(parent) : humanizeName(entry.name);
      const title = String(front.attributes.title || firstHeading(front.body) || inferredTitle);
      documents.push({
        type: "file",
        path: relativePath,
        title,
        description: String(front.attributes.description || firstParagraph(front.body) || ""),
        order: typeof front.attributes.order === "number" ? front.attributes.order : Number.MAX_SAFE_INTEGER,
        icon: front.attributes.icon || "",
        hidden: front.attributes.hidden === true,
        raw,
        body: front.body,
        updatedAt: (await fsp.stat(absolutePath)).mtime.toISOString()
      });
    }
  }
  await walk(docsDir, "");
  return documents.filter((document) => !document.hidden);
}

function sortNodes(nodes) {
  return nodes.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return compareNames(left.title, right.title);
  });
}

function createTree(documents, config) {
  const root = { type: "directory", path: "", title: "", children: [] };
  for (const document of documents) {
    const segments = document.path.split("/");
    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const folderPath = segments.slice(0, index + 1).join("/");
      let folder = current.children.find((node) => node.type === "directory" && node.path === folderPath);
      if (!folder) {
        folder = {
          type: "directory",
          path: folderPath,
          title: humanizeName(segments[index]),
          order: Number.MAX_SAFE_INTEGER,
          icon: configuredIcon(config.sidebar, folderPath, "directory"),
          children: []
        };
        current.children.push(folder);
      }
      current = folder;
    }
    current.children.push({
      type: "file",
      path: document.path,
      title: document.title,
      description: document.description,
      order: document.order,
      icon: configuredIcon(config.sidebar, document.path, "file", document.icon),
      updatedAt: document.updatedAt
    });
  }
  function sortTree(node) {
    sortNodes(node.children);
    node.children.forEach((child) => { if (child.type === "directory") sortTree(child); });
  }
  sortTree(root);
  return root.children;
}

function encodePath(value) {
  return normalizeRelative(value).split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

function slugify(value, index) {
  const clean = stripMarkdown(value).toLowerCase().replace(/[^\w\u4e00-\u9fff -]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || `section-${index}`;
}

function markdownTarget(rawTarget, currentPath, kind) {
  const target = String(rawTarget || "").trim();
  if (/^(https?:|mailto:|tel:|data:)/i.test(target)) return { href: target, external: true };
  if (target.startsWith("#")) return { href: target, external: false };
  const hashIndex = target.indexOf("#");
  const pathPart = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
  const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(currentPath)), pathPart));
  if (resolved.startsWith("../") || resolved === "..") return { href: "#", external: false };
  if (kind === "document" || /\.(md|markdown)$/i.test(pathPart)) {
    return { href: `/?doc=${encodeURIComponent(resolved)}${hash}`, docPath: resolved, external: false };
  }
  return { href: `/api/asset?path=${encodeURIComponent(resolved)}`, external: false };
}

function renderInline(source, currentPath) {
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<!\w)\*([^*]+)\*(?!\w)/g;
  let result = "";
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source))) {
    result += escapeHtml(source.slice(cursor, match.index));
    if (match[1] !== undefined) {
      const target = markdownTarget(match[2], currentPath, "asset");
      const title = match[3] ? ` title="${escapeHtml(match[3])}"` : "";
      result += `<img src="${escapeHtml(target.href)}" alt="${escapeHtml(match[1])}"${title} loading="lazy" />`;
    } else if (match[4] !== undefined) {
      const target = markdownTarget(match[5], currentPath, "document");
      const external = target.external ? ' target="_blank" rel="noreferrer"' : "";
      const docPath = target.docPath ? ` data-doc-path="${escapeHtml(target.docPath)}"` : "";
      const title = match[6] ? ` title="${escapeHtml(match[6])}"` : "";
      result += `<a href="${escapeHtml(target.href)}"${external}${docPath}${title}>${escapeHtml(match[4])}</a>`;
    } else if (match[7] !== undefined) result += `<code>${escapeHtml(match[7])}</code>`;
    else if (match[8] !== undefined || match[9] !== undefined) result += `<strong>${escapeHtml(match[8] || match[9])}</strong>`;
    else if (match[10] !== undefined) result += `<del>${escapeHtml(match[10])}</del>`;
    else if (match[11] !== undefined) result += `<em>${escapeHtml(match[11])}</em>`;
    cursor = pattern.lastIndex;
  }
  return result + escapeHtml(source.slice(cursor));
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function renderMarkdown(source, currentPath) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const html = [];
  const headings = [];
  const usedIds = new Set();
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = line.match(/^\s{0,3}(```+|~~~+)\s*([^ ]*)\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}${fence[1][0]}{3,}\\s*$`).test(lines[index])) { codeLines.push(lines[index]); index += 1; }
      if (index < lines.length) index += 1;
      const language = fence[2] || "code";
      const code = codeLines.join("\n");
      html.push(`<div class="code-block markdown-code"><div class="code-header"><span>${escapeHtml(language)}</span><button class="copy-button" type="button" data-copy="${escapeHtml(code)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="1.5" /><path d="M5 16V5a1 1 0 0 1 1-1h11" /></svg><span>复制</span></button></div><pre><code>${escapeHtml(code)}</code></pre></div>`);
      continue;
    }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].trim();
      const baseId = slugify(text, headings.length + 1);
      let id = baseId;
      let suffix = 2;
      while (usedIds.has(id)) { id = `${baseId}-${suffix}`; suffix += 1; }
      usedIds.add(id);
      headings.push({ id, level, title: stripMarkdown(text) });
      html.push(`<h${level} id="${escapeHtml(id)}">${renderInline(text, currentPath)}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      html.push("<hr />");
      index += 1;
      continue;
    }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const header = splitTableRow(line);
      const aligns = splitTableRow(lines[index + 1]).map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) { rows.push(splitTableRow(lines[index])); index += 1; }
      html.push(`<div class="markdown-table-wrap"><table><thead><tr>${header.map((cell, cellIndex) => `<th${aligns[cellIndex] ? ` style="text-align:${aligns[cellIndex]}"` : ""}>${renderInline(cell, currentPath)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${header.map((_, cellIndex) => `<td${aligns[cellIndex] ? ` style="text-align:${aligns[cellIndex]}"` : ""}>${renderInline(row[cellIndex] || "", currentPath)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s{0,3}>/.test(lines[index])) { quote.push(lines[index].replace(/^\s{0,3}>\s?/, "")); index += 1; }
      const alert = quote[0] && quote[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      if (alert) {
        const alertType = alert[1].toLowerCase();
        const alertLabels = { note: "提示", tip: "建议", important: "重要", warning: "注意", caution: "注意" };
        html.push(`<aside class="markdown-callout markdown-callout--${alertType}"><strong>${alertLabels[alertType] || "提示"}</strong>${quote.slice(1).map((item) => `<p>${renderInline(item, currentPath)}</p>`).join("")}</aside>`);
      } else {
        html.push(`<blockquote>${quote.map((item) => `<p>${renderInline(item, currentPath)}</p>`).join("")}</blockquote>`);
      }
      continue;
    }
    const listMatch = line.match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1]);
      const items = [];
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s{0,3}([-+*]|\d+\.)\s+(.+)$/);
        if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
        const task = itemMatch[2].match(/^\[([ xX])\]\s+(.*)$/);
        const content = task ? `<label class="task-item"><input type="checkbox" disabled${task[1].toLowerCase() === "x" ? " checked" : ""} />${renderInline(task[2], currentPath)}</label>` : renderInline(itemMatch[2], currentPath);
        items.push(`<li>${content}</li>`);
        index += 1;
      }
      const tag = ordered ? "ol" : "ul";
      html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^\s{0,3}(#{1,6})\s+/.test(lines[index]) && !/^\s{0,3}(```|~~~)/.test(lines[index]) && !/^\s{0,3}>/.test(lines[index]) && !/^\s{0,3}([-+*]|\d+\.)\s+/.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join("\n"), currentPath)}</p>`);
  }
  return { html: html.join("\n"), headings };
}

function publicDocument(document, config) {
  const rendered = renderMarkdown(document.body, document.path);
  return {
    path: document.path,
    title: document.title,
    description: document.description,
    html: rendered.html,
    headings: rendered.headings,
    updatedAt: document.updatedAt,
    icon: configuredIcon(config.sidebar, document.path, "file", document.icon)
  };
}

function makeSearchSnippet(raw, query) {
  const plain = stripMarkdown(raw).replace(/\n/g, " ");
  const lower = plain.toLocaleLowerCase();
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchIndex = Math.max(0, ...terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0));
  const start = Math.max(0, matchIndex - 54);
  const end = Math.min(plain.length, start + 150);
  return `${start > 0 ? "..." : ""}${plain.slice(start, end)}${end < plain.length ? "..." : ""}`;
}

function makeSearchResults(documents, query, config) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  return documents.map((document) => {
    const haystack = `${document.title}\n${document.path}\n${stripMarkdown(document.body)}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return null;
    let score = 0;
    if (document.title.toLocaleLowerCase().includes(normalized)) score += 80;
    if (document.path.toLocaleLowerCase().includes(normalized)) score += 45;
    terms.forEach((term) => { score += (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length; });
    return { path: document.path, title: document.title, description: document.description, snippet: makeSearchSnippet(document.body, normalized), score, icon: configuredIcon(config.sidebar, document.path, "file", document.icon) };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN")).slice(0, 30);
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const MIME_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".ico": "image/x-icon", ".pdf": "application/pdf" };

async function sendFile(response, filePath) {
  const data = await fsp.readFile(filePath);
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": data.length });
  response.end(data);
}

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const current = await loadConfig();
  const { config, docsDir } = current;
  if (request.method !== "GET") return jsonResponse(response, 405, { error: "只支持 GET 请求" });

  if (requestUrl.pathname === "/api/bootstrap") {
    const documents = await scanDocuments(docsDir);
    const tree = createTree(documents, config);
    const preferred = documents.find((document) => /(^|\/)index\.(md|markdown)$/i.test(document.path)) || documents.find((document) => /(^|\/)readme\.(md|markdown)$/i.test(document.path)) || documents[0];
    return jsonResponse(response, 200, { config, tree, defaultPath: preferred ? preferred.path : "", documents: documents.map((document) => ({ path: document.path, title: document.title, description: document.description, icon: configuredIcon(config.sidebar, document.path, "file", document.icon) })) });
  }

  if (requestUrl.pathname === "/api/document") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    const filePath = safeResolve(docsDir, requestedPath);
    if (!/\.(md|markdown)$/i.test(filePath)) return jsonResponse(response, 400, { error: "只支持 Markdown 文档" });
    const documents = await scanDocuments(docsDir);
    const document = documents.find((item) => item.path === normalizeRelative(requestedPath));
    if (!document) return jsonResponse(response, 404, { error: "文档不存在" });
    return jsonResponse(response, 200, publicDocument(document, config));
  }

  if (requestUrl.pathname === "/api/search") {
    const documents = await scanDocuments(docsDir);
    return jsonResponse(response, 200, { query: requestUrl.searchParams.get("q") || "", results: makeSearchResults(documents, requestUrl.searchParams.get("q") || "", config) });
  }

  if (requestUrl.pathname === "/api/asset") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    const filePath = safeResolve(docsDir, requestedPath);
    if (/\.(md|markdown)$/i.test(filePath)) return jsonResponse(response, 403, { error: "不允许读取 Markdown 原文" });
    return sendFile(response, filePath);
  }

  if (requestUrl.pathname.startsWith("/api/")) return jsonResponse(response, 404, { error: "接口不存在" });

  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  let staticPath;
  try { staticPath = safeResolve(ROOT_DIR, pathname); } catch (error) { return jsonResponse(response, 400, { error: error.message }); }
  if (staticPath.startsWith(docsDir)) return jsonResponse(response, 403, { error: "禁止访问" });
  try { return await sendFile(response, staticPath); } catch (error) {
    if (error.code === "ENOENT") return sendFile(response, path.join(ROOT_DIR, "index.html"));
    throw error;
  }
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error(error);
    if (!response.headersSent) jsonResponse(response, 500, { error: error.message || "服务器错误" });
    else response.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Docs site running at http://127.0.0.1:${port}`);
  console.log(`Markdown directory: ${resolveFromRoot(cliArgs.docsDir || process.env.DOCS_DIR || "docs")}`);
});
