"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), crypto = require("node:crypto");
const project = path.resolve(__dirname, "..");
const { version } = require(path.join(project, "package.json"));
const config = require(path.join(project, "release.config.json"));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid version");
const download = config.greasyForkId
  ? `https://update.greasyfork.org/scripts/${config.greasyForkId}/mwi_combat_loadout_archive.user.js`
  : `https://raw.githubusercontent.com/${config.repository}/${config.branch}/${config.scriptFile}`;
const read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
const css = read("archive.css");
const header = `// ==UserScript==
// @name         MWI 战斗模拟器配装档案助手
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive
// @version      ${version}
// @author       柆雨
// @homepageURL  https://github.com/${config.repository}
// @supportURL   https://github.com/${config.repository}/issues
// @updateURL    ${download.replace(/\.user\.js$/, ".meta.js")}
// @downloadURL  ${download}
// @description  自动归档成功导入的战斗配装，支持命名、载入、回收站及 JSON 备份。仅在模拟器网站运行。
// @match        https://mwi-combatsi-mulator.pages.dev/*
// @match        https://azhu949.github.io/MWICombatSimulator/*
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==
`;
const modules = ["archive_core.js", "archive_store.js", "archive_bridge.js", "archive_app.js"];
const body = modules.map(name => {
  let source = read(name);
  if (name === "archive_app.js") source = source.replace('"__ARCHIVE_CSS__"', () => JSON.stringify(css));
  return `// ---- ${name} ----\n${source}`;
}).join("\n");
const runtime = "// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n" + body;
const output = header + runtime;
new vm.Script(output);
const loaderHeader = header
  .replace(/^\/\/ @(?:updateURL|downloadURL).*\n/gm, "")
  .replace("// @name         MWI 战斗模拟器配装档案助手", "// @name         配装助手 开发加载器")
  .replace("/loadout-archive\n", "/loadout-archive/dev\n")
  .replace("// @grant        none", "// @grant        GM_xmlhttpRequest\n// @grant        GM_addElement\n// @connect      127.0.0.1");
const loader = loaderHeader + read("dev_loader.js");
const outputs = { "mwi_combat_loadout_archive.user.js": output,
  "mwi_combat_loadout_archive.meta.js": header, "runtime.js": runtime, "mwi_combat_loadout_archive.dev.user.js": loader };
fs.mkdirSync(path.join(project, "deliverables"), { recursive: true });
for (const [name, content] of Object.entries(outputs)) {
  new vm.Script(content);
  fs.writeFileSync(path.join(project, "deliverables", name), content);
}
fs.writeFileSync(path.join(project, "deliverables", "SHA256SUMS.txt"), Object.entries(outputs)
  .map(([name, content]) => `${crypto.createHash("sha256").update(content).digest("hex")}  ${name}\n`).join(""));
console.log(`Built v${version}: ${Object.keys(outputs).join(", ")}`);

// Ordinary development builds never write immutable release archives.
if (process.env.MWI_ARCHIVE_RELEASE === "1") {
  const [major, minor] = version.split(".");
  const relative = `releases/v${major}.${minor}/mwi_combat_loadout_archive-v${version}.user.js`;
  const archive = path.join(project, relative);
  fs.mkdirSync(path.dirname(archive), { recursive: true });
  if (fs.existsSync(archive) && fs.readFileSync(archive, "utf8") !== output)
    throw new Error(`Historical release archive is immutable: ${relative}`);
  if (!fs.existsSync(archive)) fs.writeFileSync(archive, output);
  const records = [];
  for (const dir of fs.readdirSync(path.join(project, "releases"), { withFileTypes: true })) {
    if (!dir.isDirectory() || !/^v\d+\.\d+$/.test(dir.name)) continue;
    for (const file of fs.readdirSync(path.join(project, "releases", dir.name))) {
      const match = /^mwi_combat_loadout_archive-v(\d+\.\d+\.\d+)\.user\.js$/.exec(file);
      if (!match) continue;
      const content = fs.readFileSync(path.join(project, "releases", dir.name, file));
      records.push({ version: match[1], path: `releases/${dir.name}/${file}`, sizeBytes: content.length,
        sha256: crypto.createHash("sha256").update(content).digest("hex") });
    }
  }
  records.sort((a,b) => { const av=a.version.split(".").map(Number), bv=b.version.split(".").map(Number);
    return av[0]-bv[0] || av[1]-bv[1] || av[2]-bv[2]; });
  fs.writeFileSync(path.join(project, "releases/manifest.json"), JSON.stringify({ schemaVersion: 1,
    artifactType: "tampermonkey-userscript", policy: "append-only", releases: records }, null, 2) + "\n");
}
