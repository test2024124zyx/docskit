# DocsKit 配置参考

本文件描述 `docs.config.json`、Markdown front matter 与 DocsKit 站点配置规则。配置文件使用严格 JSON，不要添加注释、尾逗号或 YAML 写法。

## 目录

- [配置文件](#配置文件)
- [完整配置示例](#完整配置示例)
- [顶层配置](#顶层配置)
- [站点品牌、资源和 SEO](#站点品牌资源和-seo)
- [页脚](#页脚)
- [顶部导航](#顶部导航)
- [侧边栏排序](#侧边栏排序)
- [侧边栏图标](#侧边栏图标)
- [图标策略](#图标策略)
- [侧边栏展开和缩进](#侧边栏展开和缩进)

## 配置文件

通常将 `docs.config.json` 放在文档目录中，与 Markdown 文档一起维护。

配置文件和文档目录的约定如下：

- `docsDir` 用于指定文档目录，相对于项目根目录。
- 如果项目已经约定了其他文档目录或配置文件位置，沿用项目现有约定。
- 配置文件只写需要覆盖的字段，保持 JSON 语法有效。

## 完整配置示例

下面的示例只使用可用字段，可以按需删减：

```json
{
  "docsDir": "docs",
  "site": {
    "brand": { "name": "Acme", "accent": "Docs" },
    "context": "开发者中心",
    "eyebrow": "DOCUMENTATION",
    "title": "Acme 开发文档",
    "description": "面向开发者的产品和接口文档。",
    "logo": { "src": "assets/logo.svg", "alt": "Acme" },
    "favicon": "assets/favicon.ico",
    "seo": {
      "title": "Acme 开发文档",
      "description": "产品使用、配置和 API 参考。",
      "keywords": ["Acme", "API", "开发文档"],
      "image": "assets/og-image.png",
      "author": "Acme",
      "robots": "index,follow",
      "canonical": "https://docs.example.com/",
      "themeColor": "#3370ff"
    },
    "footer": {
      "copyright": "© 2026 Acme",
      "icp": "ICP备案号",
      "beian": "公安备案号",
      "links": [
        { "label": "隐私政策", "href": "https://example.com/privacy", "external": true }
      ]
    }
  },
  "topbar": {
    "version": "v2.0.0",
    "search": true,
    "themeToggle": true,
    "links": [
      { "label": "快速开始", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "项目仓库", "href": "https://github.com/example/project", "icon": "github", "external": true }
    ]
  },
  "sidebar": {
    "sort": "createdAt",
    "iconStrategy": "modern",
    "expandMode": "all",
    "indent": 12,
    "iconColor": "",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a"],
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "guides": "book-open",
      "guides/writing.md": "pencil-line"
    },
    "folderIcons": {
      "api": "code-2"
    },
    "fileIcons": {
      "api/search.md": "search"
    }
  }
}
```

## 顶层配置

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `docsDir` | string | `"docs"` | 文档目录，相对于项目根目录。 |
| `site` | object | 见下文 | 品牌、资源、SEO 和页脚。 |
| `topbar` | object | `{}` | 顶部版本、链接、搜索和主题开关。 |
| `sidebar` | object | 见下文 | 排序、图标、缩进和展开模式。 |

未列出的顶层字段不会改变 DocsKit 的站点配置。缺失字段使用默认值；数组字段应直接写数组，不要写成逗号分隔字符串。

## 站点品牌、资源和 SEO

### 品牌字段

| 字段 | 类型 | 用途 |
| --- | --- | --- |
| `site.brand.name` | string | 顶部品牌名称的前半部分。 |
| `site.brand.accent` | string | 顶部品牌强调色文字的后半部分。 |
| `site.context` | string | 顶部品牌右侧的站点上下文，例如“知识库”。 |
| `site.eyebrow` | string | 侧边栏标题上方的小标题。 |
| `site.title` | string | 侧边栏站点标题，也是 SEO 标题的后备值。 |
| `site.description` | string | 站点默认描述，也是页面 SEO 描述的后备值。 |

使用对象形式配置品牌：

```json
{
  "site": {
    "brand": { "name": "docs", "accent": "kit" },
    "context": "知识库",
    "eyebrow": "DOCUMENTATION",
    "title": "团队文档",
    "description": "团队内部知识库"
  }
}
```

### Logo、favicon 和本地图片

`site.logo`、`site.favicon`、`site.ico` 和 `site.seo.image` 可以写字符串，也可以写 `{ "src": "...", "alt": "..." }` 或 `{ "url": "...", "alt": "..." }` 对象。

图片源的规则如下：

- `https://`、`http://`、`data:`、`blob:`、协议相对地址和以 `/` 开头的地址按原地址使用。
- 其他相对路径相对于文档目录解析，例如 `assets/logo.svg`。
- 本地图片应放在文档目录内，并使用不越出文档目录的相对路径。
- `site.logo` 显示在顶部品牌区域；有 logo 时默认品牌图形和品牌文字会被 logo 替换。
- `site.favicon` 设置浏览器标签页图标；`site.ico` 是兼容别名，只有 `favicon` 为空时才使用 `ico`。
- `site.logo` 对象的 `alt` 会作为图片替代文字；favicon 的 `alt` 不会显示。

```json
{
  "site": {
    "logo": { "src": "https://cdn.example.com/logo.svg", "alt": "产品 Logo" },
    "favicon": "assets/favicon.ico"
  }
}
```

### 默认 SEO

`site.seo` 设置整站默认元信息。打开具体文档后，文档标题和摘要优先覆盖默认标题和描述，其他 SEO 字段继续使用站点配置。

| 字段 | 类型 | 行为 |
| --- | --- | --- |
| `title` | string | 页面标题的站点部分；文档页最终标题为“文档标题 - 站点标题”。 |
| `description` | string | 默认描述；文档 front matter 的 `description` 优先。 |
| `keywords` | string 或 string[] | 关键词；数组会用逗号拼接到 meta 标签。 |
| `image` | string 或 image object | Open Graph 和 Twitter 图片。 |
| `ogImage` | string 或 image object | `image` 为空时的兼容别名。 |
| `author` | string | `author` meta 标签。 |
| `robots` | string | `robots` meta 标签；空值默认 `index,follow`。 |
| `canonical` | string | canonical URL；空值使用当前页面 URL。 |
| `themeColor` | string | 浏览器主题色 meta 标签。 |

SEO 图片为空时会退回 `site.logo`。文档页的摘要优先级为 `front matter.description`、`site.seo.description`、`site.description`。不要把单篇文档的内容摘要写进全局 SEO，除非所有页面确实共用同一描述。

## 页脚

`site.footer` 支持版权、备案信息和链接；没有任何有效内容时页脚自动隐藏。

```json
{
  "site": {
    "footer": {
      "copyright": "© 2026 Acme",
      "icp": "京ICP备00000000号",
      "beian": "京公网安备00000000000000号",
      "links": [
        { "label": "隐私政策", "href": "https://example.com/privacy", "external": true },
        { "label": "反馈邮箱", "href": "mailto:docs@example.com" }
      ]
    }
  }
}
```

`copyright`、`icp` 和 `beian` 通常使用字符串。页脚项目也接受 `{ "label": "...", "href": "..." }` 对象，`text` 可以作为 `label` 的兼容字段；有 `href` 时会渲染为链接，HTTP(S) 链接会自动按外链打开。顶层 `site.copyright`、`site.icp`、`site.beian` 是兼容后备字段，优先使用 `site.footer` 中的同名字段。

页脚链接使用 `href`，不使用 `path` 或 `doc` 做站内单页跳转；需要站内跳转时放入 `topbar.links` 或正文 Markdown 链接。

## 顶部导航

`topbar` 的字段如下：

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `version` | string | `""` | 显示版本按钮；点击后显示当前版本提示。为空时隐藏。 |
| `search` | boolean | `true` | 为 `false` 时隐藏搜索入口。 |
| `themeToggle` | boolean | `true` | 为 `false` 时隐藏浅色/深色主题切换。 |
| `links` | array | `[]` | 顶部自定义导航项目。 |

顶部链接支持以下字段：

| 字段 | 说明 |
| --- | --- |
| `label` | 链接显示文字。 |
| `path` | 站内 Markdown 相对路径，例如 `guides/writing.md`。 |
| `doc` | `path` 的兼容别名；存在 `path` 时以 `path` 为准。 |
| `href` | 外部 URL；没有 `path`/`doc` 时使用。 |
| `icon` | 102 个内置图标之一。 |
| `external` | 为 `true` 时按外链打开；HTTP(S) 地址也会自动识别为外链。 |

```json
{
  "topbar": {
    "version": "v1.4.0",
    "search": true,
    "themeToggle": false,
    "links": [
      { "label": "开始使用", "path": "getting-started/installation.md", "icon": "rocket" },
      { "label": "GitHub", "href": "https://github.com/example/project", "icon": "github", "external": true }
    ]
  }
}
```

## 侧边栏排序

`sidebar.sort` 控制同级且同类型节点的默认排序，默认值是 `createdAt`：

| 值 | 行为 |
| --- | --- |
| `createdAt` | 按文件系统创建时间排序；不可用时依次回退到变更时间和修改时间。 |
| `locale` | 按标题使用 `zh-CN` 本地化、数字感知和不区分大小写的比较。 |

以下别名也会归一化为对应模式：`created`、`creation`、`creationTime` 等价于 `createdAt`；`name`、`title`、`localeCompare` 等价于 `locale`。未知值回退到 `createdAt`。

每个同级节点的比较顺序严格是：

1. 比较 `order`，front matter 中没有 `order` 的文件和自动生成目录使用最大值。
2. `order` 相同则目录优先于文件。
3. 只有 `order` 相同且类型相同时，才使用 `sidebar.sort`。
4. `createdAt` 模式下创建时间相同时，或 `locale` 模式下直接排序时，使用中文本地化标题作为最终稳定比较。

因此，`order` 可以让文件越过默认创建时间排序；创建时间只解决同级同类型且 `order` 相同的节点。创建时间来自文件系统的 `birthtime`，不同操作系统、复制方式或版本控制检出方式可能提供不同的创建时间。

```json
{
  "sidebar": {
    "sort": "locale"
  }
}
```

## 侧边栏图标

所有图标配置都使用图标名称字符串，应从本文件末尾的清单中选择名称。

### 显式图标优先级

对一个目录或文件，图标配置按以下顺序生效，先命中的配置优先：

1. 带扩展名相对路径的类型专用映射：目录使用 `sidebar.folderIcons`，文件使用 `sidebar.fileIcons`。
2. 带扩展名相对路径的通用映射：`sidebar.icons`。
3. 去掉 `.md` 或 `.markdown` 扩展名后的类型专用映射。
4. 去掉扩展名后的通用映射。
5. 当前 Markdown 文件的 front matter `icon`。
6. 类型默认图标：目录使用 `defaultFolderIcon`，文件使用 `defaultFileIcon`。
7. `iconStrategy` 默认策略。

类型专用映射只在同一个候选路径上优先于通用映射。路径使用 `/`，不要以 `/` 开头；目录路径不带末尾 `/`。

```json
{
  "sidebar": {
    "defaultFolderIcon": "folder",
    "defaultFileIcon": "file-markdown",
    "icons": {
      "guides": "book-open",
      "guides/writing.md": "pencil-line"
    },
    "folderIcons": {
      "guides": "folder-tree"
    },
    "fileIcons": {
      "guides/writing.md": "pencil-line"
    }
  }
}
```

上例中 `guides` 目录使用 `folder-tree`，`guides/writing.md` 文件使用 `pencil-line`；它们都不会再使用 front matter 或默认策略。

如果需求是让图标出现在文档正文中，而不是改变导航图标，应使用 Markdown 扩展 `:icon[图标名称]`。例如 `:icon[rocket]` 会展示一个内置 SVG 图标，代码块和行内代码中的标记不会被替换。

### 内置图标清单

当前共有 102 个内置图标。`site` 顶部链接、`sidebar` 图标映射、`defaultFileIcon`、`defaultFolderIcon` 和 front matter `icon` 均可以使用这些名称。

| 分类 | 图标名称 |
| --- | --- |
| 文档与目录 | `file-text`、`file`、`file-plus`、`file-code`、`file-markdown`、`file-check`、`file-cog`、`file-search`、`file-heart`、`file-warning`、`file-lock`、`folder`、`folder-open`、`folder-plus`、`folder-tree`、`folder-cog`、`folder-search`、`folder-check`、`folder-git-2`、`folder-heart`、`folder-key`、`home`、`bookmark`、`archive`、`package`、`rocket`、`blocks`、`layout-dashboard`、`list`、`table` |
| 开发与配置 | `book-open`、`code-2`、`terminal`、`braces`、`layers`、`network`、`workflow`、`component`、`brackets`、`binary`、`cpu`、`wrench`、`tool-case`、`settings`、`database`、`server`、`cloud`、`box`、`sliders-horizontal`、`filter`、`search` |
| 内容与产品 | `mouse-pointer-2`、`pencil-line`、`zap`、`monitor`、`smartphone`、`map`、`megaphone`、`pin`、`history`、`circle-help`、`bookmark-check`、`book-marked`、`newspaper`、`scroll-text`、`notebook-tabs`、`text`、`graduation-cap`、`palette`、`sparkles`、`flag` |
| 通信与链接 | `github`、`globe-2`、`link`、`download`、`mail`、`message-circle`、`bell`、`user`、`users`、`calendar`、`clock`、`upload` |
| 状态与媒体 | `check`、`check-circle`、`x-circle`、`info`、`alert-triangle`、`shield-check`、`lock`、`eye`、`star`、`heart`、`tag`、`image`、`copy` |
| 界面操作 | `sun`、`moon`、`chevron-down`、`chevron-right`、`arrow-right`、`external-link` |

## 图标策略

`sidebar.iconStrategy` 支持 `default`、`modern` 和 `mixed`，默认是 `default`。没有显式图标或类型默认图标时，策略决定图标名称；已有显式名称时，策略不会替换名称，但 `modern`/`mixed` 仍可能按层级为顶级图标应用多色调色板。

| 策略 | 顶级节点 | 子级节点 |
| --- | --- | --- |
| `default` | 目录 `folder`，Markdown 文件 `file-markdown` | 目录 `folder`，Markdown 文件 `file-markdown` |
| `modern` | 目录和文件从多彩候选图标中按路径稳定选择 | 目录和文件从单色候选图标中按路径稳定选择 |
| `mixed` | 顶级目录固定 `folder` 多彩图标，顶级文件按路径选择多彩图标 | 子级目录固定 `folder` 单色图标，子级文件按路径选择单色图标 |

这里的“随机”是基于路径的稳定选择：同一个路径通常保持相同图标。顶级节点是深度 0 的根目录项或根文档，根目录下的子项属于子级节点。

### 颜色和缩进

```json
{
  "sidebar": {
    "iconStrategy": "modern",
    "iconPalette": ["#3370ff", "#7c3aed", "#0f9d8a", "#d97706"],
    "iconColor": "",
    "indent": 16
  }
}
```

- `iconPalette` 是顶级多彩图标的颜色组合数组；现代和混合策略会从中稳定选择最多 3 种颜色生成 SVG 渐变。数组中只保留非空字符串，全部为空时回退到内置调色板；少于 2 种颜色时显示为单色。
- `iconColor` 非空时覆盖所有层级和所有图标策略的颜色，包括显式图标，并强制使用单色；该值按非空字符串用于 SVG/CSS 颜色，应填写合法 CSS 颜色值。
- `indent` 是每层导航的像素缩进，默认 `12`，有效范围为 `0` 到 `48`；写入更大或更小的值会被限制。
- 未设置 `iconColor` 时，`default` 策略下显式图标和 `defaultFileIcon`/`defaultFolderIcon` 不主动着色；`modern`/`mixed` 策略下，顶级显式图标和类型默认图标可以使用 `iconPalette`，子级图标仍使用单色。

## 侧边栏展开和缩进

`sidebar.expandMode` 只接受 `all` 和 `accordion`，默认是 `all`：

```json
{
  "sidebar": {
    "expandMode": "accordion",
    "indent": 20
  }
}
```

- `all`：首次渲染时所有目录分组展开；用户仍可以手动折叠。
- `accordion`：同一层级的目录互斥展开；打开文档时会自动展开当前文档的父级路径，并折叠同级兄弟目录。
- 未知值会回退到 `all`。

站点页脚信息使用 `site.footer`；不要把页脚配置写到 `sidebar`。
