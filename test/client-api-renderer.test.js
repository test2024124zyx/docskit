"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");
const build = require("../build-api-renderer");
const renderer = require("../client-api-renderer");

const delay = () => new Promise((resolve) => setTimeout(resolve, 10));
const specification = { openapi: "3.1.0", info: { title: "真实组件卸载验证", version: "1" }, paths: {} };

function fixture() {
  const dom = new JSDOM('<div id="first"></div><div id="second"></div>', { url: "https://docs.test/manual/", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.scrollTo = () => {};
  return dom;
}

function capture(controller, container) {
  const system = { React: { createElement: (component) => ({ component }) }, getComponent: () => "API组件" };
  controller.plugin(system).rootInjects.render(container);
}

test("官方Swagger组件通过共享React渲染并在卸载时执行真实effect清理", async () => {
  const dom = fixture();
  const { window } = dom;
  let effectMounts = 0;
  let effectCleanups = 0;
  window.eval(fs.readFileSync(require.resolve("../client-api-renderer"), "utf8"));
  const controller = window.DocsKitApiRenderer.create({ window, base: "/manual/" });
  try {
    const bundle = build.createBundle();
    assert.equal(bundle.size, Buffer.byteLength(bundle.code));
    assert.equal(bundle.modules, 2);
    window.eval(bundle.code);
    window.eval(fs.readFileSync(require.resolve("swagger-ui-dist/swagger-ui-bundle.js"), "utf8"));
    const probe = (system) => ({ wrapComponents: { App: (Original) => function ProbedApp(props) {
      system.React.useEffect(() => { effectMounts += 1; return () => { effectCleanups += 1; }; }, []);
      return system.React.createElement(Original, props);
    } } });
    const ui = window.SwaggerUIBundle({ domNode: window.document.getElementById("first"), spec: specification, validatorUrl: null, plugins: [controller.plugin, probe] });
    assert.equal(window.document.getElementById("first").children.length, 0);
    assert.equal(await controller.mount(), true);
    for (let attempt = 0; attempt < 40 && !effectMounts; attempt += 1) await delay();
    assert.equal(effectMounts, 1);
    assert.match(window.document.getElementById("first").textContent, /真实组件卸载验证/);
    assert.equal(await controller.mount(), true);
    assert.equal(window.DocsKitReactDOM.createRenderer(ui.React), window.DocsKitReactDOM.createRenderer(ui.React));
    assert.throws(() => window.DocsKitReactDOM.createRenderer({ version: "0", createElement() {} }), /React.*版本/);
    controller.unmount();
    assert.equal(effectCleanups, 1);
    assert.equal(window.document.getElementById("first").children.length, 0);
    assert.equal(await controller.mount(), false);
  } finally { controller.unmount(); dom.window.close(); }
});

test("并发懒加载只创建一个本地脚本且卸载后的旧页面不会重新挂载", async () => {
  const dom = fixture();
  const { window } = dom;
  const first = renderer.create({ window, base: "/manual/" });
  const second = renderer.create({ window, base: "/manual/" });
  let renders = 0;
  let cleanups = 0;
  try {
    capture(first, window.document.getElementById("first"));
    capture(second, window.document.getElementById("second"));
    const firstMount = first.mount();
    const secondMount = second.mount();
    assert.equal(second.mount(), secondMount);
    assert.equal(window.document.querySelectorAll("script[data-docskit-api-renderer]").length, 1);
    const script = window.document.querySelector("script[data-docskit-api-renderer]");
    assert.equal(script.getAttribute("src"), "/manual/vendor/api-renderer.js");
    first.unmount();
    window.DocsKitReactDOM = { createRenderer: () => ({ createRoot(container) {
      assert.equal(container.id, "second");
      return { render() { renders += 1; }, unmount() { cleanups += 1; } };
    } }) };
    script.onload();
    assert.deepEqual(await Promise.all([firstMount, secondMount]), [false, true]);
    assert.equal(renders, 1);
    second.unmount();
    second.unmount();
    assert.equal(cleanups, 1);
  } finally { first.unmount(); second.unmount(); dom.window.close(); }
});

test("加载失败与超时可重试，缺失渲染器导出不会被视为加载成功", async () => {
  const dom = fixture();
  const { window } = dom;
  const controller = renderer.create({ window });
  const originalSetTimeout = window.setTimeout;
  let timeout;
  try {
    await assert.rejects(controller.mount(), /初始化/);
    capture(controller, window.document.getElementById("first"));
    const failed = controller.mount();
    window.document.querySelector("script[data-docskit-api-renderer]").onerror();
    await assert.rejects(failed, /加载失败/);
    assert.equal(window.document.querySelector("script[data-docskit-api-renderer]"), null);
    const missing = controller.mount();
    window.document.querySelector("script[data-docskit-api-renderer]").onload();
    await assert.rejects(missing, /初始化/);
    window.setTimeout = (callback) => { timeout = callback; return 1; };
    const timedOut = controller.mount();
    timeout();
    await assert.rejects(timedOut, /超时/);
    window.setTimeout = originalSetTimeout;
    let rendered = false;
    window.DocsKitReactDOM = { createRenderer: () => ({ createRoot: () => ({ render() { rendered = true; }, unmount() {} }) }) };
    assert.equal(await controller.mount(), true);
    assert.equal(rendered, true);
  } finally { controller.unmount(); dom.window.close(); }
});

test("同步渲染失败也卸载已创建的React根，允许当前页面重试", async () => {
  const dom = fixture();
  const { window } = dom;
  const controller = renderer.create({ window });
  let cleanups = 0;
  let fail = true;
  try {
    capture(controller, window.document.getElementById("first"));
    window.DocsKitReactDOM = { createRenderer: () => ({ createRoot: () => ({ render() { if (fail) throw new Error("组件渲染失败"); }, unmount() { cleanups += 1; } }) }) };
    await assert.rejects(controller.mount(), /组件渲染失败/);
    assert.equal(cleanups, 1);
    fail = false;
    assert.equal(await controller.mount(), true);
    controller.unmount();
    assert.equal(cleanups, 2);
  } finally { controller.unmount(); dom.window.close(); }
});

test("构建生成可复用产物且源码较新时才重新生成", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "docskit-api-renderer-"));
  const outputPath = path.join(directory, "vendor", "api-renderer.js");
  try {
    assert.equal(build.ensureBundle({ outputPath }), true);
    assert.equal(build.ensureBundle({ outputPath }), false);
    assert.equal(fs.readFileSync(outputPath, "utf8"), build.createBundle().code);
    fs.utimesSync(outputPath, new Date(0), new Date(0));
    assert.equal(build.ensureBundle({ outputPath }), true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
