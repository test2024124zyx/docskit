# DocsKit

DocsKit 是一个由 Markdown 文件夹驱动的轻量文档站点。它会递归扫描指定目录，将子目录转换为分级侧边栏，将 Markdown 文件渲染为可搜索、可导航的文档页面。

## 特性

- 递归解析 `.md` 和 `.markdown` 文件。
- 根据目录结构自动生成多级侧边栏。
- 支持标题、段落、列表、表格、引用、代码块、图片和相对链接。
- 支持 front matter 配置标题、摘要、排序和图标。
- 侧边栏图标、顶部导航、品牌信息和主题开关均可配置。
- 服务端全文搜索标题、路径和 Markdown 正文。
- 支持浅色/深色主题和移动端导航抽屉。
- 文档按需加载，新增文件后刷新页面即可重新索引。

## 快速开始

### 环境要求

- Node.js 18 或更高版本

### 启动服务

```bash
npm run dev
```

启动后打开 <http://127.0.0.1:3000>。

默认情况下，服务会扫描项目根目录下的 `docs/`：

```text
docs/
├── README.md
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

## 配置

站点配置文件是 [docs.config.json](docs.config.json)。配置文件会在每次接口请求时读取，修改后刷新页面即可生效。

### 站点和顶部导航

```json
{
  "site": {
    "brand": { "name": "docs", "accent": "kit" },
    "context": "知识库",
    "title": "我的文档"
  },
  "topbar": {
    "version": "v1.0.0",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "开始使用", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "项目仓库", "href": "https://github.com/", "external": true, "icon": "github" }
    ]
  }
}
```

顶部导航项目使用 `path` 打开站内文档，使用 `href` 打开外部链接。外部链接可以设置 `external: true`，也会自动识别 `http://` 和 `https://` 地址。

### 侧边栏图标

```json
{
  "sidebar": {
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-text",
    "icons": {
      "components": "blocks",
      "components/button.md": "mouse-pointer-2"
    }
  }
}
```

`sidebar.icons` 支持目录路径和 Markdown 相对路径。精确文件路径优先于目录路径，未配置的项目使用默认图标。

当前内置图标包括：`folder`、`file-text`、`home`、`rocket`、`blocks`、`book-open`、`code-2`、`mouse-pointer-2`、`pencil-line`、`settings`、`search`、`github` 和 `download`。

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
[安装说明](../getting-started/installation.md)
```

## 项目结构

```text
.
├── docs/                 # Markdown 文档目录
├── docs.config.json      # 站点与导航配置
├── index.html            # 页面外壳
├── script.js             # 浏览器端导航与交互
├── server.js             # 文档扫描、渲染和 HTTP 服务
├── styles.css            # 页面样式
└── package.json          # 启动脚本
```

## HTTP 接口

| 接口 | 说明 |
| --- | --- |
| `GET /api/bootstrap` | 返回站点配置、导航树和默认文档 |
| `GET /api/document?path=...` | 返回指定 Markdown 文档的渲染结果 |
| `GET /api/search?q=...` | 搜索标题、路径和正文全文 |
| `GET /api/asset?path=...` | 读取文档目录中的图片等静态资源 |

服务端只允许读取配置的文档目录及项目内静态资源，并会拒绝越过文档根目录的路径请求。

## 开发

```bash
npm run dev
```

项目不需要前端构建步骤。修改 `index.html`、`script.js` 或 `styles.css` 后刷新浏览器即可；修改 Markdown 文档或 `docs.config.json` 后同样刷新页面即可查看结果。
