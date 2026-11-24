"use strict";
const assert = require("node:assert/strict");
module.exports = async function checkSceneTypes(browser, content, fixture, pass) {
  const context = await browser.newContext();
  const url = "https://www.milkywayidlecn.com/game", requests = [], errors = [];
  await context.route("**/*", route => { requests.push(route.request().url()); return route.fulfill({ contentType: "text/html", body: fixture }); });
  await context.addInitScript({ content });
  try {
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    await page.goto(url);
    const host = page.locator("#mwi-loadout-scenes-host"), summary = host.locator("#summary"), status = host.locator("#status");
    const tools = ["milking", "foraging", "woodcutting", "cheesesmithing", "crafting", "tailoring", "cooking", "brewing", "alchemy", "enhancing"];
    const saved = [];
    async function open(raw) {
      await page.evaluate(raw => { controller.props.characterLoadoutDict[raw.id] = structuredClone(raw); controller.state.selectedCharacterLoadoutId = raw.id; paint(); }, raw);
    }
    for (const [id, type] of [[21, "/action_types/enhancing"], [22, ""]]) {
      const raw = { id, name: type ? "强化" : "所有技能", actionTypeHrid: type, useExactEnhancement: true,
        wearableMap: Object.fromEntries(tools.map(skill => [`/item_locations/${skill}_tool`, `71::/item_locations/inventory::/items/${skill}_tool::8`])),
        abilityMap: null, foodItemHrids: null, drinkItemHrids: type ? ["/items/tea", "", ""] : null,
        nativeExtension: { zero: 0, empty: [] } };
      await open(raw); await host.getByText("暂无方案", { exact: true }).waitFor();
      await host.getByRole("button", { name: "新建子方案", exact: true }).click();
      await host.getByLabel("新子方案名称").fill("效率");
      await host.getByRole("button", { name: "保存", exact: true }).click();
      await host.locator('.choices [data-scene-id][aria-pressed="true"]').filter({ hasText: "效率" }).waitFor();
      await summary.filter({ hasText: "配装已一致" }).waitFor();
      const row = await page.evaluate(async () => (await MWILoadoutScenes.Store.list(MWILoadoutScenes.Adapter.current().scope))[0]);
      assert.deepEqual(row.snapshot.raw, raw);
      const changed = structuredClone(raw);
      for (const skill of tools) changed.wearableMap[`/item_locations/${skill}_tool`] = "";
      if (type) changed.drinkItemHrids[0] = "/items/coffee";
      await open(changed); await summary.filter({ hasText: `${type ? 11 : 10} 项差异` }).waitFor();
      const located = await page.evaluate(() => {
        const { Core, Adapter } = MWILoadoutScenes, ctx = Adapter.current();
        return [...document.querySelectorAll('[data-mwi-scene-change]')].map(el => ({ row: el.style.gridRowStart, column: el.style.gridColumnStart }));
      });
      assert.equal(located.length, type ? 11 : 10);
      for (let index = 0; index < tools.length; index++) assert.ok(located.some(slot => slot.row === String(7 + Math.floor(index / 5)) && slot.column === String(1 + index % 5)), tools[index]);
      assert.equal(await host.locator("#summary").textContent().then(text => text.includes("未定位")), false);
      // A synthetic native tool picker belongs to exactly one changed slot.
      await page.evaluate(() => {
        const ctx = MWILoadoutScenes.Adapter.current(), slot = MWILoadoutScenes.Adapter.target(ctx, { kind: "equipment", slot: "enhancing_tool" });
        const root = document.getElementById("root")._reactRootContainer.current, panelFiber = root.child.child, previous = panelFiber.child;
        const list = document.createElement("div"); list.id = "tool-picker"; list.className = "ItemSelector_itemList__fixture";
        const ownerFiber = { stateNode: slot, return: panelFiber, sibling: previous };
        const fiber = { stateNode: list, return: ownerFiber }; ownerFiber.child = fiber; panelFiber.child = ownerFiber;
        window.closeToolPicker = () => { list.remove(); panelFiber.child = previous; };
        for (const [name, itemHrid, enhancementLevel] of [["wrong level", "/items/enhancing_tool", 7], ["target tool", "/items/enhancing_tool", 8], ["other tool", "/items/milking_tool", 8]]) {
          const choice = document.createElement("div"); choice.textContent = name;
          const child = { stateNode: choice, memoizedProps: { itemHrid, enhancementLevel }, return: fiber, sibling: fiber.child };
          fiber.child = child; list.append(choice);
        }
        document.body.append(list);
      });
      await page.locator('#tool-picker [data-mwi-scene-target]').waitFor();
      assert.deepEqual(await page.locator('#tool-picker [data-mwi-scene-target]').allTextContents(), ["target tool"]);
      await page.evaluate(() => closeToolPicker());
      // Updating retains the parent type and all raw fields, then survives a page reload.
      await host.locator(".active-actions").getByRole("button", { name: "更新", exact: true }).click();
      await host.getByRole("button", { name: "更新方案", exact: true }).click();
      await host.locator(".active-actions").getByRole("button", { name: "更新", exact: true }).waitFor();
      await summary.filter({ hasText: "配装已一致" }).waitFor();
      assert.equal(await status.isVisible(), false);
      await page.reload(); await open(changed);
      await host.getByRole("button", { name: "效率", exact: true }).click();
      await summary.filter({ hasText: "配装已一致" }).waitFor();
      const backup = await page.evaluate(async () => {
        const ctx = MWILoadoutScenes.Adapter.current(), rows = await MWILoadoutScenes.Store.list(ctx.scope);
        return MWILoadoutScenes.Store.exportBackup(ctx, rows);
      });
      assert.deepEqual(JSON.parse(backup).scenes[0].snapshot.raw, changed);
      const incoming = JSON.parse(backup); incoming.scenes[0].name = "备份导入";
      await host.getByLabel("选择子方案备份").setInputFiles({ name: "scenes.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(incoming)) });
      await status.filter({ hasText: "已导入 1" }).waitFor();
      assert.equal(await host.locator(".choices [data-scene-id]").count(), 2);
      const invalid = JSON.parse(backup); invalid.scenes[0].name = "不应导入"; invalid.scenes[0].snapshot.raw.actionTypeHrid = type ? "/action_types/milking" : "/action_types/enhancing";
      if (!type) invalid.scenes[0].snapshot.raw.drinkItemHrids = [];
      await host.getByLabel("选择子方案备份").setInputFiles({ name: "wrong-type.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
      await status.filter({ hasText: "配装类型" }).waitFor();
      assert.equal(await host.locator(".choices [data-scene-id]").count(), 2);
      saved.push(changed);
      pass(`${type ? "life" : "all-skills"} scenes save/update/reload/backup all raw fields, locate all ten tools, highlight only the exact target tool and reject wrong-type backups`);
    }
    await open(saved[0]); await host.getByRole("button", { name: "效率", exact: true }).click();
    await summary.filter({ hasText: "配装已一致" }).waitFor();
    const isolated = await page.evaluate(async () => {
      const ctx = MWILoadoutScenes.Adapter.current(), rows = await MWILoadoutScenes.Store.list(ctx.scope);
      return rows.map(row => row.snapshot.raw.actionTypeHrid);
    });
    assert.deepEqual(isolated, ["/action_types/enhancing", "/action_types/enhancing"]);
    await page.evaluate(() => { controller.state.selectedCharacterLoadoutId = 12; paint(); });
    await host.getByText("暂无方案", { exact: true }).waitFor();
    assert.equal(await page.locator("[data-mwi-scene-change]").count(), 0);
    assert.equal(await page.evaluate(() => nativeCalls), 0);
    assert.deepEqual(errors, []); assert.ok(requests.every(request => request === url));
    pass("life, all-skills and combat parent scenes remain isolated; switching clears highlights without native actions or network calls");
  } finally { await context.close(); }
};
