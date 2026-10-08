"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const YAML = require("yaml");
const SwaggerParser = require("@apidevtools/swagger-parser");
const { resolveExistingFile } = require("./server-filesystem");
const { CONFIG_FILE_NAME } = require("./server-config");
const { createExampleProcessor } = require("./openapi-examples");

const MAX_TOTAL_SPEC_BYTES = 8 * 1024 * 1024;
const MAX_SPEC_FILES = 64;
const MAX_SPEC_DEPTH = 128;
const MAX_SPEC_NODES = 100000;
const MAX_YAML_ALIASES = 50;
const VIRTUAL_PREFIX = "docskit://local/";

function resolveReference(sourcePath, reference, rootReference = false) {
  if (typeof reference !== "string" || !reference || /[\u0000-\u001f\\?]/.test(reference)) throw new Error(`无效的 OpenAPI 引用：${reference}`);
  if (/^[a-z][a-z\d+.-]*:/i.test(reference) || reference.startsWith("//")) throw new Error(`不允许远程或绝对文件引用：${reference}`);
  const hashIndex = reference.indexOf("#");
  if (rootReference && hashIndex >= 0) throw new Error(`根 OpenAPI 文件不允许带锚点：${reference}`);
  const filePart = hashIndex >= 0 ? reference.slice(0, hashIndex) : reference;
  const fragment = hashIndex >= 0 ? reference.slice(hashIndex) : "";
  let decoded;
  try { decoded = decodeURIComponent(filePart); }
  catch (error) { throw new Error(`OpenAPI 引用编码无效：${reference}`, { cause: error }); }
  if (/[\u0000-\u001f\\%?#:]/.test(decoded) || decoded.startsWith("//")) throw new Error(`无效的 OpenAPI 引用路径：${reference}`);
  const relative = filePart === "" ? sourcePath : path.posix.normalize(decoded.startsWith("/") ? decoded.slice(1) : path.posix.join(path.posix.dirname(sourcePath), decoded));
  const segments = relative.split("/");
  if (segments.includes("..") || path.posix.isAbsolute(relative)) throw new Error(`OpenAPI 引用越界：${reference}`);
  if (segments.some((segment) => segment.startsWith(".") || segment.toLowerCase() === "node_modules" || segment.toLowerCase() === CONFIG_FILE_NAME.toLowerCase())) {
    throw new Error(`不允许读取隐藏文件或配置文件：${reference}`);
  }
  if (!/\.(?:json|ya?ml)$/i.test(relative)) throw new Error(`OpenAPI 引用只支持 JSON/YAML 文件：${reference}`);
  return { path: relative, fragment };
}

function virtualUrl(relative) {
  return `${VIRTUAL_PREFIX}${relative.split("/").map(encodeURIComponent).join("/")}`;
}

function parseSource(source, relative) {
  try {
    if (/\.json$/i.test(relative)) return JSON.parse(source);
    const parsed = YAML.parseDocument(source, { schema: "core", uniqueKeys: true });
    if (parsed.errors.length) throw parsed.errors[0];
    return parsed.toJS({ maxAliasCount: MAX_YAML_ALIASES });
  } catch (error) {
    throw new Error(`OpenAPI 解析失败 ${relative}：${error.message}`, { cause: error });
  }
}

function inspectObject(value, sourcePath, budget, visitReference, depth = 0, ancestors = new Set()) {
  if (++budget.nodes > MAX_SPEC_NODES) throw new Error(`OpenAPI 节点数量超过 ${MAX_SPEC_NODES}：${sourcePath}`);
  if (depth > MAX_SPEC_DEPTH) throw new Error(`OpenAPI 嵌套深度超过 ${MAX_SPEC_DEPTH}：${sourcePath}`);
  if (!value || typeof value !== "object") return;
  if (ancestors.has(value)) throw new Error(`OpenAPI YAML 对象存在循环，请使用 $ref 表达循环 schema：${sourcePath}`);
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if ((key === "$ref" || key === "$dynamicRef") && typeof child === "string") visitReference(value, key, child);
    inspectObject(child, sourcePath, budget, visitReference, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

async function readReferenceGraph(docsDir, rootPath) {
  const files = new Map();
  const dependencies = [];
  const budget = { bytes: 0, nodes: 0 };
  const rootStat = await fs.lstat(docsDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("OpenAPI 文档根目录必须是普通目录，不允许符号链接");

  async function read(relative) {
    if (files.has(relative)) return files.get(relative);
    if (files.size >= MAX_SPEC_FILES) throw new Error(`OpenAPI 引用文件数量超过 ${MAX_SPEC_FILES}`);
    let file;
    let stat;
    let source;
    try {
      file = await resolveExistingFile(docsDir, relative);
      stat = await fs.stat(file);
      if (budget.bytes + stat.size > MAX_TOTAL_SPEC_BYTES) throw new Error(`OpenAPI 文件累计大小超过 ${MAX_TOTAL_SPEC_BYTES} 字节`);
      source = await fs.readFile(file, "utf8");
    } catch (error) {
      throw new Error(`无法读取 OpenAPI 文件 ${relative}：${error.message}`, { cause: error });
    }
    // 读取后再次计量，避免文件在检查和读取之间增长绕过累计预算。
    budget.bytes += Buffer.byteLength(source);
    if (budget.bytes > MAX_TOTAL_SPEC_BYTES) throw new Error(`OpenAPI 文件累计大小超过 ${MAX_TOTAL_SPEC_BYTES} 字节`);
    const content = parseSource(source, relative);
    if (relative === rootPath && (!content || typeof content !== "object" || Array.isArray(content))) throw new Error(`OpenAPI 根文件必须是对象：${relative}`);
    files.set(relative, content);
    dependencies.push({ path: relative, size: stat.size, mtimeMs: stat.mtimeMs });
    inspectObject(content, relative, budget, () => {});
    return content;
  }
  const original = await read(rootPath);
  const processor = createExampleProcessor({ read, resolveReference, virtualUrl });
  await processor.visit(original, "root", rootPath);
  return { files, dependencies, restore: processor.restore };
}

function parserOptions(files) {
  const contents = new Map(Array.from(files, ([relative, content]) => [virtualUrl(relative), JSON.stringify(content)]));
  return {
    mutateInputSchema: false,
    dereference: { circular: "ignore" },
    parse: { yaml: false, text: false, binary: false, json: { canParse: () => true } },
    resolve: {
      file: false, http: false,
      local: {
        order: 1,
        canRead: (file) => file.url.startsWith(VIRTUAL_PREFIX),
        read(file) {
          // 校验器只能读取已经完成路径、大小及数量检查的内存副本。
          if (!contents.has(file.url)) throw new Error(`OpenAPI 引用未登记：${file.url}`);
          return contents.get(file.url);
        }
      }
    }
  };
}

async function loadApiReference(docsDir, documentPath, referenceString) {
  const rootPath = resolveReference(documentPath.replace(/\\/g, "/"), referenceString, true).path;
  const { files, dependencies, restore } = await readReferenceGraph(path.resolve(docsDir), rootPath);
  const original = files.get(rootPath);
  if (typeof original.openapi !== "string" || !/^3\.[01]\.\d+$/.test(original.openapi)) throw new Error(`仅支持 OpenAPI 3.0 和 3.1：${rootPath}`);
  let spec;
  try {
    const options = parserOptions(files);
    await SwaggerParser.validate(virtualUrl(rootPath), structuredClone(original), options);
    spec = await SwaggerParser.bundle(virtualUrl(rootPath), structuredClone(original), options);
    inspectObject(spec, rootPath, { nodes: 0 }, (_owner, _key, reference) => {
      if (!reference.startsWith("#")) throw new Error(`打包后仍有外部引用：${reference}`);
    });
    spec = restore(spec);
    inspectObject(spec, rootPath, { nodes: 0 }, () => {});
    const serialized = JSON.stringify(spec);
    if (Buffer.byteLength(serialized) > MAX_TOTAL_SPEC_BYTES) throw new Error("打包结果超过字节预算");
  } catch (error) {
    throw new Error(`OpenAPI 校验失败 ${rootPath}：${error.message}`, { cause: error });
  }
  return { spec, title: spec.info.title, sourcePath: rootPath, dependencies };
}

module.exports = { loadApiReference, MAX_TOTAL_SPEC_BYTES, MAX_SPEC_FILES, MAX_SPEC_DEPTH, MAX_SPEC_NODES };
