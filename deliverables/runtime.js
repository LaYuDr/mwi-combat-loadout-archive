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
