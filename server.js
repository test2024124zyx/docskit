const http = require("node:http");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { URL } = require("node:url");

const ROOT_DIR = __dirname;
const DEFAULT_PORT = 3000;
const DEFAULT_DOCS_DIR = "docs";
const CONFIG_FILE_NAME = "docs.config.json";
const SEARCH_RESULT_LIMIT = 30;
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
const documentIndexCache = new Map();

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

function normalizeIconPalette(value) {
  const source = Array.isArray(value) ? value : DEFAULT_ICON_PALETTE;
  const palette = source.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim());
  return palette.length ? palette : [...DEFAULT_ICON_PALETTE];
}

// 统一归一化配置，避免错误值影响导航、品牌和页脚的运行时行为。
function mergeConfig(source) {
  const input = isObject(source) ? source : {};
  const siteInput = isObject(input.site) ? input.site : {};
  const brand = isObject(siteInput.brand) ? siteInput.brand : {};
  const seo = isObject(siteInput.seo) ? siteInput.seo : {};
  const footer = isObject(siteInput.footer) ? siteInput.footer : {};
  const topbar = isObject(input.topbar) ? input.topbar : {};
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
        links: Array.isArray(footer.links) ? footer.links : []
      }
    },
    topbar: { ...DEFAULT_CONFIG.topbar, ...topbar },
    sidebar
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

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function iconValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function selectStableIcon(icons, relativePath, type, variant) {
  return icons[stableHash(`${variant}:${type}:${relativePath}`) % icons.length];
}

// 创建时间优先使用 birthtime，当前文件系统不提供时回退到 ctime 和 mtime。
function creationTime(stat) {
  const candidates = [stat.birthtimeMs, stat.ctimeMs, stat.mtimeMs].map(Number);
  const timestamp = candidates.find((value) => Number.isFinite(value) && value > 0) || 0;
  return {
    createdAtMs: timestamp || Number.MAX_SAFE_INTEGER,
    createdAt: timestamp ? new Date(timestamp).toISOString() : ""
  };
}

function findConfiguredIcon(settings, relativePath, type, frontMatterIcon) {
  const generic = isObject(settings.icons) ? settings.icons : {};
  const specificSetting = type === "directory" ? settings.folderIcons : settings.fileIcons;
  const specific = isObject(specificSetting) ? specificSetting : {};
  const noExtension = relativePath.replace(/\.(markdown|md)$/i, "");
  const candidates = [relativePath, noExtension];
  if (type === "directory") candidates.push(relativePath.replace(/\/$/, ""));
  for (const key of candidates) {
    const specificIcon = iconValue(specific[key]);
    const genericIcon = iconValue(generic[key]);
    if (specificIcon) return specificIcon;
    if (genericIcon) return genericIcon;
  }
  const frontIcon = iconValue(frontMatterIcon);
  if (frontIcon) return frontIcon;
  return "";
}

function strategyIconColors(settings, relativePath, type, depth, strategy) {
  const configuredColor = iconValue(settings.iconColor);
  if (configuredColor) return [configuredColor];
  if (depth !== 0 || strategy === ICON_STRATEGY_DEFAULT) return [];
  const palette = normalizeIconPalette(settings.iconPalette);
  const start = stableHash(`colors:${strategy}:${type}:${relativePath}`) % palette.length;
  const count = Math.min(MULTICOLOR_ICON_COLOR_COUNT, palette.length);
  return Array.from({ length: count }, (_, index) => palette[(start + index) % palette.length]);
}

