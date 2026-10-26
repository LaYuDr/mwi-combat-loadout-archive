"use strict";
const assert = require("node:assert/strict"), path = require("node:path");
const C = require("../equipment_catalog.js"), F = require("../equipment_filter.js");
const base = "https://mwi-combatsi-mulator.pages.dev/";
function fixture() {
  return `<!doctype html><html lang="zh" class="dark" data-theme="dark"><head><meta charset="utf-8"><style>
body{background:#0c111c;color:#e5edf8;font:15px system-ui;padding:24px;--background:#111827;--foreground:#e5edf8;--muted-foreground:#b6c3d5;--border:#41546e;--input:#41546e;--accent:#273850;--muted:#1b283c;--ring:#60a5fa}
.surface-panel{padding:20px;border:1px solid #41546e;border-radius:8px}.equipment-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.card{border:1px solid #41546e;padding:12px;border-radius:6px}
[data-equipment-input-row]{display:grid;grid-template-columns:minmax(0,1fr) 65px;gap:8px}.anchor{display:flex;width:100%;height:36px;border:1px solid #41546e;border-radius:6px}.anchor input{min-width:0;flex:1;border:0;background:transparent;color:inherit}.anchor button{width:30px;background:#1b283c;color:inherit;border:0}input[type=number]{width:65px;background:#1b283c;color:inherit;border:1px solid #41546e;border-radius:6px}
[role=listbox]{background:#1b283c;color:#e5edf8;position:absolute;z-index:80;max-height:230px;overflow:auto}[role=option]{padding:7px}[hidden]{display:none!important}@media(max-width:600px){.equipment-grid{grid-template-columns:1fr}body{padding:4px}}
</style></head><body><h1>装备筛选 · 合成验收</h1><main><section id="fixture-home"><div role="tablist"><button role="tab">基础设置</button><button role="tab">战斗属性</button><button role="tab">完整结果</button></div><div id="equipment-root"></div></section></main><script>
const catalog=${JSON.stringify(C)};
window.fixtureEquipment={head:'/items/cheese_helmet',weapon:'/items/cheese_sword',pouch:'/items/small_pouch',neck:'/items/necklace_of_efficiency',ring:'/items/ring_of_regeneration',earrings:'/items/earrings_of_gathering'};
window.fixtureChoices=[];window.fixtureLocale='zh';window.fixtureMissing=false;
function nativeName(item){return 'Lv'+item.itemLevel+' '+item[fixtureLocale]}
window.renderEquipment=function(){
 const root=document.querySelector('#equipment-root');root.replaceChildren();if(location.hash!=='#/home')return;
 const panel=document.createElement('div');panel.className='surface-panel';panel.innerHTML='<h2>装备</h2><div class="equipment-grid"></div>';root.append(panel);
 for(const slot of ['head','weapon','pouch','neck','ring','earrings']){
  const card=document.createElement('div');card.className='card';const label=catalog.slots[slot][fixtureLocale];
  card.innerHTML='<label>'+label+'</label><div data-equipment-input-row><div class="anchor"><input role="combobox" aria-label="'+label+'" aria-expanded="false" aria-controls="options-'+slot+'"><button type="button" aria-label="展开选项">展开</button></div><input type="number" aria-label="'+label+' 强化" value="7"></div>';
  const input=card.querySelector('[role=combobox]'),trigger=card.querySelector('button');
  function display(){const i=catalog.items.find(i=>i.hrid===fixtureEquipment[slot]);input.value=i?nativeName(i):fixtureLocale==='zh'?'无':'None'}
  function close(){input.setAttribute('aria-expanded','false');document.querySelector('#options-'+slot)?.remove();display()}
  function renderList(){let list=document.querySelector('#options-'+slot);if(!list){list=document.createElement('div');list.id='options-'+slot;list.setAttribute('role','listbox');document.body.append(list)}list.replaceChildren();
   const term=input.value.toLowerCase();const items=[{hrid:'',itemLevel:0,zh:'无',en:'None'},...catalog.items.filter(i=>i.slot===slot)].filter(i=>!term||(i.hrid?nativeName(i):i[fixtureLocale]).toLowerCase().includes(term)).slice(0,60);
   for(const i of fixtureMissing?[]:items){const option=document.createElement('div');option.setAttribute('role','option');option.textContent=i.hrid?nativeName(i):i[fixtureLocale];option.onclick=()=>{fixtureEquipment[slot]=i.hrid;fixtureChoices.push({slot,hrid:i.hrid});close()};list.append(option)}}
  trigger.onclick=()=>{if(input.getAttribute('aria-expanded')==='true'){close();return}input.setAttribute('aria-expanded','true');input.value='';renderList()};
  input.oninput=()=>{if(input.getAttribute('aria-expanded')==='true')renderList()};input.onkeydown=e=>{if(e.key==='Escape')close()};display();panel.querySelector('.equipment-grid').append(card);
 }
};renderEquipment();window.addEventListener('hashchange',renderEquipment);
</script></body></html>`;
}
async function run({ browser, bundle, project, live = false }) {
  const results = [], errors = [];
  const pass = title => { results.push(title); console.log(`PASS equipment: ${title}`); };
  async function assertExemptControls(page) {
    for (const slot of F.exemptSlots) {
      const input = page.getByRole("combobox", { name: C.slots[slot].zh, exact: true });
      assert.ok(await input.isVisible());
      assert.equal(await page.locator(`[data-mwi-equipment-select="${slot}"]`).count(), 0);
      await input.locator("..").getByRole("button").click();
      const id = await input.getAttribute("aria-controls");
      const popup = page.locator(`[id="${id}"]`);
      await popup.getByRole("option").first().waitFor();
      assert.ok(await popup.getByRole("option").count() >= C.items.filter(item => item.slot === slot).length + 1);
      await input.press("Escape");
    }
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: fixture() }));
  await context.addInitScript({ path: bundle }); const p = await context.newPage(); p.on("pageerror", error => errors.push(error.message));
  try {
    await p.goto(base + "#/home"); await p.getByRole("button", { name: "装备筛选", exact: true }).waitFor();
    assert.ok(await p.getByRole("combobox", { name: "头部", exact: true }).isVisible());
    assert.equal(await p.locator('[data-mwi-equipment-select]:visible').count(), 0);
    await p.getByRole("button", { name: "装备筛选", exact: true }).click();
    await p.getByLabel("职业", { exact: true }).selectOption("magic");
    const initial = await p.evaluate(() => ({ choices: fixtureChoices, head: fixtureEquipment.head }));
    assert.deepEqual(initial, { choices: [], head: "/items/cheese_helmet" });
    const head = p.getByRole("combobox", { name: "头部（筛选装备）", exact: true });
    const filtered = await head.locator("option").evaluateAll(nodes => nodes.map(n => n.value).filter(v => v && v !== "__keep__"));
    assert.ok(filtered.length); assert.ok(filtered.every(hrid => F.groups(C.items.find(i => i.hrid === hrid)).includes("magic")));
    await assertExemptControls(p);
    pass("default retains original controls; category affects candidates only and preserves current gear");

    await p.getByLabel("等级：大于等于", { exact: true }).selectOption("95");
    await p.getByLabel("小于", { exact: true }).selectOption("110");
    assert.ok(await head.locator('option[value="/items/magicians_hat"]').count());
    assert.equal(await head.locator('option[value="/items/magicians_hat_refined"]').count(), 0);
    await head.selectOption("/items/magicians_hat");
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部" }).waitFor();
    assert.equal(await p.evaluate(() => fixtureEquipment.head), "/items/magicians_hat");
    assert.equal(await p.getByRole("spinbutton", { name: "头部 强化", exact: true }).inputValue(), "7");
    assert.equal(await p.evaluate(() => fixtureEquipment.weapon), "/items/cheese_sword");
    await head.selectOption("");
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部：无" }).waitFor();
    assert.equal(await p.evaluate(() => fixtureEquipment.head), "");
    await head.selectOption("/items/magicians_hat");
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部：" }).waitFor();
    pass("category and inclusive/exclusive level bounds combine; original selection updates one slot, preserving enhancement and other slots");

    await p.getByLabel("等级：大于等于", { exact: true }).selectOption("110");
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "下限必须小于上限" }).waitFor();
    assert.equal(await head.locator('option[value^="/items/"]').count(), 0);
    await p.getByLabel("搜索装备", { exact: true }).fill("no-match");
    await assertExemptControls(p);
    pass("pouch, neck, ring and earrings retain complete native lists despite category, search and invalid level filters");
    await p.getByRole("button", { name: "重置筛选", exact: true }).click();
    await p.getByLabel("等级：大于等于", { exact: true }).selectOption("1");
    const weapon = p.getByRole("combobox", { name: "主手（筛选装备）", exact: true });
    const list = await weapon.locator('option[value^="/items/"]').evaluateAll(nodes => nodes.map(n => n.value)); assert.ok(list.length > 60);
    await weapon.selectOption(list.at(-1));
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择主手" }).waitFor();
    assert.equal(await p.evaluate(() => fixtureEquipment.weapon), list.at(-1));
    await p.getByLabel("搜索装备", { exact: true }).fill("magicians_hat_refined");
    assert.equal(await head.locator('option[value^="/items/"]').count(), 1);
    assert.equal(await head.locator('option[value="/items/magicians_hat_refined"]').count(), 1);
    pass("invalid range, full catalogue beyond 60, and shared bilingual/HRID search");

    await p.getByLabel("搜索装备", { exact: true }).fill("");
    await p.getByLabel("职业", { exact: true }).selectOption("ranged");
    await p.getByRole("button", { name: "装备筛选", exact: true }).click();
    assert.equal(await p.getByLabel("职业", { exact: true }).isVisible(), false);
    assert.ok(await head.isVisible());
    await p.evaluate(() => { fixtureLocale = "en"; renderEquipment(); });
    await p.getByRole("combobox", { name: "Head（筛选装备）", exact: true }).waitFor();
    assert.ok(await p.getByRole("combobox", { name: "Head（筛选装备）", exact: true }).locator('option[value^="/items/"]').count());
    await p.evaluate(() => { fixtureLocale = "zh"; renderEquipment(); });
    await head.waitFor(); assert.equal(await p.locator('[data-mwi-equipment-filters]').count(), 1);
    await p.getByRole("button", { name: "装备筛选", exact: true }).click();
    await p.getByLabel("职业", { exact: true }).selectOption("magic");
    await p.getByLabel("等级：大于等于", { exact: true }).selectOption("95");
    await p.evaluate(item => {
      fixtureEquipment.head = item.hrid;
      document.querySelector('[data-equipment-input-row] input[role="combobox"]').value = `Lv${item.itemLevel} ${item.zh}`;
      document.querySelector("h1").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }, C.items.find(item => item.hrid === "/items/magicians_hat_refined"));
    await p.locator('[data-mwi-equipment-current="head"]').filter({ hasText: "Lv110" }).waitFor();
    await p.screenshot({ path: path.join(project, "preview/equipment_filter_desktop.png"), fullPage: true, animations: "disabled" });
    await p.setViewportSize({ width: 390, height: 844 });
    await p.evaluate(() => scrollTo(0, 0));
    await p.screenshot({ path: path.join(project, "preview/equipment_filter_mobile.png"), animations: "disabled" });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    pass("collapsed filters stay effective; language changes and panel remount keep one control; mobile fits");

    const previous = await p.evaluate(() => fixtureEquipment.head);
    await p.evaluate(() => fixtureMissing = true); await head.selectOption("/items/magicians_hat");
    await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "未能唯一找到" }).waitFor({ timeout: 10000 });
    assert.equal(await p.evaluate(() => fixtureEquipment.head), previous);
    assert.ok((await p.locator('[data-mwi-equipment-current="head"]').textContent()).includes(C.items.find(i => i.hrid === previous).zh));
    await p.evaluate(() => fixtureMissing = false);
    await p.getByRole("button", { name: "重置筛选", exact: true }).click();
    assert.ok(await p.getByRole("combobox", { name: "头部", exact: true }).isVisible());
    assert.equal(await p.locator('[data-mwi-equipment-select]:visible').count(), 0);
    await p.evaluate(() => location.hash = "/results"); await p.locator('[data-mwi-equipment-filters]').waitFor({ state: "detached" });
    await p.evaluate(() => location.hash = "/home"); await p.getByRole("button", { name: "装备筛选", exact: true }).waitFor();
    assert.equal(await p.locator('[data-mwi-equipment-filters]').count(), 1);
    assert.deepEqual(errors, []);
    pass("missing native item fails safely; reset restores native controls and route remount remains unique");
  } finally { await context.close(); }

  if (live) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await context.addInitScript({ path: bundle }); const p = await context.newPage();
    try {
      await p.goto(base + "#/home", { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.getByRole("button", { name: "装备筛选", exact: true }).waitFor({ timeout: 45000 });
      await p.getByRole("button", { name: "装备筛选", exact: true }).click();
      await p.getByLabel("职业", { exact: true }).selectOption("magic");
      await p.getByLabel("等级：大于等于", { exact: true }).selectOption("95");
      await p.getByLabel("小于", { exact: true }).selectOption("110");
      const head = p.getByRole("combobox", { name: "头部（筛选装备）", exact: true });
      await head.selectOption("/items/magicians_hat");
      await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部" }).waitFor({ timeout: 10000 });
      const native = p.locator('[data-equipment-input-row] input[aria-label="头部"]');
      assert.ok((await native.inputValue()).includes(C.items.find(i => i.hrid === "/items/magicians_hat").zh));
      await head.selectOption("");
      await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部：无" }).waitFor({ timeout: 10000 });
      assert.equal(await native.inputValue(), "无");
      await head.selectOption("/items/magicians_hat");
      await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择头部：" }).waitFor({ timeout: 10000 });
      await p.getByRole("button", { name: "重置筛选", exact: true }).click();
      await p.getByLabel("等级：大于等于", { exact: true }).selectOption("1");
      const weapon = p.getByRole("combobox", { name: "主手（筛选装备）", exact: true });
      assert.ok(await weapon.locator('option[value^="/items/"]').count() > 60);
      const choices = await weapon.locator('option[value^="/items/"]').evaluateAll(nodes => nodes.map(n => n.value));
      const last = choices.at(-1); await weapon.selectOption(last);
      await p.locator('[data-mwi-equipment-filters] [role="status"]').filter({ hasText: "已选择主手" }).waitFor({ timeout: 10000 });
      await p.getByLabel("职业", { exact: true }).selectOption("ranged");
      await p.getByLabel("等级：大于等于", { exact: true }).selectOption("80");
      await assertExemptControls(p);
      await p.locator('[data-mwi-equipment-filters]').scrollIntoViewIfNeeded();
      await p.screenshot({ path: path.join(project, "preview/equipment_filter_live.png"), animations: "disabled" });
      await p.getByRole("button", { name: "重置筛选", exact: true }).click();
      assert.ok(await p.getByRole("combobox", { name: "头部", exact: true }).isVisible());
      assert.ok((await native.inputValue()).includes(C.items.find(i => i.hrid === "/items/magicians_hat").zh));
      pass("live simulator: actual native Reka selection, complete weapon catalogue, category+levels and reset preserve chosen equipment");
    } finally { await context.close(); }
  }
  return results;
}
module.exports = { run };
