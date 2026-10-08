---
title: 获取 Markdown 正文
description: 获取一篇可见文档的 Markdown 正文，用于下载或外部阅读工具。
order: 2
icon: file-markdown
---

# 获取 Markdown 正文

## 1. 接口基本信息

- **接口路径**：`GET /api/markdown`
- **接口描述**：返回可见文档的 Markdown 正文，不含 front matter。
- **认证方式、权限要求**：无，仅允许读取可见文档。
- **作用范围**：当前动态服务的文档索引。静态部署使用生成的 `markdown/<文档路径>` 文件。

## 2. 请求规范

无路径参数、请求体或必填请求头。

| 查询参数 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `path` | string | 是 | 文档目录内的 `.md` 或 `.markdown` 文件 | 相对文档路径，不能越界 |

## 3. 成功响应规范

HTTP `200`，`Content-Type: text/markdown; charset=utf-8`，`Cache-Control: no-cache, must-revalidate`。响应为 UTF-8 Markdown 文本，没有 JSON 包装或业务码。绑定 OpenAPI 的页面会在正文后附完整合同的 JSON 代码块。

```markdown
# 文档标题

文档正文。
```

## 4. 失败响应与错误码

失败响应为 JSON：`{ "error": "错误信息" }`。

| HTTP 状态码 | 错误信息 | 触发条件与处理 |
| --- | --- | --- |
| `400` | 无效文档路径 / 只支持 Markdown 文档 | 路径越界或扩展名不合法，检查参数 |
| `404` | 文档不存在 | 文件不存在或被隐藏，不返回原文 |
| `422` | 索引约束错误信息 | 文档目录或 API 配置不符合索引约束 |
| `500` | 服务器内部错误 | 没有可用索引，检查服务日志及内容 |
| `503` | 站点配置无效或无法读取 | 没有可用配置，修复站点配置 |

## 5. 调用示例

```bash
curl --get --data-urlencode 'path=README.md' http://localhost:3000/api/markdown
```
