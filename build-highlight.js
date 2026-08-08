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

function buildBundle() {
  const hljsDir = path.join(ROOT_DIR, "node_modules", "highlight.js", "lib");
  const modules = {};
  const resolved = new Set();

  function collect(id, fromDir) {
    const filePath = resolveModule(id, fromDir);
    if (resolved.has(filePath)) return;
    resolved.add(filePath);
    const dir = path.dirname(filePath);
    const source = fs.readFileSync(filePath, "utf8");
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    let match;
    while ((match = requireRegex.exec(source)) !== null) {
      try { collect(match[1], dir); } catch (e) { /* skip non-local */ }
    }
    modules[filePath] = source;
  }

  collect("./common", hljsDir);

  // 生成 IIFE bundle
  let output = "(function() {\nvar modules = {};\nvar cache = {};\nfunction req(id) {\n";
  output += "  if (cache[id]) return cache[id].exports;\n";
  output += "  var mod = { exports: {} };\n  cache[id] = mod;\n";
  output += "  modules[id](mod, mod.exports, function(dep) {\n";
  output += "    var keys = Object.keys(modules);\n";
  output += "    for (var i = 0; i < keys.length; i++) {\n";
  output += "      if (keys[i].endsWith(dep.replace('./', '/') + '.js') || keys[i].endsWith('/' + dep + '.js') || keys[i] === dep) return req(keys[i]);\n";
  output += "    }\n    throw new Error('Module not found: ' + dep);\n  });\n";
  output += "  return mod.exports;\n}\n";

  for (const [filePath, source] of Object.entries(modules)) {
    output += `modules[${JSON.stringify(filePath)}] = function(module, exports, require) {\n${source}\n};\n`;
  }

  const entryPath = Object.keys(modules).find(p => p.endsWith("common.js"));
  output += `var hljs = req(${JSON.stringify(entryPath)});\n`;
  output += 'if (typeof window !== "undefined") window.hljs = hljs;\n';
  output += "})();\n";

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, output);
  return { size: output.length, modules: Object.keys(modules).length };
}

// 检查是否需要重建
function needsBuild() {
  if (!fs.existsSync(OUTPUT_PATH)) return true;
  const hljsPkg = path.join(ROOT_DIR, "node_modules", "highlight.js", "package.json");
  if (!fs.existsSync(hljsPkg)) return false;
  const bundleMtime = fs.statSync(OUTPUT_PATH).mtimeMs;
  const pkgMtime = fs.statSync(hljsPkg).mtimeMs;
  return pkgMtime > bundleMtime;
}

function ensureBundle() {
  if (!needsBuild()) return false;
  const result = buildBundle();
  console.log(`highlight.js bundle 已生成: ${(result.size / 1024).toFixed(1)}KB (${result.modules} 个模块)`);
  return true;
}

module.exports = { buildBundle, ensureBundle };

if (require.main === module) {
  const result = buildBundle();
  console.log(`highlight.js bundle: ${(result.size / 1024).toFixed(1)}KB, ${result.modules} modules`);
}