function resolveIcon(sidebar, relativePath, type, frontMatterIcon, depth) {
  const settings = isObject(sidebar) ? sidebar : {};
  const strategy = normalizeIconStrategy(settings.iconStrategy);
  const configured = findConfiguredIcon(settings, relativePath, type, frontMatterIcon);
  const globalColor = iconValue(settings.iconColor);
  if (configured) {
    const colors = globalColor ? [globalColor] : strategyIconColors(settings, relativePath, type, depth, strategy);
    return { name: configured, color: colors[0] || "", colors };
  }

  const configuredDefault = iconValue(type === "directory" ? settings.defaultFolderIcon : settings.defaultFileIcon);
  if (configuredDefault) {
    const colors = globalColor ? [globalColor] : strategyIconColors(settings, relativePath, type, depth, strategy);
    return { name: configuredDefault, color: colors[0] || "", colors };
  }

  const isTopLevel = depth === 0;
  if (strategy === ICON_STRATEGY_MODERN) {
    const icons = isTopLevel
      ? (type === "directory" ? COLOR_FOLDER_ICONS : COLOR_FILE_ICONS)
      : (type === "directory" ? MONO_FOLDER_ICONS : MONO_FILE_ICONS);
    const colors = strategyIconColors(settings, relativePath, type, depth, strategy);
    return {
      name: selectStableIcon(icons, relativePath, type, `strategy:${strategy}`),
      color: colors[0] || "",
      colors
    };
  }
  if (strategy === ICON_STRATEGY_MIXED) {
    if (isTopLevel && type === "directory") {
      const colors = strategyIconColors(settings, relativePath, type, depth, strategy);
      return { name: DEFAULT_FOLDER_ICON, color: colors[0] || "", colors };
    }
    if (!isTopLevel && type === "directory") return { name: DEFAULT_FOLDER_ICON, color: globalColor, colors: globalColor ? [globalColor] : [] };
    const icons = isTopLevel ? COLOR_FILE_ICONS : MONO_FILE_ICONS;
    const colors = strategyIconColors(settings, relativePath, type, depth, strategy);
    return {
      name: selectStableIcon(icons, relativePath, type, `strategy:${strategy}`),
      color: colors[0] || "",
      colors
    };
  }

  return {
    name: type === "directory" ? DEFAULT_FOLDER_ICON : DEFAULT_FILE_ICON,
    color: globalColor,
    colors: globalColor ? [globalColor] : []
  };
}

async function scanDocuments(docsDir) {
  const documents = [];
  const directories = new Set();
  const directoryMetadata = new Map();
  async function walk(directory, prefix) {
    let entries;
    let directoryStat;
    try {
      [entries, directoryStat] = await Promise.all([
        fsp.readdir(directory, { withFileTypes: true }),
        fsp.stat(directory)
      ]);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    directories.add(directory);
    directoryMetadata.set(prefix, creationTime(directoryStat));
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
      let raw;
      let fileStat;
      try {
        raw = await fsp.readFile(absolutePath, "utf8");
        fileStat = await fsp.stat(absolutePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
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
        plainBody: stripMarkdown(front.body),
        updatedAt: fileStat.mtime.toISOString(),
        ...creationTime(fileStat)
      });
    }
  }
  await walk(docsDir, "");
  const visibleDocuments = documents.filter((document) => !document.hidden);
  visibleDocuments.forEach((document) => {
    document.searchText = `${document.title}\n${document.path}\n${document.plainBody}`.toLocaleLowerCase();
  });
  return { documents: visibleDocuments, directories, directoryMetadata };
}

function createDocumentIndexState(docsDir) {
  return {
    docsDir,
    documents: [],
    directoryMetadata: new Map(),
    dirty: true,
    revision: 0,
    promise: null,
    watchers: new Map(),
    watchUnavailable: false,
    watchWarningShown: false
  };
}

function markDocumentIndexDirty(state) {
  state.dirty = true;
  state.revision += 1;
}

function addDirectoryWatcher(state, directory) {
  if (state.watchers.has(directory)) return true;
  try {
    const watcher = fs.watch(directory, { persistent: false }, () => markDocumentIndexDirty(state));
    watcher.on("error", (error) => {
      if (state.watchers.get(directory) === watcher) state.watchers.delete(directory);
      state.watchUnavailable = true;
      markDocumentIndexDirty(state);
      if (!state.watchWarningShown) {
        console.warn(`无法监听文档目录 ${directory}，将按请求重新检查：${error.message}`);
        state.watchWarningShown = true;
      }
    });
    state.watchers.set(directory, watcher);
    return true;
  } catch (error) {
    state.watchUnavailable = true;
    markDocumentIndexDirty(state);
    if (!state.watchWarningShown) {
      console.warn(`无法监听文档目录 ${directory}，将按请求重新检查：${error.message}`);
      state.watchWarningShown = true;
    }
    return false;
  }
}

function syncDirectoryWatchers(state, directories) {
  const activeDirectories = new Set(Array.from(directories, (directory) => path.resolve(directory)));
  let watcherUnavailable = false;
  for (const directory of activeDirectories) {
    addDirectoryWatcher(state, directory);
    if (!state.watchers.has(directory)) watcherUnavailable = true;
  }
  for (const [directory, watcher] of state.watchers) {
    if (activeDirectories.has(directory)) continue;
    watcher.close();
    state.watchers.delete(directory);
  }
  state.watchUnavailable = watcherUnavailable;
  return activeDirectories.size > 0;
}

function documentIndexResult(state) {
  return { documents: state.documents, directoryMetadata: state.directoryMetadata };
}

