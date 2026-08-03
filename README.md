# DocsKit

DocsKit 是一个由 Markdown 文件夹驱动的轻量文档站点。它会递归扫描指定目录，将子目录转换为分级侧边栏，将 Markdown 文件渲染为可搜索、可导航的文档页面。

## 特性

- 递归解析 `.md` 和 `.markdown` 文件。
- 根据目录结构自动生成多级侧边栏。
- 支持标题、段落、列表、表格、引用、代码块、语法高亮、行号、图片、音视频、附件下载和相对链接。
- 支持 front matter 配置标题、摘要、排序和图标。
- 支持在普通 Markdown 文本中使用 `:icon[name]` 展示内置图标。
- 侧边栏图标、顶部导航、品牌信息和主题开关均可配置。
- 服务端全文搜索标题、路径和 Markdown 正文。
- 首页和文档页支持服务端初始渲染，站点 SEO 可被搜索引擎直接读取。
- 文档索引按需构建并缓存在内存中，文件变化后下一次请求自动失效重建。
- 支持浅色/深色主题和移动端导航抽屉。
- 不主动刷新页面；修改文档、目录结构或配置后，刷新浏览器即可看到最新结果。

## 快速开始

### 环境要求

- Node.js 24.x

### 启动服务

```bash
npm run dev
```

提交或部署前可以运行构建校验和完整测试：

```bash
npm run build
npm test
```

启动后打开 <http://127.0.0.1:3000>。

默认情况下，服务会扫描项目根目录下的 `docs/`：

```text
docs/
├── README.md
├── docs.config.json
├── getting-started/
│   └── installation.md
├── guides/
│   └── writing-docs.md
└── components/
    └── button.md
```

### 指定文档目录

可以通过命令行参数或环境变量指定已有 Markdown 目录：

```bash
node server.js --docs ./my-docs --port 3001
```

```bash
DOCS_DIR=./my-docs npm run dev
```

Windows PowerShell：

```powershell
$env:DOCS_DIR = ".\my-docs"
npm run dev
```

命令行参数优先级高于环境变量，环境变量优先级高于 `docs.config.json` 中的 `docsDir`。

默认配置文件路径为 `docs/docs.config.json`。如果通过 `--docs` 或 `DOCS_DIR` 指定了文档目录，默认配置文件会从对应目录下查找；也可以使用 `--config` 或 `DOCS_CONFIG` 指定配置文件路径。

### 生成静态站点

`npm run build` 会直接生成可部署的静态站点，默认输出到项目根目录的 `dist/`：

```bash
npm run build
```

构建结果包含首页、每篇文档的独立 `.html` 页面、文档 JSON、离线搜索索引、图片/音视频/附件、KaTeX 与 Mermaid 资源，以及 `robots.txt` 和 `sitemap.xml`。将整个 `dist/` 目录部署到静态托管平台即可，不需要 Node.js 服务端。

常用构建参数如下：

```bash
npm run build -- --docs ./my-docs --out ./dist --base /docs/ --site-url https://mymyjd.com
```

`--docs` 指定 Markdown 目录，`--config` 指定配置文件，`--out` 指定输出目录，`--base` 指定站点部署基路径，`--site-url` 指定用于 SEO、robots 和 sitemap 的站点根地址。`--base` 需要以 `/` 开头，例如部署在域名根目录使用 `/`，部署在 `https://mymyjd.com/docs/` 使用 `/docs/`。不提供 `--site-url` 时仍会生成 sitemap，但不会在 robots 文件中写入不准确的绝对站点地址。

## 配置

站点配置文件是 [docs/docs.config.json](docs/docs.config.json)。配置文件会按文件变更缓存，修改后刷新页面即可生效。

配置文件不是必需的。文件不存在、JSON 无效或只提供部分字段时，服务会使用默认配置继续运行：顶部自定义导航为空，未指定图标的文件和目录会按路径稳定选择内置图标。

### 站点和顶部导航

```json
{
  "site": {
    "brand": { "name": "docs", "accent": "kit" },
    "context": "知识库",
    "title": "我的文档",
    "logo": "assets/logo.png",
    "favicon": "assets/favicon.ico",
    "seo": {
      "title": "我的文档",
      "description": "默认 SEO 描述",
      "keywords": ["文档", "Markdown"],
      "author": "",
      "robots": "index,follow",
      "canonical": "",
      "themeColor": ""
    },
    "footer": {
      "copyright": "© 2026 我的文档",
      "icp": "ICP备案号",
      "beian": "公安备案号",
      "links": [{ "label": "智能体", "href": "https://chat.mymyjd.com", "external": true }]
    }
  },
  "topbar": {
    "version": "v1.0.0",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "开始使用", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "项目仓库", "href": "https://github.com/test2024124zyx/docskit", "external": true, "icon": "github" }
    ]
  }
}
```

