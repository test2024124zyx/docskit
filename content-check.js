"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");
const { renderMarkdown, markdownTarget, splitFrontMatter } = require("./markdown");
const { isPublicAssetPath, assetMaxBytes } = require("./server-assets");
const { resolveExistingFile } = require("./server-filesystem");
const { apiConnectSources } = require("./server-api-policy");
const {
  ROOT_DIR, DEFAULT_DOCS_DIR, CONFIG_FILE_NAME, DEFAULT_CONFIG,
  MAX_DIRECTORY_DEPTH, MAX_DOCUMENT_COUNT, MAX_MARKDOWN_BYTES, DEFAULT_INDEX_BYTES, mergeConfig
} = require("./server-config");

const FRONT_TYPES = { title: "string", description: "string", order: "number", icon: "string", hidden: "boolean", openapi: "string" };

function diagnostic(file, line, code, message) {
  return { file: path.resolve(file), line: Math.max(1, line || 1), code, message };
}

function lineAt(source, position) {
  return source.slice(0, Math.max(0, position)).split("\n").length;
}

function validateFrontMatter(raw, file, result) {
  const source = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  if (lines[0].trim() !== "---") return { attributes: {}, body: source, offset: 0 };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (end < 0) {
    result.errors.push(diagnostic(file, 1, "front-matter-unclosed", "front matter 缺少结束分隔线"));
    return { attributes: {}, body: source, offset: 0 };
  }
  let attributes = {};
  try {
    const parsed = YAML.parseDocument(lines.slice(1, end).join("\n"), { schema: "core" });
    if (parsed.errors.length) throw parsed.errors[0];
    attributes = parsed.toJS({ maxAliasCount: 50 }) || {};
    if (typeof attributes !== "object" || Array.isArray(attributes)) throw new Error("front matter 必须是字段映射");
    for (const [key, value] of Object.entries(attributes)) {
      const fieldLine = lines.findIndex((line, index) => index > 0 && index < end && line.trimStart().startsWith(`${key}:`)) + 1;
      if (!Object.hasOwn(FRONT_TYPES, key)) {
        result.warnings.push(diagnostic(file, fieldLine, "front-matter-unknown", `未识别的 front matter 字段：${key}`));
      } else if (typeof value !== FRONT_TYPES[key] || (typeof value === "number" && !Number.isFinite(value))) {
        result.errors.push(diagnostic(file, fieldLine, "front-matter-type", `${key} 必须是 ${FRONT_TYPES[key]} 类型`));
      }
    }
  } catch (error) {
    result.errors.push(diagnostic(file, (error.linePos?.[0]?.line || 1) + 1, "front-matter-syntax", error.message));
  }
  return { attributes, body: lines.slice(end + 1).join("\n"), offset: end + 1 };
}

function validateConfigTypes(config, file, source, result, schema = DEFAULT_CONFIG, prefix = "") {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    result.errors.push(diagnostic(file, 1, "config-type", `${prefix || "配置"} 必须是对象`));
    return;
  }
  for (const [key, value] of Object.entries(config)) {
    const name = prefix ? `${prefix}.${key}` : key;
    const position = source.indexOf(JSON.stringify(key));
    const line = lineAt(source, position);
    if (!Object.hasOwn(schema, key)) {
      if (!prefix && !["versions", "api"].includes(key)) result.warnings.push(diagnostic(file, line, "config-unknown", `未识别的配置字段：${name}`));
      continue;
    }
    if (name === "site.seo.keywords" && Array.isArray(value) && value.every((item) => typeof item === "string")) continue;
    const expected = schema[key];
    if (Array.isArray(expected)) {
      if (!Array.isArray(value)) result.errors.push(diagnostic(file, line, "config-type", `${name} 必须是数组`));
      continue;
    }
    if (expected && typeof expected === "object") {
      validateConfigTypes(value, file, source, result, expected, name);
    } else if (typeof value !== typeof expected || (typeof value === "number" && !Number.isFinite(value))) {
      result.errors.push(diagnostic(file, line, "config-type", `${name} 必须是 ${typeof expected} 类型`));
    }
  }
}

