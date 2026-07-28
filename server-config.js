"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { AUDIO_EXTENSIONS, DOWNLOAD_EXTENSIONS, VIDEO_EXTENSIONS } = require("./media-types");

const ROOT_DIR = __dirname;
const DEFAULT_PORT = 3000;
const DEFAULT_DOCS_DIR = "docs";
const CONFIG_FILE_NAME = "docs.config.json";
const SEARCH_RESULT_LIMIT = 30;
const MAX_SEARCH_QUERY_LENGTH = 200;
const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_MEDIA_BYTES = 512 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const INDEX_POLL_INTERVAL_MS = 1000;
const SKILL_INSTALL_PATH = "skills/install.md";
const SKILL_ARCHIVE_PATH = "docskit-doc-writing.zip";
const PUBLIC_ROOT_FILES = Object.freeze([SKILL_INSTALL_PATH, SKILL_ARCHIVE_PATH]);
const STATIC_RESOURCE_PATHS = new Set([
  "/", "/index.html", "/script.js", "/styles.css", "/robots.txt", "/sitemap.xml",
  ...PUBLIC_ROOT_FILES.map((relativePath) => `/${relativePath}`)
]);
const PUBLIC_ASSET_EXTENSIONS = new Set([
  ".avif", ".bmp", ".gif", ".ico", ".jpeg", ".jpg", ".otf", ".png", ".svg", ".webp", ".woff", ".woff2",
  ".7z", ".csv", ".doc", ".docx", ".epub", ".gz", ".json", ".log", ".pdf", ".ppt", ".pptx", ".rar", ".rtf", ".tar", ".tgz", ".txt", ".xls", ".xlsx", ".xml", ".zip",
  ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS, ...DOWNLOAD_EXTENSIONS
]);
const SORT_MODE_CREATED_AT = "createdAt";
const SORT_MODE_LOCALE = "locale";
const DEFAULT_SORT_MODE = SORT_MODE_CREATED_AT;
const ICON_STRATEGY_DEFAULT = "default";
const ICON_STRATEGY_MODERN = "modern";
const ICON_STRATEGY_MIXED = "mixed";
const DEFAULT_ICON_STRATEGY = ICON_STRATEGY_DEFAULT;
const EXPAND_MODE_ALL = "all";
const EXPAND_MODE_ACCORDION = "accordion";
const DEFAULT_EXPAND_MODE = EXPAND_MODE_ALL;
const DEFAULT_NAV_INDENT = 12;
const MIN_NAV_INDENT = 0;
const MAX_NAV_INDENT = 48;
const DEFAULT_FILE_ICON = "file-markdown";
const DEFAULT_FOLDER_ICON = "folder";
const DEFAULT_ICON_PALETTE = ["#3370ff", "#7c3aed", "#0f9d8a", "#d97706", "#d95850", "#0891b2", "#4f46e5", "#65a30d"];
const MONO_FILE_ICONS = ["file-markdown", "file-text", "file", "file-plus", "file-code", "file-check", "file-cog", "file-search", "book-open", "scroll-text", "newspaper", "notebook-tabs", "text"];
const MONO_FOLDER_ICONS = ["folder", "folder-open", "folder-plus", "folder-tree", "folder-cog", "folder-search", "folder-check"];
const COLOR_FILE_ICONS = ["file-markdown", "file-text", "file-code", "book-open", "newspaper", "scroll-text", "graduation-cap", "notebook-tabs", "rocket", "palette", "sparkles", "flag"];
const COLOR_FOLDER_ICONS = ["folder", "folder-open", "folder-tree", "folder-cog", "folder-git-2", "layers", "network", "workflow", "package", "blocks"];
const MULTICOLOR_ICON_COLOR_COUNT = 3;
const DEFAULT_CODE_CONFIG = {
  highlight: true,
  lineNumbers: true,
  copy: true,
  wrap: false
};
const DEFAULT_CONFIG = {
  docsDir: DEFAULT_DOCS_DIR,
  site: {
    brand: { name: "docs", accent: "kit" },
    context: "文档",
    eyebrow: "DOCUMENTATION",
    title: "我的文档",
    description: "按目录组织的 Markdown 知识库",
    logo: "",
    favicon: "",
    ico: "",
    seo: {
      title: "",
      description: "",
      keywords: "",
      image: "",
      author: "",
      robots: "",
      canonical: "",
      themeColor: ""
    },
    footer: {
      copyright: "",
      icp: "",
      beian: "",
      links: []
    }
  },
  topbar: {
    version: "",
    links: [],
    search: true,
    themeToggle: true
  },
  markdown: {
    code: DEFAULT_CODE_CONFIG
  },
  sidebar: {
    sort: DEFAULT_SORT_MODE,
    iconStrategy: DEFAULT_ICON_STRATEGY,
    expandMode: DEFAULT_EXPAND_MODE,
    indent: DEFAULT_NAV_INDENT,
    iconColor: "",
    iconPalette: DEFAULT_ICON_PALETTE,
    defaultFileIcon: "",
    defaultFolderIcon: "",
    icons: {},
    footer: {}
  }
};

