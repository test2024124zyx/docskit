/* 在线调试只在读者主动发送请求时连接目标 API。 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DocsKitApi = api;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";
  const REQUEST_TIMEOUT_MS = 30000;
  const LIBRARY_TIMEOUT_MS = 30000;
  const libraryLoads = new WeakMap();
  let active = null;
  let nextDocumentId = 0;
  const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

  function createDisplayDocument(specification, documentUrl) {
    const document = JSON.parse(JSON.stringify(specification));
    const visited = new WeakSet();
    const resolve = (node) => {
      if (!node?.$ref?.startsWith("#/")) return null;
      let target = document;
      for (const part of decodeURIComponent(node.$ref.slice(2)).split("/").map((key) => key.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        if (!target || !Object.hasOwn(target, part)) return null;
        target = target[part];
      }
      return target;
    };
    const normalize = (servers) => {
      for (const server of servers || []) {
        // 绝对模板保留变量选择；变量开头的地址在发送前按展开后的实际值解析。
        if (/^[^/]*:\/\//.test(server.url) || server.url.startsWith("{")) continue;
        let marker = "docskit-server-variable";
        while (server.url.includes(marker)) marker += "-";
        const variables = [];
        const template = server.url.replace(/\{[^{}]+\}/g, (value) => {
          const token = `${marker}${variables.length}`;
          variables.push([token, value]);
          return token;
        });
        let normalized = new URL(template, documentUrl).href;
        for (const [token, value] of variables) normalized = normalized.replaceAll(token, value);
        server.url = normalized;
      }
    };
    const visit = (node, callback = false) => {
      if (!node || typeof node !== "object" || visited.has(node)) return;
      visited.add(node);
      visit(resolve(node), callback);
      if (callback) {
        for (const [key, item] of Object.entries(node)) if (key !== "$ref" && !key.startsWith("x-")) visit(item);
        return;
      }
      normalize(node.servers);
      for (const method of HTTP_METHODS) {
        const operation = node[method];
        if (!operation) continue;
        // Scalar 的请求上下文只读取操作级服务器，将路径级继承落实在展示副本中。
        if (operation.servers === undefined && node.servers !== undefined) operation.servers = JSON.parse(JSON.stringify(node.servers));
        normalize(operation.servers);
        for (const item of Object.values(operation.callbacks || {})) visit(item, true);
      }
    };
    normalize(document.servers);
    for (const items of [document.paths, document.webhooks, document.components?.pathItems]) {
      for (const item of Object.values(items || {})) visit(item);
    }
    for (const item of Object.values(document.components?.callbacks || {})) visit(item, true);
    return document;
  }

  function createConfiguration(reference, options = {}) {
    const window = options.window || globalThis.window;
    const controllers = options.controllers || new Set();
    const allowedOrigins = new Set([window.location.origin, ...(reference.connectSources || [])]);
    const sourceUrl = new URL(window.location.href);
    sourceUrl.hash = "";
    sourceUrl.searchParams.set("__docskit_api_document", String(++nextDocumentId));
    const documentUrl = sourceUrl.href;
    const specification = JSON.stringify(createDisplayDocument(reference.spec, documentUrl));
    return {
      // URL 分支会把 customFetch 传入 Scalar 文档加载器；实际合同直接从内存返回。
      url: documentUrl,
      theme: "default",
      darkMode: options.theme === "dark",
      hideDarkModeToggle: true,
      showSidebar: false,
      hideSearch: true,
      showDeveloperTools: "never",
      persistAuth: false,
      telemetry: false,
      agent: { disabled: true },
      mcp: { disabled: true },
      proxyUrl: "",
      withDefaultFonts: false,
      localization: { locale: "zh-CN" },
      defaultHttpClient: { targetKey: "shell", clientKey: "curl" },
      onBeforeRequest({ requestBuilder }) {
        // 此公开钩子拿到已展开服务器变量的真实地址，兼容相对和绝对值混用的模板。
        if (requestBuilder.baseUrl && !requestBuilder.baseUrl.includes("{{")) requestBuilder.baseUrl = new URL(requestBuilder.baseUrl, documentUrl).href;
      },
      async customFetch(input, init = {}) {
        const requestLike = typeof input?.url === "string";
        const url = new URL(requestLike ? input.url : String(input), window.location.href);
        if (url.href === documentUrl) {
          const ResponseClass = window.Response || globalThis.Response;
          return new ResponseClass(specification, { headers: { "Content-Type": "application/json" } });
        }
        // 已锁定版本的元数据加载器仅传 URL 和 headers；实际请求使用 Request 或明确 method。
        if (!requestLike && Object.hasOwn(init, "headers") && !init.method && Object.keys(init).every((key) => key === "headers")) {
          throw new Error("已阻止 API 组件自动读取外部引用；请使用已打包的本地合同和内联示例。");
        }
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
  }

  function loadLibrary(window, base) {
    if (window.Scalar?.createApiReference) return Promise.resolve(window.Scalar);
    if (libraryLoads.has(window)) return libraryLoads.get(window);
    const script = window.document.createElement("script");
    script.src = `${base.replace(/\/$/, "")}/vendor/scalar.js`;
    script.dataset.docskitScalar = "true";
    const promise = new Promise((resolve, reject) => {
      const finish = (error) => {
        window.clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          libraryLoads.delete(window);
          reject(error);
        } else resolve(window.Scalar);
      };
      const timer = window.setTimeout(() => finish(new Error("API 组件加载超时。")), LIBRARY_TIMEOUT_MS);
      script.onload = () => finish(window.Scalar?.createApiReference ? null : new Error("API 组件未能初始化。"));
      script.onerror = () => finish(new Error("API 组件加载失败，请检查网络后重新加载。"));
      window.document.head.append(script);
    });
    libraryLoads.set(window, promise);
    return promise;
  }

  function unmount() {
    if (!active) return;
    const previous = active;
    active = null;
    previous.themeObserver?.disconnect();
    for (const controller of previous.controllers) controller.abort();
    try { previous.instance?.destroy(); }
    finally {
      previous.container.replaceChildren();
      const body = previous.container.ownerDocument.body;
      body.classList.toggle("dark-mode", previous.bodyModes.dark);
      body.classList.toggle("light-mode", previous.bodyModes.light);
    }
  }

  async function mount(container, reference, options = {}) {
    unmount();
    const window = container.ownerDocument.defaultView;
    const body = window.document.body;
    const context = { container, theme: options.theme, controllers: new Set(), instance: null, bodyModes: { dark: body.classList.contains("dark-mode"), light: body.classList.contains("light-mode") } };
    active = context;
    container.setAttribute("aria-busy", "true");
    container.textContent = "正在加载 API 文档与在线调试…";
    try {
      const scalar = await loadLibrary(window, options.base || "");
      // 用户已经导航离开时，不让迟到的脚本重新挂载旧文档。
      if (active !== context) return;
      container.replaceChildren();
      context.configuration = createConfiguration(reference, { ...options, theme: context.theme, window, controllers: context.controllers });
      context.instance = scalar.createApiReference(container, context.configuration);
      // Scalar 的 darkMode 只决定初始值；使用其主题类同步面板及挂到 body 的请求窗口。
      context.themeObserver = new window.MutationObserver(() => syncThemeClasses(context));
      context.themeObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
      syncThemeClasses(context);
    } catch (error) {
      if (active !== context) return;
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
    if (!active.configuration) return;
    // Scalar 的更新方法会替换整个配置，必须保留请求策略、合同和认证存储设置。
    active.configuration = { ...active.configuration, darkMode: theme === "dark" };
    active.instance?.updateConfiguration?.(active.configuration);
    syncThemeClasses(active);
  }

  function syncThemeClasses(context) {
    if (active !== context) return;
    const body = context.container.ownerDocument.body;
    body.classList.toggle("dark-mode", context.configuration.darkMode);
    body.classList.toggle("light-mode", !context.configuration.darkMode);
  }

  return { createConfiguration, mount, unmount, updateTheme };
});
