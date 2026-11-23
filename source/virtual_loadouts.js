(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  let opening;
  const pending = new Map();
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
      tx.oncomplete = () => resolve(result);
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
    });
  }
  async function adopt(character, scene, raw, title) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    const snapshot = app.Core.validateSnapshot(scene.snapshot);
    if ((snapshot.raw.actionTypeHrid || "") !== (raw.actionTypeHrid || ""))
      throw Error("请选择相同类型的原生配装。");
    const scopeOwner = owner(character);
    const ctx = { owner: scopeOwner, scope: scopeOwner + "|" + raw.id,
      raw: { ...snapshot.raw, id: raw.id } };
    const row = await app.Store.create(ctx, title);
    app.Cloud.changed(character, raw.id);
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("mwi-layu-loadout-scenes");
      channel.postMessage({ scope: ctx.scope }); channel.close();
    }
    return row;
  }
  app.Virtual = Object.freeze({ source, list, subscribe, refresh, save, remove, adopt });
})(globalThis);
