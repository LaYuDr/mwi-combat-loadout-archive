// ==UserScript==
// @name         MWI 战斗模拟器配装档案助手
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive
// @version      0.1.0
// @author       柆雨
// @homepageURL  https://github.com/LaYuDr/mwi-combat-loadout-archive
// @supportURL   https://github.com/LaYuDr/mwi-combat-loadout-archive/issues
// @updateURL    https://raw.githubusercontent.com/LaYuDr/mwi-combat-loadout-archive/main/deliverables/mwi_combat_loadout_archive.meta.js
// @downloadURL  https://raw.githubusercontent.com/LaYuDr/mwi-combat-loadout-archive/main/deliverables/mwi_combat_loadout_archive.user.js
// @description  自动归档成功导入的战斗配装，支持命名、载入、回收站及 JSON 备份。仅在模拟器网站运行。
// @match        https://mwi-combatsi-mulator.pages.dev/*
// @match        https://azhu949.github.io/MWICombatSimulator/*
// @run-at       document-start
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==
// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME
// ---- archive_core.js ----
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWILoadoutCore = factory();
})(globalThis, function () {
  "use strict";
  const FORMAT = "mwi-loadout-archive";
  const VERSION = 1;
  const MAX_BYTES = 2 * 1024 * 1024;
  const MAX_RECORDS = 500;
  const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  const plain = v => v !== null && typeof v === "object" && !Array.isArray(v);
  const fail = path => { throw new Error(`数据格式不兼容：${path}。请保留原 JSON，并更新插件后重试。`); };
  const text = max => (v, p) => typeof v === "string" && v.length <= max ? v : fail(p);
  const name = text(120);
  const finite = (v, p) => typeof v === "number" && Number.isFinite(v) ? v : fail(p);
  const nonnegative = (v, p) => finite(v, p) >= 0 ? v : fail(p);
  const bool = (v, p) => typeof v === "boolean" ? v : fail(p);
  const nullable = schema => (v, p) => v === null ? null : schema(v, p);
  const union = (...schemas) => (v, p) => {
    for (const schema of schemas) { try { return schema(v, p); } catch (_) { /* try the next documented shape */ } }
    return fail(p);
  };
  const pattern = re => (v, p) => typeof v === "string" && re.test(v) ? v : fail(p);
  const itemHrid = pattern(/^(?:|\/items\/[a-z0-9_]+)$/);
  const abilityHrid = pattern(/^(?:|\/abilities\/[a-z0-9_]+)$/);
  const hrid = pattern(/^\/[a-z_]+\/[a-z0-9_/]+$/);
  const list = (schema, max = 500) => (v, p) => {
    if (!Array.isArray(v) || v.length > max) return fail(p);
    return Array.from(v, (entry, i) => schema(entry, `${p}[${i}]`));
  };
  const object = fields => (v, p) => {
    if (!plain(v)) return fail(p);
    const result = {};
    for (const [key, schema] of Object.entries(fields)) {
      if (own(v, key)) result[key] = schema(v[key], `${p}.${key}`);
    }
    return result;
  };
  const dict = (re, schema, max = 500) => (v, p) => {
    if (!plain(v) || Object.keys(v).length > max) return fail(p);
    const result = {};
    for (const [key, value] of Object.entries(v)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") return fail(p);
      if (re.test(key)) result[key] = schema(value, `${p}.${key}`);
    }
    return result;
  };
  const collection = schema => union(list(schema), dict(/^[a-zA-Z0-9/_:.-]{1,160}$/, schema));
  const identity = object({ id: union(nonnegative, text(80)), characterId: union(nonnegative, text(80)),
    characterID: union(nonnegative, text(80)), name });
  const item = object({ itemHrid, hrid: itemHrid, itemLocationHrid: hrid, enhancementLevel: nonnegative });
  const wrappedItem = object({ itemHrid, hrid: itemHrid, itemLocationHrid: hrid,
    enhancementLevel: nonnegative, currentItem: nullable(item), item: nullable(item) });
  const slotItem = nullable(union(itemHrid, item));
  const slots = list(slotItem, 3);
  const trigger = object({ dependencyHrid: hrid, conditionHrid: hrid, comparatorHrid: hrid, value: finite });
  const triggerMap = dict(/^\/(?:items|abilities)\/[a-z0-9_]+$/, list(trigger, 4));
  const ability = nullable(object({ abilityHrid, ability: union(abilityHrid, object({ abilityHrid })),
    level: nonnegative, abilityLevel: nonnegative, slotNumber: finite, slot: finite,
    slotIndex: finite, position: finite }));
  const skills = list(object({ skillHrid: hrid, hrid, level: nonnegative,
    experience: nullable(union(nonnegative, pattern(/^\d+(?:\.\d+)?$/))) }), 40);
  const numericEntry = object({ hrid, level: nonnegative, houseRoomHrid: hrid, roomHrid: hrid,
    guildBuffHrid: hrid, isCompleted: bool, completed: bool, achievementHrid: hrid });
  const levelsMap = dict(/^(?:\d+|\/(?:house_rooms|guild_buffs|guild_buildings|guild_shrines|achievements)\/[a-z0-9_]+)$/,
    union(nonnegative, bool, numericEntry));
  const achievements = union(list(numericEntry), levelsMap);
  const consumables = object({ foodItemHrids: slots, drinkItemHrids: slots,
    consumableCombatTriggersMap: triggerMap, abilityCombatTriggersMap: triggerMap });
  const loadout = object({ actionTypeHrid: hrid, isDefault: bool, foodItemHrids: slots,
    drinkItemHrids: slots, foodHrids: slots, drinkHrids: slots,
    combatConsumables: union(consumables, list(item, 6)),
    combatAbilities: object({ abilityCombatTriggersMap: triggerMap }),
    consumableCombatTriggersMap: triggerMap, abilityCombatTriggersMap: triggerMap, triggerMap });
  const common = { characterSkills: skills, characterHouseRoomMap: levelsMap, houseRooms: levelsMap,
    characterAchievements: achievements, achievements, guildBuffLevelMap: levelsMap,
    characterGuildBuffMap: union(levelsMap, list(numericEntry)), guildBuildingLevelMap: levelsMap,
    consumableCombatTriggersMap: triggerMap, abilityCombatTriggersMap: triggerMap };
  const profileSchema = object({ ...common, sharableCharacter: identity, name,
    wearableItemMap: dict(/^[a-zA-Z0-9/_:.-]{1,160}$/, wrappedItem), equippedAbilities: collection(ability),
    currentCombatLoadout: nullable(loadout), combatLoadout: nullable(loadout), currentLoadout: nullable(loadout),
    loadout: nullable(loadout), characterLoadoutMap: dict(/^[a-zA-Z0-9/_:.-]{1,160}$/, loadout),
    foodItemHrids: slots, drinkItemHrids: slots, combatConsumables: union(consumables, list(item, 6)),
    foodHrids: slots, drinkHrids: slots, triggerMap });
  const battleLocations = new Set(["head", "body", "legs", "feet", "hands", "main_hand", "two_hand",
    "off_hand", "pouch", "neck", "earrings", "ring", "back", "charm", "trinket"].map(s => `/item_locations/${s}`));
  const equippedItems = (v, p) => {
    if (!Array.isArray(v) && !plain(v)) return fail(p);
    const all = Array.isArray(v) ? v : Object.values(v);
    if (all.length > 10000) return fail(p);
    return all.filter(entry => battleLocations.has((entry?.currentItem || entry?.item || entry)?.itemLocationHrid))
      .map((entry, index) => wrappedItem(entry, `${p}[${index}]`));
  };
  const actionSlots = dict(/^\/action_types\/combat$/, slots);
  const currentSchema = object({ ...common, character: identity, characterItems: equippedItems,
    combatUnit: nullable(object({ combatAbilities: collection(ability) })),
    actionTypeFoodSlotsMap: actionSlots, actionTypeDrinkSlotsMap: actionSlots });
  const slotNames = /^(?:head|body|legs|feet|hands|weapon|off_hand|pouch|neck|earrings|ring|back|charm|trinket)$/;
  const modernSchema = object({ id: union(text(80), nonnegative), name,
    levels: dict(/^(?:stamina|intelligence|attack|melee|defense|ranged|magic)$/, nonnegative, 7),
    skillExperience: dict(/^(?:stamina|intelligence|attack|melee|defense|ranged|magic)$/, nullable(nonnegative), 7),
    equipment: dict(slotNames, object({ itemHrid, enhancementLevel: nonnegative }), 15),
    food: slots, drinks: slots, abilities: list(ability, 5), triggerMap, houseRooms: levelsMap,
    guildBuffs: levelsMap, achievements,
    combatScrolls: dict(/^\/items\/[a-z0-9_]+$/, object({ quantity: nullable(nonnegative) })) });

  function assertSize(value, limit = MAX_BYTES) {
    let textValue;
    try { textValue = JSON.stringify(value); } catch (_) { throw new Error("数据无法序列化。"); }
    if (!textValue || new TextEncoder().encode(textValue).length > limit) throw new Error("数据过大，请拆分 JSON 后导入。");
    return textValue;
  }
  function sanitizePayload(raw) {
    assertSize(raw);
    if (!plain(raw)) return fail("payload");
    let payload, format, person;
    const profile = raw.profile?.sharableCharacter ? raw.profile : raw;
    if (profile.sharableCharacter && Array.isArray(profile.characterSkills)) {
      const cleaned = profileSchema(profile, "profile");
      payload = profile === raw ? cleaned : { profile: cleaned };
      if (own(raw, "mainSiteConsumables")) payload.mainSiteConsumables = consumables(raw.mainSiteConsumables, "mainSiteConsumables");
      format = "shareable-profile"; person = cleaned.sharableCharacter;
    } else if (raw.character && Array.isArray(raw.characterSkills) &&
        ["characterItems", "combatUnit", "actionTypeFoodSlotsMap", "actionTypeDrinkSlotsMap"].some(k => own(raw, k))) {
      payload = currentSchema(raw, "character"); format = "main-site-current-character"; person = payload.character;
    } else {
      const player = raw.version === 2 && raw.player ? raw.player : raw;
      if (!plain(player.levels) || !plain(player.equipment)) throw new Error("不支持的配装格式。请使用主站一键导入数据或网站的现代单人 JSON。");
      const cleaned = modernSchema(player, "player");
      payload = { version: 2, format: "mwi-vue-solo", player: cleaned }; format = "modern-solo"; person = cleaned;
    }
    const characterName = String(person.name || (profile === raw ? raw.name : profile.name) || "未命名角色").trim() || "未命名角色";
    const characterId = format === "modern-solo" ? "" : String(person.id ?? person.characterId ?? person.characterID ?? "");
    // No server is supplied by this protocol. Include the observed name to avoid
    // collapsing different servers' numeric IDs under a fabricated server identity.
    return { payload, format, characterName, characterId,
      identity: `${characterId ? `id:${characterId}:` : ""}name:${characterName.toLowerCase()}` };
  }
  function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (plain(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
    return JSON.stringify(value);
  }
  async function digest(value) {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
    return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
  }
  function details(raw) {
    const s = sanitizePayload(raw), p = s.payload, profile = p.profile || p, player = p.player;
    const gear = [];
    if (player) {
      for (const [slot, entry] of Object.entries(player.equipment)) if (entry.itemHrid) gear.push({ slot, ...entry });
    } else {
      const source = p.characterItems || Object.values(profile.wearableItemMap || {});
      for (const entry of source) {
        const item = entry.currentItem || entry.item || entry;
        if (item.itemHrid || item.hrid) gear.push({ slot: (item.itemLocationHrid || "").replace("/item_locations/", ""),
          itemHrid: item.itemHrid || item.hrid, enhancementLevel: item.enhancementLevel });
      }
    }
    const missing = [];
    if (player) {
      for (const [key, label] of [["food", "食物"], ["drinks", "饮品"], ["abilities", "技能"],
        ["triggerMap", "触发器"], ["houseRooms", "房间"], ["achievements", "成就"], ["guildBuffs", "公会增益"]]) if (!own(player, key)) missing.push(label);
    } else {
      if (!own(profile, "characterHouseRoomMap") && !own(profile, "houseRooms")) missing.push("房间");
      if (!own(profile, "characterAchievements") && !own(profile, "achievements")) missing.push("成就");
      if (!own(profile, "guildBuffLevelMap") && !(own(profile, "characterGuildBuffMap") && own(profile, "guildBuildingLevelMap"))) missing.push("公会增益");
      if (s.format === "main-site-current-character") {
        if (!p.combatUnit?.combatAbilities) missing.push("技能");
        if (!p.actionTypeFoodSlotsMap) missing.push("食物");
        if (!p.actionTypeDrinkSlotsMap) missing.push("饮品");
        if (!own(p, "consumableCombatTriggersMap") || !own(p, "abilityCombatTriggersMap")) missing.push("触发器");
      } else {
        // Profile variants have multiple nested loadout shapes: expose coverage as unverified,
        // rather than guessing which candidate the upstream mapper will select.
        if (!profile.equippedAbilities) missing.push("技能");
        if (!p.mainSiteConsumables) missing.push("消耗品/触发器覆盖待核对");
      }
    }
    return { ...s, gear, missing };
  }
  async function prepare(raw, options = {}) {
    const s = sanitizePayload(raw);
    const now = options.now ?? Date.now();
    const fingerprint = await digest(s.payload);
    return { schemaVersion: VERSION, id: options.id || `recent:${await digest(s.identity)}`,
      kind: options.kind || "recent", name: options.name ? name(options.name, "档案名称").trim() : `${s.characterName} · 最近导入`,
      characterName: s.characterName, characterId: s.characterId, sourceFormat: s.format,
      fingerprint, payload: s.payload, capturedAt: now, createdAt: now, updatedAt: now, deletedAt: null };
  }
  function restoreMessage(row, slot, requestId) {
    if (!/^[1-5]$/.test(String(slot))) throw new Error("请选择玩家 1 至 5。");
    const s = sanitizePayload(row.payload);
    // Omit all clearing/selection/global settings instructions.
    return { channel: "mwi-tm-bridge", type: "mwi-tm-import", requestId,
      importTarget: "player", targetPlayerId: String(slot), format: s.format, payload: s.payload };
  }
  function parseFile(textValue) {
    if (new TextEncoder().encode(textValue).length > 10 * MAX_BYTES) throw new Error("备份超过 20 MB，请拆分后重试。");
    let data;
    try { data = JSON.parse(textValue); } catch (_) { throw new Error("JSON 无法解析，请检查是否选择了正确的文件。"); }
    let entries;
    if (data?.format === FORMAT) {
      if (data.version !== VERSION || !Array.isArray(data.archives)) throw new Error("备份版本不兼容。");
      entries = data.archives.map(row => {
        if (!plain(row) || !row.payload || typeof row.name !== "string") throw new Error("备份档案缺少名称或配装数据。");
        return { payload: row.payload, name: row.name, capturedAt: row.capturedAt };
      });
    } else if (data?.version === 2 && Array.isArray(data.players)) {
      entries = data.players.map(player => ({ payload: { version: 2, player }, name: player.name }));
    } else entries = [{ payload: data }];
    if (!entries.length || entries.length > MAX_RECORDS) throw new Error("每个文件需要包含 1 至 500 套配装。");
    for (const entry of entries) { sanitizePayload(entry.payload); if (entry.name !== undefined) name(entry.name, "档案名称"); }
    return entries;
  }
  function exportFile(rows) {
    return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
      archives: rows.map(row => ({ name: row.name, capturedAt: row.capturedAt, payload: sanitizePayload(row.payload).payload })) }, null, 2);
  }
  return Object.freeze({ FORMAT, VERSION, MAX_BYTES, MAX_RECORDS, sanitizePayload, canonical, digest,
    prepare, details, restoreMessage, parseFile, exportFile });
});

