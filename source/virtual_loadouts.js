(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  let opening;
  const pending = new Map();
  const listeners = new Set();
  function watch(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function emitChange(scope) {
    for (const fn of listeners) {
      try { fn(scope); } catch (_) { /* Listener errors must not affect storage commits. */ }
    }
  }
  function source(value) {
    let name = String(value || "").trim();
    if (name.startsWith("https://")) {
      const url = new URL(name);
      if (url.origin !== "https://clipboard.im" || url.search || url.hash || url.username || url.password)
        throw Error("请使用配装助手复制的 clipboard.im 分享地址。");
      name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    }
    const match = /^([1-9]\d*)loadout([1-9]\d*)$/.exec(name);
    if (!match || !match.slice(1).every(v => Number.isSafeInteger(Number(v))))
      throw Error("请粘贴配装助手的剪贴板地址或 ID，来源需要包含原生配装快照或子方案。");
    return { board: name, character: Number(match[1]), loadoutId: Number(match[2]) };
  }
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("mwi-layu-virtual-loadouts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "key" })
        .createIndex("owner", "owner", { unique: false });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = request.onblocked = () => { opening = null; reject(Error("无法打开虚拟配装存储，请检查浏览器存储权限。")); };
    });
    return opening;
  }
  async function transaction(owner, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("entries", mode), store = tx.objectStore("entries");
      const request = store.index("owner").getAll(owner);
      let result, failure;
      request.onsuccess = () => {
        try { result = work(request.result, store); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => {
        if (mode === "readwrite") emitChange(owner);
        resolve(result);
      };
      tx.onabort = tx.onerror = () => reject(failure || Error("虚拟配装保存失败，请检查存储空间后重试。"));
    });
  }
  const owner = character => location.origin + "|" + character;
  const list = character => transaction(owner(character), "readonly", rows => rows);
  async function read(board) {
    const parsed = source(board), io = root.__mwiLoadoutClipboardV2;
    if (typeof io !== "function") throw Error("请更新开发加载器后刷新游戏页面。");
    const text = await io(parsed.board); // Subscriptions always read, never write to the author's board.
    const doc = app.Cloud.parse(parsed.character, parsed.loadoutId, text);
    const scenes = doc.scenes.filter(row => row.removedAt == null);
    if (doc.native) scenes.unshift({ id: "native:" + parsed.loadoutId, name: "当前配装 · " + doc.native.snapshot.raw.name,
      snapshot: doc.native.snapshot, updatedAt: doc.native.updatedAt, native: true });
    return scenes;
  }
  async function subscribe(character, input) {
    const { board } = source(input), scope = owner(character);
    const scenes = await read(board);
    if (!scenes.length) throw Error("这个地址尚无可订阅的配装内容，请让分享者更新配装助手并完成同步。");
    return transaction(scope, "readwrite", (rows, store) => {
      const existing = rows.find(row => row.board === board);
      if (existing) return existing;
      const row = { key: scope + "|" + board, token: crypto.randomUUID(), owner: scope,
        board, scenes, checked: Date.now(), error: "", attempted: Date.now() };
      store.add(row); return row;
    });
  }
  function refresh(character, entry) {
    if (!entry.board) return Promise.resolve();
    if (pending.has(entry.key)) return pending.get(entry.key);
    const task = (async () => {
      let scenes, error = "";
      try { scenes = await read(entry.board); }
      catch (failure) { error = failure.message || "订阅更新失败"; }
      return transaction(owner(character), "readwrite", (rows, store) => {
        const current = rows.find(row => row.key === entry.key && row.token === entry.token);
        if (!current) return;
        store.put({ ...current, ...(scenes ? { scenes, checked: Date.now() } : {}),
          attempted: Date.now(), error });
      });
    })().finally(() => pending.delete(entry.key));
    pending.set(entry.key, task); return task;
  }
  function save(character, title, snapshot) {
    const validated = app.Core.validateSnapshot(snapshot), scope = owner(character);
    const row = { key: scope + "|" + crypto.randomUUID(), token: crypto.randomUUID(), owner: scope,
      board: null, scenes: [{ id: crypto.randomUUID(), name: app.Core.name(title), snapshot: validated }],
      checked: Date.now(), error: "" };
    return transaction(scope, "readwrite", (_, store) => { store.add(row); return row; });
  }
  function remove(character, entry) {
    return transaction(owner(character), "readwrite", (rows, store) => {
      const current = rows.find(row => row.key === entry.key && row.token === entry.token);
      if (current) store.delete(current.key);
      return current || null;
    });
  }
  function restore(character, entry) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    if (!entry || typeof entry.key !== "string" || typeof entry.token !== "string" || !Array.isArray(entry.scenes))
      throw Error("无法恢复这项虚拟配装。");
    const scope = owner(character);
    const validatedScenes = entry.scenes.map(row => ({
      ...row,
      name: app.Core.name(row.name),
      snapshot: app.Core.validateSnapshot(row.snapshot)
    }));
    const board = entry.board ? source(entry.board).board : null;
    const restored = {
      key: entry.key, token: entry.token, owner: scope, board,
      scenes: validatedScenes,
      checked: Number.isSafeInteger(entry.checked) ? entry.checked : Date.now(),
      error: typeof entry.error === "string" ? entry.error : "",
      ...(Number.isSafeInteger(entry.attempted) ? { attempted: entry.attempted } : {})
    };
    return transaction(scope, "readwrite", (rows, store) => {
      const existing = rows.find(row => row.key === restored.key || (board && row.board === board));
      if (existing) return existing;
      store.add(restored);
      return restored;
    });
  }
  function exportBackup(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const portableSnapshot = (snapshot, title) => app.VirtualDraft?.portable
      ? app.VirtualDraft.portable(snapshot, title)
      : app.Core.validateSnapshot(snapshot);
    return JSON.stringify({
      format: "mwi-virtual-loadouts-backup",
      version: 1,
      entries: list.map(entry => entry.board ? {
        board: source(entry.board).board,
        checked: Number.isSafeInteger(entry.checked) ? entry.checked : Date.now(),
        scenes: (entry.scenes || []).map(row => ({
          id: String(row.id || crypto.randomUUID()),
          name: app.Core.name(row.name),
          ...(row.native ? { native: true } : {}),
          snapshot: app.Core.validateSnapshot(row.snapshot)
        }))
      } : {
        board: null,
        name: app.Core.name(entry.scenes?.[0]?.name),
        snapshot: portableSnapshot(entry.scenes?.[0]?.snapshot, entry.scenes?.[0]?.name)
      })
    }, null, 2);
  }
  async function importBackup(character, text) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    if (typeof text !== "string" || text.length > 5000000) throw Error("备份超过 5 MB，未导入。");
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Error("备份不是有效 JSON，未导入。"); }
    if (data?.format !== "mwi-virtual-loadouts-backup" || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 200)
      throw Error("虚拟配装备份格式无法识别，未导入。");
    const scope = owner(character);
    const portableSnapshot = (snapshot, title) => app.VirtualDraft?.portable
      ? app.VirtualDraft.portable(snapshot, title)
      : app.Core.validateSnapshot(snapshot);
    const parsed = data.entries.map(item => {
      if (!item || typeof item !== "object") throw Error("备份包含无效条目，未导入。");
      if (item.board) {
        const board = source(item.board).board;
        if (!Array.isArray(item.scenes)) throw Error("备份中的订阅条目格式无效，未导入。");
        return {
          key: scope + "|" + board, token: crypto.randomUUID(), owner: scope, board,
          scenes: item.scenes.map(row => ({
            id: String(row.id || crypto.randomUUID()),
            name: app.Core.name(row.name),
            ...(row.native ? { native: true } : {}),
            snapshot: app.Core.validateSnapshot(row.snapshot)
          })),
          checked: Number.isSafeInteger(item.checked) ? item.checked : Date.now(),
          attempted: 0, error: ""
        };
      }
      const title = app.Core.name(item.name);
      const snapshot = portableSnapshot(item.snapshot, title);
      return {
        key: scope + "|" + crypto.randomUUID(), token: crypto.randomUUID(), owner: scope, board: null,
        scenes: [{ id: crypto.randomUUID(), name: title, snapshot }],
        checked: Date.now(), error: ""
      };
    });
    const normalizeKey = scene => {
      try { return app.Core.stable(portableSnapshot(scene.snapshot, scene.name)); }
      catch (_) { return app.Core.stable(scene.snapshot); }
    };
    return transaction(scope, "readwrite", (rows, store) => {
      const existing = [...rows];
      let added = 0, skipped = 0;
      for (const item of parsed) {
        if (item.board) {
          if (existing.some(row => row.board === item.board)) { skipped++; continue; }
        } else {
          const targetKey = normalizeKey(item.scenes[0]);
          if (existing.some(row => !row.board && row.scenes[0]?.name === item.scenes[0].name && normalizeKey(row.scenes[0]) === targetKey)) {
            skipped++; continue;
          }
        }
        store.add(item);
        existing.push(item);
        added++;
      }
      return { added, skipped };
    });
  }
  function update(character, entry, title, snapshot) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    const validated = app.Core.validateSnapshot(snapshot), name = app.Core.name(title);
    return transaction(owner(character), "readwrite", (rows, store) => {
      const current = rows.find(row => row.key === entry.key && row.token === entry.token);
      if (!current) throw Error("这份虚拟配装已被移除，请另存为新配装。");
      if (current.board) throw Error("订阅内容只读，请先另存为本地副本。");
      if (app.Core.stable(current.scenes) !== app.Core.stable(entry.scenes)) throw Error("配装已在其他页面修改，请保留草稿并另存为新配装。");
      const row = { ...current, checked: Date.now(), scenes: [{ ...current.scenes[0], name, snapshot: validated }] };
      store.put(row); return row;
    });
  }
  async function adopt(character, scene, raw, title) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    const snapshot = app.Core.validateSnapshot(scene.snapshot);
    if ((snapshot.raw.actionTypeHrid || "") !== (raw.actionTypeHrid || ""))
      throw Error("请选择相同类型的原生配装。");
    const scopeOwner = owner(character);
    const rebound = { ...snapshot.raw, id: raw.id };
    for (const [location, hash] of Object.entries(rebound.wearableMap)) {
      const item = app.Core.item(hash);
      if (item) rebound.wearableMap[location] = `${character}::${location}::${item.itemHrid}::${item.enhancementLevel}`;
    }
    const ctx = { owner: scopeOwner, scope: scopeOwner + "|" + raw.id, raw: rebound };
    const row = await app.Store.create(ctx, title);
    app.Cloud.changed(character, raw.id);
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("mwi-layu-loadout-scenes");
      channel.postMessage({ scope: ctx.scope }); channel.close();
    }
    return row;
  }
  app.Virtual = Object.freeze({ source, list, subscribe, refresh, save, update, remove, restore, exportBackup, importBackup, adopt, watch });
})(globalThis);
