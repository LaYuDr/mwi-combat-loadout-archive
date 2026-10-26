"use strict";
const assert = require("node:assert/strict"), path = require("node:path"), fs = require("node:fs");
const { chromium } = require(process.env.MWI_ARCHIVE_PLAYWRIGHT || "/Users/layu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const fixture = require('./native_fixture.cjs'), F = require('./fixtures.cjs');
const project = path.resolve(__dirname, "../.."), bundle = path.join(project,"deliverables/mwi_combat_loadout_archive.user.js");
const base="https://mwi-combatsi-mulator.pages.dev/",checks=[];
const pass = message => { checks.push(message); console.log('PASS '+message); };
async function records(p) { return p.evaluate(async()=>{const s=await MWILoadoutStore.create();try{return await s.all();}finally{s.close();}}); }
async function poll(check) { const end=Date.now()+15000;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('Timed out waiting for committed state'); }
async function count(p,n) { await poll(async()=> (await records(p)).filter(r=>!r.deletedAt).length===n); }
async function status(p,text) { await p.getByRole('status').filter({hasText:text}).waitFor(); }
async function choose(p,name) { await p.getByRole('button',{name:new RegExp(name)}).first().click(); }
async function fixtureContext(browser) {
 const c=await browser.newContext({viewport:{width:1440,height:1040},acceptDownloads:true});
 await c.route('**/*',route=>route.request().url().startsWith(base)?route.fulfill({contentType:'text/html',body:fixture}):route.abort());
 await c.addInitScript({path:bundle});return c;
}
async function main(){
 const browser=await chromium.launch({headless:true,executablePath:process.env.MWI_ARCHIVE_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 const errors=[];fs.mkdirSync(path.join(project,'.impeccable/review'),{recursive:true});
 try{
 const context=await fixtureContext(browser),p=await context.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'#/home');await p.getByRole('heading',{name:'配装档案',exact:true}).waitFor();
 await p.getByRole('heading',{name:'把网页上调好的配置留下来'}).waitFor();
 await p.getByLabel('新配置名称').fill('法系手调方案');
 await p.getByLabel('模拟玩家 1 名称').fill('手动修改的法师');await p.getByLabel('模拟玩家 1 武器强化').fill('17');
 await p.evaluate(()=>{document.querySelector('#solo-text').value='保留单人原有输入';document.querySelector('#group-text').value='保留组队原有输入';localStorage.setItem('mwi.player.data.snapshot.v1','sentinel-native-snapshot');});
 await p.getByRole('button',{name:'保存网页当前配置',exact:true}).click();await status(p,'已保存“法系手调方案”');await count(p,1);assert.ok(await p.getByLabel('新配置名称').evaluate(e=>e.getRootNode().activeElement===e));
 let rows=await records(p);const solo=rows[0];assert.equal(JSON.parse(solo.jsonText).player.name,'手动修改的法师');assert.equal(JSON.parse(solo.jsonText).player.equipment.weapon.enhancementLevel,17);
 assert.equal(solo.jsonText,await p.evaluate(()=>fixtureExports.at(-1).text));
 assert.deepEqual(await p.evaluate(()=>[document.querySelector('#solo-text').value,document.querySelector('#group-text').value,document.querySelector('[role=dialog]').hidden]),['保留单人原有输入','保留组队原有输入',true]);
 pass('saves current manual website edits through native export, exact JSON retained and previous native drafts restored');
 await p.evaluate(()=>{fixturePlayers[0].name='另一个当前方案';fixturePlayers[0].equipment.weapon.enhancementLevel=0;fixtureSettings.simulationTimeHours=8;});
 const untouched=await p.evaluate(()=>structuredClone(fixturePlayers.filter(x=>x.id!=='4')));
 await p.getByLabel('导入目标玩家').selectOption('4');await p.getByRole('button',{name:'导入到网页',exact:true}).click();await status(p,'已导入玩家 4');assert.ok(await p.getByRole('button',{name:'导入到网页',exact:true}).evaluate(e=>e.getRootNode().activeElement===e));
 const restored=await p.evaluate(()=>({player:fixturePlayers[3],others:fixturePlayers.filter(x=>x.id!=='4'),settings:fixtureSettings,last:fixtureImports.at(-1)}));
 assert.equal(restored.player.id,'4');assert.equal(restored.player.name,'手动修改的法师');assert.equal(restored.player.equipment.weapon.enhancementLevel,17);
 assert.deepEqual(restored.others,untouched);assert.deepEqual(restored.settings,JSON.parse(solo.jsonText).simulationSettings);assert.equal(restored.last.text,solo.jsonText);
 await count(p,1);pass('native solo import targets selected slot, restores native settings, preserves other players and does not auto-archive');
 await p.getByRole('radio',{name:'整队',exact:true}).check();await p.getByLabel('新配置名称').fill('地下城整队方案');
 await p.getByRole('button',{name:'保存网页当前配置',exact:true}).click();await status(p,'已保存“地下城整队方案”');await count(p,2);
 const group=(await records(p)).find(r=>r.documentKind==='group');assert.equal(JSON.parse(group.jsonText).players.length,5);
 const before=await p.evaluate(()=>fixtureImports.length);await p.getByRole('button',{name:'导入整队配置',exact:true}).click();
 await p.getByRole('button',{name:'确认恢复整队及模拟设置',exact:true}).waitFor();assert.equal(await p.evaluate(()=>fixtureImports.length),before);
 await p.getByRole('button',{name:'取消整队恢复',exact:true}).click();assert.equal(await p.evaluate(()=>fixtureImports.length),before);
 await p.evaluate(()=>{fixturePlayers.forEach(x=>x.name='临时整队');fixtureSettings.simulationTimeHours=44;});
 await p.getByRole('button',{name:'导入整队配置',exact:true}).click();await p.getByRole('button',{name:'确认恢复整队及模拟设置',exact:true}).click();await status(p,'整队配置导入成功');assert.ok(await p.getByRole('button',{name:'导入整队配置',exact:true}).evaluate(e=>e.getRootNode().activeElement===e));
 assert.deepEqual(await p.evaluate(()=>fixturePlayers),JSON.parse(group.jsonText).players);assert.deepEqual(await p.evaluate(()=>fixtureSettings),JSON.parse(group.jsonText).simulationSettings);
 pass('group stored as one whole JSON; first click and cancel do not mutate website; explicit confirmation restores players and settings');
 const original=await p.evaluate(()=>localStorage.getItem('mwi.player.data.snapshot.v1'));assert.equal(original,'sentinel-native-snapshot');
 await p.reload();await p.getByRole('heading',{name:'配装档案',exact:true}).waitFor();await choose(p,'地下城整队方案');assert.ok(await p.getByRole('button',{name:/地下城整队方案.*整队/}).evaluate(e=>e.getRootNode().activeElement===e));
 await p.getByLabel('档案名称',{exact:true}).fill('整队持久档案');await p.getByRole('button',{name:'保存名称',exact:true}).click();await status(p,'档案名称已保存');
 const dlPromise=p.waitForEvent('download');await p.getByRole('button',{name:'下载原生 JSON',exact:true}).click();const dl=await dlPromise;
 assert.equal(fs.readFileSync(await dl.path(),'utf8'),group.jsonText);
 await p.getByRole('button',{name:'移入回收站',exact:true}).click();await count(p,1);await p.getByRole('button',{name:'撤销移入回收站',exact:true}).click();await count(p,2);
 await choose(p,'整队持久档案');await p.getByRole('button',{name:'移入回收站',exact:true}).click();await p.getByLabel('档案分类').selectOption('trash');
 await p.getByRole('button',{name:'恢复这份档案',exact:true}).click();await count(p,2);
 pass('reload persistence, rename, byte-identical native download, soft delete, immediate undo and recycle recovery');
 const backupPromise=p.waitForEvent('download');await p.getByRole('button',{name:'备份全部',exact:true}).click();const backup=fs.readFileSync(await(await backupPromise).path(),'utf8');assert.equal(JSON.parse(backup).archives.length,2);
 await p.getByLabel('导入档案文件',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backup)});
 await p.getByRole('button',{name:'添加到档案库',exact:true}).click();await status(p,'已添加 0 份档案');await count(p,2);
 const importedText=group.jsonText;
 await p.getByLabel('导入档案文件',{exact:true}).setInputFiles({name:'native-group.json',mimeType:'application/json',buffer:Buffer.from(importedText)});
 await p.getByRole('button',{name:'添加到档案库',exact:true}).click();await count(p,3);
 assert.equal((await records(p)).filter(r=>r.documentKind==='group').length,2);
 const invalid=JSON.stringify({format:'mwi-loadout-archive',version:2,archives:[{name:'有效',jsonText:solo.jsonText},{name:'损坏',jsonText:'broken'}]});
 await p.getByLabel('导入档案文件',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from(invalid)});await status(p,'JSON 无法解析');await count(p,3);
 pass('v2 full backup deduplicates, native group file stays whole, malformed mixed file cannot partially write');
 const legacy=await p.evaluate(async payload=>{const row=await MWILoadoutCore.prepare(payload,{kind:'named',name:'旧版空槽档案'});const s=await MWILoadoutStore.create();try{await s.addNamed([row]);return row;}finally{s.close();}},F.emptyCombatSlots());
 await p.getByRole('button',{name:'重新读取档案',exact:true}).click();await status(p,'档案列表已刷新');await p.getByLabel('档案分类').selectOption('legacy');await choose(p,'旧版空槽档案');
 await p.getByLabel('导入目标玩家').selectOption('5');await p.getByRole('button',{name:'导入到网页',exact:true}).click();await status(p,'已导入玩家 5');
 const oldImport=JSON.parse(await p.evaluate(()=>fixtureImports.at(-1).text));assert.deepEqual(oldImport.actionTypeFoodSlotsMap['/action_types/combat'],{});
 assert.deepEqual((await records(p)).find(r=>r.id===legacy.id),legacy);
 const beforeMessage=(await records(p)).length;await p.evaluate(payload=>window.postMessage({channel:'mwi-tm-bridge',type:'mwi-tm-import',requestId:'no-auto-save',payload},location.origin),F.current());
 await p.getByRole('button',{name:'重新读取档案',exact:true}).click();await status(p,'档案列表已刷新');assert.equal((await records(p)).length,beforeMessage);
 pass('old records remain unchanged/readable and empty-object slots survive native restore; external game import messages no longer auto-save');
 await p.getByLabel('档案分类').selectOption('all');await choose(p,'法系手调方案');await p.evaluate(()=>fixtureReject=true);
 const importsBefore=await p.evaluate(()=>fixtureImports.length);await p.getByRole('button',{name:'导入到网页',exact:true}).click();await status(p,'请先保存或取消');assert.equal(await p.evaluate(()=>fixtureImports.length),importsBefore);await p.evaluate(()=>fixtureReject=false);
 await p.getByRole('radio',{name:'单人',exact:true}).check();await p.getByLabel('新配置名称').fill('失败时保留此名称');await p.evaluate(()=>fixtureExportFailure=true);
 await p.getByRole('button',{name:'保存网页当前配置',exact:true}).click();await status(p,'网页导出失败');assert.equal(await p.getByLabel('新配置名称').inputValue(),'失败时保留此名称');assert.equal((await records(p)).length,beforeMessage);await p.evaluate(()=>fixtureExportFailure=false);
 await p.evaluate(()=>location.hash='/results');await p.locator('#mwi-loadout-archive-host').waitFor({state:'detached'});assert.equal(await p.locator('#mwi-loadout-archive-host').count(),0);await p.evaluate(()=>location.hash='/home');await p.getByRole('heading',{name:'配装档案',exact:true}).waitFor();
 pass('native export failure, rejected import and wrong route do not report success, overwrite records or clear entered names');
 const timeoutResult=await p.evaluate(async()=>{document.querySelector('#solo-text').value='超时前单人草稿';fixtureIgnoreExport=true;const a=MWINativeAdapter.create({inspect:MWINativeDocument.inspect,timeout:100});let rejected=false;try{await a.capture('group');}catch(e){rejected=/限定时间/.test(e.message);}fixtureIgnoreExport=false;const recovery=a.recoveryAvailable;const backup=JSON.parse(a.backupDraft());document.querySelector('#native-close').click();return{rejected,recovery,solo:backup.original.solo,repeatedCopy:JSON.parse(a.backupDraft()).original.solo};});
 assert.equal(timeoutResult.rejected,true);assert.equal(timeoutResult.recovery,true);assert.equal(timeoutResult.solo,'超时前单人草稿');assert.equal(timeoutResult.repeatedCopy,'超时前单人草稿');
 const noConfirm=await p.evaluate(async text=>{const a=MWINativeAdapter.create({inspect:MWINativeDocument.inspect});try{await a.restore(text,'group');return false;}catch(e){return /先确认/.test(e.message);}},group.jsonText);assert.ok(noConfirm);
 pass('bounded timeout preserves repeatable draft backup without rewriting a still-running native form; group import requires explicit confirmation');
 await p.getByRole('searchbox',{name:'搜索配置或角色'}).fill('没有匹配项');await p.getByText('没有匹配的档案。',{exact:true}).waitFor();await p.getByRole('button',{name:'清除筛选',exact:true}).click();await choose(p,'整队持久档案');
 await p.getByLabel('新配置名称').fill('新的配置名称');
 await p.getByRole('button',{name:'重新读取档案',exact:true}).click();await status(p,'档案列表已刷新');
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(project,'.impeccable/review/desktop.png'),animations:'disabled',fullPage:true});
 await p.evaluate(()=>{document.documentElement.classList.remove('dark');document.documentElement.dataset.theme='light';});
 await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(project,'.impeccable/review/desktop_light.png'),animations:'disabled',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(project,'.impeccable/review/mobile.png'),animations:'disabled',fullPage:true});
 const embedded=await p.evaluate(async()=>{
  const host=document.querySelector('#mwi-loadout-archive-host'),s=host.shadowRoot,panel=s.querySelector('.panel'),r=panel.getBoundingClientRect();
  const before=host.getBoundingClientRect().top;scrollBy(0,150);await new Promise(requestAnimationFrame);const after=host.getBoundingClientRect().top;
  return{insideHome:host.parentElement.id==='fixture-home',widthFits:r.left>=0&&r.right<=innerWidth&&panel.scrollWidth<=r.width,
    pageFlows:getComputedStyle(panel).position==='static'&&getComputedStyle(host).position==='static',scrolled:before-after>0,
    noOverlay:s.querySelector('.launcher,.close')===null};
 });assert.deepEqual(embedded,{insideHome:true,widthFits:true,pageFlows:true,scrolled:true,noOverlay:true});
 await p.getByLabel('新配置名称').focus();await p.keyboard.press('Escape');assert.ok(await p.getByRole('heading',{name:'配装档案',exact:true}).isVisible());
 assert.ok(await p.getByLabel('新配置名称').evaluate(e=>e.getRootNode().activeElement===e));
 const draft=await p.getByLabel('新配置名称').inputValue();
 await p.evaluate(()=>{const old=document.querySelector('#fixture-home');const next=document.createElement('section');next.id='fixture-home';next.append(old.querySelector('[role=tablist]'),old.querySelector('#fixture-native-config'));old.replaceWith(next);});
 await poll(()=>p.evaluate(()=>document.querySelector('#mwi-loadout-archive-host')?.parentElement.id==='fixture-home'));
 assert.equal(await p.getByLabel('新配置名称').inputValue(),draft);assert.equal(await p.locator('#mwi-loadout-archive-host').count(),1);
 pass('embedded in home normal flow, desktop/mobile document scrolling, no floating opener or Escape dismissal, remount preserves draft');
 const denied=await context.newPage();await denied.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined}));await denied.goto(base+'#/home');await denied.getByRole('heading',{name:'配装档案',exact:true}).waitFor();await status(denied,'未提供 IndexedDB');assert.ok(await denied.getByRole('button',{name:'保存网页当前配置',exact:true}).isDisabled());
 const wrong=await context.newPage();await wrong.route('**/*',r=>r.fulfill({contentType:'text/html',body:fixture}));await wrong.goto('https://example.test/#/home');assert.equal(await wrong.locator('#mwi-loadout-archive-host').count(),0);
 await p.addScriptTag({path:bundle});assert.equal(await p.locator('#mwi-loadout-archive-host').count(),1);
 pass('storage-unavailable state blocks saving, host restriction and duplicate-load guard');
 assert.deepEqual(errors,[]);await context.close();
 if(process.env.MWI_ARCHIVE_LIVE==='1'){
  const live=await browser.newContext({viewport:{width:1440,height:1040}});await live.addInitScript({path:bundle});const p=await live.newPage();
  await p.goto(base+'#/home',{waitUntil:'domcontentloaded',timeout:45000});await p.getByRole('button',{name:/^(导入\s*\/\s*导出|Import\s*\/\s*Export)$/i}).waitFor({timeout:45000});
  const siteWarnings=[];
  async function settleWebsite(){
    await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const error=p.getByRole('dialog').filter({hasText:'ResizeObserver loop completed with undelivered notifications.'});
    if(await error.count()){
      siteWarnings.push('The deployed website opened its ResizeObserver error dialog; explicitly dismissed in the isolated test.');
      await p.keyboard.press('Escape');await error.waitFor({state:'hidden'});
    }
  }
  const solo=await p.evaluate(async()=>{window.nativeAcceptance=MWINativeAdapter.create({inspect:MWINativeDocument.inspect,timeout:45000});return JSON.parse(await nativeAcceptance.capture('solo','2'));});
  await settleWebsite();solo.player.name='合成原生保存角色';
  await p.evaluate(text=>nativeAcceptance.restore(text,'solo','3'),JSON.stringify(solo,null,2));await settleWebsite();
  const after=await p.evaluate(async()=>JSON.parse(await nativeAcceptance.capture('solo','3')));await settleWebsite();
  const group=await p.evaluate(async()=>JSON.parse(await nativeAcceptance.capture('group')));await settleWebsite();
  group.players[0].name='合成整队玩家一';group.players[4].name='合成整队玩家五';
  await p.evaluate(text=>nativeAcceptance.restore(text,'group',null,{confirmedGroup:true}),JSON.stringify(group));await settleWebsite();
  const afterGroup=await p.evaluate(async()=>JSON.parse(await nativeAcceptance.capture('group')));await settleWebsite();
  assert.deepEqual({sourceId:solo.player.id,targetId:after.player.id,name:after.player.name,groupFirst:afterGroup.players[0].name,groupLast:afterGroup.players[4].name,size:afterGroup.players.length},
    {sourceId:'2',targetId:'3',name:'合成原生保存角色',groupFirst:'合成整队玩家一',groupLast:'合成整队玩家五',size:5});
  if(siteWarnings.length)console.log('WEBSITE NOTE '+siteWarnings[0]);
  await p.getByRole('heading',{name:'配装档案',exact:true}).waitFor();await p.getByRole('radio',{name:'整队',exact:true}).check();await p.getByLabel('新配置名称').fill('真实网站合成整队验收');await p.getByRole('button',{name:'保存网页当前配置',exact:true}).click();await status(p,'已保存“真实网站合成整队验收”');assert.equal((await records(p))[0].documentKind,'group');
  await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(project,'preview/native_live_site.png'),fullPage:true,animations:'disabled'});await live.close();pass('live deployed website: native solo export and targeted import, complete group roundtrip and plugin one-click save, isolated synthetic data');
 }
 checks.push(...await require('./equipment_filter_browser.cjs').run({browser,bundle,project,live:process.env.MWI_ARCHIVE_LIVE==='1'}));
 fs.mkdirSync(path.join(project,'preview'),{recursive:true});fs.writeFileSync(path.join(project,'preview/native_browser_results.json'),JSON.stringify({date:'2026-10-26',checks,pageErrors:errors,liveSite:process.env.MWI_ARCHIVE_LIVE==='1',isolatedProfile:true,realGame:false},null,2));
 console.log(checks.length+' browser scenarios passed; owned browser closed.');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