顶部导航项目使用 `path` 打开站内文档，使用 `href` 打开外部链接。外部链接可以设置 `external: true`，也会自动识别 `http://` 和 `https://` 地址。

### Markdown 代码块

代码块默认启用服务端语法高亮、行号和复制按钮；可以在 `docs.config.json` 中分别控制：

```json
{
  "markdown": {
    "code": {
      "highlight": true,
      "lineNumbers": true,
      "copy": true,
      "wrap": false
    }
  }
}
```

`highlight` 控制语法高亮，未知语言会安全回退为纯文本；`lineNumbers` 控制行号 gutter；`copy` 控制复制按钮；`wrap` 控制长代码是否自动换行。四个字段都只接受布尔值，填入其他类型时恢复默认值。

### 侧边栏图标

```json
{
  "sidebar": {
    "sort": "createdAt",
    "iconStrategy": "modern",
    "expandMode": "accordion",
    "indent": 16,
    "iconColor": "",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a"],
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "components": "blocks",
      "components/button.md": "mouse-pointer-2"
    }
  }
}
```

`sidebar.sort` 支持 `createdAt` 和 `locale`。`order` 始终优先于全局排序方式；`createdAt` 按文件系统创建时间排序，无法提供创建时间时回退到变更时间；`locale` 按标题进行中文本地排序。

`sidebar.iconStrategy` 支持 `default`、`modern` 和 `mixed`：默认策略让目录显示文件夹图标、Markdown 显示 Markdown 文件图标；现代策略顶级菜单使用稳定随机的多彩图标，子级菜单使用稳定随机的单色图标；混合策略顶级目录固定使用多彩文件夹图标，子级目录固定使用单色文件夹图标，文件按层级使用多彩或单色图标。

`sidebar.icons` 支持目录路径和 Markdown 相对路径，精确文件路径优先于目录路径；`defaultFileIcon`、`defaultFolderIcon` 和 front matter 中的 `icon` 优先于默认策略。`iconPalette` 控制顶级多彩图标的颜色组合，策略会稳定选择最多 3 种颜色生成渐变；`iconColor` 会覆盖所有菜单图标并强制使用单色。`indent` 控制每级导航缩进，单位为像素，范围为 0 到 48。`expandMode` 为 `all` 时全部展开，为 `accordion` 时同级目录互斥展开。

### 内置图标

当前内置 **102** 个图标。配置文件中的 `icon`、`defaultFileIcon`、`defaultFolderIcon` 和 `sidebar.icons` 均可使用以下名称：

| 分类 | 图标名称 |
| --- | --- |
| 文档与目录 | `file-text`、`file`、`file-plus`、`file-code`、`file-markdown`、`file-check`、`file-cog`、`file-search`、`file-heart`、`file-warning`、`file-lock`、`folder`、`folder-open`、`folder-plus`、`folder-tree`、`folder-cog`、`folder-search`、`folder-check`、`folder-git-2`、`folder-heart`、`folder-key`、`home`、`bookmark`、`archive`、`package`、`rocket`、`blocks`、`layout-dashboard`、`list`、`table` |
| 开发与配置 | `book-open`、`code-2`、`terminal`、`braces`、`layers`、`network`、`workflow`、`component`、`brackets`、`binary`、`cpu`、`wrench`、`tool-case`、`settings`、`database`、`server`、`cloud`、`box`、`sliders-horizontal`、`filter`、`search` |
| 内容与产品 | `mouse-pointer-2`、`pencil-line`、`zap`、`monitor`、`smartphone`、`map`、`megaphone`、`pin`、`history`、`circle-help`、`bookmark-check`、`book-marked`、`newspaper`、`scroll-text`、`notebook-tabs`、`text`、`graduation-cap`、`palette`、`sparkles`、`flag` |
| 通信与链接 | `github`、`globe-2`、`link`、`download`、`mail`、`message-circle`、`bell`、`user`、`users`、`calendar`、`clock`、`upload` |
| 状态与媒体 | `check`、`check-circle`、`x-circle`、`info`、`alert-triangle`、`shield-check`、`lock`、`eye`、`star`、`heart`、`tag`、`image`、`copy` |
| 界面操作 | `sun`、`moon`、`chevron-down`、`chevron-right`、`arrow-right`、`external-link` |

## Markdown 约定

每篇文档可以使用 front matter 自定义导航信息：

```markdown
---
title: 自定义标题
description: 在导航和搜索结果中显示的摘要
order: 1
icon: book-open
---

# 文档标题
```

