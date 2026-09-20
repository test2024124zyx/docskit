from pathlib import Path
import hashlib

EXPECTED = {
    'server-assets.js': '77868346304f0b73651134feab433e4b653c47f0',
    'server.js': '1aaddf662e25603838f0b039d26cff37a8ceb6c3',
    'markdown.js': 'fea592fe387b33b3493f7c1c8406ee6d25643b6c',
    'script.js': '6ed8dc653a089c21d73fee8e38496c766b3cc8c9',
    'static-build.js': '35492f8da23ce74e75eb9b0d0ce83bf1bc2b666f',
}
files = {}
for name, expected in EXPECTED.items():
    data = Path(name).read_bytes()
    actual = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if actual != expected:
        raise SystemExit(f'Refusing to patch unexpected source: {name} ({actual})')
    files[name] = data.decode('utf-8')

def replace(name, before, after, count=1):
    actual = files[name].count(before)
    if actual != count:
        raise SystemExit(f'{name}: expected {count} matching anchors, found {actual}: {before[:100]}')
    files[name] = files[name].replace(before, after)

replace('server-assets.js', 'const path = require("node:path");', 'const path = require("node:path");\nconst { pipeline } = require("node:stream/promises");')
replace('server-assets.js', '''  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { start, end });
    stream.once("error", (error) => {
      if (response.headersSent) response.destroy(error);
      reject(error);
    });
    response.once("finish", resolve);
    stream.pipe(response);
  });''', '''  // pipeline 在客户端中断时销毁源流并关闭文件描述符，避免请求永久悬挂。
  if (response.destroyed) return;
  try {
    await pipeline(fs.createReadStream(filePath, { start, end }), response);
  } catch (error) {
    // 正常取消下载不应被记录为服务器故障；磁盘读取等其他错误仍向上传递。
    if (response.destroyed && ["ERR_STREAM_PREMATURE_CLOSE", "ECONNRESET"].includes(error.code)) return;
    throw error;
  }''')

# Callback replacements keep $, $&, $` and $' literal after HTML escaping.
replace('server.js', 'return template.replace(pattern, `<meta ', 'return template.replace(pattern, () => `<meta ')
replace('server.js', 'template.replace(/<title>[^<]*<\\/title>/i, `<title>', 'template.replace(/<title>[^<]*<\\/title>/i, () => `<title>')
replace('server.js', 'html.replace(/<link\\s+rel="canonical"[^>]*>/i, canonical)', 'html.replace(/<link\\s+rel="canonical"[^>]*>/i, () => canonical)')
replace('server.js', 'html.replace("</head>", `${themeStyle}', 'html.replace("</head>", () => `${themeStyle}')
replace('server.js', 'html.replace(/<link\\s+rel="icon"\\s+id="site-favicon"[^>]*>/i, favicon)', 'html.replace(/<link\\s+rel="icon"\\s+id="site-favicon"[^>]*>/i, () => favicon)')
replace('server.js', 'html.replace(/<article\\s+class="doc-article"\\s+id="doc-content"\\s+aria-live="polite">[\\s\\S]*?<\\/article>/i, `<article ', 'html.replace(/<article\\s+class="doc-article"\\s+id="doc-content"\\s+aria-live="polite">[\\s\\S]*?<\\/article>/i, () => `<article ')
replace('server.js', 'html.replace(/<\\/body>/i, `${staticData}</body>`)', 'html.replace(/<\\/body>/i, () => `${staticData}</body>`)')
replace('server.js', '  const cached = renderCache.get(cacheKey);', '''  // 静态链接回调捕获本次构建的 base/路由表，不复用跨构建的全局缓存。
  const cached = options.links ? null : renderCache.get(cacheKey);''')
replace('server.js', '  renderCache.set(cacheKey, result);', '  if (!options.links) renderCache.set(cacheKey, result);')

