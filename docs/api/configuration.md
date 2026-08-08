---
title: 配置文件
description: 使用 docs.config.json 配置站点品牌、SEO、导航、排序和侧边栏图标。
order: 1
icon: settings
---

# 配置文件

默认配置文件是文档目录下的 `docs.config.json`。本项目使用 `docs/docs.config.json`。配置文件可以只写需要覆盖的字段；文件不存在、JSON 无效或字段缺失时，DocsKit 会使用默认值补齐配置。

`--config` 的优先级高于 `DOCS_CONFIG`，两者都没有设置时，配置文件位于实际文档目录下。文档目录的优先级从高到低为 `--docs`、`DOCS_DIR`、配置中的 `docsDir` 和默认值 `docs`。`docsDir` 使用相对于项目根目录的路径。

## 配置总览

配置文件包含四个顶层节点：

| 节点 | 说明 |
| --- | --- |
| `site` | 站点品牌、主题色、SEO、页脚 |
| `topbar` | 顶部导航栏 |
| `markdown` | Markdown 渲染选项 |
| `sidebar` | 侧边栏排序、图标和展开方式 |

### 文档目录限制

文档路径上方最多允许 5 个目录层级，例如 `a/b/c/d/e/doc.md` 可以使用；超过第 5 个目录层级的 Markdown 文件会被拒绝。服务和静态构建最多加载 300 篇 Markdown 文档，隐藏文档和超大 Markdown 文件也会计入扫描限制。超过任一限制时，服务接口会返回明确错误，静态构建会终止，不会生成不完整的导航树。

完整配置示例：

```json
{
  "site": {
    "brand": { "name": "docs", "accent": "kit" },
    "context": "知识库",
    "eyebrow": "DOCUMENTATION",
    "title": "我的文档",
    "description": "按目录组织的 Markdown 知识库",
    "themeColor": "#3370ff",
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
      "links": [
        { "label": "智能体", "href": "https://chat.example.com", "external": true }
      ]
    }
  },
  "topbar": {
    "version": "v1.0.1",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "开始使用", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "GitHub", "href": "https://github.com/example/repo", "icon": "github", "external": true }
    ]
  },
  "markdown": {
    "code": {
      "highlight": true,
      "lineNumbers": true,
      "copy": true,
      "wrap": false
    }
  },
  "sidebar": {
    "sort": "createdAt",
    "iconStrategy": "modern",
    "expandMode": "accordion",
    "indent": 12,
    "iconColor": "",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a"],
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "getting-started": "rocket",
      "api": "code-2"
    }
  }
}
```

## 站点配置 (site)

### 品牌与基本信息

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `site.brand.name` | string | `"docs"` | 顶部品牌文字的前半部分 |
| `site.brand.accent` | string | `"kit"` | 顶部品牌文字的后半部分（高亮显示） |
| `site.context` | string | `"文档"` | 品牌文字右侧的上下文标签 |
| `site.eyebrow` | string | `"DOCUMENTATION"` | 侧边栏顶部的小字标签 |
| `site.title` | string | `"我的文档"` | 侧边栏标题 |
| `site.description` | string | `"按目录组织的 Markdown 知识库"` | 站点默认描述，用于 SEO 和首页 |
| `site.themeColor` | string | `""` | 站点主题色（十六进制，如 `#3370ff`、`#ff6b6b`）。配置后自动派生出 `accent-dark`、`accent-soft`、`accent-pale` 等色阶，应用到导航、按钮、链接、代码块等所有界面元素。留空时沿用默认蓝色 `#3370ff` |

### Logo 与图标

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `site.logo` | string / object | `""` | 顶部品牌 Logo。支持远程地址、`data:` URL 或文档目录内的相对路径。对象形式可同时提供 `src`（或 `url`）和 `alt` |
| `site.favicon` | string / object | `""` | 浏览器图标。`.ico` 文件使用 `image/x-icon`，其他使用 `image/png` |
| `site.ico` | string / object | `""` | `favicon` 的兼容别名 |