支持的字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `title` | string | 覆盖文档标题；未配置时使用第一个 Markdown 标题或文件名 |
| `description` | string | 显示在文档元信息和搜索结果中的摘要 |
| `order` | number | 同一层级中的排序值，数值越小越靠前 |
| `icon` | string | 文档默认图标，配置文件中的路径图标优先级更高 |
| `hidden` | boolean | 设置为 `true` 时不加入导航和搜索索引 |

Markdown 中的相对链接会在站点内切换文档：

```markdown
[安装说明](docs/getting-started/installation.md)
```

普通 Markdown 文本中可以使用 `:icon[name]` 展示内置图标，例如 `:icon[rocket]`。代码块和行内代码中的标记不会被替换。

## 项目结构

```text
.
├── .github/workflows/    # GitHub Actions 发布流程
├── .dockerignore         # Docker 构建上下文排除项
├── Dockerfile            # 生产镜像定义
├── docs/                 # Markdown 文档与站点配置目录
│   └── docs.config.json  # 站点与导航配置
├── index.html            # 页面外壳
├── script.js             # 浏览器端导航与交互
├── server.js             # 文档扫描、渲染和 HTTP 服务
├── styles.css            # 页面样式
└── package.json          # 启动脚本
```

## HTTP 接口

| 接口 | 说明 |
| --- | --- |
| `GET /healthz` | 返回服务健康状态，供容器编排平台探测 |
| `GET /readyz` | 检查文档目录和索引是否可以读取 |
| `GET /api/bootstrap` | 返回站点配置、导航树和默认文档 |
| `GET /api/document?path=...` | 返回指定 Markdown 文档的渲染结果 |
| `GET /api/search?q=...` | 搜索标题、路径和正文全文 |
| `GET /api/asset?path=...` | 读取文档目录中的图片等静态资源 |
| `GET /api/download?path=...` | 以附件方式下载文档目录中的公开文件 |

服务端只允许读取配置的文档目录及项目内静态资源，并会拒绝越过文档根目录的路径请求。资源接口只开放常用图片、字体、音视频、PDF 和下载文件扩展名，同时拒绝隐藏文件、配置文件、备份文件和符号链接；音视频支持 Range 分片，附件下载会返回安全的 UTF-8 文件名；未知项目静态路径返回 404。SVG 可以直接作为图片资源提供，但响应会使用 `script-src 'none'`、`sandbox` 等策略禁止脚本和外部对象；文档来源不可信时仍建议预处理 SVG 或使用独立资源域。

## 开发

```bash
npm run dev
```

开发服务不需要前端打包步骤。修改 `index.html`、`script.js` 或 `styles.css` 后刷新浏览器即可；修改 `docs/` 下的 Markdown 文档、目录结构或 `docs/docs.config.json` 后也只需刷新页面。发布静态站点时重新运行 `npm run build`，服务不会自动刷新页面，也不提供代码热重载。

服务首次访问文档接口时建立索引，后续请求复用内存中的索引。服务会监听文档目录的文件变化，将索引标记为过期，并在下一次接口请求时只重建一次；并发请求会共享同一次重建，不会重复读取全部 Markdown 文件。

## Docker 部署

```bash
docker run --rm -p 3000:3000 zhuhanxin/docskit
```

上面的命令使用镜像内置的 `docs/` 内容。容器关闭内容就会丢失。
若希望在容器运行期间编辑宿主机文档和配置持久化文档，可以挂载 `docs/` 目录：

```bash
docker run --rm -p 3000:3000 \
  -v "$PWD/docs:/app/docs" \
  zhuhanxin/docskit
```

挂载后，修改宿主机 `docs/` 下的 Markdown 文件、目录结构或 `docs.config.json`，刷新浏览器即可看到变化。健康检查地址为 <http://127.0.0.1:3000/healthz>。

## Docker Compose 部署

在项目根目录创建 `docker-compose.yml`：

```yaml
services:
  docskit:
    image: zhuhanxin/docskit:latest
    container_name: docskit
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - ./docs:/app/docs
```

启动服务并查看状态：

```bash
docker compose up -d
docker compose ps
```

启动后访问 <http://127.0.0.1:3000>。Compose 会沿用镜像内置的健康检查；日志可以通过以下命令查看：

```bash
docker compose logs -f docskit
```

修改宿主机 `docs/` 下的 Markdown 文件、目录结构或 `docs.config.json` 后，刷新浏览器即可看到变化。停止并删除容器：

```bash
docker compose down
```

更新到镜像最新版本：

```bash
docker compose pull
docker compose up -d
```