const configCache = new Map();

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
const port = Number(cliArgs.port || process.env.PORT || DEFAULT_PORT);
const host = process.env.HOST || "127.0.0.1";

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeSortMode(value) {
  const aliases = {
    created: SORT_MODE_CREATED_AT,
    creation: SORT_MODE_CREATED_AT,
    creationTime: SORT_MODE_CREATED_AT,
    name: SORT_MODE_LOCALE,
    title: SORT_MODE_LOCALE,
    localeCompare: SORT_MODE_LOCALE
  };
  const normalized = aliases[value] || value;
  return normalized === SORT_MODE_LOCALE ? SORT_MODE_LOCALE : DEFAULT_SORT_MODE;
}

function normalizeIconStrategy(value) {
  return [ICON_STRATEGY_DEFAULT, ICON_STRATEGY_MODERN, ICON_STRATEGY_MIXED].includes(value) ? value : DEFAULT_ICON_STRATEGY;
}

function normalizeExpandMode(value) {
  return value === EXPAND_MODE_ACCORDION ? EXPAND_MODE_ACCORDION : DEFAULT_EXPAND_MODE;
}

function normalizeIndent(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_NAV_INDENT;
  return Math.min(MAX_NAV_INDENT, Math.max(MIN_NAV_INDENT, numericValue));
}

function normalizeBoolean(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeCodeConfig(value) {
  const input = isObject(value) ? value : {};
  return {
    ...DEFAULT_CODE_CONFIG,
    highlight: normalizeBoolean(input.highlight, DEFAULT_CODE_CONFIG.highlight),
    lineNumbers: normalizeBoolean(input.lineNumbers, DEFAULT_CODE_CONFIG.lineNumbers),
    copy: normalizeBoolean(input.copy, DEFAULT_CODE_CONFIG.copy),
    wrap: normalizeBoolean(input.wrap, DEFAULT_CODE_CONFIG.wrap)
  };
}

function normalizeIconPalette(value) {
  const source = Array.isArray(value) ? value : DEFAULT_ICON_PALETTE;
  const palette = source.map(normalizeColorValue).filter(Boolean);
  return palette.length ? palette : [...DEFAULT_ICON_PALETTE];
}

function normalizeColorValue(value) {
  if (typeof value !== "string") return "";
  const color = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  if (/^(?:rgb|rgba|hsl|hsla)\([^()]+\)$/i.test(color)) return color;
  if (/^[a-z]+$/i.test(color)) return color;
  return "";
}

function safeLinkValue(value) {
  if (typeof value !== "string") return "";
  const link = value.trim();
  if (!link || /^(?:javascript|vbscript|file):/i.test(link)) return "";
  if (/^(?:https?:|mailto:|tel:|\/|#)/i.test(link)) return link;
  return /^[\w./?%#=&:+-]+$/i.test(link) ? link : "";
}

function iconValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function normalizeRelative(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function normalizeTopbarLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (!isObject(item)) return null;
    const label = typeof item.label === "string" ? item.label.trim() : "";
    const configuredPath = typeof (item.path || item.doc) === "string" ? String(item.path || item.doc).trim() : "";
    const href = safeLinkValue(item.href);
    const icon = iconValue(item.icon);
    if (!label || (!configuredPath && !href)) return null;
    if (configuredPath && (configuredPath.includes("\0") || configuredPath.split(/[\\/]/).includes(".."))) return null;
    return {
      label,
      ...(configuredPath ? { path: normalizeRelative(configuredPath) } : {}),
      ...(href ? { href } : {}),
      ...(icon ? { icon } : {}),
      ...(item.external === true ? { external: true } : {})
    };
  }).filter(Boolean);
}

function normalizeFooterLinks(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    if (typeof item === "string") return item.trim();
    if (!isObject(item)) return null;
    const label = typeof (item.label || item.text) === "string" ? String(item.label || item.text).trim() : "";
    const href = safeLinkValue(item.href);
    if (!label) return null;
    return { label, ...(href ? { href } : {}), ...(item.external === true ? { external: true } : {}) };
  }).filter(Boolean);
}

