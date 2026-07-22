---
name: docskit-doc-writing
description: 仅在用户明确要求编写、修改或审校适合 DocsKit/DocKit 平台的文档时使用；用于创建符合 DocsKit 文档规则的 .md/.markdown 文档，并在该文档需求明确要求时设置 front matter 或 docs.config.json。普通 Markdown、其他文档平台、代码注释或一般配置任务不触发本 skill。
---

# DocsKit 文档编写

使用本 skill 的前提是用户明确提出 DocsKit/DocKit 平台文档目标。满足前提后，按照 DocsKit 支持的 Markdown、front matter 和站点配置规则完成文档。以项目已有文档和本 skill 的参考文件为准，不把其他 Markdown 引擎的语法默认当成 DocsKit 支持的语法。

## 触发边界

- **应当触发**：用户明确提到 DocsKit 或 DocKit，并要求编写、修改、迁移、审校或补充一篇适配该平台的文档。
- **不要触发**：用户只说“写一篇 Markdown”、只要求修改 README、指定其他文档平台，或只要求一般 JSON/站点配置而没有明确的 DocsKit 文档目标。
- 用户明确调用 `$docskit-doc-writing` 时可以使用本 skill；除此之外不要把项目目录、文件扩展名或普通 Markdown 语境当作隐式触发依据。

## 工作流程

1. **确认触发语境**：只有用户明确说出 DocsKit 或 DocKit，并提出适配该平台的文档目标时使用本 skill；没有明确平台目标时，不主动套用本 skill。
2. **检查项目上下文**：先定位文档目录、`docs.config.json`、目标文档的同级文档和项目写作风格，确认文档路径、父目录和导航位置。
3. **读取对应参考**：涉及 Markdown 语法时读取 [Markdown 参考](references/markdown.md)；涉及站点品牌、SEO、页脚、导航、排序、图标、缩进或展开方式时读取 [配置参考](references/configuration.md)。两者都涉及时都读取。
4. **确定文档元数据**：优先使用文件名表达稳定路径，用 front matter 表达标题、摘要、排序、图标和隐藏状态。不要用 front matter 承载未支持的嵌套 YAML 或数组。
5. **编写正文**：使用一个清晰的一级标题，按主题使用二级及以下标题；为命令、配置和接口给出可复制的 fenced code block；对站内文档使用相对 Markdown 链接，对图片使用相对资源路径。
6. **配置导航和站点**：只有在用户需要全局行为时修改 `docs.config.json`。导航顺序、图标优先级和站点元信息必须遵守 [配置参考](references/configuration.md) 中的规则。
7. **按清单校对**：检查 front matter 分隔线、字段类型、相对路径、标题层级、表格分隔线、代码围栏闭合和 JSON 格式；确认示例、链接和图片路径与文档内容一致。

## 强制约束

- 只将 `.md` 或 `.markdown` 文件作为 DocsKit 文档；不要把 `docs.config.json` 写成 Markdown。
- front matter 必须位于文件第一行，使用两个 `---` 包围；只使用 `title`、`description`、`order`、`icon`、`hidden` 五个受支持字段。
- 需要站内跳转时使用 `[文字](../path/to/page.md)`；需要显示图片时使用 `![替代文字](../assets/image.png)`。不要把本地资源写成站内文档链接。
- 需要在正文展示内置图标时使用 `:icon[图标名称]`，名称必须来自配置参考中的 102 个内置图标；不要在代码块中期待它被替换。
- 代码必须放在三个或更多反引号或波浪号围栏中，并填写有意义的语言标识；不要依赖语法高亮以外的 HTML。
- 生成表格时必须提供包含至少三个连字符的分隔行；生成任务列表时使用 `- [ ]` 或 `- [x]`。
- 不生成原生 HTML、嵌套列表、定义列表、脚注、数学公式、Mermaid/PlantUML 特殊图表、复杂 YAML、未验证的插件语法或其他参考文件未列出的扩展语法。
- 修改现有文档时保留用户已有内容、链接和元数据；只有用户明确要求时才调整导航排序、站点配置或文件路径。

## 写作模板

````markdown
---
title: 文档标题
description: 在导航和搜索结果中使用的一句话摘要
order: 10
icon: book-open
---

# 文档标题

用一段话说明读者完成本页内容后能得到什么。

## 前置条件

- 列出需要准备的环境或权限。

## 操作步骤

```bash
命令示例
```

## 下一步

链接到相关的 DocsKit 文档。
````

需要完整语法、块级结构、链接和资源规则时，读取 [Markdown 参考](references/markdown.md)；需要完整配置字段和 102 个图标名称时，读取 [配置参考](references/configuration.md)。右侧页面目录当前只展示二至四级标题，不要在文档中承诺一级、五级或六级标题一定出现在目录。

## 交付前清单

- 文档路径使用小写、数字和连字符等稳定命名，并符合项目既有目录结构。
- 标题、描述和文件名没有互相矛盾；同级导航的 `order` 只在确有产品顺序时设置。
- 文档内的相对链接从当前文件目录计算；本地图片路径位于文档目录范围内。
- 代码块语言标识、表格列数、列表类型和 callout 标记均符合实际解析规则。
- 没有把 Markdown 原文放入 front matter，也没有把 JSON 注释或尾逗号写入 `docs.config.json`。
- 需要全局配置的字段已经写入正确的顶级对象；没有用单篇文档的 `icon` 代替全局图标策略。
- `hidden: true` 只用于不应出现在导航和站内搜索中的文档，并确认这不是用户想公开的页面。
