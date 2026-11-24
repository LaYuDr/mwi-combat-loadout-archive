"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), { randomUUID } = require("node:crypto");
const Core = require("../scene_core.js");
function harness() {
  const records = new Map(), calls = [], adopted = [];
  let text = "", current = 71;
  // Model transaction commit/abort and owner index to exercise persistent subscription races.
  const indexedDB = { open() {
    const req = { result: { transaction() {
      const staged = new Map(records);
      let aborted = false;
      const tx = { abort() { aborted = true; tx.onabort(); }, objectStore: () => ({
        index: () => ({ getAll: owner => {
          const get = { result: [...staged.values()].filter(row => row.owner === owner) };
          queueMicrotask(() => {
            get.onsuccess();
            if (!aborted) { records.clear(); for (const [k,v] of staged) records.set(k,v); tx.oncomplete(); }
          });
          return get;
        } }),
        add: row => { if (staged.has(row.key)) throw Error("duplicate"); staged.set(row.key, row); },
        put: row => staged.set(row.key, row), delete: key => staged.delete(key)
      }) };
      return tx;
    } } };
    queueMicrotask(() => req.onsuccess()); return req;
  } };
  const app = { Core, Adapter: { cloudContext: () => ({ character: current }) },
    Store: { create: async (ctx, title) => { adopted.push({ ctx, title }); return {}; } } };
  const ctx = { MWILoadoutScenes: app, indexedDB, location: { origin: "https://milkywayidle.com" },
    crypto: { randomUUID }, URL, __mwiLoadoutClipboardV2: async (...args) => { calls.push(args); return typeof text === "function" ? text() : text; } };
  for (const file of ["cloud_sync.js", "virtual_loadouts.js"])
    vm.runInNewContext(fs.readFileSync(require.resolve("../" + file), "utf8"), ctx);
  return { app, calls, adopted, set: value => { text = value; }, switch: value => { current = value; } };
}
const snapshot = Core.snapshot({id:12,name:"分享配装",actionTypeHrid:"",wearableMap:{},useExactEnhancement:true});
const scene = { id:randomUUID(), revision:randomUUID(), parentId:12, name:"采集",
  createdAt:1, updatedAt:1, removedAt:null, snapshot };
const doc = scenes => JSON.stringify({format:"mwi-layu-loadouts-cloud",version:2,character:72,loadoutId:12,scenes,memories:[]});
test("a native-only v3 share can be subscribed and followed without any saved scenes", async () => {
  const h = harness(), V = h.app.Virtual;
  const payload = {format:"mwi-layu-loadouts-cloud",version:3,character:72,loadoutId:12,scenes:[],memories:[],
    native:{snapshot,updatedAt:1}};
  h.set(JSON.stringify(payload));
  const entry = await V.subscribe(71,"72loadout12");
  assert.equal(entry.scenes.length,1); assert.equal(entry.scenes[0].native,true);
  assert.equal(entry.scenes[0].snapshot.raw.name,"分享配装");
  payload.native.snapshot = Core.snapshot({...snapshot.raw,name:"新配置"});
  payload.scenes = [scene]; h.set(JSON.stringify(payload)); await V.refresh(71,entry);
  const updated = (await V.list(71))[0];
  assert.equal(updated.scenes.length,2); assert.equal(updated.scenes[0].snapshot.raw.name,"新配置");
  assert.ok(h.calls.every(args=>args.length===1));
});
test("subscriptions validate sources, cache offline, follow removals, isolate characters and only read", async () => {
  const h = harness(), V = h.app.Virtual;
  for (const invalid of ["https://evil.test/72loadout12", "https://clipboard.im/s/abc", "72loadout0"])
    assert.throws(() => V.source(invalid));
  await assert.rejects(V.subscribe(71,"72loadout12"),/尚无/);
  h.set(doc([scene]));
  const entry = await V.subscribe(71,"https://clipboard.im/72loadout12");
  await V.subscribe(71,"72loadout12");
  assert.equal((await V.list(71)).length,1);
  assert.equal((await V.list(72)).length,0);
  h.set(() => { throw Error("offline"); }); await V.refresh(71,entry);
  assert.equal((await V.list(71))[0].scenes[0].name,"采集");
  assert.match((await V.list(71))[0].error,/offline/);
  h.set(doc([{...scene, name:"新版", revision:randomUUID()}])); await V.refresh(71,entry);
  assert.equal((await V.list(71))[0].scenes[0].name,"新版");
  h.set(doc([{...scene,removedAt:2}])); await V.refresh(71,entry);
  assert.equal((await V.list(71))[0].scenes.length,0);
  assert.ok(h.calls.every(args => args.length === 1));
});
test("unsubscribing during refresh cannot recreate a removed subscription", async () => {
  const h = harness(), V = h.app.Virtual;
  h.set(doc([scene])); const entry = await V.subscribe(71,"72loadout12");
  let finish; h.set(() => new Promise(resolve => {finish=resolve}));
  const running = V.refresh(71,entry);
  assert.equal(V.refresh(71,entry),running);
  await V.remove(71,entry); finish(doc([scene])); await running;
  assert.equal((await V.list(71)).length,0);
});
test("local virtual copies retain data and adoption rebinds parent ID without altering source", async () => {
  const h = harness(), V = h.app.Virtual;
  const row = await V.save(71,"本地方案",snapshot);
  assert.equal(row.board,null); assert.equal((await V.list(71)).length,1);
  h.app.Cloud = {changed() {}};
  await V.adopt(71,scene,{...snapshot.raw,id:55},"我的方案");
  assert.equal(h.adopted[0].ctx.raw.id,55); assert.equal(scene.snapshot.raw.id,12);
  assert.equal(h.adopted[0].ctx.scope,"https://milkywayidle.com|71|55");
  await assert.rejects(V.adopt(71,scene,{...snapshot.raw,actionTypeHrid:"/action_types/combat"},"无效"),/同类型/);
  h.switch(72); await assert.rejects(V.adopt(71,scene,snapshot.raw,"无效"),/角色/);
});
test("virtual removal can be restored and backup export/import deduplicates local copies and subscriptions", async () => {
  const h = harness(), V = h.app.Virtual;
  h.set(doc([scene]));
  const sub = await V.subscribe(71, "72loadout12");
  const local = await V.save(71, "本地副本", snapshot);
  const removed = await V.remove(71, local);
  assert.equal(removed.key, local.key);
  assert.equal((await V.list(71)).length, 1);
  await V.restore(71, removed);
  assert.equal((await V.list(71)).length, 2);
  const backup = V.exportBackup(await V.list(71));
  assert.deepEqual({ ...await V.importBackup(71, backup) }, { added: 0, skipped: 2 });
  await V.remove(71, sub);
  await V.remove(71, local);
  assert.equal((await V.list(71)).length, 0);
  assert.deepEqual({ ...await V.importBackup(71, backup) }, { added: 2, skipped: 0 });
  const restored = await V.list(71);
  assert.equal(restored.length, 2);
  assert.ok(restored.some(r => r.board === "72loadout12"));
  assert.ok(restored.some(r => !r.board && r.scenes[0].name === "本地副本"));
  await assert.rejects(V.importBackup(71, JSON.stringify({ format: "unknown" })), /格式无法识别/);
});
