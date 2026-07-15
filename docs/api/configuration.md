---
title: 配置文件
description: 通过 docs/docs.config.json 配置站点品牌、顶部导航和侧边栏图标。
order: 1
icon: settings
---

# 配置文件

默认配置文件为 `docs/docs.config.json`，它和 Markdown 文档一起放在文档目录中。服务启动时会优先读取 `--config` 或 `DOCS_CONFIG` 指定的文件，否则读取文档目录下的 `docs.config.json`。

配置文件可以只写需要覆盖的字段。文件不存在、JSON 无效或字段缺失时，服务会合并默认配置继续运行；顶部自定义导航默认为空，未指定的文件和目录图标会按路径稳定选择内置图标。

`docsDir` 使用相对于项目根目录的路径，命令行参数 `--docs` 和环境变量 `DOCS_DIR` 的优先级高于配置文件中的同名字段。

## 顶部导航

`topbar.links` 中的项目可以使用 `path` 跳转到 Markdown 文档，也可以用 `href` 指向外部页面。每个项目的 `icon` 会显示在链接左侧。

## 侧边栏图标

`sidebar.icons` 的键可以是目录路径或文件路径：

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

精确的文件路径优先于目录路径，未配置的项目使用默认图标；未配置默认图标时会使用按路径稳定选择的内置图标。

## 全部内置图标

当前内置 **62** 个图标。配置文件中的 `icon`、`defaultFileIcon`、`defaultFolderIcon` 和 `sidebar.icons` 均可使用以下名称：

| 分类 | 图标名称 |
| --- | --- |
| 文档与目录 | `file-text`、`file`、`file-plus`、`file-code`、`folder`、`folder-open`、`folder-plus`、`home`、`bookmark`、`archive`、`package`、`rocket`、`blocks`、`layout-dashboard`、`list`、`table` |
| 开发与配置 | `book-open`、`code-2`、`terminal`、`braces`、`mouse-pointer-2`、`pencil-line`、`zap`、`settings`、`database`、`server`、`cloud`、`box`、`sliders-horizontal`、`filter`、`search` |
| 通信与链接 | `github`、`globe-2`、`link`、`download`、`mail`、`message-circle`、`bell`、`user`、`users`、`calendar`、`clock`、`upload` |
| 状态与媒体 | `check`、`check-circle`、`x-circle`、`info`、`alert-triangle`、`shield-check`、`lock`、`eye`、`star`、`heart`、`tag`、`image`、`copy` |
| 界面操作 | `sun`、`moon`、`chevron-down`、`chevron-right`、`arrow-right`、`external-link` |