async function readConfiguration(options, result) {
  const file = options.configPath || path.join(options.docsDir, CONFIG_FILE_NAME);
  let config = options.config || {};
  let source = JSON.stringify(config);
  try {
    source = await fs.readFile(file, "utf8");
    config = JSON.parse(source);
  } catch (error) {
    if (error.code !== "ENOENT") {
      const line = Number(error.message.match(/line (\d+)/)?.[1]) || 1;
      result.errors.push(diagnostic(file, line, "config-json", `无法读取或解析配置：${error.message}`));
    }
  }
  validateConfigTypes(config, file, source, result);
  try { mergeConfig(config); }
  catch (error) { result.errors.push(diagnostic(file, 1, "config-value", error.message)); }
  return { config, file, source };
}

async function readDocuments(docsDir, result, maxBytes) {
  const documents = new Map();
  let count = 0;
  let bytes = 0;
  async function walk(directory, prefix, depth) {
    if (depth > MAX_DIRECTORY_DEPTH) throw new Error(`文档目录超过 ${MAX_DIRECTORY_DEPTH} 级：${prefix}`);
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("文档根目录及被扫描目录必须是普通目录");
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(file, relative, depth + 1); continue; }
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue;
      if (++count > MAX_DOCUMENT_COUNT) throw new Error(`Markdown 文档数量超过上限 ${MAX_DOCUMENT_COUNT} 篇`);
      const fileStat = await fs.lstat(file);
      if (fileStat.isSymbolicLink() || !fileStat.isFile()) continue;
      if (fileStat.size > MAX_MARKDOWN_BYTES) {
        result.errors.push(diagnostic(file, 1, "document-size", "Markdown 文件超过单篇大小限制"));
        continue;
      }
      bytes += fileStat.size;
      if (bytes > maxBytes) throw new Error("内容检查超过文档字节预算");
      const raw = await fs.readFile(file, "utf8");
      const front = validateFrontMatter(raw, file, result);
      if (front.attributes.hidden === true) continue;
      documents.set(relative, { path: relative, file, ...front });
    }
  }
  try { await walk(docsDir, "", 0); }
  catch (error) { result.errors.push(diagnostic(docsDir, 1, "document-directory", error.message)); }
  return documents;
}

