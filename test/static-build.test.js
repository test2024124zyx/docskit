const assert = require("node:assert/strict");
const fsp = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildStaticSite,
  documentOutputPath,
  normalizeBase,
  normalizeSiteUrl,
  parseBuildArgs
} = require("../static-build");

async function withTempDir(callback) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "docskit-static-"));
  try {
    return await callback(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

async function writeFixture(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content);
}

function readStaticData(html) {
  const match = html.match(/<script id="docskit-static-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match, "静态页面必须注入运行数据");
  return JSON.parse(match[1]);
}

test("静态构建参数和文档页面路径保持稳定", () => {
  assert.deepEqual(parseBuildArgs(["--docs", "docs-a", "--config=config.json", "--out", "dist", "--base", "/docs/", "--site-url", "https://example.com"]), {
    docsDir: "docs-a",
    configPath: "config.json",
    outDir: "dist",
    base: "/docs/",
    siteUrl: "https://example.com"
  });
  assert.equal(normalizeBase("/docs"), "/docs/");
  assert.equal(normalizeBase("/"), "/");
  assert.equal(normalizeSiteUrl("https://example.com/"), "https://example.com");
  assert.equal(documentOutputPath("guide/intro.md"), "guide/intro.html");
  assert.equal(documentOutputPath("index.md"), "index.md.html");
  assert.throws(() => normalizeBase("docs"), /必须是以 \/ 开头/);
  assert.throws(() => normalizeSiteUrl("javascript:alert(1)"), /site-url/);
});

test("静态构建生成独立页面、离线数据、资源和安全头", async () => {
  await withTempDir(async (root) => {
    const docsDir = path.join(root, "docs");
    const outputDir = path.join(root, "site");
    await writeFixture(docsDir, "README.md", [
      "# 首页",
      "",
      "[指南](guide/intro.md)",
      "",
      "![演示](assets/demo.png)",
      "",
      "[下载](assets/manual.pdf)",
      "",
      "</script><script>alert(1)</script>"
    ].join("\n"));
    await writeFixture(docsDir, "guide/intro.md", "# 指南\n\n[首页](../README.md)\n");
    await writeFixture(docsDir, "assets/demo.png", Buffer.from([0, 1, 2, 3]));
    await writeFixture(docsDir, "assets/manual.pdf", Buffer.from("pdf"));

    const result = await buildStaticSite({
      docsDir,
      outDir: outputDir,
      base: "/docs/",
      siteUrl: "https://example.com",
      config: {
        site: {
          title: "静态<测试>站点",
          logo: "assets/demo.png",
          favicon: "assets/demo.png",
          seo: { title: "静态测试站点", description: "静态描述" }
        }
      }
    });

    assert.equal(result.documents, 2);
    assert.equal(result.base, "/docs/");
    assert.equal(result.siteUrl, "https://example.com");
    for (const relativePath of [
      "index.html",
      "README.html",
      "guide/intro.html",
      "data/documents/README.md.json",
      "data/documents/guide/intro.md.json",
      "search-index.json",
      "skills/install.md",
      "docskit-doc-writing.zip",
      "assets/assets/demo.png",
      "assets/assets/manual.pdf",
      "vendor/mermaid.min.js",
      "vendor/katex/katex.min.css",
      "robots.txt",
      "sitemap.xml",
      "_headers"
    ]) {
      await fsp.access(path.join(outputDir, relativePath));
    }

    const indexHtml = await fsp.readFile(path.join(outputDir, "index.html"), "utf8");
    const guideHtml = await fsp.readFile(path.join(outputDir, "guide/intro.html"), "utf8");
    const documentJson = await fsp.readFile(path.join(outputDir, "data/documents/README.md.json"), "utf8");
    const installGuide = await fsp.readFile(path.join(outputDir, "skills/install.md"), "utf8");
    const skillArchive = await fsp.readFile(path.join(outputDir, "docskit-doc-writing.zip"));
    const searchIndex = JSON.parse(await fsp.readFile(path.join(outputDir, "search-index.json"), "utf8"));
    const staticData = readStaticData(indexHtml);

    assert.match(indexHtml, /href="\/docs\/styles\.css"/);
    assert.match(indexHtml, /href="\/docs\/vendor\/katex\/katex\.min\.css"/);
    assert.match(indexHtml, /src="\/docs\/script\.js"/);
    const staticDataPosition = indexHtml.indexOf('<script id="docskit-static-data"');
    const runtimeScriptPosition = indexHtml.indexOf('<script src="/docs/script.js"');
    assert.ok(staticDataPosition >= 0 && staticDataPosition < runtimeScriptPosition, "静态数据必须先于运行时脚本注入");
    assert.match(indexHtml, /href="\/docs\/guide\/intro\.html"/);
    assert.match(indexHtml, /src="\/docs\/assets\/assets\/demo\.png"/);
    assert.doesNotMatch(indexHtml, /(?:href|src)="\/docs\/api\/(?:bootstrap|document|search|asset|download)/);
    assert.doesNotMatch(documentJson, /(?:href|src)="\/api\/(?:bootstrap|document|search|asset|download)/);
    assert.match(installGuide, /docskit-doc-writing\.zip/);
    assert.equal(skillArchive.subarray(0, 2).toString(), "PK");
    assert.doesNotMatch(indexHtml, /<\/script><script>alert/);
    assert.ok(indexHtml.includes("\\u003c测试\\u003e"));
    assert.match(guideHtml, /href="\/docs\/styles\.css"/);
    assert.equal(staticData.staticBuild.documentUrls["guide/intro.md"], "/docs/guide/intro.html");
    assert.equal(staticData.currentDocument.path, "README.md");
    assert.equal(searchIndex.documents.length, 2);
    assert.ok(searchIndex.documents.find((document) => document.path === "README.md").searchText.includes("首页"));

    const robots = await fsp.readFile(path.join(outputDir, "robots.txt"), "utf8");
    const sitemap = await fsp.readFile(path.join(outputDir, "sitemap.xml"), "utf8");
    const headers = await fsp.readFile(path.join(outputDir, "_headers"), "utf8");
    assert.match(robots, /Sitemap: https:\/\/example\.com\/docs\/sitemap\.xml/);
    assert.match(sitemap, /<loc>https:\/\/example\.com\/docs\/guide\/intro\.html<\/loc>/);
    assert.match(headers, /script-src 'none'/);
  });
});
