"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { createHash } = require("node:crypto");
const { splitFrontMatter, humanizeName, firstHeading, firstParagraph } = require("./markdown");
const { createHttpError } = require("./server-filesystem");
const { apiConnectSources } = require("./server-api-policy");
const {
  MAX_MARKDOWN_BYTES, MAX_DIRECTORY_DEPTH, MAX_DOCUMENT_COUNT, MAX_DIRECTORY_WATCHERS,
  DEFAULT_INDEX_BYTES, INDEX_POLL_INTERVAL_MS, INDEX_RETRY_DELAY_MS
} = require("./server-config");

const MAX_INDEX_ROOTS = 4;

function compareNames(left, right) {
  return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
}

function creationTime(stat) {
  const candidates = [stat.birthtimeMs, stat.ctimeMs, stat.mtimeMs].map(Number);
  const timestamp = candidates.find((value) => Number.isFinite(value) && value > 0) || 0;
  return { createdAtMs: timestamp || Number.MAX_SAFE_INTEGER, createdAt: timestamp ? new Date(timestamp).toISOString() : "" };
}

function assertDirectoryDepth(depth, relativePath) {
  if (depth > MAX_DIRECTORY_DEPTH) throw createHttpError(422, `文档目录超过 ${MAX_DIRECTORY_DEPTH} 级：${relativePath || "根目录"}`);
}

function assertDocumentCount(count, relativePath) {
  if (count > MAX_DOCUMENT_COUNT) throw createHttpError(422, `Markdown 文档数量超过上限 ${MAX_DOCUMENT_COUNT} 篇，超限文件：${relativePath}`);
}

async function scanDocuments(docsDir, options = {}) {
  const { buildSearchFields } = require("./content-search");
  const documents = [];
  const directories = new Set();
  const directoryMetadata = new Map();
  const signatureParts = [];
  const maxBytes = options.maxBytes ?? DEFAULT_INDEX_BYTES;
  let documentCount = 0;
  let contentBytes = 0;
  async function walk(directory, prefix, depth) {
    assertDirectoryDepth(depth, prefix);
    let entries;
    let directoryStat;
    try {
      [entries, directoryStat] = await Promise.all([fsp.readdir(directory, { withFileTypes: true }), fsp.lstat(directory)]);
    } catch (error) {
      if (error.code === "ENOENT" && depth > 0) return;
      throw error;
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      if (depth === 0) throw createHttpError(422, "文档根目录必须是普通目录");
      return;
    }
    directories.add(directory);
    directoryMetadata.set(prefix, creationTime(directoryStat));
    signatureParts.push(`d:${prefix}:${directoryStat.size}:${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`);
    entries.sort((left, right) => left.isDirectory() !== right.isDirectory() ? (left.isDirectory() ? -1 : 1) : compareNames(left.name, right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolutePath, relativePath, depth + 1); continue; }
      const isDocument = /\.(md|markdown)$/i.test(entry.name);
      if (!isDocument && !/\.(json|ya?ml)$/i.test(entry.name)) continue;
      let fileStat;
      let raw;
      try {
        fileStat = await fsp.lstat(absolutePath);
        if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
        signatureParts.push(`f:${relativePath}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}`);
        if (!isDocument) continue;
        assertDocumentCount(++documentCount, relativePath);
        if (fileStat.size > MAX_MARKDOWN_BYTES) continue;
        if (contentBytes + fileStat.size > maxBytes) throw createHttpError(422, "文档索引超过内容字节预算");
        raw = await fsp.readFile(absolutePath, "utf8");
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      const front = splitFrontMatter(raw);
      if (front.attributes.hidden === true) continue;
      const baseName = entry.name.replace(/\.(markdown|md)$/i, "");
      const parent = prefix ? prefix.split("/").pop() : "";
      const inferredTitle = /^(readme|index)$/i.test(baseName) && parent ? humanizeName(parent) : humanizeName(entry.name);
      const title = String(front.attributes.title || firstHeading(front.body) || inferredTitle);
      const fields = buildSearchFields(front.body, relativePath);
      const apiReference = front.attributes.openapi
        ? await require("./openapi").loadApiReference(docsDir, relativePath, front.attributes.openapi) : null;
      let apiRevision = "";
      if (apiReference) {
        const apiText = JSON.stringify(apiReference.spec);
        // 契约独立于 Markdown 更新，缓存版本必须包含已打包契约本身。
        apiRevision = createHash("sha256").update(apiText).digest("hex");
        fields.searchText += `\n${apiReference.title}\n${apiText}`;
        fields.sections.push({ id: "", title: apiReference.title, text: apiReference.title, code: apiText });
      }
      const document = {
        type: "file", path: relativePath, title,
        description: String(front.attributes.description || firstParagraph(front.body) || ""),
        order: typeof front.attributes.order === "number" ? front.attributes.order : Number.MAX_SAFE_INTEGER,
        icon: front.attributes.icon || "", hidden: false,
        body: front.body, ...fields,
        ...(apiReference ? { apiReference } : {}),
        searchText: `${title}\n${relativePath}\n${fields.searchText}`.toLocaleLowerCase(),
        updatedAt: fileStat.mtime.toISOString(), ...creationTime(fileStat),
        cacheKey: `${path.resolve(absolutePath)}:${fileStat.size}:${fileStat.mtimeMs}:${fileStat.ctimeMs}:${apiRevision}`
      };
      // 浏览器也校验目标来源，保证不支持 _headers 的静态托管遵循相同约束。
      if (apiReference) apiReference.connectSources = apiConnectSources([document]);
      // 预算包含正文、检索字段和元数据，不长期保留重复的原始 Markdown。
      contentBytes += Buffer.byteLength(JSON.stringify(document));
      if (contentBytes > maxBytes) throw createHttpError(422, "文档索引超过内容字节预算");
      documents.push(document);
    }
  }
  await walk(docsDir, "", 0);
  // 在替换有效索引之前校验浏览器权限，坏服务器声明不会破坏已发布页面。
  const connectSources = apiConnectSources(documents);
  return { documents, directories, directoryMetadata, contentBytes, connectSources, filesystemSignature: signatureParts.sort().join("|") };
}

