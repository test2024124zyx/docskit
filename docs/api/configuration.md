---
title: 配置文件
description: 通过 docs.config.json 配置站点品牌、顶部导航和侧边栏图标。
order: 1
icon: settings
---

# 配置文件

站点根目录的 `docs.config.json` 控制页面外壳，文档内容仍然只放在 `docsDir` 指向的目录中。

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

精确的文件路径优先于目录路径，未配置的项目使用默认图标。
