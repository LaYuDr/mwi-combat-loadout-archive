(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("mwi-layu-loadout-scenes", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("scenes", { keyPath: "id" });
        store.createIndex("scope", "scope", { unique: false });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { opening = null; reject(Error("无法打开子方案数据库，请检查浏览器存储权限后重试。")); };
      request.onblocked = () => { opening = null; reject(Error("数据库被其他标签页占用，请关闭旧标签页后重试。")); };
    });
    return opening;
  }
  async function transaction(scope, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("scenes", mode), store = tx.objectStore("scenes");
      const request = store.index("scope").getAll(scope);
      let result, error;
      request.onsuccess = () => {
        try { result = work(request.result, store); }
        catch (e) { error = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(error || Error("子方案未能保存，原有记录保持不变；请检查存储空间后重试。"));
    });
  }
  function unique(rows, title, except) {
    if (rows.some(row => row.id !== except && !row.removedAt && row.name === title))
      throw Error("已有同名子方案，请改名或选择“更新”。");
  }
  const Core = () => app.Core;
  function record(ctx, title, raw) {
    return { id: crypto.randomUUID(), scope: ctx.scope, owner: ctx.owner, parentId: raw.id,
      name: Core().name(title), snapshot: Core().snapshot(raw), revision: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), removedAt: null };
  }
  async function create(ctx, title) {
    const row = record(ctx, title, ctx.raw);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      unique(rows, row.name); store.add(row); return row;
    });
  }
  function revise(before) {
    return { ...before, updatedAt: Math.max(Date.now(), before.updatedAt + 1), revision: crypto.randomUUID(),
      ancestors: [...new Set([...(before.ancestors || []), before.revision])] };
  }
  function resolveConflict(ctx, main, copy, choice) {
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const pair = app.Cloud.conflictPairs(rows).find(([a, b]) => a.id === main.id && b.id === copy.id);
      if (!pair || pair[0].revision !== main.revision || pair[1].revision !== copy.revision)
        throw Error("这两个版本已有变化，请重新读取后再比较。");
      const [a, b] = pair;
      const retired = revise(b);
      delete retired.conflictOf;
      const originalName = b.name.replace(/（冲突副本）$/, "") || "子方案";
      if (choice === "both") {
        let index = 2;
        do { retired.name = originalName.slice(0, 48) + "（版本 " + index++ + "）"; }
        while (rows.some(row => row.id !== b.id && !row.removedAt && row.name === retired.name));
      } else if (choice === "a" || choice === "b") {
        const updated = revise(a);
        if (choice === "b") {
          Object.assign(updated, { name: originalName, snapshot: b.snapshot, removedAt: b.removedAt });
          if (updated.removedAt == null) unique(rows.filter(row => row.id !== b.id), updated.name, a.id);
        }
        store.put(updated);
        retired.removedAt = retired.updatedAt;
      } else throw Error("请选择要保留的版本。");
      store.put(retired);
    });
  }
  async function mutate(ctx, expected, action, value) {
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const before = rows.find(row => row.id === expected.id);
      if (!before || before.revision !== expected.revision) throw Error("这个子方案已在其他标签页更新，请重新读取后再操作。");
      const row = revise(before);
      if (action === "rename") { row.name = Core().name(value); unique(rows, row.name, row.id); }
      else if (action === "snapshot") row.snapshot = Core().snapshot(ctx.raw);
      else if (action === "remove") { row.removedAt = Date.now(); delete row.conflictOf; }
      else if (action === "restore") { unique(rows, row.name, row.id); row.removedAt = null; }
      else throw Error("无法识别的子方案操作。");
      store.put(row); return row;
    });
  }
  function parseBackup(text, ctx) {
    if (typeof text !== "string" || text.length > 5000000) throw Error("备份超过 5 MB，未导入。");
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Error("备份不是有效 JSON，未导入。"); }
    if (data?.format !== "mwi-layu-loadout-scenes" || data.schemaVersion !== 1 || data.scope !== ctx.scope ||
        !Array.isArray(data.scenes) || data.scenes.length > 200) throw Error("备份格式或所属角色、父配装不匹配，未导入。");
    return data.scenes.map(row => {
      const snapshot = Core().validateSnapshot(row.snapshot);
      if (snapshot.raw.id !== ctx.raw.id || (snapshot.raw.actionTypeHrid || "") !== (ctx.raw.actionTypeHrid || ""))
        throw Error("备份包含其他父配装或配装类型，未导入。");
      return record(ctx, row.name, snapshot.raw);
    });
  }
  async function importBackup(ctx, text) {
    const incoming = parseBackup(text, ctx);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const active = rows.filter(row => !row.removedAt), added = [];
      for (const row of incoming) {
        if (active.some(old => old.name === row.name && Core().stable(old.snapshot) === Core().stable(row.snapshot))) continue;
        unique(active, row.name);
        active.push(row); added.push(row);
      }
      for (const row of added) store.add(row);
      return added.length;
    });
  }
  async function mergeCloud(owner, loadoutId, remote, merge) {
    const scope = owner + "|" + loadoutId;
    if (!remote.length) {
      return transaction(scope, "readonly", local => ({ scenes: merge(local, remote), changed: [] }));
    }
    return transaction(scope, "readwrite", (local, store) => {
      const previous = new Map(local.map(row => [row.id, row]));
      const scenes = merge(local, remote);
      const changed = new Set();
      for (const scene of scenes) {
        if (scene.parentId !== loadoutId) throw Error("子方案不属于当前配装。");
        const before = previous.get(scene.id);
        if (before && before.scope !== scope) throw Error("方案编号与本机父配装冲突。");
        if (before && before.revision === scene.revision && before.conflictOf === scene.conflictOf &&
            Core().stable(before.ancestors || []) === Core().stable(scene.ancestors || [])) continue;
        const row = { ...scene, owner, scope };
        if (before) store.put(row);
        else store.add(row); // Never replace an ID belonging to another character.
        changed.add(scope);
      }
      return { scenes, changed: [...changed] };
    });
  }
  app.Store = Object.freeze({ resolveConflict, mergeCloud, list: scope => transaction(scope, "readonly", rows => rows), create, mutate, importBackup,
    exportBackup: (ctx, rows) => JSON.stringify({ format: "mwi-layu-loadout-scenes", schemaVersion: 1, scope: ctx.scope,
      scenes: rows.filter(row => !row.removedAt).map(({ name, snapshot }) => ({ name, snapshot })) }, null, 2) });
})(globalThis);