async function scanFilesystemSignature(docsDir) {
  const signatureParts = [];
  let documentCount = 0;
  async function walk(directory, prefix, depth) {
    assertDirectoryDepth(depth, prefix);
    let entries;
    let directoryStat;
    try {
      [entries, directoryStat] = await Promise.all([fsp.readdir(directory, { withFileTypes: true }), fsp.lstat(directory)]);
    } catch (error) {
      if (error.code === "ENOENT" && depth > 0) return;
      throw error;
    }
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      if (depth === 0) throw createHttpError(422, "文档根目录必须是普通目录");
      return;
    }
    signatureParts.push(`d:${prefix}:${directoryStat.size}:${directoryStat.mtimeMs}:${directoryStat.ctimeMs}`);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.isSymbolicLink()) continue;
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) { await walk(absolutePath, relativePath, depth + 1); continue; }
      const isDocument = /\.(md|markdown)$/i.test(entry.name);
      if (!isDocument && !/\.(json|ya?ml)$/i.test(entry.name)) continue;
      let stat;
      try { stat = await fsp.lstat(absolutePath); }
      catch (error) { if (error.code === "ENOENT") continue; throw error; }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      signatureParts.push(`f:${relativePath}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`);
      if (isDocument) assertDocumentCount(++documentCount, relativePath);
    }
  }
  await walk(docsDir, "", 0);
  return signatureParts.sort().join("|");
}

function createDocumentIndexState(docsDir) {
  return {
    docsDir, documents: [], directoryMetadata: new Map(), dirty: true, revision: 0,
    promise: null, watchers: new Map(), watchUnavailable: false, watchWarningShown: false,
    filesystemSignature: "", lastSignatureCheckAt: 0, published: false, error: null,
    retryAt: 0, maxBytes: DEFAULT_INDEX_BYTES, contentBytes: 0, connectSources: []
  };
}

