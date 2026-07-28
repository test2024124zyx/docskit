"use strict";

const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { safeResolve } = require("./server-config");

function createHttpError(statusCode, publicMessage, cause) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  if (cause) error.cause = cause;
  return error;
}

async function assertNoSymlink(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw createHttpError(404, "资源不存在");
  let current = resolvedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(current);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") throw createHttpError(404, "资源不存在", error);
      throw error;
    }
    if (stat.isSymbolicLink()) throw createHttpError(404, "资源不存在");
  }
  return resolvedTarget;
}

async function resolveExistingFile(root, input) {
  const resolved = safeResolve(root, input);
  await assertNoSymlink(root, resolved);
  let stat;
  try {
    stat = await fsp.lstat(resolved);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") throw createHttpError(404, "资源不存在", error);
    throw error;
  }
  if (!stat.isFile()) throw createHttpError(404, "资源不存在");
  return resolved;
}

module.exports = { createHttpError, assertNoSymlink, resolveExistingFile };
