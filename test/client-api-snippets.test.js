"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const snippets = require("../client-api-snippets");
let execution = 0;
const pythonCommand = process.env.DOCSKIT_TEST_PYTHON || "python";
const pythonAvailable = spawnSync(pythonCommand, ["--version"], { encoding: "utf8", windowsHide: true }).status === 0;

async function runJavaScript(request) {
  const calls = [];
  const hook = `__docskitSnippetFetch${++execution}`;
  globalThis[hook] = async (...args) => { calls.push(args); return { status: 200, text: async () => "成功" }; };
  try {
    // 以真实 ES 模块执行生成代码，让文件导入和上传正文一起接受验证。
    const code = `const fetch = globalThis[${JSON.stringify(hook)}];\nconst console = { log() {} };\n${snippets.javascript(request)}`;
    await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    return calls[0];
  } finally { delete globalThis[hook]; }
}

function runPython(request, { fail = false } = {}) {
  const harness = `import io, json, sys, types
payload = json.load(sys.stdin)
handles, calls = [], []
def fake_open(name, mode):
    assert mode == "rb"
    handle = io.BytesIO(bytes([0, 255, 10, 65]))
    handle.name = name
    handles.append(handle)
    return handle
def snapshot(value):
    if isinstance(value, bytes):
        return {"bytes": list(value)}
    if isinstance(value, io.BytesIO):
        return {"file": value.name, "bytes": list(value.getvalue()), "closedAtRequest": value.closed}
    if isinstance(value, dict):
        return {key: snapshot(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [snapshot(item) for item in value]
    return value
def request(*args, **kwargs):
    calls.append({"args": snapshot(args), "kwargs": snapshot(kwargs)})
    if payload["fail"]:
        raise RuntimeError("模拟网络失败")
    return types.SimpleNamespace(status_code=200, text="成功")
sys.modules["requests"] = types.SimpleNamespace(request=request)
error = None
try:
    exec(compile(payload["code"], "<生成示例>", "exec"), {"open": fake_open, "print": lambda *args: None})
except Exception as exception:
    error = str(exception)
print(json.dumps({"calls": calls, "closed": [handle.closed for handle in handles], "error": error}))
`;
  const result = spawnSync(pythonCommand, ["-c", harness], { input: JSON.stringify({ code: snippets.python(request), fail }), encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout);
}

test("JavaScript 示例实际执行时保留URL、认证和包含引用与恶意引号的正文", async () => {
  const request = { url: "https://api.test/items?q=%E4%B8%AD", method: "POST", headers: { Authorization: "Bearer example", "Content-Type": "application/json" }, body: JSON.stringify({ $ref: "普通业务字段", label: "'); throw new Error('不能执行'); //\n中文" }) };
  const [url, options] = await runJavaScript(request);
  assert.equal(url, request.url);
  assert.equal(options.method, request.method);
  assert.deepEqual(JSON.parse(JSON.stringify(options.headers)), request.headers);
  assert.deepEqual(JSON.parse(options.body), JSON.parse(request.body));
  assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error");
});

test("空正文、数值和重复表单字段在可运行示例中保持不同语义", async () => {
  const [, empty] = await runJavaScript({ url: "https://api.test/empty", method: "POST", body: "" });
  assert.equal(empty.body, "");
  const [, zero] = await runJavaScript({ url: "https://api.test/zero", method: "POST", body: 0 });
  assert.equal(zero.body, "0");
  const request = { url: "https://api.test/form", method: "POST", headers: { "Content-Type": "multipart/form-data", "X-Test": "保留" }, body: new Map([["tag", "甲"], ["tag_**[]1", "乙"], ["blank", ""]]) };
  const [, multipart] = await runJavaScript(request);
  assert.deepEqual([...multipart.body.entries()], [["tag", "甲"], ["tag", "乙"], ["blank", ""]]);
  assert.equal(multipart.headers["Content-Type"], undefined);
  assert.equal(multipart.headers["X-Test"], "保留");
});

test("文件示例使用真实文件名并显式关闭Python文件句柄，不嵌入伪造文件内容", () => {
  const file = new File(["本地内容"], "资料'一.txt", { type: "text/plain" });
  const request = { url: "https://api.test/upload", method: "POST", headers: { "content-type": "multipart/form-data" }, body: new Map([["document", file], ["note", "含\n换行"]]) };
  const javascript = snippets.javascript(request);
  assert.match(javascript, /node:fs\/promises/);
  assert.ok(javascript.includes(`readFile(${JSON.stringify(file.name)})`));
  assert.match(javascript, /new Blob/);
  const python = snippets.python(request);
  assert.match(python, /with ExitStack\(\) as stack:/);
  assert.ok(python.includes(`stack.enter_context(open(${JSON.stringify(file.name)}, "rb"))`));
  assert.match(python, /files=files/);
  assert.doesNotMatch(python, /multipart\/form-data/);
  assert.doesNotMatch(javascript + python, /本地内容/);
});

test("Python 示例的结构化参数经过JSON字符串编码，正文不能逃逸成代码", () => {
  const body = "\"\n); __import__('os').system('不能执行')\n中文";
  const request = { url: "https://api.test/a", method: "PUT", headers: { "X-Test": "斜线\\与引号\"" }, body };
  const generated = snippets.python(request);
  const assignments = [...generated.matchAll(/^(?:    )?(url|headers|data) = json\.loads\((.*)\)$/gm)];
  const values = Object.fromEntries(assignments.map((match) => [match[1], JSON.parse(JSON.parse(match[2]))]));
  assert.deepEqual(values, { url: request.url, headers: request.headers, data: body });
  assert.match(generated, /allow_redirects=False/);
  assert.match(generated, /timeout=30/);
});

test("URLencoded 示例执行后保留重复字段、空集合及原始字段名", async () => {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  for (const body of [new Map(), new URLSearchParams(), {}]) {
    const [, options] = await runJavaScript({ url: "https://api.test/form", method: "POST", headers, body });
    assert.equal(String(options.body), "");
  }
  const body = new URLSearchParams([["tag", "甲"], ["tag", "乙"], ["blank", ""], ["field_**[]1", "原始名称"]]);
  const [, options] = await runJavaScript({ url: "https://api.test/form", method: "POST", headers, body });
  assert.deepEqual([...options.body.entries()], [...body.entries()]);
});

test("JavaScript 上传示例实际读取二进制文件并保留文件名、类型和重复字段", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docskit-snippet-"));
  const filename = path.join(directory, "资料'一.bin");
  const bytes = Buffer.from([0, 255, 10, 65]);
  try {
    fs.writeFileSync(filename, bytes);
    const file = new File([], filename);
    const body = new Map([["document", file], ["tag_**[]1", "甲"], ["tag_**[]2", "乙"]]);
    const [, options] = await runJavaScript({ url: "https://api.test/upload", method: "POST", headers: { "Content-Type": "multipart/form-data; boundary=旧值" }, body });
    const uploaded = options.body.get("document");
    assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), bytes);
    assert.equal(uploaded.name, filename);
    assert.equal(uploaded.type, "application/octet-stream");
    assert.deepEqual(options.body.getAll("tag"), ["甲", "乙"]);
    assert.equal(options.headers["Content-Type"], undefined);
    const [, binary] = await runJavaScript({ url: "https://api.test/file", method: "PUT", body: file });
    assert.deepEqual(binary.body, bytes);
    const inline = new File([], "内联.txt", { type: "text/plain" });
    inline.data = "中文与换行\n";
    const [, inlineOptions] = await runJavaScript({ url: "https://api.test/file", method: "PUT", body: inline });
    assert.equal(inlineOptions.body, inline.data);
    const [, inlineMultipart] = await runJavaScript({ url: "https://api.test/upload", method: "POST", headers: { "Content-Type": "multipart/form-data" }, body: new Map([["document", inline]]) });
    assert.equal(await inlineMultipart.body.get("document").text(), inline.data);
    assert.equal(inlineMultipart.body.get("document").type, "text/plain");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Python 实际执行时按UTF8发送原始JSON、Unicode和转义正文", { skip: !pythonAvailable }, () => {
  const bodies = ["", 0, { toJS: () => ({ enabled: true, value: null, $ref: "业务字段" }) }, JSON.stringify({ $ref: "业务字段", value: "中文😀\u0000\n\\\"" })];
  for (const body of bodies) {
    const result = runPython({ url: "https://api.test/资料?q=%E4%B8%AD", method: "PUT", headers: { "X-Label": "中文\\引号\"" }, body });
    assert.equal(result.error, null);
    const expected = typeof body === "string" ? body : JSON.stringify(body.toJS ? body.toJS() : body);
    assert.deepEqual(result.calls[0].kwargs.data.bytes, [...Buffer.from(expected)]);
    assert.equal(result.calls[0].kwargs.headers["X-Label"], "中文\\引号\"");
    assert.equal(result.calls[0].kwargs.allow_redirects, false);
    assert.equal(result.calls[0].kwargs.timeout, 30);
  }
  const result = runPython({ url: "https://api.test/empty" });
  assert.equal(result.error, null);
  assert.equal(Object.hasOwn(result.calls[0].kwargs, "data"), false);
});

