/* 在线调试只在读者主动发送请求时连接目标 API。 */
(function (root, factory) {
  const commonjs = typeof module === "object" && module.exports;
  const api = factory(commonjs ? require("./client-api-renderer") : root.DocsKitApiRenderer, commonjs ? require("./client-api-snippets") : root.DocsKitApiSnippets, commonjs ? require("./client-api-view") : root.DocsKitApiView);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DocsKitApi = api;
})(typeof window === "undefined" ? globalThis : window, function (renderer, snippets, view) {
  "use strict";
  const REQUEST_TIMEOUT_MS = 30000;
  const LIBRARY_TIMEOUT_MS = 30000;
  const libraryLoads = new WeakMap();
  let active = null;

  function createConfiguration(reference, options = {}) {
    const window = options.window || globalThis.window;
    const controllers = options.controllers || new Set();
    const allowedOrigins = new Set([window.location.origin, ...(reference.connectSources || [])]);
    const sourceUrl = new URL(window.location.href);
    sourceUrl.hash = "";
    const configuration = {
      // 保留原始示例语义，URL 仅提供相对服务器及引用的基址，合同直接从内存传入。
      spec: JSON.parse(JSON.stringify(reference.spec)),
      url: sourceUrl.href,
      layout: "BaseLayout",
      deepLinking: false,
      queryConfigEnabled: false,
      validatorUrl: null,
      persistAuthorization: false,
      withCredentials: false,
      displayRequestDuration: true,
      docExpansion: "list",
      requestSnippetsEnabled: true,
      requestSnippets: {
        generators: {
          curl_bash: { title: "cURL (bash)", syntax: "bash" },
          curl_powershell: { title: "cURL (PowerShell)", syntax: "powershell" },
          curl_cmd: { title: "cURL (CMD)", syntax: "bash" },
          javascript: { title: "JavaScript (Node.js)", syntax: "javascript" },
          python: { title: "Python", syntax: "python" }
        },
        defaultExpanded: true
      },
      oauth2RedirectUrl: new URL(`${(options.base || "").replace(/\/$/, "")}/vendor/oauth2-redirect.html`, window.location.href).href,
      plugins: [() => ({ fn: { requestSnippetGenerator_javascript: snippets.javascript, requestSnippetGenerator_python: snippets.python } }), view.plugin],
      requestInterceptor(request) {
        if (request.loadSpec) throw new Error("已阻止 API 组件自动读取外部规范或引用，请使用已打包的本地合同。");
        request.credentials = "omit";
        request.redirect = "error";
        request.userFetch = configuration.customFetch;
        return request;
      },
      async customFetch(input, init = {}) {
        if (options.isActive && !options.isActive()) throw new Error("调试页面已关闭，请重新打开后发送请求。");
        const requestLike = typeof input?.url === "string";
        const url = new URL(requestLike ? input.url : String(input), window.location.href);
        if (!/^https?:$/.test(url.protocol)) throw new Error("在线调试仅支持 HTTP 和 HTTPS 地址。");
        if (url.username || url.password) throw new Error("请在认证面板填写凭据，地址中不能包含用户名或密码。");
        if (!allowedOrigins.has(url.origin)) throw new Error("此 API 来源未声明，请先在 OpenAPI 的 servers 或 OAuth2 tokenUrl/refreshUrl 中配置并重新发布文档。");
        const signal = init.signal || input?.signal;
        if (signal?.aborted) throw new Error("请求已取消。");
        const controller = new window.AbortController();
        const cancel = () => controller.abort();
        let timedOut = false;
        let streamOwnsCleanup = false;
        signal?.addEventListener("abort", cancel, { once: true });
        controllers.add(controller);
        const timer = window.setTimeout(() => { timedOut = true; controller.abort(); }, REQUEST_TIMEOUT_MS);
        const cleanup = () => {
          window.clearTimeout(timer);
          signal?.removeEventListener("abort", cancel);
          controllers.delete(controller);
        };
        const requestError = (error) => {
          if (timedOut) return new Error("请求超过 30 秒，请检查服务状态后重试。", { cause: error });
          if (controller.signal.aborted) return new Error("请求已取消。", { cause: error });
          if (error.name === "TypeError") return new Error("请求无法完成：请检查网络、HTTPS、目标 API 的跨域 CORS 配置，以及规范中声明的服务器地址。重定向不会自动跟随。", { cause: error });
          return error;
        };
        try {
          // 强制禁用隐式 Cookie 与重定向，认证头仅来自读者本次输入。
          const response = await window.fetch(input, { ...init, signal: controller.signal, credentials: "omit", redirect: "error" });
          if (!response.body?.getReader) return response;
          // fetch 只等到响应头；必须持续管理响应体，才能取消慢下载及流式响应。
          const reader = response.body.getReader();
          const Stream = window.ReadableStream || globalThis.ReadableStream;
          const ResponseClass = window.Response || globalThis.Response;
          let streamController;
          const abortBody = () => {
            streamController.error(requestError(new Error("响应读取已取消")));
            void reader.cancel().catch(() => {});
            finish();
          };
          const finish = () => {
            controller.signal.removeEventListener("abort", abortBody);
            cleanup();
          };
          const body = new Stream({
            start(value) { streamController = value; },
            async pull(value) {
              try {
                const part = await reader.read();
                if (controller.signal.aborted) return;
                if (part.done) { value.close(); finish(); }
                else value.enqueue(part.value);
              } catch (error) { value.error(requestError(error)); finish(); }
            },
            async cancel(reason) {
              finish();
              await reader.cancel(reason);
            }
          });
          controller.signal.addEventListener("abort", abortBody, { once: true });
          streamOwnsCleanup = true;
          if (controller.signal.aborted) abortBody();
          const wrapped = new ResponseClass(body, { status: response.status, statusText: response.statusText, headers: response.headers });
          for (const key of ["url", "redirected", "type"]) Object.defineProperty(wrapped, key, { value: response[key] });
          return wrapped;
        } catch (error) {
          throw requestError(error);
        } finally {
          if (!streamOwnsCleanup) cleanup();
        }
      }
    };
    return configuration;
  }

  function loadLibrary(window, base) {
    if (libraryLoads.has(window)) return libraryLoads.get(window);
    const stylesheet = window.document.querySelector('link[data-docskit-swagger-style]');
    if (window.SwaggerUIBundle && stylesheet?.dataset.loaded === "true") return Promise.resolve(window.SwaggerUIBundle);
    const script = window.document.createElement("script");
    script.src = `${base.replace(/\/$/, "")}/vendor/swagger-ui-bundle.js`;
    script.dataset.docskitSwagger = "true";
    const style = stylesheet || window.document.createElement("link");
    style.rel = "stylesheet";
    style.href = `${base.replace(/\/$/, "")}/vendor/swagger-ui.css`;
    style.dataset.docskitSwaggerStyle = "true";
    const promise = new Promise((resolve, reject) => {
      let remaining = Number(!window.SwaggerUIBundle) + Number(style.dataset.loaded !== "true");
      const finish = (error) => {
        if (!error && --remaining > 0) return;
        window.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        style.onload = null;
        style.onerror = null;
        if (error) {
          script.remove();
          style.remove();
          libraryLoads.delete(window);
          reject(error);
        } else resolve(window.SwaggerUIBundle);
      };
      const timer = window.setTimeout(() => finish(new Error("API 组件加载超时。")), LIBRARY_TIMEOUT_MS);
      script.onload = () => finish(window.SwaggerUIBundle ? null : new Error("API 组件未能初始化。"));
      script.onerror = () => finish(new Error("API 组件加载失败，请检查网络后重新加载。"));
      style.onload = () => { style.dataset.loaded = "true"; finish(); };
      style.onerror = () => finish(new Error("API 样式加载失败，请检查网络后重新加载。"));
      if (!window.SwaggerUIBundle) window.document.head.append(script);
      if (style.dataset.loaded !== "true" && !style.isConnected) window.document.head.append(style);
    });
    libraryLoads.set(window, promise);
    return promise;
  }

  function unmount() {
    if (!active) return;
    const previous = active;
    active = null;
    for (const controller of previous.controllers) controller.abort();
    try { previous.renderer?.unmount(); }
    finally {
      previous.container.replaceChildren();
      previous.container.ownerDocument.documentElement.classList.toggle("dark-mode", previous.originalDarkMode);
    }
  }

  async function mount(container, reference, options = {}) {
    unmount();
    const window = container.ownerDocument.defaultView;
    const context = { container, theme: options.theme, controllers: new Set(), renderer: null, originalDarkMode: window.document.documentElement.classList.contains("dark-mode") };
    active = context;
    container.setAttribute("aria-busy", "true");
    container.textContent = "正在加载 API 文档与在线调试…";
    try {
      const SwaggerUI = await loadLibrary(window, options.base || "");
      // 用户已经导航离开时，不让迟到的脚本重新挂载旧文档。
      if (active !== context) return;
      container.replaceChildren();
      context.configuration = createConfiguration(reference, { ...options, window, controllers: context.controllers, isActive: () => active === context });
      context.renderer = renderer.create({ window, base: options.base || "" });
      context.instance = SwaggerUI({ ...context.configuration, domNode: container, plugins: [...context.configuration.plugins, context.renderer.plugin] });
      await context.renderer.mount();
      if (active !== context) return;
      syncThemeClasses(context);
    } catch (error) {
      if (active !== context) return;
      context.renderer?.unmount();
      container.replaceChildren();
      const message = window.document.createElement("p");
      message.setAttribute("role", "alert");
      message.textContent = error.message || "API 文档暂时无法显示。";
      const retry = window.document.createElement("button");
      retry.type = "button";
      retry.textContent = "重新加载";
      retry.addEventListener("click", () => { void mount(container, reference, { ...options, theme: context.theme }); }, { once: true });
      container.append(message, retry);
    } finally {
      if (active === context) container.removeAttribute("aria-busy");
    }
  }

  function updateTheme(theme) {
    if (!active) return;
    // 冷加载与失败重试期间也保存最新主题，组件完成初始化后直接采用当前选择。
    active.theme = theme;
    syncThemeClasses(active);
  }

  function syncThemeClasses(context) {
    if (active !== context) return;
    // 直接采用组件官方深色主题，保留当前表单和请求结果。
    context.container.ownerDocument.documentElement.classList.toggle("dark-mode", context.theme === "dark");
  }

  return { createConfiguration, mount, unmount, updateTheme };
});
