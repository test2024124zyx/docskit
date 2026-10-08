---
title: OpenAPI 与在线调试
description: 使用本地 OpenAPI 合同生成接口文档、多语言示例和在线请求面板。
order: 2
icon: code-2
---

# OpenAPI 与在线调试

DocsKit 支持 OpenAPI 3.0 和 3.1 的 JSON、YAML 文件。在 Markdown 的 front matter 中设置 `openapi`，页面会保留作者编写的说明，并展示接口参数、模型、认证、响应及多语言代码示例。读者可以打开请求面板，填写参数后主动发送请求。

在线面板使用本地 Swagger UI。展开接口后点击 `Try it out` 编辑参数，再点击 `Execute` 发送请求；响应区会显示耗时、状态码、响应头和正文，以及本次请求的 cURL、JavaScript、Python 示例。JavaScript 示例使用 Node.js 内置 `fetch`，可保存为 `.mjs` 运行；Python 示例需要 `requests`。上传文件时，示例使用所选文件名，运行前应把对应文件放在脚本工作目录。

## 绑定合同

例如本仓库的[搜索接口](../api/http/search.md)绑定 `docs/api/specs/search.yaml`，它描述的是真实的 DocsKit 动态服务接口。

```markdown
---
title: 搜索接口
openapi: ../specs/search.yaml
---

# 搜索接口
输入多个关键词时，结果必须同时包含这些关键词。
```

路径相对于当前 Markdown 文件；以 `/` 开头的路径相对于文档根目录。本地 `$ref` 可以引用其他 JSON、YAML 文件和循环 schema，构建时会校验并打包。远程 `$ref`、文件协议、隐藏文件、配置文件、符号链接和文档目录之外的文件不允许使用。跨文件 `$dynamicRef` 暂不支持，会给出明确错误。

OpenAPI 示例对象的 `externalValue` 可以指向本地 JSON、YAML 文件。发布时会读取并内联示例，遵循相同的目录边界和总量限制；远程示例地址会报错。仅打开 API 页面不会自动读取外部示例。

API 页的 Markdown 复制、下载及 `llms-full.txt` 会附带完整 OpenAPI 合同 JSON，便于阅读工具获取参数和模型。导出不含内部依赖清单或磁盘元数据。

单份合同和其引用图合计最多 8 MiB、64 个文件，结构深度最多 128 层、节点最多 100000 个。损坏的合同会阻止静态发布；运行中的服务已有可用索引时会保留旧版本，并在界面提示更新失败。

## 配置服务器和认证

使用 OpenAPI 的 `servers` 描述可选环境，也支持路径和操作级服务器设置。绝对地址必须使用 HTTP 或 HTTPS；相对地址使用当前站点。服务器变量必须有默认值，可通过有限的 `enum` 声明可选主机；单个服务器的组合上限为 64。浏览器连接策略只允许合同声明的来源，未声明的新主机不会自动放行。

认证按 OpenAPI `securitySchemes` 和 `security` 配置，读者在请求面板中填写。OAuth2 合同明确声明的 `tokenUrl` 和 `refreshUrl` 也会加入连接许可，可以使用独立认证域；这些地址同样只允许无内嵌凭据的 HTTP(S) URL，相对地址沿用当前站点或所选服务器的来源。认证服务仍需允许浏览器跨域请求。

OAuth2 授权码流程使用本站的 `/vendor/oauth2-redirect.html` 回调页；静态站点带部署基路径，例如 `/reference/vendor/oauth2-redirect.html`。请在身份服务中登记文档站点完整的同源回调 URL。回调页及其外链脚本随动态服务和静态产物一起提供，无需放宽脚本 CSP。

OpenID Connect 的动态发现不会扩展连接许可：仅声明 `openIdConnectUrl` 不会授权新的来源，发现文档返回的其他来源也不会自动放行。需要独立身份域时，可在 OAuth2 合同中明确声明令牌和刷新地址，或在外部完成认证后按 HTTP Bearer 方案填写令牌。

DocsKit 不保存认证信息，切换文档会销毁调试实例并取消尚未完成的请求。请求不自动带浏览器 Cookie，也不跟随重定向；显式填写的认证头会发送给所选服务器。

## 跨域与请求限制

调试请求由浏览器直接发送，目标 API 必须允许文档站点的 CORS 来源、方法和请求头。HTTPS 文档页无法调用被浏览器阻止的 HTTP 混合内容。请求超过 30 秒会取消，并展示可操作的错误提示。DocsKit 不提供服务端转发代理。

更新合同新增 API 或认证域后，需要完整刷新已经打开的文档页，才能取得最新的浏览器连接策略。

静态导出也包含接口展示和调试组件；目标业务 API 仍需独立运行。静态输出中的 `_headers` 包含连接策略，部署时应确认托管平台支持该文件；其他 Web 服务器需要配置等效响应头。

## 发布前验证

执行 `npm run check` 检查合同、引用和正文链接，再执行静态构建。组件从站点自身按需加载，不会在普通文章页下载 API 组件；遥测和 AI 对话功能关闭。