// ---- archive_store.js ----
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

// ---- archive_bridge.js ----
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWILoadoutBridge = factory();
})(globalThis, function () {
  "use strict";
  function create({ core, pageWindow, origin, onImport, onStatus = () => {}, timeout = 15000, now = Date.now }) {
    const pending = new Map(), loading = new Map(), recentIds = new Set();
    const prefix = `mwi-archive:${globalThis.crypto.randomUUID()}:`;
    let sequence = 0, clock = 0;
    const report = text => onStatus(text, "error");
    function expire(id) {
      const entry = pending.get(id);
      if (entry) { pending.delete(id); report("未收到网站导入成功回执，本次数据尚未归档。可导出 JSON 后手动导入。"); }
    }
    function observe(event) {
      if (event.source !== pageWindow || event.origin !== origin) return;
      const message = event.data;
      if (!message || message.channel !== "mwi-tm-bridge" || typeof message.requestId !== "string" ||
          !message.requestId || message.requestId.length > 200) return;
      const id = message.requestId;
      if (message.type === "mwi-tm-import") {
        if (id.startsWith(prefix) || pending.has(id) || recentIds.has(id) ||
            (message.importTarget && message.importTarget !== "player")) return;
        if (pending.size >= 50) { report("等待导入回执的请求过多，请稍后重试。"); return; }
        try {
          const snapshot = core.sanitizePayload(message.payload);
          // Receive order survives same-millisecond and out-of-order ACKs.
          clock = Math.max(now(), clock + 1);
          pending.set(id, { payload: snapshot.payload, at: clock, timer: setTimeout(() => expire(id), timeout) });
        } catch (error) { report(`网站可继续导入，但档案未保存：${error.message}`); }
      } else if (message.type === "mwi-tm-import-result") {
        if (loading.has(id)) {
          const task = loading.get(id); loading.delete(id); clearTimeout(task.timer);
          if (message.ok === true) task.resolve(message);
          else task.reject(new Error(message.message || "网站拒绝载入，请先保存或取消网站中尚未提交的编辑。"));
          return;
        }
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer); pending.delete(id);
        recentIds.add(id);
        if (recentIds.size > 200) recentIds.delete(recentIds.values().next().value);
        if (message.ok !== true) { report("网站导入未成功，本次数据未归档。"); return; }
        Promise.resolve().then(() => onImport(entry.payload, entry.at)).catch(error => report(`导入成功，但归档失败：${error.message}`));
      }
    }
    function restore(row, slot) {
      const id = `${prefix}${++sequence}`;
      const message = core.restoreMessage(row, slot, id);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          loading.delete(id);
          reject(new Error("网站未响应。请先打开模拟器主页，等待加载完成后重试；档案仍保留。"));
        }, timeout);
        loading.set(id, { resolve, reject, timer });
        try { pageWindow.postMessage(message, origin); }
        catch (error) { clearTimeout(timer); loading.delete(id); reject(error); }
      });
    }
    function close() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      for (const entry of loading.values()) { clearTimeout(entry.timer); entry.reject(new Error("档案助手已关闭。")); }
      pending.clear(); loading.clear();
    }
    return Object.freeze({ observe, restore, close });
  }
  return Object.freeze({ create });
});

