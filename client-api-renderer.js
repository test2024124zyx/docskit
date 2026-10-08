(function (root, factory) {
  const renderer = factory();
  if (typeof module === "object" && module.exports) module.exports = renderer;
  else root.DocsKitApiRenderer = renderer;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const LOAD_TIMEOUT_MS = 30000;
  const pendingLibraries = new WeakMap();

  function loadLibrary(window, base) {
    if (window.DocsKitReactDOM?.createRenderer) return Promise.resolve(window.DocsKitReactDOM);
    if (pendingLibraries.has(window)) return pendingLibraries.get(window);
    const script = window.document.createElement("script");
    script.src = `${base.replace(/\/$/, "")}/vendor/api-renderer.js`;
    script.dataset.docskitApiRenderer = "true";
    const promise = new Promise((resolve, reject) => {
      const finish = (error) => {
        window.clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          pendingLibraries.delete(window);
          reject(error);
        } else resolve(window.DocsKitReactDOM);
      };
      const timeout = window.setTimeout(() => finish(new Error("API 渲染器加载超时，请重试。")), LOAD_TIMEOUT_MS);
      script.onload = () => finish(window.DocsKitReactDOM?.createRenderer ? null : new Error("API 渲染器未能初始化。"));
      script.onerror = () => finish(new Error("API 渲染器加载失败，请检查网络后重试。"));
      window.document.head.appendChild(script);
    });
    pendingLibraries.set(window, promise);
    return promise;
  }

  function create({ window, base = "" }) {
    let captured = null;
    let root = null;
    let disposed = false;
    let mounting = null;

    function plugin(system) {
      // 仅替换官方挂载入口；组件和状态容器继续使用 Swagger 的公开扩展接口。
      return { rootInjects: { render(container) { if (!disposed) captured = { system, container }; } } };
    }

    function mount() {
      if (disposed) return Promise.resolve(false);
      if (root) return Promise.resolve(true);
      if (mounting) return mounting;
      if (!captured) return Promise.reject(new Error("请先初始化 API 组件，再挂载渲染器。"));
      const { system, container } = captured;
      mounting = loadLibrary(window, base).then((library) => {
        // 页面切换只取消当前挂载；共享库加载继续供后续文档复用。
        if (disposed) return false;
        const renderer = library.createRenderer(system.React);
        const App = system.getComponent("App", "root");
        root = renderer.createRoot(container);
        try {
          root.render(system.React.createElement(App));
          return true;
        } catch (error) {
          const failed = root;
          root = null;
          failed.unmount();
          throw error;
        }
      }).finally(() => { mounting = null; });
      return mounting;
    }

    function unmount() {
      disposed = true;
      captured = null;
      const previous = root;
      root = null;
      previous?.unmount();
    }

    return { plugin, mount, unmount };
  }

  return { create };
});