function maskCode(source) {
  let fence = null;
  const lines = source.split("\n").map((line) => {
    const content = line.replace(/^\s*(?:>\s*)*/, "").replace(/^(?:[-+*]|\d+[.)])\s+/, "");
    const marker = content.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null;
      return " ".repeat(line.length);
    }
    if (marker) { fence = marker[1]; return " ".repeat(line.length); }
    if (/^(?: {4}|\t)/.test(line)) return " ".repeat(line.length);
    return line;
  });
  return lines.join("\n").replace(/(`+)([\s\S]*?)\1/g, (match) => match.replace(/[^\n]/g, " "));
}

function linkLocations(document) {
  const masked = maskCode(document.body);
  const locations = [];
  const inline = /!?\[[^\]\n]*\]\(\s*/g;
  for (const match of masked.matchAll(inline)) {
    let cursor = match.index + match[0].length;
    const start = cursor;
    let depth = 0;
    const angle = masked[cursor] === "<";
    if (angle) cursor += 1;
    for (; cursor < masked.length; cursor += 1) {
      const character = masked[cursor];
      if (character === "\\") { cursor += 1; continue; }
      if (angle && character === ">") { cursor += 1; break; }
      if (!angle && character === "(") depth += 1;
      if (!angle && character === ")") { if (!depth) break; depth -= 1; }
      if (!angle && /\s/.test(character) && !depth) break;
    }
    const raw = masked.slice(start, cursor).replace(/^<|>$/g, "");
    locations.push({ raw, line: document.offset + lineAt(masked, match.index), ...markdownTarget(raw, document.path, "document") });
  }
  for (const match of masked.matchAll(/^\s{0,3}\[[^\]\n]+\]:\s*(<[^>]+>|\S+)/gm)) {
    const raw = match[1].replace(/^<|>$/g, "");
    locations.push({ raw, line: document.offset + lineAt(masked, match.index), ...markdownTarget(raw, document.path, "document") });
  }
  return locations;
}

function anchorIds(html) {
  return new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]));
}

function decodedAnchor(hash) {
  try { return decodeURIComponent(hash.replace(/^#/, "")); }
  catch (error) { return null; }
}

async function checkAsset(docsDir, target) {
  if (!isPublicAssetPath(target)) return "该资源不在允许公开的文件范围内";
  try {
    const file = await resolveExistingFile(docsDir, target);
    if ((await fs.stat(file)).size > assetMaxBytes(target)) return "资源过大，超过服务和静态站的共同限制";
  } catch (error) { return "资源不存在或不可安全访问"; }
  return "";
}

async function inspectLinks(documents, docsDir, result) {
  const rendered = new Map();
  for (const document of documents.values()) {
    const links = [];
    const output = renderMarkdown(document.body, document.path, { code: { highlight: false }, links: {
      document: (target, hash) => { links.push({ type: "document", target, hash }); return `/documents/${encodeURI(target)}${hash}`; },
      asset: (target) => { links.push({ type: "asset", target }); return `/assets/${encodeURI(target)}`; }
    } });
    rendered.set(document.path, { ...output, links, ids: anchorIds(output.html) });
  }
  for (const document of documents.values()) {
    const output = rendered.get(document.path);
    const locations = linkLocations(document);
    for (const location of locations) {
      if (location.href === "#" && location.raw && location.raw !== "#") {
        result.errors.push(diagnostic(document.file, location.line, "link-invalid", `无效或越界的链接：${location.raw}`));
      }
    }
    for (const link of output.links) {
      const location = locations.find((item) => (link.type === "document" ? item.docPath : item.assetPath) === link.target && (!link.hash || item.raw.endsWith(link.hash)));
      const line = location?.line || document.offset + 1;
      if (link.type === "asset") {
        const error = await checkAsset(docsDir, link.target);
        if (error) result.errors.push(diagnostic(document.file, line, "asset-invalid", `${error}：${link.target}`));
      } else if (!documents.has(link.target)) {
        result.errors.push(diagnostic(document.file, line, "document-missing", `链接文档不存在或未公开：${link.target}`));
      } else if (link.hash && !rendered.get(link.target).ids.has(decodedAnchor(link.hash))) {
        result.errors.push(diagnostic(document.file, line, "anchor-missing", `目标锚点不存在：${link.target}${link.hash}`));
      }
    }
    for (const match of output.html.matchAll(/href="#([^"]+)"/g)) {
      const hash = `#${match[1]}`;
      if (output.ids.has(decodedAnchor(hash))) continue;
      const location = locations.find((item) => item.raw === hash);
      result.errors.push(diagnostic(document.file, location?.line || document.offset + 1, "anchor-missing", `本页锚点不存在：${hash}`));
    }
  }
}

