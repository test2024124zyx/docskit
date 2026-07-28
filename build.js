"use strict";

const { buildStaticSite, buildHelp, parseBuildArgs } = require("./static-build");

async function main() {
  const options = parseBuildArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${buildHelp()}\n`);
    return;
  }
  const result = await buildStaticSite(options);
  process.stdout.write(`静态站点已生成到 ${result.outputDir}，包含 ${result.documents} 篇文档和 ${result.assets} 个资源文件。\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`静态构建失败：${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
