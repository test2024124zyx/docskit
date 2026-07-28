"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { classifyAsset, fileNameFromPath, mediaMimeType, MEDIA_MIME_TYPES } = require("./media-types");
const {
  CONFIG_FILE_NAME,
  PUBLIC_ASSET_EXTENSIONS,
  MAX_ASSET_BYTES,
  MAX_MEDIA_BYTES,
  MAX_DOWNLOAD_BYTES,
  normalizeRelative
} = require("./server-config");
const { createHttpError } = require("./server-filesystem");

const MIME_TYPES = {
  ".7z": "application/x-7z-compressed",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".epub": "application/epub+zip",
  ".gif": "image/gif",
  ".gz": "application/gzip",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".png": "image/png",
  ".rar": "application/vnd.rar",
  ".rtf": "application/rtf",
  ".svg": "image/svg+xml",
  ".tar": "application/x-tar",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ...MEDIA_MIME_TYPES
};

// SVG 仍作为图片直接提供，但禁止脚本、对象和外部资源，降低不可信 SVG 的存储型 XSS 风险。
const SVG_ASSET_CONTENT_SECURITY_POLICY = "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; script-src 'none'; object-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; font-src data:; sandbox";

function vendorResourcePath(pathname) {
  if (pathname === "/vendor/mermaid.min.js") return "node_modules/mermaid/dist/mermaid.min.js";
  if (pathname.startsWith("/vendor/katex/")) {
    let relative;
    try { relative = decodeURIComponent(pathname.slice("/vendor/katex/".length)); } catch (error) { return ""; }
    if (!relative || relative.split(/[\\/]/).some((segment) => ["", ".", ".."].includes(segment))) return "";
    return `node_modules/katex/dist/${relative}`;
  }
  return "";
}

function isHiddenPath(relativePath) {
  return normalizeRelative(relativePath).split("/").some((segment) => segment.startsWith("."));
}

function isSensitiveAssetName(relativePath) {
  const basename = path.posix.basename(normalizeRelative(relativePath)).toLowerCase();
  return basename === CONFIG_FILE_NAME || basename === "package.json" || basename === "package-lock.json" || basename.startsWith(".env") || /(?:~|\.bak|\.backup|\.old|\.orig|\.swp)$/i.test(basename);
}

function isPublicAssetPath(relativePath) {
  const normalized = normalizeRelative(relativePath);
  if (!normalized || isHiddenPath(normalized) || isSensitiveAssetName(normalized)) return false;
  return PUBLIC_ASSET_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

function responseHeaders(headers = {}) {
  return {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy": "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; script-src 'self'; connect-src 'self'",
    ...headers
  };
}

function parseByteRange(value, size) {
  if (!value) return null;
  const match = String(value).trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || size <= 0 || (!match[1] && !match[2])) return { invalid: true };
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return { invalid: true };
  end = Math.min(end, size - 1);
  return { start, end };
}

function contentDisposition(filename, disposition) {
  if (!disposition) return "";
  const safeName = fileNameFromPath(filename);
  const fallback = safeName.replace(/[^\x20-\x7E]/g, "_").replace(/[\\/]/g, "_") || "download";
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
}

async function sendFile(response, filePath, options = {}) {
  let stat;
  try {
    stat = await fsp.lstat(filePath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw createHttpError(404, "资源不存在", error);
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw createHttpError(404, "资源不存在");
  if (Number.isFinite(options.maxBytes) && stat.size > options.maxBytes) throw createHttpError(413, "资源过大");
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || mediaMimeType(filePath) || "application/octet-stream";
  const isSvg = path.extname(filePath).toLowerCase() === ".svg";
  const etag = `"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
  const range = parseByteRange(options.request?.headers?.range, stat.size);
  const headers = responseHeaders({
    "Content-Type": type,
    "Cache-Control": options.cacheControl || "no-cache, must-revalidate",
    "Content-Length": stat.size,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": stat.mtime.toUTCString(),
    ...(isSvg ? { "Content-Security-Policy": SVG_ASSET_CONTENT_SECURITY_POLICY, "Content-Disposition": "inline" } : {}),
    ...(options.contentDisposition ? { "Content-Disposition": contentDisposition(filePath, options.contentDisposition) } : {})
  });
  const modifiedSince = Date.parse(options.request?.headers?.["if-modified-since"] || "");
  if (options.request?.headers?.["if-none-match"] === etag || (!options.request?.headers?.["if-none-match"] && Number.isFinite(modifiedSince) && stat.mtimeMs <= modifiedSince + 1000)) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  if (range?.invalid) {
    response.writeHead(416, { ...headers, "Content-Range": `bytes */${stat.size}`, "Content-Length": 0 });
    response.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? Math.max(0, stat.size - 1);
  const status = range ? 206 : 200;
  const responseHeadersValue = range
    ? { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stat.size}` }
    : headers;
  response.writeHead(status, responseHeadersValue);
  if (options.request?.method === "HEAD") {
    response.end();
    return;
  }
  if (stat.size === 0) {
    response.end();
    return;
  }
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { start, end });
    stream.once("error", (error) => {
      if (response.headersSent) response.destroy(error);
      reject(error);
    });
    response.once("finish", resolve);
    stream.pipe(response);
  });
}

function assetMaxBytes(relativePath) {
  const kind = classifyAsset(relativePath);
  if (kind === "video" || kind === "audio") return MAX_MEDIA_BYTES;
  if (kind === "download") return MAX_DOWNLOAD_BYTES;
  return MAX_ASSET_BYTES;
}

module.exports = {
  vendorResourcePath,
  isPublicAssetPath,
  responseHeaders,
  contentDisposition,
  parseByteRange,
  sendFile,
  assetMaxBytes
};
