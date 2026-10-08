"use strict";

const fsp = require("node:fs").promises;
const path = require("node:path");
const {
  ROOT_DIR,
  DEFAULT_DOCS_DIR,
  CONFIG_FILE_NAME,
  SKILL_ARCHIVE_PATH,
  PUBLIC_ROOT_FILES,
  mergeConfig,
  readConfigFile,
  resolveFromRoot
} = require("./server-config");
const assets = require("./server-assets");
const {
  scanDocuments,
  createTree,
  documentIcon,
  publicDocument,
  publicConfig,
  renderPage,
  renderRobots,
  renderSitemap,
  normalizeRelative,
  preferredDocument
} = require("./server");
const { writeSkillArchive } = require("./skill-archive");
const { buildBundle } = require("./build-highlight");
const { checkContent, assertContentValid } = require("./content-check");
const { apiConnectSources } = require("./server-api-policy");
const { exportMarkdown, renderLlms } = require("./server-exports");

const PROJECT_TEMPLATE_PATH = path.join(ROOT_DIR, "index.html");
const BUILD_MARKER_NAME = ".docskit-build.json";
const BUILD_MARKER = { generator: "docskit", format: 1 };
const CLIENT_FILES = ["script.js", "styles.css", "search-core.js", "client-search.js", "client-navigation.js", "client-api.js"];
const REVALIDATED_RESOURCES = [...CLIENT_FILES, "vendor/scalar.js", "vendor/mermaid.min.js", "vendor/highlight.min.js", "vendor/katex/katex.min.css"];
const STATIC_HEADERS = [
  "/*",
  "  X-Content-Type-Options: nosniff",
  "  Referrer-Policy: strict-origin-when-cross-origin",
  "  X-Frame-Options: SAMEORIGIN",
  "  Permissions-Policy: camera=(), microphone=(), geolocation=()",
  "",
  "/assets/*.svg",
  "  Content-Security-Policy: default-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'; object-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src data:; sandbox",
  ""
].join("\n");

function staticHeaders(documents, base) {
  const policy = assets.contentSecurityPolicy(apiConnectSources(documents));
  const securityHeaders = STATIC_HEADERS.replace("/*\n", `/*\n  Content-Security-Policy: ${policy}\n`).replace("/assets/*.svg", `${base}assets/*.svg`);
  // 固定资源名在发布后需要重新校验，避免旧脚本与新 HTML 合同混用。
  return `${securityHeaders}\n${REVALIDATED_RESOURCES.map((resource) => `${publicPath(base, resource)}\n  Cache-Control: no-cache, must-revalidate\n`).join("\n")}`;
}

function optionValue(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function parseBuildArgs(argv) {
  const options = {};
  const names = new Map([
    ["--docs", "docsDir"],
    ["--config", "configPath"],
    ["--out", "outDir"],
    ["--base", "base"],
    ["--site-url", "siteUrl"]
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] || "");
    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }
    const equalIndex = token.indexOf("=");
    const name = equalIndex >= 0 ? token.slice(0, equalIndex) : token;
    const optionName = names.get(name);
    if (!optionName) throw new Error(`未知构建参数: ${token}`);
    const value = equalIndex >= 0 ? token.slice(equalIndex + 1) : argv[++index];
    if (typeof value !== "string" || !value.trim() || value.startsWith("--")) throw new Error(`${name} 缺少参数值`);
    options[optionName] = value;
  }
  return options;
}

function buildHelp() {
  return [
    "用法: npm run build -- [选项]",
    "",
    "选项:",
    "  --docs <目录>       Markdown 文档目录，默认读取配置或 docs/",
    "  --config <文件>     配置文件路径",
    "  --out <目录>        静态输出目录，默认 dist/",
    "  --base <路径>       部署基路径，例如 /docs/，默认 /",
    "  --site-url <地址>   站点根地址，用于 canonical、robots 和 sitemap",
    "  --help              显示帮助"
  ].join("\n");
}

