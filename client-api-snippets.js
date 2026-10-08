/* 请求示例只生成本地文本，所有动态值均按目标语言的字符串规则编码。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DocsKitApiSnippets = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const TIMEOUT_SECONDS = 30;
  const DUPLICATE_FIELD_SUFFIX = /_\*\*\[\]\d+$/;
  const get = (value, key) => typeof value?.get === "function" ? value.get(key) : value?.[key];
  const entries = (value) => value?.entries ? Array.from(value.entries()) : Object.entries(value || {});
  const isFile = (value) => value && typeof value.name === "string" && typeof value.arrayBuffer === "function";
  const quote = (value) => JSON.stringify(String(value));
  const pythonValue = (value) => `json.loads(${quote(JSON.stringify(value))})`;

  function describe(request) {
    const headers = Object.fromEntries(entries(get(request, "headers")));
    const body = get(request, "body");
    const contentType = Object.entries(headers).find(([key]) => key.toLowerCase() === "content-type")?.[1] || "";
    const multipart = /^multipart\/form-data\b/i.test(contentType);
    const form = /^application\/x-www-form-urlencoded\b/i.test(contentType);
    const structuredForm = form && body !== null && typeof body === "object" && !isFile(body);
    // Multipart 边界由客户端根据实际内容生成，复制旧请求的边界会损坏正文。
    if (multipart) for (const key of Object.keys(headers)) if (key.toLowerCase() === "content-type") delete headers[key];
    // 原生表单保留真实键名；只有 Swagger 的映射快照需要还原重复字段后缀。
    const nativeFields = typeof body?.getAll === "function";
    const fields = multipart || structuredForm
      ? entries(body).map(([key, value]) => [nativeFields ? String(key) : String(key).replace(DUPLICATE_FIELD_SUFFIX, ""), value]) : [];
    return { url: get(request, "url"), method: get(request, "method") || "GET", headers, body, fields, multipart, structuredForm };
  }

  function textBody(body) {
    return typeof body === "string" ? body : JSON.stringify(typeof body?.toJS === "function" ? body.toJS() : body);
  }

  function javascript(request) {
    const value = describe(request);
    const fileValues = value.multipart ? value.fields.map(([, item]) => item) : [value.body];
    const lines = [];
    if (fileValues.some((item) => isFile(item) && typeof item.data !== "string")) lines.push('import { readFile } from "node:fs/promises";');
    lines.push(`const headers = ${JSON.stringify(value.headers, null, 2)};`);
    let hasBody = value.body !== undefined && value.body !== null;
    if (value.multipart) {
      lines.push("const body = new FormData();");
      for (const [key, item] of value.fields) {
        if (isFile(item)) {
          const data = typeof item.data === "string" ? quote(item.data) : `await readFile(${quote(item.name)})`;
          lines.push(`body.append(${quote(key)}, new Blob([${data}], { type: ${quote(item.type || "application/octet-stream")} }), ${quote(item.name)});`);
        } else lines.push(`body.append(${quote(key)}, ${quote(item)});`);
      }
      hasBody = true;
    } else if (value.structuredForm) lines.push(`const body = new URLSearchParams(${JSON.stringify(value.fields)});`);
    else if (isFile(value.body)) lines.push(`const body = ${typeof value.body.data === "string" ? quote(value.body.data) : `await readFile(${quote(value.body.name)})`};`);
    else if (hasBody) lines.push(`const body = ${quote(textBody(value.body))};`);
    lines.push(`const response = await fetch(${quote(value.url)}, {`, `  method: ${quote(value.method)},`, "  headers,", ...(hasBody ? ["  body,"] : []), '  credentials: "omit",', '  redirect: "error",', `  signal: AbortSignal.timeout(${TIMEOUT_SECONDS * 1000})`, "});", "console.log(response.status);", "console.log(await response.text());");
    return lines.join("\n");
  }

  function python(request) {
    const value = describe(request);
    const lines = ["import json", "import requests", "from contextlib import ExitStack", "", "with ExitStack() as stack:", `    url = ${pythonValue(value.url)}`, `    headers = ${pythonValue(value.headers)}`];
    let bodyArgument = "";
    if (value.multipart) {
      lines.push("    files = [");
      for (const [key, item] of value.fields) {
        const part = isFile(item)
          ? `${quote(item.name)}, ${typeof item.data === "string" ? `${pythonValue(item.data)}.encode("utf-8")` : `stack.enter_context(open(${quote(item.name)}, "rb"))`}, ${quote(item.type || "application/octet-stream")}`
          : `None, ${pythonValue(String(item))}`;
        lines.push(`        (${quote(key)}, (${part})),`);
      }
      lines.push("    ]");
      bodyArgument = "files=files, ";
    } else if (isFile(value.body)) {
      lines.push(`    data = ${typeof value.body.data === "string" ? `${pythonValue(value.body.data)}.encode("utf-8")` : `stack.enter_context(open(${quote(value.body.name)}, "rb"))`}`);
      bodyArgument = "data=data, ";
    } else if (value.body !== undefined && value.body !== null) {
      const body = value.structuredForm ? value.fields : textBody(value.body);
      lines.push(`    data = ${pythonValue(body)}`);
      bodyArgument = value.structuredForm ? "data=data, " : 'data=data.encode("utf-8"), ';
    }
    lines.push(`    response = requests.request(${quote(value.method)}, url, headers=headers, ${bodyArgument}allow_redirects=False, timeout=${TIMEOUT_SECONDS})`, "    print(response.status_code)", "    print(response.text)");
    return lines.join("\n");
  }

  return { javascript, python };
});
