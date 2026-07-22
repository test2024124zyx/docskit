---
title: 安装与启动
description: 使用 Node.js 启动 DocsKit，并指定文档目录和配置文件。
order: 1
icon: download
---

# 安装与启动

DocsKit 使用 Node.js 内置模块运行，不需要额外的前端构建步骤。准备 Node.js 18 或更高版本后，在项目目录执行：

```bash
npm run dev
```

默认文档目录是项目根目录下的 `docs/`，默认地址是 `http://127.0.0.1:3000`。需要使用其他目录或端口时，可以传入参数：

```bash
node server.js --docs ./my-docs --config ./my-docs/docs.config.json --port 3001
```

启动后访问 `http://127.0.0.1:3001`。`--docs` 指定文档目录，`--config` 指定配置文件，`--port` 指定端口。

也可以使用环境变量：

```bash
DOCS_DIR=./my-docs DOCS_CONFIG=./my-docs/docs.config.json npm run dev
```

三个配置项分别按以下优先级生效：文档目录为 `--docs`、`DOCS_DIR`、`docsDir`、`docs`；配置文件为 `--config`、`DOCS_CONFIG`、实际文档目录下的 `docs.config.json`；端口为 `--port`、`PORT`、`3000`。修改文档或配置后刷新页面即可看到变化。

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

文件夹会生成分组，文件会生成导航项。文件标题优先使用 front matter 的 `title`，其次使用正文标题，最后根据文件名推导。根目录下的 `README.md` 或 `index.md` 会优先作为默认页面。