# Only escaped text or highlight.js-generated span markup is accepted here.
wrap = r'''function wrapHighlightedCode(html) {
  const source = String(html);
  const openTags = [];
  const lines = [];
  const tokens = /<\/?span\b[^>]*>|\n/g;
  let line = "";
  let offset = 0;
  const appendLine = () => {
    const empty = line.replace(/<\/?span\b[^>]*>/g, "") === "";
    lines.push(`<span class="markdown-code__line"${empty ? ' data-code-empty=""' : ""}>${line}${empty ? " " : ""}${"</span>".repeat(openTags.length)}</span>`);
    line = openTags.join("");
  };
  for (const token of source.matchAll(tokens)) {
    line += source.slice(offset, token.index);
    if (token[0] === "\n") {
      appendLine();
    } else {
      line += token[0];
      if (token[0].startsWith("</")) openTags.pop();
      else openTags.push(token[0]);
    }
    offset = token.index + token[0].length;
  }
  line += source.slice(offset);
  appendLine();
  return lines.join("");
}'''
replace('markdown.js', 'function renderCodeBlock(node, options = {}) {', '// 按行包装时关闭并重新打开跨行高亮标签，保持每行都是独立且平衡的 DOM。\n' + wrap + '\n\nfunction renderCodeBlock(node, options = {}) {')
replace('markdown.js', '''  const wrappedCode = codeContent.split("\\n").map((line) => `<span class="markdown-code__line">${line || " "}</span>`).join("");''', '  const wrappedCode = wrapHighlightedCode(codeContent);')
replace('markdown.js', '  markdownTarget,\n  renderInline,', '  markdownTarget,\n  wrapHighlightedCode,\n  renderInline,')
frontend_wrap = '\n'.join('  ' + line if line else '' for line in wrap.splitlines())
replace('script.js', '  function highlightCodeBlocks(container) {', '  // 与服务端一致地平衡跨行高亮标签；回归测试校验两端输出一致。\n' + frontend_wrap + '\n\n  function highlightCodeBlocks(container) {')
replace('script.js', 'lineNodes.map((line) => line.textContent).join("\\n")', 'lineNodes.map((line) => line.hasAttribute("data-code-empty") ? "" : line.textContent).join("\\n")')
replace('script.js', '''              // 保持行结构：对高亮后的 HTML 按行分割并重新包裹 span。
              const lines = result.value.split("\\n");
              codeEl.innerHTML = lines.map((line) => `<span class="markdown-code__line">${line || " "}</span>`).join("\\n");''', '''              // 行节点之间不插入换行文本，避免 pre 中产生额外空白行。
              codeEl.innerHTML = wrapHighlightedCode(result.value);''')

replace('markdown.js', '''  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(normalizeRelative(currentPath)), pathPart));''', r'''  // URL 路径只解码一次。禁止编码后的分隔符改变路径层级，之后再检查目录边界。
  let decodedPath;
  try {
    decodedPath = pathPart.split("/").map((segment) => {
      const decoded = decodeURIComponent(segment);
      if (/[\\/\0]/.test(decoded)) throw new Error("无效链接路径");
      return decoded;
    }).join("/");
  } catch (error) {
    return { href: "#", external: false };
  }
  const relativePath = decodedPath.startsWith("/")
    ? decodedPath.slice(1)
    : path.posix.join(path.posix.dirname(normalizeRelative(currentPath)), decodedPath);
  const resolved = path.posix.normalize(relativePath);''')
replace('markdown.js', 'if (/\\.(md|markdown)$/i.test(pathPart)) {', 'if (/\\.(md|markdown)$/i.test(decodedPath)) {')
replace('markdown.js', 'const MAX_INLINE_RECURSION = 32;', 'const MAX_INLINE_RECURSION = 32;\nconst MAX_BLOCK_RECURSION = 64;')
replace('markdown.js', 'function parseBlockquote(lines, start, context) {', 'function parseBlockquote(lines, start, context, depth) {')
replace('markdown.js', 'parseBlocks(body, 0, body.length, context, new Set())', 'parseBlocks(body, 0, body.length, context, new Set(), depth + 1)')
replace('markdown.js', 'function parseList(lines, start, context) {', 'function parseList(lines, start, context, depth) {')
replace('markdown.js', 'parseBlocks(item.lines, 0, item.lines.length, context, new Set())', 'parseBlocks(item.lines, 0, item.lines.length, context, new Set(), depth + 1)')
replace('markdown.js', '''function parseBlocks(lines, start, end, context, skipped) {
  const nodes = [];''', '''function parseBlocks(lines, start, end, context, skipped, depth = 0) {
  // 超深引用/列表降级为转义代码，保留可读内容而不是溢出调用栈。
  if (depth >= MAX_BLOCK_RECURSION) {
    return [{ type: "code", language: "text", code: lines.slice(start, end).filter((_, index) => !skipped.has(start + index)).join("\\n") }];
  }
  const nodes = [];''')
replace('markdown.js', 'parseBlockquote(lines, index, context)', 'parseBlockquote(lines, index, context, depth)')
replace('markdown.js', 'parseList(lines, index, context)', 'parseList(lines, index, context, depth)')

replace('static-build.js', 'function isWithin(parent, target) {', '''function assertUniqueDocumentOutputs(documents) {
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

function isWithin(parent, target) {''')
replace('static-build.js', '  const { documents, directoryMetadata } = scanned;', '  const { documents, directoryMetadata } = scanned;\n  assertUniqueDocumentOutputs(documents);')
replace('static-build.js', '  documentOutputPath,\n  publicPath,', '  documentOutputPath,\n  assertUniqueDocumentOutputs,\n  publicPath,')

# Write only after every original hash and replacement anchor has been checked.
for name, text in files.items():
    Path(name).write_text(text, encoding='utf-8')
    print(f'Patched {name}')
