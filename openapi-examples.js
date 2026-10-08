"use strict";

const { randomUUID } = require("node:crypto");

const METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const COMPONENTS = { schemas: "schema", examples: "example", parameters: "parameter", headers: "parameter", requestBodies: "body", responses: "response", callbacks: "callback", pathItems: "path", links: "link", securitySchemes: "security" };
const CHILDREN = {
  root: { paths: "map:path", webhooks: "map:path", components: "components" },
  path: { parameters: "list:parameter", ...Object.fromEntries(METHODS.map((method) => [method, "operation"])) },
  operation: { parameters: "list:parameter", requestBody: "body", responses: "map:response", callbacks: "map:callback" },
  parameter: { schema: "schema", content: "map:media", examples: "map:example" },
  body: { content: "map:media" },
  response: { content: "map:media", headers: "map:parameter", links: "map:link" },
  media: { schema: "schema", examples: "map:example", encoding: "map:encoding" },
  encoding: { headers: "map:parameter" },
  schema: {
    properties: "map:schema", patternProperties: "map:schema", $defs: "map:schema", definitions: "map:schema", dependentSchemas: "map:schema", dependencies: "map:schema",
    items: "schema", additionalItems: "schema", prefixItems: "list:schema", allOf: "list:schema", anyOf: "list:schema", oneOf: "list:schema",
    not: "schema", if: "schema", then: "schema", else: "schema", contains: "schema", propertyNames: "schema", additionalProperties: "schema",
    unevaluatedProperties: "schema", unevaluatedItems: "schema", contentSchema: "schema"
  }
};

function referenceValue(document, fragment) {
  if (!fragment || fragment === "#") return document;
  let pointer;
  try { pointer = decodeURIComponent(fragment.slice(1)); }
  catch (error) { throw new Error(`OpenAPI 引用锚点编码无效：${fragment}`, { cause: error }); }
  // 命名 schema 锚点由 JSON Schema 解析器校验，不把它当作文件地址读取。
  if (!pointer.startsWith("/")) return null;
  let current = document;
  for (const segment of pointer.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, segment)) throw new Error(`OpenAPI 引用目标不存在：${fragment}`);
    current = current[segment];
  }
  return current;
}

function createExampleProcessor({ read, resolveReference, virtualUrl }) {
  const visited = new WeakMap();
  const references = new WeakMap();
  const literals = new Map();
  const marker = `docskit-literal-${randomUUID()}-`;

  function protect(owner, key) {
    const value = owner[key];
    if (!value || typeof value !== "object") return;
    // 示例是用户数据，先隔离于引用解析器，打包结束后按原值恢复。
    const token = `${marker}${literals.size}`;
    literals.set(token, structuredClone(value));
    owner[key] = token;
  }

  function protectPayloads(node, kind) {
    if (kind === "example") protect(node, "value");
    if (["schema", "media", "parameter"].includes(kind)) protect(node, "example");
    if (kind !== "schema") return;
    protect(node, "default");
    protect(node, "const");
    for (const key of ["examples", "enum"]) {
      if (Array.isArray(node[key])) for (let index = 0; index < node[key].length; index += 1) protect(node[key], index);
    }
  }

  async function inlineExample(node, sourcePath) {
    if (!Object.hasOwn(node, "externalValue")) return;
    try {
      if (Object.hasOwn(node, "value")) throw new Error("value 与 externalValue 不能同时设置");
      const target = resolveReference(sourcePath, node.externalValue, true);
      node.value = structuredClone(await read(target.path));
      delete node.externalValue;
    } catch (error) {
      throw new Error(`OpenAPI externalValue 无法安全加载 ${sourcePath}：${error.message}。请改用内联 value。`, { cause: error });
    }
  }

  async function visit(node, kind, sourcePath) {
    if (!node || typeof node !== "object") return;
    if (kind.startsWith("map:") || kind.startsWith("list:")) {
      const childKind = kind.slice(kind.indexOf(":") + 1);
      for (const child of Object.values(node)) await visit(child, childKind, sourcePath);
      return;
    }
    if (kind === "schema" && Array.isArray(node)) {
      for (const child of node) await visit(child, "schema", sourcePath);
      return;
    }
    const kinds = visited.get(node) || new Set();
    if (kinds.has(kind)) return;
    kinds.add(kind);
    visited.set(node, kinds);
    if (typeof node.$ref === "string") {
      const target = references.get(node) || resolveReference(sourcePath, node.$ref);
      references.set(node, target);
      const document = await read(target.path);
      node.$ref = target.path === sourcePath && node.$ref.startsWith("#") ? node.$ref : `${virtualUrl(target.path)}${target.fragment}`;
      await visit(referenceValue(document, target.fragment), kind, target.path);
    }
    if (typeof node.$dynamicRef === "string") {
      const target = resolveReference(sourcePath, node.$dynamicRef);
      if (target.path !== sourcePath) throw new Error(`暂不支持跨文件 $dynamicRef，请使用本地 $ref：${sourcePath} -> ${node.$dynamicRef}`);
    }
    if (kind === "example") await inlineExample(node, sourcePath);
    protectPayloads(node, kind);
    if (kind === "callback") {
      for (const [key, child] of Object.entries(node)) if (key !== "$ref" && !key.startsWith("x-")) await visit(child, "path", sourcePath);
    } else if (kind === "components") {
      for (const [key, childKind] of Object.entries(COMPONENTS)) await visit(node[key], `map:${childKind}`, sourcePath);
    } else {
      for (const [key, childKind] of Object.entries(CHILDREN[kind] || {})) await visit(node[key], childKind, sourcePath);
    }
  }

  function restore(value) {
    if (typeof value === "string" && literals.has(value)) return structuredClone(literals.get(value));
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) value[key] = restore(child);
    }
    return value;
  }

  return { visit, restore };
}

module.exports = { createExampleProcessor };
