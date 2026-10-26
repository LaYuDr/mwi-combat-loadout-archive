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
