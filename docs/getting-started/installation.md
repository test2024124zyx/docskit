---
title: 安装与启动
description: 用一条命令启动本地文档站点，并指定自己的 Markdown 目录。
order: 1
icon: download
---

# 安装与启动

站点使用 Node.js 内置 HTTP 服务，不需要构建前端工程。安装 Node.js 之后，在项目目录执行：

```bash
npm run dev
```

默认扫描 `docs/` 目录。你也可以把已有文档目录传给服务：

```bash
node server.js --docs D:/notes/product-docs --port 3001
```

启动后访问 `http://127.0.0.1:3001`。服务端每次请求都会重新读取文档索引，因此把新文件放进目录后刷新页面即可看到变化。

## 文档目录示例

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

文件夹会生成分组，文件会生成导航项。文件的第一个一级标题会作为默认标题，也可以用 front matter 覆盖。