function normalizeBase(value) {
  const raw = optionValue(value, "/");
  if (/[?#]/.test(raw)) throw new Error("--base 不能包含查询参数或锚点");
  if (raw === "." || raw === "./") throw new Error("--base 必须是以 / 开头的 URL 路径");
  if (raw !== "/" && !raw.startsWith("/")) throw new Error("--base 必须是以 / 开头的 URL 路径");
  const normalized = `/${raw.replace(/^\/+|\/+$/g, "")}/`;
  return normalized === "//" ? "/" : normalized;
}

function normalizeSiteUrl(value) {
  const raw = optionValue(value, "");
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error("--site-url 必须是完整的 http(s) 地址");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || (parsed.pathname !== "/" && parsed.pathname)) {
    throw new Error("--site-url 只支持不带路径、查询参数和锚点的 http(s) 地址");
  }
  return parsed.origin;
}

function encodeUrlPath(value) {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).map((segment) => encodeURIComponent(segment)).join("/");
}

function publicPath(base, relativePath) {
  const encoded = encodeUrlPath(relativePath);
  return `${base}${encoded}`;
}

function documentOutputPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  const withoutExtension = normalized.replace(/\.(?:md|markdown)$/i, "");
  const candidate = `${withoutExtension}.html`;
  return candidate.toLowerCase() === "index.html" ? `${normalized}.html` : candidate;
}

function assertUniqueDocumentOutputs(documents) {
  const outputs = new Map();
  for (const document of documents) {
    const outputPath = documentOutputPath(document.path);
    // 静态产物也可能部署到大小写不敏感的文件系统。
    const key = outputPath.normalize("NFC").toLowerCase();
    if (outputs.has(key)) {
      throw new Error(`静态页面输出路径冲突：${outputs.get(key)} 与 ${document.path} -> ${outputPath}`);
    }
    outputs.set(key, document.path);
  }
  for (const [outputPath, sourcePath] of outputs) {
    let parent = path.posix.dirname(outputPath);
    while (parent !== ".") {
      if (outputs.has(parent)) throw new Error(`静态页面输出路径冲突：${outputs.get(parent)} 与 ${sourcePath}`);
      parent = path.posix.dirname(parent);
    }
  }
}

function isWithin(parent, target) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveBuildContext(options = {}) {
  const explicitDocs = optionValue(options.docsDir, optionValue(process.env.DOCS_DIR, ""));
  const preliminaryDocsDir = resolveFromRoot(explicitDocs || DEFAULT_DOCS_DIR);
  const explicitConfig = optionValue(options.configPath, optionValue(process.env.DOCS_CONFIG, ""));
  const configPath = explicitConfig ? resolveFromRoot(explicitConfig) : path.join(preliminaryDocsDir, CONFIG_FILE_NAME);
  return { explicitDocs, configPath };
}

async function loadBuildContext(options = {}) {
  const context = resolveBuildContext(options);
  const source = options.config && typeof options.config === "object" ? options.config : await readConfigFile(context.configPath);
  const docsSetting = context.explicitDocs || optionValue(process.env.DOCS_DIR, source.docsDir || DEFAULT_DOCS_DIR);
  return {
    config: mergeConfig(source),
    configPath: context.configPath,
    docsDir: resolveFromRoot(docsSetting)
  };
}

function sitePageUrl(siteUrl, pagePath) {
  return siteUrl ? `${siteUrl}${pagePath}` : pagePath;
}

