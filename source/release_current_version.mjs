#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const EXPECTED_BRANCH = "main";
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, "release.config.json"), "utf8"));
const EXPECTED_ORIGIN = /^(?:git@github\.com:|https:\/\/github\.com\/)LaYuDr\/mwi-combat-loadout-archive(?:\.git)?$/;
const GREASY_FORK_URL = CONFIG.greasyForkId
  ? `https://update.greasyfork.org/scripts/${CONFIG.greasyForkId}/mwi_combat_loadout_archive.user.js` : null;
const FIXED_RELEASE_PATHS = new Set([
  ".gitignore",
  ".gitattributes",
  "AGENTS.md",
  "CHANGELOG.md",
  "LICENSE",
  "README.md",
  "DESIGN.md",
  "PRODUCT.md",
  "package.json",
  "release.config.json",
  "启动开发服务.command",
  "发布当前版本.command",
  "deliverables/mwi_combat_loadout_archive.user.js",
  "deliverables/mwi_combat_loadout_archive.meta.js",
  "deliverables/mwi_combat_loadout_archive.dev.user.js",
  "deliverables/runtime.js",
  "deliverables/SHA256SUMS.txt",
  "deliverables/配装档案助手_使用说明_20261026_v01.md",
  "releases/manifest.json"
]);

export function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(value || "").trim());
  if (!match) throw new Error(`版本号必须是 X.Y.Z 格式，当前值：${value}`);
  return match.slice(1).map(Number);
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

export function bumpPatchVersion(value) {
  const [major, minor, patch] = parseSemver(value);
  return `${major}.${minor}.${patch + 1}`;
}

export function releaseArchivePath(version) {
  const [major, minor] = parseSemver(version);
  return `releases/v${major}.${minor}/mwi_combat_loadout_archive-v${version}.user.js`;
}

export function isAllowedReleasePath(file, version, tracked = false) {
  if (!tracked && /\.(?:orig|rej)$/.test(file)) return false;
  if (FIXED_RELEASE_PATHS.has(file)) return true;
  if (/^source\/[\w./-]+\.(?:js|cjs|mjs|css)$/.test(file) || /^docs\/[\w./-]+\.md$/.test(file)) return true;
    return file === releaseArchivePath(version);
}

function parseArguments(argv) {
  const options = {
    dryRun: false,
    verifyOnly: false,
    version: null,
    message: null,
    notes: null
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--verify") options.verifyOnly = true;
    else if (argument === "--version") options.version = argv[++index];
    else if (argument.startsWith("--version=")) options.version = argument.slice(10);
    else if (argument === "--message") options.message = argv[++index];
    else if (argument.startsWith("--message=")) options.message = argument.slice(10);
    else if (argument === "--notes") options.notes = argv[++index];
    else if (argument.startsWith("--notes=")) options.notes = argument.slice(8);
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  for (const key of ["version", "message", "notes"]) {
    if (options[key] === undefined) throw new Error(`参数 --${key} 缺少值`);
  }
  return options;
}

function printHelp() {
  console.log(`用法：npm run release [-- 参数]

默认行为：
  - 有可发布改动时自动递增补丁版本，例如 1.1.28 -> 1.1.29
  - 若 package.json 已手动设置为更高版本，则沿用该版本
  - 测试、构建、显式暂存、提交并推送 main
  - 验证 GitHub 远端提交和 Greasy Fork 公开版本

参数：
  --dry-run          只展示计划，不修改文件、不提交、不联网
  --version X.Y.Z    指定本次版本号
  --message TEXT     指定提交说明，默认 Release vX.Y.Z
  --notes TEXT       指定 CHANGELOG 条目
  --help             显示帮助`);
}

function run(command, args, { capture = false, allowFailure = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFailure) {
    const details = capture ? `${result.stdout || ""}${result.stderr || ""}`.trim() : "";
    throw new Error(`${command} ${args.join(" ")} 执行失败${details ? `：\n${details}` : ""}`);
  }
  return capture ? String(result.stdout || "") : result.status;
}

function git(args, options) {
  return run("git", args, options);
}

function splitZeroTerminated(value) {
  return value.split("\0").filter(Boolean);
}

function changedPaths() {
  const hasHead = git(["rev-parse", "--verify", "HEAD"], { capture: true, allowFailure: true }).trim();
  const trackedChanges = hasHead ? splitZeroTerminated(git(["diff", "--name-only", "-z", "HEAD"], { capture: true })) : [];
  const untrackedChanges = splitZeroTerminated(
    git(["ls-files", "--others", "--exclude-standard", "-z"], { capture: true })
  );
  return [...new Set([...trackedChanges, ...untrackedChanges])].sort();
}

function trackedPaths() {
  return new Set(splitZeroTerminated(git(["ls-files", "-z"], { capture: true })));
}

function stagedPaths() {
  return splitZeroTerminated(git(["diff", "--cached", "--name-only", "-z"], { capture: true }));
}

function readPackageFromDisk() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
}

