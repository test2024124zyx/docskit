"use strict";

const { createHttpError } = require("./server-filesystem");

const MAX_SERVER_COMBINATIONS = 64;
const MAX_API_ORIGINS = 128;
const MAX_API_CONNECT_BYTES = 8192;
const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

function invalidServer(documentPath, reason) {
  return createHttpError(422, `OpenAPI 服务器配置无效（${documentPath}）：${reason}`);
}

function serverUrls(server, documentPath) {
  if (!server || typeof server.url !== "string" || !server.url.trim()) throw invalidServer(documentPath, "服务器地址不能为空");
  let urls = [server.url];
  const names = [...new Set(Array.from(server.url.matchAll(/\{([^{}]+)\}/g), (match) => match[1]))];
  for (const name of names) {
    const variable = server.variables?.[name];
    if (!variable || typeof variable.default !== "string") throw invalidServer(documentPath, `服务器变量 ${name} 需要字符串默认值`);
    if (variable.enum !== undefined && (!Array.isArray(variable.enum) || !variable.enum.length || variable.enum.some((value) => typeof value !== "string"))) {
      throw invalidServer(documentPath, `服务器变量 ${name} 的枚举必须是非空字符串数组`);
    }
    const values = [...new Set([variable.default, ...(variable.enum || [])])];
    if (urls.length * values.length > MAX_SERVER_COMBINATIONS) throw invalidServer(documentPath, `服务器变量组合超过上限 ${MAX_SERVER_COMBINATIONS}`);
    urls = urls.flatMap((url) => values.map((value) => url.split(`{${name}}`).join(value)));
  }
  return urls;
}

function serverOrigin(value, documentPath) {
  if (typeof value !== "string" || !value.trim()) throw invalidServer(documentPath, "服务器或认证端点地址必须是非空字符串");
  // 相对路径沿用站点来源；协议相对地址与反斜线可能切换主机，因此必须明确拒绝。
  if (/[\s\\{}]/u.test(value) || value.startsWith("//")) throw invalidServer(documentPath, "服务器地址含不支持的字符或协议相对地址");
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) return "";
  let parsed;
  try { parsed = new URL(value); } catch { throw invalidServer(documentPath, "服务器地址不是有效 URL"); }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw invalidServer(documentPath, "服务器地址只支持不包含凭据的 HTTP(S) URL");
  }
  return parsed.origin;
}

function referencedObject(spec, reference, documentPath, kind) {
  if (typeof reference !== "string" || !reference.startsWith("#/")) throw invalidServer(documentPath, `${kind}引用必须先打包为内部引用`);
  try {
    const keys = decodeURIComponent(reference.slice(2)).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"));
    let value = spec;
    for (const key of keys) {
      if (!value || !Object.hasOwn(value, key)) throw new Error("引用不存在");
      value = value[key];
    }
    if (!value || typeof value !== "object") throw new Error("引用不是对象");
    return value;
  } catch { throw invalidServer(documentPath, `内部${kind}引用无法解析`); }
}

function apiConnectSources(documents) {
  const origins = new Set();
  for (const document of documents) {
    const spec = document.apiReference?.spec;
    if (document.hidden || !spec) continue;
    const collectOrigin = (url) => {
      const origin = serverOrigin(url, document.path);
      if (origin) origins.add(origin);
      if (origins.size > MAX_API_ORIGINS) throw invalidServer(document.path, `服务器来源超过上限 ${MAX_API_ORIGINS}`);
    };
    const collect = (servers) => {
      if (servers === undefined) return;
      if (!Array.isArray(servers)) throw invalidServer(document.path, "servers 必须是数组");
      for (const server of servers) {
        for (const url of serverUrls(server, document.path)) collectOrigin(url);
      }
    };
    collect(spec.servers);
    const visited = new Set();
    const collectPath = (item) => {
      if (!item || typeof item !== "object" || visited.has(item)) return;
      visited.add(item);
      collect(item.servers);
      for (const method of HTTP_METHODS) collect(item[method]?.servers);
      if (item.$ref) collectPath(referencedObject(spec, item.$ref, document.path, "路径"));
    };
    Object.values(spec.paths || {}).forEach(collectPath);
    Object.values(spec.webhooks || {}).forEach(collectPath);
    const visitedSecurity = new Set();
    const collectSecurity = (scheme) => {
      if (!scheme || typeof scheme !== "object" || visitedSecurity.has(scheme)) return;
      visitedSecurity.add(scheme);
      if (scheme.$ref) collectSecurity(referencedObject(spec, scheme.$ref, document.path, "认证"));
      if (scheme.type !== "oauth2") return;
      // 只信任作者明确声明的令牌和刷新地址，动态发现结果不得扩展连接权限。
      for (const flow of Object.values(scheme.flows || {})) {
        for (const key of ["tokenUrl", "refreshUrl"]) if (flow?.[key] !== undefined) collectOrigin(flow[key]);
      }
    };
    Object.values(spec.components?.securitySchemes || {}).forEach(collectSecurity);
  }
  const sources = [...origins].sort();
  if (Buffer.byteLength(sources.join(" ")) > MAX_API_CONNECT_BYTES) throw invalidServer("站点", `服务器来源列表超过 ${MAX_API_CONNECT_BYTES} 字节`);
  return sources;
}

module.exports = { apiConnectSources, MAX_SERVER_COMBINATIONS };
