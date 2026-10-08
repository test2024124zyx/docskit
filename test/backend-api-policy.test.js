"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { Writable } = require("node:stream");
const { apiConnectSources, MAX_SERVER_COMBINATIONS } = require("../server-api-policy");
const { contentSecurityPolicy } = require("../server-assets");
const { handleRequest, mergeConfig } = require("../server");

function document(spec, extra = {}) {
  return { path: "api.md", title: "接口", body: "# 接口", apiReference: { spec }, ...extra };
}

test("请求策略收集公开接口的全部环境、路径覆盖和操作覆盖并去重", () => {
  const spec = {
    servers: [{ url: "https://api.example.org/v1" }, { url: "/v1" }, { url: "../api" }],
    paths: {
      "/orders": { servers: [{ url: "https://orders.example.org:8443/v2" }], get: { servers: [{ url: "http://sandbox.example.org" }] } },
      "/users": { get: { servers: [{ url: "https://api.example.org/users" }] } }
    }
  };
  assert.deepEqual(apiConnectSources([document(spec), document({ servers: [{ url: "https://private.example.org" }] }, { hidden: true }), { path: "guide.md" }]), [
    "http://sandbox.example.org", "https://api.example.org", "https://orders.example.org:8443"
  ]);
  assert.deepEqual(apiConnectSources([]), []);
  assert.deepEqual(apiConnectSources([document({})]), []);
});

test("服务器变量按默认值和有限枚举组合展开，不放宽到任意主机", () => {
  const spec = { servers: [{
    url: "https://{region}.example.org:{port}/{version}",
    variables: {
      region: { default: "cn", enum: ["cn", "eu"] },
      port: { default: "443", enum: ["443", "8443"] },
      version: { default: "v1" }
    }
  }] };
  assert.deepEqual(apiConnectSources([document(spec)]), ["https://cn.example.org", "https://cn.example.org:8443", "https://eu.example.org", "https://eu.example.org:8443"]);
  assert.throws(() => apiConnectSources([document({ servers: [{ url: "https://{host}/", variables: { host: { default: "a", enum: Array.from({ length: MAX_SERVER_COMBINATIONS + 1 }, (_, index) => `host${index}.example.org`) } } }] })]), /组合.*上限/);
});

test("内部路径引用保持操作服务器可用，循环引用不会无限遍历", () => {
  const spec = {
    paths: { "/orders": { $ref: "#/components/pathItems/orders" }, "/loop": { $ref: "#/components/pathItems/loop" } },
    components: { pathItems: {
      orders: { get: { servers: [{ url: "https://orders.example.org" }] } },
      loop: { $ref: "#/components/pathItems/loop", servers: [{ url: "https://loop.example.org" }] }
    } }
  };
  assert.deepEqual(apiConnectSources([document(spec)]), ["https://loop.example.org", "https://orders.example.org"]);
});

test("OAuth2 明确声明的令牌和刷新来源参与权限，不信任授权跳转或动态发现来源", () => {
  const spec = {
    servers: [{ url: "https://api.example.org" }],
    components: { securitySchemes: {
      OAuth: { type: "oauth2", flows: {
        authorizationCode: { authorizationUrl: "https://login.example.org/authorize", tokenUrl: "https://auth.example.org/token", refreshUrl: "https://refresh.example.org/token", scopes: {} },
        clientCredentials: { tokenUrl: "https://auth.example.org/token", scopes: {} },
        password: { tokenUrl: "/token", refreshUrl: "../refresh", scopes: {} }
      } },
      Discovery: { type: "openIdConnect", openIdConnectUrl: "https://identity.example.org/.well-known/openid-configuration" },
      Key: { type: "apiKey", name: "token", in: "header", tokenUrl: "https://unrelated.example.org" }
    } }
  };
  assert.deepEqual(apiConnectSources([document(spec)]), ["https://api.example.org", "https://auth.example.org", "https://refresh.example.org"]);
});

test("OAuth2 内部认证引用和多个合同去重，非法令牌 URL 及来源数量超限阻止发布", () => {
  const spec = { components: { securitySchemes: {
    Alias: { $ref: "#/components/securitySchemes/OAuth" },
    OAuth: { type: "oauth2", flows: { clientCredentials: { tokenUrl: "https://auth.example.org/token", scopes: {} } } }
  } } };
  assert.deepEqual(apiConnectSources([document(spec), document(spec)]), ["https://auth.example.org"]);
  const token = spec.components.securitySchemes.OAuth.flows.clientCredentials;
  for (const value of ["file:///token", "https://user:secret@auth.example.org/token", "//auth.example.org/token", "", 42]) {
    token.tokenUrl = value;
    assert.throws(() => apiConnectSources([document(spec)]), /OpenAPI.*服务器/);
  }
  const schemes = Object.fromEntries(Array.from({ length: 129 }, (_, index) => [`oauth${index}`, {
    type: "oauth2", flows: { clientCredentials: { tokenUrl: `https://auth${index}.example.org/token`, scopes: {} } }
  }]));
  assert.throws(() => apiConnectSources([document({ components: { securitySchemes: schemes } })]), /来源超过上限/);
});

test("非法协议、凭据、未约束变量和头注入在发布之前被拒绝", () => {
  for (const url of ["javascript:alert(1)", "file:///secret", "https://user:password@example.org", "//example.org", "https://example.org\n; connect-src *", "https://{missing}.example.org"]) {
    assert.throws(() => apiConnectSources([document({ servers: [{ url }] })]), /OpenAPI.*服务器/);
  }
  for (const variable of [{ default: 42 }, { default: "api", enum: [] }, { default: "api", enum: [42] }]) {
    assert.throws(() => apiConnectSources([document({ servers: [{ url: "https://{host}.example.org", variables: { host: variable } }] })]), /OpenAPI.*服务器/);
  }
  assert.throws(() => apiConnectSources([document({ servers: [{ url: "https://[bad" }] })]), /OpenAPI.*服务器/);
});

test("完整安全策略只扩展 connect-src 并始终保留其他限制", () => {
  const policy = contentSecurityPolicy(["https://api.example.org"]);
  assert.match(policy, /connect-src 'self' https:\/\/api.example.org$/);
  assert.match(policy, /script-src 'self';/);
  assert.match(policy, /frame-ancestors 'self';/);
  assert.equal(contentSecurityPolicy(), contentSecurityPolicy([]));
  assert.doesNotMatch(policy, /connect-src[^;]*(?:https?: |\*)/);
});

test("普通文档首屏也允许稍后 SPA 导航到接口页，不从 Host 扩张请求权限", async () => {
  const documents = [{ path: "README.md", title: "概览", body: "# 概览" }, document({ servers: [{ url: "https://api.example.org/v1" }] })];
  const response = new Writable({ write(chunk, encoding, done) { done(); } });
  response.writeHead = (status, headers) => { response.statusCode = status; response.headers = headers; };
  await handleRequest({ method: "GET", url: "/?doc=README.md", headers: { host: "attacker.example" } }, response, {
    loadConfig: async () => ({ config: mergeConfig({}), docsDir: __dirname }),
    getDocumentIndex: async () => ({ documents })
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Security-Policy"], /connect-src 'self' https:\/\/api.example.org$/);
  assert.doesNotMatch(response.headers["Content-Security-Policy"], /attacker/);
});
