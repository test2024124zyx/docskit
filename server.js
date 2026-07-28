const http = require("node:http");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { URL } = require("node:url");
const markdown = require("./markdown");
const { startServer: startServerRuntime } = require("./server-lifecycle");
const { createHttpError, assertNoSymlink, resolveExistingFile } = require("./server-filesystem");
const assets = require("./server-assets");

const {
  escapeHtml,
  parseValue,
  splitFrontMatter,
  stripMarkdown,
  humanizeName,
  firstHeading,
  firstParagraph,
  renderInline,
  parseMarkdown,
  renderMarkdown
} = markdown;

const serverConfig = require("./server-config");
const {
  ROOT_DIR,
  SEARCH_RESULT_LIMIT,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_MARKDOWN_BYTES,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  MAX_DOWNLOAD_BYTES,
  INDEX_POLL_INTERVAL_MS,
  SKILL_ARCHIVE_PATH,
  STATIC_RESOURCE_PATHS,
  SORT_MODE_CREATED_AT,
  SORT_MODE_LOCALE,
  ICON_STRATEGY_DEFAULT,
  ICON_STRATEGY_MODERN,
  ICON_STRATEGY_MIXED,
  DEFAULT_FILE_ICON,
  DEFAULT_FOLDER_ICON,
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
} = serverConfig;

const documentIndexCache = new Map();

