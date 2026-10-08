"use strict";

const fs = require("node:fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const bundle = fs.readFileSync(require.resolve("swagger-ui-dist/swagger-ui-bundle.js"), "utf8");
const WAIT_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 20;

function createSwaggerWindow(t, url = "https://docs.test/manual/api.html") {
  const errors = [];
  const networkRequests = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error.message));
  const window = new JSDOM('<div id="api"></div>', { url, runScripts: "outside-only", pretendToBeVisual: true, virtualConsole }).window;
  // JSDOM 缺少这些浏览器能力；保留真实组件，只补标准平台接口。
  Object.assign(window, { TextEncoder, TextDecoder, Headers, Request, Response, ReadableStream, scrollTo() {} });
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.fetch = async (input) => { networkRequests.push(String(input)); throw new Error("测试不允许访问真实网络"); };
  t.mock.method(globalThis, "fetch", window.fetch);
  window.eval(bundle);
  t.after(() => window.close());
  return { window, errors, networkRequests, container: window.document.querySelector("#api") };
}

async function waitFor(condition, message) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

function button(container, label) {
  return Array.from(container.querySelectorAll("button")).find((node) => node.textContent.trim() === label);
}

module.exports = { createSwaggerWindow, waitFor, button };