function readPackageFromHead() {
  return JSON.parse(git(["show", "HEAD:package.json"], { capture: true }));
}

function writePackageVersion(version) {
  const packageJson = readPackageFromDisk();
  packageJson.version = version;
  fs.writeFileSync(path.join(ROOT, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
}

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function ensureChangelogEntry(version, notes) {
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  const changelog = fs.readFileSync(changelogPath, "utf8");
  if (changelog.includes(`## [${version}]`)) return;
  const marker = "All notable changes to this project are documented in this file.\n\n";
  if (!changelog.includes(marker)) throw new Error("CHANGELOG.md 缺少预期的顶部说明，已停止自动写入");
  const entry = `## [${version}] - ${shanghaiDate()}\n\n### Changed\n\n- ${notes || "Released the current verified source changes and regenerated userscript bundles."}\n\n`;
  fs.writeFileSync(changelogPath, changelog.replace(marker, marker + entry));
}

function hashFile(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(ROOT, file)))
    .digest("hex");
}

function historicalBundleFiles() {
  const releasesDirectory = path.join(ROOT, "releases");
  if (!fs.existsSync(releasesDirectory)) return [];
  const files = [];
  for (const directoryEntry of fs.readdirSync(releasesDirectory, { withFileTypes: true })) {
    if (!directoryEntry.isDirectory() || !/^v\d+\.\d+$/.test(directoryEntry.name)) continue;
    const directory = path.join(releasesDirectory, directoryEntry.name);
    for (const fileEntry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (fileEntry.isFile() && /^mwi_combat_loadout_archive-v\d+\.\d+\.\d+\.user\.js$/.test(fileEntry.name)) {
        files.push(path.posix.join("releases", directoryEntry.name, fileEntry.name));
      }
    }
  }
  return files.sort();
}

function snapshotHistoricalBundles(targetVersion) {
  const target = releaseArchivePath(targetVersion);
  const snapshots = new Map();
  for (const file of historicalBundleFiles()) {
    if (file !== target) snapshots.set(file, hashFile(file));
  }
  return snapshots;
}

function assertHistoricalBundlesUnchanged(snapshots) {
  const changed = [];
  for (const [file, hash] of snapshots) {
    if (!fs.existsSync(path.join(ROOT, file)) || hashFile(file) !== hash) changed.push(file);
  }
  if (changed.length) {
    throw new Error(`构建过程改写了历史版本，已停止发布：\n${changed.map((file) => `  - ${file}`).join("\n")}`);
  }
}

function extractUserscriptVersion(contents) {
  return /^\/\/ @version\s+(\d+\.\d+\.\d+)$/m.exec(contents)?.[1] || null;
}

function verifyBuild(version) {
  const currentFile = "deliverables/mwi_combat_loadout_archive.user.js";
  const legacyFile = "deliverables/mwi_combat_loadout_archive.meta.js";
  const archiveFile = releaseArchivePath(version);
  const loaderFile = "deliverables/mwi_combat_loadout_archive.dev.user.js";
  const runtimeFile = "deliverables/runtime.js";
  for (const file of [currentFile, legacyFile, archiveFile, loaderFile, runtimeFile]) {
    if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`构建缺少文件：${file}`);
  }
  for (const file of [currentFile, legacyFile, archiveFile, loaderFile]) {
    const actual = extractUserscriptVersion(fs.readFileSync(path.join(ROOT, file), "utf8"));
    if (actual !== version) throw new Error(`${file} 的版本是 ${actual || "未知"}，预期 ${version}`);
  }
  const runtime = fs.readFileSync(path.join(ROOT, runtimeFile), "utf8");
  if (!runtime.startsWith("// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n")) {
    throw new Error(`${runtimeFile} 未写入版本 ${version}`);
  }
  for (const file of [archiveFile]) {
    if (!fs.readFileSync(path.join(ROOT, currentFile)).equals(fs.readFileSync(path.join(ROOT, file)))) {
      throw new Error(`当前安装脚本与 ${file} 内容不一致`);
    }
  }
}

function upstreamState() {
  const headResult = spawnSync("git", ["rev-parse", "--verify", "HEAD"], { cwd: ROOT, encoding: "utf8" });
  if (headResult.status !== 0) return { head: null, upstream: null, ahead: 0, behind: 0 };
  const head = headResult.stdout.trim();
  const upstreamResult = spawnSync("git", ["rev-parse", "@{u}"], { cwd: ROOT, encoding: "utf8" });
  if (upstreamResult.status !== 0) throw new Error("当前分支没有上游分支，无法安全自动发布");
  const upstream = upstreamResult.stdout.trim();
  const counts = git(["rev-list", "--left-right", "--count", "@{u}...HEAD"], { capture: true })
    .trim()
    .split(/\s+/)
    .map(Number);
  return { head, upstream, behind: counts[0], ahead: counts[1] };
}

