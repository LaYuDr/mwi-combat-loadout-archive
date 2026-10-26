// ==UserScript==
// @name         MWI 战斗模拟器配装档案助手
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive
// @version      0.2.1
// @author       柆雨
// @homepageURL  https://github.com/LaYuDr/mwi-combat-loadout-archive
// @supportURL   https://github.com/LaYuDr/mwi-combat-loadout-archive/issues
// @updateURL    https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.user.js
// @description  保存网页当前单人或整队配置，通过原生导入导出恢复，支持命名、回收站和 JSON 备份。
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
  // Native current-character payloads also use {} for an empty combat slot list.
  // Preserve that representation; do not coerce it to [], missing, or three filled slots.
  // Limit this compatibility to native maps: modern player food/drinks remain arrays.
  const nativeSlots = (v, p) => plain(v) && Object.keys(v).length === 0 ? {} : slots(v, p);
  const actionSlots = dict(/^\/action_types\/combat$/, nativeSlots);
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

// ---- native_document.js ----
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./archive_core.js"));
  else root.MWINativeDocument = factory(root.MWILoadoutCore);
})(globalThis, function (legacy) {
  "use strict";
  const FORMAT = "mwi-loadout-archive", MAX_BYTES = 20 * 1024 * 1024, MAX_RECORDS = 500;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function parse(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES)
      throw new Error("JSON 文件超过 20 MB，请拆分后重试。");
    try {
      return JSON.parse(text, (key, value) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("不安全的字段");
        return value;
      });
    } catch (_) { throw new Error("JSON 无法解析或包含不安全字段，请选择网页原生导出或本助手的备份。"); }
  }
  function inspect(text) {
    const data = parse(text);
    const scope = data?.version === 2 && data.format === "mwi-vue-solo" && object(data.player) ? "solo"
      : data?.version === 2 && data.format === "mwi-vue-group" && Array.isArray(data.players) ? "group" : null;
    if (!scope) throw new Error("不是网页原生的现代单人或整队 JSON，请在网页导入/导出中重新导出。");
    const players = scope === "solo" ? [data.player] : data.players;
    if (!players.length || players.length > 5) throw new Error("原生配置必须包含 1 至 5 位玩家。");
    const ids = new Set();
    for (const p of players) {
      if (!object(p) || !/^[1-5]$/.test(String(p.id)) || ids.has(String(p.id)) || typeof p.name !== "string" ||
          p.name.length > 1000 || !object(p.levels) || !object(p.equipment))
        throw new Error("玩家槽位或配置格式不完整，未保存或导入任何数据。");
      ids.add(String(p.id));
    }
    // Inspect structure, never rebuild or remove fields from a native export.
    // This also retains future fields, explicit zero, null, empty objects and arrays.
    let nodes = 0;
    function check(value, depth = 0) {
      if (++nodes > 200000 || depth > 64) throw new Error("JSON 结构过大或嵌套过深。");
      if (value && typeof value === "object") for (const entry of Object.values(value)) check(entry, depth + 1);
    }
    check(data);
    return { scope, data, players, names: players.map(p => p.name || `玩家 ${p.id}`) };
  }
  function validName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error("名称需要 1 至 120 个字符。");
    return value.trim();
  }
  async function prepare(text, options = {}) {
    const info = inspect(text), now = options.now ?? Date.now();
    const label = (options.name === undefined || options.name === "" ? "" : validName(options.name)) || (info.scope === "solo" ? `${info.names[0].slice(0, 110)} · 配装` : `${info.players.length} 人整队配置`);
    return { schemaVersion: 2, id: options.id || `native:${globalThis.crypto.randomUUID()}`, kind: "named",
      name: validName(label), documentKind: info.scope, jsonText: text, characterName: info.names.join("、"),
      sourceFormat: info.data.format, fingerprint: await legacy.digest(info.data),
      capturedAt: now, createdAt: now, updatedAt: now, deletedAt: null };
  }
  function describe(row) {
    if (row.schemaVersion === 2 && typeof row.jsonText === "string") return { ...inspect(row.jsonText), legacy: false, text: row.jsonText };
    const cleaned = legacy.sanitizePayload(row.payload);
    return { legacy: true, scope: "solo", text: JSON.stringify(cleaned.payload),
      names: [row.characterName || cleaned.characterName], players: [], data: cleaned.payload };
  }
  async function importFile(text) {
    const data = parse(text);
    let entries;
    if (data?.format === FORMAT && data.version === 2 && Array.isArray(data.archives)) {
      entries = data.archives;
    } else if (data?.format === FORMAT && data.version === 1) {
      entries = legacy.parseFile(text).map(e => ({ name: e.name, capturedAt: e.capturedAt, legacyPayload: e.payload }));
    } else if (data?.format === "mwi-vue-solo" || data?.format === "mwi-vue-group") entries = [{ jsonText: text }];
    else throw new Error("请选择网页原生 JSON 或配装助手备份；游戏原始资料请先导入网页，再保存当前配置。");
    if (!entries.length || entries.length > MAX_RECORDS) throw new Error("每个文件需包含 1 至 500 份档案。");
    // Validate every entry before returning anything to the storage transaction.
    const rows = [];
    for (const entry of entries) {
      if (!object(entry)) throw new Error("备份档案格式错误。");
      let row;
      if (typeof entry.jsonText === "string" && !Object.hasOwn(entry, "legacyPayload")) row = await prepare(entry.jsonText, { name: entry.name });
      else if (object(entry.legacyPayload) && !Object.hasOwn(entry, "jsonText")) row = await legacy.prepare(entry.legacyPayload,
        { id: `legacy:${globalThis.crypto.randomUUID()}`, kind: "named", name: validName(entry.name) });
      else throw new Error("备份档案缺少原生 JSON，或包含冲突的配装格式。");
      if (entry.name !== undefined) row.name = validName(entry.name);
      if (Number.isFinite(entry.capturedAt) && entry.capturedAt > 0 && entry.capturedAt <= Date.now()) row.capturedAt = entry.capturedAt;
      rows.push(row);
    }
    return rows;
  }
  function backup(rows) {
    if (!rows.length) throw new Error("没有可备份的档案。");
    return JSON.stringify({ format: FORMAT, version: 2, exportedAt: new Date().toISOString(), archives: rows.map(row => {
      const info = describe(row);
      return { name: validName(row.name), capturedAt: row.capturedAt,
        ...(info.legacy ? { legacyPayload: info.data } : { jsonText: row.jsonText }) };
    }) }, null, 2);
  }
  return Object.freeze({ FORMAT, MAX_BYTES, MAX_RECORDS, parse, inspect, prepare, describe, validName, importFile, backup });
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

