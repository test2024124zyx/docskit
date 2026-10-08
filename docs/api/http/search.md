---
title: 查询文档
description: 检索可见文档的标题、路径、章节、正文与代码。
order: 1
icon: search
openapi: ../specs/search.yaml
---

# 查询文档

## 1. 接口基本信息

- **接口名称**：查询文档
- **接口路径**：`GET /api/search`
- **接口描述**：在可见文档中搜索关键词，返回最多 30 条结果和最佳匹配章节。动态服务提供此接口；静态站点的搜索使用本地索引。
- **认证方式、权限要求**：无，仅返回站点公开文档。
- **作用范围**：当前服务配置的文档目录。

## 2. 请求规范

无路径参数、请求体或必填请求头。

| 查询参数 | 类型 | 必填 | 默认值 | 约束 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `q` | string | 否 | 空字符串 | 最多 200 个字符 | 多个词以空白分隔，所有词必须出现在同一篇文档中；空值返回空列表 |

## 3. 成功响应规范

HTTP `200`，`Content-Type: application/json; charset=utf-8`。

| 字段 | 类型 | 必出 | 说明 |
| --- | --- | --- | --- |
| `query` | string | 是 | 原始查询字符串 |
| `results` | array | 是 | 匹配结果，标题、路径和章节优先于正文及代码 |
| `results[].path` | string | 是 | 文档相对路径 |
| `results[].title` | string | 是 | 文档标题 |
| `results[].description` | string | 是 | 文档摘要 |
| `results[].snippet` | string | 是 | 命中附近的纯文本片段 |
| `results[].score` | number | 是 | 本次查询的相关性分值，不适合跨查询比较 |
| `results[].hash` | string | 是 | 带 `#` 前缀的章节锚点，无章节时为空字符串 |
| `results[].sectionTitle` | string | 是 | 命中章节标题，无章节时为空字符串 |
| `results[].icon` | string | 否 | 展示图标 |
| `results[].iconColor` | string | 否 | 图标主色 |
| `results[].iconColors` | array | 否 | 图标配色 |

```json
{"query":"不存在的关键词","results":[]}
```

## 4. 失败响应与错误码

错误使用 HTTP 状态码与 `{ "error": "错误信息" }`，没有额外业务码。

| HTTP 状态码 | 错误信息 | 触发条件与处理 |
| --- | --- | --- |
| `400` | 搜索关键词过长 | `q` 超过 200 个字符，缩短查询 |
| `422` | 索引约束错误信息 | 目录层级、文档数量、字节预算或 API 服务器配置不合法 |
| `500` | 服务器内部错误 | 首次索引建立失败且没有可用旧索引，检查服务日志及文档配置 |
| `503` | 站点配置无效或无法读取 | 没有上一份可用配置，修复站点配置 |

## 5. 调用示例

```bash
curl --get --data-urlencode 'q=安装' http://localhost:3000/api/search
```

下方交互面板使用当前站点的 `/api/search`；仅在 DocsKit 动态服务中可直接发送。