function createDocumentIndexStore(options = {}) {
  const states = new Map();
  const scan = options.scan || scanDocuments;
  const signature = options.signature || scanFilesystemSignature;
  const now = options.now || Date.now;
  const watch = options.watch || ((...args) => fs.watch(...args));
  const pollIntervalMs = options.pollIntervalMs ?? INDEX_POLL_INTERVAL_MS;
  const retryDelayMs = options.retryDelayMs ?? INDEX_RETRY_DELAY_MS;
  const invalidate = () => options.onInvalidate?.();
  function markDocumentIndexDirty(state) {
    state.dirty = true;
    state.revision++;
    invalidate();
  }
  function syncDirectoryWatchers(state, directories) {
    const active = new Set(Array.from(directories, (directory) => path.resolve(directory)));
    const selected = active.size > MAX_DIRECTORY_WATCHERS ? new Set([path.resolve(state.docsDir)]) : active;
    let unavailable = active.size > MAX_DIRECTORY_WATCHERS;
    for (const directory of selected) {
      if (state.watchers.has(directory)) continue;
      try {
        const watcher = watch(directory, { persistent: false }, () => markDocumentIndexDirty(state));
        watcher.on("error", () => {
          watcher.close();
          state.watchers.delete(directory);
          state.watchUnavailable = true;
          markDocumentIndexDirty(state);
        });
        state.watchers.set(directory, watcher);
      } catch { unavailable = true; }
    }
    for (const [directory, watcher] of state.watchers) {
      if (selected.has(directory)) continue;
      watcher.close();
      state.watchers.delete(directory);
    }
    state.watchUnavailable = unavailable;
    return active.size > 0;
  }
  function result(state) {
    return {
      documents: state.documents, directoryMetadata: state.directoryMetadata,
      health: state.error ? {
        status: "degraded", error: { code: state.error.statusCode || 503, message: state.error.publicMessage || "索引更新失败，正在使用上一份有效索引" },
        retryAt: new Date(state.retryAt).toISOString()
      } : { status: "ready" },
      contentBytes: state.contentBytes, connectSources: state.connectSources
    };
  }
  function closeState(state) {
    for (const watcher of state.watchers.values()) watcher.close();
    state.watchers.clear();
  }
  async function getDocumentIndex(docsDir, settings = {}) {
    const cacheKey = path.resolve(docsDir);
    let state = states.get(cacheKey);
    if (!state) {
      state = createDocumentIndexState(cacheKey);
      states.set(cacheKey, state);
      while (states.size > MAX_INDEX_ROOTS) {
        const oldest = states.keys().next().value;
        closeState(states.get(oldest));
        states.delete(oldest);
      }
    }
    const maxBytes = settings.maxBytes ?? DEFAULT_INDEX_BYTES;
    if (state.maxBytes !== maxBytes) { state.maxBytes = maxBytes; markDocumentIndexDirty(state); }
    if (state.promise) return state.promise;
    if (state.error && now() < state.retryAt) {
      if (!state.published) throw state.error;
      return result(state);
    }
    if (!state.dirty && now() - state.lastSignatureCheckAt < pollIntervalMs) return result(state);
    const revision = state.revision;
    state.promise = (async () => {
      try {
        if (!state.dirty) {
          state.lastSignatureCheckAt = now();
          const nextSignature = await signature(state.docsDir);
          if (nextSignature === state.filesystemSignature) return result(state);
          state.dirty = true;
          invalidate();
        }
        const next = await scan(state.docsDir, { maxBytes: state.maxBytes });
        state.documents = next.documents;
        state.directoryMetadata = next.directoryMetadata;
        state.filesystemSignature = next.filesystemSignature;
        state.contentBytes = next.contentBytes || 0;
        state.connectSources = next.connectSources || [];
        state.lastSignatureCheckAt = now();
        state.published = true;
        state.error = null;
        state.retryAt = 0;
        invalidate();
        const watching = syncDirectoryWatchers(state, next.directories);
        state.dirty = !watching || state.revision !== revision;
        return result(state);
      } catch (error) {
        state.error = error;
        state.retryAt = now() + retryDelayMs;
        state.dirty = true;
        invalidate();
        if (!state.published) throw error;
        return result(state);
      } finally { state.promise = null; }
    })();
    return state.promise;
  }
  function closeDocumentIndexWatchers() {
    for (const state of states.values()) closeState(state);
    states.clear();
  }
  return { states, getDocumentIndex, markDocumentIndexDirty, syncDirectoryWatchers, closeDocumentIndexWatchers };
}

function preferredDocument(documents, config = {}) {
  if (config.home) {
    const selected = documents.find((document) => document.path === config.home);
    if (!selected) throw createHttpError(422, `首页文档不存在：${config.home}`);
    return selected;
  }
  return documents.find((document) => /^index\.(md|markdown)$/i.test(document.path))
    || documents.find((document) => /^readme\.(md|markdown)$/i.test(document.path))
    || documents.find((document) => /(^|\/)index\.(md|markdown)$/i.test(document.path))
    || documents.find((document) => /(^|\/)readme\.(md|markdown)$/i.test(document.path)) || documents[0];
}

module.exports = {
  compareNames, creationTime, assertDirectoryDepth, assertDocumentCount, scanDocuments,
  scanFilesystemSignature, createDocumentIndexState, createDocumentIndexStore, preferredDocument
};
