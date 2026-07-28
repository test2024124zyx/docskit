"use strict";

function startServer({ createServer, closeDocumentIndexWatchers, port, host, cliArgs, resolveFromRoot }) {
  const server = createServer();
  // 容器通过 HOST=0.0.0.0 监听所有网卡，本地开发仍默认只绑定回环地址。
  server.listen(port, host, () => {
    console.log(`Docs site running at http://${host}:${port}`);
    console.log(`Markdown directory: ${resolveFromRoot(cliArgs.docsDir || process.env.DOCS_DIR || "docs")}`);
  });
  const shutdown = (signal) => {
    console.log(`收到 ${signal}，正在关闭文档服务`);
    closeDocumentIndexWatchers();
    server.close(() => process.exit(0));
    const forceExitTimer = setTimeout(() => process.exit(1), 5000);
    forceExitTimer.unref();
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return server;
}

module.exports = { startServer };