// ---- archive_app.js ----
(function startArchive(root) {
  "use strict";
  const supported = location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    (location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/"));
  if (!supported || root.__MWILoadoutArchiveInstalled) return;
  root.__MWILoadoutArchiveInstalled = true;
  const C = root.MWILoadoutCore, S = root.MWILoadoutStore;
  let storePromise, rows = [], selected = "", query = "", filter = "all", draftName = "", slot = "1";
  let ui, panelOpen = false, busy = false, pendingFile = null, undo = null;
  let lastStatus = "等待主站一键导入，或导入网站的现代单人 JSON。", lastTone = "info";
  const date = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const db = () => storePromise ||= S.create().catch(error => { storePromise = null; throw error; });
  function node(tag, text, className) {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function button(text, fn, className) {
    const b = node("button", text, className); b.type = "button";
    b.addEventListener("click", () => { Promise.resolve().then(fn).catch(error => status(error.message, "error")); });
    return b;
  }
  function status(message, tone = "info") {
    lastStatus = message; lastTone = tone;
    if (!ui) return;
    ui.status.replaceChildren(document.createTextNode(message)); ui.status.dataset.tone = tone;
    if (undo) ui.status.append(button("撤销删除", async () => {
      const id = undo; undo = null;
      await (await db()).update(id, { deletedAt: null, updatedAt: Date.now() });
      await refresh(); status("档案已恢复。");
    }));
  }
  const bridge = root.MWILoadoutBridge.create({ core: C, pageWindow: root, origin: location.origin,
    onStatus: status,
    onImport: async (payload, capturedAt) => {
      const row = await C.prepare(payload, { now: capturedAt });
      const result = await (await db()).autoSave(row);
      await refresh();
      status(result === "saved" ? `${row.characterName} 的配装已归档。可另存命名配装，保留这一版本。`
        : result === "unchanged" ? `${row.characterName} 的配装没有变化，已保留现有档案。` : "较旧的导入回执已忽略，保留较新的配装。");
    }
  });
  root.addEventListener("message", bridge.observe);

  function visibleRows() {
    return rows.filter(row => (filter === "trash" ? !!row.deletedAt : !row.deletedAt) &&
      (!["named", "recent"].includes(filter) || row.kind === filter) &&
      `${row.name} ${row.characterName}`.toLowerCase().includes(query.toLowerCase()));
  }
  function choose(id) {
    selected = id; draftName = rows.find(row => row.id === id)?.name || ""; render();
  }
  async function refresh() {
    rows = (await (await db()).all()).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!rows.some(row => row.id === selected)) { selected = ""; draftName = ""; }
    if (!selected && visibleRows().length) { selected = visibleRows()[0].id; draftName = visibleRows()[0].name; }
    render();
  }
  function exportRows(values) {
    if (!values.length) throw new Error("没有可导出的档案。");
    const blob = new Blob([C.exportFile(values)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = node("a");
    a.href = url; a.download = `MWI配装档案_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`已生成 ${values.length} 套配装的 JSON 备份。`);
  }
  async function addFile(file) {
    if (!file) return;
    pendingFile = null; renderImportPreview();
    if (file.size > C.MAX_BYTES * 10) throw new Error("文件超过 20 MB，请拆分后重试。");
    const entries = C.parseFile(await file.text());
    // All entries and hashes are checked before any database write.
    const prepared = await Promise.all(entries.map(async entry => {
      const identity = C.sanitizePayload(entry.payload);
      const row = await C.prepare(entry.payload, { id: `named:${crypto.randomUUID()}`, kind: "named",
        name: entry.name?.trim() || `${identity.characterName} · 文件配装` });
      if (Number.isFinite(entry.capturedAt) && entry.capturedAt > 0 && entry.capturedAt <= Date.now()) row.capturedAt = entry.capturedAt;
      return row;
    }));
    pendingFile = prepared; renderImportPreview();
    status(`已校验 ${prepared.length} 套配装，请点击“添加档案”完成导入。相同名称及内容会去重。`);
  }
  function renderImportPreview() {
    if (!ui) return;
    ui.importPreview.replaceChildren();
    if (!pendingFile) return;
    ui.importPreview.append(node("span", `${pendingFile.length} 套待导入`), button("添加档案", async () => {
      if (busy || !pendingFile) return;
      const prepared = pendingFile; busy = true; render();
      try {
        const count = await (await db()).addNamed(prepared); pendingFile = null;
        await refresh(); status(`已添加 ${count} 套配装，跳过 ${prepared.length - count} 套重复配装。`);
      } finally { busy = false; render(); }
    }, "primary"), button("取消导入", () => { pendingFile = null; renderImportPreview(); status("已取消文件导入。"); }));
  }
  function itemMark(hrid) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "item-mark"); svg.setAttribute("aria-hidden", "true");
    const symbol = document.getElementById(`mwi-item-icon-${hrid.slice(7)}`);
    // Reuse already-rendered local symbols only. Do not fetch assets or copy executable markup.
    if (symbol) {
      for (const part of symbol.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,g")) {
        if (part.parentNode !== symbol) continue;
        const safe = document.createElementNS(svg.namespaceURI, part.tagName);
        for (const key of ["d", "fill", "stroke", "stroke-width", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "points", "transform"])
          if (part.hasAttribute(key) && !/url\s*\(/i.test(part.getAttribute(key))) safe.setAttribute(key, part.getAttribute(key));
        // Group nodes are intentionally omitted unless flat geometry is available.
        if (part.tagName !== "g") svg.append(safe);
      }
      if (symbol.hasAttribute("viewBox")) svg.setAttribute("viewBox", symbol.getAttribute("viewBox"));
    }
    if (!svg.childNodes.length) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M4 7 12 3 20 7 20 17 12 21 4 17Z M4 7 12 11 20 7 M12 11V21");
      path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); svg.append(path);
      const title = document.createElementNS(svg.namespaceURI, "title"); title.textContent = "物品图标未在本页加载，显示占位图标"; svg.append(title);
    }
    return svg;
  }
  function renderDetail() {
    const area = ui.detail; area.replaceChildren();
    const row = rows.find(r => r.id === selected && visibleRows().some(v => v.id === r.id));
    if (!row) {
      const empty = node("div", undefined, "detail-empty");
      empty.append(node("h3", "把这一套配装留下来"), node("p", "在网站“导入/导出”中使用主站一键导入，成功后会自动归档。", "muted"),
        node("p", "也可导入网站的现代单人 JSON，或本助手导出的备份。", "muted"),
        button("选择 JSON 文件", () => ui.file.click()), button("重新读取档案", () => refresh()));
      area.append(empty); return;
    }
    let info;
    try { info = C.details(row.payload); } catch (error) { area.append(node("p", error.message)); return; }
    area.append(node("h3", row.name), node("p", `角色：${row.characterName}`, "muted"),
      node("p", `数据采集：${date(row.capturedAt)}`, "note"),
      node("p", `来源：${row.sourceFormat} · 服务器未提供`, "note"));
    const scope = node("div", undefined, "scope");
    scope.append(node("p", "仅载入角色配装；地图、时长、市场估值和全局迷宫设置保持当前值。"));
    if (info.missing.length) scope.append(node("p", `源数据缺少或待核对：${info.missing.join("、")}。这些字段由网站规则处理，可能沿用原值或回退默认值，请载入后核对。`));
    area.append(scope);
    if (row.deletedAt) {
      area.append(button("恢复这份档案", async () => {
        await (await db()).update(row.id, { deletedAt: null, updatedAt: Date.now() }); undo = null;
        filter = "all"; ui.filter.value = filter; await refresh(); status("档案已恢复。");
      }, "primary"));
      return;
    }
    const naming = node("div", undefined, "name-field");
    const input = node("input"); input.value = draftName; input.maxLength = 120; input.setAttribute("aria-label", "配装名称");
    input.dataset.focus = "name"; input.addEventListener("input", () => { draftName = input.value; });
    naming.append(input, button(row.kind === "recent" ? "另存为配装" : "保存名称", async () => {
      const label = draftName.trim(); if (!label) throw new Error("请填写配装名称。");
      if (row.kind === "recent") {
        const copy = await C.prepare(row.payload, { id: `named:${crypto.randomUUID()}`, kind: "named", name: label });
        copy.capturedAt = row.capturedAt;
        const count = await (await db()).addNamed([copy]);
        if (count) selected = copy.id;
        await refresh(); status(count ? "命名配装已保存，后续自动导入不会覆盖它。" : "相同名称和内容的配装已存在。");
      } else {
        await (await db()).update(row.id, { name: label, updatedAt: Date.now() }); await refresh(); status("配装名称已保存。");
      }
    })); area.append(naming);
    const actions = node("div", undefined, "actions"), target = node("select"); target.setAttribute("aria-label", "载入目标玩家");
    for (let n = 1; n <= 5; n++) { const option = node("option", `玩家 ${n}`); option.value = String(n); target.append(option); }
    target.value = slot; target.onchange = () => { slot = target.value; renderDetail(); };
    const load = button(`载入玩家 ${slot}`, async () => {
      if (busy) return;
      if (!/^#\/home(?:[/?]|$)/.test(location.hash)) throw new Error("请先切换到模拟器主页，等待加载完成后再载入。");
      busy = true; render(); status(`正在载入玩家 ${slot}，等待网站确认…`);
      try { await bridge.restore(row, slot); status(`已载入玩家 ${slot}。其他玩家槽位保留；请核对源数据缺失的字段。`); }
      finally { busy = false; render(); }
    }, "primary");
    actions.append(target, load, button("导出这一套", () => exportRows([row])));
    actions.append(button("移入回收站", async () => {
      await (await db()).update(row.id, { deletedAt: Date.now(), updatedAt: Date.now() }); undo = row.id;
      selected = ""; await refresh(); status("档案已移入回收站，可随时恢复。");
    }, "danger")); area.append(actions);
    area.append(node("p", "载入会替换选中玩家槽位的角色字段，并可能重置该玩家的优化结果。", "note"));
    if (!/^#\/home(?:[/?]|$)/.test(location.hash)) area.append(button("前往模拟器主页", () => { location.hash = "/home"; }));
    const gear = node("ul", undefined, "gear");
    const names = { head: "头部", body: "身体", legs: "腿部", feet: "脚部", hands: "手部", weapon: "武器", main_hand: "主手", two_hand: "双手", off_hand: "副手", pouch: "袋子", neck: "项链", earrings: "耳环", ring: "戒指", back: "背部", charm: "护符", trinket: "饰品" };
    for (const item of info.gear) {
      const li = node("li"); li.append(node("span", names[item.slot] || item.slot, "slot"), itemMark(item.itemHrid),
        node("code", item.itemHrid), node("span", item.enhancementLevel === undefined ? "等级未知" : `+${item.enhancementLevel}`, "level")); gear.append(li);
    }
    area.append(gear);
    if (!info.gear.length) area.append(node("p", "此档案未包含已装备物品。", "note"));
  }
  function render() {
    if (!ui) return;
    const active = ui.shadow.activeElement;
    const focus = active?.dataset.focus, start = active?.selectionStart, end = active?.selectionEnd;
    const visible = visibleRows(); ui.list.replaceChildren();
    for (const row of visible) {
      const entry = button("", () => choose(row.id), "archive"); entry.setAttribute("aria-pressed", String(row.id === selected));
      entry.append(node("strong", row.name), node("small", `${row.kind === "recent" ? "最近导入" : "命名配装"} · ${row.characterName}`), node("small", date(row.capturedAt)));
      ui.list.append(entry);
    }
    if (!visible.length) ui.list.append(node("p", query ? "没有匹配的档案。" : filter === "trash" ? "回收站为空。" : "还没有配装档案。", "empty"));
    ui.launcherText.textContent = `配装档案 · ${rows.filter(row => !row.deletedAt).length}`;
    renderDetail(); renderImportPreview();
    for (const el of ui.panel.querySelectorAll("button,input,select")) el.disabled = busy;
    if (focus) {
      const next = ui.shadow.querySelector(`[data-focus="${focus}"]`);
      if (next) { next.focus(); if (start != null) next.setSelectionRange(start, end); }
    }
  }
  function mount() {
    if (ui || !document.body) return;
    const host = node("div"); host.id = "mwi-loadout-archive-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = node("style", ":host{all:initial;color-scheme:dark;font:13px/1.6 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;--bg:#111827;--surface:#1c2636;--fg:#f1f5f9;--muted:#b6c3d5;--line:#3a4a60;--accent:#2563eb;--hover:#253348;color:var(--fg)}\n:host([data-theme=\"light\"]){color-scheme:light;--bg:#fff;--surface:#f1f5f9;--fg:#182233;--muted:#4b5c73;--line:#b7c3d2;--hover:#e5edf8}\n*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:wait;opacity:.55}button,input,select{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:7px 10px}button:hover:not(:disabled){background:var(--hover)}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid #60a5fa;outline-offset:3px}input{min-width:0}::selection{background:#1d4ed8;color:#fff}a{color:#75b4ff;text-underline-offset:3px}:host([data-theme=\"light\"]) a{color:#1d4ed8}\n.launcher{position:fixed;right:20px;bottom:20px;z-index:10000;display:flex;gap:8px;align-items:center;background:var(--bg);padding:10px 16px}.launcher svg{width:18px;height:18px}.panel{position:fixed;z-index:10001;right:20px;bottom:74px;width:min(760px,calc(100vw - 40px));height:min(680px,calc(100dvh - 100px));background:var(--bg);border:1px solid var(--line);border-radius:10px;display:flex;flex-direction:column;overflow:hidden}.panel[hidden]{display:none}header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--line)}h2,h3,p{margin:0}h2{font-size:18px;line-height:1.4}h3{font-size:15px;overflow-wrap:anywhere}header p{font-size:12px;color:var(--muted);margin-top:3px}.close{border:0;background:transparent;font-size:13px;padding:7px 9px}.toolbar{display:flex;gap:8px;align-items:center;padding:12px 20px;flex-wrap:wrap}.toolbar input{flex:1;min-width:120px}.toolbar select{max-width:110px}.layout{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:0;flex:1;border-top:1px solid var(--line)}.list{overflow:auto;border-right:1px solid var(--line);padding:8px}.archive{display:block;width:100%;text-align:left;border:0;border-radius:4px;background:transparent;margin-bottom:4px;padding:10px 12px;overflow-wrap:anywhere}.archive[aria-pressed=\"true\"]{background:var(--hover);outline:1px solid var(--line)}.archive strong{display:block;font-weight:600}.archive small{display:block;color:var(--muted);font-size:11px;margin-top:2px}.detail{overflow:auto;padding:18px 20px;min-width:0}.detail>p{margin-top:8px}.muted{color:var(--muted)}.note{font-size:12px;color:var(--muted);white-space:pre-line}.scope{margin:14px 0;padding:10px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:14px}.primary{background:var(--accent);border-color:var(--accent);color:#fff}.primary:hover:not(:disabled){background:#1d4ed8}.name-field{display:flex;gap:8px;align-items:center;margin-top:16px}.name-field input{width:100%}.danger{color:#fca5a5}:host([data-theme=\"light\"]) .danger{color:#a31515}.status{flex:none;margin:0 20px 14px;padding:8px 10px;background:var(--surface);font-size:12px;min-height:36px;white-space:pre-line;overflow-wrap:anywhere}.status[data-tone=\"error\"]{color:#fca5a5}:host([data-theme=\"light\"]) .status[data-tone=\"error\"]{color:#a31515}.status button{padding:1px 8px;margin-left:8px}.empty{padding:22px 12px;color:var(--muted);font-size:12px}.detail-empty{padding-top:30px}.detail-empty h3{margin-bottom:8px}.detail-empty p{margin:8px 0}.gear{margin:14px 0 0;padding:0;list-style:none}.gear li{display:flex;gap:8px;align-items:center;min-height:29px;border-bottom:1px solid var(--line);font-size:12px}.gear code{font:11px/1.6 ui-monospace,monospace;overflow-wrap:anywhere}.gear .slot{flex:none;color:var(--muted);width:38px}.gear .level{margin-left:auto;white-space:nowrap}.item-mark{width:20px;height:20px;flex:none;color:var(--muted)}.file{display:none}.bottom{padding:9px 20px 12px;color:var(--muted);font-size:11px}\n@media(max-width:600px){.launcher{right:12px;bottom:12px}.panel{right:8px;bottom:64px;width:calc(100vw - 16px);height:calc(100dvh - 84px)}header{padding:12px 14px}.toolbar{padding:10px 14px}.layout{grid-template-columns:1fr;grid-template-rows:minmax(90px,32%) minmax(0,1fr)}.list{border-right:0;border-bottom:1px solid var(--line)}.detail{padding:14px}.status{margin:0 14px 10px}.bottom{padding:8px 14px}.name-field{flex-wrap:wrap}.actions select{max-width:100%}}\n.name-field button{flex:none;white-space:nowrap}input::placeholder{color:var(--muted);opacity:1}\n@media(prefers-reduced-motion:no-preference){.panel{animation:archive-open .14s ease-out}@keyframes archive-open{from{clip-path:inset(6% 0 0 0);opacity:.85}to{clip-path:inset(0);opacity:1}}}\n");
    const launcherText = node("span", "配装档案");
    const launcher = button("", () => {
      panelOpen = !panelOpen; panel.hidden = !panelOpen; launcher.setAttribute("aria-expanded", String(panelOpen));
      if (panelOpen) { refresh().catch(error => status(error.message, "error")); search.focus(); }
    }, "launcher"); launcher.setAttribute("aria-expanded", "false"); launcher.setAttribute("aria-controls", "archive-panel");
    launcher.append(launcherText);
    const panel = node("aside", undefined, "panel"); panel.hidden = true; panel.id = "archive-panel";
    panel.setAttribute("aria-label", "配装档案管理");
    const head = node("header"), heading = node("div");
    heading.append(node("h2", "配装档案"), node("p", "当前浏览器本地保存 · 支持 JSON 备份"));
    head.append(heading, button("关闭", () => { panelOpen = false; panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); launcher.focus(); }, "close"));
    const toolbar = node("div", undefined, "toolbar"), search = node("input");
    search.type = "search"; search.placeholder = "搜索配装或角色"; search.setAttribute("aria-label", "搜索配装或角色");
    search.addEventListener("input", () => { query = search.value; render(); });
    const filterSelect = node("select"); filterSelect.setAttribute("aria-label", "档案分类");
    for (const [value, label] of [["all", "全部档案"], ["recent", "最近导入"], ["named", "命名配装"], ["trash", "回收站"]]) {
      const option = node("option", label); option.value = value; filterSelect.append(option);
    }
    filterSelect.onchange = () => { filter = filterSelect.value; selected = ""; const first = visibleRows()[0]; if (first) choose(first.id); else render(); };
    const file = node("input", undefined, "file"); file.type = "file"; file.accept = ".json,application/json";
    file.setAttribute("aria-label", "导入 JSON 文件");
    file.onchange = () => { const selectedFile = file.files[0]; file.value = ""; addFile(selectedFile).catch(error => status(error.message, "error")); };
    toolbar.append(search, filterSelect, button("导入 JSON", () => file.click()),
      button("备份全部", () => exportRows(rows.filter(row => !row.deletedAt))));
    const layout = node("div", undefined, "layout"), list = node("nav", undefined, "list"), detail = node("section", undefined, "detail");
    list.setAttribute("aria-label", "配装列表"); detail.setAttribute("aria-label", "档案详情"); layout.append(list, detail);
    const importPreview = node("div", undefined, "toolbar"), live = node("div", undefined, "status");
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true");
    panel.append(head, toolbar, layout, importPreview, live, node("p", "自动归档一键导入数据；手动调整后的方案请从网站导出单人 JSON 再导入。", "bottom"));
    shadow.append(style, panel, launcher, file); document.body.append(host);
    ui = { host, shadow, panel, launcher, launcherText, status: live, list, detail, file,
      filter: filterSelect, importPreview };
    const syncTheme = () => host.dataset.theme = document.documentElement.dataset.theme === "light" ||
      (!document.documentElement.classList.contains("dark") && document.documentElement.dataset.theme !== "dark") ? "light" : "dark";
    syncTheme(); new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    shadow.addEventListener("keydown", event => {
      if (event.key === "Escape" && panelOpen) { panelOpen = false; panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); launcher.focus(); event.stopPropagation(); }
    });
    window.addEventListener("hashchange", () => { if (panelOpen) renderDetail(); });
    // Reload on focus to see committed changes from another tab; no timer or global storage clearing.
    window.addEventListener("focus", () => { if (panelOpen && !busy) refresh().catch(error => status(error.message, "error")); });
    status(lastStatus, lastTone); refresh().catch(error => status(error.message, "error"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window);
