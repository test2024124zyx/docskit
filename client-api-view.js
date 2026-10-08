/* 通过官方组件扩展提供可聚焦的请求代码页签，继续复用原有生成器和高亮组件。 */
(function (root, factory) {
  const view = factory();
  if (typeof module === "object" && module.exports) module.exports = view;
  else root.DocsKitApiView = view;
})(typeof window === "undefined" ? globalThis : window, function () {
  "use strict";

  async function copyText(document, text) {
    const window = document.defaultView;
    try {
      if (window.navigator.clipboard?.writeText) {
        await window.navigator.clipboard.writeText(text);
        return;
      }
    } catch { /* 剪贴板权限受限时仍尝试 HTTP 页面可用的兼容复制。 */ }
    const focused = document.activeElement;
    const selection = window.getSelection();
    const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange());
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.cssText = "position:fixed;inset:0 auto auto -9999px;opacity:0";
    document.body.append(textarea);
    try {
      textarea.select();
      if (!document.execCommand?.("copy")) throw new Error("复制不可用");
    } finally {
      textarea.remove();
      focused?.focus({ preventScroll: true });
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }

  function plugin(system) {
    const React = system.React;
    const element = React.createElement;

    function RequestSnippets({ request, requestSnippetsSelectors, getComponent }) {
      const generators = requestSnippetsSelectors.getSnippetGenerators();
      const entries = Array.from(generators.entries());
      const [selected, setSelected] = React.useState(entries[0]?.[0]);
      const [expanded, setExpanded] = React.useState(requestSnippetsSelectors.getDefaultExpanded());
      const [copyMessage, setCopyMessage] = React.useState("");
      const id = React.useId();
      if (!entries.length) return null;
      const active = generators.has(selected) ? selected : entries[0][0];
      const generator = generators.get(active);
      const code = generator.get("fn")(request);
      const SyntaxHighlighter = getComponent("SyntaxHighlighter", true);
      const contentId = `${id}-content`;
      const panelId = `${id}-panel`;
      const tabId = (key) => `${id}-tab-${key}`;

      function navigate(event, current) {
        let next;
        if (event.key === "ArrowRight") next = (current + 1) % entries.length;
        else if (event.key === "ArrowLeft") next = (current + entries.length - 1) % entries.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = entries.length - 1;
        else return;
        event.preventDefault();
        setSelected(entries[next][0]);
        event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[next].focus();
      }

      return element("div", { className: "request-snippets" },
        element("button", { type: "button", className: "btn docskit-api-snippets-toggle", "aria-expanded": expanded, "aria-controls": contentId, onClick: () => setExpanded(!expanded) }, expanded ? "收起请求代码" : "展开请求代码"),
        expanded && element("div", { className: "curl-command", id: contentId },
          element("div", { role: "tablist", "aria-label": "请求示例语言", className: "docskit-api-language-tabs" },
            entries.map(([key, value], index) => element("button", {
              type: "button", role: "tab", id: tabId(key), key, className: `btn${active === key ? " active" : ""}`,
              "aria-controls": panelId, "aria-selected": active === key, tabIndex: active === key ? 0 : -1,
              onClick: () => setSelected(key), onKeyDown: (event) => navigate(event, index)
            }, value.get("title")))
          ),
          element("div", { role: "tabpanel", id: panelId, "aria-labelledby": tabId(active), tabIndex: 0 },
            element("div", { className: "docskit-api-copy-toolbar" },
              // 官方复制按钮的名称固定为“复制路径”，代码面板使用语义明确的原生按钮。
              element("button", { type: "button", className: "btn", "aria-label": "复制请求代码", onClick: async (event) => {
                try { await copyText(event.currentTarget.ownerDocument, code); setCopyMessage("已复制请求代码"); }
                catch { setCopyMessage("复制失败，请选中代码手动复制。"); }
              } }, "复制代码"),
              element("span", { role: "status", "aria-live": "polite" }, copyMessage)
            ),
            element(SyntaxHighlighter, { language: generator.get("syntax"), className: "curl microlight" }, code)
          )
        )
      );
    }

    return { components: { RequestSnippets } };
  }

  return { plugin };
});
