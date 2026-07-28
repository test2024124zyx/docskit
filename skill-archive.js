"use strict";

const fsp = require("node:fs").promises;
const path = require("node:path");
const archiver = require("archiver");
const { ROOT_DIR } = require("./server-config");

const SKILL_DIRECTORY_NAME = "docskit-doc-writing";

function skillDirectory(rootDir = ROOT_DIR) {
  return path.join(rootDir, "skills", SKILL_DIRECTORY_NAME);
}

async function createSkillArchive(rootDir = ROOT_DIR) {
  const directory = skillDirectory(rootDir);
  const stat = await fsp.stat(directory);
  if (!stat.isDirectory()) throw new Error("DocsKit 写作 skill 目录不是目录");

  return new Promise((resolve, reject) => {
    const archive = new archiver.ZipArchive({ zlib: { level: 9 } });
    const chunks = [];
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    archive.on("data", (chunk) => chunks.push(chunk));
    archive.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    archive.on("error", fail);
    archive.on("warning", (error) => {
      if (error.code === "ENOENT") fail(error);
    });

    try {
      archive.directory(directory, SKILL_DIRECTORY_NAME);
      const finalized = archive.finalize();
      if (finalized && typeof finalized.catch === "function") finalized.catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}

async function writeSkillArchive(filePath, rootDir = ROOT_DIR) {
  const archive = await createSkillArchive(rootDir);
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, archive);
  return archive.length;
}

module.exports = { createSkillArchive, skillDirectory, writeSkillArchive };
