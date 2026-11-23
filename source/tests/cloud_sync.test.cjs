"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const Core = require("../scene_core.js");
const source = name => fs.readFileSync(path.join(__dirname, "..", name), "utf8");
const format = "mwi-layu-loadouts-cloud";
const memoryKey = (c, type = "foraging", act = "pear") => "mwi-layu:action-loadouts:v1:" +
  JSON.stringify(["https://milkywayidle.com", c, "/action_types/" + type, "/actions/" + act]);
function device() {
  const scopes = new Map(), data = new Map();
  const localStorage = { get length() { return data.size; }, key: i => [...data.keys()][i],
    getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  const app = { Core, Store: { async mergeCloud(characterOwner, loadoutId, incoming, merge) {
    const owner = characterOwner + "|" + loadoutId;
    const scenes = merge(scopes.get(owner) || [], incoming);
    scopes.set(owner, scenes); return { scenes, changed: [] };
  } } };
  const location = { origin: "https://milkywayidle.com" };
  vm.runInNewContext(source("action_memory.js") + source("cloud_sync.js"), { MWILoadoutScenes: app, localStorage, location });
  let character = 123456;
  const owner = id => location.origin + "|" + character + "|" + id;
  return { data, app, rows: (id = 12) => scopes.get(owner(id)), set: (rows, id = 12) => scopes.set(owner(id), rows),
    switch: id => { character = id; }, sync: (io, id = 12) => app.Cloud.synchronize(character, id, io, () => character, () => {}) };
}
function row(name, id = 12) {
  return { id: randomUUID(), name, revision: randomUUID(), parentId: id, createdAt: 1, updatedAt: 1, removedAt: null,
    snapshot: Core.snapshot({ id, name: "parent", actionTypeHrid: "", wearableMap: {}, useExactEnhancement: true }) };
}
function edit(scene, patch) {
  return { ...scene, ...patch, updatedAt: scene.updatedAt + 1, revision: randomUUID(), ancestors: [...(scene.ancestors || []), scene.revision] };
}
function boards() {
  const texts = new Map(), writes = [];
  return { texts, writes, io: async (id, text) => {
    if (text === undefined) return texts.get(id) || "";
    writes.push(id); texts.set(id, text);
  } };
}
test("two devices converge, including existing v1 data, zero selection, branches, removals and independent characters", async () => {
  const a = device(), b = device(), { io, writes } = boards();
  await a.sync(io); assert.equal(writes.length, 0);
  const first = row("副本装备"), second = row("组队");
  a.set([first]); b.set([second]);
  a.data.set(memoryKey(123456), JSON.stringify({ version: 1, loadoutId: 0 }));
  a.data.set(memoryKey(777), JSON.stringify({ version: 1, loadoutId: 99 }));
  await a.sync(io); await b.sync(io); await a.sync(io);
  assert.equal(b.data.has(memoryKey(777)), false);
  assert.equal(b.data.has(memoryKey(123456)), false);
  await a.sync(io, 0); await b.sync(io, 0);
  assert.equal(JSON.parse(b.data.get(memoryKey(123456))).loadoutId, 0);
  assert.deepEqual(Array.from(a.rows(), r => r.id), Array.from(b.rows(), r => r.id));
  const count = writes.length; await b.sync(io); assert.equal(writes.length, count);
  for (const [d, name] of [[a, "A改名"], [b, "B改名"]]) d.set(d.rows().map(r => r.id === first.id ? edit(r, {name}) : r));
  await a.sync(io); await b.sync(io); await a.sync(io);
  assert.equal(a.rows().length, 3);
  assert.ok(a.rows().some(r => r.name.endsWith("（冲突副本）")));
  a.set(a.rows().map(r => r.id === first.id ? edit(r, {removedAt: 4}) : r));
  await a.sync(io); await b.sync(io); assert.equal(b.rows().find(r => r.id === first.id).removedAt, 4);
  b.set(b.rows().map(r => r.id === first.id ? edit(r, {removedAt: null}) : r));
  await b.sync(io); await a.sync(io); assert.equal(a.rows().find(r => r.id === first.id).removedAt, null);
  a.switch(777); await a.sync(io); assert.equal(a.rows().length, 0);
});
test("reject foreign text and concurrent writes without replacing clipboard contents", async () => {
  const a = device(), {texts, writes, io} = boards(); a.set([row("本机")]);
  for (const invalid of ["shared notes", JSON.stringify({format, version:1, character:77, scenes:[], memories:[]})]) {
    texts.set("123456loadout12", invalid); await assert.rejects(a.sync(io), /保留原文/); assert.equal(writes.length, 0);
  }
  let calls = 0;
  await assert.rejects(a.sync(async () => ++calls === 1 ? "" : "new text"), /重新合并/);
  assert.equal(calls, 2); assert.equal(a.rows().length, 1);
  await assert.rejects(a.sync(async () => { a.switch(77); return ""; }), /角色已切换/);
});
test("transport uses the character's writable board, anonymous GET and PUT, rejects locked or unrelated responses", async () => {
  let options;
  const ctx = { GM_xmlhttpRequest: o => { options = o; } };
  vm.runInNewContext(source("clipboard_transport.js"), ctx);
  const board = { clip_name:"123456loadout12", text_content:null, has_password:false, files:[] };
  const receive = value => options.onload({status:200,responseText:JSON.stringify(value)});
  const read = ctx.mwiLoadoutClipboard("123456loadout12");
  assert.equal(options.url, "https://clipboard.im/api/clipboard/123456loadout12");
  assert.equal(options.method, "GET"); assert.equal(options.anonymous, true); receive(board); assert.equal(await read, "");
  for (const override of [{has_password:true},{files:["file"]},{clip_name:"wrong"},{text_content:42}]) {
    const rejected = ctx.mwiLoadoutClipboard("123456loadout12"); receive({...board,...override}); await assert.rejects(rejected);
  }
  const text = JSON.stringify({format, version:2, character:123456, loadoutId:12, scenes:[], memories:[]});
  const write = ctx.mwiLoadoutClipboard("123456loadout12",text); assert.equal(options.method, "PUT");
  assert.deepEqual(JSON.parse(options.data), {text_content:text}); receive({}); await write;
  assert.throws(() => ctx.mwiLoadoutClipboard("77")); assert.throws(() => ctx.mwiLoadoutClipboard(77,text));
});

test("independent boards isolate scenes and action memories, including a reassignment", async () => {
  const a = device(), b = device(), {texts, io} = boards(), key = memoryKey(123456);
  a.set([row("配装一")]); a.set([row("配装二", 22)], 22);
  a.data.set(key, JSON.stringify({version:1, loadoutId:12, updatedAt:1}));
  await a.sync(io); const first = texts.get("123456loadout12");
  await a.sync(io, 22);
  const second = JSON.parse(texts.get("123456loadout22"));
  assert.deepEqual(second.scenes.map(r => r.parentId), [22]); assert.equal(second.memories.length, 0);
  assert.equal(texts.get("123456loadout12"), first);
  a.data.set(key, JSON.stringify({version:1, loadoutId:22, updatedAt:2}));
  await a.sync(io, 22);
  await b.sync(io, 22); await b.sync(io, 12);
  assert.equal(JSON.parse(b.data.get(key)).loadoutId, 22);
  assert.equal(JSON.parse(texts.get("123456loadout12")).memories.length, 0);
  assert.equal(b.rows()[0].name, "配装一"); assert.equal(b.rows(22)[0].name, "配装二");
  const bad = JSON.parse(first);
  for (const override of [{loadoutId:22}, {scenes:second.scenes}, {memories:[{...bad.memories[0],loadoutId:22}]}]) {
    const foreign = JSON.stringify({...bad,...override});
    texts.set("123456loadout12", foreign);
    await assert.rejects(b.sync(io), /保留原文/);
    assert.equal(texts.get("123456loadout12"), foreign);
  }
  assert.notEqual(a.app.Cloud.boardName(12,345), a.app.Cloud.boardName(123,45));
});

function scheduledDevice() {
  const ids = Array.from({length:14}, (_, i) => i + 1);
  const requests = [], events = {}, timers = new Map(), boards = new Map();
  let clock = 0, sequence = 0;
  const document = { hidden:false, addEventListener: (type, fn) => { events[type] = fn; } };
  const navigator = { onLine:true };
  const app = { Core, Adapter:{cloudContext:() => ({character:71, loadoutIds:ids})},
    Store:{mergeCloud:async () => ({scenes:[],changed:[]})}, ActionMemory:{mergeCloud:() => []} };
  const ctx = { MWILoadoutScenes:app, location:{origin:"test"}, document, navigator,
    Date:class extends Date { static now() { return clock; } },
    setTimeout(fn, delay) { timers.set(++sequence,{time:clock+delay, fn}); return sequence; },
    clearTimeout: id => timers.delete(id), addEventListener: (type, fn) => { events[type] = fn; },
    __mwiLoadoutClipboardV2: async (name, text) => {
      requests.push(name);
      if (text === undefined) return boards.get(name) || "";
      boards.set(name,text);
    } };
  vm.runInNewContext(source("cloud_sync.js"), ctx);
  async function advance(to) {
    while (timers.size) {
      const [id, task] = [...timers.entries()].sort((a,b)=>a[1].time-b[1].time)[0];
      if (task.time > to) break;
      timers.delete(id); clock = task.time;
      await task.fn();
    }
    clock = to;
  }
  return {ctx,requests,events,advance,boards,cloud:app.Cloud};
}
test("ten idle foreground minutes prioritize one of 14 loadouts and bound remote checks", async t => {
  const {cloud,requests,advance} = scheduledDevice();
  cloud.start(()=>{}); cloud.setActive(71, 12);
  await advance(599999);
  const activeCount = requests.filter(name=>name==="71loadout12").length;
  assert.equal(requests[0],"71loadout12");
  assert.equal(new Set(requests).size,15);
  assert.ok(activeCount >= 19 && activeCount <= 20);
  assert.equal(requests.length-activeCount,28);
  t.diagnostic("GET in 10 minutes: "+requests.length+" (active "+activeCount+", other boards 28)");
});
test("background polling pauses, repeated offline edits coalesce and resume before cold boards", async () => {
  const {cloud,ctx,requests,advance,events} = scheduledDevice();
  cloud.start(()=>{}); ctx.document.hidden=true; events.visibilitychange();
  await advance(600000); assert.equal(requests.length,0);
  ctx.navigator.onLine=false;
  for(let i=0;i<20;i++) cloud.changed(71,12);
  assert.match(cloud.status(71,12),/等待联网/);
  ctx.document.hidden=false; events.visibilitychange(); await advance(610000);
  assert.equal(requests.length,0);
  ctx.navigator.onLine=true; events.online(); await advance(611000);
  assert.equal(requests[0],"71loadout12");
  assert.equal(requests.filter(name=>name==="71loadout12").length,1);
});
test("an edit arriving during a running sync gets exactly one follow-up", async () => {
  const {cloud,ctx,requests,advance} = scheduledDevice();
  let finish;
  ctx.__mwiLoadoutClipboardV2 = async name => {
    requests.push(name);
    if (requests.length===1) return new Promise(resolve=>{finish=resolve});
    return "";
  };
  cloud.changed(71,12);
  const draining = advance(250);
  assert.equal(typeof finish,"function");
  for(let i=0;i<20;i++) cloud.changed(71,12);
  finish(""); await draining;
  assert.deepEqual(requests,["71loadout12","71loadout12"]);
});
test("one action key scan serves a batch and a cross-tab storage event invalidates it", () => {
  const data = new Map(), app = {}, events = {}; let keyReads=0;
  for(let i=0;i<14;i++) data.set(memoryKey(71,"foraging","fruit"+i), JSON.stringify({version:1,loadoutId:i+1}));
  const localStorage = {length:data.size,key:i=>{keyReads++;return [...data.keys()][i]},getItem:k=>data.get(k),
    setItem:(k,v)=>data.set(k,v)};
  const location={origin:"https://milkywayidle.com"};
  vm.runInNewContext(source("action_memory.js"),{MWILoadoutScenes:app,location,localStorage,
    addEventListener:(type,fn)=>{events[type]=fn}});
  for(let i=1;i<=14;i++) assert.equal(app.ActionMemory.mergeCloud(71,i,[]).length,1);
  assert.equal(keyReads,14);
  const key=memoryKey(71,"foraging","fruit0");
  data.set(key,JSON.stringify({version:1,loadoutId:2,updatedAt:3}));events.storage({key});
  assert.equal(app.ActionMemory.mergeCloud(71,1,[]).length,0);
  assert.equal(app.ActionMemory.mergeCloud(71,2,[]).length,2);assert.equal(keyReads,28);
});

test("occupied boards pause independently until manually checked, and labels release subscribers", async () => {
  const { cloud, ctx, advance, requests } = scheduledDevice();
  let occupied = true;
  ctx.__mwiLoadoutClipboardV2 = async name => {
    requests.push(name);
    return occupied && name === "71loadout12" ? "他人笔记" : "";
  };
  const updates = [];
  const stop = cloud.subscribe(71, 12, () => updates.push(cloud.info(71, 12).label));
  cloud.start(() => {}); cloud.changed(71, 12);
  await advance(599999);
  const state = cloud.info(71, 12);
  assert.equal(state.warning, true); assert.equal(state.checked, null); assert.equal(state.kind, "blocked");
  assert.match(state.detail, /保留原文/);
  assert.equal(requests.filter(id => id === "71loadout12").length, 1);
  assert.equal(cloud.info(71, 11).warning, false);
  occupied = false; cloud.request(71, 12);
  await advance(601000);
  assert.equal(cloud.info(71, 12).warning, false); assert.ok(cloud.info(71, 12).checked > 0);
  assert.ok(updates.includes("同步已暂停"));
  stop(); const count = updates.length;
  cloud.changed(71, 12); assert.equal(updates.length, count);
});

test("edit/delete branches and older conflict copies are attributable to the correct loadout scene", () => {
  const { app: { Cloud } } = device();
  const base = row("采集"), deleted = edit(base, {removedAt: 2}), kept = { ...edit(base, {name:"采集新版"}), updatedAt: 3 };
  const rows = Cloud.mergeScenes([deleted], [kept]);
  const pairs = Cloud.conflictPairs(rows);
  assert.equal(pairs.length, 1); assert.equal(pairs[0][1].removedAt, 2);
  assert.equal(pairs[0][1].conflictOf, base.id);
  const staleClient = rows.map(({conflictOf, ...r}) => r);
  assert.equal(Cloud.conflictPairs(Cloud.mergeScenes(rows, staleClient)).length, 1);
  const active = staleClient.map(r => ({ ...r, removedAt: null }));
  assert.equal(Cloud.conflictPairs(active).length, 1);
  assert.equal(Cloud.conflictPairs([row("手工命名（冲突副本）")]).length, 0);
});

test("old development loader reports setup required instead of endlessly retrying", async () => {
  const { cloud, ctx, advance } = scheduledDevice();
  delete ctx.__mwiLoadoutClipboardV2;
  cloud.start(() => {}); cloud.setActive(71, 12);
  await advance(600000);
  assert.equal(cloud.info(71, 12).kind, "setup");
  assert.equal(cloud.info(71, 12).label, "需要更新加载器");
  assert.equal(cloud.info(71, 12).checked, null);
  cloud.changed(71, 12);
  assert.equal(cloud.info(71, 12).kind, "setup");
  ctx.__mwiLoadoutClipboardV2 = async () => "";
  cloud.request(71, 12); await advance(601000);
  assert.equal(cloud.info(71, 12).kind, "ok");
});

test("native configurations publish without scenes, migrate v2 and avoid unchanged uploads", async () => {
  const a = device(), {io, texts, writes} = boards();
  let raw = row("unused").snapshot.raw;
  a.app.Adapter = { nativeSnapshot: () => Core.snapshot(raw) };
  texts.set("123456loadout12", JSON.stringify({format,version:2,character:123456,loadoutId:12,scenes:[],memories:[]}));
  const counts = await a.sync(io);
  assert.equal(counts.nativeAvailable, true); assert.equal(counts.nativeMismatch, false);
  const first = JSON.parse(texts.get("123456loadout12"));
  assert.equal(first.version, 3); assert.deepEqual(first.native.snapshot.raw, raw); assert.equal(first.scenes.length, 0);
  const count = writes.length; await a.sync(io); assert.equal(writes.length, count);
  raw = {...raw,name:"改名后",wearableMap:{"/item_locations/head":"1::/item_locations/head::/items/hood::7"}};
  await a.sync(io);
  assert.deepEqual(JSON.parse(texts.get("123456loadout12")).native.snapshot.raw, raw);
  for (const native of [{...first.native,snapshot:Core.snapshot({...raw,id:99})}, {...first.native,updatedAt:-1}]) {
    texts.set("123456loadout12", JSON.stringify({...first,native}));
    await assert.rejects(a.sync(io));
  }
});

test("stale devices retain newer native shares and local-only edits do not erase scene records", async () => {
  const a = device(), b = device(), {io,texts} = boards();
  const initial = row("unused").snapshot.raw;
  let rawA = initial, rawB = initial;
  a.app.Adapter = {nativeSnapshot:()=>Core.snapshot(rawA)};
  b.app.Adapter = {nativeSnapshot:()=>Core.snapshot(rawB)};
  a.set([row("保留子方案")]);
  await a.sync(io); await b.sync(io);
  rawA = {...initial,name:"新分享"}; await a.sync(io);
  let counts = await b.sync(io); assert.equal(counts.nativeMismatch,true);
  assert.equal(JSON.parse(texts.get("123456loadout12")).native.snapshot.raw.name,"新分享");
  await b.sync(io); assert.equal(JSON.parse(texts.get("123456loadout12")).native.snapshot.raw.name,"新分享");
  const fresh = device(); fresh.app.Adapter = {nativeSnapshot:()=>Core.snapshot(initial)};
  counts = await fresh.sync(io); assert.equal(counts.nativeMismatch,true);
  rawB = rawA; counts = await b.sync(io); assert.equal(counts.nativeMismatch,false);
  assert.equal(JSON.parse(texts.get("123456loadout12")).scenes[0].name,"保留子方案");
});

test("native edits during a read are rechecked before upload; zero board has no native payload", async () => {
  const a = device(), store = boards();
  let raw = row("unused").snapshot.raw, reads = 0;
  a.app.Adapter = {nativeSnapshot:()=>Core.snapshot(raw)};
  const io = async (id,text) => {
    if (text === undefined && ++reads === 2) raw = {...raw,name:"同步期间修改"};
    return store.io(id,text);
  };
  await assert.rejects(a.sync(io), /原生配装刚刚变化/); assert.equal(store.writes.length,0);
  await a.sync(store.io); assert.equal(JSON.parse(store.texts.get("123456loadout12")).native.snapshot.raw.name,raw.name);
  await a.sync(store.io,0); assert.equal(store.texts.has("123456loadout0"),false);
});

test("transport accepts v3 native shares and advertises the required bridge version", async () => {
  let options;
  const ctx = { GM_xmlhttpRequest:o=>{options=o;} };
  vm.runInNewContext(source("clipboard_transport.js"),ctx);
  assert.equal(ctx.mwiLoadoutClipboard.protocolVersion,3);
  const text = JSON.stringify({format,version:3,character:123456,loadoutId:12,scenes:[],memories:[],
    native:{snapshot:row("unused").snapshot,updatedAt:1}});
  const task = ctx.mwiLoadoutClipboard("123456loadout12",text);
  assert.equal(options.method,"PUT");
  options.onload({status:200,responseText:"{}"}); await task;
});

test("scheduled native sync detects edits and requires explicit choice for a differing fresh client", async () => {
  const {ctx,advance,boards,cloud} = scheduledDevice(), app = ctx.MWILoadoutScenes;
  const raw = {...row("unused",12).snapshot.raw,name:"当前游戏"};
  app.Adapter.nativeSnapshot = (character,id) => Core.snapshot({...raw,id});
  app.Adapter.cloudContext = () => ({character:71,loadoutIds:[12],loadouts:{12:raw}});
  ctx.__mwiLoadoutClipboardV2.protocolVersion = 3;
  boards.set("71loadout12",JSON.stringify({format,version:3,character:71,loadoutId:12,scenes:[],memories:[],
    native:{snapshot:Core.snapshot({...raw,name:"另一台设备"}),updatedAt:1}}));
  cloud.start(()=>{}); await advance(1000);
  assert.equal(cloud.info(71,12).nativeMismatch,true);
  assert.match(cloud.info(71,12).label,/不同/);
  cloud.publishCurrent(71,12); await advance(2000);
  assert.equal(cloud.info(71,12).nativeMismatch,false);
  assert.equal(JSON.parse(boards.get("71loadout12")).native.snapshot.raw.name,"当前游戏");
  raw.name = "刚编辑的配装"; await advance(31000);
  assert.equal(JSON.parse(boards.get("71loadout12")).native.snapshot.raw.name,raw.name);
  assert.equal(cloud.info(71,12).label,"配装已同步");
});
