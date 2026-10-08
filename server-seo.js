"use strict";

function normalizeSiteUrl(value) {
  if (value === undefined || value === null || value === "") return "";
  let url;
  try { url = new URL(value); } catch { throw new Error("站点地址必须是完整的 HTTP(S) 地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("站点地址只允许不含凭据、查询参数和锚点的 HTTP(S) 地址");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  return url.href;
}

function trustedSiteOrigin(config, requestUrl) {
  if (config.site?.url) return normalizeSiteUrl(config.site.url);
  // 本地预览可以推导回环地址；公网地址必须由站点配置指定，避免信任任意 Host。
  if (requestUrl && ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname)) return `${requestUrl.origin}/`;
  return "";
}

function documentPageUrl(config, documentPath, requestUrl) {
  const siteUrl = trustedSiteOrigin(config, requestUrl);
  const url = new URL(siteUrl || "/", "http://localhost");
  if (documentPath) url.searchParams.set("doc", documentPath);
  return siteUrl ? url.href : `${url.pathname}${url.search}`;
}

function imageSource(value, options = {}) {
  const configured = value && typeof value === "object" ? value.src || value.url : value;
  const source = typeof configured === "string" ? configured.trim() : "";
  if (!source) return "";
  if (/^(?:https?:|data:|blob:|\/\/|\/)/i.test(source)) return source;
  if (typeof options.assetUrl === "function") return options.assetUrl(source);
  return `/api/asset?path=${encodeURIComponent(source)}`;
}

function seoValues(config, documentData, pageUrl, options = {}) {
  const site = config.site || {};
  const seo = site.seo && typeof site.seo === "object" ? site.seo : {};
  const brand = site.brand && typeof site.brand === "object" ? site.brand : { name: site.brand || "docs", accent: "" };
  const siteTitle = String(seo.title || site.title || `${brand.name || "docs"}${brand.accent || ""}` || "文档站点");
  // 静态构建传入具体产物 URL；动态模式根据可信站点地址生成每篇文档的地址。
  const canonical = site.url && !options.staticData
    ? documentPageUrl(config, documentData?.path)
    : String((site.url ? "" : seo.canonical) || pageUrl);
  let image = imageSource(seo.image || seo.ogImage || site.logo, options);
  if (site.url && image && !/^(?:data:|blob:)/i.test(image)) image = new URL(image, site.url).href;
  return {
    title: documentData ? `${documentData.title} - ${siteTitle}` : siteTitle,
    description: String(documentData?.description || seo.description || site.description || "Markdown 文档站点"),
    keywords: Array.isArray(seo.keywords) ? seo.keywords.filter((item) => typeof item === "string").join(", ") : String(seo.keywords || ""),
    author: String(seo.author || ""),
    robots: String(seo.robots || "index,follow"),
    themeColor: seo.themeColor || "",
    canonical,
    image,
    type: documentData ? "article" : "website",
    url: canonical
  };
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[character]));
}

function renderRobots(config, origin, options = {}) {
  const robots = String(config.site?.seo?.robots || "index,follow");
  const disallow = /noindex/i.test(robots) ? "Disallow: /\n" : "Disallow:\n";
  const base = config.site?.url || origin;
  const sitemapUrl = String(options.sitemapUrl || (base ? new URL("sitemap.xml", `${String(base).replace(/\/+$/, "")}/`).href : ""));
  return `User-agent: *\n${disallow}${sitemapUrl ? `Sitemap: ${sitemapUrl}\n` : ""}`;
}

function renderSitemap(documents, origin, options = {}) {
  const homeUrl = options.homeUrl || (origin ? `${String(origin).replace(/\/+$/, "")}/` : "/");
  const documentUrl = typeof options.documentUrl === "function"
    ? options.documentUrl
    : (document) => documentPageUrl({ site: { url: origin || "" } }, document.path);
  const entries = documents.map((document) => {
    const lastModified = new Date(document.updatedAt);
    const lastmod = Number.isNaN(lastModified.getTime()) ? "" : `<lastmod>${lastModified.toISOString()}</lastmod>`;
    return `<url><loc>${escapeXml(documentUrl(document))}</loc>${lastmod}</url>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escapeXml(homeUrl)}</loc></url>${entries}</urlset>`;
}

module.exports = { normalizeSiteUrl, trustedSiteOrigin, documentPageUrl, imageSource, seoValues, renderRobots, renderSitemap };
