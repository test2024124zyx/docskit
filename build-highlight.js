"use strict";

/**
 * 构建 highlight.js 客户端 IIFE bundle。
 * 将 highlight.js/lib/common 及其所有语言依赖打包为单个自执行文件，
 * 供客户端对大代码块进行延迟语法高亮。
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname);
const OUTPUT_PATH = path.join(ROOT_DIR, "dist", "vendor", "highlight.min.js");

function resolveModule(id, fromDir) {
  if (id.startsWith("./") || id.startsWith("../")) {
    const resolved = path.resolve(fromDir, id);
    if (fs.existsSync(resolved + ".js")) return resolved + ".js";
    if (fs.existsSync(resolved + "/index.js")) return resolved + "/index.js";
    return resolved;
  }
  return require.resolve(id, { paths: [fromDir] });
}

function createBundle(entryPath = path.join(ROOT_DIR, "node_modules", "highlight.js", "lib", "common.js")) {
  const moduleRoot = path.dirname(entryPath);
  const modules = new Map();

  // 使用相对模块标识及精确依赖表，避免 Windows 分隔符与同名文件冲突。
  const moduleId = (filePath) => path.relative(moduleRoot, filePath).split(path.sep).join("/");

  function collect(id, fromDir) {
    const filePath = resolveModule(id, fromDir);
    const key = moduleId(filePath);
    if (modules.has(key)) return key;
    const dir = path.dirname(filePath);
    const source = fs.readFileSync(filePath, "utf8");
    const dependencies = {};
    modules.set(key, { source, dependencies });
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = requireRegex.exec(source)) !== null) {
      dependencies[match[1]] = collect(match[1], dir);
    }
    return key;
  }

  const entryId = collect(entryPath, moduleRoot);

  // 生成无需浏览器模块加载器的独立产物，缺失依赖必须在构建时失败。
  let output = "(function() {\nvar modules = {};\nvar cache = {};\nfunction req(id) {\n";
  output += "  if (cache[id]) return cache[id].exports;\n";
  output += "  if (!modules[id]) throw new Error('Module not found: ' + id);\n";
  output += "  var mod = { exports: {} };\n  cache[id] = mod;\n";
  output += "  modules[id][0](mod, mod.exports, function(dep) { return req(modules[id][1][dep]); });\n";
  output += "  return mod.exports;\n}\n";

  for (const [id, { source, dependencies }] of modules) {
    output += `modules[${JSON.stringify(id)}] = [function(module, exports, require) {\n${source}\n}, ${JSON.stringify(dependencies)}];\n`;
  }

  output += `var hljs = req(${JSON.stringify(entryId)});\n`;
  output += 'if (typeof window !== "undefined") window.hljs = hljs;\n';
  output += "})();\n";
  return { code: output, size: Buffer.byteLength(output), modules: modules.size };
}

function buildBundle({ outputPath = OUTPUT_PATH } = {}) {
  const result = createBundle();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, result.code);
  return { size: result.size, modules: result.modules };
}

// 检查是否需要重建
function needsBuild() {
  if (!fs.existsSync(OUTPUT_PATH)) return true;
  const hljsPkg = path.join(ROOT_DIR, "node_modules", "highlight.js", "package.json");
  if (!fs.existsSync(hljsPkg)) return false;
  const bundleMtime = fs.statSync(OUTPUT_PATH).mtimeMs;
  const pkgMtime = fs.statSync(hljsPkg).mtimeMs;
  return pkgMtime > bundleMtime || fs.statSync(__filename).mtimeMs > bundleMtime;
}

function ensureBundle() {
  if (!needsBuild()) return false;
  const result = buildBundle();
  console.log(`highlight.js bundle 已生成: ${(result.size / 1024).toFixed(1)}KB (${result.modules} 个模块)`);
  return true;
}

module.exports = { createBundle, buildBundle, ensureBundle };

if (require.main === module) {
  const result = buildBundle();
  console.log(`highlight.js bundle: ${(result.size / 1024).toFixed(1)}KB, ${result.modules} modules`);
}
