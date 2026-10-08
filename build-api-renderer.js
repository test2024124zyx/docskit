"use strict";
const fs = require("node:fs");
const path = require("node:path");

const OUTPUT_PATH = path.join(__dirname, "dist", "vendor", "api-renderer.js");

function sourceFiles() {
  const reactDomPackage = require.resolve("react-dom/package.json");
  const schedulerPackage = require.resolve("scheduler/package.json");
  return {
    reactDomPackage,
    schedulerPackage,
    renderer: path.join(path.dirname(reactDomPackage), "cjs", "react-dom.production.min.js"),
    scheduler: path.join(path.dirname(schedulerPackage), "cjs", "scheduler.production.min.js")
  };
}

function createBundle() {
  const files = sourceFiles();
  const version = JSON.parse(fs.readFileSync(files.reactDomPackage, "utf8")).version;
  const renderer = fs.readFileSync(files.renderer, "utf8");
  const scheduler = fs.readFileSync(files.scheduler, "utf8");
  // 原样包装官方生产模块；React 从 Swagger 实例注入，避免重复实例及 UMD 的私有调度器依赖。
  const code = `(function(root) {
"use strict";
var renderers = new WeakMap();
var factories = {
  scheduler: function(module, exports, require) {
${scheduler}
  },
  renderer: function(module, exports, require) {
${renderer}
  }
};
root.DocsKitReactDOM = {
  createRenderer: function(React) {
    if (!React || typeof React.createElement !== "function" || React.version !== ${JSON.stringify(version)}) throw new Error("API 渲染器与 React 的版本不一致，请重新构建站点。");
    if (renderers.has(React)) return renderers.get(React);
    var cache = { react: { exports: React } };
    function load(name) {
      if (Object.prototype.hasOwnProperty.call(cache, name)) return cache[name].exports;
      var factory = factories[name === "react-dom" ? "renderer" : name];
      if (!factory) throw new Error("API 渲染器缺少依赖：" + name);
      var module = { exports: {} };
      cache[name] = module;
      factory(module, module.exports, load);
      return module.exports;
    }
    var renderer = load("react-dom");
    renderers.set(React, renderer);
    return renderer;
  }
};
})(typeof window === "undefined" ? globalThis : window);
`;
  return { code, size: Buffer.byteLength(code), modules: 2 };
}

function ensureBundle({ outputPath = OUTPUT_PATH } = {}) {
  const files = sourceFiles();
  if (fs.existsSync(outputPath)) {
    const modified = fs.statSync(outputPath).mtimeMs;
    if ([__filename, ...Object.values(files)].every((file) => fs.statSync(file).mtimeMs <= modified)) return false;
  }
  const bundle = createBundle();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, bundle.code);
  return true;
}

module.exports = { createBundle, ensureBundle };

if (require.main === module) {
  console.log(ensureBundle() ? "API 渲染器已生成。" : "API 渲染器无需重建。");
}