function classifyChanges(paths, version, tracked) {
  const publishable = [];
  const ignored = [];
  for (const file of paths) {
    (isAllowedReleasePath(file, version, tracked.has(file)) ? publishable : ignored).push(file);
  }
  return { publishable, ignored };
}

function printList(title, paths) {
  console.log(`\n${title}（${paths.length}）：`);
  if (!paths.length) console.log("  - 无");
  else for (const file of paths) console.log(`  - ${file}`);
}

async function fetchText(url) {
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function verifyGitHub(version) {
  const head = git(["rev-parse", "HEAD"], { capture: true }).trim();
  verifyRemoteHead(head);
  for (const file of [CONFIG.scriptFile, CONFIG.scriptFile.replace(/\.user\.js$/, ".meta.js")]) {
    const expected = fs.readFileSync(path.join(ROOT, file), "utf8");
    const actual = await fetchText(`https://raw.githubusercontent.com/${CONFIG.repository}/${head}/${file}`);
    if (expected !== actual || extractUserscriptVersion(actual) !== version) throw new Error(`GitHub 内容不一致：${file}`);
  }
  console.log(`GitHub commit、安装包和更新元数据核验通过：${head}`);
}
async function verifyGreasyFork(version, attempts = 12) {
  if (!GREASY_FORK_URL) { console.log("GF 首发入口待配置；本次只完成 GitHub 发布，不能视为 GF 已发布。"); return; }
  let lastVersion = null;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${GREASY_FORK_URL}?releaseCheck=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      lastVersion = extractUserscriptVersion(await response.text());
      console.log(`Greasy Fork 检查 ${attempt}/${attempts}：${lastVersion || "未读取到版本"}`);
      if (lastVersion === version) {
        const local = fs.readFileSync(path.join(ROOT, CONFIG.scriptFile), "utf8");
        const code = await fetchText(`${GREASY_FORK_URL}?verify=${Date.now()}`);
        const normalize = text => text.replace(/\r\n/g, "\n").replace(/^\/\/ @(?:updateURL|downloadURL).*\n/gm, "").trim();
        if (normalize(code) !== normalize(local)) throw new Error("Greasy Fork 正文与本地产物不一致");
        if (extractUserscriptVersion(await fetchText(GREASY_FORK_URL.replace(/\.user\.js$/, ".meta.js") + `?verify=${Date.now()}`)) !== version)
          throw new Error("Greasy Fork 更新元数据版本不一致");
        return;
      }
    } catch (error) {
      lastError = error;
      console.log(`Greasy Fork 检查 ${attempt}/${attempts}：${error.message}`);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => {
        setTimeout(resolve, 2500);
      });
    }
  }
  throw new Error(
    `GitHub 已推送，但 Greasy Fork 尚未显示 ${version}；最后读取到 ${lastVersion || lastError?.message || "未知状态"}`
  );
}

