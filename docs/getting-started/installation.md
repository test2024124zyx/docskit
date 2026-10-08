---
title: 安装与启动
description: 使用 Node.js 启动 DocsKit，并指定文档目录和配置文件。
order: 1
icon: download
---

# 安装与启动

DocsKit 需要 Node.js 24.x 和 npm。服务使用 Node.js HTTP 模块，Markdown、代码高亮、数学公式、图表和写作 Skill 打包功能使用项目依赖。首次使用时先克隆仓库，再按照锁文件安装依赖：

```bash
git clone https://github.com/test2024124zyx/docskit.git
cd docskit
npm ci
npm run dev
```

`npm ci` 使用仓库内的 `package-lock.json` 安装确定版本，不会更新依赖版本。启动前会构建浏览器使用的代码高亮资源；无需单独运行前端开发服务。

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

Windows PowerShell 设置环境变量时使用：

```powershell
$env:DOCS_DIR = ".\my-docs"
$env:DOCS_CONFIG = ".\my-docs\docs.config.json"
npm run dev
```

## 检查内容并生成静态站

```bash
npm run check
npm test
npm run build -- --out ./dist --base / --site-url https://docs.mymyjd.com
```

将 `--site-url` 替换为实际站点根地址。若部署在站点子目录，例如 `/reference/`，将 `--base` 设置为 `/reference/`。构建完成后把整个 `dist/` 目录交给静态托管平台，无需运行 Node.js 服务端。

输出目录必须为空或为 DocsKit 已登记的构建产物。若旧目录来自较早版本、缺少 `.docskit-build.json`，请使用新的输出目录，验证成功后再切换部署；不要把文档源目录或存有其他文件的目录作为输出目录。静态站也会提供 Markdown 正文、`llms.txt` 和 `llms-full.txt`，用于引用可公开文档。

静态产物内的 `_headers` 需要托管平台支持。Nginx 等托管方式应显式配置安全响应头，并检查图片、附件和 SVG 响应；构建成功本身不表示托管配置已经生效。

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