function rewriteTemplate(template, base) {
  return template
    .replace(/href="styles\.css"/i, `href="${publicPath(base, "styles.css")}"`)
    .replace(/href="\/vendor\/katex\/katex\.min\.css"/i, `href="${publicPath(base, "vendor/katex/katex.min.css")}"`)
    .replace(/src="((?:script|search-core|client-search|client-navigation|client-api)\.js)"/gi, (_, name) => `src="${publicPath(base, name)}"`)
    .replace(/(<a\s+class="brand"\s+href=")[^"]*"/i, `$1${publicPath(base, "")}"`);
}

async function writeText(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content, "utf8");
}

async function copyProjectRuntime(outputDir) {
  for (const fileName of CLIENT_FILES) {
    await fsp.copyFile(path.join(ROOT_DIR, fileName), path.join(outputDir, fileName));
  }
  const mermaidSource = path.join(ROOT_DIR, "node_modules", "mermaid", "dist", "mermaid.min.js");
  const katexSource = path.join(ROOT_DIR, "node_modules", "katex", "dist");
  await fsp.mkdir(path.join(outputDir, "vendor"), { recursive: true });
  await fsp.copyFile(mermaidSource, path.join(outputDir, "vendor", "mermaid.min.js"));
  await fsp.copyFile(path.join(ROOT_DIR, "node_modules", "@scalar", "api-reference", "dist", "browser", "standalone.js"), path.join(outputDir, "vendor", "scalar.js"));
  buildBundle({ outputPath: path.join(outputDir, "vendor", "highlight.min.js") });
  await fsp.cp(katexSource, path.join(outputDir, "vendor", "katex"), { recursive: true });
}

async function copyPublicRootFiles(outputDir) {
  for (const relativePath of PUBLIC_ROOT_FILES) {
    const targetPath = path.join(outputDir, ...relativePath.split("/"));
    await fsp.mkdir(path.dirname(targetPath), { recursive: true });
    if (relativePath === SKILL_ARCHIVE_PATH) await writeSkillArchive(targetPath);
    else await fsp.copyFile(path.join(ROOT_DIR, ...relativePath.split("/")), targetPath);
  }
  return PUBLIC_ROOT_FILES.length;
}

async function copyPublicAssets(docsDir, outputDir) {
  let copied = 0;
  async function walk(directory, prefix) {
    let entries;
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "zh-CN", { numeric: true, sensitivity: "base" }));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const sourcePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(sourcePath, relativePath);
        continue;
      }
      if (!entry.isFile() || !assets.isPublicAssetPath(relativePath)) continue;
      const stat = await fsp.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      if (stat.size > assets.assetMaxBytes(relativePath)) throw new Error(`资源过大：${relativePath}`);
      const targetPath = path.join(outputDir, "assets", ...relativePath.split("/"));
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.copyFile(sourcePath, targetPath);
      copied += 1;
    }
  }
  await walk(docsDir, "");
  return copied;
}

function documentSummary(document, config, base) {
  const icon = documentIcon(config, document);
  return {
    path: document.path,
    title: document.title,
    description: document.description,
    icon: icon.name,
    iconColor: icon.color,
    iconColors: icon.colors,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    url: publicPath(base, documentOutputPath(document.path))
  };
}

function searchIndexDocument(document, config, base) {
  return {
    ...documentSummary(document, config, base),
    plainBody: document.plainBody,
    searchText: document.searchText,
    sections: document.sections
  };
}

function assertSafeOutput(outputDir, docsDir) {
  const resolvedOutput = path.resolve(outputDir);
  const resolvedDocs = path.resolve(docsDir);
  if (resolvedOutput === path.parse(resolvedOutput).root || resolvedOutput === path.resolve(ROOT_DIR)) throw new Error("静态输出目录不能是文件系统根目录或项目根目录");
  if (isWithin(resolvedDocs, resolvedOutput) || isWithin(resolvedOutput, resolvedDocs)) throw new Error("静态输出目录不能与文档目录相同或互相包含");
}

async function assertOutputIsNotSymlink(outputDir) {
  // 检查全部父目录，避免通过目录联接把产物写到未经核验的位置。
  let current = path.resolve(outputDir);
  while (true) {
    try {
      const stat = await fsp.lstat(current);
      if (stat.isSymbolicLink()) throw new Error("静态输出目录及其父目录不能是符号链接");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function assertManagedOutput(outputDir) {
  let entries;
  try {
    entries = await fsp.readdir(outputDir);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (entries.length === 0) return true;
  try {
    const marker = JSON.parse(await fsp.readFile(path.join(outputDir, BUILD_MARKER_NAME), "utf8"));
    if (marker.generator === BUILD_MARKER.generator && marker.format === BUILD_MARKER.format) return true;
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  // 兼容首次启动留下的唯一高亮缓存，不接受混有其他文件的目录。
  if (path.resolve(outputDir) === path.join(ROOT_DIR, "dist") && entries.length === 1 && entries[0] === "vendor") {
    const vendorFiles = await fsp.readdir(path.join(outputDir, "vendor"));
    if (vendorFiles.length === 1 && vendorFiles[0] === "highlight.min.js") return true;
  }
  throw new Error(`输出目录不是 DocsKit 已登记的构建产物，拒绝覆盖：${outputDir}。请改用新的空目录。`);
}

async function removeTemporaryBuild(directory, parent) {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(parent) || !path.basename(resolved).startsWith(".docskit-")) {
    throw new Error("拒绝清理超出构建范围的目录");
  }
  await fsp.rm(resolved, { recursive: true, force: true });
}

async function replaceOutput(stagedDir, outputDir) {
  const parent = path.dirname(outputDir);
  await assertOutputIsNotSymlink(outputDir);
  const hasPrevious = await assertManagedOutput(outputDir);
  let backupRoot;
  if (hasPrevious) {
    backupRoot = await fsp.mkdtemp(path.join(parent, ".docskit-backup-"));
    try {
      await fsp.rename(outputDir, path.join(backupRoot, "previous"));
    } catch (error) {
      await removeTemporaryBuild(backupRoot, parent);
      throw error;
    }
  }
  try {
    await fsp.rename(stagedDir, outputDir);
  } catch (error) {
    if (backupRoot) {
      try {
        await fsp.rename(path.join(backupRoot, "previous"), outputDir);
        await removeTemporaryBuild(backupRoot, parent);
      } catch (restoreError) {
        throw new Error(`产物切换失败且自动恢复失败，上一版保留在 ${backupRoot}：${restoreError.message}`, { cause: error });
      }
    }
    throw error;
  }
  if (backupRoot) {
    try { await removeTemporaryBuild(backupRoot, parent); }
    catch (error) { console.warn(`新产物已发布，旧产物清理失败，保留在 ${backupRoot}：${error.message}`); }
  }
}

function llmsDocument(config, documents, markdownUrls, documentUrls, siteUrl, full = false) {
  return renderLlms(documents, config, {
    full,
    markdownUrl: (document) => sitePageUrl(siteUrl, markdownUrls[document.path]),
    documentUrl: (document) => sitePageUrl(siteUrl, documentUrls[document.path])
  });
}

async function buildStaticSite(options = {}) {
  const { config, configPath, docsDir } = await loadBuildContext(options);
  const outputDir = path.resolve(resolveFromRoot(optionValue(options.outDir, optionValue(process.env.DOCS_OUT, path.join(ROOT_DIR, "dist")))));
  const configuredUrl = config.site.url ? new URL(config.site.url) : null;
  const base = normalizeBase(optionValue(options.base, optionValue(process.env.DOCS_BASE, configuredUrl?.pathname || "/")));
  const siteUrl = normalizeSiteUrl(optionValue(options.siteUrl, optionValue(process.env.SITE_URL, configuredUrl?.origin || "")));
  assertSafeOutput(outputDir, docsDir);
  await assertOutputIsNotSymlink(outputDir);

  const template = await fsp.readFile(PROJECT_TEMPLATE_PATH, "utf8");
  const scanned = await scanDocuments(docsDir, { maxBytes: config.limits.indexBytes });
  const { documents, directoryMetadata } = scanned;
  const headers = staticHeaders(documents, base);
  assertUniqueDocumentOutputs(documents);
  assertContentValid(await checkContent({ docsDir, configPath, config, documents, directoryMetadata }));
  await assertManagedOutput(outputDir);
  const tree = createTree(documents, config, directoryMetadata);
  const preferred = preferredDocument(documents, config);
  const documentUrls = Object.fromEntries(documents.map((document) => [document.path, publicPath(base, documentOutputPath(document.path))]));
  const markdownUrls = Object.fromEntries(documents.map((document) => [document.path, publicPath(base, `markdown/${document.path}`)]));
  const homePath = preferred ? preferred.path : "";
  const routeDocuments = {
    [publicPath(base, "")]: homePath,
    [publicPath(base, "index.html")]: homePath,
    ...Object.fromEntries(Object.entries(documentUrls).map(([documentPath, url]) => [url, documentPath]))
  };
  const links = {
    document: (documentPath, hashValue) => `${documentUrls[documentPath] || publicPath(base, documentOutputPath(documentPath))}${hashValue || ""}`,
    asset: (assetPath) => publicPath(base, `assets/${assetPath}`)
  };
  const assetUrl = (assetPath) => publicPath(base, `assets/${assetPath}`);
  const publicDocuments = new Map(documents.map((document) => [document.path, {
    ...publicDocument(document, config, { links }), markdownUrl: markdownUrls[document.path]
  }]));
  const summaries = documents.map((document) => documentSummary(document, config, base));
  const staticBuild = { base, documentUrls, routeDocuments, markdownUrls, llmsUrl: publicPath(base, "llms.txt"), llmsFullUrl: publicPath(base, "llms-full.txt") };
  const staticPageBuild = { base, bootstrapUrl: "bootstrap.json" };
  const staticBootstrap = { staticBuild, config: publicConfig(config), tree, documents: summaries, defaultPath: homePath };
  const makeStaticData = (currentDocument) => ({
    staticBuild: staticPageBuild,
    defaultPath: homePath,
    currentPath: currentDocument ? currentDocument.path : "",
    currentDocument: currentDocument || null
  });
  const renderOptions = (currentDocument) => ({ links, assetUrl, staticData: makeStaticData(currentDocument) });
  const pageTemplate = rewriteTemplate(template, base);
  // 先在旁路目录完成全部文件，成功后再替换旧产物，避免部署目录出现半成品。
  await fsp.mkdir(path.dirname(outputDir), { recursive: true });
  const stagedDir = await fsp.mkdtemp(path.join(path.dirname(outputDir), ".docskit-build-"));

  try {
    await copyProjectRuntime(stagedDir);
    const copiedRootFiles = await copyPublicRootFiles(stagedDir);
    const copiedAssets = await copyPublicAssets(docsDir, stagedDir);
    await writeText(path.join(stagedDir, "bootstrap.json"), JSON.stringify(staticBootstrap));
    for (const document of documents) {
      const documentData = publicDocuments.get(document.path);
      await writeText(path.join(stagedDir, "markdown", ...document.path.split("/")), exportMarkdown(document));
      await writeText(path.join(stagedDir, "data", "documents", `${document.path}.json`), JSON.stringify(documentData));
      const pagePath = documentOutputPath(document.path);
      await writeText(path.join(stagedDir, ...pagePath.split("/")), renderPage(pageTemplate, config, documentData, sitePageUrl(siteUrl, documentUrls[document.path]), renderOptions(documentData)));
    }
    const homepageData = preferred ? publicDocuments.get(preferred.path) : null;
    await writeText(path.join(stagedDir, "index.html"), renderPage(pageTemplate, config, homepageData, sitePageUrl(siteUrl, publicPath(base, "")), renderOptions(homepageData)));
    await writeText(path.join(stagedDir, "search-index.json"), JSON.stringify({ documents: documents.map((document) => searchIndexDocument(document, config, base)) }));
    await writeText(path.join(stagedDir, "robots.txt"), renderRobots(config, siteUrl, { sitemapUrl: siteUrl ? sitePageUrl(siteUrl, publicPath(base, "sitemap.xml")) : "" }));
    await writeText(path.join(stagedDir, "sitemap.xml"), renderSitemap(documents, siteUrl, {
      homeUrl: sitePageUrl(siteUrl, publicPath(base, "")),
      documentUrl: (document) => sitePageUrl(siteUrl, documentUrls[document.path])
    }));
    await writeText(path.join(stagedDir, "_headers"), headers);
    await writeText(path.join(stagedDir, "llms.txt"), llmsDocument(config, documents, markdownUrls, documentUrls, siteUrl));
    await writeText(path.join(stagedDir, "llms-full.txt"), llmsDocument(config, documents, markdownUrls, documentUrls, siteUrl, true));
    await writeText(path.join(stagedDir, BUILD_MARKER_NAME), JSON.stringify(BUILD_MARKER));
    await replaceOutput(stagedDir, outputDir);
    return { outputDir, docsDir, configPath, documents: documents.length, assets: copiedAssets + copiedRootFiles, base, siteUrl };
  } catch (error) {
    await removeTemporaryBuild(stagedDir, path.dirname(outputDir));
    throw error;
  }
}

module.exports = {
  STATIC_HEADERS,
  parseBuildArgs,
  buildHelp,
  normalizeBase,
  normalizeSiteUrl,
  documentOutputPath,
  assertUniqueDocumentOutputs,
  publicPath,
  buildStaticSite
};