function verifyRemoteHead(expectedHead) {
  const output = git(["ls-remote", "origin", "refs/heads/main"], { capture: true }).trim();
  const remoteHead = output.split(/\s+/)[0];
  if (remoteHead !== expectedHead) throw new Error(`远端 main 为 ${remoteHead || "未知"}，本地提交为 ${expectedHead}`);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  process.chdir(ROOT);

  const branch = git(["branch", "--show-current"], { capture: true }).trim();
  if (branch !== EXPECTED_BRANCH) throw new Error(`只能从 ${EXPECTED_BRANCH} 发布，当前分支：${branch || "游离 HEAD"}`);
  const origin = git(["remote", "get-url", "origin"], { capture: true }).trim();
  if (!EXPECTED_ORIGIN.test(origin)) throw new Error(`origin 不是预期仓库：${origin}`);
  if (options.verifyOnly) {
    const version = readPackageFromDisk().version;
    await verifyGitHub(version); await verifyGreasyFork(version); return;
  }
  const staged = stagedPaths();
  if (staged.length) throw new Error(`开始发布前暂存区必须为空：\n${staged.map((file) => `  - ${file}`).join("\n")}`);

  const sync = upstreamState();
  if (sync.behind > 0) throw new Error(`本地落后 origin/main ${sync.behind} 个提交，请先同步后再发布`);
  const tracked = trackedPaths();
  const headVersion = sync.head ? readPackageFromHead().version : "0.0.0";
  const workingVersion = readPackageFromDisk().version;
  parseSemver(headVersion);
  parseSemver(workingVersion);

  if (sync.ahead > 0) {
    const pending = classifyChanges(changedPaths(), workingVersion, tracked).publishable;
    if (pending.length) throw new Error("本地已有未推送提交，同时还有新的可发布改动；请先处理现有提交");
    console.log(`检测到 ${sync.ahead} 个未推送提交，将继续推送当前版本 ${workingVersion}。`);
    if (options.dryRun) return;
    git(["push", "--set-upstream", "origin", EXPECTED_BRANCH]);
    const head = git(["rev-parse", "HEAD"], { capture: true }).trim();
    verifyRemoteHead(head);
    await verifyGitHub(workingVersion);
    await verifyGreasyFork(workingVersion);
    console.log(`\n发布完成：v${workingVersion} ${head.slice(0, 7)}`);
    return;
  }

  const requestedVersion = options.version ? String(options.version).trim() : null;
  if (requestedVersion) parseSemver(requestedVersion);
  let releaseVersion;
  if (requestedVersion) releaseVersion = requestedVersion;
  else if (compareSemver(workingVersion, headVersion) > 0) releaseVersion = workingVersion;
  else if (workingVersion === headVersion) releaseVersion = bumpPatchVersion(headVersion);
  else throw new Error(`package.json 版本 ${workingVersion} 不能低于 HEAD 版本 ${headVersion}`);
  if (compareSemver(releaseVersion, headVersion) <= 0) {
    throw new Error(`发布版本 ${releaseVersion} 必须高于当前 HEAD 版本 ${headVersion}`);
  }

  const before = classifyChanges(changedPaths(), releaseVersion, tracked);
  if (!before.publishable.length) {
    console.log(`没有新的可发布改动。当前 HEAD 为 v${headVersion}，将只验证远端与 Greasy Fork。`);
    printList("保留但不发布的文件", before.ignored);
    if (options.dryRun) return;
    verifyRemoteHead(sync.head);
    await verifyGreasyFork(headVersion);
    return;
  }

  console.log(`发布计划：v${headVersion} -> v${releaseVersion}`);
  console.log(`提交说明：${options.message || `Release v${releaseVersion}`}`);
  printList("当前可发布改动", before.publishable);
  printList("保留但不发布的文件", before.ignored);
  if (options.dryRun) {
    console.log("\n演练完成：没有修改文件、提交或联网。");
    return;
  }

  const historicalBundles = snapshotHistoricalBundles(releaseVersion);
  if (workingVersion !== releaseVersion) writePackageVersion(releaseVersion);
  ensureChangelogEntry(releaseVersion, options.notes);

  console.log("\n[1/6] 运行测试并构建");
  run("npm", ["run", "check"], { env: { MWI_ARCHIVE_RELEASE: "1" } });
  assertHistoricalBundlesUnchanged(historicalBundles);
  verifyBuild(releaseVersion);

  console.log("\n[2/6] 计算并显式暂存发布文件");
  const after = classifyChanges(changedPaths(), releaseVersion, trackedPaths());
  if (!after.publishable.length) throw new Error("测试构建完成后没有可提交文件");
  run("git", ["diff", "--check", "--", ...after.publishable]);
  printList("将提交的文件", after.publishable);
  printList("继续保留的文件", after.ignored);
  git(["add", "--", ...after.publishable]);
  const stagedAfter = stagedPaths();
  const unexpected = stagedAfter.filter(
    (file) => !isAllowedReleasePath(file, releaseVersion, trackedPaths().has(file))
  );
  if (unexpected.length)
    throw new Error(`暂存区出现白名单外文件：\n${unexpected.map((file) => `  - ${file}`).join("\n")}`);

  console.log("\n[3/6] 创建提交");
  git(["commit", "-m", options.message || `Release v${releaseVersion}`]);
  const head = git(["rev-parse", "HEAD"], { capture: true }).trim();

  console.log("\n[4/6] 推送 origin/main");
  git(["push", "--set-upstream", "origin", EXPECTED_BRANCH]);

  console.log("\n[5/6] 核对 GitHub 远端提交");
  verifyRemoteHead(head);

  console.log("\n[6/6] 等待 Greasy Fork 自动同步");
  await verifyGitHub(releaseVersion);
  await verifyGreasyFork(releaseVersion);
  console.log(`\n发布完成：v${releaseVersion} ${head.slice(0, 7)}`);
  console.log(`公开安装地址：${GREASY_FORK_URL}`);
}

if (path.resolve(process.argv[1] || "") === SCRIPT_PATH) {
  main().catch((error) => {
    console.error(`\n发布失败：${error.message}`);
    process.exitCode = 1;
  });
}