async function getDocumentIndex(docsDir) {
  const cacheKey = path.resolve(docsDir);
  let state = documentIndexCache.get(cacheKey);
  if (!state) {
    state = createDocumentIndexState(cacheKey);
    documentIndexCache.set(cacheKey, state);
  }
  if (!state.dirty && !state.watchUnavailable) return documentIndexResult(state);
  if (state.promise) return state.promise;

  const scanRevision = state.revision;
  state.promise = (async () => {
    try {
      const result = await scanDocuments(state.docsDir);
      state.documents = result.documents;
      state.directoryMetadata = result.directoryMetadata;
      const hasDirectoryToWatch = syncDirectoryWatchers(state, result.directories);
      state.dirty = state.watchUnavailable || !hasDirectoryToWatch || state.revision !== scanRevision;
      return documentIndexResult(state);
    } catch (error) {
      state.dirty = true;
      throw error;
    } finally {
      state.promise = null;
    }
  })();
  return state.promise;
}

function sortNodes(nodes, sortMode) {
  return nodes.sort((left, right) => {
    if (left.order !== right.order) return left.order - right.order;
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    if (sortMode === SORT_MODE_CREATED_AT && left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
    return compareNames(left.title, right.title);
  });
}

function createTree(documents, config, directoryMetadata = new Map()) {
  const root = { type: "directory", path: "", title: "", children: [] };
  for (const document of documents) {
    const segments = document.path.split("/");
    let current = root;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const folderPath = segments.slice(0, index + 1).join("/");
      let folder = current.children.find((node) => node.type === "directory" && node.path === folderPath);
      if (!folder) {
        const metadata = directoryMetadata.get(folderPath) || creationTime({});
        const icon = resolveIcon(config.sidebar, folderPath, "directory", "", index);
        folder = {
          type: "directory",
          path: folderPath,
          title: humanizeName(segments[index]),
          order: Number.MAX_SAFE_INTEGER,
          icon: icon.name,
          iconColor: icon.color,
          iconColors: icon.colors,
          createdAt: metadata.createdAt,
          createdAtMs: metadata.createdAtMs,
          children: []
        };
        current.children.push(folder);
      }
      current = folder;
    }
    const icon = resolveIcon(config.sidebar, document.path, "file", document.icon, segments.length - 1);
    current.children.push({
      type: "file",
      path: document.path,
      title: document.title,
      description: document.description,
      order: document.order,
      icon: icon.name,
      iconColor: icon.color,
      iconColors: icon.colors,
      updatedAt: document.updatedAt,
      createdAt: document.createdAt,
      createdAtMs: document.createdAtMs
    });
  }
  function sortTree(node) {
    sortNodes(node.children, config.sidebar.sort);
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
  const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|(?<!\w)\*([^*]+)\*(?!\w)|:icon\[([A-Za-z][\w-]*)\]/g;
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
    else if (match[12] !== undefined) result += `<span class="markdown-icon" data-icon-name="${escapeHtml(match[12])}" role="img" aria-label="${escapeHtml(match[12])}"></span>`;
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

function documentIcon(config, document) {
  return resolveIcon(config.sidebar, document.path, "file", document.icon, document.path.split("/").length - 1);
}

function publicDocument(document, config) {
  const rendered = renderMarkdown(document.body, document.path);
  const icon = documentIcon(config, document);
  return {
    path: document.path,
    title: document.title,
    description: document.description,
    html: rendered.html,
    headings: rendered.headings,
    updatedAt: document.updatedAt,
    createdAt: document.createdAt,
    icon: icon.name,
    iconColor: icon.color,
    iconColors: icon.colors
  };
}

function makeSearchSnippet(plain, query) {
  const text = String(plain || "").replace(/\n/g, " ");
  const lower = text.toLocaleLowerCase();
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matchIndex = Math.max(0, ...terms.map((term) => lower.indexOf(term)).filter((value) => value >= 0));
  const start = Math.max(0, matchIndex - 54);
  const end = Math.min(text.length, start + 150);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function makeSearchResults(documents, query, config) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  return documents.map((document) => {
    const haystack = document.searchText || `${document.title}\n${document.path}\n${document.plainBody || ""}`.toLocaleLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return null;
    let score = 0;
    if (document.title.toLocaleLowerCase().includes(normalized)) score += 80;
    if (document.path.toLocaleLowerCase().includes(normalized)) score += 45;
    terms.forEach((term) => { score += (haystack.match(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length; });
    const icon = documentIcon(config, document);
    return { path: document.path, title: document.title, description: document.description, snippet: makeSearchSnippet(document.plainBody, normalized), score, icon: icon.name, iconColor: icon.color, iconColors: icon.colors };
  }).filter(Boolean).sort((left, right) => right.score - left.score || left.title.localeCompare(right.title, "zh-CN")).slice(0, SEARCH_RESULT_LIMIT);
}

function jsonResponse(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(body) });
  response.end(body);
}

const MIME_TYPES = { ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon", ".pdf": "application/pdf" };

async function sendFile(response, filePath) {
  const data = await fsp.readFile(filePath);
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "Content-Length": data.length });
  response.end(data);
}

async function handleRequest(request, response, options = {}) {
  const loadCurrentConfig = typeof options.loadConfig === "function" ? options.loadConfig : loadConfig;
  const loadIndex = typeof options.getDocumentIndex === "function" ? options.getDocumentIndex : getDocumentIndex;
  const rootDir = options.rootDir || ROOT_DIR;
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (request.method !== "GET") return jsonResponse(response, 405, { error: "只支持 GET 请求" });
  if (requestUrl.pathname === "/healthz") return jsonResponse(response, 200, { status: "ok", service: "docs-kit" });

  const current = await loadCurrentConfig();
  const { config, docsDir } = current;

  if (requestUrl.pathname === "/api/bootstrap") {
    const index = await loadIndex(docsDir);
    const { documents, directoryMetadata } = index;
    const tree = createTree(documents, config, directoryMetadata);
    const preferred = documents.find((document) => /(^|\/)index\.(md|markdown)$/i.test(document.path)) || documents.find((document) => /(^|\/)readme\.(md|markdown)$/i.test(document.path)) || documents[0];
    return jsonResponse(response, 200, { config, tree, defaultPath: preferred ? preferred.path : "", documents: documents.map((document) => {
      const icon = documentIcon(config, document);
      return { path: document.path, title: document.title, description: document.description, icon: icon.name, iconColor: icon.color, iconColors: icon.colors, createdAt: document.createdAt };
    }) });
  }

  if (requestUrl.pathname === "/api/document") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    const filePath = safeResolve(docsDir, requestedPath);
    if (!/\.(md|markdown)$/i.test(filePath)) return jsonResponse(response, 400, { error: "只支持 Markdown 文档" });
    const { documents } = await loadIndex(docsDir);
    const document = documents.find((item) => item.path === normalizeRelative(requestedPath));
    if (!document) return jsonResponse(response, 404, { error: "文档不存在" });
    return jsonResponse(response, 200, publicDocument(document, config));
  }

  if (requestUrl.pathname === "/api/search") {
    const { documents } = await loadIndex(docsDir);
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
  try { staticPath = safeResolve(rootDir, pathname); } catch (error) { return jsonResponse(response, 400, { error: error.message }); }
  if (staticPath.startsWith(docsDir)) return jsonResponse(response, 403, { error: "禁止访问" });
  try { return await sendFile(response, staticPath); } catch (error) {
    if (error.code === "ENOENT") return sendFile(response, path.join(rootDir, "index.html"));
    throw error;
  }
}

function createServer(options = {}) {
  const requestHandler = options.handleRequest || ((request, response) => handleRequest(request, response, options));
  return http.createServer((request, response) => {
    requestHandler(request, response).catch((error) => {
      console.error(error);
      if (!response.headersSent) jsonResponse(response, 500, { error: error.message || "服务器错误" });
      else response.end();
    });
  });
}

function startServer() {
  const server = createServer();
  // 容器通过 HOST=0.0.0.0 监听所有网卡，本地开发仍默认只绑定回环地址。
  server.listen(port, host, () => {
    console.log(`Docs site running at http://${host}:${port}`);
    console.log(`Markdown directory: ${resolveFromRoot(cliArgs.docsDir || process.env.DOCS_DIR || "docs")}`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = {
  DEFAULT_CONFIG,
  parseArgs,
  mergeConfig,
  resolveFromRoot,
  pathSetting,
  configFileSignature,
  readConfigFile,
  loadConfig,
  normalizeRelative,
  safeResolve,
  toPosix,
  parseValue,
  splitFrontMatter,
  stripMarkdown,
  humanizeName,
  firstHeading,
  firstParagraph,
  compareNames,
  stableHash,
  iconValue,
  selectStableIcon,
  creationTime,
  findConfiguredIcon,
  strategyIconColors,
  resolveIcon,
  scanDocuments,
  createDocumentIndexState,
  markDocumentIndexDirty,
  syncDirectoryWatchers,
  getDocumentIndex,
  sortNodes,
  createTree,
  renderInline,
  renderMarkdown,
  documentIcon,
  publicDocument,
  makeSearchSnippet,
  makeSearchResults,
  jsonResponse,
  sendFile,
  handleRequest,
  createServer,
  startServer
};
