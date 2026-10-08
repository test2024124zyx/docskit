---
title: 获取 llms 全文
description: 获取站点所有可见文档的 Markdown 正文集合。
order: 4
icon: book-open
---

# 获取 llms 全文

## 1. 接口基本信息

- **接口路径**：`GET /llms-full.txt`
- **接口描述**：返回所有可见文档的标题、来源页面和 Markdown 正文，不含 front matter。
- **认证方式、权限要求**：无，仅公开可见文档。
- **作用范围**：动态服务当前有效索引；静态部署中为构建时生成的文件。

## 2. 请求规范

无路径参数、查询参数、请求体或必填请求头。

## 3. 成功响应规范

HTTP `200`，`Content-Type: text/plain; charset=utf-8`。动态服务使用 `Cache-Control: no-cache, must-revalidate`；静态部署的缓存由托管服务器决定。

响应使用 Markdown 文本，按文档顺序拼接标题、来源和正文。API 页面还会附带完整 OpenAPI 合同的 JSON 代码块，避免遗漏参数和模型。隐藏文档和内部文件元数据不会包含在内。没有 JSON 包装或业务码；大站点建议先读[llms 索引](llms-index.md)，再按需读取单篇正文。

## 4. 失败响应与错误码

动态服务失败时返回 JSON `{ "error": "错误信息" }`：索引约束错误为 HTTP `422`，首次加载无效配置为 `503`，其他内部错误为 `500`。检查文档目录、配置和服务日志；已有有效索引时保留旧内容。静态站点的错误响应由托管服务器决定。

## 5. 调用示例

```bash
curl http://localhost:3000/llms-full.txt
```