function toPosix(value) {
  return value.split(path.sep).join("/");
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
  const signatureParts = [];
  async function walk(directory, prefix) {
    let entries;
    let directoryStat;
    try {
      [entries, directoryStat] = await Promise.all([
        fsp.readdir(directory, { withFileTypes: true }),
        fsp.lstat(directory)
      ]);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return;
    directories.add(directory);
    directoryMetadata.set(prefix, creationTime(directoryStat));
    signatureParts.push(`d:${prefix}:${directoryStat.size}:${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`);
    entries.sort((left, right) => {
      if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
      return compareNames(left.name, right.name);
    });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
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
        fileStat = await fsp.lstat(absolutePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
      signatureParts.push(`f:${relativePath}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`);
      if (fileStat.size > MAX_MARKDOWN_BYTES) continue;
      try {
        raw = await fsp.readFile(absolutePath, "utf8");
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
  return { documents: visibleDocuments, directories, directoryMetadata, filesystemSignature: signatureParts.sort().join("|") };
}

async function scanFilesystemSignature(docsDir) {
  const signatureParts = [];
  async function walk(directory, prefix) {
    let entries;
    let directoryStat;
    try {
      [entries, directoryStat] = await Promise.all([
        fsp.readdir(directory, { withFileTypes: true }),
        fsp.lstat(directory)
      ]);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) return;
    signatureParts.push(`d:${prefix}:${directoryStat.size}:${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath, relativePath);
        continue;
      }
      if (!/\.(md|markdown)$/i.test(entry.name)) continue;
      let fileStat;
      try {
        fileStat = await fsp.lstat(absolutePath);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
      signatureParts.push(`f:${relativePath}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`);
    }
  }
  await walk(docsDir, "");
  return signatureParts.sort().join("|");
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
    watchWarningShown: false,
    filesystemSignature: "",
    lastSignatureCheckAt: 0
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
  if (!state.dirty && Date.now() - state.lastSignatureCheckAt >= INDEX_POLL_INTERVAL_MS) {
    state.lastSignatureCheckAt = Date.now();
    const filesystemSignature = await scanFilesystemSignature(state.docsDir);
    if (filesystemSignature !== state.filesystemSignature) markDocumentIndexDirty(state);
  }
  if (!state.dirty) return documentIndexResult(state);
  if (state.promise) return state.promise;

  const scanRevision = state.revision;
  state.promise = (async () => {
    try {
      const result = await scanDocuments(state.docsDir);
      state.documents = result.documents;
      state.directoryMetadata = result.directoryMetadata;
      state.filesystemSignature = result.filesystemSignature;
      state.lastSignatureCheckAt = Date.now();
      const hasDirectoryToWatch = syncDirectoryWatchers(state, result.directories);
      state.dirty = !hasDirectoryToWatch || state.revision !== scanRevision;
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

function documentIcon(config, document) {
  return resolveIcon(config.sidebar, document.path, "file", document.icon, document.path.split("/").length - 1);
}

function publicDocument(document, config, options = {}) {
  const rendered = renderMarkdown(document.body, document.path, { ...config.markdown, links: options.links });
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

function imageSource(value, options = {}) {
  const configured = isObject(value) ? value.src || value.url : value;
  const source = typeof configured === "string" ? configured.trim() : "";
  if (!source) return "";
  if (/^(?:https?:|data:|blob:|\/\/|\/)/i.test(source)) return source;
  if (typeof options.assetUrl === "function") return options.assetUrl(source);
  return `/api/asset?path=${encodeURIComponent(source)}`;
}

function seoValues(config, documentData, pageUrl, options = {}) {
  const site = config.site || {};
  const seo = isObject(site.seo) ? site.seo : {};
  const brand = isObject(site.brand) ? site.brand : { name: site.brand || "docs", accent: "" };
  const siteTitle = String(seo.title || site.title || `${brand.name || "docs"}${brand.accent || ""}` || "文档站点");
  const title = documentData ? `${documentData.title} - ${siteTitle}` : siteTitle;
  const description = String(documentData?.description || seo.description || site.description || "Markdown 文档站点");
  const keywords = Array.isArray(seo.keywords) ? seo.keywords.filter((item) => typeof item === "string").join(", ") : String(seo.keywords || "");
  const image = imageSource(seo.image || seo.ogImage || site.logo, options);
  return {
    title,
    description,
    keywords,
    author: String(seo.author || ""),
    robots: String(seo.robots || "index,follow"),
    themeColor: normalizeColorValue(seo.themeColor),
    canonical: String(seo.canonical || pageUrl),
    image,
    type: documentData ? "article" : "website",
    url: pageUrl
  };
}

function publicConfig(config) {
  const site = config.site || {};
  const sidebar = config.sidebar || {};
  const seo = isObject(site.seo) ? site.seo : {};
  const footer = isObject(site.footer) ? site.footer : {};
  const publicMedia = (value) => {
    if (!isObject(value)) return typeof value === "string" ? value : "";
    return { src: typeof value.src === "string" ? value.src : "", url: typeof value.url === "string" ? value.url : "", alt: typeof value.alt === "string" ? value.alt : "" };
  };
  return {
    site: {
      brand: isObject(site.brand) ? { name: site.brand.name, accent: site.brand.accent } : site.brand,
      context: String(site.context || "文档"),
      eyebrow: String(site.eyebrow || "DOCUMENTATION"),
      title: String(site.title || "我的文档"),
      description: String(site.description || ""),
      logo: publicMedia(site.logo),
      favicon: publicMedia(site.favicon),
      ico: publicMedia(site.ico),
      seo: {
        title: String(seo.title || ""),
        description: String(seo.description || ""),
        keywords: Array.isArray(seo.keywords) ? seo.keywords.filter((item) => typeof item === "string") : String(seo.keywords || ""),
        image: publicMedia(seo.image),
        ogImage: publicMedia(seo.ogImage),
        author: String(seo.author || ""),
        robots: String(seo.robots || ""),
        canonical: String(seo.canonical || ""),
        themeColor: normalizeColorValue(seo.themeColor)
      },
      footer: {
        copyright: String(footer.copyright || ""),
        icp: String(footer.icp || ""),
        beian: String(footer.beian || ""),
        links: normalizeFooterLinks(footer.links)
      }
    },
    topbar: {
      version: config.topbar?.version || "",
      links: Array.isArray(config.topbar?.links) ? config.topbar.links : [],
      search: config.topbar?.search !== false,
      themeToggle: config.topbar?.themeToggle !== false
    },
    markdown: {
      code: {
        highlight: config.markdown?.code?.highlight !== false,
        lineNumbers: config.markdown?.code?.lineNumbers !== false,
        copy: config.markdown?.code?.copy !== false,
        wrap: config.markdown?.code?.wrap === true
      }
    },
    sidebar: {
      sort: sidebar.sort,
      iconStrategy: sidebar.iconStrategy,
      expandMode: sidebar.expandMode,
      indent: sidebar.indent,
      iconColor: sidebar.iconColor,
      iconPalette: sidebar.iconPalette,
      defaultFileIcon: sidebar.defaultFileIcon,
      defaultFolderIcon: sidebar.defaultFolderIcon,
      icons: isObject(sidebar.icons) ? sidebar.icons : {},
      fileIcons: isObject(sidebar.fileIcons) ? sidebar.fileIcons : {},
      folderIcons: isObject(sidebar.folderIcons) ? sidebar.folderIcons : {}
    }
  };
}

function escapeXml(value) {
  return escapeHtml(value).replace(/&#39;/g, "&apos;");
}

function serializeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function formatUpdatedAt(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
}

function renderDocumentSection(documentData) {
  const category = documentData.path.includes("/") ? documentData.path.split("/").slice(0, -1).join(" / ") : "DOCUMENT";
  const hasH1 = (documentData.headings || []).some((heading) => heading.level === 1);
  const description = documentData.description ? `<p class="lead doc-description">${escapeHtml(documentData.description)}</p>` : "";
  const meta = formatUpdatedAt(documentData.updatedAt);
  return `<section class="doc-section markdown-section" id="doc-page" data-title="${escapeHtml(documentData.title)}"><div class="section-kicker"><span class="kicker-line"></span>${escapeHtml(category)}</div>${hasH1 ? "" : `<h1 class="doc-title">${escapeHtml(documentData.title)}</h1>${description}`}<div class="doc-meta"><span>${escapeHtml(documentData.path)}</span><span>·</span><span>${meta ? `更新于 ${meta}` : ""}</span></div><div class="markdown-body">${documentData.html}</div></section>`;
}

function replaceHeadMeta(template, attribute, name, value) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<meta\\s+${attribute}="${escapedName}"\\s+content="[^"]*"\\s*/?>`, "i");
  return template.replace(pattern, `<meta ${attribute}="${escapeHtml(name)}" content="${escapeHtml(value)}" />`);
}

function renderPage(template, config, documentData, pageUrl, options = {}) {
  const seo = seoValues(config, documentData, pageUrl, options);
  let html = template.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(seo.title)}</title>`);
  [
    ["name", "description", seo.description],
    ["name", "keywords", seo.keywords],
    ["name", "author", seo.author],
    ["name", "robots", seo.robots],
    ["name", "theme-color", seo.themeColor],
    ["property", "og:title", seo.title],
    ["property", "og:description", seo.description],
    ["property", "og:type", seo.type],
    ["property", "og:url", seo.url],
    ["property", "og:image", seo.image],
    ["name", "twitter:card", seo.image ? "summary_large_image" : "summary"],
    ["name", "twitter:title", seo.title],
    ["name", "twitter:description", seo.description],
    ["name", "twitter:image", seo.image]
  ].forEach(([attribute, name, value]) => { html = replaceHeadMeta(html, attribute, name, value); });
  const canonical = `<link rel="canonical" href="${escapeHtml(seo.canonical)}" />`;
  html = html.replace(/<link\s+rel="canonical"[^>]*>/i, canonical);
  const faviconSource = imageSource(config.site?.favicon || config.site?.ico, options);
  const faviconType = String(config.site?.favicon || config.site?.ico || "").toLowerCase().endsWith(".ico") ? "image/x-icon" : "image/png";
  const favicon = `<link rel="icon" id="site-favicon"${faviconSource ? ` href="${escapeHtml(faviconSource)}" type="${faviconType}"` : ""} />`;
  html = html.replace(/<link\s+rel="icon"\s+id="site-favicon"[^>]*>/i, favicon);
  const content = documentData ? renderDocumentSection(documentData) : `<section class="doc-section empty-document"><h1>还没有 Markdown 文档</h1><p>把 Markdown 文件放入文档目录，然后刷新页面。</p></section>`;
  html = html.replace(/<article\s+class="doc-article"\s+id="doc-content"\s+aria-live="polite">[\s\S]*?<\/article>/i, `<article class="doc-article" id="doc-content" aria-live="polite">${content}</article>`);
  if (Object.prototype.hasOwnProperty.call(options, "staticData")) {
    const staticData = `<script id="docskit-static-data" type="application/json">${serializeInlineJson(options.staticData)}</script>`;
    // 静态数据必须先于运行时脚本出现，浏览器解析脚本时才能直接进入离线模式。
    const runtimeScriptPattern = /<script\s+src="[^"]*script\.js"[^>]*><\/script>/i;
    if (runtimeScriptPattern.test(html)) html = html.replace(runtimeScriptPattern, (runtimeScript) => `${staticData}${runtimeScript}`);
    else html = html.replace(/<\/body>/i, `${staticData}</body>`);
  }
  return html;
}

function bodyEtag(body) {
  return `"${stableHash(body).toString(16)}-${Buffer.byteLength(body)}"`;
}

function sendBody(response, status, body, headers, options = {}) {
  const etag = bodyEtag(body);
  const responseHeadersValue = assets.responseHeaders({ ...headers, ETag: etag });
  if (options.request?.headers?.["if-none-match"] === etag) {
    response.writeHead(304, responseHeadersValue);
    response.end();
    return;
  }
  response.writeHead(status, { ...responseHeadersValue, "Content-Length": Buffer.byteLength(body) });
  response.end(options.request?.method === "HEAD" ? undefined : body);
}

function jsonResponse(response, status, payload, options = {}) {
  const body = JSON.stringify(payload);
  sendBody(response, status, body, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": options.cacheControl || "no-cache, must-revalidate" }, options);
}

function preferredDocument(documents) {
  return documents.find((document) => /(^|\/)index\.(md|markdown)$/i.test(document.path)) || documents.find((document) => /(^|\/)readme\.(md|markdown)$/i.test(document.path)) || documents[0];
}

function pageUrlFor(requestUrl, documentPath) {
  const pageUrl = new URL("/", requestUrl.origin);
  if (documentPath) pageUrl.searchParams.set("doc", documentPath);
  return pageUrl.href;
}

function renderRobots(config, origin, options = {}) {
  const robots = String(config.site?.seo?.robots || "index,follow");
  const disallow = /noindex/i.test(robots) ? "Disallow: /\n" : "Disallow:\n";
  const sitemapUrl = String(options.sitemapUrl || (origin ? `${String(origin).replace(/\/+$/, "")}/sitemap.xml` : ""));
  return `User-agent: *\n${disallow}${sitemapUrl ? `Sitemap: ${sitemapUrl}\n` : ""}`;
}

function renderSitemap(documents, origin, options = {}) {
  const homeUrl = options.homeUrl || (origin ? new URL("/", origin).href : "/");
  const documentUrl = typeof options.documentUrl === "function"
    ? options.documentUrl
    : (document) => {
      const url = new URL("/", origin);
      url.searchParams.set("doc", document.path);
      return url.href;
    };
  const entries = documents.map((document) => {
    const lastModified = new Date(document.updatedAt);
    const lastmod = Number.isNaN(lastModified.getTime()) ? "" : `<lastmod>${lastModified.toISOString()}</lastmod>`;
    return `<url><loc>${escapeXml(documentUrl(document))}</loc>${lastmod}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeXml(homeUrl)}</loc></url>${entries}</urlset>`;
}

async function handleRequest(request, response, options = {}) {
  const loadCurrentConfig = typeof options.loadConfig === "function" ? options.loadConfig : loadConfig;
  const loadIndex = typeof options.getDocumentIndex === "function" ? options.getDocumentIndex : getDocumentIndex;
  const rootDir = options.rootDir || ROOT_DIR;
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (!["GET", "HEAD"].includes(request.method)) return jsonResponse(response, 405, { error: "只支持 GET 和 HEAD 请求" }, { request, cacheControl: "no-store" });
  if (requestUrl.pathname === "/healthz") return jsonResponse(response, 200, { status: "ok", service: "docs-kit" }, { request, cacheControl: "no-store" });

  const current = await loadCurrentConfig();
  const { config, docsDir } = current;

  if (requestUrl.pathname === "/readyz") {
    try {
      const docsStat = await fsp.lstat(docsDir);
      if (!docsStat.isDirectory()) throw new Error("文档目录不是目录");
      const { documents } = await loadIndex(docsDir);
      return jsonResponse(response, 200, { status: "ready", service: "docs-kit", documents: documents.length }, { request, cacheControl: "no-store" });
    } catch (error) {
      throw createHttpError(503, "文档服务尚未就绪", error);
    }
  }

  if (requestUrl.pathname === "/api/bootstrap") {
    const index = await loadIndex(docsDir);
    const { documents, directoryMetadata } = index;
    const tree = createTree(documents, config, directoryMetadata);
    const preferred = preferredDocument(documents);
    return jsonResponse(response, 200, { config: publicConfig(config), tree, defaultPath: preferred ? preferred.path : "", documents: documents.map((document) => {
      const icon = documentIcon(config, document);
      return { path: document.path, title: document.title, description: document.description, icon: icon.name, iconColor: icon.color, iconColors: icon.colors, createdAt: document.createdAt };
    }) }, { request });
  }

  if (requestUrl.pathname === "/api/document") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    let filePath;
    try { filePath = safeResolve(docsDir, requestedPath); } catch (error) { return jsonResponse(response, 400, { error: "无效文档路径" }, { request, cacheControl: "no-store" }); }
    if (!/\.(md|markdown)$/i.test(filePath)) return jsonResponse(response, 400, { error: "只支持 Markdown 文档" });
    const { documents } = await loadIndex(docsDir);
    const document = documents.find((item) => item.path === normalizeRelative(requestedPath));
    if (!document) return jsonResponse(response, 404, { error: "文档不存在" });
    return jsonResponse(response, 200, publicDocument(document, config), { request });
  }

  if (requestUrl.pathname === "/api/search") {
    const query = requestUrl.searchParams.get("q") || "";
    if (query.length > MAX_SEARCH_QUERY_LENGTH) return jsonResponse(response, 400, { error: "搜索关键词过长" }, { request, cacheControl: "no-store" });
    const { documents } = await loadIndex(docsDir);
    return jsonResponse(response, 200, { query, results: makeSearchResults(documents, query, config) }, { request });
  }

  if (requestUrl.pathname === "/api/asset") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    if (/\.(md|markdown)$/i.test(requestedPath)) return jsonResponse(response, 403, { error: "不允许读取 Markdown 原文" }, { request, cacheControl: "no-store" });
    if (!assets.isPublicAssetPath(requestedPath)) return jsonResponse(response, 404, { error: "资源不存在" }, { request, cacheControl: "no-store" });
    let filePath;
    try {
      filePath = await resolveExistingFile(docsDir, requestedPath);
    } catch (error) {
      if (error.statusCode) return jsonResponse(response, error.statusCode, { error: error.publicMessage }, { request, cacheControl: "no-store" });
      return jsonResponse(response, 404, { error: "资源不存在" }, { request, cacheControl: "no-store" });
    }
    return assets.sendFile(response, filePath, { request, maxBytes: assets.assetMaxBytes(requestedPath), cacheControl: "public, max-age=300, must-revalidate" });
  }

  if (requestUrl.pathname === "/api/download") {
    const requestedPath = requestUrl.searchParams.get("path") || "";
    if (/\.(md|markdown)$/i.test(requestedPath)) return jsonResponse(response, 403, { error: "不允许下载 Markdown 原文" }, { request, cacheControl: "no-store" });
    if (!assets.isPublicAssetPath(requestedPath)) return jsonResponse(response, 404, { error: "资源不存在" }, { request, cacheControl: "no-store" });
    let filePath;
    try {
      filePath = await resolveExistingFile(docsDir, requestedPath);
    } catch (error) {
      if (error.statusCode) return jsonResponse(response, error.statusCode, { error: error.publicMessage }, { request, cacheControl: "no-store" });
      return jsonResponse(response, 404, { error: "资源不存在" }, { request, cacheControl: "no-store" });
    }
    return assets.sendFile(response, filePath, { request, maxBytes: assets.assetMaxBytes(requestedPath), cacheControl: "private, no-cache, must-revalidate", contentDisposition: "attachment" });
  }

  if (requestUrl.pathname.startsWith("/api/")) return jsonResponse(response, 404, { error: "接口不存在" });

  if (requestUrl.pathname === "/" || requestUrl.pathname === "/index.html") {
    const index = await loadIndex(docsDir);
    const requestedPath = normalizeRelative(requestUrl.searchParams.get("doc") || "");
    const selected = requestedPath ? index.documents.find((document) => document.path === requestedPath) : preferredDocument(index.documents);
    const templatePath = await resolveExistingFile(rootDir, "index.html");
    const template = await fsp.readFile(templatePath, "utf8");
    const documentData = selected ? publicDocument(selected, config) : null;
    const status = requestedPath && !selected ? 404 : 200;
    return sendBody(response, status, renderPage(template, config, documentData, pageUrlFor(requestUrl, requestedPath)), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, must-revalidate" }, { request });
  }

  if (requestUrl.pathname === "/robots.txt") return sendBody(response, 200, renderRobots(config, requestUrl.origin), { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache, must-revalidate" }, { request });
  if (requestUrl.pathname === "/sitemap.xml") {
    const { documents } = await loadIndex(docsDir);
    return sendBody(response, 200, renderSitemap(documents, requestUrl.origin), { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-cache, must-revalidate" }, { request });
  }

  const vendorPath = assets.vendorResourcePath(requestUrl.pathname);
  if (!STATIC_RESOURCE_PATHS.has(requestUrl.pathname) && !vendorPath) return jsonResponse(response, 404, { error: "页面不存在" }, { request, cacheControl: "no-store" });
  let staticPath;
  try { staticPath = await resolveExistingFile(rootDir, vendorPath || requestUrl.pathname.slice(1)); } catch (error) {
    if (error.statusCode) return jsonResponse(response, error.statusCode, { error: error.publicMessage }, { request, cacheControl: "no-store" });
    throw error;
  }
  const relativeStaticPath = vendorPath || requestUrl.pathname.slice(1);
  const isSkillArchive = relativeStaticPath === SKILL_ARCHIVE_PATH;
  return assets.sendFile(response, staticPath, {
    request,
    maxBytes: isSkillArchive ? MAX_DOWNLOAD_BYTES : MAX_ASSET_BYTES,
    cacheControl: "public, max-age=3600, must-revalidate",
    ...(isSkillArchive ? { contentDisposition: "attachment" } : {})
  });
}

function createServer(options = {}) {
  const requestHandler = options.handleRequest || ((request, response) => handleRequest(request, response, options));
  return http.createServer((request, response) => {
    Promise.resolve().then(() => requestHandler(request, response)).catch((error) => {
      if (error.statusCode >= 500 || !error.statusCode) console.error(error);
      if (!response.headersSent) {
        const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
        const message = error.publicMessage || (status >= 500 ? "服务器内部错误" : "请求无法处理");
        jsonResponse(response, status, { error: message }, { request, cacheControl: "no-store" });
      }
      else response.end();
    });
  });
}

function closeDocumentIndexWatchers() {
  for (const state of documentIndexCache.values()) {
    for (const watcher of state.watchers.values()) watcher.close();
    state.watchers.clear();
  }
}

function startServer() {
  return startServerRuntime({ createServer, closeDocumentIndexWatchers, port, host, cliArgs, resolveFromRoot });
}

if (require.main === module) startServer();

module.exports = {
  DEFAULT_CONFIG,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_MARKDOWN_BYTES,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  MAX_DOWNLOAD_BYTES,
  INDEX_POLL_INTERVAL_MS,
  parseArgs,
  mergeConfig,
  resolveFromRoot,
  pathSetting,
  configFileSignature,
  readConfigFile,
  loadConfig,
  normalizeRelative,
  safeResolve,
  assertNoSymlink,
  resolveExistingFile,
  isPublicAssetPath: assets.isPublicAssetPath,
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
  scanFilesystemSignature,
  createDocumentIndexState,
  markDocumentIndexDirty,
  syncDirectoryWatchers,
  getDocumentIndex,
  sortNodes,
  createTree,
  renderInline,
  parseMarkdown,
  renderMarkdown,
  documentIcon,
  publicDocument,
  makeSearchSnippet,
  makeSearchResults,
  publicConfig,
  renderPage,
  renderRobots,
  renderSitemap,
  assetMaxBytes: assets.assetMaxBytes,
  parseByteRange: assets.parseByteRange,
  jsonResponse,
  sendFile: assets.sendFile,
  handleRequest,
  createServer,
  closeDocumentIndexWatchers,
  startServer
};
