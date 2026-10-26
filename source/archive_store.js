(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWILoadoutStore = factory();
})(globalThis, function () {
  "use strict";
  const DB_NAME = "mwi-loadout-archive";
  function open(factory = globalThis.indexedDB) {
    return new Promise((resolve, reject) => {
      if (!factory) { reject(new Error("浏览器未提供 IndexedDB，档案尚未保存。")); return; }
      const request = factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("archives", { keyPath: "id" });
      request.onerror = () => reject(new Error("无法打开档案库，请检查此网站的存储权限。"));
      request.onblocked = () => reject(new Error("档案库升级被旧标签页阻止，请关闭旧模拟器标签页后重试。"));
      request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); resolve(db); };
    });
  }
  async function create(factory) {
    const db = await open(factory);
    function run(mode, action) {
      return new Promise((resolve, reject) => {
        let result;
        const tx = db.transaction("archives", mode);
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(new Error("档案写入未完成，请检查可用空间并重试；已有档案保留。"));
        try { action(tx.objectStore("archives"), value => { result = value; }); }
        catch (error) { tx.abort(); reject(error); }
      });
    }
    return Object.freeze({
      all: () => run("readonly", (store, done) => { store.getAll().onsuccess = e => done(e.target.result); }),
      get: id => run("readonly", (store, done) => { store.get(id).onsuccess = e => done(e.target.result); }),
      async autoSave(row) {
        return run("readwrite", (store, done) => {
          store.get(row.id).onsuccess = e => {
            const previous = e.target.result;
            if (previous && previous.capturedAt > row.capturedAt) { done("stale"); return; }
            if (previous && !previous.deletedAt && previous.fingerprint === row.fingerprint) { done("unchanged"); return; }
            store.put({ ...row, createdAt: previous?.createdAt || row.createdAt }); done("saved");
          };
        });
      },
      // Validate/prepare the complete backup before starting this atomic transaction.
      addNamed: rows => run("readwrite", (store, done) => {
        store.getAll().onsuccess = e => {
          const seen = new Set(e.target.result.filter(r => !r.deletedAt && r.kind === "named").map(r => `${r.fingerprint}|${r.name}`));
          let count = 0;
          for (const row of rows) {
            const key = `${row.fingerprint}|${row.name}`;
            if (seen.has(key)) continue;
            store.add(row); seen.add(key); count++;
          }
          done(count);
        };
      }),
      update: (id, patch) => run("readwrite", (store, done) => {
        store.get(id).onsuccess = e => {
          if (!e.target.result) { done(false); return; }
          store.put({ ...e.target.result, ...patch, id }); done(true);
        };
      }),
      close: () => db.close()
    });
  }
  return Object.freeze({ DB_NAME, open, create });
});
