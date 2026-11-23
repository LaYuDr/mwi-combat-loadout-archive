"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const { chromium } = require(process.env.MWI_ARCHIVE_PLAYWRIGHT || "/Users/layu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const root = path.resolve(__dirname, "../.."), fixture = require("./game_fixture.cjs");
const read = name => fs.readFileSync(path.join(root, "deliverables", name), "utf8");
const base = "https://www.milkywayidlecn.com/game?characterId=71", results = [];
const pass = text => { results.push(text); console.log("PASS " + text); };
async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.MWI_ARCHIVE_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, acceptDownloads: true });
    const requests = [], errors = [];
    await context.route("**/*", route => { requests.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: fixture }); });
    await context.addInitScript({ content: read("mwi_combat_loadout_archive.user.js") });
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(base);
    const host = page.locator("#mwi-loadout-scenes-host"), status = host.locator("#status"), summary = host.locator("#summary");
    await host.getByRole("heading", { name: "子方案" }).waitFor();
    const lifecycle = await page.evaluate(async () => {
      const panel = document.querySelector('[class*=LoadoutsPanel_loadoutsPanel]');
      const parent = panel.parentElement, next = panel.nextSibling;
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const present = () => Boolean(panel.querySelector('#mwi-loadout-scenes-host'));
      const results = [];
      // Start each mutation inside a frame; even a delayed poll cannot satisfy the next-frame checks reliably.
      for (const mode of ['hidden', 'style', 'ancestor', 'remove']) {
        await frame();
        if (mode === 'hidden') panel.hidden = true;
        if (mode === 'style') panel.style.display = 'none';
        if (mode === 'ancestor') parent.style.display = 'none';
        if (mode === 'remove') panel.remove();
        await frame(); results.push({ mode, closed: !present() });
        if (mode === 'hidden') panel.hidden = false;
        if (mode === 'style') panel.style.display = '';
        if (mode === 'ancestor') parent.style.display = '';
        if (mode === 'remove') parent.insertBefore(panel, next);
        await frame(); results.at(-1).opened = present();
      }
      return results;
    });
    for (const result of lifecycle) { assert.equal(result.closed, true, result.mode); assert.equal(result.opened, true, result.mode); }
    pass('native panel hide/show, ancestor visibility and removal/reinsert synchronize plugin cleanup and mounting by the next frame');
    const original = await page.evaluate(() => structuredClone(original));
    const variants = await page.evaluate(() => {
      const results = [];
      for (const mode of ['root', 'wrapped', 'container', 'modern', 'legacy', 'nonenumerable']) {
        setFiberMode(mode);
        const ctx = MWILoadoutScenes.Adapter.current();
        const ability = MWILoadoutScenes.Adapter.target(ctx, { kind: 'ability', slot: 1 });
        const trigger = MWILoadoutScenes.Adapter.target(ctx, { kind: 'food_trigger', slot: 0 });
        results.push({ mode, scope: ctx.scope, ability: ability?.classList.contains('ability'),
          trigger: trigger?.classList.contains('CombatTriggersSetting_settingButton__fixture') });
      }
      setFiberMode('missing'); let rejected = false;
      try { MWILoadoutScenes.Adapter.current(); } catch (_) { rejected = true; }
      setFiberMode('root');
      return { results, rejected, noHostMarker: !Object.getOwnPropertyNames(document.querySelector('[class*=LoadoutsPanel_loadoutsPanel]')).some(key => /^__react/.test(key)) };
    });
    assert.equal(variants.rejected, true); assert.equal(variants.noHostMarker, true);
    for (const value of variants.results) { assert.equal(value.scope, 'https://www.milkywayidlecn.com|71|12', value.mode); assert.equal(value.ability, true, value.mode); assert.equal(value.trigger, true, value.mode); }
    pass('host-marker-free current React roots, wrapped roots, container roots, modern/legacy/nonenumerable host markers all read the same native loadout and locate ability/food trigger slots');
    await page.evaluate(async () => {
      localStorage.setItem("mwi-layu:partitions:v1", "preserve"); localStorage.setItem("Edible_Tools", "preserve");
      await new Promise((resolve, reject) => { const r = indexedDB.open("mwi-loadout-archive", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("sentinels");
        r.onerror = () => reject(r.error); r.onsuccess = () => { const db = r.result, tx = db.transaction("sentinels", "readwrite");
          tx.objectStore("sentinels").put("keep-old-simulator", "existing"); tx.oncomplete = () => { db.close(); resolve(); }; }; });
    });
    async function action(name) {
      if (name === "更新") { await host.locator(".header").getByRole("button", { name, exact: true }).click(); return; }
      await host.locator('.choices [data-scene-id][aria-pressed="true"]').click({ button: "right" });
      await host.locator("#scene-menu").getByRole("button", { name: name === "导出" ? "导出全部" : name, exact: true }).click();
    }
    async function save(name) {
      await host.getByRole("button", { name: "新建子方案", exact: true }).click();
      await host.getByLabel("新子方案名称").fill(name); await host.getByRole("button", { name: "保存", exact: true }).click();
      await status.filter({ hasText: `已保存“${name}”` }).waitFor();
    }
    async function manual(raw) {
      await page.getByRole("button", { name: "模拟玩家打开原生编辑器" }).click();
      await page.getByLabel("原生配置 JSON").fill(JSON.stringify(raw));
      await page.getByRole("button", { name: "手动保存原生配置" }).click();
    }
    await save("远程单人");
    assert.equal(await host.getByRole("button", { name: "新建子方案" }).evaluate(node => node.getRootNode().activeElement === node), true);
    await host.locator(".choices [data-scene-id]").first().focus();
    await host.locator(".choices [data-scene-id]").first().press("Shift+F10");
    assert.equal(await host.locator('#scene-menu').isVisible(), true);
    await host.locator("#scene-menu button").first().press("Escape");
    assert.equal(await host.locator('#scene-menu').isVisible(), false);
    const saved = await page.evaluate(async () => (await MWILoadoutScenes.Store.list(MWILoadoutScenes.Adapter.current().scope))[0]);
    assert.deepEqual(saved.snapshot.raw, original); assert.equal(saved.name, "远程单人");
    await summary.filter({ hasText: "配装已一致" }).waitFor();
    pass("complete native snapshot retains equipment, skill order, triggers, explicit zero, empty slots and unknown extensions");
    const changed = structuredClone(original);
    [changed.abilityMap[1], changed.abilityMap[2]] = [changed.abilityMap[2], changed.abilityMap[1]];
    changed.abilityCombatTriggersMap["/abilities/shot"][0].value = 25;
    changed.consumableCombatTriggersMap["/items/yogurt"][0].value = 75;
    changed.foodItemHrids[0] = "/items/apple";
    changed.wearableMap["/item_locations/head"] = ""; changed.drinkItemHrids[0] = "/items/tea";
    await manual(changed);
    await summary.filter({ hasText: "项差异" }).waitFor();
    await page.evaluate(() => {
      const ctx = MWILoadoutScenes.Adapter.current(), root = document.getElementById('root')._reactRootContainer.current;
      const panelFiber = root.child.child, previous = panelFiber.child;
      window.fixturePickers = [];
      function picker(kind, slot, candidates) {
        const owner = MWILoadoutScenes.Adapter.target(ctx, { kind, slot });
        const ownerFiber = { stateNode: owner, memoizedProps: fixtureFibers.get(owner)?.memoizedProps, return: panelFiber, sibling: panelFiber.child };
        panelFiber.child = ownerFiber;
        const list = document.createElement('div');
        list.className = kind === 'ability' ? 'AbilitySlot_availableAbilities__fixture' : 'ItemSelector_itemList__fixture';
        const listFiber = { stateNode: list, return: ownerFiber }; ownerFiber.child = listFiber;
        for (const [index, props] of candidates.entries()) {
          const cell = document.createElement('div'); cell.textContent = kind + index; cell.style.cssText = 'display:inline-block;padding:12px';
          const fiber = { stateNode: cell, return: listFiber, child: { memoizedProps: props }, sibling: listFiber.child };
          fiber.child.return = fiber; listFiber.child = fiber; list.append(cell);
        }
        // A portal outside #root, without React DOM expandos.
        document.body.append(list); fixturePickers.push(list);
      }
      picker('ability', 1, [{ abilityHrid: '/abilities/heal' }, { abilityHrid: '/abilities/shot' }]);
      picker('equipment', 'head', [{ itemHrid: '/items/hood', enhancementLevel: 7 }, { itemHrid: '/items/hood', enhancementLevel: 8 }, { itemHrid: '/items/bow', enhancementLevel: 8 }]);
      picker('ability', 4, [{ abilityHrid: '/abilities/shot' }]);
      picker('food', 0, [{ itemHrid: '/items/apple' }, { itemHrid: '/items/yogurt' }]);
      picker('drink', 0, [{ itemHrid: '/items/tea' }, { itemHrid: '/items/coffee' }]);
      picker('food', 1, [{ itemHrid: '/items/yogurt' }]);
      window.closeFixturePickers = () => { for (const node of fixturePickers) node.remove(); panelFiber.child = previous; };
    });
    await page.waitForFunction(() => document.querySelectorAll('[data-mwi-scene-target]').length === 4);
    assert.deepEqual(await page.locator('[data-mwi-scene-target]').allTextContents(), ['ability1', 'equipment1', 'food1', 'drink1']);
    assert.equal(await page.locator('[data-mwi-scene-target]').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).outlineColor === 'rgb(112, 183, 255)')), true);
    assert.equal(await page.evaluate(() => MWILoadoutScenes.Adapter.pickerTargets(MWILoadoutScenes.Adapter.current(), [{ kind: 'food', slot: 1, to: null }]).length), 0);
    // The picker stays open while native data catches up: a trigger-only difference
    // must not keep the already-correct food candidate highlighted.
    await page.evaluate(() => { controller.props.characterLoadoutDict[12].foodItemHrids[0] = original.foodItemHrids[0]; });
    await page.waitForFunction(() => document.querySelectorAll('[data-mwi-scene-target]').length === 3);
    assert.deepEqual(await page.locator('[data-mwi-scene-target]').allTextContents(), ['ability1', 'equipment1', 'drink1']);
    await page.evaluate(() => { controller.props.characterLoadoutDict[12].foodItemHrids[0] = '/items/apple'; });
    await page.waitForFunction(() => document.querySelectorAll('[data-mwi-scene-target]').length === 4);
    await page.evaluate(() => closeFixturePickers());
    await page.waitForFunction(() => fixturePickers.every(list => !list.querySelector('[data-mwi-scene-target]')));
    pass('portal pickers highlight target skills, exact equipment, food and drinks in blue; ignore unrelated/empty targets and clear corrected food or closed pickers');
    const changes = await host.locator("li").count(); assert.ok(changes >= 6);
    assert.ok(await page.locator("[data-mwi-scene-change]").count() >= 5);
    assert.equal(await host.locator("#scene-differences").getAttribute("open"), null);
    assert.equal(await page.locator("[data-mwi-scene-marker]").count(), 5);
    assert.equal(await page.locator("button [data-mwi-scene-marker]").count(), 0);
    assert.match(await page.locator("[data-mwi-scene-marker] .target-value").allTextContents().then(texts => texts.join("")), /远程兜帽/);
    await page.evaluate(() => { window.markerNativeClicks = 0; document.querySelector('[class*=LoadoutsPanel_setup]').addEventListener('click', () => markerNativeClicks++); });
    const triggerMarker = page.locator("[data-mwi-scene-marker]").getByRole("button", { name: /^技能 1 · 触发条件/ });
    await triggerMarker.click();
    assert.equal(await page.evaluate(() => markerNativeClicks), 0);
    assert.equal(await host.locator("#scene-differences").getAttribute("open"), "");
    assert.match(await host.locator("details[open] pre").first().textContent(), /"value": 0/);
    assert.match(await host.locator("li:focus").textContent(), /技能 1 · 触发条件/);
    // Replacing native nodes with identical data must restore markers, without duplicates.
    await page.evaluate(() => paint());
    await page.waitForFunction(() => document.querySelectorAll('[data-mwi-scene-marker]').length === 5);
    assert.equal(await page.locator("[data-mwi-scene-marker]").count(), 5);
    assert.deepEqual(await page.evaluate(() => controller.props.characterLoadoutDict[12]), changed);
    pass("E layout starts collapsed; all slot/trigger targets are grouped outside native buttons, marker clicks stay local, identical-data React rerenders restore markers");
    // Native-size grids must contain their markers, including two changes in one slot.
    const compact = await page.addStyleTag({ content: '[class*=LoadoutsPanel_abilities],[class*=LoadoutsPanel_consumables]{display:grid;grid-template-columns:repeat(5,48px);gap:8px}.ability,.consumable{width:fit-content;min-width:0}' });
    assert.equal(await page.locator('[data-mwi-scene-marker]').evaluateAll(nodes => nodes.every(node => {
      const box = node.getBoundingClientRect(), slot = node.parentElement.getBoundingClientRect();
      return box.width <= slot.width + 1 && box.right <= slot.right + 1;
    })), true);
    await compact.evaluate(node => node.remove());
    await page.evaluate(() => {
      const slots = document.querySelector('[class*=LoadoutsPanel_playerModel]');
      window.missingHead = [...slots.children].find(node => node.style.gridRowStart === '1' && node.style.gridColumnStart === '2');
      missingHead.remove();
    });
    await summary.filter({ hasText: '1 项未定位' }).waitFor();
    assert.equal(await host.locator('#scene-differences').getAttribute('open'), '');
    assert.match(await host.locator('li').first().textContent(), /头部.*未定位.*远程兜帽/s);
    await page.evaluate(() => { document.querySelector('[class*=LoadoutsPanel_playerModel]').append(missingHead); });
    // The raw data is unchanged, but the missing slot has returned.
    await page.waitForFunction(() => document.querySelectorAll('[data-mwi-scene-marker]').length === 5);
    await page.waitForFunction(() => !document.querySelector('#mwi-loadout-scenes-host').shadowRoot.querySelector('#summary').textContent.includes('未定位'));
    pass('native-size grids keep marker widths contained; unavailable targets automatically expose the full fallback difference');
    await host.getByRole("button", { name: "定位头部", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => controller.props.characterLoadoutDict[12]), changed);
    pass("skill ordering, gear, drinks and skill/food trigger changes create explicit current-to-target differences and native-slot highlights without native mutations");
    fs.mkdirSync(path.join(root, ".impeccable/review"), { recursive: true });
    async function capture(width, height, filename) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      // A viewport capture at document height avoids Chromium's resized-viewport fullPage tile artifacts.
      await page.setViewportSize({ width, height: fullHeight });
      await page.evaluate(() => new Promise(resolve => { scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(resolve)); }));
      await page.screenshot({ path: path.join(root, ".impeccable/review", filename), animations: "disabled" });
      await page.setViewportSize({ width, height });
    }
    await capture(1440, 1080, "expanded.png");
    await host.locator("#scene-differences > summary").click();
    await capture(1440, 1080, "desktop.png");
    await capture(390, 844, "mobile.png");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await action('结束对比');
    assert.equal(await page.locator('[data-mwi-scene-marker]').count(), 0);
    assert.equal(await page.locator('[data-mwi-scene-change]').count(), 0);
    assert.equal(await host.locator('#scene-differences').isVisible(), false);
    await host.getByRole('button', { name: '远程单人', exact: true }).click();
    // Long names must wrap within the inherited native detail width.
    await host.getByRole("button", { name: "新建子方案" }).click();
    await host.getByLabel("新子方案名称").fill("ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(2));
    await host.getByRole("button", { name: "保存", exact: true }).click();
    await status.filter({ hasText: "已保存“ABCDEFGHIJKLMNOPQRSTUVWXYZ" }).waitFor();
    assert.equal(await host.locator(".choices").evaluate(node => node.scrollWidth <= node.clientWidth), true);
    await action("移除");
    await host.getByRole("button", { name: "移除", exact: true }).click(); await status.filter({ hasText: "已移除" }).waitFor();
    await host.getByRole("button", { name: "远程单人", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1080 });
    await manual(original); await summary.filter({ hasText: "配装已一致" }).waitFor();
    assert.equal(await page.locator("[data-mwi-scene-change]").count(), 0);
    assert.equal(await page.locator("[data-mwi-scene-marker]").count(), 0);
    await save("远程多人"); await save("远程迷宫");
    const pressTarget = host.getByRole("button", { name: "远程单人", exact: true });
    await pressTarget.dispatchEvent("pointerdown", { button: 0, isPrimary: true, clientX: 5, clientY: 5 });
    await page.waitForTimeout(600);
    await pressTarget.dispatchEvent("pointerup", { button: 0 });
    await pressTarget.dispatchEvent("click");
    assert.equal(await host.locator('#scene-menu').isVisible(), true);
    assert.equal(await host.getByRole("button", { name: "远程迷宫", exact: true }).getAttribute("aria-pressed"), "true");
    await host.locator('#scene-menu').getByRole('button', { name: '改名', exact: true }).click();
    assert.equal(await host.getByLabel('修改子方案名称').inputValue(), '远程单人');
    await host.getByRole('button', { name: '取消', exact: true }).click();
    pass('right-click and long-press target their own scene without selecting it; keyboard menu and external update remain reachable');
    const keyboardChoice = host.getByRole("button", { name: "远程单人", exact: true });
    await keyboardChoice.focus(); await keyboardChoice.press("Enter");
    assert.equal(await keyboardChoice.evaluate(node => node.getRootNode().activeElement === node), true);
    await host.getByRole("button", { name: "远程迷宫", exact: true }).click();
    await host.getByRole("button", { name: "新建子方案" }).click();
    await host.getByLabel("新子方案名称").fill("远程迷宫"); await host.getByRole("button", { name: "保存", exact: true }).click();
    await status.filter({ hasText: "已有同名" }).waitFor();
    assert.equal(await host.getByLabel("新子方案名称").inputValue(), "远程迷宫");
    assert.equal(await host.locator(".choices button[data-scene-id]").count(), 3);
    pass("manual corrections clear highlights, three named scenes coexist, and duplicate names preserve input without overwriting");
    await page.reload(); await host.locator(".choices button[data-scene-id]").filter({ hasText: "远程单人" }).waitFor();
    await host.getByRole("button", { name: "远程单人", exact: true }).click();
    await action("改名");
    await host.getByLabel("修改子方案名称").fill("远程单人·改名"); await host.getByRole("button", { name: "保存", exact: true }).click();
    await status.filter({ hasText: "已改名" }).waitFor();
    await manual(changed); await summary.filter({ hasText: "项差异" }).waitFor();
    await action("更新");
    const beforeUpdate = await page.evaluate(async () => (await MWILoadoutScenes.Store.list(MWILoadoutScenes.Adapter.current().scope)).find(row => row.name === "远程单人·改名"));
    assert.deepEqual(beforeUpdate.snapshot.raw, original);
    await host.getByRole("button", { name: "取消", exact: true }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1080 });
      const update = host.locator(".header").getByRole("button", { name: "更新", exact: true });
      await update.scrollIntoViewIfNeeded();
      const before = await update.boundingBox();
      await update.click();
      const confirmUpdate = host.locator(".header").getByRole("button", { name: "更新方案", exact: true });
      const after = await confirmUpdate.boundingBox();
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(before[key] - after[key]) < 1, `${width}px ${key}`);
      const cancelBox = await host.locator(".header").getByRole("button", { name: "取消", exact: true }).boundingBox();
      assert.ok(cancelBox.x + cancelBox.width <= after.x);
      assert.equal(await host.getByText('更新“远程单人·改名”？', { exact: true }).isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await host.screenshot({ path: path.join(root, '.impeccable/review', `update-confirm-${width}.png`) });
      await host.locator(".header").getByRole("button", { name: "取消", exact: true }).click();
    }
    await page.setViewportSize({ width: 1440, height: 1080 });
    const update = host.locator(".header").getByRole("button", { name: "更新", exact: true });
    await update.scrollIntoViewIfNeeded();
    const clickBox = await update.boundingBox();
    await page.mouse.dblclick(clickBox.x + clickBox.width / 2, clickBox.y + clickBox.height / 2, { delay: 80 });
    await host.locator(".header").getByRole("button", { name: "更新", exact: true }).waitFor();
    await summary.filter({ hasText: "配装已一致" }).waitFor();
    assert.equal(await status.isVisible(), false);
    const afterUpdate = await page.evaluate(async () => (await MWILoadoutScenes.Store.list(MWILoadoutScenes.Adapter.current().scope)).find(row => row.name === "远程单人·改名"));
    assert.deepEqual(afterUpdate.snapshot.raw, changed);
    pass("desktop/mobile update confirmation keeps the original button bounds, cancel sits to its left, and two clicks at one coordinate save the selected scene");
    await action("移除"); await host.getByRole("button", { name: "移除", exact: true }).click();
    await status.filter({ hasText: "已移除" }).waitFor(); assert.equal(await host.locator(".choices button[data-scene-id]").count(), 2);
    assert.equal(await host.getByRole("button", { name: "新建子方案" }).evaluate(node => node.getRootNode().activeElement === node), true);
    await host.getByRole("button", { name: "撤销移除", exact: true }).click(); await status.filter({ hasText: "已恢复" }).waitFor();
    assert.equal(await host.locator(".choices button[data-scene-id]").count(), 3);
    pass("reload persistence, rename, explicitly confirmed snapshot update, cancellation and reversible removal work");
    const backupEvent = page.waitForEvent("download"); await action("导出");
    const backup = fs.readFileSync(await (await backupEvent).path(), "utf8"); assert.equal(JSON.parse(backup).scenes.length, 3);
    await host.getByLabel("选择子方案备份").setInputFiles({ name: "scenes.json", mimeType: "application/json", buffer: Buffer.from(backup) });
    await status.filter({ hasText: "已导入 0" }).waitFor();
    const invalid = JSON.parse(backup); invalid.scenes[0].name = "本不应添加"; invalid.scenes[1].snapshot.raw.abilityMap = null;
    await host.getByLabel("选择子方案备份").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
    await status.filter({ hasText: "未能完整读取" }).waitFor(); assert.equal(await host.locator(".choices button[data-scene-id]").count(), 3);
    const foreign = JSON.parse(backup); foreign.scope = "other-character";
    await host.getByLabel("选择子方案备份").setInputFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(foreign)) });
    await status.filter({ hasText: "不匹配" }).waitFor();
    pass("backup download/import roundtrip deduplicates, and invalid or foreign backup cannot partially import or overwrite");
    await page.evaluate(() => { controller.props.characterLoadoutDict[13] = { ...structuredClone(original), id: 13, name: "另一父配装" }; controller.state.selectedCharacterLoadoutId = 13; paint(); });
    await host.getByText("暂无方案", { exact: true }).waitFor(); assert.equal(await host.locator(".choices button[data-scene-id]").count(), 0);
    await page.evaluate(() => { controller.state.selectedCharacterLoadoutId = 12; controller.props.characterInfo.characterID = 72; paint(); });
    await host.getByText("暂无方案", { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('#mwi-loadout-scenes-host')?.shadowRoot.querySelector('#status')?.textContent !== '读取中…');
    assert.equal(await host.locator(".choices button[data-scene-id]").count(), 0);
    await page.evaluate(() => { controller.props.characterInfo.characterID = 71; paint(); });
    await host.getByRole("button", { name: "远程迷宫", exact: true }).waitFor();
    await host.getByRole("button", { name: "远程迷宫", exact: true }).click();
    await page.evaluate(() => { delete controller.props.characterLoadoutDict[12].abilityMap; });
    await summary.filter({ hasText: "无法核对" }).waitFor(); assert.equal(await host.getByRole("button", { name: "新建子方案" }).isDisabled(), true);
    assert.equal(await page.locator("[data-mwi-scene-change]").count(), 0);
    assert.equal(await page.locator("[data-mwi-scene-marker]").count(), 0);
    await page.evaluate(() => { controller.props.characterLoadoutDict[12] = structuredClone(original); paint(); });
    await summary.filter({ hasText: "配装已一致" }).waitFor();
    assert.equal(await host.getByRole("button", { name: "新建子方案" }).isEnabled(), true);
    await page.evaluate(() => { document.querySelector('[class*=LoadoutsPanel_loadoutsPanel]').hidden = true; });
    await host.waitFor({ state: "detached" }); assert.equal(await page.locator("[data-mwi-scene-change]").count(), 0);
    assert.equal(await page.locator("[data-mwi-scene-marker]").count(), 0);
    await page.evaluate(() => { document.querySelector('[class*=LoadoutsPanel_loadoutsPanel]').hidden = false; });
    await host.getByRole("heading", { name: "子方案" }).waitFor();
    pass("parent and character isolation, temporary incomplete native data, recovery and hidden-panel cleanup work");
    const crossTab = await context.newPage(); await crossTab.goto(base);
    const secondHost = crossTab.locator("#mwi-loadout-scenes-host"); await secondHost.getByRole("button", { name: "远程迷宫", exact: true }).click();
    const stale = await crossTab.evaluate(async () => (await MWILoadoutScenes.Store.list(MWILoadoutScenes.Adapter.current().scope)).find(row => row.name === "远程迷宫"));
    await host.getByRole("button", { name: "远程迷宫", exact: true }).click();
    await action("改名"); await host.getByLabel("修改子方案名称").fill("远程迷宫·跨页");
    await host.getByRole("button", { name: "保存", exact: true }).click(); await status.filter({ hasText: "已改名" }).waitFor();
    await secondHost.getByRole("button", { name: "远程迷宫·跨页", exact: true }).waitFor();
    const staleError = await crossTab.evaluate(async old => { try { await MWILoadoutScenes.Store.mutate(MWILoadoutScenes.Adapter.current(), old, 'remove'); return ''; } catch (e) { return e.message; } }, stale);
    assert.match(staleError, /其他标签页更新/); await crossTab.close();
    assert.deepEqual(await page.evaluate(() => [localStorage.getItem("mwi-layu:partitions:v1"), localStorage.getItem("Edible_Tools"), nativeCalls]), ["preserve", "preserve", 0]);
    const old = await page.evaluate(() => new Promise(resolve => { const r = indexedDB.open("mwi-loadout-archive", 1); r.onsuccess = () => { const db = r.result, tx = db.transaction("sentinels"); const get = tx.objectStore("sentinels").get("existing"); tx.oncomplete = () => { db.close(); resolve(get.result); }; }; }));
    assert.equal(old, "keep-old-simulator"); assert.deepEqual(errors, []); assert.ok(requests.every(url => url === base));
    pass("multiple tabs synchronize and reject stale updates; existing plugin/simulator data is preserved; no native handlers or network requests invoked");
    await context.close();
    for (const url of ["https://www.milkywayidle.com/game", "https://milkywayidle.com/game", "https://milkywayidlecn.com/game"]) {
      const c = await browser.newContext(); await c.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
      await c.addInitScript({ content: read("mwi_combat_loadout_archive.user.js") }); const p = await c.newPage(); await p.goto(url);
      await p.locator("#mwi-loadout-scenes-host").waitFor(); await c.close();
    }
    const dev = await browser.newContext(); await dev.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
    await dev.addInitScript({ content: `window.devRequests=[];window.GM_xmlhttpRequest=o=>{
      devRequests.push(o.url);
      const text=o.url.startsWith('http://127.0.0.1:4178/runtime.js?') ? ${JSON.stringify(read('runtime.js'))} :
        JSON.stringify({clip_name:o.url.split('/').pop(),has_password:false,files:[],text_content:null});
      o.onload({status:200,responseText:text});
    };window.GM_addElement=(p,t,a)=>{const e=Object.assign(document.createElement(t),a);p.append(e);return e};` + read("mwi_combat_loadout_archive.dev.user.js") });
    const dp = await dev.newPage(); await dp.goto(base); await dp.locator("#mwi-loadout-scenes-host").getByRole("heading", { name: "子方案" }).waitFor();
    await dp.waitForFunction(() => devRequests.includes("https://clipboard.im/api/clipboard/71loadout12"));
    assert.equal(await dp.evaluate(() => devRequests.filter(url => url.startsWith("http://127.0.0.1:4178/runtime.js?")).length), 1);
    await dev.close();
    // Independent IndexedDB and localStorage per device; only a synthetic
    // clipboard string crosses contexts. All HTTP traffic is intercepted.
    const cloudTexts = new Map();
    async function cloudDevice() {
      const c = await browser.newContext();
      await c.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
      await c.exposeFunction("mockClipboard", (method, url, payload) => {
        assert.ok(["https://clipboard.im/api/clipboard/71loadout12", "https://clipboard.im/api/clipboard/71loadout0"].includes(url));
        if (method === "PUT") cloudTexts.set(url, JSON.parse(payload).text_content);
        else assert.equal(method, "GET");
        return { status: 200, responseText: JSON.stringify({ clip_name: url.split("/").pop(),
          has_password: false, files: [], text_content: cloudTexts.get(url) ?? null }) };
      });
      await c.addInitScript({ content: `window.GM_xmlhttpRequest=o=>window.mockClipboard(o.method,o.url,o.data).then(o.onload,o.onerror);` + read("mwi_combat_loadout_archive.user.js") });
      const p = await c.newPage(); await p.goto(base);
      await p.waitForFunction(() => ["尚无同步数据", "已同步"].some(label => window.MWILoadoutScenes?.Cloud?.status(71, 12).startsWith(label)));
      return { c, p, scene: p.locator("#mwi-loadout-scenes-host") };
    }
    const firstDevice = await cloudDevice();
    await firstDevice.scene.getByRole("button", { name: "新建子方案" }).click();
    await firstDevice.scene.getByLabel("新子方案名称").fill("跨设备方案");
    await firstDevice.scene.getByRole("button", { name: "保存", exact: true }).click();
    await firstDevice.scene.getByText("已保存“跨设备方案”").waitFor();
    await firstDevice.p.waitForFunction(() => window.MWILoadoutScenes.Cloud.status(71, 12).startsWith("已同步"));
    await firstDevice.p.waitForFunction(async () => {
      const response = await window.mockClipboard("GET", "https://clipboard.im/api/clipboard/71loadout12");
      return JSON.parse(response.responseText).text_content?.includes("跨设备方案");
    });
    const nextDevice = await cloudDevice();
    await nextDevice.scene.getByRole("button", { name: "跨设备方案", exact: true }).waitFor();
    const panel = nextDevice.scene.locator(".cloud-panel");
    await panel.locator(":scope > summary").click();
    assert.equal(await panel.locator("a").getAttribute("href"), "https://clipboard.im/71loadout12");
    await panel.getByText("1 个子方案 · 0 条行动选择").waitFor();
    const boardKey = "https://clipboard.im/api/clipboard/71loadout12";
    const divergent = JSON.parse(cloudTexts.get(boardKey));
    const savedScene = divergent.scenes[0];
    await nextDevice.p.evaluate(async () => {
      const app = window.MWILoadoutScenes, ctx = app.Adapter.current();
      const [scene] = await app.Store.list(ctx.scope);
      await app.Store.mutate(ctx, scene, "rename", "本机版本");
    });
    divergent.scenes = [{ ...savedScene, name: "另一设备版本", revision: require("node:crypto").randomUUID(),
      updatedAt: savedScene.updatedAt + 1, ancestors: [savedScene.revision] }];
    cloudTexts.set(boardKey, JSON.stringify(divergent));
    await panel.getByRole("button", { name: "立即同步" }).click();
    await panel.locator(".cloud-compare > summary").click();
    await panel.getByRole("button", { name: "仅保留 B" }).click();
    await panel.getByRole("button", { name: "取消" }).click();
    assert.equal(await panel.locator(".cloud-compare").count(), 1);
    await panel.getByRole("button", { name: "仅保留 B" }).click();
    await panel.getByRole("button", { name: "确认", exact: true }).click();
    await nextDevice.scene.getByText("版本选择已存本机。").waitFor();
    await nextDevice.p.waitForFunction(() => window.MWILoadoutScenes.Cloud.info(71, 12).kind === "ok" &&
      window.MWILoadoutScenes.Cloud.info(71, 12).conflicts === 0);
    await firstDevice.p.evaluate(() => window.MWILoadoutScenes.Cloud.request(71, 12));
    const remaining = JSON.parse(cloudTexts.get(boardKey)).scenes.filter(row => row.removedAt == null);
    assert.equal(remaining.length, 1);
    await firstDevice.scene.getByRole("button", {name: remaining[0].name, exact: true}).waitFor();
    await nextDevice.c.close(); await firstDevice.c.close();
    pass("fresh second device automatically restores a scene saved on the first using a synthetic clipboard");
    const negative = await browser.newContext(); await negative.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture }));
    await negative.addInitScript({ content: read("mwi_combat_loadout_archive.user.js") }); const np = await negative.newPage(); await np.goto("https://mwi-combatsi-mulator.pages.dev/game");
    assert.equal(await np.locator("#mwi-loadout-scenes-host").count(), 0); await negative.close();
    pass("all four official game origins and development loader mount correctly; old simulator cannot start the app");
    await require("./scene_types_browser.cjs")(browser, read("mwi_combat_loadout_archive.user.js"), fixture, pass);
    await require("./action_memory_browser.cjs")(browser, read("mwi_combat_loadout_archive.user.js"), pass);
  } finally { await browser.close(); }
  assert.equal(browser.isConnected(), false); pass("isolated Chrome closed normally");
  fs.mkdirSync(path.join(root, "preview"), { recursive: true });
  fs.writeFileSync(path.join(root, "preview/browser_results.json"), JSON.stringify({ syntheticOnly: true, checks: results }, null, 2) + "\n");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