// 统一归一化配置，避免错误值影响导航、品牌和页脚的运行时行为。
function mergeConfig(source) {
  const input = isObject(source) ? source : {};
  const siteInput = isObject(input.site) ? input.site : {};
  const brand = isObject(siteInput.brand) ? siteInput.brand : {};
  const seo = isObject(siteInput.seo) ? siteInput.seo : {};
  const footer = isObject(siteInput.footer) ? siteInput.footer : {};
  const topbar = isObject(input.topbar) ? input.topbar : {};
  const markdownInput = isObject(input.markdown) ? input.markdown : {};
  const sidebarInput = isObject(input.sidebar) ? input.sidebar : {};
  const sidebar = {
    ...DEFAULT_CONFIG.sidebar,
    ...sidebarInput,
    sort: normalizeSortMode(sidebarInput.sort),
    iconStrategy: normalizeIconStrategy(sidebarInput.iconStrategy),
    expandMode: normalizeExpandMode(sidebarInput.expandMode),
    indent: normalizeIndent(sidebarInput.indent),
    iconPalette: normalizeIconPalette(sidebarInput.iconPalette)
  };
  return {
    ...DEFAULT_CONFIG,
    ...input,
    site: {
      ...DEFAULT_CONFIG.site,
      ...siteInput,
      brand: { ...DEFAULT_CONFIG.site.brand, ...brand },
      seo: { ...DEFAULT_CONFIG.site.seo, ...seo },
      footer: {
        ...DEFAULT_CONFIG.site.footer,
        ...footer,
        links: normalizeFooterLinks(footer.links)
      }
    },
    topbar: { ...DEFAULT_CONFIG.topbar, ...topbar, links: normalizeTopbarLinks(topbar.links) },
    markdown: {
      ...DEFAULT_CONFIG.markdown,
      ...markdownInput,
      code: normalizeCodeConfig(markdownInput.code)
    },
    sidebar: { ...sidebar, iconColor: normalizeColorValue(sidebar.iconColor) }
  };
}

function resolveFromRoot(value) {
  if (typeof value !== "string" || !value.trim()) return ROOT_DIR;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(ROOT_DIR, value);
}

function pathSetting(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function getConfigPath() {
  const explicitPath = cliArgs.configPath || process.env.DOCS_CONFIG;
  if (explicitPath) return resolveFromRoot(explicitPath);
  const docsHint = pathSetting(cliArgs.docsDir || process.env.DOCS_DIR, DEFAULT_DOCS_DIR);
  return path.resolve(resolveFromRoot(docsHint), CONFIG_FILE_NAME);
}

function configFileSignature(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

async function readConfigFile(configPath) {
  let fileSignature = "missing";
  let fileStat;
  try {
    fileStat = await fsp.stat(configPath);
    fileSignature = configFileSignature(fileStat);
  } catch (error) {
    fileSignature = `${error.code || "error"}:${error.message}`;
    const cached = configCache.get(configPath);
    if (cached && cached.signature === fileSignature) return cached.value;
    if (error.code !== "ENOENT") console.warn(`无法读取配置文件 ${configPath}，将使用默认配置：${error.message}`);
    const value = {};
    configCache.set(configPath, { signature: fileSignature, value });
    return value;
  }

  const cached = configCache.get(configPath);
  if (cached && cached.signature === fileSignature) return cached.value;

  let value = {};
  try {
    value = JSON.parse(await fsp.readFile(configPath, "utf8"));
  } catch (error) {
    console.warn(`配置文件 ${configPath} 无法解析，将使用默认配置：${error.message}`);
  }
  configCache.set(configPath, { signature: fileSignature, value });
  return value;
}

async function loadConfig() {
  const configPath = getConfigPath();
  const parsed = await readConfigFile(configPath);
  const config = mergeConfig(parsed);
  const docsSetting = pathSetting(cliArgs.docsDir || process.env.DOCS_DIR || config.docsDir, DEFAULT_DOCS_DIR);
  return { config, configPath, docsDir: resolveFromRoot(docsSetting) };
}

function safeResolve(root, input) {
  const normalized = normalizeRelative(input);
  if (!normalized || normalized.includes("\0")) throw new Error("无效路径");
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("路径超出文档目录");
  return resolved;
}

module.exports = {
  ROOT_DIR,
  DEFAULT_PORT,
  DEFAULT_DOCS_DIR,
  CONFIG_FILE_NAME,
  SEARCH_RESULT_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_MARKDOWN_BYTES,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  MAX_DOWNLOAD_BYTES,
  INDEX_POLL_INTERVAL_MS,
  SKILL_INSTALL_PATH,
  SKILL_ARCHIVE_PATH,
  PUBLIC_ROOT_FILES,
  STATIC_RESOURCE_PATHS,
  PUBLIC_ASSET_EXTENSIONS,
  SORT_MODE_CREATED_AT,
  SORT_MODE_LOCALE,
  ICON_STRATEGY_DEFAULT,
  ICON_STRATEGY_MODERN,
  ICON_STRATEGY_MIXED,
  EXPAND_MODE_ALL,
  EXPAND_MODE_ACCORDION,
  DEFAULT_NAV_INDENT,
  MIN_NAV_INDENT,
  MAX_NAV_INDENT,
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
  DEFAULT_ICON_PALETTE,
  MONO_FILE_ICONS,
  MONO_FOLDER_ICONS,
  COLOR_FILE_ICONS,
  COLOR_FOLDER_ICONS,
  MULTICOLOR_ICON_COLOR_COUNT,
  DEFAULT_CONFIG,
  cliArgs,
  port,
  host,
  parseArgs,
  isObject,
  normalizeRelative,
  iconValue,
  normalizeIconStrategy,
  normalizeIconPalette,
  normalizeColorValue,
  normalizeFooterLinks,
  mergeConfig,
  resolveFromRoot,
  pathSetting,
  configFileSignature,
  readConfigFile,
  loadConfig,
  safeResolve
};