test("Python 表单重复项保持顺序，空URLencoded表单不会发送JSON字符串", { skip: !pythonAvailable }, () => {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  for (const body of [new Map(), new URLSearchParams(), {}]) {
    const result = runPython({ url: "https://api.test/form", method: "POST", headers, body });
    assert.equal(result.error, null);
    assert.deepEqual(result.calls[0].kwargs.data, []);
  }
  const body = new URLSearchParams([["tag", "甲"], ["tag", "乙"], ["field_**[]1", "保留字段名"]]);
  const result = runPython({ url: "https://api.test/form", method: "POST", headers, body });
  assert.equal(result.error, null);
  assert.deepEqual(result.calls[0].kwargs.data, [...body.entries()]);
});

test("Python 上传在成功与异常时均释放全部文件句柄，内联文件按字节发送", { skip: !pythonAvailable }, () => {
  const first = new File([], "资料'一.bin");
  const second = new File([], "资料\\二.txt", { type: "text/plain" });
  const inline = new File([], "内联.json", { type: "application/json" });
  inline.data = '{"$ref":"正文😀"}';
  const request = { url: "https://api.test/upload", method: "POST", headers: { "Content-Type": "multipart/form-data" }, body: new Map([["document_**[]1", first], ["document_**[]2", second], ["inline", inline], ["tag_**[]1", "甲"], ["tag_**[]2", "乙"]]) };
  for (const fail of [false, true]) {
    const result = runPython(request, { fail });
    assert.equal(result.error, fail ? "模拟网络失败" : null);
    assert.deepEqual(result.closed, [true, true]);
    const files = result.calls[0].kwargs.files;
    assert.equal(files[0][0], "document");
    assert.deepEqual(files[0][1], [first.name, { file: first.name, bytes: [0, 255, 10, 65], closedAtRequest: false }, "application/octet-stream"]);
    assert.equal(files[1][1][2], "text/plain");
    assert.deepEqual(files[2][1][1].bytes, [...Buffer.from(inline.data)]);
    assert.deepEqual(files.slice(3), [["tag", [null, "甲"]], ["tag", [null, "乙"]]]);
    assert.equal(result.calls[0].kwargs.headers["Content-Type"], undefined);
  }
  for (const body of [first, inline]) {
    const result = runPython({ url: "https://api.test/file", method: "PUT", body });
    assert.equal(result.error, null);
    assert.deepEqual(result.closed, body === first ? [true] : []);
    assert.deepEqual(result.calls[0].kwargs.data.bytes, body === first ? [0, 255, 10, 65] : [...Buffer.from(inline.data)]);
  }
});
