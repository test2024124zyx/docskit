---
title: DocsKit
description: DocsKit 是一个由 Markdown 文件夹驱动的轻量文档站点
order: 0
icon: home
---

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

站点配置文件是 `docs/docs.config.json`，用于配置站点品牌、主题色、SEO、导航、侧边栏图标等。配置文件不是必需的，缺失时会使用默认值。

详细配置说明请参考 [配置文件](api/configuration.md)。

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
[安装说明](getting-started/installation.md)
```

普通 Markdown 文本中可以使用 `:icon[name]` 展示内置图标，例如 `:icon[rocket]`。代码块和行内代码中的标记不会被替换。图片语法指向 `.mp4`、`.webm`、`.mp3` 等媒体时会显示原生播放器；指向 PDF、Office 文档或压缩包的普通链接会进入附件下载接口。公式和 Mermaid 语法详见[文档编写指南](guides/writing-docs.md)。

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


## 部署

DocsKit 支持多种方式部署：

- **Docker 容器部署**：使用预构建镜像 `zhuhanxin/docskit`，支持数据挂载、环境变量和 Docker Compose。详见 [Docker 部署](getting-started/docker-deployment.md)。
- **静态站点**：运行 `npm run build` 生成静态 HTML，部署到任意静态托管平台，不需要 Node.js 服务端。
