"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const { buildSearchFields } = require("../content-search");
const { searchDocuments } = require("../search-core");
const { renderMarkdown } = require("../markdown");

function document(body, path = "api/payment.md", title = "支付接口") {
  return { path, title, description: "接口说明", ...buildSearchFields(body, path) };
}

test("代码里的路径、参数和错误码可以搜索，并定位到所属章节", () => {
  const body = '# 支付\n\n## 请求\n\n```bash\ncurl /v1/payments -H "Idempotency-Key: key"\n```\n\n## 错误码\n\n```json\n{"code":"PAYMENT_PENDING"}\n```';
  const item = document(body);
  for (const term of ["/v1/payments", "Idempotency-Key", "PAYMENT_PENDING"]) {
    const results = searchDocuments([item], term);
    assert.equal(results.length, 1);
    assert.ok(results[0].snippet.includes(term));
  }
  assert.equal(searchDocuments([item], "PAYMENT_PENDING")[0].hash, "#错误码");
  assert.equal(searchDocuments([item], "/v1/payments")[0].sectionTitle, "请求");
});

test("章节索引锚点与渲染一致，覆盖重名、嵌套和 Setext 标题", () => {
  const body = '# 指南\n\n## 重复\n第一章\n\n## 重复\n第二章\n\n> ### 引用标题\n> quote_term\n\n底部\n----\nfooter_term';
  const indexed = buildSearchFields(body, "guide.md");
  const rendered = renderMarkdown(body, "guide.md");
  assert.deepEqual(indexed.sections.filter((item) => item.id).map((item) => item.id), rendered.headings.map((item) => item.id));
  assert.equal(searchDocuments([document(body)], "第二章")[0].hash, "#重复-2");
});

test("代码标识保留符号，中文正文与多关键词可检索且隐藏文档不泄露", () => {
  const items = [document('## 参数\n中文错误说明\n\n```text\nuser_id <pending>\n```'), { ...document('secret'), hidden: true }];
  assert.equal(searchDocuments(items, "user_id").length, 1);
  assert.equal(searchDocuments(items, "<pending>").length, 1);
  assert.equal(searchDocuments(items, "中文 错误").length, 1);
  assert.equal(searchDocuments(items, "secret").length, 0);
  assert.equal(searchDocuments(items, "").length, 0);
});

test("标题命中优先，摘要围绕命中位置，结果数受限", () => {
  const items = [document('## 深层\n' + '普通内容 '.repeat(100) + 'needle', "body.md", "普通文档"), document('其他内容', "title.md", "needle")];
  const results = searchDocuments(items, "needle", { limit: 1 });
  assert.equal(results[0].path, "title.md");
  assert.match(searchDocuments(items.slice(0, 1), "needle")[0].snippet, /needle/);
  assert.deepEqual(searchDocuments(items, "不存在"), []);
});

test("静态浏览器和 Node 使用相同搜索核心，并兼容历史无章节索引", () => {
  const scope = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../search-core"), "utf8"), scope);
  const items = [{ path: "old.md", title: "旧文档", plainBody: "legacy token", searchText: "legacy token" }];
  assert.equal(JSON.stringify(scope.DocsKitSearch.searchDocuments(items, "token")), JSON.stringify(searchDocuments(items, "token")));
  assert.equal(searchDocuments(items, "token")[0].hash, "");
});

test("表格字段、嵌套列表及公式内容参与所属章节检索", () => {
  const body = '# 接口指南\n\n## 字段表\n\n| 字段 | 约束 |\n| --- | --- |\n| `user_id` | 必填 |\n| 状态 | active |\n\n## 步骤\n\n- 请求准备\n  - 设置 `X-Request-ID`\n\n## 公式\n\n$$\nquota_remaining = quota_total - consumed\n$$';
  const item = document(body);
  assert.equal(searchDocuments([item], "user_id")[0].hash, "#字段表");
  assert.equal(searchDocuments([item], "必填 active")[0].hash, "#字段表");
  assert.equal(searchDocuments([item], "X-Request-ID")[0].hash, "#步骤");
  assert.equal(searchDocuments([item], "quota_remaining")[0].hash, "#公式");
});
