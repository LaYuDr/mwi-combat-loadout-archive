(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  const format = "mwi-layu-loadouts-cloud";
  const uuid = value => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
  const time = value => Number.isSafeInteger(value) && value >= 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function scene(row) {
    if (!row || !uuid(row.id) || !uuid(row.revision) || !time(row.createdAt) || !time(row.updatedAt) ||
        !(row.removedAt === null || time(row.removedAt)) || typeof row.name !== "string" ||
        !(row.ancestors === undefined || Array.isArray(row.ancestors) && row.ancestors.every(uuid))) throw Error("云端子方案格式无效。");
    const snapshot = app.Core.validateSnapshot(row.snapshot);
    if (snapshot.raw.id !== row.parentId) throw Error("云端子方案父配装不匹配。");
    return { id: row.id, parentId: row.parentId, name: app.Core.name(row.name), revision: row.revision,
      ...(uuid(row.conflictOf) && row.conflictOf !== row.id ? { conflictOf: row.conflictOf } : {}),
      createdAt: row.createdAt, updatedAt: row.updatedAt, removedAt: row.removedAt, snapshot,
      ancestors: [...new Set(row.ancestors || [])].sort() };
  }
  function memory(row) {
    if (!/^\/action_types\/[a-z0-9_]+$/.test(row?.type) || !/^\/actions\/(?:[a-z0-9_]+\/)*[a-z0-9_]+$/.test(row?.action) ||
        !time(row.loadoutId) || !time(row.updatedAt)) throw Error("行动配装记录无效。");
    return { type: row.type, action: row.action, loadoutId: row.loadoutId, updatedAt: row.updatedAt };
  }
  const boardName = (character, loadoutId) => character + "loadout" + loadoutId;
  const occupied = message => Object.assign(Error(message), { code: "BOARD_OCCUPIED" });
  function parse(character, loadoutId, text) {
    if (text === "") return { scenes: [], memories: [], native: null };
    let doc;
    try { if (text.length <= 5000000) doc = JSON.parse(text); } catch (_) { /* Show a recoverable board conflict. */ }
    if (doc?.format !== format || ![2, 3].includes(doc.version) || doc.character !== character || doc.loadoutId !== loadoutId ||
        !Array.isArray(doc.scenes) || !Array.isArray(doc.memories)) throw occupied("剪贴板已有其他内容或版本不兼容，已保留原文。");
    const scenes = doc.scenes.map(scene);
    if (new Set(scenes.map(row => row.id)).size !== scenes.length) throw Error("云端方案编号重复。");
    const memories = doc.memories.map(memory);
    if (scenes.some(row => row.parentId !== loadoutId) || memories.some(row => row.loadoutId !== loadoutId)) {
      throw occupied("剪贴板含其他配装的数据，已保留原文。");
    }
    let native = null;
    if (doc.native != null) {
      if (doc.version !== 3 || !time(doc.native.updatedAt)) throw occupied("云端原生配装格式无效，已保留原文。");
      const snapshot = app.Core.validateSnapshot(doc.native.snapshot);
      if (!loadoutId || snapshot.raw.id !== loadoutId) throw occupied("云端原生配装编号不匹配，已保留原文。");
      native = { snapshot, updatedAt: doc.native.updatedAt };
    }
    return { scenes, memories, native };
  }
  function mergeScenes(local, incoming) {
    const rows = new Map(local.map(row => [row.id, scene(row)]));
    const copies = [];
    for (const remote of incoming) {
      const old = rows.get(remote.id);
      if (!old) { rows.set(remote.id, remote); continue; }
      if (old.parentId !== remote.parentId) throw Error("云端方案编号与父配装冲突。");
      if (old.revision === remote.revision) {
        if (app.Core.stable({ ...old, ancestors: [], conflictOf: null }) !== app.Core.stable({ ...remote, ancestors: [], conflictOf: null })) throw Error("云端同一版本的内容不一致。");
        if (old.conflictOf && remote.conflictOf && old.conflictOf !== remote.conflictOf) throw Error("冲突副本的来源不一致。");
        rows.set(old.id, { ...remote, ...old, ancestors: [...new Set([...old.ancestors, ...remote.ancestors])].sort() });
        continue;
      }
      if (old.ancestors.includes(remote.revision)) continue;
      if (remote.ancestors.includes(old.revision)) { rows.set(old.id, remote); continue; }
      const localWins = old.updatedAt > remote.updatedAt || old.updatedAt === remote.updatedAt && old.revision > remote.revision;
      const [winner, other] = localWins ? [old, remote] : [remote, old];
      rows.set(winner.id, { ...winner, ancestors: [...new Set([...winner.ancestors, ...other.ancestors, other.revision])].sort() });
      if (other.removedAt == null || winner.removedAt == null) copies.push({ ...other, conflictOf: winner.id, id: other.revision, name: other.name.slice(0, 50) + "（冲突副本）" });
    }
    for (const copy of copies) if (!rows.has(copy.id)) rows.set(copy.id, copy);
    return [...rows.values()].sort((a, b) => order(a.id, b.id));
  }
  function conflictPairs(rows) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const pairs = [];
    // Older boards identified a copy by its revision-derived ID and suffix.
    const legacy = new Map(rows.filter(row => !row.conflictOf && row.removedAt == null &&
      row.name.endsWith("（冲突副本）")).map(row => [row.id, row]));
    for (const row of rows) {
      if (row.conflictOf) {
        const main = byId.get(row.conflictOf);
        if (main && main.parentId === row.parentId && main.ancestors?.includes(row.id)) pairs.push([main, row]);
      }
      if (!legacy.size) continue;
      for (const revision of row.ancestors || []) {
        const copy = legacy.get(revision);
        if (copy && copy !== row && copy.parentId === row.parentId) {
          pairs.push([row, copy]); legacy.delete(revision);
        }
      }
    }
    return pairs;
  }
  async function synchronize(character, loadoutId, io, current, refresh) {
    const check = () => { if (current() !== character) throw Error("角色已切换。"); };
    const name = boardName(character, loadoutId);
    const owner = location.origin + "|" + character;
    check();
    const before = await io(name);
    check();
    const remote = parse(character, loadoutId, before);
    const b = board(character, loadoutId);
    const localNative = loadoutId && app.Adapter?.nativeSnapshot ? app.Adapter.nativeSnapshot(character, loadoutId) : null;
    const localKey = localNative ? app.Core.stable(localNative) : null;
    const remoteKey = remote.native ? app.Core.stable(remote.native.snapshot) : null;
    // Do not let an unchanged/stale game tab replace another device's published configuration.
    // A fresh client with differing data requires an explicit choice in the cloud panel.
    const canPublish = localNative && (!remote.native || localKey === remoteKey || b.forceNative === localKey ||
      b.localBaseline != null && localKey !== b.localBaseline && remoteKey === b.remoteBaseline);
    const native = canPublish && localKey !== remoteKey ? { snapshot: localNative, updatedAt: Date.now() } : remote.native;
    const { scenes, changed } = loadoutId === 0 ? { scenes: [], changed: [] } : await app.Store.mergeCloud(owner, loadoutId, remote.scenes, mergeScenes);
    for (const scope of changed) refresh(scope);
    check();
    const memories = app.ActionMemory.mergeCloud(character, loadoutId, remote.memories).map(memory);
    const counts = { nativeAvailable: Boolean(native), nativeMismatch: Boolean(native && localNative && app.Core.stable(native.snapshot) !== localKey),
      sceneCount: scenes.filter(row => row.removedAt == null).length,
      memoryCount: memories.length, conflicts: conflictPairs(scenes).length };
    const complete = () => {
      b.localBaseline = localKey; b.remoteBaseline = native ? app.Core.stable(native.snapshot) : null;
      b.nativeSnapshot = native?.snapshot || null;
      if (b.forceNative === localKey) b.forceNative = null;
      return counts;
    };
    if (!before && !native && !scenes.length && !memories.length) return complete();
    const text = JSON.stringify({ format, version: native || JSON.parse(before || "null")?.version === 3 ? 3 : 2,
      character, loadoutId, scenes, memories, ...(native ? { native } : {}) });
    if (text.length > 5000000) throw Error("配装数据超出同步大小限制。");
    if (text === before) return complete();
    if (await io(name) !== before) throw Error("另一台设备刚刚更新，稍后会重新合并。");
    check();
    if (localNative && app.Core.stable(app.Adapter.nativeSnapshot(character, loadoutId)) !== localKey)
      throw Error("原生配装刚刚变化，稍后会重新读取并同步。");
    await io(name, text);
    if (await io(name) !== text) throw Error("写入后未能核对云端内容，稍后重试。");
    return complete();
  }

  const activeInterval = 30000, otherInterval = 300000;
  const boards = new Map(), urgent = new Set(), routine = new Set();
  let timer, running = null, active = null, refreshScope, onStatus;
  const watchers = new Map();
  function subscribe(character, id, listener) {
    const key = boardName(character, id);
    if (!watchers.has(key)) watchers.set(key, new Set());
    const group = watchers.get(key);
    group.add(listener);
    return () => { group.delete(listener); if (!group.size) watchers.delete(key); };
  }
  function emit(b) {
    onStatus?.(b.character, b.loadoutId, b.status);
    watchers.get(boardName(b.character, b.loadoutId))?.forEach(listener => listener());
  }
  const online = () => root.navigator?.onLine !== false;
  function board(character, loadoutId) {
    const name = boardName(character, loadoutId);
    if (!boards.has(name)) boards.set(name, { character, loadoutId, kind: "waiting", status: "等待同步", checked: null, sceneCount: null, memoryCount: null, conflicts: 0, last: null, retryAt: 0, failures: 0, dirty: false });
    return boards.get(name);
  }
  function report(b, text, kind) {
    if (b.status === text && b.kind === kind) return;
    b.status = text; b.kind = kind;
    emit(b);
  }
  function kick() {
    if (!timer && !running && online()) timer = setTimeout(drain, 250);
  }
  function enqueue(b, priority) {
    if (priority) { routine.delete(b); urgent.add(b); }
    else if (running !== b && !urgent.has(b)) routine.add(b);
    kick();
  }
  function changed(character, loadoutId) {
    if (!Number.isSafeInteger(character) || character <= 0 || !time(loadoutId)) return;
    const b = board(character, loadoutId);
    b.dirty = true;
    if (b.kind === "blocked" || b.kind === "setup") return;
    report(b, online() ? "已存本机，待上传" : "已存本机，等待联网", "pending");
    enqueue(b, true);
  }
  function request(character, loadoutId) {
    const b = board(character, loadoutId);
    if (running !== b && online()) enqueue(b, true);
  }
  function publishCurrent(character, loadoutId) {
    const b = board(character, loadoutId);
    b.forceNative = app.Core.stable(app.Adapter.nativeSnapshot(character, loadoutId));
    changed(character, loadoutId);
  }
  function setActive(character, loadoutId) {
    active = character == null ? null : board(character, loadoutId);
    if (active && active.kind !== "blocked" && active.kind !== "setup" && !active.retryAt && (active.last === null || Date.now() - active.last >= activeInterval)) {
      request(character, loadoutId);
    }
  }
  async function drain() {
    timer = null;
    while (online()) {
      const b = urgent.values().next().value || (!document.hidden && routine.values().next().value);
      if (!b) break;
      running = b;
      urgent.delete(b); routine.delete(b);
      const wasDirty = b.dirty;
      try {
        const current = () => app.Adapter.cloudContext(false)?.character;
        if (current() !== b.character) continue;
        b.last = Date.now();
        b.dirty = false;
        report(b, wasDirty ? "正在同步本机修改…" : "正在核对…", "busy");
        const io = root.__mwiLoadoutClipboardV2;
        if (typeof io !== "function" || app.Adapter.nativeSnapshot && io.protocolVersion !== 3)
          throw Object.assign(Error("云同步接口需要更新，请更新已安装的配装助手或开发加载器，再刷新游戏页面。"), { code: "BRIDGE_MISSING" });
        const counts = await synchronize(b.character, b.loadoutId, io, current, refreshScope);
        b.failures = 0; b.retryAt = 0;
        Object.assign(b, counts, { checked: Date.now() });
        if (!b.dirty) report(b, counts.nativeMismatch ? "原生配装与云端不同" : counts.nativeAvailable ? "配装已同步" :
          counts.sceneCount || counts.memoryCount ? "附加记录已同步 · 尚无配装快照" : "已核对 · 无附加记录", "ok");
      } catch (error) {
        b.retryAt = Date.now() + Math.min(otherInterval, activeInterval * 2 ** Math.min(b.failures++, 4));
        const setup = error.code === "BRIDGE_MISSING";
        const blocked = setup || error.code === "BOARD_OCCUPIED";
        const editedDuringSync = b.dirty;
        b.dirty ||= wasDirty;
        if (blocked) { urgent.delete(b); routine.delete(b); }
        if (blocked || !editedDuringSync) report(b, error.message, setup ? "setup" : blocked ? "blocked" : "error");
      } finally { running = null; }
    }
  }
  function start(refresh, statusChanged) {
    refreshScope = refresh; onStatus = statusChanged;
    let poll;
    function scan() {
      clearTimeout(poll);
      if (document.hidden || !online()) return;
      let delay = activeInterval;
      try {
        const ctx = app.Adapter.cloudContext();
        if (!ctx?.loadoutIds) delay = 3000;
        else {
          const now = Date.now();
          for (const id of [...ctx.loadoutIds, 0]) {
            const b = board(ctx.character, id);
            if (b.kind === "blocked" || b.kind === "setup") continue;
            if (id && ctx.loadouts?.[id]) {
              const key = app.Core.stable(ctx.loadouts[id]);
              const edited = b.observedNative != null && key !== b.observedNative;
              b.observedNative = key;
              if (edited) changed(ctx.character, id);
            }
            const due = b.retryAt || (b.last === null ? now : b.last + (active === b ? activeInterval : otherInterval));
            if (now >= due) enqueue(b, (active === b || b.dirty) && running !== b);
            else delay = Math.min(delay, Math.max(500, due - now));
          }
        }
      } catch (_) { delay = 3000; }
      finally { poll = setTimeout(scan, delay); }
    }
    function resume() {
      if (urgent.size || !document.hidden && routine.size) kick();
      scan();
    }
    document.addEventListener("visibilitychange", resume);
    const connectivityChanged = () => {
      for (const b of boards.values()) emit(b);
    };
    root.addEventListener("offline", connectivityChanged);
    root.addEventListener("online", () => {
      connectivityChanged();
      for (const b of boards.values()) if (b.retryAt && b.kind !== "blocked" && b.kind !== "setup") {
        b.retryAt = 0; b.last = null;
        if (b.dirty) enqueue(b, true);
      }
      resume();
    });
    scan();
  }
  function info(character, id) {
    const b = board(character, id);
    let label = b.status;
    if (b.kind === "setup") label = "需要更新加载器";
    else if (b.kind === "blocked") label = "同步已暂停";
    else if (!online()) label = b.dirty ? "已存本机，等待联网" : "离线";
    else if (b.kind === "error") label = b.dirty ? "已存本机，待重试" : "同步待重试";
    else if (b.conflicts && b.kind === "ok") label = "有版本待比较";
    return { label, kind: b.kind, detail: b.status, checked: b.checked, sceneCount: b.sceneCount,
      nativeAvailable: b.nativeAvailable, nativeMismatch: b.nativeMismatch, nativeSnapshot: b.nativeSnapshot,
      memoryCount: b.memoryCount, conflicts: b.conflicts, offline: !online(),
      warning: Boolean(b.nativeMismatch || b.conflicts || b.kind === "setup" || b.kind === "blocked" || b.kind === "error" || (!online() && b.dirty)) };
  }
  app.Cloud = Object.freeze({ subscribe, info, conflictPairs, changed, request, publishCurrent, setActive, start, synchronize, boardName, parse, mergeScenes,
    status: (character, loadoutId) => boards.get(boardName(character, loadoutId))?.status || "等待同步" });
})(globalThis);