async function inspectConfiguration(configuration, documents, docsDir, result) {
  const { config, file, source } = configuration;
  if (!config || typeof config !== "object") return;
  const targets = [{ field: "home", path: config.home }, ...(Array.isArray(config.topbar?.links) ? config.topbar.links.map((link) => ({ field: "path", path: link?.path || link?.doc })) : [])];
  for (const target of targets) {
    if (typeof target.path === "string" && target.path && !documents.has(target.path.replace(/^\//, ""))) {
      result.errors.push(diagnostic(file, lineAt(source, source.indexOf(JSON.stringify(target.path))), "config-document", `配置指向不存在或未公开的文档：${target.path}`));
    }
  }
  for (const value of [config.site?.logo, config.site?.favicon, config.site?.ico, config.site?.seo?.image]) {
    if (typeof value !== "string" || !value || /^(?:https?:|data:)/i.test(value)) continue;
    const target = value.replace(/^\//, "");
    const error = await checkAsset(docsDir, target);
    if (error) result.errors.push(diagnostic(file, lineAt(source, source.indexOf(JSON.stringify(value))), "config-asset", `${error}：${value}`));
  }
}

async function checkContent(options = {}) {
  const docsDir = path.resolve(options.docsDir || path.join(ROOT_DIR, DEFAULT_DOCS_DIR));
  const result = { errors: [], warnings: [], documents: 0 };
  const configuration = await readConfiguration({ ...options, docsDir }, result);
  const documents = await readDocuments(docsDir, result, configuration.config?.limits?.indexBytes || DEFAULT_INDEX_BYTES);
  result.documents = documents.size;
  await inspectLinks(documents, docsDir, result);
  await inspectConfiguration(configuration, documents, docsDir, result);
  const apiDocuments = [];
  for (const document of documents.values()) {
    if (typeof document.attributes.openapi !== "string" || !document.attributes.openapi) continue;
    try {
      const { loadApiReference } = require("./openapi");
      const apiReference = await loadApiReference(docsDir, document.path, document.attributes.openapi);
      const apiDocument = { path: document.path, apiReference };
      apiConnectSources([apiDocument]);
      apiDocuments.push(apiDocument);
    } catch (error) { result.errors.push(diagnostic(document.file, 2, "openapi-invalid", error.message)); }
  }
  // 单篇合同合法仍可能使整站连接策略超限，发布前同时检查合并后的来源集合。
  try { apiConnectSources(apiDocuments); }
  catch (error) { result.errors.push(diagnostic(configuration.file, 1, "openapi-site-policy", error.message)); }
  result.errors.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
  return result;
}

function assertContentValid(result) {
  if (!result.errors.length) return;
  const details = result.errors.map((item) => `${item.file}:${item.line} [${item.code}] ${item.message}`).join("\n");
  const error = new Error(`内容校验失败（${result.errors.length} 项）：\n${details}`);
  error.diagnostics = result;
  throw error;
}

function parseCheckArgs(argv) {
  const options = {};
  const names = { "--docs": "docsDir", "--config": "configPath" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") { options.help = true; continue; }
    const equal = token.indexOf("=");
    const name = equal < 0 ? token : token.slice(0, equal);
    if (!Object.hasOwn(names, name)) throw new Error(`未知检查参数：${token}`);
    const value = equal < 0 ? argv[++index] : token.slice(equal + 1);
    if (!value || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
    options[names[name]] = value;
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseCheckArgs(argv);
  if (options.help) { process.stdout.write("用法：npm run check -- [--docs 目录] [--config 文件]\n"); return; }
  const preliminary = options.docsDir || process.env.DOCS_DIR || DEFAULT_DOCS_DIR;
  options.configPath = path.resolve(ROOT_DIR, options.configPath || process.env.DOCS_CONFIG || path.join(preliminary, CONFIG_FILE_NAME));
  let source = {};
  try { source = JSON.parse(await fs.readFile(options.configPath, "utf8")); }
  catch (error) { /* 配置读取错误由统一检查结果报告。 */ }
  options.docsDir = path.resolve(ROOT_DIR, options.docsDir || process.env.DOCS_DIR || source.docsDir || DEFAULT_DOCS_DIR);
  const result = await checkContent(options);
  for (const item of result.warnings) process.stderr.write(`${item.file}:${item.line} [${item.code}] ${item.message}\n`);
  assertContentValid(result);
  process.stdout.write(`内容检查通过：${result.documents} 篇公开文档，${result.warnings.length} 项提示。\n`);
}

module.exports = { checkContent, assertContentValid, parseCheckArgs, main };

if (require.main === module) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
