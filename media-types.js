"use strict";

const path = require("node:path");

const VIDEO_EXTENSIONS = new Set([".avi", ".m4v", ".mov", ".mp4", ".ogv", ".webm"]);
const AUDIO_EXTENSIONS = new Set([".aac", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".wav", ".weba"]);
const DOWNLOAD_EXTENSIONS = new Set([
  ".7z", ".csv", ".doc", ".docx", ".epub", ".gz", ".json", ".log", ".pdf", ".ppt", ".pptx",
  ".rar", ".rtf", ".tar", ".tgz", ".txt", ".xls", ".xlsx", ".xml", ".zip"
]);
const MEDIA_MIME_TYPES = {
  ".aac": "audio/aac",
  ".avi": "video/x-msvideo",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".oga": "audio/ogg",
  ".ogg": "audio/ogg",
  ".ogv": "video/ogg",
  ".wav": "audio/wav",
  ".weba": "audio/webm",
  ".webm": "video/webm"
};

function pathWithoutQuery(value) {
  return String(value ?? "").split(/[?#]/, 1)[0].replace(/\\/g, "/");
}

function extensionOf(value) {
  return path.posix.extname(pathWithoutQuery(value)).toLowerCase();
}

function classifyAsset(value) {
  const extension = extensionOf(value);
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (DOWNLOAD_EXTENSIONS.has(extension)) return "download";
  return "asset";
}

function isDownloadableAsset(value) {
  return classifyAsset(value) === "download";
}

function mediaMimeType(value) {
  return MEDIA_MIME_TYPES[extensionOf(value)] || "";
}

function fileNameFromPath(value) {
  let name = path.posix.basename(pathWithoutQuery(value)) || "download";
  try {
    name = decodeURIComponent(name);
  } catch (error) {
    // 文件名编码损坏时保留原始安全片段，不能因为响应头生成失败而泄露路径。
  }
  return name.replace(/[\r\n"]/g, "_").slice(0, 255) || "download";
}

module.exports = {
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  DOWNLOAD_EXTENSIONS,
  MEDIA_MIME_TYPES,
  pathWithoutQuery,
  extensionOf,
  classifyAsset,
  isDownloadableAsset,
  mediaMimeType,
  fileNameFromPath
};