### SEO 元信息

`site.seo` 设置整站默认 SEO 元信息。文档的 `title` 和 `description` 会覆盖页面级标题和描述，其他字段继续使用站点默认值。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `site.seo.title` | string | `""` | 默认页面标题 |
| `site.seo.description` | string | `""` | 默认页面描述 |
| `site.seo.keywords` | string / array | `""` | 关键词，数组会自动用逗号连接 |
| `site.seo.author` | string | `""` | 作者 |
| `site.seo.robots` | string | `""` | 搜索引擎指令，如 `index,follow` |
| `site.seo.image` | string / object | `""` | Open Graph 分享图片 |
| `site.seo.ogImage` | string / object | `""` | `image` 的兼容别名 |
| `site.seo.canonical` | string | `""` | 规范链接 |
| `site.seo.themeColor` | string | `""` | 浏览器主题色（与 `site.themeColor` 不同，这是 `<meta name="theme-color">`） |

### 页脚

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `site.footer.copyright` | string | `""` | 版权信息 |
| `site.footer.icp` | string | `""` | ICP 备案号 |
| `site.footer.beian` | string | `""` | 公安备案号 |
| `site.footer.links` | array | `[]` | 页脚链接列表 |

页脚链接项支持以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `label` | string | 链接文字 |
| `href` | string | 链接地址（没有时按普通文本显示） |
| `external` | boolean | 是否在新窗口打开 |

没有任何有效内容时，页脚自动隐藏。

## 顶部导航 (topbar)

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `topbar.version` | string | `""` | 版本号，显示在顶部右侧 |
| `topbar.search` | boolean | `true` | 是否显示搜索按钮 |
| `topbar.themeToggle` | boolean | `true` | 是否显示主题切换按钮 |
| `topbar.links` | array | `[]` | 顶部导航链接列表 |