// ---- native_adapter.js ----
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWINativeAdapter = factory();
})(globalThis, function () {
  "use strict";
  const words = {
    open: /^(?:导入\s*\/\s*导出|Import\s*\/\s*Export)$/i,
    soloExport: /^(?:导出单人|Export Solo)$/i, groupExport: /^(?:导出组队|Export Group)$/i,
    soloImport: /^(?:导入到玩家|Import To Player)$/i, groupImport: /^(?:导入组队|Import Group)$/i,
    close: /^(?:关闭|Close)$/i
  };
  const label = element => (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
  const visible = element => !!element && !element.hidden && element.getClientRects().length > 0;
  function uniqueButton(parent, expression) {
    const all = [...parent.querySelectorAll("button")].filter(b => visible(b) && expression.test(label(b)));
    if (all.length !== 1) throw new Error("未能唯一识别网页原生导入/导出控件，请关闭其他弹窗并回到模拟器主页后重试。");
    if (all[0].disabled) throw new Error("网页原生操作暂不可用，请先处理当前编辑或等待网页加载。");
    return all[0];
  }
  function create({ document: doc = document, inspect, timeout = 45000 } = {}) {
    let locked = false, recovery = null, recoveryBackedUp = false;
    const win = doc.defaultView;
    const sleep = () => new Promise(resolve => win.setTimeout(resolve, 50));
    async function wait(check, message, state) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (state?.interrupted) throw new Error("检测到你正在操作网页，已停止后续自动步骤；请核对当前网页状态。");
        if (state?.modal && [...doc.querySelectorAll('[role="dialog"]')].some(el => el !== state.modal && visible(el))) {
          state.interrupted = true;
          throw new Error("网页出现了其他弹窗，已停止后续步骤；请先处理网页提示，再下载原有输入备份。");
        }
        if (state?.modal && !visible(state.modal)) throw new Error("网页导入/导出窗口已关闭，本次操作未获确认。");
        const result = check(); if (result) return result;
        await sleep();
      }
      if (state) state.uncertain = true;
      throw new Error(message);
    }
    function findModal() {
      const matches = [...doc.querySelectorAll('[role="dialog"]')].filter(el => visible(el) &&
        [...el.querySelectorAll("button")].some(b => words.soloExport.test(label(b))));
      if (matches.length > 1) throw new Error("存在多个原生导入/导出窗口，请先关闭多余窗口。");
      return matches[0];
    }
    function controls(modal, scope) {
      const exportButton = uniqueButton(modal, words[`${scope}Export`]);
      let section = exportButton.parentElement;
      while (section && section !== modal && !section.querySelector("textarea")) section = section.parentElement;
      if (!section || section === modal || section.querySelectorAll("textarea").length !== 1 || section.querySelectorAll('input[type="file"]').length !== 1)
        throw new Error("网页原生表单结构已变化，未执行保存或导入，请更新配装助手。");
      return { section, textarea: section.querySelector("textarea"), file: section.querySelector('input[type="file"]'),
        exportButton, importButton: uniqueButton(section, words[`${scope}Import`]) };
    }
    function setText(element, value) {
      const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value").set;
      setter.call(element, value); element.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    function status(modal) {
      const candidates = [...modal.querySelectorAll(".modal-body-text > div > p.text-success,.modal-body-text > div > p.text-destructive,.modal-body-text > div > p.text-muted-foreground")].filter(visible);
      if (candidates.length > 1) throw new Error("网页结果区域有歧义，请关闭其他提示后重试。");
      return candidates[0]?.textContent.trim() || "";
    }
    function assertPage() {
      if (!/^#\/home(?:[/?]|$)/.test(win.location.hash)) throw new Error("请先打开模拟器主页，等待配置加载完成后重试。");
    }
    async function selectPlayer(modal, slot, state) {
      if (!/^[1-5]$/.test(String(slot))) throw new Error("请选择玩家 1 至 5。");
      const { section } = controls(modal, "solo");
      const trigger = section.querySelector('[role="combobox"]');
      if (!trigger) throw new Error("未找到网页原生玩家选择器，请更新插件后重试。");
      // Use the public keyboard interaction of the native Reka selector.
      trigger.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
      const options = await wait(() => {
        const popup = doc.getElementById(trigger.getAttribute("aria-controls"));
        const items = popup && [...popup.querySelectorAll('[role="option"]')].filter(visible);
        return items?.length ? items : null;
      }, "网页玩家选择器没有打开，请手动关闭弹窗后重试。", state);
      // The verified native form enumerates simulator.players in fixed slot order.
      // Refuse changed cardinality; single export also verifies the resulting player.id.
      if (options.length !== 5) throw new Error("网页玩家槽位结构已变化，未执行导入。");
      const old = options.findIndex(o => o.getAttribute("aria-selected") === "true");
      options[Number(slot) - 1].dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await wait(() => trigger.getAttribute("aria-expanded") !== "true", "网页玩家选择未完成。", state);
      return old >= 0 ? String(old + 1) : null;
    }
    async function exportCurrent(modal, scope, slot, state) {
      const c = controls(modal, scope), beforeStatus = status(modal);
      setText(c.textarea, ""); c.exportButton.click();
      return wait(() => {
        if (c.textarea.value.trim()) {
          const info = inspect(c.textarea.value);
          if (info.scope !== scope || (scope === "solo" && String(info.players[0].id) !== String(slot)))
            throw new Error("网页返回的导出范围与选择不符，本次没有保存或导入。");
          return c.textarea.value;
        }
        const message = status(modal);
        if (message && message !== beforeStatus && /失败|failed|error/i.test(message)) throw new Error(`网页导出失败：${message}`);
        return null;
      }, "网页未在限定时间内生成新的导出内容；档案没有写入，请核对网页后重试。", state);
    }
    async function session(scope, slot, action, { confirmedGroup = false } = {}) {
      if (locked) throw new Error("上一项网页操作还未结束，请稍后重试。");
      assertPage();
      if (recovery && !recoveryBackedUp) throw new Error("上次网页操作未获确认，请先下载网页原有输入备份，再开始新操作。");
      locked = true;
      const state = { modal: null, interrupted: false, uncertain: false }, previousFocus = doc.activeElement;
      let opened = false, draft, savedSlot = null;
      const onInteraction = event => {
        if (event.isTrusted) {
          state.interrupted = true;
          try { state.inputSnapshot = { solo: controls(state.modal, "solo").textarea.value, group: controls(state.modal, "group").textarea.value }; }
          catch (_) { /* Keep the original copy if the website removed its form. */ }
        }
      };
      const rememberDraft = () => {
        if (draft) { recovery = { original: draft, interrupted: state.inputSnapshot || null }; recoveryBackedUp = false; }
      };
      try {
        let modal = findModal(); opened = !modal;
        if (!modal) {
          if ([...doc.querySelectorAll('[role="dialog"]')].some(visible)) throw new Error("请先关闭网页上其他弹窗，再保存或导入配置。");
          uniqueButton(doc, words.open).click();
          modal = await wait(findModal, "网页导入/导出窗口未打开，请等待主页加载后重试。");
        }
        state.modal = modal;
        // Opening a portaled selector while the native dialog is still zooming
        // destabilizes its ResizeObserver/Floating UI measurements. Wait for the
        // website's finite entrance animation before interacting with controls.
        await wait(() => !modal.getAnimations().some(a => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity),
          "网页导入/导出窗口仍在加载，请稍后重试。", state);
        draft = { solo: controls(modal, "solo").textarea.value, group: controls(modal, "group").textarea.value };
        modal.addEventListener("input", onInteraction, true); modal.addEventListener("click", onInteraction, true); modal.addEventListener("keydown", onInteraction, true);
        if (scope === "solo") savedSlot = await selectPlayer(modal, slot, state);
        return await action(modal, state);
      } finally {
        const modal = state.modal;
        if (modal) {
          modal.removeEventListener("input", onInteraction, true); modal.removeEventListener("click", onInteraction, true); modal.removeEventListener("keydown", onInteraction, true);
          if (state.uncertain || state.interrupted) {
            // Native async handlers cannot be cancelled. Keep a recoverable copy of
            // draft text instead of overwriting text while they may still finish.
            rememberDraft();
          } else if (visible(modal)) {
            try {
              if (draft) for (const key of ["solo", "group"]) setText(controls(modal, key).textarea, draft[key]);
              if (!opened && savedSlot) await selectPlayer(modal, savedSlot);
              if (opened) {
                uniqueButton(modal, words.close).click();
                // Reka keeps closing dialogs mounted during the exit transition.
                // Do not let the next operation adopt that disappearing instance.
                await wait(() => !visible(modal), "网页窗口尚未关闭，请手动关闭后重试。");
              }
            } catch (_) { rememberDraft(); }
          } else { rememberDraft(); }
        }
        locked = false;
        if (previousFocus?.isConnected && !findModal()) previousFocus.focus();
      }
    }
    return Object.freeze({
      capture(scope, slot) {
        if (!["solo", "group"].includes(scope)) return Promise.reject(new Error("请选择保存单人还是整队。"));
        return session(scope, slot, (modal, state) => exportCurrent(modal, scope, slot, state));
      },
      restore(text, scope, slot, { confirmedGroup = false, legacy = false } = {}) {
        if (scope === "group" && !confirmedGroup) return Promise.reject(new Error("恢复整队配置前，请先确认影响范围。"));
        if (!["solo", "group"].includes(scope)) return Promise.reject(new Error("档案恢复范围无效。"));
        if (!legacy && inspect(text).scope !== scope) return Promise.reject(new Error("档案范围与导入入口不一致。"));
        return session(scope, slot, async (modal, state) => {
          // Prove the native target id before any configuration replacement.
          if (scope === "solo") await exportCurrent(modal, scope, slot, state);
          const c = controls(modal, scope), filename = `mwi-archive-${win.crypto.randomUUID()}.json`;
          const transfer = new win.DataTransfer(); transfer.items.add(new win.File([text], filename, { type: "application/json" }));
          c.file.files = transfer.files; c.file.dispatchEvent(new win.Event("change", { bubbles: true }));
          await wait(() => c.textarea.value === text && status(modal).includes(filename), "网页未确认读取档案文件，尚未点击导入。", state);
          c.importButton.click();
          const message = await wait(() => {
            const result = status(modal); return result && !result.includes(filename) ? result : null;
          }, "网页没有确认导入结果，可能仍在处理中；请核对网页配置，不要反复点击导入。", state);
          if (!/导入成功|导入.*成功|import success|imported successfully/i.test(message)) throw new Error(`网页未完成导入：${message}`);
          return message;
        }, { confirmedGroup });
      },
      get recoveryAvailable() { return !!recovery; },
      backupDraft() {
        if (!recovery) throw new Error("没有需要取回的原有输入文本。");
        const text = JSON.stringify({ format: "mwi-native-input-recovery", version: 1, savedAt: new Date().toISOString(), ...recovery }, null, 2);
        // Keep the copy available for repeated download. Do not write it back
        // into a form whose native asynchronous handler may still be running.
        recoveryBackedUp = true;
        return text;
      }
    });
  }
  return Object.freeze({ create });
});

// ---- equipment_catalog.js ----
// Milky Way Idle public item names and equipment requirements; rights belong to the game authors.
// Extracted from the simulator's official-data snapshot; no player data or runtime network requests.
// Regenerate with source/generate_equipment_catalog.cjs. Do not hand-edit the catalogue.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MWIEquipmentCatalog=factory();})(globalThis,function(){'use strict';return {"metadata":{"source":"https://github.com/azhu949/MWICombatSimulator","generatedAt":"2026-09-14T06:40:54.365Z","inputSha256":{"src/shared/gameDataIndex.generated.json":"aa28120d2bdac27595abdb7a7f77f2c9cc43fc026f311d9929f2f358f529a604","src/combatsimulator/data/itemDetailMap.json":"4460b2ba46722465b4b2786f11be08b1a6d6624e2688af94537cf95aeebdf413","locales/zh/translation.official.generated.json":"ae3529d6e6d3909928166274eeda2b729f6c5a270067df6dacad8773b2cfe16d","locales/en/translation.official.generated.json":"c8ce59e745f5fc6ba816f450c028bde3fc97725f23447193f1c00b053b6fd93b"}},"slots":{"head":{"zh":"头部","en":"Head"},"body":{"zh":"身体","en":"Body"},"legs":{"zh":"腿部","en":"Legs"},"feet":{"zh":"脚部","en":"Feet"},"hands":{"zh":"手部","en":"Hands"},"weapon":{"zh":"主手","en":"Main Hand"},"off_hand":{"zh":"副手","en":"Off Hand"},"pouch":{"zh":"袋子","en":"Pouch"},"neck":{"zh":"项链","en":"Neck"},"earrings":{"zh":"耳环","en":"Earrings"},"ring":{"zh":"戒指","en":"Ring"},"back":{"zh":"背部","en":"Back"},"charm":{"zh":"护符","en":"Charm"}},"items":[{"hrid":"/items/cheese_helmet","slot":"head","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪头盔","en":"Cheese Helmet"},{"hrid":"/items/cotton_hat","slot":"head","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"棉帽","en":"Cotton Hat"},{"hrid":"/items/rough_hood","slot":"head","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"粗糙兜帽","en":"Rough Hood"},{"hrid":"/items/verdant_helmet","slot":"head","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿头盔","en":"Verdant Helmet"},{"hrid":"/items/linen_hat","slot":"head","itemLevel":15,"requirements":[{"skillHrid":"/skills/magic","level":15}],"zh":"亚麻帽","en":"Linen Hat"},{"hrid":"/items/reptile_hood","slot":"head","itemLevel":15,"requirements":[{"skillHrid":"/skills/ranged","level":15}],"zh":"爬行动物兜帽","en":"Reptile Hood"},{"hrid":"/items/azure_helmet","slot":"head","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝头盔","en":"Azure Helmet"},{"hrid":"/items/snail_shell_helmet","slot":"head","itemLevel":25,"requirements":[{"skillHrid":"/skills/defense","level":25}],"zh":"蜗牛壳头盔","en":"Snail Shell Helmet"},{"hrid":"/items/bamboo_hat","slot":"head","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"竹帽","en":"Bamboo Hat"},{"hrid":"/items/burble_helmet","slot":"head","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫头盔","en":"Burble Helmet"},{"hrid":"/items/gobo_hood","slot":"head","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"哥布林兜帽","en":"Gobo Hood"},{"hrid":"/items/crimson_helmet","slot":"head","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红头盔","en":"Crimson Helmet"},{"hrid":"/items/beast_hood","slot":"head","itemLevel":55,"requirements":[{"skillHrid":"/skills/ranged","level":55}],"zh":"野兽兜帽","en":"Beast Hood"},{"hrid":"/items/silk_hat","slot":"head","itemLevel":55,"requirements":[{"skillHrid":"/skills/magic","level":55}],"zh":"丝帽","en":"Silk Hat"},{"hrid":"/items/vision_helmet","slot":"head","itemLevel":55,"requirements":[{"skillHrid":"/skills/defense","level":55}],"zh":"视觉头盔","en":"Vision Helmet"},{"hrid":"/items/red_culinary_hat","slot":"head","itemLevel":60,"requirements":[{"skillHrid":"/skills/cooking","level":60},{"skillHrid":"/skills/brewing","level":60}],"zh":"红色厨师帽","en":"Red Culinary Hat"},{"hrid":"/items/rainbow_helmet","slot":"head","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹头盔","en":"Rainbow Helmet"},{"hrid":"/items/radiant_hat","slot":"head","itemLevel":75,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"光辉帽","en":"Radiant Hat"},{"hrid":"/items/umbral_hood","slot":"head","itemLevel":75,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"暗影兜帽","en":"Umbral Hood"},{"hrid":"/items/fluffy_red_hat","slot":"head","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"蓬松红帽子","en":"Fluffy Red Hat"},{"hrid":"/items/holy_helmet","slot":"head","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣头盔","en":"Holy Helmet"},{"hrid":"/items/acrobatic_hood","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"杂技师兜帽","en":"Acrobatic Hood"},{"hrid":"/items/acrobatic_hood_refined","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"杂技师兜帽 ★","en":"Acrobatic Hood ★"},{"hrid":"/items/corsair_helmet","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"掠夺者头盔","en":"Corsair Helmet"},{"hrid":"/items/corsair_helmet_refined","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"掠夺者头盔 ★","en":"Corsair Helmet ★"},{"hrid":"/items/magicians_hat","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"魔术师帽","en":"Magician's Hat"},{"hrid":"/items/magicians_hat_refined","slot":"head","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"魔术师帽 ★","en":"Magician's Hat ★"},{"hrid":"/items/cheese_plate_body","slot":"body","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪胸甲","en":"Cheese Plate Body"},{"hrid":"/items/cotton_robe_top","slot":"body","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"棉袍服","en":"Cotton Robe Top"},{"hrid":"/items/rough_tunic","slot":"body","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"粗糙皮衣","en":"Rough Tunic"},{"hrid":"/items/verdant_plate_body","slot":"body","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿胸甲","en":"Verdant Plate Body"},{"hrid":"/items/linen_robe_top","slot":"body","itemLevel":15,"requirements":[{"skillHrid":"/skills/magic","level":15}],"zh":"亚麻袍服","en":"Linen Robe Top"},{"hrid":"/items/reptile_tunic","slot":"body","itemLevel":15,"requirements":[{"skillHrid":"/skills/ranged","level":15}],"zh":"爬行动物皮衣","en":"Reptile Tunic"},{"hrid":"/items/azure_plate_body","slot":"body","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝胸甲","en":"Azure Plate Body"},{"hrid":"/items/gator_vest","slot":"body","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"鳄鱼马甲","en":"Gator Vest"},{"hrid":"/items/turtle_shell_body","slot":"body","itemLevel":30,"requirements":[{"skillHrid":"/skills/defense","level":30}],"zh":"龟壳胸甲","en":"Turtle Shell Body"},{"hrid":"/items/bamboo_robe_top","slot":"body","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"竹袍服","en":"Bamboo Robe Top"},{"hrid":"/items/burble_plate_body","slot":"body","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫胸甲","en":"Burble Plate Body"},{"hrid":"/items/gobo_tunic","slot":"body","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"哥布林皮衣","en":"Gobo Tunic"},{"hrid":"/items/crimson_plate_body","slot":"body","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红胸甲","en":"Crimson Plate Body"},{"hrid":"/items/flaming_robe_top","slot":"body","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"烈焰袍服","en":"Flaming Robe Top"},{"hrid":"/items/icy_robe_top","slot":"body","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"冰霜袍服","en":"Icy Robe Top"},{"hrid":"/items/marine_tunic","slot":"body","itemLevel":50,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"海洋皮衣","en":"Marine Tunic"},{"hrid":"/items/beast_tunic","slot":"body","itemLevel":55,"requirements":[{"skillHrid":"/skills/ranged","level":55}],"zh":"野兽皮衣","en":"Beast Tunic"},{"hrid":"/items/silk_robe_top","slot":"body","itemLevel":55,"requirements":[{"skillHrid":"/skills/magic","level":55}],"zh":"丝绸袍服","en":"Silk Robe Top"},{"hrid":"/items/rainbow_plate_body","slot":"body","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹胸甲","en":"Rainbow Plate Body"},{"hrid":"/items/luna_robe_top","slot":"body","itemLevel":70,"requirements":[{"skillHrid":"/skills/magic","level":70}],"zh":"月神袍服","en":"Luna Robe Top"},{"hrid":"/items/radiant_robe_top","slot":"body","itemLevel":75,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"光辉袍服","en":"Radiant Robe Top"},{"hrid":"/items/umbral_tunic","slot":"body","itemLevel":75,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"暗影皮衣","en":"Umbral Tunic"},{"hrid":"/items/holy_plate_body","slot":"body","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣胸甲","en":"Holy Plate Body"},{"hrid":"/items/colossus_plate_body","slot":"body","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"巨像胸甲","en":"Colossus Plate Body"},{"hrid":"/items/demonic_plate_body","slot":"body","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"恶魔胸甲","en":"Demonic Plate Body"},{"hrid":"/items/griffin_tunic","slot":"body","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85},{"skillHrid":"/skills/ranged","level":85}],"zh":"狮鹫皮衣","en":"Griffin Tunic"},{"hrid":"/items/revenant_tunic","slot":"body","itemLevel":85,"requirements":[{"skillHrid":"/skills/ranged","level":85}],"zh":"亡灵皮衣","en":"Revenant Tunic"},{"hrid":"/items/alchemists_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/alchemy","level":90}],"zh":"炼金师上衣","en":"Alchemist's Top"},{"hrid":"/items/brewers_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/brewing","level":90}],"zh":"饮品师上衣","en":"Brewer's Top"},{"hrid":"/items/cheesemakers_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/cheesesmithing","level":90}],"zh":"奶酪师上衣","en":"Cheesemaker's Top"},{"hrid":"/items/chefs_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/cooking","level":90}],"zh":"厨师上衣","en":"Chef's Top"},{"hrid":"/items/crafters_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/crafting","level":90}],"zh":"工匠上衣","en":"Crafter's Top"},{"hrid":"/items/dairyhands_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/milking","level":90}],"zh":"挤奶工上衣","en":"Dairyhand's Top"},{"hrid":"/items/enhancers_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/enhancing","level":90}],"zh":"强化师上衣","en":"Enhancer's Top"},{"hrid":"/items/foragers_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/foraging","level":90}],"zh":"采摘者上衣","en":"Forager's Top"},{"hrid":"/items/lumberjacks_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/woodcutting","level":90}],"zh":"伐木工上衣","en":"Lumberjack's Top"},{"hrid":"/items/tailors_top","slot":"body","itemLevel":90,"requirements":[{"skillHrid":"/skills/tailoring","level":90}],"zh":"裁缝上衣","en":"Tailor's Top"},{"hrid":"/items/anchorbound_plate_body","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"锚定胸甲","en":"Anchorbound Plate Body"},{"hrid":"/items/anchorbound_plate_body_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"锚定胸甲 ★","en":"Anchorbound Plate Body ★"},{"hrid":"/items/kraken_tunic","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"克拉肯皮衣","en":"Kraken Tunic"},{"hrid":"/items/kraken_tunic_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"克拉肯皮衣 ★","en":"Kraken Tunic ★"},{"hrid":"/items/maelstrom_plate_body","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"怒涛胸甲","en":"Maelstrom Plate Body"},{"hrid":"/items/maelstrom_plate_body_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"怒涛胸甲 ★","en":"Maelstrom Plate Body ★"},{"hrid":"/items/royal_fire_robe_top","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家火系袍服","en":"Royal Fire Robe Top"},{"hrid":"/items/royal_fire_robe_top_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家火系袍服 ★","en":"Royal Fire Robe Top ★"},{"hrid":"/items/royal_nature_robe_top","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家自然系袍服","en":"Royal Nature Robe Top"},{"hrid":"/items/royal_nature_robe_top_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家自然系袍服 ★","en":"Royal Nature Robe Top ★"},{"hrid":"/items/royal_water_robe_top","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家水系袍服","en":"Royal Water Robe Top"},{"hrid":"/items/royal_water_robe_top_refined","slot":"body","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家水系袍服 ★","en":"Royal Water Robe Top ★"},{"hrid":"/items/cheese_plate_legs","slot":"legs","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪腿甲","en":"Cheese Plate Legs"},{"hrid":"/items/cotton_robe_bottoms","slot":"legs","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"棉袍裙","en":"Cotton Robe Bottoms"},{"hrid":"/items/rough_chaps","slot":"legs","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"粗糙皮裤","en":"Rough Chaps"},{"hrid":"/items/verdant_plate_legs","slot":"legs","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿腿甲","en":"Verdant Plate Legs"},{"hrid":"/items/linen_robe_bottoms","slot":"legs","itemLevel":15,"requirements":[{"skillHrid":"/skills/magic","level":15}],"zh":"亚麻袍裙","en":"Linen Robe Bottoms"},{"hrid":"/items/reptile_chaps","slot":"legs","itemLevel":15,"requirements":[{"skillHrid":"/skills/ranged","level":15}],"zh":"爬行动物皮裤","en":"Reptile Chaps"},{"hrid":"/items/azure_plate_legs","slot":"legs","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝腿甲","en":"Azure Plate Legs"},{"hrid":"/items/turtle_shell_legs","slot":"legs","itemLevel":30,"requirements":[{"skillHrid":"/skills/defense","level":30}],"zh":"龟壳腿甲","en":"Turtle Shell Legs"},{"hrid":"/items/bamboo_robe_bottoms","slot":"legs","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"竹袍裙","en":"Bamboo Robe Bottoms"},{"hrid":"/items/burble_plate_legs","slot":"legs","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫腿甲","en":"Burble Plate Legs"},{"hrid":"/items/gobo_chaps","slot":"legs","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"哥布林皮裤","en":"Gobo Chaps"},{"hrid":"/items/crimson_plate_legs","slot":"legs","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红腿甲","en":"Crimson Plate Legs"},{"hrid":"/items/flaming_robe_bottoms","slot":"legs","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"烈焰袍裙","en":"Flaming Robe Bottoms"},{"hrid":"/items/icy_robe_bottoms","slot":"legs","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"冰霜袍裙","en":"Icy Robe Bottoms"},{"hrid":"/items/marine_chaps","slot":"legs","itemLevel":50,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"航海皮裤","en":"Marine Chaps"},{"hrid":"/items/beast_chaps","slot":"legs","itemLevel":55,"requirements":[{"skillHrid":"/skills/ranged","level":55}],"zh":"野兽皮裤","en":"Beast Chaps"},{"hrid":"/items/silk_robe_bottoms","slot":"legs","itemLevel":55,"requirements":[{"skillHrid":"/skills/magic","level":55}],"zh":"丝绸袍裙","en":"Silk Robe Bottoms"},{"hrid":"/items/rainbow_plate_legs","slot":"legs","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹腿甲","en":"Rainbow Plate Legs"},{"hrid":"/items/luna_robe_bottoms","slot":"legs","itemLevel":70,"requirements":[{"skillHrid":"/skills/magic","level":70}],"zh":"月神袍裙","en":"Luna Robe Bottoms"},{"hrid":"/items/radiant_robe_bottoms","slot":"legs","itemLevel":75,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"光辉袍裙","en":"Radiant Robe Bottoms"},{"hrid":"/items/umbral_chaps","slot":"legs","itemLevel":75,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"暗影皮裤","en":"Umbral Chaps"},{"hrid":"/items/holy_plate_legs","slot":"legs","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣腿甲","en":"Holy Plate Legs"},{"hrid":"/items/colossus_plate_legs","slot":"legs","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"巨像腿甲","en":"Colossus Plate Legs"},{"hrid":"/items/demonic_plate_legs","slot":"legs","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"恶魔腿甲","en":"Demonic Plate Legs"},{"hrid":"/items/griffin_chaps","slot":"legs","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85},{"skillHrid":"/skills/ranged","level":85}],"zh":"狮鹫皮裤","en":"Griffin Chaps"},{"hrid":"/items/revenant_chaps","slot":"legs","itemLevel":85,"requirements":[{"skillHrid":"/skills/ranged","level":85}],"zh":"亡灵皮裤","en":"Revenant Chaps"},{"hrid":"/items/alchemists_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/alchemy","level":90}],"zh":"炼金师下装","en":"Alchemist's Bottoms"},{"hrid":"/items/brewers_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/brewing","level":90}],"zh":"饮品师下装","en":"Brewer's Bottoms"},{"hrid":"/items/cheesemakers_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/cheesesmithing","level":90}],"zh":"奶酪师下装","en":"Cheesemaker's Bottoms"},{"hrid":"/items/chefs_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/cooking","level":90}],"zh":"厨师下装","en":"Chef's Bottoms"},{"hrid":"/items/crafters_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/crafting","level":90}],"zh":"工匠下装","en":"Crafter's Bottoms"},{"hrid":"/items/dairyhands_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/milking","level":90}],"zh":"挤奶工下装","en":"Dairyhand's Bottoms"},{"hrid":"/items/enhancers_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/enhancing","level":90}],"zh":"强化师下装","en":"Enhancer's Bottoms"},{"hrid":"/items/foragers_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/foraging","level":90}],"zh":"采摘者下装","en":"Forager's Bottoms"},{"hrid":"/items/lumberjacks_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/woodcutting","level":90}],"zh":"伐木工下装","en":"Lumberjack's Bottoms"},{"hrid":"/items/tailors_bottoms","slot":"legs","itemLevel":90,"requirements":[{"skillHrid":"/skills/tailoring","level":90}],"zh":"裁缝下装","en":"Tailor's Bottoms"},{"hrid":"/items/anchorbound_plate_legs","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"锚定腿甲","en":"Anchorbound Plate Legs"},{"hrid":"/items/anchorbound_plate_legs_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"锚定腿甲 ★","en":"Anchorbound Plate Legs ★"},{"hrid":"/items/kraken_chaps","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"克拉肯皮裤","en":"Kraken Chaps"},{"hrid":"/items/kraken_chaps_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"克拉肯皮裤 ★","en":"Kraken Chaps ★"},{"hrid":"/items/maelstrom_plate_legs","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"怒涛腿甲","en":"Maelstrom Plate Legs"},{"hrid":"/items/maelstrom_plate_legs_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"怒涛腿甲 ★","en":"Maelstrom Plate Legs ★"},{"hrid":"/items/royal_fire_robe_bottoms","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家火系袍裙","en":"Royal Fire Robe Bottoms"},{"hrid":"/items/royal_fire_robe_bottoms_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家火系袍裙 ★","en":"Royal Fire Robe Bottoms ★"},{"hrid":"/items/royal_nature_robe_bottoms","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家自然系袍裙","en":"Royal Nature Robe Bottoms"},{"hrid":"/items/royal_nature_robe_bottoms_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家自然系袍裙 ★","en":"Royal Nature Robe Bottoms ★"},{"hrid":"/items/royal_water_robe_bottoms","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"皇家水系袍裙","en":"Royal Water Robe Bottoms"},{"hrid":"/items/royal_water_robe_bottoms_refined","slot":"legs","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"皇家水系袍裙 ★","en":"Royal Water Robe Bottoms ★"},{"hrid":"/items/cheese_boots","slot":"feet","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪靴","en":"Cheese Boots"},{"hrid":"/items/cotton_boots","slot":"feet","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"棉靴","en":"Cotton Boots"},{"hrid":"/items/rough_boots","slot":"feet","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"粗糙靴","en":"Rough Boots"},{"hrid":"/items/verdant_boots","slot":"feet","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿靴","en":"Verdant Boots"},{"hrid":"/items/linen_boots","slot":"feet","itemLevel":15,"requirements":[{"skillHrid":"/skills/magic","level":15}],"zh":"亚麻靴","en":"Linen Boots"},{"hrid":"/items/reptile_boots","slot":"feet","itemLevel":15,"requirements":[{"skillHrid":"/skills/ranged","level":15}],"zh":"爬行动物靴","en":"Reptile Boots"},{"hrid":"/items/azure_boots","slot":"feet","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝靴","en":"Azure Boots"},{"hrid":"/items/shoebill_shoes","slot":"feet","itemLevel":30,"requirements":[{"skillHrid":"/skills/defense","level":30}],"zh":"鲸头鹳鞋","en":"Shoebill Shoes"},{"hrid":"/items/bamboo_boots","slot":"feet","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"竹靴","en":"Bamboo Boots"},{"hrid":"/items/burble_boots","slot":"feet","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫靴","en":"Burble Boots"},{"hrid":"/items/gobo_boots","slot":"feet","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"哥布林靴","en":"Gobo Boots"},{"hrid":"/items/crimson_boots","slot":"feet","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红靴","en":"Crimson Boots"},{"hrid":"/items/beast_boots","slot":"feet","itemLevel":55,"requirements":[{"skillHrid":"/skills/ranged","level":55}],"zh":"野兽靴","en":"Beast Boots"},{"hrid":"/items/silk_boots","slot":"feet","itemLevel":55,"requirements":[{"skillHrid":"/skills/magic","level":55}],"zh":"丝靴","en":"Silk Boots"},{"hrid":"/items/collectors_boots","slot":"feet","itemLevel":60,"requirements":[{"skillHrid":"/skills/milking","level":60},{"skillHrid":"/skills/foraging","level":60},{"skillHrid":"/skills/woodcutting","level":60}],"zh":"收藏家靴","en":"Collector's Boots"},{"hrid":"/items/black_bear_shoes","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"黑熊鞋","en":"Black Bear Shoes"},{"hrid":"/items/centaur_boots","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/ranged","level":65}],"zh":"半人马靴","en":"Centaur Boots"},{"hrid":"/items/grizzly_bear_shoes","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"棕熊鞋","en":"Grizzly Bear Shoes"},{"hrid":"/items/polar_bear_shoes","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"北极熊鞋","en":"Polar Bear Shoes"},{"hrid":"/items/rainbow_boots","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹靴","en":"Rainbow Boots"},{"hrid":"/items/sorcerer_boots","slot":"feet","itemLevel":65,"requirements":[{"skillHrid":"/skills/magic","level":65}],"zh":"巫师靴","en":"Sorcerer Boots"},{"hrid":"/items/radiant_boots","slot":"feet","itemLevel":75,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"光辉靴","en":"Radiant Boots"},{"hrid":"/items/umbral_boots","slot":"feet","itemLevel":75,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"暗影靴","en":"Umbral Boots"},{"hrid":"/items/holy_boots","slot":"feet","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣靴","en":"Holy Boots"},{"hrid":"/items/pathbreaker_boots","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"开路者靴","en":"Pathbreaker Boots"},{"hrid":"/items/pathbreaker_boots_refined","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"开路者靴 ★","en":"Pathbreaker Boots ★"},{"hrid":"/items/pathfinder_boots","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"探路者靴","en":"Pathfinder Boots"},{"hrid":"/items/pathfinder_boots_refined","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"探路者靴 ★","en":"Pathfinder Boots ★"},{"hrid":"/items/pathseeker_boots","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"寻路者靴","en":"Pathseeker Boots"},{"hrid":"/items/pathseeker_boots_refined","slot":"feet","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"寻路者靴 ★","en":"Pathseeker Boots ★"},{"hrid":"/items/cheese_gauntlets","slot":"hands","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪护手","en":"Cheese Gauntlets"},{"hrid":"/items/cotton_gloves","slot":"hands","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"棉手套","en":"Cotton Gloves"},{"hrid":"/items/rough_bracers","slot":"hands","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"粗糙护腕","en":"Rough Bracers"},{"hrid":"/items/verdant_gauntlets","slot":"hands","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿护手","en":"Verdant Gauntlets"},{"hrid":"/items/linen_gloves","slot":"hands","itemLevel":15,"requirements":[{"skillHrid":"/skills/magic","level":15}],"zh":"亚麻手套","en":"Linen Gloves"},{"hrid":"/items/reptile_bracers","slot":"hands","itemLevel":15,"requirements":[{"skillHrid":"/skills/ranged","level":15}],"zh":"爬行动物护腕","en":"Reptile Bracers"},{"hrid":"/items/azure_gauntlets","slot":"hands","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝护手","en":"Azure Gauntlets"},{"hrid":"/items/pincer_gloves","slot":"hands","itemLevel":25,"requirements":[{"skillHrid":"/skills/defense","level":25}],"zh":"蟹钳手套","en":"Pincer Gloves"},{"hrid":"/items/bamboo_gloves","slot":"hands","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"竹手套","en":"Bamboo Gloves"},{"hrid":"/items/burble_gauntlets","slot":"hands","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫护手","en":"Burble Gauntlets"},{"hrid":"/items/gobo_bracers","slot":"hands","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"哥布林护腕","en":"Gobo Bracers"},{"hrid":"/items/crimson_gauntlets","slot":"hands","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红护手","en":"Crimson Gauntlets"},{"hrid":"/items/beast_bracers","slot":"hands","itemLevel":55,"requirements":[{"skillHrid":"/skills/ranged","level":55}],"zh":"野兽护腕","en":"Beast Bracers"},{"hrid":"/items/silk_gloves","slot":"hands","itemLevel":55,"requirements":[{"skillHrid":"/skills/magic","level":55}],"zh":"丝手套","en":"Silk Gloves"},{"hrid":"/items/enchanted_gloves","slot":"hands","itemLevel":60,"requirements":[{"skillHrid":"/skills/alchemy","level":60},{"skillHrid":"/skills/enhancing","level":60}],"zh":"附魔手套","en":"Enchanted Gloves"},{"hrid":"/items/sighted_bracers","slot":"hands","itemLevel":60,"requirements":[{"skillHrid":"/skills/ranged","level":60}],"zh":"瞄准护腕","en":"Sighted Bracers"},{"hrid":"/items/panda_gloves","slot":"hands","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"熊猫手套","en":"Panda Gloves"},{"hrid":"/items/rainbow_gauntlets","slot":"hands","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹护手","en":"Rainbow Gauntlets"},{"hrid":"/items/radiant_gloves","slot":"hands","itemLevel":75,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"光辉手套","en":"Radiant Gloves"},{"hrid":"/items/umbral_bracers","slot":"hands","itemLevel":75,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"暗影护腕","en":"Umbral Bracers"},{"hrid":"/items/chrono_gloves","slot":"hands","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":80}],"zh":"时空手套","en":"Chrono Gloves"},{"hrid":"/items/holy_gauntlets","slot":"hands","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣护手","en":"Holy Gauntlets"},{"hrid":"/items/magnetic_gloves","slot":"hands","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"磁力手套","en":"Magnetic Gloves"},{"hrid":"/items/dodocamel_gauntlets","slot":"hands","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"渡渡驼护手","en":"Dodocamel Gauntlets"},{"hrid":"/items/dodocamel_gauntlets_refined","slot":"hands","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"渡渡驼护手 ★","en":"Dodocamel Gauntlets ★"},{"hrid":"/items/marksman_bracers","slot":"hands","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"神射护腕","en":"Marksman Bracers"},{"hrid":"/items/marksman_bracers_refined","slot":"hands","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"神射护腕 ★","en":"Marksman Bracers ★"},{"hrid":"/items/cheese_bulwark","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪重盾","en":"Cheese Bulwark"},{"hrid":"/items/cheese_mace","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/melee","level":1}],"zh":"奶酪钉头锤","en":"Cheese Mace"},{"hrid":"/items/cheese_spear","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/attack","level":1}],"zh":"奶酪长枪","en":"Cheese Spear"},{"hrid":"/items/cheese_sword","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/melee","level":1}],"zh":"奶酪剑","en":"Cheese Sword"},{"hrid":"/items/wooden_bow","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"木弓","en":"Wooden Bow"},{"hrid":"/items/wooden_crossbow","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"木弩","en":"Wooden Crossbow"},{"hrid":"/items/wooden_fire_staff","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"木制火法杖","en":"Wooden Fire Staff"},{"hrid":"/items/wooden_nature_staff","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"木制自然法杖","en":"Wooden Nature Staff"},{"hrid":"/items/wooden_water_staff","slot":"weapon","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"木制水法杖","en":"Wooden Water Staff"},{"hrid":"/items/birch_bow","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/ranged","level":10}],"zh":"桦木弓","en":"Birch Bow"},{"hrid":"/items/birch_crossbow","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/ranged","level":10}],"zh":"桦木弩","en":"Birch Crossbow"},{"hrid":"/items/birch_fire_staff","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/magic","level":10}],"zh":"桦木火法杖","en":"Birch Fire Staff"},{"hrid":"/items/birch_nature_staff","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/magic","level":10}],"zh":"桦木自然法杖","en":"Birch Nature Staff"},{"hrid":"/items/birch_water_staff","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/magic","level":10}],"zh":"桦木水法杖","en":"Birch Water Staff"},{"hrid":"/items/verdant_bulwark","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿重盾","en":"Verdant Bulwark"},{"hrid":"/items/verdant_mace","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/melee","level":10}],"zh":"翠绿钉头锤","en":"Verdant Mace"},{"hrid":"/items/verdant_spear","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/attack","level":10}],"zh":"翠绿长枪","en":"Verdant Spear"},{"hrid":"/items/verdant_sword","slot":"weapon","itemLevel":10,"requirements":[{"skillHrid":"/skills/melee","level":10}],"zh":"翠绿剑","en":"Verdant Sword"},{"hrid":"/items/azure_bulwark","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝重盾","en":"Azure Bulwark"},{"hrid":"/items/azure_mace","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/melee","level":20}],"zh":"蔚蓝钉头锤","en":"Azure Mace"},{"hrid":"/items/azure_spear","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/attack","level":20}],"zh":"蔚蓝长枪","en":"Azure Spear"},{"hrid":"/items/azure_sword","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/melee","level":20}],"zh":"蔚蓝剑","en":"Azure Sword"},{"hrid":"/items/cedar_bow","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/ranged","level":20}],"zh":"雪松弓","en":"Cedar Bow"},{"hrid":"/items/cedar_crossbow","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/ranged","level":20}],"zh":"雪松弩","en":"Cedar Crossbow"},{"hrid":"/items/cedar_fire_staff","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/magic","level":20}],"zh":"雪松火法杖","en":"Cedar Fire Staff"},{"hrid":"/items/cedar_nature_staff","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/magic","level":20}],"zh":"雪松自然法杖","en":"Cedar Nature Staff"},{"hrid":"/items/cedar_water_staff","slot":"weapon","itemLevel":20,"requirements":[{"skillHrid":"/skills/magic","level":20}],"zh":"雪松水法杖","en":"Cedar Water Staff"},{"hrid":"/items/burble_bulwark","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫重盾","en":"Burble Bulwark"},{"hrid":"/items/burble_mace","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/melee","level":35}],"zh":"深紫钉头锤","en":"Burble Mace"},{"hrid":"/items/burble_spear","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/attack","level":35}],"zh":"深紫长枪","en":"Burble Spear"},{"hrid":"/items/burble_sword","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/melee","level":35}],"zh":"深紫剑","en":"Burble Sword"},{"hrid":"/items/purpleheart_bow","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"紫心弓","en":"Purpleheart Bow"},{"hrid":"/items/purpleheart_crossbow","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"紫心弩","en":"Purpleheart Crossbow"},{"hrid":"/items/purpleheart_fire_staff","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"紫心火法杖","en":"Purpleheart Fire Staff"},{"hrid":"/items/purpleheart_nature_staff","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"紫心自然法杖","en":"Purpleheart Nature Staff"},{"hrid":"/items/purpleheart_water_staff","slot":"weapon","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"紫心水法杖","en":"Purpleheart Water Staff"},{"hrid":"/items/gobo_boomstick","slot":"weapon","itemLevel":40,"requirements":[{"skillHrid":"/skills/magic","level":40}],"zh":"哥布林火棍","en":"Gobo Boomstick"},{"hrid":"/items/gobo_shooter","slot":"weapon","itemLevel":40,"requirements":[{"skillHrid":"/skills/ranged","level":40}],"zh":"哥布林弹弓","en":"Gobo Shooter"},{"hrid":"/items/gobo_slasher","slot":"weapon","itemLevel":40,"requirements":[{"skillHrid":"/skills/attack","level":40},{"skillHrid":"/skills/melee","level":40}],"zh":"哥布林关刀","en":"Gobo Slasher"},{"hrid":"/items/gobo_smasher","slot":"weapon","itemLevel":40,"requirements":[{"skillHrid":"/skills/melee","level":40}],"zh":"哥布林狼牙棒","en":"Gobo Smasher"},{"hrid":"/items/gobo_stabber","slot":"weapon","itemLevel":40,"requirements":[{"skillHrid":"/skills/attack","level":40}],"zh":"哥布林长剑","en":"Gobo Stabber"},{"hrid":"/items/crimson_bulwark","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红重盾","en":"Crimson Bulwark"},{"hrid":"/items/crimson_mace","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/melee","level":50}],"zh":"绛红钉头锤","en":"Crimson Mace"},{"hrid":"/items/crimson_spear","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/attack","level":50}],"zh":"绛红长枪","en":"Crimson Spear"},{"hrid":"/items/crimson_sword","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/melee","level":50}],"zh":"绛红剑","en":"Crimson Sword"},{"hrid":"/items/ginkgo_bow","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"银杏弓","en":"Ginkgo Bow"},{"hrid":"/items/ginkgo_crossbow","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"银杏弩","en":"Ginkgo Crossbow"},{"hrid":"/items/ginkgo_fire_staff","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"银杏火法杖","en":"Ginkgo Fire Staff"},{"hrid":"/items/ginkgo_nature_staff","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"银杏自然法杖","en":"Ginkgo Nature Staff"},{"hrid":"/items/ginkgo_water_staff","slot":"weapon","itemLevel":50,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"银杏水法杖","en":"Ginkgo Water Staff"},{"hrid":"/items/rainbow_bulwark","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹重盾","en":"Rainbow Bulwark"},{"hrid":"/items/rainbow_mace","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/melee","level":65}],"zh":"彩虹钉头锤","en":"Rainbow Mace"},{"hrid":"/items/rainbow_spear","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/attack","level":65}],"zh":"彩虹长枪","en":"Rainbow Spear"},{"hrid":"/items/rainbow_sword","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/melee","level":65}],"zh":"彩虹剑","en":"Rainbow Sword"},{"hrid":"/items/redwood_bow","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/ranged","level":65}],"zh":"红杉弓","en":"Redwood Bow"},{"hrid":"/items/redwood_crossbow","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/ranged","level":65}],"zh":"红杉弩","en":"Redwood Crossbow"},{"hrid":"/items/redwood_fire_staff","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/magic","level":65}],"zh":"红杉火法杖","en":"Redwood Fire Staff"},{"hrid":"/items/redwood_nature_staff","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/magic","level":65}],"zh":"红杉自然法杖","en":"Redwood Nature Staff"},{"hrid":"/items/redwood_water_staff","slot":"weapon","itemLevel":65,"requirements":[{"skillHrid":"/skills/magic","level":65}],"zh":"红杉水法杖","en":"Redwood Water Staff"},{"hrid":"/items/arcane_bow","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":80}],"zh":"神秘弓","en":"Arcane Bow"},{"hrid":"/items/arcane_crossbow","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":80}],"zh":"神秘弩","en":"Arcane Crossbow"},{"hrid":"/items/arcane_fire_staff","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":80}],"zh":"神秘火法杖","en":"Arcane Fire Staff"},{"hrid":"/items/arcane_nature_staff","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":80}],"zh":"神秘自然法杖","en":"Arcane Nature Staff"},{"hrid":"/items/arcane_water_staff","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":80}],"zh":"神秘水法杖","en":"Arcane Water Staff"},{"hrid":"/items/holy_bulwark","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣重盾","en":"Holy Bulwark"},{"hrid":"/items/holy_mace","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/melee","level":80}],"zh":"神圣钉头锤","en":"Holy Mace"},{"hrid":"/items/holy_spear","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/attack","level":80}],"zh":"神圣长枪","en":"Holy Spear"},{"hrid":"/items/holy_sword","slot":"weapon","itemLevel":80,"requirements":[{"skillHrid":"/skills/melee","level":80}],"zh":"神圣剑","en":"Holy Sword"},{"hrid":"/items/frost_staff","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/magic","level":85}],"zh":"冰霜法杖","en":"Frost Staff"},{"hrid":"/items/granite_bludgeon","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/melee","level":85}],"zh":"花岗岩大棒","en":"Granite Bludgeon"},{"hrid":"/items/infernal_battlestaff","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/magic","level":85}],"zh":"炼狱法杖","en":"Infernal Battlestaff"},{"hrid":"/items/jackalope_staff","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/magic","level":85}],"zh":"鹿角兔之杖","en":"Jackalope Staff"},{"hrid":"/items/soul_hunter_crossbow","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/ranged","level":85}],"zh":"灵魂猎手弩","en":"Soul Hunter Crossbow"},{"hrid":"/items/spiked_bulwark","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/defense","level":85}],"zh":"尖刺重盾","en":"Spiked Bulwark"},{"hrid":"/items/stalactite_spear","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/attack","level":85}],"zh":"石钟长枪","en":"Stalactite Spear"},{"hrid":"/items/vampiric_bow","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/ranged","level":85}],"zh":"吸血弓","en":"Vampiric Bow"},{"hrid":"/items/werewolf_slasher","slot":"weapon","itemLevel":85,"requirements":[{"skillHrid":"/skills/melee","level":85}],"zh":"狼人关刀","en":"Werewolf Slasher"},{"hrid":"/items/blazing_trident","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"炽焰三叉戟","en":"Blazing Trident"},{"hrid":"/items/blazing_trident_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"炽焰三叉戟 ★","en":"Blazing Trident ★"},{"hrid":"/items/blooming_trident","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"绽放三叉戟","en":"Blooming Trident"},{"hrid":"/items/blooming_trident_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"绽放三叉戟 ★","en":"Blooming Trident ★"},{"hrid":"/items/chaotic_flail","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/melee","level":95}],"zh":"混沌连枷","en":"Chaotic Flail"},{"hrid":"/items/chaotic_flail_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/melee","level":110}],"zh":"混沌连枷 ★","en":"Chaotic Flail ★"},{"hrid":"/items/cursed_bow","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"咒怨之弓","en":"Cursed Bow"},{"hrid":"/items/cursed_bow_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"咒怨之弓 ★","en":"Cursed Bow ★"},{"hrid":"/items/furious_spear","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/attack","level":95}],"zh":"狂怒长枪","en":"Furious Spear"},{"hrid":"/items/furious_spear_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/attack","level":110}],"zh":"狂怒长枪 ★","en":"Furious Spear ★"},{"hrid":"/items/griffin_bulwark","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"狮鹫重盾","en":"Griffin Bulwark"},{"hrid":"/items/griffin_bulwark_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"狮鹫重盾 ★","en":"Griffin Bulwark ★"},{"hrid":"/items/regal_sword","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/melee","level":95}],"zh":"君王之剑","en":"Regal Sword"},{"hrid":"/items/regal_sword_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/melee","level":110}],"zh":"君王之剑 ★","en":"Regal Sword ★"},{"hrid":"/items/rippling_trident","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"涟漪三叉戟","en":"Rippling Trident"},{"hrid":"/items/rippling_trident_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"涟漪三叉戟 ★","en":"Rippling Trident ★"},{"hrid":"/items/sundering_crossbow","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":95}],"zh":"裂空之弩","en":"Sundering Crossbow"},{"hrid":"/items/sundering_crossbow_refined","slot":"weapon","itemLevel":95,"requirements":[{"skillHrid":"/skills/ranged","level":110}],"zh":"裂空之弩 ★","en":"Sundering Crossbow ★"},{"hrid":"/items/cheese_buckler","slot":"off_hand","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"奶酪圆盾","en":"Cheese Buckler"},{"hrid":"/items/wooden_shield","slot":"off_hand","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"木盾","en":"Wooden Shield"},{"hrid":"/items/birch_shield","slot":"off_hand","itemLevel":10,"requirements":[{"skillHrid":"/skills/ranged","level":10}],"zh":"桦木盾","en":"Birch Shield"},{"hrid":"/items/verdant_buckler","slot":"off_hand","itemLevel":10,"requirements":[{"skillHrid":"/skills/defense","level":10}],"zh":"翠绿圆盾","en":"Verdant Buckler"},{"hrid":"/items/snake_fang_dirk","slot":"off_hand","itemLevel":15,"requirements":[{"skillHrid":"/skills/attack","level":15},{"skillHrid":"/skills/defense","level":15}],"zh":"蛇牙短剑","en":"Snake Fang Dirk"},{"hrid":"/items/azure_buckler","slot":"off_hand","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":20}],"zh":"蔚蓝圆盾","en":"Azure Buckler"},{"hrid":"/items/cedar_shield","slot":"off_hand","itemLevel":20,"requirements":[{"skillHrid":"/skills/ranged","level":20}],"zh":"雪松盾","en":"Cedar Shield"},{"hrid":"/items/burble_buckler","slot":"off_hand","itemLevel":35,"requirements":[{"skillHrid":"/skills/defense","level":35}],"zh":"深紫圆盾","en":"Burble Buckler"},{"hrid":"/items/purpleheart_shield","slot":"off_hand","itemLevel":35,"requirements":[{"skillHrid":"/skills/ranged","level":35}],"zh":"紫心盾","en":"Purpleheart Shield"},{"hrid":"/items/tome_of_healing","slot":"off_hand","itemLevel":35,"requirements":[{"skillHrid":"/skills/magic","level":35}],"zh":"治疗之书","en":"Tome Of Healing"},{"hrid":"/items/treant_shield","slot":"off_hand","itemLevel":40,"requirements":[{"skillHrid":"/skills/ranged","level":40}],"zh":"树人盾","en":"Treant Shield"},{"hrid":"/items/crimson_buckler","slot":"off_hand","itemLevel":50,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"绛红圆盾","en":"Crimson Buckler"},{"hrid":"/items/ginkgo_shield","slot":"off_hand","itemLevel":50,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"银杏盾","en":"Ginkgo Shield"},{"hrid":"/items/vision_shield","slot":"off_hand","itemLevel":55,"requirements":[{"skillHrid":"/skills/defense","level":55}],"zh":"视觉盾","en":"Vision Shield"},{"hrid":"/items/eye_watch","slot":"off_hand","itemLevel":60,"requirements":[{"skillHrid":"/skills/cheesesmithing","level":60},{"skillHrid":"/skills/crafting","level":60},{"skillHrid":"/skills/tailoring","level":60}],"zh":"掌上监工","en":"Eye Watch"},{"hrid":"/items/gobo_defender","slot":"off_hand","itemLevel":60,"requirements":[{"skillHrid":"/skills/attack","level":60},{"skillHrid":"/skills/melee","level":60},{"skillHrid":"/skills/defense","level":60}],"zh":"哥布林防御者","en":"Gobo Defender"},{"hrid":"/items/rainbow_buckler","slot":"off_hand","itemLevel":65,"requirements":[{"skillHrid":"/skills/defense","level":65}],"zh":"彩虹圆盾","en":"Rainbow Buckler"},{"hrid":"/items/redwood_shield","slot":"off_hand","itemLevel":65,"requirements":[{"skillHrid":"/skills/ranged","level":65}],"zh":"红杉盾","en":"Redwood Shield"},{"hrid":"/items/tome_of_the_elements","slot":"off_hand","itemLevel":70,"requirements":[{"skillHrid":"/skills/magic","level":70}],"zh":"元素之书","en":"Tome Of The Elements"},{"hrid":"/items/watchful_relic","slot":"off_hand","itemLevel":70,"requirements":[{"skillHrid":"/skills/magic","level":70}],"zh":"警戒遗物","en":"Watchful Relic"},{"hrid":"/items/arcane_shield","slot":"off_hand","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":80}],"zh":"神秘盾","en":"Arcane Shield"},{"hrid":"/items/holy_buckler","slot":"off_hand","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":80}],"zh":"神圣圆盾","en":"Holy Buckler"},{"hrid":"/items/manticore_shield","slot":"off_hand","itemLevel":85,"requirements":[{"skillHrid":"/skills/ranged","level":85}],"zh":"蝎狮盾","en":"Manticore Shield"},{"hrid":"/items/vampire_fang_dirk","slot":"off_hand","itemLevel":85,"requirements":[{"skillHrid":"/skills/attack","level":85},{"skillHrid":"/skills/defense","level":85}],"zh":"吸血鬼短剑","en":"Vampire Fang Dirk"},{"hrid":"/items/bishops_codex","slot":"off_hand","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":95}],"zh":"主教法典","en":"Bishop's Codex"},{"hrid":"/items/bishops_codex_refined","slot":"off_hand","itemLevel":95,"requirements":[{"skillHrid":"/skills/magic","level":110}],"zh":"主教法典 ★","en":"Bishop's Codex ★"},{"hrid":"/items/knights_aegis","slot":"off_hand","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":95}],"zh":"骑士盾","en":"Knight's Aegis"},{"hrid":"/items/knights_aegis_refined","slot":"off_hand","itemLevel":95,"requirements":[{"skillHrid":"/skills/defense","level":110}],"zh":"骑士盾 ★","en":"Knight's Aegis ★"},{"hrid":"/items/small_pouch","slot":"pouch","itemLevel":1,"requirements":[{"skillHrid":"/skills/total_level","level":1}],"zh":"小袋子","en":"Small Pouch"},{"hrid":"/items/medium_pouch","slot":"pouch","itemLevel":20,"requirements":[{"skillHrid":"/skills/total_level","level":250}],"zh":"中袋子","en":"Medium Pouch"},{"hrid":"/items/large_pouch","slot":"pouch","itemLevel":40,"requirements":[{"skillHrid":"/skills/total_level","level":500}],"zh":"大袋子","en":"Large Pouch"},{"hrid":"/items/giant_pouch","slot":"pouch","itemLevel":60,"requirements":[{"skillHrid":"/skills/total_level","level":750}],"zh":"巨大袋子","en":"Giant Pouch"},{"hrid":"/items/gluttonous_pouch","slot":"pouch","itemLevel":90,"requirements":[{"skillHrid":"/skills/total_level","level":1250}],"zh":"贪食之袋","en":"Gluttonous Pouch"},{"hrid":"/items/guzzling_pouch","slot":"pouch","itemLevel":90,"requirements":[{"skillHrid":"/skills/total_level","level":1250}],"zh":"暴饮之囊","en":"Guzzling Pouch"},{"hrid":"/items/necklace_of_efficiency","slot":"neck","itemLevel":30,"requirements":[],"zh":"效率项链","en":"Necklace Of Efficiency"},{"hrid":"/items/fighter_necklace","slot":"neck","itemLevel":45,"requirements":[],"zh":"战士项链","en":"Fighter Necklace"},{"hrid":"/items/ranger_necklace","slot":"neck","itemLevel":45,"requirements":[],"zh":"射手项链","en":"Ranger Necklace"},{"hrid":"/items/wizard_necklace","slot":"neck","itemLevel":45,"requirements":[],"zh":"巫师项链","en":"Wizard Necklace"},{"hrid":"/items/necklace_of_wisdom","slot":"neck","itemLevel":60,"requirements":[],"zh":"经验项链","en":"Necklace Of Wisdom"},{"hrid":"/items/necklace_of_speed","slot":"neck","itemLevel":75,"requirements":[],"zh":"速度项链","en":"Necklace Of Speed"},{"hrid":"/items/philosophers_necklace","slot":"neck","itemLevel":90,"requirements":[],"zh":"贤者项链","en":"Philosopher's Necklace"},{"hrid":"/items/earrings_of_gathering","slot":"earrings","itemLevel":15,"requirements":[],"zh":"采集耳环","en":"Earrings Of Gathering"},{"hrid":"/items/earrings_of_essence_find","slot":"earrings","itemLevel":30,"requirements":[],"zh":"精华发现耳环","en":"Earrings Of Essence Find"},{"hrid":"/items/earrings_of_armor","slot":"earrings","itemLevel":45,"requirements":[],"zh":"护甲耳环","en":"Earrings Of Armor"},{"hrid":"/items/earrings_of_regeneration","slot":"earrings","itemLevel":45,"requirements":[],"zh":"恢复耳环","en":"Earrings Of Regeneration"},{"hrid":"/items/earrings_of_resistance","slot":"earrings","itemLevel":45,"requirements":[],"zh":"抗性耳环","en":"Earrings Of Resistance"},{"hrid":"/items/earrings_of_rare_find","slot":"earrings","itemLevel":60,"requirements":[],"zh":"稀有发现耳环","en":"Earrings Of Rare Find"},{"hrid":"/items/earrings_of_critical_strike","slot":"earrings","itemLevel":75,"requirements":[],"zh":"暴击耳环","en":"Earrings Of Critical Strike"},{"hrid":"/items/philosophers_earrings","slot":"earrings","itemLevel":90,"requirements":[],"zh":"贤者耳环","en":"Philosopher's Earrings"},{"hrid":"/items/ring_of_gathering","slot":"ring","itemLevel":15,"requirements":[],"zh":"采集戒指","en":"Ring Of Gathering"},{"hrid":"/items/ring_of_essence_find","slot":"ring","itemLevel":30,"requirements":[],"zh":"精华发现戒指","en":"Ring Of Essence Find"},{"hrid":"/items/ring_of_armor","slot":"ring","itemLevel":45,"requirements":[],"zh":"护甲戒指","en":"Ring Of Armor"},{"hrid":"/items/ring_of_regeneration","slot":"ring","itemLevel":45,"requirements":[],"zh":"恢复戒指","en":"Ring Of Regeneration"},{"hrid":"/items/ring_of_resistance","slot":"ring","itemLevel":45,"requirements":[],"zh":"抗性戒指","en":"Ring Of Resistance"},{"hrid":"/items/ring_of_rare_find","slot":"ring","itemLevel":60,"requirements":[],"zh":"稀有发现戒指","en":"Ring Of Rare Find"},{"hrid":"/items/ring_of_critical_strike","slot":"ring","itemLevel":75,"requirements":[],"zh":"暴击戒指","en":"Ring Of Critical Strike"},{"hrid":"/items/philosophers_ring","slot":"ring","itemLevel":90,"requirements":[],"zh":"贤者戒指","en":"Philosopher's Ring"},{"hrid":"/items/artificer_cape","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/cheesesmithing","level":80},{"skillHrid":"/skills/crafting","level":80},{"skillHrid":"/skills/tailoring","level":80}],"zh":"工匠披风","en":"Artificer Cape"},{"hrid":"/items/artificer_cape_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/cheesesmithing","level":100},{"skillHrid":"/skills/crafting","level":100},{"skillHrid":"/skills/tailoring","level":100}],"zh":"工匠披风 ★","en":"Artificer Cape ★"},{"hrid":"/items/chance_cape","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/alchemy","level":80},{"skillHrid":"/skills/enhancing","level":80}],"zh":"机缘披风","en":"Chance Cape"},{"hrid":"/items/chance_cape_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/alchemy","level":100},{"skillHrid":"/skills/enhancing","level":100}],"zh":"机缘披风 ★","en":"Chance Cape ★"},{"hrid":"/items/chimerical_quiver","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":80}],"zh":"奇幻箭袋","en":"Chimerical Quiver"},{"hrid":"/items/chimerical_quiver_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":100}],"zh":"奇幻箭袋 ★","en":"Chimerical Quiver ★"},{"hrid":"/items/culinary_cape","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/cooking","level":80},{"skillHrid":"/skills/brewing","level":80}],"zh":"厨师披风","en":"Culinary Cape"},{"hrid":"/items/culinary_cape_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/cooking","level":100},{"skillHrid":"/skills/brewing","level":100}],"zh":"厨师披风 ★","en":"Culinary Cape ★"},{"hrid":"/items/enchanted_cloak","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":80}],"zh":"秘法披风","en":"Enchanted Cloak"},{"hrid":"/items/enchanted_cloak_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":100}],"zh":"秘法披风 ★","en":"Enchanted Cloak ★"},{"hrid":"/items/gatherer_cape","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/milking","level":80},{"skillHrid":"/skills/foraging","level":80},{"skillHrid":"/skills/woodcutting","level":80}],"zh":"采集者披风","en":"Gatherer Cape"},{"hrid":"/items/gatherer_cape_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/milking","level":100},{"skillHrid":"/skills/foraging","level":100},{"skillHrid":"/skills/woodcutting","level":100}],"zh":"采集者披风 ★","en":"Gatherer Cape ★"},{"hrid":"/items/sinister_cape","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/melee","level":80}],"zh":"阴森披风","en":"Sinister Cape"},{"hrid":"/items/sinister_cape_refined","slot":"back","itemLevel":80,"requirements":[{"skillHrid":"/skills/melee","level":100}],"zh":"阴森披风 ★","en":"Sinister Cape ★"},{"hrid":"/items/trainee_attack_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/attack","level":1}],"zh":"实习攻击护符","en":"Trainee Attack Charm"},{"hrid":"/items/trainee_defense_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/defense","level":1}],"zh":"实习防御护符","en":"Trainee Defense Charm"},{"hrid":"/items/trainee_intelligence_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/intelligence","level":1}],"zh":"实习智力护符","en":"Trainee Intelligence Charm"},{"hrid":"/items/trainee_magic_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/magic","level":1}],"zh":"实习魔法护符","en":"Trainee Magic Charm"},{"hrid":"/items/trainee_melee_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/melee","level":1}],"zh":"实习近战护符","en":"Trainee Melee Charm"},{"hrid":"/items/trainee_ranged_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/ranged","level":1}],"zh":"实习远程护符","en":"Trainee Ranged Charm"},{"hrid":"/items/trainee_stamina_charm","slot":"charm","itemLevel":1,"requirements":[{"skillHrid":"/skills/stamina","level":1}],"zh":"实习耐力护符","en":"Trainee Stamina Charm"},{"hrid":"/items/basic_attack_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/attack","level":25}],"zh":"基础攻击护符","en":"Basic Attack Charm"},{"hrid":"/items/basic_defense_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/defense","level":25}],"zh":"基础防御护符","en":"Basic Defense Charm"},{"hrid":"/items/basic_intelligence_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/intelligence","level":25}],"zh":"基础智力护符","en":"Basic Intelligence Charm"},{"hrid":"/items/basic_magic_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/magic","level":25}],"zh":"基础魔法护符","en":"Basic Magic Charm"},{"hrid":"/items/basic_melee_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/melee","level":25}],"zh":"基础近战护符","en":"Basic Melee Charm"},{"hrid":"/items/basic_ranged_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/ranged","level":25}],"zh":"基础远程护符","en":"Basic Ranged Charm"},{"hrid":"/items/basic_stamina_charm","slot":"charm","itemLevel":20,"requirements":[{"skillHrid":"/skills/stamina","level":25}],"zh":"基础耐力护符","en":"Basic Stamina Charm"},{"hrid":"/items/advanced_attack_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/attack","level":50}],"zh":"高级攻击护符","en":"Advanced Attack Charm"},{"hrid":"/items/advanced_defense_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/defense","level":50}],"zh":"高级防御护符","en":"Advanced Defense Charm"},{"hrid":"/items/advanced_intelligence_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/intelligence","level":50}],"zh":"高级智力护符","en":"Advanced Intelligence Charm"},{"hrid":"/items/advanced_magic_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/magic","level":50}],"zh":"高级魔法护符","en":"Advanced Magic Charm"},{"hrid":"/items/advanced_melee_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/melee","level":50}],"zh":"高级近战护符","en":"Advanced Melee Charm"},{"hrid":"/items/advanced_ranged_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/ranged","level":50}],"zh":"高级远程护符","en":"Advanced Ranged Charm"},{"hrid":"/items/advanced_stamina_charm","slot":"charm","itemLevel":40,"requirements":[{"skillHrid":"/skills/stamina","level":50}],"zh":"高级耐力护符","en":"Advanced Stamina Charm"},{"hrid":"/items/expert_attack_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/attack","level":75}],"zh":"专家攻击护符","en":"Expert Attack Charm"},{"hrid":"/items/expert_defense_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/defense","level":75}],"zh":"专家防御护符","en":"Expert Defense Charm"},{"hrid":"/items/expert_intelligence_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/intelligence","level":75}],"zh":"专家智力护符","en":"Expert Intelligence Charm"},{"hrid":"/items/expert_magic_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/magic","level":75}],"zh":"专家魔法护符","en":"Expert Magic Charm"},{"hrid":"/items/expert_melee_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/melee","level":75}],"zh":"专家近战护符","en":"Expert Melee Charm"},{"hrid":"/items/expert_ranged_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/ranged","level":75}],"zh":"专家远程护符","en":"Expert Ranged Charm"},{"hrid":"/items/expert_stamina_charm","slot":"charm","itemLevel":60,"requirements":[{"skillHrid":"/skills/stamina","level":75}],"zh":"专家耐力护符","en":"Expert Stamina Charm"},{"hrid":"/items/master_attack_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/attack","level":100}],"zh":"大师攻击护符","en":"Master Attack Charm"},{"hrid":"/items/master_defense_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/defense","level":100}],"zh":"大师防御护符","en":"Master Defense Charm"},{"hrid":"/items/master_intelligence_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/intelligence","level":100}],"zh":"大师智力护符","en":"Master Intelligence Charm"},{"hrid":"/items/master_magic_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/magic","level":100}],"zh":"大师魔法护符","en":"Master Magic Charm"},{"hrid":"/items/master_melee_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/melee","level":100}],"zh":"大师近战护符","en":"Master Melee Charm"},{"hrid":"/items/master_ranged_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/ranged","level":100}],"zh":"大师远程护符","en":"Master Ranged Charm"},{"hrid":"/items/master_stamina_charm","slot":"charm","itemLevel":80,"requirements":[{"skillHrid":"/skills/stamina","level":100}],"zh":"大师耐力护符","en":"Master Stamina Charm"},{"hrid":"/items/grandmaster_attack_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/attack","level":125}],"zh":"宗师攻击护符","en":"Grandmaster Attack Charm"},{"hrid":"/items/grandmaster_defense_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/defense","level":125}],"zh":"宗师防御护符","en":"Grandmaster Defense Charm"},{"hrid":"/items/grandmaster_intelligence_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/intelligence","level":125}],"zh":"宗师智力护符","en":"Grandmaster Intelligence Charm"},{"hrid":"/items/grandmaster_magic_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/magic","level":125}],"zh":"宗师魔法护符","en":"Grandmaster Magic Charm"},{"hrid":"/items/grandmaster_melee_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/melee","level":125}],"zh":"宗师近战护符","en":"Grandmaster Melee Charm"},{"hrid":"/items/grandmaster_ranged_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/ranged","level":125}],"zh":"宗师远程护符","en":"Grandmaster Ranged Charm"},{"hrid":"/items/grandmaster_stamina_charm","slot":"charm","itemLevel":100,"requirements":[{"skillHrid":"/skills/stamina","level":125}],"zh":"宗师耐力护符","en":"Grandmaster Stamina Charm"}]};});

// ---- equipment_filter.js ----
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWIEquipmentFilter = factory();
})(globalThis, function () {
  "use strict";
  const categories = Object.freeze({ all: "全部", attack: "攻击", melee: "近战", defense: "防御", ranged: "远程", magic: "魔法", other: "其他" });
  const skills = ["attack", "melee", "defense", "ranged", "magic"];
  const exemptSlots = Object.freeze(["pouch", "neck", "ring", "earrings"]);
  const isExempt = slot => exemptSlots.includes(slot);
  const normalize = text => String(text || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  function groups(item) {
    const names = new Set(item.requirements.map(r => r.skillHrid.replace("/skills/", "")));
    const found = skills.filter(skill => names.has(skill));
    return found.length ? found : ["other"];
  }
  function level(item, category = "all") {
    const requirements = item.requirements.filter(r => r.skillHrid !== "/skills/total_level" &&
      (skills.includes(category) ? r.skillHrid === `/skills/${category}` : true));
    // Wear requirements differ from economic itemLevel, especially for refined equipment.
    return requirements.length ? Math.max(...requirements.map(r => r.level)) : item.itemLevel;
  }
  function validRange({ min = "", max = "" }) {
    return (min === "" || Number.isFinite(Number(min)) && Number(min) >= 0) &&
      (max === "" || Number.isFinite(Number(max)) && Number(max) >= 0) &&
      (min === "" || max === "" || Number(min) < Number(max));
  }
  function active({ category = "all", min = "", max = "", search = "" }) {
    return category !== "all" || min !== "" || max !== "" || normalize(search) !== "";
  }
  function options(catalogue, slot, filters) {
    if (isExempt(slot)) return catalogue.items.filter(item => item.slot === slot);
    if (!validRange(filters)) return [];
    const { category = "all", min = "", max = "", search = "" } = filters;
    const needle = normalize(search);
    return catalogue.items.filter(item => item.slot === slot &&
      (category === "all" || groups(item).includes(category)) &&
      (min === "" || level(item, category) >= Number(min)) &&
      (max === "" || level(item, category) < Number(max)) &&
      (!needle || normalize(`${item.zh} ${item.en} ${item.hrid}`).includes(needle)));
  }
  function localeForLabel(catalogue, slot, nativeLabel) {
    return normalize(nativeLabel) === normalize(catalogue.slots[slot]?.en) ? "en" : "zh";
  }
  return Object.freeze({ categories, exemptSlots, isExempt, normalize, groups, level, validRange, active, options, localeForLabel });
});

// ---- equipment_filter_ui.js ----
(function installEquipmentFilter(win) {
  "use strict";
  if (!(location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/")) ||
    win.__MWIEquipmentFilterInstalled) return;
  win.__MWIEquipmentFilterInstalled = true;
  const doc = document, catalog = win.MWIEquipmentCatalog, F = win.MWIEquipmentFilter;
  const state = { category: "all", min: "", max: "", search: "" };
  const entries = new Map();
  let toolbar, fields, toggle, summary, message, expanded = false, busy = false, scheduled = false;
  function el(tag, text) { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
  function status(text, error = false) {
    if (message.textContent !== text) message.textContent = text;
    message.dataset.error = String(error);
  }
  function slotOf(input) {
    const label = F.normalize(input.getAttribute("aria-label"));
    return Object.keys(catalog.slots).find(slot => Object.values(catalog.slots[slot]).some(name => F.normalize(name) === label));
  }
  function sameName(text, name) {
    return F.normalize(text).replace(/^(?:lv\.?|等级)\s*\d+\s*/i, "") === F.normalize(name);
  }
  function active() { return F.active(state); }
  function layout(entry) {
    const native = entry.anchor.getBoundingClientRect(), row = entry.row.getBoundingClientRect();
    for (const [key, value] of Object.entries({ left: native.left - row.left, top: native.top - row.top,
      width: native.width, height: native.height })) {
      const text = `${value}px`; if (entry.select.style[key] !== text) entry.select.style[key] = text;
    }
  }
  function apply(entry) {
    const enabled = active() && !F.isExempt(entry.slot);
    if (!enabled) {
      entry.select.hidden = true; entry.current.hidden = true;
      if (entry.applied) {
        entry.anchor.style.opacity = entry.oldOpacity; entry.anchor.style.pointerEvents = entry.oldPointer;
        if (entry.oldAria === null) entry.anchor.removeAttribute("aria-hidden"); else entry.anchor.setAttribute("aria-hidden", entry.oldAria);
        if (entry.oldTab === null) entry.input.removeAttribute("tabindex"); else entry.input.setAttribute("tabindex", entry.oldTab);
      }
      entry.applied = false; entry.signature = ""; return;
    }
    if (!entry.applied) {
      entry.anchor.style.opacity = "0"; entry.anchor.style.pointerEvents = "none";
      entry.anchor.setAttribute("aria-hidden", "true"); entry.input.tabIndex = -1; entry.applied = true;
    }
    entry.select.hidden = false; entry.current.hidden = false; entry.select.disabled = busy;
    layout(entry);
    const locale = F.localeForLabel(catalog, entry.slot, entry.input.getAttribute("aria-label"));
    const key = JSON.stringify([state, entry.input.value, locale]);
    if (entry.signature === key) return;
    entry.signature = key;
    const candidates = F.options(catalog, entry.slot, state);
    entry.select.replaceChildren();
    const placeholder = el("option", candidates.length ? `选择装备 · ${candidates.length} 项` : "无符合条件的装备");
    placeholder.value = "__keep__"; placeholder.disabled = true; entry.select.append(placeholder);
    const none = el("option", locale === "en" ? "None" : "无"); none.value = ""; entry.select.append(none);
    let current = "__keep__";
    for (const item of candidates) {
      const option = el("option", `Lv${F.level(item, state.category)} ${item[locale]}`); option.value = item.hrid;
      if (sameName(entry.input.value, item[locale])) current = item.hrid;
      entry.select.append(option);
    }
    if (/^(?:无|None)$/i.test(entry.input.value.trim())) current = "";
    entry.select.value = current;
    const equipped = catalog.items.find(item => item.slot === entry.slot && sameName(entry.input.value, item[locale]));
    entry.current.textContent = `当前：${equipped ? `Lv${F.level(equipped)} ${equipped[locale]}` : entry.input.value || "无"}`;
  }
  function update(resetStatus = true) {
    const parts = [];
    if (state.category !== "all") parts.push(F.categories[state.category]);
    if (state.min !== "") parts.push(`≥ ${state.min}`);
    if (state.max !== "") parts.push(`< ${state.max}`);
    if (state.search.trim()) parts.push(`搜索“${state.search.trim()}”`);
    const text = parts.length ? parts.join(" · ") : "显示全部装备";
    if (summary.textContent !== text) summary.textContent = text;
    if (resetStatus) {
      if (!F.validRange(state)) status("等级范围为空：下限必须小于上限。", true);
      else if (!busy) status(active() ? "袋子、项链、戒指、耳环保留原列表；其他装备按条件筛选，已选装备保留。" : "按职业与穿戴等级筛选；袋子、项链、戒指、耳环不参与筛选。");
    }
    for (const entry of entries.values()) if (entry.row.isConnected) apply(entry);
  }
  async function wait(check, text) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const result = check(); if (result) return result;
      await new Promise(resolve => win.setTimeout(resolve, 30));
    }
    throw new Error(text);
  }
  async function choose(entry, hrid) {
    if (busy || hrid === "__keep__") return;
    const item = hrid ? F.options(catalog, entry.slot, state).find(candidate => candidate.hrid === hrid) : null;
    if (hrid && !item) throw new Error("候选已变化，请重新选择装备。");
    if ([...doc.querySelectorAll('[role="dialog"]')].some(node => node.getClientRects().length && !node.hidden))
      throw new Error("请先关闭网页弹窗，再选择装备。");
    if (!entry.row.isConnected || !/^#\/home(?:[/?]|$)/.test(location.hash)) throw new Error("装备面板已变化，请回到主页重试。");
    busy = true; update(); status("正在通过网页原生选择器换装…");
    let popup, oldPopupStyle, clicked = false;
    const originalDisplay = entry.input.value;
    try {
      const locale = F.localeForLabel(catalog, entry.slot, entry.input.getAttribute("aria-label"));
      const text = item ? item[locale] : "";
      if (entry.input.getAttribute("aria-expanded") !== "true") entry.trigger.click();
      popup = await wait(() => {
        const id = entry.input.getAttribute("aria-controls") || entry.trigger.getAttribute("aria-controls");
        return entry.input.getAttribute("aria-expanded") === "true" && doc.getElementById(id);
      }, "网页装备选择器未打开。请重置筛选，使用原列表重试。");
      // The native picker is used for the final choice only. Its unfiltered
      // first-60 preview must not flash over the complete filtered candidate list.
      oldPopupStyle = popup.style.opacity; popup.style.opacity = "0";
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(entry.input, text);
      entry.input.dispatchEvent(new win.Event("input", { bubbles: true }));
      const option = await wait(() => {
        const found = [...popup.querySelectorAll('[role="option"]')].filter(node => item
          ? sameName(node.textContent, text) : /^(?:无|None)$/i.test(node.textContent.trim()));
        return found.length === 1 ? found[0] : null;
      }, "网页目录中未能唯一找到这件装备。请重置筛选，使用网页原列表；当前配装未被主动替换。");
      option.click();
      clicked = true;
      await wait(() => entry.input.getAttribute("aria-expanded") !== "true", "网页尚未确认选择，请核对当前装备后重试。");
      await wait(() => item ? sameName(entry.input.value, text) : /^(?:无|None)$/i.test(entry.input.value.trim()),
        "网页尚未确认装备显示，请核对当前配装。");
      status(`已选择${entry.input.getAttribute("aria-label")}：${item ? item[locale] : "无"}。`);
    } catch (error) {
      entry.input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      if (!clicked) Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(entry.input, originalDisplay);
      status(error.message, true);
    } finally {
      if (popup?.isConnected) popup.style.opacity = oldPopupStyle;
      busy = false;
      for (const entry of entries.values()) { entry.signature = ""; apply(entry); }
      if (entry.select.isConnected && !entry.select.hidden) entry.select.focus();
    }
  }
  function makeToolbar(panel, heading) {
    toolbar = el("div"); toolbar.dataset.mwiEquipmentFilters = "";
    const head = el("div"); head.className = "mwi-ef-heading";
    toggle = el("button", "装备筛选"); toggle.type = "button"; toggle.setAttribute("aria-expanded", String(expanded));
    fields = el("div"); fields.className = "mwi-ef-fields"; fields.id = "mwi-equipment-filter-fields"; fields.hidden = !expanded;
    toggle.setAttribute("aria-controls", fields.id); toggle.onclick = () => { expanded = !expanded; fields.hidden = !expanded; toggle.setAttribute("aria-expanded", String(expanded)); };
    summary = el("span"); summary.className = "mwi-ef-summary"; head.append(toggle, summary);
    function selectField(label, key, values) {
      const wrap = el("label", label), select = el("select"); select.setAttribute("aria-label", label);
      for (const [value, title] of values) { const option = el("option", title); option.value = value; select.append(option); }
      select.value = state[key]; select.onchange = () => { state[key] = select.value; update(); }; wrap.append(select); fields.append(wrap);
    }
    selectField("职业", "category", Object.entries(F.categories));
    const levels = [...new Set(catalog.items.map(item => F.level(item)))].sort((a, b) => a - b);
    const bounds = [["", "全部"], ...levels.map(level => [String(level), String(level)])];
    selectField("等级：大于等于", "min", bounds); selectField("小于", "max", bounds);
    const wrap = el("label", "搜索装备"), search = el("input"); search.type = "search"; search.value = state.search;
    search.setAttribute("aria-label", "搜索装备"); search.placeholder = "名称或 HRID";
    search.oninput = () => { state.search = search.value; update(); }; wrap.append(search); fields.append(wrap);
    const reset = el("button", "重置筛选"); reset.type = "button";
    reset.onclick = () => { Object.assign(state, { category: "all", min: "", max: "", search: "" });
      for (const node of fields.querySelectorAll("select")) node.value = node.getAttribute("aria-label") === "职业" ? "all" : "";
      search.value = ""; update(); };
    fields.append(reset); message = el("p"); message.className = "mwi-ef-status"; message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
    toolbar.append(head, fields, message); heading.after(toolbar);
    status("按职业与穿戴等级筛选；袋子、项链、戒指、耳环不参与筛选。");
  }
  function attach() {
    scheduled = false;
    for (const [row, entry] of entries) if (!row.isConnected) { entry.resize.disconnect(); entries.delete(row); }
    if (!/^#\/home(?:[/?]|$)/.test(location.hash)) return;
    const rows = [...doc.querySelectorAll("[data-equipment-input-row]")];
    if (!rows.length) return;
    const panels = [...new Set(rows.map(row => row.closest(".surface-panel")))].filter(Boolean);
    if (panels.length !== 1) return;
    const panel = panels[0], heading = panel.querySelector("h2"); if (!heading) return;
    if (!toolbar?.isConnected) makeToolbar(panel, heading);
    for (const row of rows) {
      const input = row.querySelector('input[role="combobox"]'); if (!input) continue;
      const slot = slotOf(input); if (!slot || F.isExempt(slot)) continue;
      let entry = entries.get(row);
      if (!entry) {
        const anchor = input.parentElement, trigger = anchor.querySelector("button"); if (!trigger) continue;
        const select = el("select"); select.dataset.mwiEquipmentSelect = slot;
        select.setAttribute("aria-label", `${input.getAttribute("aria-label")}（筛选装备）`); select.hidden = true;
        const current = el("p"); current.dataset.mwiEquipmentCurrent = slot; current.hidden = true;
        if (win.getComputedStyle(row).position === "static") row.style.position = "relative";
        row.append(select); row.after(current);
        entry = { row, slot, input, anchor, trigger, select, current, applied: false, signature: "",
          oldOpacity: anchor.style.opacity, oldPointer: anchor.style.pointerEvents,
          oldAria: anchor.getAttribute("aria-hidden"), oldTab: input.getAttribute("tabindex") };
        select.onchange = () => choose(entry, select.value).catch(error => status(error.message, true));
        entry.resize = new win.ResizeObserver(() => { if (entry.applied) layout(entry); }); entry.resize.observe(anchor);
        entries.set(row, entry);
      }
      const label = `${input.getAttribute("aria-label")}（筛选装备）`;
      if (entry.select.getAttribute("aria-label") !== label) entry.select.setAttribute("aria-label", label);
      apply(entry);
    }
    update(false);
  }
  function schedule() { if (!scheduled) { scheduled = true; win.requestAnimationFrame(attach); } }
  function start() {
    const style = el("style", "[data-mwi-equipment-filters]{font:inherit;margin:0 0 14px;color:inherit}\n[data-mwi-equipment-filters] .mwi-ef-heading{display:flex;align-items:center;flex-wrap:wrap;gap:10px}\n[data-mwi-equipment-filters] button,[data-mwi-equipment-filters] select,[data-mwi-equipment-filters] input{font:inherit;font-size:13px}\n[data-mwi-equipment-filters] button{padding:5px 10px;border:1px solid var(--border,#64748b);border-radius:6px;background:var(--muted,transparent);color:inherit;cursor:pointer}\n[data-mwi-equipment-filters] button:hover{background:var(--accent,#334155)}\n[data-mwi-equipment-filters] .mwi-ef-fields{display:flex;align-items:end;flex-wrap:wrap;gap:10px;margin-top:10px}\n[data-mwi-equipment-filters] [hidden]{display:none!important}\n[data-mwi-equipment-filters] label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted-foreground,inherit)}\n[data-mwi-equipment-filters] select,[data-mwi-equipment-filters] input,[data-mwi-equipment-select]{padding:6px 9px;min-height:36px;border:1px solid var(--input,#64748b);border-radius:6px;background:var(--background,#111827);color:var(--foreground,inherit)}\n[data-mwi-equipment-filters] input{width:180px;max-width:100%}\n[data-mwi-equipment-filters] select{min-width:90px}\n[data-mwi-equipment-filters] .mwi-ef-summary,[data-mwi-equipment-filters] .mwi-ef-status{font-size:12px;color:var(--muted-foreground,inherit)}\n[data-mwi-equipment-filters] .mwi-ef-status{margin-top:7px;white-space:pre-wrap;overflow-wrap:anywhere}\n[data-mwi-equipment-filters] .mwi-ef-status[data-error=\"true\"]{color:var(--destructive,#dc2626)}\n[data-mwi-equipment-select]{position:absolute;margin:0;min-width:0;font:inherit;font-size:14px;text-overflow:ellipsis;cursor:pointer}\n[data-mwi-equipment-current]{font-size:11px;line-height:1.5;color:var(--muted-foreground,inherit);overflow-wrap:anywhere;margin-top:5px}\n[data-mwi-equipment-filters] :is(button,input,select):focus-visible,[data-mwi-equipment-select]:focus-visible{outline:2px solid var(--ring,#60a5fa);outline-offset:2px}\n[data-mwi-equipment-select]:disabled{cursor:wait;opacity:.6}\n@media(max-width:600px){[data-mwi-equipment-filters] .mwi-ef-fields{gap:8px}[data-mwi-equipment-filters] input{width:145px}}\n"); style.dataset.mwiEquipmentFilterStyle = ""; doc.head.append(style);
    new win.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "value"] });
    // Vue may update an input's value property without changing its HTML attribute.
    // Re-read visible controls after normal player selection/edit interactions.
    for (const event of ["click", "input", "change", "keyup"]) doc.addEventListener(event, schedule, true);
    win.addEventListener("hashchange", schedule); attach();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})(window);

// ---- archive_app.js ----
(function startArchive(root) {
  "use strict";
  const supported = location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    (location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/"));
  if (!supported || root.__MWILoadoutArchiveInstalled) return;
  root.__MWILoadoutArchiveInstalled = true;
  const D = root.MWINativeDocument, S = root.MWILoadoutStore;
  const native = root.MWINativeAdapter.create({ inspect: D.inspect });
  let storePromise, rows = [], selected = "", scope = "solo", query = "", filter = "all";
  let busy = false, ready = false, confirmGroup = false, pending = null, undo = null;
  let ui;
  const date = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const label = row => row.schemaVersion === 2 ? row.documentKind === "group" ? "整队" : "单人" : "旧版档案";
  const db = () => storePromise ||= S.create().catch(error => { storePromise = null; throw error; });
  function el(tag, text, cls) {
    const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
    if (cls) result.className = cls; return result;
  }
  function button(text, fn, cls) {
    const b = el("button", text, cls); b.type = "button";
    b.addEventListener("click", () => Promise.resolve().then(fn).catch(error => status(error.message, "error")));
    return b;
  }
  function status(message, tone = "info") {
    ui.status.textContent = message; ui.status.dataset.tone = tone;
    ui.recovery.hidden = !native.recoveryAvailable;
    ui.undo.hidden = !undo;
  }
  function setBusy(value) {
    busy = value; ui.panel.setAttribute("aria-busy", String(value));
    for (const control of ui.shadow.querySelectorAll("button,input,select")) control.disabled = value;
    ui.capture.disabled = value || !ready;
    ui.source.disabled = value || scope === "group";
  }
  async function task(message, action, { focus } = {}) {
    if (busy) return;
    const previousFocus = ui.shadow.activeElement;
    setBusy(true); status(message);
    try { return await action(); }
    finally {
      setBusy(false); ui.recovery.hidden = !native.recoveryAvailable;
      const nativeDialog = [...document.querySelectorAll('[role="dialog"]')].some(e => !e.hidden && e.getClientRects().length);
      if (ui.host.isConnected && !nativeDialog && (focus || previousFocus)) {
        const target = focus?.() || (previousFocus?.isConnected ? previousFocus : ui.captureName);
        target?.focus();
      }
    }
  }
  async function nativeCall(action) {
    // Reserve the embedded page space while the website's own modal takes focus.
    ui.host.style.visibility = "hidden";
    try { return await action(); }
    finally { ui.host.style.visibility = ""; }
  }
  function visibleRows() {
    return rows.filter(row => (filter === "trash" ? !!row.deletedAt : !row.deletedAt) &&
      (filter === "solo" ? row.schemaVersion === 2 && row.documentKind === "solo"
        : filter === "group" ? row.schemaVersion === 2 && row.documentKind === "group"
        : filter === "legacy" ? row.schemaVersion !== 2 : true) &&
      `${row.name} ${row.characterName || ""}`.toLowerCase().includes(query.toLowerCase()));
  }
  async function refresh() {
    const data = await (await db()).all(); ready = true;
    rows = data.sort((a, b) => b.updatedAt - a.updatedAt);
    if (!visibleRows().some(row => row.id === selected)) { selected = visibleRows()[0]?.id || ""; confirmGroup = false; }
    render();
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const a = el("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderList() {
    ui.list.replaceChildren();
    const items = visibleRows();
    if (!items.length) {
      const filtered = query || !["all", "trash"].includes(filter);
      ui.list.append(el("p", filter === "trash" ? "回收站为空。" : filtered ? "没有匹配的档案。" : "还没有保存的配置。", "empty"));
      if (filtered) ui.list.append(button("清除筛选", () => { query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all"; selected = visibleRows()[0]?.id || ""; render(); }));
      return;
    }
    for (const row of items) {
      const item = button("", () => { selected = row.id; confirmGroup = false; render(); ui.list.querySelector('[aria-pressed="true"]')?.focus(); });
      item.className = "archive"; item.setAttribute("aria-pressed", String(row.id === selected));
      item.append(el("strong", row.name), el("small", `${label(row)} · ${row.characterName || "未命名角色"}`), el("small", date(row.capturedAt)));
      ui.list.append(item);
    }
  }
  function renderDetail() {
    ui.detail.replaceChildren(); const row = rows.find(r => r.id === selected && visibleRows().some(v => v.id === r.id));
    if (!row) {
      const box = el("div", undefined, "detail-empty");
      box.append(el("h3", filter === "trash" ? "已删除的档案可在这里恢复" : "把网页上调好的配置留下来"),
        el("p", "选择上方的单人或整队，点击“保存网页当前配置”。", "muted"),
        el("p", "直接使用网页原生导出，不需要先从游戏重新导入，也不需要下载再上传。", "muted"));
      ui.detail.append(box); return;
    }
    ui.detail.append(el("h3", row.name), el("p", `${label(row)} · 保存于 ${date(row.capturedAt)}`, "note"));
    let info;
    try { info = D.describe(row); }
    catch (error) {
      ui.detail.append(el("p", `这份档案暂时无法读取：${error.message}`, "note"),
        button("下载原始档案供修复", () => download(JSON.stringify(row, null, 2), "MWI待修复档案.json")));
      return;
    }
    const scopeBox = el("div", undefined, "scope");
    scopeBox.append(el("p", info.legacy ? "旧版导入快照：不含保存后在网页上的手动修改，也可能缺少原生配置字段。"
      : info.scope === "group" ? `完整整队 JSON · ${info.players.length} 个玩家槽位及模拟设置。`
        : "完整单人 JSON · 玩家配装及原生导出的模拟设置。"));
    scopeBox.append(el("p", info.legacy ? "恢复时交给网页原生单人导入；缺失字段沿用网页规则，请核对结果。"
      : "保存内容完整保留；恢复范围和字段处理由网页原生导入决定。", "note"));
    ui.detail.append(scopeBox);
    if (row.deletedAt) {
      ui.detail.append(button("恢复这份档案", () => task("正在恢复档案…", async () => {
        await (await db()).update(row.id, { deletedAt: null, updatedAt: Date.now() }); if (undo === row.id) undo = null; filter = "all"; ui.filter.value = "all";
        selected = row.id; await refresh(); status("档案已从回收站恢复。");
      }), "primary")); return;
    }
    const naming = el("form", undefined, "name-field"), name = el("input");
    name.value = row.name; name.maxLength = 120; name.setAttribute("aria-label", "档案名称");
    const rename = el("button", "保存名称"); rename.type = "submit";
    naming.append(name, rename); naming.addEventListener("submit", event => {
      event.preventDefault(); const value = name.value;
      task("正在保存名称…", async () => {
        const valueName = D.validName(value);
        await (await db()).update(row.id, { name: valueName, updatedAt: Date.now() }); await refresh(); status("档案名称已保存。");
      }, { focus: () => ui.detail.querySelector('input[aria-label="档案名称"]') }).catch(error => status(error.message, "error"));
    }); ui.detail.append(naming);
    if (info.players.length) {
      const table = el("table"); const caption = el("caption", "保存的玩家", "sr-only");
      table.append(caption); const head = el("thead"), tr = el("tr");
      for (const word of ["槽位", "角色", "已配装备"]) { const th = el("th", word); th.scope = "col"; tr.append(th); }
      head.append(tr); table.append(head); const body = el("tbody");
      for (const p of info.players) {
        const line = el("tr"); const equipped = Object.values(p.equipment).filter(v => v?.itemHrid).length;
        line.append(el("td", `玩家 ${p.id}`), el("td", p.name || "未命名"), el("td", `${equipped} 件`)); body.append(line);
      }
      table.append(body); ui.detail.append(table);
    } else ui.detail.append(el("p", `角色：${row.characterName}`, "muted"));
    const actions = el("div", undefined, "actions");
    if (info.scope === "solo") {
      const targetLabel = el("label", "导入目标 "), target = el("select"); target.setAttribute("aria-label", "导入目标玩家");
      for (let n = 1; n <= 5; n++) { const opt = el("option", `玩家 ${n}`); opt.value = String(n); target.append(opt); }
      target.value = ui.targetSlot || "1"; target.addEventListener("change", () => { ui.targetSlot = target.value; }); targetLabel.append(target);
      actions.append(targetLabel, button("导入到网页", () => restore(row, info, target.value), "primary"));
      scopeBox.append(el("p", info.legacy ? "仅导入指定玩家；旧档案缺失字段请在网页中核对。"
        : "会替换所选玩家，并按网页原生规则导入包内模拟设置；其他玩家配装保留。", "note"));
    } else actions.append(button("导入整队配置", () => { confirmGroup = true; renderDetail(); ui.detail.querySelector('[data-group-confirm]')?.focus(); }, "primary"));
    ui.detail.insertBefore(actions, naming);
    if (info.scope === "group" && confirmGroup) {
      const confirmation = el("div", undefined, "confirmation");
      confirmation.append(el("p", `将恢复“${row.name}”中的玩家 ${info.players.map(p => p.id).join("、")} 及模拟设置。当前相应配置会被替换，优化结果可能重置。`));
      const yes = button("确认恢复整队及模拟设置", () => restore(row, info, null, true), "primary"); yes.dataset.groupConfirm = "";
      confirmation.append(yes, button("取消整队恢复", () => { confirmGroup = false; renderDetail(); ui.detail.querySelector('.primary')?.focus(); })); ui.detail.insertBefore(confirmation, naming);
    }
    const tools = el("div", undefined, "actions secondary-actions");
    tools.append(button(info.legacy ? "导出旧版档案" : "下载原生 JSON", () => {
      download(info.legacy ? D.backup([row]) : row.jsonText, info.legacy ? "MWI旧版档案.json" : `MWI-${info.scope}-${Date.now()}.json`);
      status("已生成下载文件，档案仍保留。");
    }), button("移入回收站", () => task("正在移动档案…", async () => {
      await (await db()).update(row.id, { deletedAt: Date.now(), updatedAt: Date.now() }); undo = row.id;
      confirmGroup = false; await refresh(); status("档案已移入回收站，可撤销或稍后恢复。");
    }), "danger")); ui.detail.append(tools);
    const details = el("details"), summary = el("summary", info.legacy ? "查看旧版保存内容" : "查看保存的原生 JSON");
    details.append(summary); details.addEventListener("toggle", () => {
      if (details.open && !details.querySelector("pre")) {
        details.append(el("pre", info.text.slice(0,12000)));
        if (info.text.length > 12000) details.append(el("p", "仅预览前 12,000 个字符；下载文件包含完整内容。", "note"));
      }
    }); ui.detail.append(details);
  }
  async function restore(row, info, target, confirmed = false) {
    await task("正在调用网页原生导入，请等待网页确认…", async () => {
      await nativeCall(() => native.restore(info.text, info.scope, target, { confirmedGroup: confirmed, legacy: info.legacy }));
      confirmGroup = false; renderDetail(); status(info.scope === "group" ? "网页已确认：整队配置导入成功。" : `网页已确认：已导入玩家 ${target}。`);
    }, { focus: () => ui.detail.querySelector('.actions > .primary') });
  }
  function render() {
    renderList(); renderDetail();
    ui.count.textContent = `${rows.filter(row => !row.deletedAt).length} 份档案`;
    setBusy(busy);
  }
  function renderPending() {
    ui.pending.replaceChildren(); if (!pending) return;
    const groups = pending.filter(row => row.documentKind === "group").length;
    ui.pending.append(el("p", `已校验 ${pending.length} 份档案${groups ? `，其中 ${groups} 份整队配置` : ""}。添加到档案库不会修改网页配置。`),
      button("添加到档案库", () => task("正在添加档案…", async () => {
        const source = pending; if (!source) return;
        const count = await (await db()).addNamed(source); pending = null; renderPending();
        query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all";
        if (count) selected = source[0].id;
        await refresh(); status(`已添加 ${count} 份档案，跳过 ${source.length - count} 份同名同内容档案。`);
      })), button("取消添加", () => { pending = null; renderPending(); status("已取消添加，已有档案保留。"); }));
  }
  function mount() {
    if (document.getElementById("mwi-loadout-archive-host")) return;
    const host = el("div"); host.id = "mwi-loadout-archive-host";
    const shadow = host.attachShadow({ mode: "open" }), style = el("style", ":host{all:initial;display:block;width:100%;min-width:0;margin-block-start:20px;scroll-margin-top:80px;container:archive / inline-size;color-scheme:dark;font:13px/1.6 system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;--bg:#111827;--surface:#1c2636;--fg:#f1f5f9;--muted:#b6c3d5;--line:#3a4a60;--accent:#2563eb;--hover:#253348;color:var(--fg)}\n:host([data-theme=\"light\"]){color-scheme:light;--bg:#fff;--surface:#f1f5f9;--fg:#182233;--muted:#4b5c73;--line:#b7c3d2;--hover:#e5edf8}\n*{box-sizing:border-box}button,input,select{font:inherit;color:inherit}button,input,select{border:1px solid var(--line);border-radius:6px;background:var(--surface);padding:7px 10px}button{cursor:pointer}button:disabled,input:disabled,select:disabled{cursor:default;opacity:.55}button:hover:not(:disabled){background:var(--hover)}button:focus-visible,input:focus-visible,select:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #60a5fa;outline-offset:3px}input{min-width:0;caret-color:var(--fg)}input::placeholder{color:var(--muted);opacity:1}::selection{background:#1d4ed8;color:#fff}a{color:#75b4ff;text-underline-offset:3px}:host([data-theme=\"light\"]) a{color:#1d4ed8}[hidden]{display:none!important}\n.panel{width:100%;min-width:0;height:auto;background:var(--bg);border:1px solid var(--line);border-radius:10px}header{display:flex;gap:16px;align-items:center;justify-content:space-between;padding:20px 24px;border-bottom:1px solid var(--line)}h2,h3,p{margin:0}h2{font-size:20px;line-height:1.4}h3{font-size:16px;overflow-wrap:anywhere}header p{font-size:12px;color:var(--muted);margin-top:4px}.archive-count{flex:none;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}.capture{padding:16px 24px 18px;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;align-items:center;gap:12px 18px}.capture fieldset{display:flex;align-items:center;gap:16px;margin:0;padding:0;border:0}.capture legend{float:left;margin-right:14px;color:var(--muted);font-size:12px}.capture label{display:inline-flex;align-items:center;gap:6px}.capture input[type=radio]{margin:0;accent-color:var(--accent);width:16px;height:16px;padding:0}.capture-fields{display:flex;gap:8px;width:100%}.capture-fields input{flex:1;min-width:0}.capture-fields button{flex:none;white-space:nowrap}.capture>.note{width:100%}.toolbar{display:flex;gap:8px;align-items:center;padding:16px 24px;flex-wrap:wrap}.toolbar input{flex:1;min-width:150px}.toolbar select{max-width:130px}\n.layout{display:grid;grid-template-columns:minmax(210px,28%) minmax(0,1fr);align-items:start;min-height:260px;border-top:1px solid var(--line)}.list{max-height:46rem;overflow:auto;padding:10px;scrollbar-width:thin;scrollbar-color:var(--line) var(--bg);overscroll-behavior:auto}.archive{display:block;width:100%;text-align:left;border:0;border-radius:4px;background:transparent;margin-bottom:4px;padding:12px;overflow-wrap:anywhere}.archive[aria-pressed=\"true\"]{background:var(--hover);outline:1px solid var(--line)}.archive strong{display:block;font-weight:600}.archive small{display:block;color:var(--muted);font-size:11px;margin-top:3px}.detail{min-width:0;padding:22px 24px;overflow-wrap:anywhere;border-left:1px solid var(--line)}.detail>p{margin-top:8px}.muted{color:var(--muted)}.note{font-size:12px;color:var(--muted);white-space:pre-line}.scope{margin:16px 0;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font-size:12px}.scope .note{margin-top:5px}.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:16px}.actions label{display:flex;align-items:center;gap:8px}.primary{background:var(--accent);border-color:var(--accent);color:#fff}.primary:hover:not(:disabled){background:#1d4ed8}.name-field{display:flex;gap:8px;align-items:center;margin-top:20px}.name-field input{width:100%}.name-field button{flex:none;white-space:nowrap}.danger{color:#fca5a5}:host([data-theme=\"light\"]) .danger{color:#a31515}.empty{padding:22px 12px;color:var(--muted);font-size:12px}.detail-empty{padding-block:12px 30px}.detail-empty h3{margin-bottom:10px}.detail-empty p{margin:10px 0;max-width:65ch}.status{margin:16px 24px 12px;padding:10px 12px;background:var(--surface);font-size:12px;min-height:38px;white-space:pre-line;overflow-wrap:anywhere}.status[data-tone=\"error\"]{color:#fca5a5}:host([data-theme=\"light\"]) .status[data-tone=\"error\"]{color:#a31515}.footer-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 24px 6px}.footer-actions button{font-size:12px;padding:5px 9px}.bottom{padding:10px 24px 18px;color:var(--muted);font-size:11px}.file{display:none}\ntable{width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;margin-top:18px}th,td{text-align:left;padding:9px 6px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{font-weight:500;color:var(--muted)}th:first-child{width:76px}th:last-child{width:80px}td:last-child{font-variant-numeric:tabular-nums}.secondary-actions{margin-top:20px;padding-top:16px;border-top:1px solid var(--line)}.confirmation{margin-top:14px;padding:14px 0;border-block:1px solid var(--line)}.confirmation p{margin-bottom:12px}.confirmation button{margin:0 8px 6px 0}.import-preview{padding:0 24px;font-size:12px}.import-preview:empty{display:none}.import-preview p{margin:0 0 8px}.import-preview button{margin:0 8px 12px 0}details{margin-top:20px;font-size:12px}summary{cursor:pointer;color:var(--muted);padding:6px 0}pre{max-height:240px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font:11px/1.5 ui-monospace,SFMono-Regular,monospace;background:var(--surface);padding:12px;margin:8px 0}input,select,.archive{font-variant-numeric:tabular-nums}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n@container archive (max-width:680px){header{padding:16px}h2{font-size:18px}.capture{padding:14px 16px;gap:10px 12px}.capture-fields{flex-wrap:wrap}.capture-fields input{flex-basis:100%}.capture-fields button{width:100%}.toolbar{padding:14px 16px;gap:8px}.toolbar input{flex-basis:100%}.toolbar button{padding:7px 9px;font-size:12px}.layout{grid-template-columns:1fr;min-height:0}.list{max-height:22rem;padding:8px;border-bottom:1px solid var(--line)}.detail{padding:20px 16px;border-left:0}.status{margin:14px 16px 12px}.footer-actions{padding:0 16px 6px}.bottom{padding:10px 16px 16px}.import-preview{padding:0 16px}.name-field{flex-wrap:wrap}.actions select{max-width:100%}th:first-child{width:68px}th:last-child{width:70px}}\n"); shadow.append(style);
    const panel = el("section", undefined, "panel"); panel.setAttribute("aria-label", "配装档案管理");
    const head = el("header"), title = el("div"), count = el("span", "0 份档案", "archive-count");
    title.append(el("h2", "配装档案"), el("p", "保存网页当前配置，随时交回网页恢复")); head.append(title, count);
    const capture = el("form", undefined, "capture");
    const mode = el("fieldset"), legend = el("legend", "保存范围"); mode.append(legend);
    for (const [value, text] of [["solo", "单人"], ["group", "整队"]]) {
      const l = el("label"), radio = el("input"); radio.type = "radio"; radio.name = "capture-scope"; radio.value = value; radio.checked = value === scope;
      radio.addEventListener("change", () => { scope = value; ui.source.disabled = value === "group"; ui.sourceLabel.hidden = value === "group"; }); l.append(radio, document.createTextNode(text)); mode.append(l);
    }
    const sourceLabel = el("label", "来源槽位 "), source = el("select"); source.setAttribute("aria-label", "保存来源玩家");
    for (let n = 1; n <= 5; n++) { const option = el("option", `玩家 ${n}`); option.value = String(n); source.append(option); } sourceLabel.append(source);
    const captureName = el("input"); captureName.maxLength = 120; captureName.placeholder = "配置名称（留空自动命名）"; captureName.setAttribute("aria-label", "新配置名称");
    const captureButton = el("button", "保存网页当前配置", "primary"); captureButton.type = "submit";
    const fields = el("div", undefined, "capture-fields"); fields.append(captureName, captureButton); capture.append(mode, sourceLabel, fields,
      el("p", "包含原生导出中的模拟设置。每次保存新建档案，不覆盖已有配置。", "note"));
    capture.addEventListener("submit", event => { event.preventDefault();
      const captureScope = scope, slot = source.value, name = captureName.value;
      task("正在调用网页原生导出，请等待导出完成…", async () => {
        const text = await nativeCall(() => native.capture(captureScope, slot));
        const row = await D.prepare(text, { name });
        const count = await (await db()).addNamed([row]);
        query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all";
        await refresh();
        selected = count ? row.id : rows.find(r => !r.deletedAt && r.fingerprint === row.fingerprint && r.name === row.name)?.id || selected;
        render(); status(count ? `已保存“${row.name}”，包含网页当前${captureScope === "group" ? "整队" : "单人"}配置。` : "同名同内容档案已存在，未重复添加。");
      }, { focus: () => ui.captureName }).catch(error => status(error.message, "error"));
    });
    const toolbar = el("div", undefined, "toolbar"), search = el("input"); search.type = "search"; search.placeholder = "搜索配置或角色"; search.setAttribute("aria-label", "搜索配置或角色");
    search.addEventListener("input", () => { query = search.value; confirmGroup = false; if (!visibleRows().some(r => r.id === selected)) selected = visibleRows()[0]?.id || ""; renderList(); renderDetail(); });
    const filterSelect = el("select"); filterSelect.setAttribute("aria-label", "档案分类");
    for (const [value, text] of [["all", "全部档案"], ["solo", "单人"], ["group", "整队"], ["legacy", "旧版档案"], ["trash", "回收站"]]) {
      const option = el("option", text); option.value = value; filterSelect.append(option);
    }
    filterSelect.addEventListener("change", () => { filter = filterSelect.value; confirmGroup = false; selected = visibleRows()[0]?.id || ""; render(); });
    const file = el("input", undefined, "file"); file.type = "file"; file.accept = ".json,application/json"; file.setAttribute("aria-label", "导入档案文件");
    file.addEventListener("change", () => {
      const chosen = file.files?.[0]; file.value = ""; if (!chosen || busy) return;
      task("正在校验档案文件…", async () => {
        pending = null; renderPending(); if (chosen.size > D.MAX_BYTES) throw new Error("文件超过 20 MB，请拆分后重试。");
        pending = await D.importFile(await chosen.text()); renderPending(); status("文件已校验，请点击“添加到档案库”。");
      }).catch(error => status(error.message, "error"));
    });
    toolbar.append(search, filterSelect, button("导入档案文件", () => file.click()), button("备份全部", () => {
      download(D.backup(rows.filter(row => !row.deletedAt)), `MWI配装档案备份-${Date.now()}.json`); status("已生成完整备份，不包含回收站档案。");
    }));
    const layout = el("div", undefined, "layout"), list = el("div", undefined, "list"), detail = el("div", undefined, "detail");
    list.setAttribute("aria-label", "档案列表"); detail.setAttribute("aria-label", "档案详情"); layout.append(list, detail);
    const pendingBox = el("div", undefined, "import-preview"), live = el("div", undefined, "status"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    const foot = el("div", undefined, "footer-actions"), undoButton = button("撤销移入回收站", () => task("正在恢复档案…", async () => {
      const id = undo; if (!id) return; await (await db()).update(id, { deletedAt: null, updatedAt: Date.now() }); undo = null; await refresh(); status("已撤销，档案恢复。");
    })); undoButton.hidden = true;
    const recovery = button("下载网页原有输入备份", () => { download(native.backupDraft(), "MWI网页原有输入备份.json"); status("已生成原输入备份，可打开文件取回单人或整队文本。请核对网页后再重试。"); }); recovery.hidden = true;
    foot.append(button("重新读取档案", () => task("正在读取本地档案…", async () => { await refresh(); status("档案列表已刷新。"); })), undoButton, recovery);
    panel.append(head, capture, toolbar, pendingBox, layout, live, foot, el("p", "仅保存在当前网站和浏览器。清除网站数据前，请先备份。", "bottom"));
    shadow.append(panel, file);
    ui = { host, shadow, panel, count, list, detail, status: live, search, filter: filterSelect, file, pending: pendingBox,
      capture: captureButton, captureName, source, sourceLabel, recovery, undo: undoButton, targetSlot: "1" };
    function syncTheme() { host.dataset.theme = document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
    syncTheme(); new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    root.addEventListener("focus", () => { if (host.isConnected && !busy) refresh().catch(error => status(error.message, "error")); });
    // The Vue route mounts asynchronously and may later replace its section.
    // Keep one host and move it into the verified home workspace, preserving
    // archive selection and form drafts across ordinary route changes.
    let scheduled = false;
    function attachToHome() {
      scheduled = false;
      if (!/^#\/home(?:[/?]|$)/.test(location.hash)) { host.remove(); return; }
      const sections = [...document.querySelectorAll('main [role="tablist"]')].filter(tabs => {
        const labels = [...tabs.querySelectorAll('[role="tab"]')].map(tab => tab.textContent || "");
        return labels.length === 3 && labels.some(text => /战斗|combat/i.test(text)) && labels.some(text => /结果|results/i.test(text));
      }).map(tabs => tabs.closest("section")).filter(Boolean);
      const unique = [...new Set(sections)];
      if (unique.length !== 1) { host.remove(); return; }
      if (host.parentElement !== unique[0]) unique[0].append(host);
    }
    function scheduleAttach() {
      if (!scheduled) { scheduled = true; root.requestAnimationFrame(attachToHome); }
    }
    new MutationObserver(() => {
      if (!host.isConnected && /^#\/home(?:[/?]|$)/.test(location.hash)) scheduleAttach();
    }).observe(document.body, { childList: true, subtree: true });
    root.addEventListener("hashchange", scheduleAttach);
    attachToHome();
    render(); task("正在读取本地档案…", async () => { await refresh(); status("选择单人或整队，保存网页当前配置。"); }).catch(error => status(error.message, "error"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})(window);
