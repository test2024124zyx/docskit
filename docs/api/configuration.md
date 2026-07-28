---
title: 配置文件
description: 使用 docs.config.json 配置站点品牌、SEO、导航、排序和侧边栏图标。
order: 1
icon: settings
---

# 配置文件

默认配置文件是文档目录下的 `docs.config.json`。本项目使用 `docs/docs.config.json`。配置文件可以只写需要覆盖的字段；文件不存在、JSON 无效或字段缺失时，DocsKit 会使用默认值补齐配置。

`--config` 的优先级高于 `DOCS_CONFIG`，两者都没有设置时，配置文件位于实际文档目录下。文档目录的优先级从高到低为 `--docs`、`DOCS_DIR`、配置中的 `docsDir` 和默认值 `docs`。`docsDir` 使用相对于项目根目录的路径。

## 站点品牌、SEO 和页脚

`site.brand.name` 与 `site.brand.accent` 控制顶部品牌文字，`site.context` 显示站点上下文，`site.eyebrow` 和 `site.title` 控制侧边栏标题区域，`site.description` 是站点默认描述。

`site.logo` 支持远程图片地址、`data:` URL 和文档目录中的相对路径；对象形式可以同时提供 `src` 或 `url` 以及 `alt`。`site.favicon` 设置浏览器图标，`site.ico` 是它的兼容别名。相对图片路径必须位于文档目录内。

`site.seo` 设置整站默认 SEO 元信息：`title`、`description`、`keywords`、`author`、`robots`、`image`、`ogImage`、`canonical` 和 `themeColor`。文档的 `title` 和 `description` 会覆盖页面级标题和描述，其他字段继续使用站点默认值。

`site.footer` 支持 `copyright`、`icp`、`beian` 和 `links`。链接项目使用 `label` 和 `href`，没有 `href` 时按普通文本显示；没有任何有效内容时，页脚自动隐藏。

## 顶部导航

`topbar` 支持 `version`、`search`、`themeToggle` 和 `links`。`links` 中的项目使用 `path` 或 `doc` 跳转到站内文档，使用 `href` 跳转到外部页面；`icon` 可以使用内置图标名称。

```json
{
  "topbar": {
    "version": "v1.0.1",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "智能体", "href": "https://chat.mymyjd.com", "icon": "sparkles", "external": true },
      { "label": "免费 AI", "href": "https://aiapi.mymyjd.cn", "icon": "zap", "external": true },
      { "label": "免费代理", "href": "https://proxy.mymyjd.com", "icon": "globe-2", "external": true }
    ]
  }
}
```

## Markdown 代码块

代码块通过服务端 `highlight.js` 处理常见语言，并在页面中显示复制按钮。默认配置如下：

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

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `markdown.code.highlight` | boolean | `true` | 是否启用服务端语法高亮；未知语言或高亮失败时回退为转义纯文本。 |
| `markdown.code.lineNumbers` | boolean | `true` | 是否显示行号。行号使用独立 gutter，不会破坏跨行的高亮 token。 |
| `markdown.code.copy` | boolean | `true` | 是否在代码块顶部显示复制按钮。 |
| `markdown.code.wrap` | boolean | `false` | 是否让长代码自动换行；关闭时保留横向滚动。 |

配置值必须是布尔值，其他类型会回退到默认值。代码围栏中的语言名称仍决定高亮语言，例如 `javascript`；不支持的语言只显示转义后的原文。

## 侧边栏排序、图标和展开

`sidebar.sort` 支持 `createdAt` 和 `locale`，默认是 `createdAt`。同级节点先比较 front matter 的 `order`；`order` 相同时目录排在文件前面；只有顺序和类型都相同，才使用全局排序方式。`createdAt` 使用文件系统创建时间，无法取得时依次回退到变更时间和修改时间；`locale` 按中文本地化、数字感知且不区分大小写的标题排序。

`sidebar.iconStrategy` 支持 `default`、`modern` 和 `mixed`。默认策略使用 `folder` 和 `file-markdown`；现代策略让顶级目录和文件使用稳定选择的多彩图标，子级节点使用稳定选择的单色图标；混合策略让顶级目录固定使用多彩文件夹图标，子级目录固定使用单色文件夹图标，Markdown 文件按层级使用多彩或单色图标。

`sidebar.iconPalette` 控制顶级多彩图标使用的颜色。现代和混合策略会稳定选择最多 3 种颜色生成渐变；`sidebar.iconColor` 非空时覆盖所有层级并强制使用单色。`sidebar.indent` 控制每层导航缩进，单位是像素，有效范围为 0 到 48。

`sidebar.expandMode` 控制侧边栏目录的展开方式，可选值如下：

| 值 | 是否默认 | 行为 |
| --- | --- | --- |
| `all` | 是 | 初始状态展开所有目录；点击目录标题仍可单独收起或展开。 |
| `accordion` | 否 | 同一层级同时只展开一个目录；展开目录时会收起同级目录，当前文档所在的父级路径会保持展开。 |

未填写、填写空字符串或使用其他值时，服务端会回退为 `all`。

## 侧边栏图标

`sidebar.icons` 的键可以是目录路径或文件路径，也可以使用 `folderIcons` 和 `fileIcons` 分别为目录、文件设置映射：

```json
{
  "sidebar": {
    "sort": "createdAt",
    "iconStrategy": "default",
    "expandMode": "all",
    "indent": 12,
    "iconColor": "",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a"],
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "components": "blocks",
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

图标的优先级从高到低为：带扩展名的类型专用映射、带扩展名的通用映射、去掉扩展名的类型专用映射、去掉扩展名的通用映射、front matter 的 `icon`、类型默认图标、`iconStrategy`。路径使用 `/`，不要以 `/` 开头。

## 全部内置图标

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