导航链接项支持以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `label` | string | 链接文字 |
| `path` | string | 站内文档路径（如 `getting-started/installation.md`） |
| `href` | string | 外部链接地址（如 `https://github.com`） |
| `icon` | string | 图标名称（参考[内置图标](#内置图标)） |
| `external` | boolean | 是否在新窗口打开 |

使用 `path` 打开站内文档，使用 `href` 打开外部页面。外部链接可以设置 `external: true`，也会自动识别 `http://` 和 `https://` 地址。

示例：

```json
{
  "topbar": {
    "version": "v1.0.1",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "开始使用", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "GitHub", "href": "https://github.com/example/repo", "icon": "github", "external": true }
    ]
  }
}
```

## Markdown 渲染 (markdown)

代码块通过服务端 `highlight.js` 处理常见语言，并在页面中显示复制按钮。超过 100 行的代码块会跳过高亮，由客户端延迟处理以提升性能。

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `markdown.code.highlight` | boolean | `true` | 是否启用服务端语法高亮；未知语言或高亮失败时回退为转义纯文本 |
| `markdown.code.lineNumbers` | boolean | `true` | 是否显示行号（使用 CSS counter 生成，无额外 DOM 开销） |
| `markdown.code.copy` | boolean | `true` | 是否在代码块顶部显示复制按钮 |
| `markdown.code.wrap` | boolean | `false` | 是否让长代码自动换行；关闭时保留横向滚动 |

配置值必须是布尔值，其他类型会回退到默认值。代码围栏中的语言名称仍决定高亮语言，例如 `javascript`；不支持的语言只显示转义后的原文。

## 侧边栏配置 (sidebar)

### 排序与展开

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sidebar.sort` | string | `"createdAt"` | 排序方式：`createdAt`（按文件创建时间）或 `locale`（按标题中文排序） |
| `sidebar.expandMode` | string | `"all"` | 目录展开方式：`all`（展开所有）或 `accordion`（手风琴，同时只展开一个） |
| `sidebar.indent` | number | `12` | 每级导航缩进（像素），范围 0-48 |

同级节点先比较 front matter 的 `order`；`order` 相同时目录排在文件前面；只有顺序和类型都相同，才使用全局排序方式。`createdAt` 使用文件系统创建时间，无法取得时依次回退到变更时间和修改时间。

`expandMode` 详细说明：

| 值 | 是否默认 | 行为 |
| --- | --- | --- |
| `all` | 是 | 初始状态展开所有目录；点击目录标题仍可单独收起或展开 |
| `accordion` | 否 | 同一层级同时只展开一个目录；展开目录时会收起同级目录，当前文档所在的父级路径会保持展开 |

未填写、填写空字符串或使用其他值时，服务端会回退为 `all`。

### 图标策略

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `sidebar.iconStrategy` | string | `"default"` | 图标策略：`default`、`modern` 或 `mixed` |
| `sidebar.iconColor` | string | `""` | 强制所有图标使用单色（覆盖 `iconStrategy` 和 `iconPalette`） |
| `sidebar.iconPalette` | array | `["#3370ff", "#7c3aed", "#0f9d8a", "#d97706", "#d95850"]` | 顶级多彩图标的颜色组合，策略会稳定选择最多 3 种颜色生成渐变 |
| `sidebar.defaultFolderIcon` | string | `"folder"` | 目录默认图标 |
| `sidebar.defaultFileIcon` | string | `"file-markdown"` | 文件默认图标 |

`iconStrategy` 详细说明：

| 策略 | 顶级目录 | 顶级文件 | 子级目录 | 子级文件 |
| --- | --- | --- | --- | --- |
| `default` | 单色文件夹 | 单色文件 | 单色文件夹 | 单色文件 |
| `modern` | 多彩图标 | 多彩图标 | 单色图标 | 单色图标 |
| `mixed` | 多彩文件夹 | 多彩图标 | 单色文件夹 | 多彩/单色图标 |

### 图标映射

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `sidebar.icons` | object | 目录或文件的图标映射（如 `"api": "code-2"`） |
| `sidebar.folderIcons` | object | 目录专用图标映射 |
| `sidebar.fileIcons` | object | 文件专用图标映射 |

图标优先级（从高到低）：

1. 带扩展名的类型专用映射（`fileIcons`）
2. 带扩展名的通用映射（`icons`）
3. 去掉扩展名的类型专用映射
4. 去掉扩展名的通用映射
5. front matter 的 `icon`
6. 类型默认图标（`defaultFileIcon` / `defaultFolderIcon`）
7. `iconStrategy`

路径使用 `/`，不要以 `/` 开头。

示例：

```json
{
  "sidebar": {
    "sort": "createdAt",
    "iconStrategy": "modern",
    "expandMode": "accordion",
    "indent": 12,
    "iconColor": "",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a"],
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "getting-started": "rocket",
      "api": "code-2",
      "components/button.md": "mouse-pointer-2"
    },
    "folderIcons": {
      "api": "folder-tree"
    },
    "fileIcons": {
      "api/search.md": "search"
    }
  }
}
```

## 内置图标

当前内置 **102** 个图标。配置文件中的 `icon`、`defaultFileIcon`、`defaultFolderIcon` 和 `sidebar.icons` 均可使用以下名称。

文档正文也可以使用 `:icon[图标名称]` 展示内置图标，例如 `:icon[rocket]` 会显示为：:icon[rocket]。图标名称仍然需要使用下面清单中的有效名称；这个写法在代码块和行内代码中不会被替换。

### 文档与目录

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[file-text] | `file-text` | :icon[file] | `file` |
| :icon[file-plus] | `file-plus` | :icon[file-code] | `file-code` |
| :icon[file-markdown] | `file-markdown` | :icon[file-check] | `file-check` |
| :icon[file-cog] | `file-cog` | :icon[file-search] | `file-search` |
| :icon[file-heart] | `file-heart` | :icon[file-warning] | `file-warning` |
| :icon[file-lock] | `file-lock` | :icon[folder] | `folder` |
| :icon[folder-open] | `folder-open` | :icon[folder-plus] | `folder-plus` |
| :icon[folder-tree] | `folder-tree` | :icon[folder-cog] | `folder-cog` |
| :icon[folder-search] | `folder-search` | :icon[folder-check] | `folder-check` |
| :icon[folder-git-2] | `folder-git-2` | :icon[folder-heart] | `folder-heart` |
| :icon[folder-key] | `folder-key` | :icon[home] | `home` |
| :icon[bookmark] | `bookmark` | :icon[archive] | `archive` |
| :icon[package] | `package` | :icon[rocket] | `rocket` |
| :icon[blocks] | `blocks` | :icon[layout-dashboard] | `layout-dashboard` |
| :icon[list] | `list` | :icon[table] | `table` |

### 开发与配置

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[book-open] | `book-open` | :icon[code-2] | `code-2` |
| :icon[terminal] | `terminal` | :icon[braces] | `braces` |
| :icon[layers] | `layers` | :icon[network] | `network` |
| :icon[workflow] | `workflow` | :icon[component] | `component` |
| :icon[brackets] | `brackets` | :icon[binary] | `binary` |
| :icon[cpu] | `cpu` | :icon[wrench] | `wrench` |
| :icon[tool-case] | `tool-case` | :icon[settings] | `settings` |
| :icon[database] | `database` | :icon[server] | `server` |
| :icon[cloud] | `cloud` | :icon[box] | `box` |
| :icon[sliders-horizontal] | `sliders-horizontal` | :icon[filter] | `filter` |
| :icon[search] | `search` |  |  |

### 内容与产品

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[mouse-pointer-2] | `mouse-pointer-2` | :icon[pencil-line] | `pencil-line` |
| :icon[zap] | `zap` | :icon[monitor] | `monitor` |
| :icon[smartphone] | `smartphone` | :icon[map] | `map` |
| :icon[megaphone] | `megaphone` | :icon[pin] | `pin` |
| :icon[history] | `history` | :icon[circle-help] | `circle-help` |
| :icon[bookmark-check] | `bookmark-check` | :icon[book-marked] | `book-marked` |
| :icon[newspaper] | `newspaper` | :icon[scroll-text] | `scroll-text` |
| :icon[notebook-tabs] | `notebook-tabs` | :icon[text] | `text` |
| :icon[graduation-cap] | `graduation-cap` | :icon[palette] | `palette` |
| :icon[sparkles] | `sparkles` | :icon[flag] | `flag` |

### 通信与链接

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[github] | `github` | :icon[globe-2] | `globe-2` |
| :icon[link] | `link` | :icon[download] | `download` |
| :icon[mail] | `mail` | :icon[message-circle] | `message-circle` |
| :icon[bell] | `bell` | :icon[user] | `user` |
| :icon[users] | `users` | :icon[calendar] | `calendar` |
| :icon[clock] | `clock` | :icon[upload] | `upload` |

### 状态与媒体

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[check] | `check` | :icon[check-circle] | `check-circle` |
| :icon[x-circle] | `x-circle` | :icon[info] | `info` |
| :icon[alert-triangle] | `alert-triangle` | :icon[shield-check] | `shield-check` |
| :icon[lock] | `lock` | :icon[eye] | `eye` |
| :icon[star] | `star` | :icon[heart] | `heart` |
| :icon[tag] | `tag` | :icon[image] | `image` |
| :icon[copy] | `copy` |  |  |

### 界面操作

| 预览 | 名称 | 预览 | 名称 |
| --- | --- | --- | --- |
| :icon[sun] | `sun` | :icon[moon] | `moon` |
| :icon[chevron-down] | `chevron-down` | :icon[chevron-right] | `chevron-right` |
| :icon[arrow-right] | `arrow-right` | :icon[external-link] | `external-link` |
