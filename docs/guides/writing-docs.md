---
title: 编写文档
description: 了解 Markdown 目录、标题、相对链接和 front matter 的使用方式。
order: 1
icon: pencil-line
---

# 编写文档

建议每篇文档使用一个一级标题，并用二级标题组织内容。正文中的标题会自动生成右侧目录。

## 使用 front matter

front matter 可以覆盖导航标题、摘要、排序和图标：

```md
---
title: 组件规范
description: 组件的使用方式与设计约束
order: 2
icon: blocks
---
```

配置文件中的图标优先级更高，适合由站点统一管理图标；front matter 适合文档自身携带默认信息。

## 使用相对链接

直接写 `[安装与启动](../getting-started/installation.md)`，点击后会在当前站点内切换文档，不会离开页面。

## 写作清单

- [x] 有明确的一级标题
- [x] 给关键步骤配上代码示例
- [ ] 检查文档之间的相对链接
