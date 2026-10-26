"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const F = require("./fixtures.cjs");
const project = path.resolve(__dirname, "../..");
const modulePath = process.env.MWI_ARCHIVE_PLAYWRIGHT || "/Users/layu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = require(modulePath);
const bundle = path.join(project, "deliverables/mwi_combat_loadout_archive.user.js");
const base = "https://mwi-combatsi-mulator.pages.dev/";
const fixture = `<!doctype html><html class="dark" data-theme="dark" lang="zh"><head><meta charset="utf-8"><title>配装档案合成验收</title></head>
<body style="background:#0b1220;color:#e2e8f0;font:16px system-ui;margin:30px"><h1>MWI 战斗模拟器 · 合成验收页面</h1><p>此页只使用合成角色，测试不接触真实游戏。</p>
<button id="native">原生页面按钮</button><pre id="players"></pre><script>
window.fixturePlayers=Object.fromEntries(['1','2','3','4','5'].map(id=>[id,{name:'原槽位'+id}]));
window.fixtureMessages=[];window.fixtureReject=false;window.fixtureDelay=0;
document.querySelector('#players').textContent=JSON.stringify(window.fixturePlayers,null,2);
window.addEventListener('message', async event=>{
 const m=event.data;if(event.source!==window||event.origin!==location.origin||m?.channel!=='mwi-tm-bridge'||m.type!=='mwi-tm-import')return;
 window.fixtureMessages.push(m);if(window.fixtureIgnore)return;
 const ok=!window.fixtureReject;await new Promise(r=>setTimeout(r,window.fixtureDelay));
 if(ok){const p=m.payload;window.fixturePlayers[m.targetPlayerId||'1']={name:p.player?.name||p.character?.name||p.profile?.sharableCharacter?.name||p.sharableCharacter?.name};
 document.querySelector('#players').textContent=JSON.stringify(window.fixturePlayers,null,2);}
 window.postMessage({channel:'mwi-tm-bridge',type:'mwi-tm-import-result',requestId:m.requestId,ok,message:ok?'':'有未提交编辑，请先处理'},location.origin);
});</script></body></html>`;
const checks = [];
function pass(label) { checks.push(label); console.log(`PASS ${label}`); }
async function records(page) {
  return page.evaluate(async () => { const s = await MWILoadoutStore.create(); try { return await s.all(); } finally { s.close(); } });
}
async function poll(check, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for committed archive state");
}
async function count(page, n) {
  // Await IndexedDB completion in Node. A Promise-valued browser predicate can
  // itself be truthy before its asynchronous boolean result is resolved.
  await poll(async () => (await records(page)).filter(r => !r.deletedAt).length === n);
}
async function send(page, payload, requestId, extra = {}) {
  await page.evaluate(({ payload, requestId, extra }) => window.postMessage({ channel: "mwi-tm-bridge", type: "mwi-tm-import", requestId, payload, ...extra }, location.origin), { payload, requestId, extra });
}
async function fixtureContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
  await context.route("**/*", route => route.request().url().startsWith(base)
    ? route.fulfill({ contentType: "text/html", body: fixture }) : route.abort());
  await context.addInitScript({ path: bundle }); return context;
}
async function main() {
  const browser = await chromium.launch({ headless: true,
    executablePath: process.env.MWI_ARCHIVE_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  const errors = [];
  try {
    if (process.env.MWI_ARCHIVE_ONLY_LIVE !== "1") {
    const context = await fixtureContext(browser), page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "#/home");
    await page.evaluate(() => localStorage.setItem("mwi.player.data.snapshot.v1", "sentinel-native-snapshot"));
    await page.getByRole("button", { name: /^配装档案/ }).click();
    await page.getByRole("heading", { name: "把这一套配装留下来" }).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    pass("empty state, launcher and close");

    await send(page, F.current(), "capture-current"); await count(page, 1);
    assert.ok(!(await records(page))[0].payload.account);
    await send(page, F.current(), "capture-duplicate");
    await page.waitForFunction(() => document.querySelector('#mwi-loadout-archive-host').shadowRoot.querySelector('.status').textContent.includes('没有变化'));
    assert.equal((await records(page)).length, 1);
    pass("successful ACK auto archives; unchanged payload deduplicates and strips private/inventory/market data");

    await page.getByRole("button", { name: /^配装档案/ }).click();
    await page.getByRole("textbox", { name: "配装名称" }).fill("法系日常");
    await page.getByRole("button", { name: "另存为配装" }).click(); await count(page, 2);
    const updated = F.current(); updated.characterItems[0].enhancementLevel = 8;
    await send(page, updated, "capture-new-version");
    await poll(async () => (await records(page)).some(r=>r.kind==='recent'&&r.payload.characterItems?.[0].enhancementLevel===8));
    const named = (await records(page)).find(r => r.kind === "named");
    assert.equal(named.payload.characterItems[0].enhancementLevel, 0);
    pass("named copy survives newer automatic snapshot");

    await page.reload(); await page.getByRole("button", { name: /^配装档案/ }).click();
    await page.getByRole("button", { name: /法系日常.*命名配装/ }).click();
    await page.getByRole("textbox", { name: "配装名称" }).fill("法系地下城");
    await page.getByRole("button", { name: "保存名称" }).click();
    await page.getByRole("heading", { name: "法系地下城" }).waitFor();
    await page.getByRole("combobox", { name: "载入目标玩家" }).selectOption("3");
    await page.getByRole("button", { name: "载入玩家 3", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已载入玩家 3" }).waitFor();
    const state = await page.evaluate(() => ({ players: fixturePlayers, last: fixtureMessages.at(-1), original: localStorage.getItem("mwi.player.data.snapshot.v1") }));
    assert.equal(state.players[3].name, F.current().character.name); assert.equal(state.players[2].name, "原槽位2");
    assert.equal(state.original, "sentinel-native-snapshot"); assert.equal(state.last.clearOtherPlayers, undefined);
    assert.equal((await records(page)).length, 2);
    pass("reload persistence, rename, game-free restore to selected slot; no clearing or recursive save");

    await page.getByRole("button", { name: "移入回收站" }).click(); await count(page, 1);
    await page.getByRole("button", { name: "撤销删除" }).click(); await count(page, 2);
    await page.getByRole("button", { name: /法系地下城.*命名配装/ }).click();
    await page.getByRole("button", { name: "移入回收站" }).click();
    await page.getByRole("combobox", { name: "档案分类" }).selectOption("trash");
    await page.getByRole("button", { name: "恢复这份档案" }).click(); await count(page, 2);
    pass("soft delete, immediate undo and recovery after filtering");

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "备份全部" }).click();
    const download = await downloadPromise;
    const backup = fs.readFileSync(await download.path(), "utf8");
    assert.equal(JSON.parse(backup).archives.length, 2);
    const mirror = await context.newPage(); await mirror.goto(base + "#/home");
    await mirror.getByRole("button", { name: /^配装档案/ }).click();
    await mirror.getByLabel("导入 JSON 文件").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await mirror.getByRole("button", { name: "添加档案" }).click();
    await mirror.getByRole("status").filter({ hasText: "已添加 1 套" }).waitFor(); await count(mirror, 3);
    await mirror.getByLabel("导入 JSON 文件").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await mirror.getByRole("button", { name: "添加档案" }).click();
    await mirror.getByRole("status").filter({ hasText: "已添加 0 套" }).waitFor();
    pass("JSON download, full validation preview, atomic import, and repeated-backup deduplication");
    const corrupt = JSON.stringify({ version: 2, players: [F.modern().player, { invalid: true }] });
    await mirror.getByLabel("导入 JSON 文件").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(corrupt) });
    await mirror.getByRole("status").filter({ hasText: "不支持" }).waitFor(); assert.equal((await records(mirror)).length, 3);
    pass("invalid backup cannot partially write");

    await page.evaluate(() => { fixtureReject = true; }); await send(page, F.current("失败角色", 999), "reject");
    await page.getByRole("status").filter({ hasText: "导入未成功" }).waitFor(); assert.equal((await records(page)).length, 3);
    await page.evaluate(() => { fixtureReject = false; });
    await send(page, F.shared(), "team-a"); await send(page, F.modern("另一队友"), "team-b"); await count(page, 5);
    pass("failed import does not save; sequential team messages archive separately");

    const concurrent = await page.evaluate(async payload => {
      const a=await MWILoadoutStore.create(), b=await MWILoadoutStore.create();
      try {
        const newer=await MWILoadoutCore.prepare(payload,{now:200}), older={...newer,capturedAt:100};
        await Promise.all([a.autoSave(newer),b.autoSave(older)]);
        return (await b.get(newer.id)).capturedAt;
      }finally{a.close();b.close();}
    }, F.current("并发角色", 909)); assert.equal(concurrent, 200);
    const rollback = await page.evaluate(async payload => {
      const store = await MWILoadoutStore.create();
      try {
        const row = await MWILoadoutCore.prepare(payload, {id:'named:rollback-fixture',kind:'named',name:'事务回滚A'});
        let rejected = false;
        try { await store.addNamed([row,{...row,name:'事务回滚B'}]); } catch (_) { rejected=true; }
        return rejected && !(await store.get(row.id));
      } finally { store.close(); }
    }, F.modern()); assert.ok(rollback);
    await page.addScriptTag({ path: bundle });
    assert.equal(await page.locator("#mwi-loadout-archive-host").count(), 1);
    pass("cross-connection stale protection, transaction rollback and idempotent startup");

    await page.getByRole("searchbox", { name: "搜索配装或角色" }).fill("不可能匹配");
    await page.getByText("没有匹配的档案。", { exact: true }).waitFor();
    await page.getByRole("searchbox", { name: "搜索配装或角色" }).fill("");
    await page.getByRole("button", { name: /法系地下城.*命名配装/ }).click();
    await page.screenshot({ path: path.join(project, "preview/archive_desktop_dark.png") });
    await page.evaluate(() => { document.documentElement.dataset.theme="light"; document.documentElement.classList.remove("dark"); document.body.style.background="#e9eef6"; document.body.style.color="#182233"; });
    await page.screenshot({ path: path.join(project, "preview/archive_desktop_light.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(project, "preview/archive_mobile.png") });
    const fit = await page.evaluate(() => { const h=document.querySelector('#mwi-loadout-archive-host').shadowRoot; const p=h.querySelector('.panel').getBoundingClientRect(); return p.left>=0&&p.right<=innerWidth&&p.top>=0&&p.bottom<=innerHeight; }); assert.ok(fit);
    await page.getByRole("searchbox", { name: "搜索配装或角色" }).focus(); await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "关闭", exact: true }).waitFor({ state: "hidden" });
    pass("search empty state, light/dark, narrow layout fit and Escape keyboard return");

    const denied = await context.newPage();
    await denied.addInitScript(() => Object.defineProperty(window, "indexedDB", { value: undefined }));
    await denied.goto(base + "#/home"); await denied.getByRole("button", { name: /^配装档案/ }).click();
    await denied.getByRole("status").filter({ hasText: "未提供 IndexedDB" }).waitFor();
    pass("storage-unavailable state is visible and actionable");
    const wrong = await context.newPage(); await wrong.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
    await wrong.goto("https://example.test/#/home"); assert.equal(await wrong.locator("#mwi-loadout-archive-host").count(), 0);
    pass("host guard prevents running on game/unrelated pages");
    assert.deepEqual(errors, []); await context.close();
    }

    if (process.env.MWI_ARCHIVE_LIVE === "1") {
      const live = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      await live.addInitScript({ path: bundle }); const p = await live.newPage();
      await p.goto(base + "#/home", { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.getByRole("button", { name: "保存玩家配置", exact: true }).waitFor({ timeout: 45000 });
      const before = await p.evaluate(() => localStorage.getItem("mwi.player.data.snapshot.v1"));
      await send(p, F.modern("合成验收角色"), "live-synthetic"); await count(p, 1);
      await send(p, F.current("合成当前角色", 808), "live-current", { targetPlayerId: "2" }); await count(p, 2);
      await send(p, F.shared(), "live-shared", { targetPlayerId: "4" }); await count(p, 3);
      await p.waitForFunction(()=>[...document.querySelectorAll('input[aria-label="玩家"]')].some(e=>e.value==='合成当前角色'),null,{timeout:5000});
      assert.equal(await p.getByRole('textbox',{name:'玩家',exact:true}).nth(1).inputValue(), '合成当前角色');
      assert.equal(await p.getByRole('textbox',{name:'玩家',exact:true}).nth(3).inputValue(), '测试队友');
      await p.getByRole("button", { name: /^配装档案/ }).click();
      await p.getByRole("button", { name: /合成验收角色.*最近导入/ }).click();
      await p.getByRole("combobox", { name: "载入目标玩家" }).selectOption("3");
      await p.getByRole("button", { name: "载入玩家 3", exact: true }).click();
      await p.getByRole("status").filter({ hasText: "已载入玩家 3" }).waitFor({ timeout: 20000 });
      assert.equal(await p.getByRole('textbox',{name:'玩家',exact:true}).nth(2).inputValue(), '合成验收角色');
      assert.equal(await p.getByRole('textbox',{name:'玩家',exact:true}).nth(1).inputValue(), '合成当前角色');
      assert.equal(await p.evaluate(() => localStorage.getItem("mwi.player.data.snapshot.v1")), before);
      await p.screenshot({ path: path.join(project, "preview/archive_live_site.png") });
      await p.reload(); await p.getByRole("button", { name: /^配装档案/ }).click();
      await p.getByRole("button", { name: /合成验收角色.*最近导入/ }).click();
      await p.getByRole("heading", { name: "合成验收角色 · 最近导入" }).waitFor();
      await live.close(); pass("live deployed simulator accepts all three synthetic formats and targeted restore; reload persistence and native snapshot unchanged");
    }
    fs.writeFileSync(path.join(project, "preview/browser_results.json"), JSON.stringify({ date: "2026-10-26", checks,
      pageErrors: errors, realGame: false, liveSite: process.env.MWI_ARCHIVE_LIVE === "1", isolatedProfile: true }, null, 2));
    console.log(`${checks.length} browser scenarios passed; owned browser context closed.`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
