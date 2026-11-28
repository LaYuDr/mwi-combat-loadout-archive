// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME
// ---- scene_core.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const EQUIPMENT = {
    back: "背部", head: "头部", trinket: "徽章", main_hand: "主手", off_hand: "副手",
    body: "身体", hands: "手部", legs: "腿部", pouch: "食物袋", feet: "脚部",
    neck: "项链", earrings: "耳环", ring: "戒指", charm: "护符",
    milking_tool: "挤奶工具", foraging_tool: "采摘工具", woodcutting_tool: "伐木工具",
    cheesesmithing_tool: "奶酪锻造工具", crafting_tool: "制作工具", tailoring_tool: "缝纫工具",
    cooking_tool: "烹饪工具", brewing_tool: "冲泡工具", alchemy_tool: "炼金工具", enhancing_tool: "强化工具"
  };
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const hrid = (value, kind) => typeof value === "string" && new RegExp(`^/${kind}/[a-z0-9_]+$`).test(value);
  function copy(value) {
    let nodes = 0;
    function check(v, depth) {
      if (++nodes > 30000 || depth > 24) throw Error("配置结构过于复杂，未保存。 ");
      if (v === null || typeof v === "boolean" || typeof v === "string") return;
      if (typeof v === "number" && Number.isFinite(v)) return;
      if (typeof v !== "object" || !v) throw Error("配置含不可保存的字段，请等待网页数据完整后重试。");
      for (const key of Object.keys(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw Error("配置包含不安全字段，未保存。");
        check(v[key], depth + 1);
      }
    }
    check(value, 0);
    const text = JSON.stringify(value);
    if (text.length > 300000) throw Error("单份配置超过大小限制，未保存。");
    return JSON.parse(text);
  }
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (object(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value);
  }
  function item(hash) {
    if (!hash) return null;
    const match = /^(\d+)::\/item_locations\/[a-z0-9_]+::(\/items\/[a-z0-9_]+)::(\d+)$/.exec(hash);
    if (!match) throw Error("装备标识无法识别，请等待网页数据完整后重试。");
    const level = Number(match[3]);
    if (!Number.isSafeInteger(level) || level > 1000) throw Error("装备强化等级无法识别。");
    return { itemHrid: match[2], enhancementLevel: level };
  }
  function validate(raw) {
    if (!object(raw) || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.name !== "string" ||
        !(raw.actionTypeHrid === "" || raw.actionTypeHrid === null || hrid(raw.actionTypeHrid, "action_types")) ||
        !object(raw.wearableMap) || typeof raw.useExactEnhancement !== "boolean")
      throw Error("未能完整读取原生配装，请重新打开配装详情后重试。");
    const combat = raw.actionTypeHrid === "/action_types/combat";
    // Native life/all-skills loadouts do not render combat slots. Keep absent
    // inactive fields unchanged; active fields must still be complete before saving.
    if ((combat || raw.abilityMap != null) && !object(raw.abilityMap) ||
        (combat || raw.foodItemHrids != null) && !Array.isArray(raw.foodItemHrids) ||
        (raw.actionTypeHrid || raw.drinkItemHrids != null) && !Array.isArray(raw.drinkItemHrids))
      throw Error("未能完整读取原生配装，请重新打开配装详情后重试。");
    for (const [key, value] of Object.entries(raw.wearableMap)) {
      if (!hrid(key, "item_locations") || !(value === null || typeof value === "string")) throw Error("装备槽位数据无法识别。");
      item(value);
    }
    for (const [key, value] of Object.entries(raw.abilityMap || {})) {
      if (!/^[1-5]$/.test(key) || !(value === null || value === "" || hrid(value, "abilities"))) throw Error("技能槽位数据无法识别。");
    }
    for (const list of [raw.foodItemHrids || [], raw.drinkItemHrids || []]) {
      if (list.length > 3 || list.some(v => !(v === null || v === "" || hrid(v, "items")))) throw Error("消耗品槽位数据无法识别。");
    }
    for (const key of ["abilityCombatTriggersMap", "consumableCombatTriggersMap"]) {
      // The verified native renderer treats an absent map/entry as an empty trigger list.
      if (raw[key] === undefined || raw[key] === null) continue;
      if (!object(raw[key])) throw Error("触发条件数据不完整，未保存。");
      for (const [id, triggers] of Object.entries(raw[key])) {
        if (!hrid(id, key === "abilityCombatTriggersMap" ? "abilities" : "items") || !Array.isArray(triggers) || triggers.length > 100)
          throw Error("触发条件格式无法识别，未保存。");
        for (const trigger of triggers) {
          if (!object(trigger) || !hrid(trigger.dependencyHrid, "combat_trigger_dependencies") ||
              !hrid(trigger.conditionHrid, "combat_trigger_conditions") || !hrid(trigger.comparatorHrid, "combat_trigger_comparators") ||
              typeof trigger.value !== "number" || !Number.isFinite(trigger.value)) throw Error("触发条件尚未完整设置，未保存。");
        }
      }
    }
    return copy(raw);
  }
  function name(value) {
    const result = String(value || "").trim();
    if (!result || result.length > 60) throw Error("请输入 1–60 字的子方案名称。");
    return result;
  }
  function snapshot(raw) { return { schemaVersion: 1, raw: validate(raw) }; }
  function validateSnapshot(value) {
    if (!object(value) || value.schemaVersion !== 1) throw Error("子方案版本无法识别，请使用兼容版本。");
    return snapshot(value.raw);
  }
  function pickSuggestedName(...candidates) {
    for (const value of candidates) {
      if (typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed) return trimmed.slice(0, 60);
    }
    return "";
  }
  function parseImport(text) {
    if (typeof text !== "string" || text.length > 5000000) throw Error("配装内容超过 5 MB，未导入。");
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Error("配装内容不是有效 JSON，请重新粘贴或选择文件。"); }
    const modern = (players, prefix = "", title = "", fallbackNames = []) => {
      if (!Array.isArray(players) || !players.length || players.length > 5 || players.some(player => !object(player)))
        throw Error("角色列表需要包含 1–5 个有效角色。");
      return players.map((player, index) => ({ key: `${prefix}${index + 1}`,
        label: `${title}${String(player.name || `角色 ${index + 1}`).slice(0, 60)} · ${index + 1}`, player,
        suggestedName: pickSuggestedName(player.loadoutName, ...fallbackNames) }));
    };
    if (data?.format === "mwi-vue-solo" && data.version === 2 && object(data.player))
      return [{ key: "solo", label: "当前角色", player: data.player,
        suggestedName: pickSuggestedName(data.loadoutName, data.name, data.title, data.meta?.loadoutName) }];
    if (data?.version === 2 && data.format === "mwi-vue-group")
      return modern(data.players, "", "", [data.loadoutName, data.name, data.title, data.meta?.loadoutName]);
    if (data?.schemaVersion === 1 && data.kind === "combat-party-builds") {
      if (!Array.isArray(data.builds) || !data.builds.length || data.builds.length > 100)
        throw Error("整队方案文件需要包含 1–100 个方案。");
      return data.builds.flatMap((build, index) => {
        if (!object(build)) throw Error("整队方案结构不完整。");
        return modern(build.players, `build-${index + 1}:`, `${String(build.name || `方案 ${index + 1}`).slice(0, 60)} / `,
          [build.loadoutName, build.name, data.loadoutName]);
      });
    }
    // mwisim full simulation exports carry players together with results and targets.
    if (object(data) && Array.isArray(data.players) && Array.isArray(data.rows) &&
        Array.isArray(data.targets) && object(data.simulationSettings))
      return modern(data.players, "", "", [data.loadoutName, data.meta?.loadoutName]);
    if (object(data?.levels) && object(data.equipment) && Array.isArray(data.abilities))
      return modern([data], "", "", [data.loadoutName, data.meta?.loadoutName]);
    const legacy = (value, key) => {
      if (typeof value === "string") {
        try { value = JSON.parse(value); } catch (_) { throw Error(`角色 ${key} 的内容不是有效 JSON。`); }
      }
      if (!object(value?.player) || !Array.isArray(value.player.equipment) || value.player.equipment.length > 24)
        throw Error(`角色 ${key} 的装备格式无法识别。`);
      const equipment = {};
      for (const gear of value.player.equipment) {
        if (!object(gear) || !hrid(gear.itemLocationHrid, "item_locations")) throw Error(`角色 ${key} 的装备槽位无法识别。`);
        const slot = gear.itemLocationHrid.split("/").pop();
        if ((!Object.hasOwn(EQUIPMENT, slot) && slot !== "two_hand") || Object.hasOwn(equipment, slot))
          throw Error(`角色 ${key} 的装备槽位未知或重复。`);
        equipment[slot] = { itemHrid: gear.itemHrid, enhancementLevel: gear.enhancementLevel };
      }
      const consumables = kind => {
        const slots = value[kind]?.["/action_types/combat"];
        if (!Array.isArray(slots) || slots.length > 3) throw Error(`角色 ${key} 的战斗消耗品不完整。`);
        return slots.map(slot => {
          if (slot === null) return null;
          if (!object(slot) || !(slot.itemHrid === "" || hrid(slot.itemHrid, "items"))) throw Error(`角色 ${key} 的消耗品无法识别。`);
          return slot.itemHrid;
        });
      };
      let abilities = value.abilities;
      if (object(abilities)) {
        const keys = Object.keys(abilities), start = Object.hasOwn(abilities, "0") ? 0 : 1;
        if (![4, 5].includes(keys.length) || keys.some(key => !/^\d$/.test(key)) ||
            !Array.from({ length: keys.length }, (_, index) => String(index + start)).every(key => Object.hasOwn(abilities, key)))
          throw Error(`角色 ${key} 的技能槽位不完整。`);
        abilities = Array.from({ length: keys.length }, (_, index) => abilities[index + start]);
      }
      if (Array.isArray(abilities) && abilities.length === 4) abilities = [null, ...abilities];
      const nickname = typeof value.player.name === "string" ? value.player.name :
        typeof value.player.characterName === "string" ? value.player.characterName : "";
      return { key, label: nickname ? `${nickname.slice(0, 60)} · ${key}` : `角色 ${key}`, player: { name: nickname, equipment, abilities,
        food: consumables("food"), drinks: consumables("drinks"), triggerMap: value.triggerMap },
        suggestedName: pickSuggestedName(value.loadoutName, value.meta?.loadoutName, value.player.loadoutName) };
    };
    if (object(data?.player) && Array.isArray(data.player.equipment)) return [legacy(data, "1")];
    const keys = object(data) ? Object.keys(data) : [];
    if (!keys.length || keys.length > 5 || keys.some(key => !/^[1-5]$/.test(key)))
      throw Error("无法识别配装格式，请选择单人配装或编号角色配装文件。");
    return keys.sort().map(key => legacy(data[key], key));
  }
  function importChoices(text) {
    return parseImport(text).map(({ key, label, player, suggestedName = "" }) => ({ key, label,
      nickname: typeof player.name === "string" ? player.name : "", suggestedName }));
  }
  function matchImportNickname(choices, nickname) {
    const normalize = value => typeof value === "string" ? value.trim().normalize("NFC") : "";
    const name = normalize(nickname);
    if (!name) return null;
    const matches = choices.filter(choice => normalize(choice.nickname) === name);
    return matches.length === 1 ? matches[0].key : null;
  }
  function importSolo(text, current, characterId, choice) {
    const choices = parseImport(text);
    const selected = choice ? choices.find(entry => entry.key === choice) : choices.length === 1 ? choices[0] : null;
    if (!selected) throw Error("请选择要导入的角色。");
    const raw = validate(current), player = selected.player;
    if (raw.actionTypeHrid !== "/action_types/combat") throw Error("请先打开一套战斗配装，再导入为子方案。");
    if (!Number.isSafeInteger(characterId) || characterId <= 0) throw Error("无法确认当前角色，未导入。");
    // Copy only the active combat configuration, never simulation settings, identity or saved loadouts.
    if (!object(player.equipment) ||
        !Array.isArray(player.abilities) || player.abilities.length > 5 ||
        !Array.isArray(player.food) || !Array.isArray(player.drinks) || !object(player.triggerMap))
      throw Error("配装中的装备、技能、消耗品或触发条件不完整，未导入。");
    raw.wearableMap = {};
    const slots = new Set();
    for (const [key, gear] of Object.entries(player.equipment)) {
      // Scene comparison normalizes both one-handed and two-handed weapons to main_hand.
      const slot = key === "weapon" || key === "two_hand" ? "main_hand" : key;
      if (!Object.hasOwn(EQUIPMENT, slot) || slot.endsWith("_tool") || slots.has(slot))
        throw Error("配装包含无法识别或重复的装备槽位，未导入。");
      slots.add(slot);
      if (gear === null) { raw.wearableMap[`/item_locations/${slot}`] = null; continue; }
      if (!object(gear) || !(gear.itemHrid === "" || hrid(gear.itemHrid, "items")) ||
          !Number.isSafeInteger(gear.enhancementLevel) || gear.enhancementLevel < 0 || gear.enhancementLevel > 1000)
        throw Error(`“${EQUIPMENT[slot]}”的装备或强化等级无法识别，未导入。`);
      raw.wearableMap[`/item_locations/${slot}`] = gear.itemHrid
        ? `${characterId}::/item_locations/inventory::${gear.itemHrid}::${gear.enhancementLevel}` : null;
    }
    raw.useExactEnhancement = true;
    raw.abilityMap = {};
    player.abilities.forEach((ability, index) => {
      if (ability !== null && (!object(ability) || !(ability.abilityHrid === "" || hrid(ability.abilityHrid, "abilities"))))
        throw Error(`技能 ${index + 1} 无法识别，未导入。`);
      raw.abilityMap[index + 1] = ability?.abilityHrid || null;
    });
    raw.foodItemHrids = copy(player.food);
    raw.drinkItemHrids = copy(player.drinks);
    raw.abilityCombatTriggersMap = {};
    raw.consumableCombatTriggersMap = {};
    // Only triggers for selected skills and consumables belong to this scene.
    for (const id of Object.values(raw.abilityMap).filter(Boolean)) {
      raw.abilityCombatTriggersMap[id] = Object.hasOwn(player.triggerMap, id) ? copy(player.triggerMap[id]) : [];
    }
    for (const id of [...raw.foodItemHrids, ...raw.drinkItemHrids].filter(Boolean)) {
      if (!hrid(id, "items")) throw Error("消耗品槽位数据无法识别，未导入。");
      raw.consumableCombatTriggersMap[id] = Object.hasOwn(player.triggerMap, id) ? copy(player.triggerMap[id]) : [];
    }
    return validate(raw);
  }
  function exportSimulator(source, title, target, props) {
    const raw = validate(source);
    if (raw.actionTypeHrid !== "/action_types/combat") throw Error("模拟器只支持导出战斗配装。");
    if (!["shykai", "mwisim", "vue"].includes(target)) throw Error("请选择目标模拟器。");
    const warnings = [], levels = {}, skillExperience = {};
    for (const skill of ["stamina", "intelligence", "attack", "melee", "defense", "ranged", "magic"]) {
      const entry = props?.characterSkillMap?.get?.(`/skills/${skill}`);
      if (!Number.isFinite(entry?.level) || entry.level < 1) throw Error("无法完整读取当前角色等级，请刷新游戏后再导出。");
      levels[skill] = Math.floor(entry.level);
      skillExperience[skill] = Number.isFinite(entry.experience) && entry.experience >= 0 ? entry.experience : null;
    }
    const gear = equipment(raw), modernEquipment = {};
    for (const [slot, value] of Object.entries(gear)) {
      if (slot.endsWith("_tool")) continue;
      if (value && value.enhancementLevel > 20) throw Error("模拟器不支持超过 +20 的装备，未导出。");
      modernEquipment[slot === "main_hand" ? "weapon" : slot] = value || { itemHrid: "", enhancementLevel: 0 };
    }
    const triggerMap = {}, abilityLevels = {};
    let unknownAbilities = 0;
    const abilities = Array.from({ length: 5 }, (_, index) => {
      const abilityHrid = raw.abilityMap[index + 1] || "";
      const known = props?.characterAbilityMap?.get?.(abilityHrid)?.level;
      const level = Number.isFinite(known) && known >= 1 ? Math.floor(known) : 1;
      if (abilityHrid) {
        if (!(Number.isFinite(known) && known >= 1)) unknownAbilities++;
        abilityLevels[abilityHrid] = level;
        triggerMap[abilityHrid] = copy(raw.abilityCombatTriggersMap?.[abilityHrid] || []);
      }
      return { abilityHrid, level };
    });
    const food = Array.from({ length: 3 }, (_, i) => raw.foodItemHrids[i] || "");
    const drinks = Array.from({ length: 3 }, (_, i) => raw.drinkItemHrids[i] || "");
    for (const id of [...food, ...drinks].filter(Boolean)) triggerMap[id] = copy(raw.consumableCombatTriggersMap?.[id] || []);
    if (unknownAbilities) warnings.push(`${unknownAbilities} 个未读取到等级的技能按 1 级导出`);
    if (!raw.useExactEnhancement) warnings.push("最高强化已转为快照内的具体等级");
    if (gear.trinket) warnings.push("目标模拟器不支持的徽章槽可能被忽略");
    warnings.push("角色等级取当前角色；房屋、公会增益、成就和模拟参数请在目标站核对");
    const player = { id: "1", name: String(props?.characterInfo?.name || title), selected: true,
      levels, skillExperience, equipment: modernEquipment, food, drinks, abilities, triggerMap,
      abilityLevels, abilityLevelMap: abilityLevels, houseRooms: {}, guildBuffs: {}, achievements: {}, combatScrolls: {} };
    let payload;
    if (target === "shykai") {
      const equipmentList = Object.entries(gear).filter(([, value]) => value).map(([slot, value]) => ({
        itemLocationHrid: `/item_locations/${slot}`, ...value
      }));
      const legacySlots = values => ({ "/action_types/combat": values.map(itemHrid => itemHrid ? { itemHrid } : null) });
      payload = { player: { ...Object.fromEntries(Object.entries(levels).map(([key, value]) => [key + "Level", value])), equipment: equipmentList },
        food: legacySlots(food), drinks: legacySlots(drinks), abilities, triggerMap };
    } else if (target === "mwisim") {
      payload = { schemaVersion: 1, kind: "combat-party-builds", builds: [{ name: name(title),
        players: [player], settings: {}, gameDataVersion: "loadout-assistant", savedAt: Date.now() }] };
    } else payload = { version: 2, format: "mwi-vue-solo", simulationSettings: {}, player };
    return { text: JSON.stringify(payload, null, 2), warnings };
  }
  function equipment(raw) {
    const result = {}, combat = raw.actionTypeHrid === "/action_types/combat";
    const available = key => !combat || !key.endsWith("_tool");
    for (const key of Object.keys(EQUIPMENT)) if (available(key)) result[key] = null;
    for (const [location, hash] of Object.entries(raw.wearableMap)) {
      const key = location.split("/").pop();
      if (hash && available(key)) result[key === "two_hand" ? "main_hand" : key] = item(hash);
    }
    return result;
  }
  const LIFE_SKILLS = new Set(["milking", "foraging", "woodcutting", "cheesesmithing", "crafting", "tailoring", "cooking", "brewing", "alchemy", "enhancing"]);
  const GATHERING_SKILLS = new Set(["milking", "foraging", "woodcutting"]);
  const UNIVERSAL_LIFE_STATS = new Set(["skillingSpeed", "skillingEfficiency", "skillingEssenceFind", "skillingRareFind", "skillingExperience", "taskSpeed"]);
  function diff(current, target, options = null) {
    const a = validate(current), b = validateSnapshot(target).raw, changes = [];
    if (a.id !== b.id || (a.actionTypeHrid || "") !== (b.actionTypeHrid || ""))
      throw Error("子方案与当前父配装不匹配，请重新选择。");
    const combat = b.actionTypeHrid === "/action_types/combat";
    const ignoreEmpty = Boolean(options?.ignoreHarmlessEmpty);
    const itemDetails = object(options?.itemDetails) ? options.itemDetails : null;
    const actionSkill = typeof b.actionTypeHrid === "string" && b.actionTypeHrid.startsWith("/action_types/")
      ? b.actionTypeHrid.slice("/action_types/".length) : "";
    const isSingleLife = LIFE_SKILLS.has(actionSkill);
    const targetHasDrinks = Boolean(b.drinkItemHrids?.some(Boolean));
    const targetHasFood = Boolean(b.foodItemHrids?.some(Boolean));
    const add = (kind, slot, label, from, to) => {
      if (stable(from) !== stable(to)) changes.push({ kind, slot, label, from, to });
    };
    add("setting", "enhancement", "强化选择", a.useExactEnhancement, b.useExactEnhancement);
    const ae = equipment(a), be = equipment(b);
    const isTwoHandTarget = Boolean(
      b.wearableMap["/item_locations/two_hand"] ||
      (be.main_hand && itemDetails?.[be.main_hand.itemHrid]?.equipmentDetail?.type === "/equipment_types/two_hand")
    );
    const isHarmlessEmptyPouch = currentPouch => {
      if (!currentPouch) return true;
      const detail = itemDetails?.[currentPouch.itemHrid]?.equipmentDetail;
      if (!detail) return true;
      if (object(detail.combatStats)) {
        for (const [stat, val] of Object.entries(detail.combatStats)) {
          if (!val || stat === "foodSlots" || stat === "drinkSlots") continue;
          if (stat === "drinkConcentration" && !targetHasDrinks) continue;
          if (stat === "foodHaste" && (!combat || !targetHasFood)) continue;
          return false;
        }
      }
      if (!combat && object(detail.noncombatStats)) {
        for (const [stat, val] of Object.entries(detail.noncombatStats)) {
          if (!val) continue;
          if (stat === "drinkConcentration" && !targetHasDrinks) continue;
          return false;
        }
      }
      return true;
    };
    const affectsLifeSkill = (itemHrid, skill) => {
      const detail = itemDetails?.[itemHrid];
      if (!detail) return true;
      const stats = detail.equipmentDetail?.noncombatStats;
      if (!object(stats)) return false;
      for (const [stat, val] of Object.entries(stats)) {
        if (!val) continue;
        if (UNIVERSAL_LIFE_STATS.has(stat)) return true;
        if (stat === "drinkConcentration" && targetHasDrinks) return true;
        if (stat === "gatheringQuantity" && GATHERING_SKILLS.has(skill)) return true;
        if (stat === "enhancingSuccess" && skill === "enhancing") return true;
        if (stat.startsWith(skill)) return true;
      }
      return false;
    };
    const pouchIgnored = ignoreEmpty && !be.pouch && isHarmlessEmptyPouch(ae.pouch);
    for (const key of new Set([...Object.keys(ae), ...Object.keys(be)])) {
      const normalize = v => v ? { itemHrid: v.itemHrid, ...(b.useExactEnhancement ? { enhancementLevel: v.enhancementLevel } : {}) } : null;
      const from = normalize(ae[key]), to = normalize(be[key]);
      if (ignoreEmpty && to === null && from !== null) {
        if (key === "off_hand" && isTwoHandTarget) continue;
        if (key === "trinket") continue;
        if (key === "pouch" && pouchIgnored) continue;
        if (isSingleLife && key.endsWith("_tool") && key !== `${actionSkill}_tool`) continue;
        if (isSingleLife && itemDetails && !affectsLifeSkill(from.itemHrid, actionSkill)) continue;
      }
      add("equipment", key, EQUIPMENT[key] || key, from, to);
    }
    if (combat) for (let slot = 1; slot <= 5; slot++) {
      const from = a.abilityMap[slot] || null, to = b.abilityMap[slot] || null;
      add("ability", slot, `技能 ${slot}`, from, to);
      add("ability_trigger", slot, `技能 ${slot} · 触发条件`, from ? a.abilityCombatTriggersMap?.[from] || [] : [], to ? b.abilityCombatTriggersMap?.[to] || [] : []);
    }
    let caps = { food: 3, drink: 3 };
    if (ignoreEmpty && itemDetails) {
      const effectivePouch = be.pouch || (pouchIgnored ? ae.pouch : null);
      if (!effectivePouch) caps = { food: 1, drink: 1 };
      else {
        const stats = itemDetails[effectivePouch.itemHrid]?.equipmentDetail?.combatStats;
        if (stats) caps = { food: Math.min(3, 1 + (Number(stats.foodSlots) || 0)), drink: Math.min(3, 1 + (Number(stats.drinkSlots) || 0)) };
      }
    }
    for (const kind of combat ? ["food", "drink"] : b.actionTypeHrid ? ["drink"] : []) {
      for (let slot = 0; slot < 3; slot++) {
        const from = a[`${kind}ItemHrids`][slot] || null, to = b[`${kind}ItemHrids`][slot] || null;
        if (ignoreEmpty && to === null && slot >= caps[kind]) continue;
        const label = `${kind === "food" ? "食物" : "饮料"} ${slot + 1}`;
        add(kind, slot, label, from, to);
        if (combat) add(`${kind}_trigger`, slot, `${label} · 触发条件`, from ? a.consumableCombatTriggersMap?.[from] || [] : [], to ? b.consumableCombatTriggersMap?.[to] || [] : []);
      }
    }
    return changes;
  }
  app.Core = Object.freeze({ copy, stable, item, validate, name, snapshot, validateSnapshot, importChoices, matchImportNickname, importSolo, exportSimulator, diff, EQUIPMENT });
  if (typeof module !== "undefined" && module.exports) module.exports = app.Core;
})(globalThis);

// ---- game_adapter.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const selector = part => `[class*="LoadoutsPanel_${part}__"]`;
  // Popup libraries hide the background from assistive technology while it
  // remains on screen. That must not detach the active scene and its highlights.
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length && !element.closest('[hidden]'));
  function isCommitted(fiber) {
    if (!fiber) return false;
    let node = fiber;
    const seen = new Set();
    for (let depth = 0; node && depth < 240 && !seen.has(node); depth++) {
      seen.add(node);
      if (!node.return) return Boolean(node.stateNode && node.stateNode.current === node);
      node = node.return;
    }
    return false;
  }
  function hostFiber(element, portalRoot = null, committedOnly = false) {
    const key = Object.getOwnPropertyNames(element).find(key => /^__react(?:Fiber|InternalInstance)\$/.test(key));
    if (key && element[key]) {
      if (!committedOnly) return element[key];
      if (isCommitted(element[key])) return element[key];
      if (isCommitted(element[key].alternate)) return element[key].alternate;
    }
    // Some live pages expose no host expandos. Read only the committed tree,
    // locating this exact DOM node instead of choosing an unrelated controller.
    const container = document.getElementById("root");
    if (!container) return null;
    const roots = [container._reactRootContainer];
    for (const key of Object.getOwnPropertyNames(container)) {
      if (/^__reactContainer\$/.test(key)) roots.push(container[key]);
    }
    const pending = portalRoot ? [portalRoot] : roots.map(root => root?.current || root?._internalRoot?.current || root?.stateNode?.current).filter(Boolean);
    const seen = new Set();
    for (let scanned = 0; pending.length && scanned < 4000; scanned++) {
      const fiber = pending.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (fiber.stateNode === element) return fiber;
      if (fiber.sibling) pending.push(fiber.sibling);
      const node = fiber.stateNode;
      // Skip chat, inventory and other DOM branches, even on very large pages.
      if (!portalRoot && node?.nodeType === 1 && !node.contains(element)) continue;
      if (fiber.child) pending.push(fiber.child);
    }
    return null;
  }
  function visibleLoadoutPanel() {
    const panels = [...document.querySelectorAll(selector("loadoutsPanel"))].filter(visible);
    return panels.length === 1 ? panels[0] : null;
  }
  function loadoutController(panel) {
    let fiber = hostFiber(panel), controller = null;
    if (!fiber) throw Error("无法读取游戏配装数据；请重新打开配装详情，若仍失败请反馈页面版本。");
    const seen = new Set();
    for (let i = 0; fiber && i < 80 && !seen.has(fiber); i++, fiber = fiber.return) {
      seen.add(fiber);
      const instance = fiber.stateNode;
      if (instance?.state && Object.hasOwn(instance.state, "selectedCharacterLoadoutId") && instance.props?.characterLoadoutDict) {
        if (controller && controller !== instance) throw Error("检测到多个配装上下文，已停止读取。");
        controller = instance;
      }
    }
    return controller;
  }
  function current() {
    const overview = app.Overview?.currentScene?.();
    if (overview) return overview;
    const panel = visibleLoadoutPanel();
    if (!panel) return null;
    const details = panel.querySelector(selector("details")), setup = panel.querySelector(selector("setup"));
    if (!visible(details) || !visible(setup) || details.closest("[data-mwi-loadout-overview]")) return null;
    const controller = loadoutController(panel);
    if (!controller) throw Error("原生配装数据尚未就绪，请重新打开配装。");
    const props = controller.props, id = controller.state.selectedCharacterLoadoutId;
    const characterId = props.characterInfo?.characterID;
    if (!Number.isSafeInteger(characterId) || characterId <= 0) throw Error("无法确认当前角色，已停止保存。");
    const raw = app.Core.validate(props.characterLoadoutDict[id]);
    if (raw.id !== id) throw Error("原生配装选择尚未同步，请稍后重试。");
    const owner = `${location.origin}|${characterId}`, scope = `${owner}|${raw.id}`;
    return { raw, owner, scope, panel, details, setup, props };
  }
  function translate(ctx, group, hrid) {
    if (!hrid) return "空槽";
    const key = `${group}.${hrid}`;
    try {
      const translated = ctx?.props?.t?.(key);
      if (typeof translated === "string" && translated !== key) return translated;
    } catch (_) { /* A missing translation must not prevent comparison. */ }
    return hrid.split("/").pop();
  }
  function triggersText(ctx, triggers) {
    if (!triggers.length) return "冷却结束即使用（无附加条件）";
    return triggers.map(t => [translate(ctx, "combatTriggerDependencyNames", t.dependencyHrid),
      translate(ctx, "combatTriggerConditionNames", t.conditionHrid),
      translate(ctx, "combatTriggerComparatorNames", t.comparatorHrid), String(t.value)].join(" ")).join("；并且 ");
  }
  function describe(ctx, change, value) {
    if (change.kind === "setting") return value ? "指定强化等级" : "使用最高强化等级";
    if (change.kind.endsWith("_trigger")) return triggersText(ctx, value);
    if (!value) return "空槽";
    if (typeof value === "string") return translate(ctx, change.kind === "ability" ? "abilityNames" : "itemNames", value);
    return translate(ctx, "itemNames", value.itemHrid) + (Object.hasOwn(value, "enhancementLevel") ? ` +${value.enhancementLevel}` : "（最高强化）");
  }
  function fibers(element, select) {
    let fiber = hostFiber(element);
    for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
      for (const props of [fiber.stateNode?.props, fiber.memoizedProps]) {
        if (props && select(props)) return true;
      }
    }
    return false;
  }
  function target(ctx, change) {
    if (change.kind === "setting") return [...ctx.details.querySelectorAll('input[type="checkbox"]')].find(input =>
      fibers(input, props => props.checked === !ctx.raw.useExactEnhancement &&
        typeof props.label === "string" && /最高|Highest/i.test(props.label)))?.closest("label") || ctx.details.querySelectorAll(selector("metadata"))[3] || ctx.setup;
    const kind = change.kind.replace(/_trigger$/, "");
    if (kind === "equipment") {
      const slots = ctx.setup.querySelector(selector("playerModel"));
      if (!slots) return null;
      const position = { back: [1,1], head: [1,2], trinket: [1,3], main_hand: [2,1], off_hand: [2,3], body: [2,2],
        hands: [3,1], legs: [3,2], pouch: [3,3], feet: [4,2], neck: [1,5], earrings: [2,5], ring: [3,5], charm: [4,5],
        milking_tool: [7,1], foraging_tool: [7,2], woodcutting_tool: [7,3], cheesesmithing_tool: [7,4], crafting_tool: [7,5],
        tailoring_tool: [8,1], cooking_tool: [8,2], brewing_tool: [8,3], alchemy_tool: [8,4], enhancing_tool: [8,5] }[change.slot];
      if (!position) return null;
      const row = position[0] - (ctx.overview && change.slot.endsWith("_tool") ? 1 : 0);
      return [...slots.children].find(el => el.style.gridRowStart === String(row) && el.style.gridColumnStart === String(position[1])) || null;
    }
    const container = ctx.setup.querySelector(selector(kind === "ability" ? "abilities" : "consumables"));
    if (!container) return null;
    const candidates = [...container.children].filter(el => fibers(el, props => kind === "ability"
      ? props.slotNumber === change.slot
      : props.slotIndex === change.slot && props.consumableSlotTypeHrid === `/consumable_slot_types/${kind}`));
    if (candidates.length !== 1) return null;
    if (change.kind.endsWith("_trigger")) {
      return candidates[0].querySelector('[class*="CombatTriggersSetting_settingButton__"]') ||
        candidates[0].querySelector('[class*="CombatTriggersSetting_combatTriggersSetting__"]') ||
        candidates[0];
    }
    return candidates[0];
  }
  // Match only choices in a visible picker belonging to the changed native slot.
  // Item identity comes from component props, never translated labels or icon URLs.
  let lastPickerMatches = [];
  const prefilledTriggerRows = new WeakMap();
  const triggerFieldOrder = ["dependencyHrid", "conditionHrid", "comparatorHrid"];
  function pickerPath(scopeFiber, list) {
    const pending = scopeFiber ? [{ fiber: scopeFiber, parent: null }] : [], seen = new Set();
    for (let count = 0; pending.length && count < 30000; count++) {
      const entry = pending.pop(), { fiber, parent } = entry;
      if (seen.has(fiber)) continue;
      seen.add(fiber);
      if (fiber.stateNode === list) {
        const path = [];
        for (let node = entry; node; node = node.parent) path.push(node.fiber);
        return path;
      }
      // Do not leave this setup via its siblings. Record the downward path:
      // reused React children can have return pointers into an old alternate.
      if (fiber !== scopeFiber && fiber.sibling) pending.push({ fiber: fiber.sibling, parent });
      if (fiber.child && fiber.stateNode?.namespaceURI !== "http://www.w3.org/2000/svg") {
        pending.push({ fiber: fiber.child, parent: entry });
      }
    }
    return null;
  }
  function matchesChoice(props, ability, change, itemTarget) {
    if (!props) return false;
    if (ability) {
      const id = props.abilityHrid || props.ability?.abilityHrid;
      return id === change.to;
    }
    const item = props.itemHrid ? props : (props.item?.itemHrid ? props.item : props.characterItem?.itemHrid ? props.characterItem : null);
    if (!item || item.itemHrid !== itemTarget.itemHrid) return false;
    return !Object.hasOwn(itemTarget, "enhancementLevel") || (item.enhancementLevel ?? 0) === itemTarget.enhancementLevel;
  }
  function resolveScope(ctx) {
    let scope = ctx.setup || ctx.panel;
    if (!visible(scope)) return null;
    let scopeFiber = hostFiber(scope, null, true);
    if (!scopeFiber && !ctx.overview && scope !== ctx.panel) {
      scope = ctx.panel;
      scopeFiber = hostFiber(scope, null, true);
    }
    return { scope, scopeFiber };
  }
  function triggerRowText(ctx, trigger, includeValue = true) {
    const parts = [
      translate(ctx, "combatTriggerDependencyNames", trigger.dependencyHrid),
      translate(ctx, "combatTriggerConditionNames", trigger.conditionHrid),
      translate(ctx, "combatTriggerComparatorNames", trigger.comparatorHrid)
    ];
    if (includeValue) parts.push(String(trigger.value));
    return parts.join(" · ");
  }
  function findOptionByValue(listbox, targetValue) {
    const options = [...listbox.querySelectorAll('[role="option"], li')].filter(visible);
    for (const option of options) {
      if (option.dataset?.value === targetValue || option.getAttribute("data-value") === targetValue) return option;
      const fiber = hostFiber(option);
      let node = fiber;
      for (let depth = 0; node && depth < 8; depth++, node = node.return) {
        const props = node.memoizedProps || node.stateNode?.props;
        if (props?.value === targetValue) return option;
      }
    }
    return null;
  }
  function inspectTriggerMenus(ctx, changes, scope, scopeFiber, targets, prefilled, scrollTargets, guides) {
    const menus = [...document.querySelectorAll('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]')].filter(visible);
    if (!menus.length) return;
    const listboxes = [...document.querySelectorAll('ul[role="listbox"]')].filter(visible);
    for (const editMenu of menus) {
      const path = pickerPath(scopeFiber, editMenu);
      if (!path) continue;
      const editMenuFiber = path[0];
      const ancestors = new Set();
      let controller = null, ownerSlot = null;
      for (const owner of path) {
        ancestors.add(owner.stateNode);
        if (!controller && owner.stateNode && Array.isArray(owner.stateNode.state?.combatTriggers) &&
            typeof owner.stateNode.setState === "function") {
          controller = owner.stateNode;
        }
        const props = owner.memoizedProps || owner.stateNode?.props;
        if (!ownerSlot && props) {
          if (Number.isInteger(props.slotNumber)) {
            ownerSlot = { kind: "ability_trigger", baseKind: "ability", slot: props.slotNumber };
          } else if (Number.isInteger(props.slotIndex) &&
              ["/consumable_slot_types/food", "/consumable_slot_types/drink"].includes(props.consumableSlotTypeHrid)) {
            const baseKind = props.consumableSlotTypeHrid.split("/").pop();
            ownerSlot = { kind: `${baseKind}_trigger`, baseKind, slot: props.slotIndex };
          }
        }
      }
      if (!ancestors.has(scope) || !controller || !ownerSlot) continue;
      const labelNode = editMenu.querySelector('[class*="CombatTriggersSetting_label__"]');
      const baseChange = changes.find(change => change.kind === ownerSlot.baseKind && change.slot === ownerSlot.slot);
      const triggerChange = changes.find(change => change.kind === ownerSlot.kind && change.slot === ownerSlot.slot);
      if (baseChange) {
        const goalName = describe(ctx, baseChange, baseChange.to);
        guides.push({
          host: editMenu, after: labelNode, kind: "trigger", state: "warn",
          key: `base:${baseChange.kind}:${baseChange.slot}:${goalName}`,
          title: `请先将槽位更换为「${goalName}」，再设置触发条件`
        });
        continue;
      }
      if (!triggerChange) continue;
      const targetTriggers = Array.isArray(triggerChange.to) ? triggerChange.to : [];
      const currentTriggers = controller.state.combatTriggers;
      const rowEls = [...editMenu.querySelectorAll('[class*="CombatTriggersSetting_combatTrigger__"]')];
      let rowMap = prefilledTriggerRows.get(editMenu);
      if (!rowMap) { rowMap = new Map(); prefilledTriggerRows.set(editMenu, rowMap); }
      const prefills = [], activePrefillRows = new Set();
      for (let i = 0; i < Math.min(currentTriggers.length, targetTriggers.length); i++) {
        const cur = currentTriggers[i], tgt = targetTriggers[i], rowEl = rowEls[i];
        if (!cur || !tgt || !rowEl) continue;
        if (cur.dependencyHrid !== tgt.dependencyHrid || cur.conditionHrid !== tgt.conditionHrid ||
            cur.comparatorHrid !== tgt.comparatorHrid) continue;
        const valInput = rowEl.querySelector('[class*="CombatTriggersSetting_valueInputContainer__"] input');
        if (!valInput) continue;
        const sig = `${ctx.scope}|${triggerChange.kind}|${triggerChange.slot}|${cur.dependencyHrid}|${cur.conditionHrid}|${cur.comparatorHrid}|${tgt.value}`;
        const curEmpty = cur.value === "" || cur.value === null || cur.value === undefined;
        const curMatches = !curEmpty && Number(cur.value) === Number(tgt.value);
        if (!curMatches && rowMap.get(i) !== sig) {
          rowMap.set(i, sig);
          prefills.push({ index: i, value: tgt.value });
          activePrefillRows.add(i);
        } else if (curMatches && rowMap.get(i) === sig) {
          activePrefillRows.add(i);
        }
      }
      let effectiveTriggers = currentTriggers;
      if (prefills.length) {
        effectiveTriggers = currentTriggers.map((item, idx) => {
          const hit = prefills.find(entry => entry.index === idx);
          return hit ? { ...item, value: hit.value } : { ...item };
        });
        controller.setState({ combatTriggers: effectiveTriggers });
      }
      const guideRows = [];
      let allRowsDone = effectiveTriggers.length === targetTriggers.length;
      const openSelectTarget = { row: -1, field: null, controls: null };
      for (let i = 0; i < Math.max(effectiveTriggers.length, targetTriggers.length); i++) {
        const rowEl = rowEls[i];
        const inputsWrap = rowEl?.querySelector('[class*="CombatTriggersSetting_inputs__"]');
        const controls = inputsWrap ? [...inputsWrap.children] : [];
        if (i < targetTriggers.length) {
          const cur = effectiveTriggers[i], tgt = targetTriggers[i];
          const valBox = rowEl?.querySelector('[class*="CombatTriggersSetting_valueInputContainer__"]');
          const hasValInput = Boolean(valBox?.querySelector("input"));
          const depOk = Boolean(cur && cur.dependencyHrid === tgt.dependencyHrid);
          const condOk = depOk && cur.conditionHrid === tgt.conditionHrid;
          const compOk = condOk && cur.comparatorHrid === tgt.comparatorHrid;
          const curEmpty = !cur || cur.value === "" || cur.value === null || cur.value === undefined;
          const valOk = compOk && (!hasValInput || (!curEmpty && Number(cur.value) === Number(tgt.value)));
          const rowDone = depOk && condOk && compOk && valOk;
          if (!rowDone) allRowsDone = false;
          const showVal = !compOk || hasValInput;
          guideRows.push({
            text: `${i + 1}. ${triggerRowText(ctx, tgt, showVal)}`,
            done: rowDone,
            prefilled: Boolean(rowDone && hasValInput && activePrefillRows.has(i))
          });
          if (rowEl && !rowDone) {
            if (!depOk && controls[0]) targets.push(controls[0]);
            else if (!condOk && controls[1]) targets.push(controls[1]);
            else if (!compOk && controls[2]) targets.push(controls[2]);
            else if (!valOk && valBox) targets.push(valBox);
          } else if (rowDone && hasValInput && activePrefillRows.has(i) && valBox) {
            prefilled.push(valBox);
          }
          for (let cIdx = 0; cIdx < 3; cIdx++) {
            const expanded = controls[cIdx]?.querySelector('[aria-expanded="true"]');
            if (expanded) {
              openSelectTarget.row = i;
              openSelectTarget.field = triggerFieldOrder[cIdx];
              openSelectTarget.controls = expanded.getAttribute("aria-controls") || "";
            }
          }
        } else if (rowEl) {
          allRowsDone = false;
          const removeBtn = rowEl.querySelector('[class*="CombatTriggersSetting_removeButtonContainer__"] button') ||
            rowEl.querySelector('[class*="CombatTriggersSetting_removeButtonContainer__"]');
          if (removeBtn) targets.push(removeBtn);
        }
      }
      if (effectiveTriggers.length < targetTriggers.length && effectiveTriggers.length < 4) {
        const addBtn = editMenu.querySelector('[class*="CombatTriggersSetting_buttonContainer__"] button');
        if (addBtn && !addBtn.disabled) targets.push(addBtn);
      }
      if (allRowsDone) {
        const saveBtn = [...editMenu.children].find(node => node.tagName === "BUTTON" && !node.disabled);
        if (saveBtn) targets.push(saveBtn);
      }
      for (const listbox of listboxes) {
        let rowIdx = -1, field = null;
        if (openSelectTarget.row >= 0 && openSelectTarget.field &&
            (!openSelectTarget.controls || listbox.id === openSelectTarget.controls ||
              listbox.closest(`[id="${openSelectTarget.controls.replace(/"/g, '\\"')}"]`) || listboxes.length === 1)) {
          rowIdx = openSelectTarget.row;
          field = openSelectTarget.field;
        } else {
          const lbPath = pickerPath(editMenuFiber, listbox);
          if (lbPath) {
            const lbAncestors = new Set(lbPath.map(f => f.stateNode));
            for (let i = 0; i < rowEls.length && rowIdx < 0; i++) {
              const inputsWrap = rowEls[i]?.querySelector('[class*="CombatTriggersSetting_inputs__"]');
              const controls = inputsWrap ? [...inputsWrap.children] : [];
              for (let cIdx = 0; cIdx < 3; cIdx++) {
                if (controls[cIdx] && lbAncestors.has(controls[cIdx])) {
                  rowIdx = i;
                  field = triggerFieldOrder[cIdx];
                  break;
                }
              }
            }
          }
        }
        if (rowIdx >= 0 && field && targetTriggers[rowIdx]?.[field]) {
          const tgtVal = targetTriggers[rowIdx][field];
          const option = findOptionByValue(listbox, tgtVal);
          if (option) {
            targets.push(option);
            scrollTargets.push({ container: listbox, node: option, key: `opt:${rowIdx}:${field}:${tgtVal}` });
          }
        }
      }
      guides.push({
        host: editMenu, after: labelNode, kind: "trigger",
        state: allRowsDone ? "ready" : "guide",
        key: JSON.stringify([allRowsDone, targetTriggers.length, guideRows]),
        title: allRowsDone
          ? "已与子方案一致，点击下方「保存」生效"
          : targetTriggers.length ? "子方案目标触发条件" : "目标：冷却结束即使用（移除下方条件后保存）",
        rows: guideRows
      });
    }
  }
  function pickerGuidance(ctx, changes) {
    const targets = [], prefilled = [], scrollTargets = [], guides = [], matches = [];
    const desired = changes.filter(change => ["equipment", "ability", "food", "drink"].includes(change.kind));
    const lists = [...document.querySelectorAll('[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"]')].filter(visible);
    const hasTriggerMenus = Boolean(document.querySelector('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]'));
    if ((!desired.length || !lists.length) && !hasTriggerMenus) {
      lastPickerMatches = [];
      return { targets, prefilled, scrollTargets, guides };
    }
    // Host expandos may retain an alternate from before a popup opened or its
    // filter changed. Traverse only the committed tree of this card's setup.
    const resolved = resolveScope(ctx);
    if (!resolved) {
      lastPickerMatches = [];
      return { targets, prefilled, scrollTargets, guides };
    }
    const { scope, scopeFiber } = resolved;
    const changeKeys = new Set(desired.map(change => app.Core.stable(change)));
    for (const list of lists) {
      const ability = list.className.includes("AbilitySlot_");
      const path = pickerPath(scopeFiber, list);
      if (!path) {
        // A commit can briefly expose the DOM before its readable tree. Keep
        // only previously verified, unchanged choices in this same open list.
        // Changed targets, replaced/reused content and closed lists never survive.
        for (const prior of lastPickerMatches) {
          if (prior.list === list && prior.scope === ctx.scope && prior.setup === scope && visible(scope) &&
              changeKeys.has(prior.changeKey) && prior.node.parentElement === list && visible(prior.node) &&
              prior.node.className === prior.className && prior.node.innerHTML === prior.html) {
            targets.push(prior.node); matches.push(prior);
          }
        }
        continue;
      }
      const listFiber = path[0];
      const ancestors = new Set(); let ownerSlot = null;
      for (const owner of path) {
        ancestors.add(owner.stateNode);
        const props = owner.memoizedProps || owner.stateNode?.props;
        // Read the slot owner from the same committed portal branch. Searching
        // the background slot's DOM expando can still return an old alternate.
        if (!ownerSlot && props) {
          if (ability && Number.isInteger(props.slotNumber)) ownerSlot = { kind: "ability", slot: props.slotNumber };
          if (!ability && Number.isInteger(props.slotIndex) &&
              ["/consumable_slot_types/food", "/consumable_slot_types/drink"].includes(props.consumableSlotTypeHrid))
            ownerSlot = { kind: props.consumableSlotTypeHrid.split("/").pop(), slot: props.slotIndex };
        }
      }
      if (!ancestors.has(scope)) continue;
      const matching = changes.filter(change =>
        (ability ? change.kind === "ability" : ["equipment", "food", "drink"].includes(change.kind)) &&
        (ownerSlot ? change.kind === ownerSlot.kind && change.slot === ownerSlot.slot : ancestors.has(target(ctx, change))));
      if (matching.length !== 1) continue;
      const change = matching[0];
      const changeKey = app.Core.stable(change);
      let matchedAny = false, blockedMatch = false;
      if (change.to === null) {
        for (const choice of list.children) {
          if (!visible(choice)) continue;
          if (/removeButton/.test(choice.className)) {
            matchedAny = true;
            targets.push(choice);
            scrollTargets.push({ container: list, node: choice, key: changeKey });
            matches.push({ node: choice, list, scope: ctx.scope, setup: scope,
              changeKey, className: choice.className, html: choice.innerHTML });
          }
        }
      } else {
        const itemTarget = change.kind === "equipment" ? change.to : { itemHrid: change.to };
        // Index direct choice elements without descending into their subtrees so
        // large pickers (100+ items) never starve early options, and retain each
        // choice's exclusive component wrappers strictly below listFiber.
        const choiceSet = new Set(list.children), hosts = new Map(), wrapperUse = new Map();
        const queue = listFiber?.child ? [{ fiber: listFiber.child, wrappers: [] }] : [], visited = new Set();
        for (let count = 0; queue.length && count < 30000; count++) {
          const { fiber, wrappers } = queue.pop(); if (!fiber || visited.has(fiber)) continue; visited.add(fiber);
          if (fiber.sibling) queue.push({ fiber: fiber.sibling, wrappers });
          if (fiber.stateNode?.nodeType === 1) {
            if (choiceSet.has(fiber.stateNode)) {
              hosts.set(fiber.stateNode, { fiber, wrappers });
              for (const wrapper of wrappers) wrapperUse.set(wrapper, (wrapperUse.get(wrapper) || 0) + 1);
              continue;
            }
            if (fiber.stateNode.namespaceURI === "http://www.w3.org/2000/svg") continue;
          }
          if (fiber.child) {
            const nextWrappers = fiber.stateNode?.nodeType === 1 ? wrappers : [...wrappers, fiber];
            queue.push({ fiber: fiber.child, wrappers: nextWrappers });
          }
        }
        const multi = list.children.length > 1;
        for (const choice of list.children) {
          if (!visible(choice)) continue;
          const disabledChoice = /insufficient|requirementsNotMet/.test(choice.className);
          const entry = hosts.get(choice);
          let match = false;
          if (entry) {
            for (const wrapper of entry.wrappers) {
              if (multi && (wrapperUse.get(wrapper) || 0) > 1) continue;
              if (matchesChoice(wrapper.memoizedProps || wrapper.stateNode?.props, ability, change, itemTarget)) {
                match = true; break;
              }
            }
            if (!match) {
              const first = entry.fiber, pending = [first], seen = new Set();
              for (let count = 0; pending.length && count < 400; count++) {
                const fiber = pending.pop(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
                if (matchesChoice(fiber.memoizedProps || fiber.stateNode?.props, ability, change, itemTarget)) {
                  match = true; break;
                }
                if (fiber.child && fiber.stateNode?.namespaceURI !== "http://www.w3.org/2000/svg") pending.push(fiber.child);
                if (fiber !== first && fiber.sibling) pending.push(fiber.sibling);
              }
            }
          }
          if (match) {
            if (disabledChoice) { blockedMatch = true; continue; }
            matchedAny = true;
            targets.push(choice);
            scrollTargets.push({ container: list, node: choice, key: changeKey });
            matches.push({ node: choice, list, scope: ctx.scope, setup: scope,
              changeKey, className: choice.className, html: choice.innerHTML });
          }
        }
      }
      const menuHost = list.closest('[class*="ItemSelector_menu__"], [class*="AbilitySlot_abilitySelector__"]');
      if (menuHost) {
        const goalLabel = change.to === null ? "清空槽位（点「移除」）" : describe(ctx, change, change.to);
        const title = matchedAny
          ? `目标：${goalLabel}`
          : `目标：${goalLabel}（${blockedMatch ? "数量不足或未满足等级要求" : "当前列表暂无可选项"}）`;
        guides.push({
          host: menuHost, after: null, kind: "picker",
          state: matchedAny ? "guide" : "warn",
          key: `${changeKey}:${matchedAny}:${blockedMatch}:${title}`,
          title
        });
      }
    }
    lastPickerMatches = matches;
    if (hasTriggerMenus) inspectTriggerMenus(ctx, changes, scope, scopeFiber, targets, prefilled, scrollTargets, guides);
    return { targets, prefilled, scrollTargets, guides };
  }
  function pickerTargets(ctx, changes) {
    return pickerGuidance(ctx, changes).targets;
  }
  function actionContexts() {
    const contexts = [];
    for (const panel of document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail__"]')) {
      // MUI temporarily sets aria-hidden on the background while its menu is open.
      if (!panel.isConnected || !panel.getClientRects().length || panel.closest('[hidden]')) continue;
      const dropdown = panel.querySelector('[class*="SkillActionDetail_loadoutDropdown__"]');
      if (!dropdown?.getClientRects().length) continue;
      let fiber = hostFiber(panel);
      const seen = new Set();
      for (let depth = 0; fiber && depth < 80 && !seen.has(fiber); depth++, fiber = fiber.return) {
        seen.add(fiber);
        const controller = fiber.stateNode;
        if (controller?.props?.actionDetail && Array.isArray(controller.state?.loadoutOptions) &&
            typeof controller.loadoutSelected === "function" && typeof controller.setState === "function") {
          contexts.push({ panel, dropdown, controller }); break;
        }
      }
    }
    return contexts;
  }
  function cloudContext(listLoadouts = true) {
    let character, dict;
    const host = document.querySelector('[class*="GamePage_gamePage"]');
    let fiber = host && hostFiber(host);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const state = fiber.stateNode?.state;
      if (state?.characterItemMap && state.character) {
        if (state.isLoading || state.isFullDisconnected) return null;
        character = state.character.id;
        dict = state.characterLoadoutDict;
        break;
      }
    }
    if (!character || listLoadouts && !dict) {
      const panel = visibleLoadoutPanel();
      const props = (panel ? loadoutController(panel) : actionContexts()[0]?.controller)?.props;
      if (!character || props?.characterInfo?.characterID === character) {
        character = props?.characterInfo?.characterID;
        dict = props?.characterLoadoutDict;
      }
    }
    if (!Number.isSafeInteger(character) || character <= 0) return null;
    if (!listLoadouts) return { character };
    const loadoutIds = Object.values(dict || {}).map(row => row?.id).filter(id => Number.isSafeInteger(id) && id > 0);
    return { character, loadoutIds: dict ? loadoutIds : null, loadouts: dict };
  }
  function currentCharacterName(ctx) {
    const expected = ctx?.props?.characterInfo?.characterID;
    if (!Number.isSafeInteger(expected) || expected <= 0) return "";
    const host = document.querySelector('[class*="GamePage_gamePage"]');
    let fiber = host && hostFiber(host);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const state = fiber.stateNode?.state;
      if (state?.characterItemMap && state.character) {
        if (state.isLoading || state.isFullDisconnected || state.character.id !== expected) return "";
        return typeof state.character.name === "string" ? state.character.name : "";
      }
    }
    return "";
  }
  function nativeSnapshot(character, id) {
    const ctx = cloudContext();
    if (ctx?.character !== character || ctx.loadouts?.[id]?.id !== id)
      throw Error("当前原生配装尚未完整加载，请稍后重试。");
    return app.Core.snapshot(ctx.loadouts[id]);
  }
  app.Adapter = Object.freeze({ currentCharacterName, nativeSnapshot, cloudContext, current, describe, target, pickerTargets, pickerGuidance, actionContexts, visibleLoadoutPanel, loadoutController });
})(globalThis);

// ---- scene_store.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  let opening;
  const listeners = new Set();
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function notifyLocal(scope) {
    for (const fn of listeners) {
      try { fn(scope); } catch (_) { /* Listener errors must not affect storage commits. */ }
    }
  }
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
      tx.oncomplete = () => {
        if (mode === "readwrite") notifyLocal(scope);
        resolve(result);
      };
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
  async function create(ctx, title, expected = null) {
    const row = record(ctx, title, ctx.raw);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const matches = rows.filter(old => !old.removedAt && old.name === row.name);
      if (matches.length > 1) throw Error("有多个同名子方案，请先改名后再保存。");
      const before = matches[0];
      if (before) {
        if (!expected || expected.id !== before.id || expected.revision !== before.revision)
          throw Object.assign(Error(`再次点击将覆盖“${row.name}”。`), { code: "NAME_EXISTS", existing: before });
        const updated = { ...revise(before), snapshot: row.snapshot };
        store.put(updated); return updated;
      }
      if (expected) throw Error("待覆盖的子方案已变化，请重新保存。");
      store.add(row); return row;
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
  async function importBackup(ctx, text, expected = []) {
    const incoming = parseBackup(text, ctx);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const active = rows.filter(row => !row.removedAt), added = [], updated = [], conflicts = [], names = new Set();
      for (const row of incoming) {
        if (names.has(row.name)) throw Error("备份中有重复名称，请先区分名称再导入。");
        names.add(row.name);
        if (active.some(old => old.name === row.name && Core().stable(old.snapshot) === Core().stable(row.snapshot))) continue;
        const matches = active.filter(old => old.name === row.name);
        if (matches.length > 1) throw Error("本地有多个同名子方案，请先改名再导入。");
        if (matches.length) {
          conflicts.push(matches[0]);
          updated.push({ ...revise(matches[0]), snapshot: row.snapshot });
        } else added.push(row);
      }
      const signature = list => Core().stable(list.map(row => [row.id, row.revision]).sort());
      if (signature(conflicts) !== signature(expected)) {
        if (!conflicts.length) throw Error("待覆盖的子方案已变化，请重新选择备份。");
        throw Object.assign(Error("再次点击将覆盖备份中的同名子方案。"), { code: "NAME_EXISTS", existing: conflicts });
      }
      for (const row of added) store.add(row);
      for (const row of updated) store.put(row);
      return added.length + updated.length;
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
  async function counts(owner) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("scenes", "readonly"), store = tx.objectStore("scenes");
      const request = store.getAll();
      const result = new Map();
      request.onsuccess = () => {
        for (const row of request.result) {
          if (row.owner === owner && !row.removedAt) {
            result.set(row.parentId, (result.get(row.parentId) || 0) + 1);
          }
        }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(Error("无法读取子方案数量。"));
    });
  }
  app.Store = Object.freeze({ resolveConflict, mergeCloud, counts, subscribe, list: scope => transaction(scope, "readonly", rows => rows), create, mutate, importBackup,
    exportBackup: (ctx, rows) => JSON.stringify({ format: "mwi-layu-loadout-scenes", schemaVersion: 1, scope: ctx.scope,
      scenes: rows.filter(row => !row.removedAt).map(({ name, snapshot }) => ({ name, snapshot })) }, null, 2) });
})(globalThis);

// ---- action_memory.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const prefix = "mwi-layu:action-loadouts:v1:";
  const field = "selectedCharacterLoadoutId";
  const sessions = new Map();
  // Only keep keys for one character. Values are read at export time so a
  // queued storage event cannot publish an obsolete selection for a known key.
  let cloudIndex = null;
  root.addEventListener?.("storage", event => {
    if (event.key === null || event.key.startsWith(prefix)) cloudIndex = null;
  });
  const id = value => Number.isSafeInteger(value) && value >= 0;
  function scope(props, state) {
    const action = props?.actionDetail, character = props?.characterInfo?.characterID;
    if (!Number.isSafeInteger(character) || character <= 0 ||
        typeof action?.hrid !== "string" || !action.hrid.startsWith("/actions/") ||
        typeof action.type !== "string" || !action.type.startsWith("/action_types/") ||
        state?.actionDetail?.hrid !== action.hrid || !Array.isArray(state.loadoutOptions)) return null;
    return prefix + JSON.stringify([location.origin, character, action.type, action.hrid]);
  }
  function available(props, state, value) {
    if (!id(value) || !state.loadoutOptions.some(option => option.value === value && !option.disabled)) return false;
    if (value === 0) return true;
    const loadout = props.characterLoadoutDict?.[value];
    return loadout?.id === value && (loadout.actionTypeHrid === "" || loadout.actionTypeHrid === props.actionDetail.type);
  }
  function notice(session, text) {
    if (!session.panel.isConnected) return;
    if (!session.notice) {
      session.notice = document.createElement("small");
      session.notice.setAttribute("role", "status");
      session.notice.setAttribute("data-mwi-action-memory-status", "");
      session.panel.append(session.notice);
    }
    session.notice.textContent = text;
  }
  function clearNotice(session) { session.notice?.remove(); session.notice = null; }
  function read(key) {
    const text = localStorage.getItem(key);
    if (text === null) return null;
    const row = JSON.parse(text);
    if (row?.version !== 1 || !id(row.loadoutId)) throw Error("invalid record");
    return row;
  }
  function remember(session, key, value) {
    try {
      let previous;
      try { previous = read(key); } catch (_) { /* An explicit choice repairs a malformed local preference. */ }
      const updatedAt = Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
      localStorage.setItem(key, JSON.stringify({ version: 1, loadoutId: value, updatedAt }));
      cloudIndex = null;
      const character = session.controller.props.characterInfo.characterID;
      app.Cloud?.changed(character, value);
      if (previous && previous.loadoutId !== value) app.Cloud?.changed(character, previous.loadoutId);
      clearNotice(session);
    } catch (_) { notice(session, "没能记住这次配装。当前选择仍可使用，请检查浏览器存储权限或空间后重新选择。"); }
  }
  function detach(session) {
    session.active = false;
    const controller = session.controller;
    if (controller.setState === session.wrapper) {
      if (session.descriptor) Object.defineProperty(controller, "setState", session.descriptor);
      else delete controller.setState;
    }
    clearNotice(session);
    sessions.delete(controller);
  }
  function attach(ctx) {
    const controller = ctx.controller;
    const session = { ...ctx, active: true, key: null, revision: 0,
      original: controller.setState, descriptor: Object.getOwnPropertyDescriptor(controller, "setState") };
    // The native selection handler writes exactly this one field. Full initial
    // states/default recomputations must never replace an explicit preference.
    session.wrapper = function (patch, callback) {
      const key = session.active && scope(this.props, this.state);
      const selection = this === controller && key && patch && typeof patch === "object" &&
        Object.keys(patch).length === 1 && Object.hasOwn(patch, field) && available(this.props, this.state, patch[field]);
      if (selection) { session.key = key; session.revision++; }
      const result = session.original.call(this, patch, callback);
      if (selection) remember(session, key, patch[field]);
      return result;
    };
    controller.setState = session.wrapper;
    sessions.set(controller, session);
    return session;
  }
  function restore(session) {
    const controller = session.controller, key = scope(controller.props, controller.state);
    if (!key || !controller.state.loadoutOptions.length) return;
    if (session.key === key) return;
    session.key = key;
    clearNotice(session);
    let row;
    try { row = read(key); }
    catch (_) { notice(session, "没能读取记住的配装，请手动选择；重新选择后会尝试保存。"); return; }
    if (!row) return;
    if (!available(controller.props, controller.state, row.loadoutId)) {
      notice(session, "上次选择的配装已不可用，请重新选择。"); return;
    }
    const revision = session.revision;
    // Use the original state setter, not a game action handler. Revalidate when
    // React processes the queued update so a later user selection always wins.
    session.original.call(controller, (state, props) => {
      if (!session.active || session.revision !== revision || scope(props, state) !== key ||
          !session.panel.isConnected || !session.panel.getClientRects().length ||
          !available(props, state, row.loadoutId) || state[field] === row.loadoutId) return null;
      return { [field]: row.loadoutId };
    });
  }
  function tick() {
    const contexts = app.Adapter.actionContexts(), active = new Set(contexts.map(ctx => ctx.controller));
    for (const session of sessions.values()) {
      const ctx = contexts.find(ctx => ctx.controller === session.controller);
      if (!active.has(session.controller) || ctx.panel !== session.panel) detach(session);
    }
    for (const ctx of contexts) {
      try {
        const session = sessions.get(ctx.controller) || attach(ctx);
        session.dropdown = ctx.dropdown;
        restore(session);
      }
      catch (_) { /* An incompatible/frozen native component must remain usable. */ }
    }
  }
  function reselect(event) {
    // MUI does not emit onChange when the already-selected option is chosen.
    // Bind its portal to this exact dropdown; never infer from translated text.
    if (!event.isTrusted) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const option = event.target.closest?.('[role="option"]');
    const menu = option?.closest('[role="listbox"]');
    const value = option?.getAttribute("data-value");
    if (!menu?.id || !/^\d+$/.test(value || "") || option.getAttribute("aria-disabled") === "true") return;
    tick();
    for (const session of sessions.values()) {
      const controls = [...session.dropdown.querySelectorAll('[aria-controls], [aria-owns]')];
      if (!controls.some(node => [node.getAttribute("aria-controls"), node.getAttribute("aria-owns")]
        .some(ids => ids?.split(/\s+/).includes(menu.id)))) continue;
      const { props, state } = session.controller, key = scope(props, state), selected = Number(value);
      if (key && selected === state[field] && available(props, state, selected)) {
        session.key = key; session.revision++;
        remember(session, key, selected);
      }
    }
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; tick(); });
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    // Capture before the first menu interaction, including portals and keyboard use.
    document.addEventListener("pointerdown", tick, true);
    document.addEventListener("keydown", tick, true);
    document.addEventListener("keydown", reselect, true);
    document.addEventListener("click", reselect, true);
    document.addEventListener("visibilitychange", tick);
    tick(); setInterval(tick, 650);
  }
  function keysByLoadout(character) {
    const now = Date.now();
    if (cloudIndex?.character === character && now < cloudIndex.expires) return cloudIndex.groups;
    const groups = new Map();
    const base = prefix + JSON.stringify([location.origin, character]).slice(0, -1) + ",";
    for (let i = 0, count = localStorage.length; i < count; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(base)) continue;
      let row;
      try { row = JSON.parse(localStorage.getItem(key)); } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      if (row?.version !== 1 || !id(row.loadoutId)) continue;
      if (!groups.has(row.loadoutId)) groups.set(row.loadoutId, new Set());
      groups.get(row.loadoutId).add(key);
    }
    if (root.addEventListener) cloudIndex = { character, groups, expires: now + 30000 };
    return groups;
  }
  function mergeCloud(character, loadoutId, incoming) {
    for (const row of incoming) {
      const key = prefix + JSON.stringify([location.origin, character, row.type, row.action]);
      const before = read(key);
      const updatedAt = before?.updatedAt ?? 0;
      if (before && (updatedAt > row.updatedAt ||
          updatedAt === row.updatedAt && before.loadoutId >= row.loadoutId)) continue;
      localStorage.setItem(key, JSON.stringify({ version: 1, loadoutId: row.loadoutId, updatedAt: row.updatedAt }));
      if (cloudIndex?.character === character) {
        const groups = cloudIndex.groups;
        if (before) groups.get(before.loadoutId)?.delete(key);
        if (!groups.has(loadoutId)) groups.set(loadoutId, new Set());
        groups.get(loadoutId).add(key);
      }
      for (const session of sessions.values()) {
        if (session.key === key) { session.revision++; session.key = null; restore(session); }
      }
    }
    const keys = keysByLoadout(character).get(loadoutId);
    if (!keys) return [];
    const memories = [];
    for (const key of [...keys].sort()) {
      const row = read(key);
      if (row?.loadoutId !== loadoutId) continue;
      const [, , type, action] = JSON.parse(key.slice(prefix.length));
      memories.push({ type, action, loadoutId, updatedAt: row.updatedAt ?? 0 });
    }
    return memories;
  }
  app.ActionMemory = Object.freeze({ start, tick, mergeCloud });
})(globalThis);

// ---- cloud_sync.js ----
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
  const boards = new Map(), urgent = new Set(), routine = new Set(), nativeTimers = new Map();
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
  function observeNative(character, loadoutId, raw) {
    if (!Number.isSafeInteger(character) || character <= 0 || !Number.isSafeInteger(loadoutId) || loadoutId <= 0 || !raw) return;
    const b = board(character, loadoutId);
    if (b.lastRawRef === raw) return;
    b.lastRawRef = raw;
    let key;
    try { key = app.Core.stable(raw); } catch (_) { return; }
    if (b.observedNative == null) { b.observedNative = key; return; }
    if (key === b.observedNative) return;
    b.observedNative = key;
    b.dirty = true;
    if (b.kind === "blocked" || b.kind === "setup") return;
    report(b, online() ? "已存本机，待上传" : "已存本机，等待联网", "pending");
    const name = boardName(character, loadoutId);
    clearTimeout(nativeTimers.get(name));
    nativeTimers.set(name, setTimeout(() => {
      nativeTimers.delete(name);
      if (b.dirty && b.kind !== "blocked" && b.kind !== "setup") enqueue(b, true);
    }, 1500));
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
      enqueue(active, true);
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
    let poll, scanning = false;
    async function scan() {
      if (scanning) return;
      clearTimeout(poll);
      if (document.hidden || !online()) return;
      scanning = true;
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
      finally { scanning = false; poll = setTimeout(scan, delay); }
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
  app.Cloud = Object.freeze({ subscribe, info, conflictPairs, changed, observeNative, request, publishCurrent, setActive, start, synchronize, boardName, parse, mergeScenes,
    status: (character, loadoutId) => boards.get(boardName(character, loadoutId))?.status || "等待同步" });
})(globalThis);

// ---- cloud_ui.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  function formatTime(ts) {
    const date = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function mount(ctx, el, button, resolve, onStateChange) {
    const character = ctx.props.characterInfo.characterID, id = ctx.raw.id;
    const board = app.Cloud.boardName(character, id), url = "https://clipboard.im/" + board;
    const node = el("div", null, { class: "cloud-panel" });

    const top = el("div", null, { class: "cloud-head" });
    const statusWrap = el("div", null, { class: "cloud-status" });
    const dot = el("span", null, { class: "cloud-dot", "aria-hidden": "true" });
    const statusText = el("span", "", { class: "cloud-status-text" });
    statusWrap.append(dot, statusText);

    const sync = button("立即同步", () => app.Cloud.request(character, id), { class: "compact-btn" });
    let copyTimer = null, feedbackTimer = null;
    function showFeedback(text, isError = false) {
      clearTimeout(feedbackTimer);
      feedback.textContent = text;
      feedback.classList.toggle("is-error", isError);
      feedback.hidden = !text;
      if (text) feedbackTimer = setTimeout(() => { feedback.hidden = true; }, isError ? 3600 : 2400);
    }
    const copy = button("复制地址", async () => {
      try {
        await navigator.clipboard.writeText(url);
        clearTimeout(copyTimer);
        copy.textContent = "已复制";
        copy.classList.add("is-copied");
        copyTimer = setTimeout(() => {
          copy.textContent = "复制地址";
          copy.classList.remove("is-copied");
        }, 1800);
      } catch (_) {
        showFeedback("请手动复制下方地址。", true);
      }
    }, { class: "compact-btn ghost-btn copy-btn" });
    const controls = el("div", null, { class: "cloud-actions" });
    controls.append(sync, copy);
    top.append(statusWrap, controls);

    const note = el("p", "", { class: "cloud-note", hidden: "" });
    const feedback = el("p", "", { role: "status", class: "cloud-feedback", hidden: "" });

    const stats = el("div", null, { class: "cloud-stats", "aria-label": "同步概览" });
    const nativeStat = el("span", "", { class: "cloud-stat" });
    const sceneStat = el("span", "", { class: "cloud-stat" });
    const memoryStat = el("span", "", { class: "cloud-stat" });
    const checkedStat = el("span", "", { class: "cloud-stat cloud-stat-time" });
    stats.append(nativeStat, sceneStat, memoryStat, checkedStat);

    const nativeConflict = el("div", null, { class: "cloud-compare cloud-compare-alert", hidden: "" });
    const nativeTitle = el("p", "当前游戏配装与云端不一致（已保留云端）", { class: "cloud-compare-title" });
    const nativeDetails = el("details", null, { class: "cloud-diff-box" });
    const nativeDiff = el("ul", null, { class: "cloud-diff" });
    nativeDetails.append(el("summary", "查看差异"), nativeDiff);
    const nativeConfirm = el("div", null, { class: "cloud-confirm", hidden: "" });
    const nativeConfirmActions = el("div", null, { class: "cloud-actions" });
    nativeConfirmActions.append(
      button("取消", () => { nativeConfirm.hidden = true; nativeChoiceRow.hidden = false; }, { class: "compact-btn" }),
      button("确认更新分享", () => {
        try {
          app.Cloud.publishCurrent(character, id);
          nativeConfirm.hidden = true;
          nativeChoiceRow.hidden = false;
        } catch (error) {
          showFeedback(error.message, true);
        }
      }, { class: "compact-btn primary" })
    );
    nativeConfirm.append(el("p", "确认用当前游戏配装覆盖云端分享？订阅者将收到这份配置。"), nativeConfirmActions);
    const nativeChoiceRow = el("div", null, { class: "cloud-actions" });
    let adoptTimer = null;
    const adoptCloudBtn = button("云端存为子方案", async () => {
      try {
        const snapshot = app.Cloud.info(character, id).nativeSnapshot;
        if (!snapshot) throw Error("暂无云端配装内容，请先核对。");
        await app.Virtual.adopt(character, { snapshot }, ctx.raw, "云端 · " + snapshot.raw.name.slice(0, 50));
        clearTimeout(adoptTimer);
        adoptCloudBtn.textContent = "已存为子方案";
        adoptCloudBtn.classList.add("is-copied");
        adoptTimer = setTimeout(() => {
          adoptCloudBtn.textContent = "云端存为子方案";
          adoptCloudBtn.classList.remove("is-copied");
        }, 1800);
      } catch (error) {
        showFeedback(error.message, true);
      }
    }, { class: "compact-btn" });
    nativeChoiceRow.append(
      button("用当前覆盖云端", () => { nativeChoiceRow.hidden = true; nativeConfirm.hidden = false; }, { class: "compact-btn" }),
      adoptCloudBtn
    );
    nativeConflict.append(nativeTitle, nativeDetails, nativeChoiceRow, nativeConfirm);

    const versions = el("div", null, { class: "cloud-versions" });

    const tech = el("div", null, { class: "cloud-tech cloud-tech-body" });
    const linkRow = el("div", null, { class: "cloud-link-row" });
    const link = el("a", board, { href: url, target: "_blank", rel: "noopener noreferrer", title: "打开分享地址" });
    linkRow.append(el("span", "分享地址：", { class: "muted" }), link);
    tech.append(linkRow, el("p", "可订阅配装及子方案，持有链接者可读写。", { class: "cloud-privacy" }));

    node.append(top, note, feedback, stats, nativeConflict, versions, tech);

    function comparison(main, copyRow) {
      const view = el("details", null, { class: "cloud-compare", open: "" });
      const toggle = el("summary", "版本冲突 · " + main.name);
      view.append(toggle);
      let built = false;
      function build() {
        if (built) return;
        built = true;
        const names = el("dl", null, { class: "cloud-facts" });
        for (const [label, row] of [["版本 A", main], ["版本 B", copyRow]]) {
          names.append(el("dt", label), el("dd", row.name + (row.removedAt != null ? " · 已移除" : "") +
            " · " + new Date(row.updatedAt).toLocaleString()));
        }
        view.append(names);
        const list = el("ul", null, { class: "cloud-diff", "aria-label": "版本 A 到版本 B 的差异" });
        try {
          for (const diff of app.Core.diff(main.snapshot.raw, copyRow.snapshot)) {
            const li = el("li", null);
            li.append(el("strong", diff.label), el("div", "A · " + app.Adapter.describe(ctx, diff, diff.from)),
              el("div", "B · " + app.Adapter.describe(ctx, diff, diff.to)));
            list.append(li);
          }
          view.append(list.childElementCount ? list : el("p", "两个版本的配装项目一致。", { class: "muted" }));
        } catch (error) { view.append(el("p", error.message)); }
        const choices = el("div", null, { class: "cloud-actions" });
        const confirmation = el("div", null, { class: "cloud-confirm", hidden: "" });
        const prompt = el("p", ""), actions = el("div", null, { class: "cloud-actions" });
        let choice, trigger;
        const commit = button("确认", () => resolve(main, copyRow, choice), { class: "compact-btn primary" });
        const cancel = button("取消", () => { confirmation.hidden = true; choices.hidden = false; trigger.focus(); }, { class: "compact-btn" });
        confirmation.addEventListener("keydown", event => {
          if (event.key === "Escape") { event.stopPropagation(); cancel.click(); }
        });
        actions.append(cancel, commit); confirmation.append(prompt, actions);
        for (const [key, label] of [["both", "保留两份"], ["a", "仅保留 A"], ["b", "仅保留 B"]]) {
          const btn = button(label, () => {
            if (key === "both") { resolve(main, copyRow, key); return; }
            choice = key; trigger = btn; choices.hidden = true; confirmation.hidden = false;
            prompt.textContent = "确认" + label + "？另一版本将被移除并同步到其他设备。";
            cancel.focus();
          }, { class: "compact-btn" });
          choices.append(btn);
        }
        view.append(choices, confirmation);
      }
      build();
      return view;
    }

    let lastRows, pairs = [], signature = "", nativeSignature = "";
    nativeDetails.addEventListener("toggle", () => { if (lastRows) update(lastRows); });

    function update(rows, freshContext) {
      if (freshContext?.scope === ctx.scope) ctx = freshContext;
      const state = app.Cloud.info(character, id);
      if (rows !== lastRows) { pairs = app.Cloud.conflictPairs(rows); lastRows = rows; }
      const warning = Boolean(state.warning || pairs.length);
      let label = warning ? state.label : "";
      if (pairs.length) {
        const pending = pairs.length + " 组版本待比较";
        label = state.kind === "ok" && !state.offline ? pending : state.label + " · " + pending;
      }
      const busy = state.kind === "busy" || state.kind === "pending";
      if (statusText.textContent !== label) statusText.textContent = label;
      statusWrap.hidden = !warning;
      statusWrap.classList.toggle("cloud-warning", warning);
      dot.dataset.state = warning ? "warn" : "idle";

      note.textContent = state.kind === "setup" || state.kind === "blocked" || state.kind === "error" ? state.detail :
        state.offline ? "离线修改已存本机，联网后自动同步。" :
        pairs.length ? pairs.length + " 组冲突待处理，两个版本均已保留。" : "";
      note.hidden = !note.textContent;

      nativeStat.textContent = state.nativeMismatch ? "原生：待确认" : "";
      nativeStat.hidden = !nativeStat.textContent;
      sceneStat.textContent = state.sceneCount == null ? "" : `子方案：${state.sceneCount}`;
      sceneStat.hidden = !sceneStat.textContent;
      memoryStat.textContent = state.memoryCount == null ? "" : `行动：${state.memoryCount}`;
      memoryStat.hidden = !memoryStat.textContent;
      checkedStat.textContent = "";
      checkedStat.hidden = true;
      checkedStat.removeAttribute("title");
      stats.hidden = nativeStat.hidden && sceneStat.hidden && memoryStat.hidden;

      nativeConflict.hidden = !state.nativeMismatch;
      if (state.nativeMismatch && nativeDetails.open) {
        const key = app.Core.stable([ctx.raw, state.nativeSnapshot]);
        if (key !== nativeSignature) {
          nativeSignature = key;
          try {
            const differences = app.Core.diff(ctx.raw, state.nativeSnapshot);
            nativeDiff.replaceChildren(...differences.map(diff => el("li", diff.label + "：当前 " +
              app.Adapter.describe(ctx, diff, diff.from) + " → 云端 " + app.Adapter.describe(ctx, diff, diff.to))));
            if (!differences.length) nativeDiff.append(el("li", "装备项目一致，名称或其他原生配置字段不同。"));
          } catch (error) { nativeDiff.replaceChildren(el("li", error.message)); }
        }
      }

      sync.disabled = state.offline || state.kind === "busy";
      sync.textContent = state.kind === "setup" || state.kind === "blocked" || state.kind === "error" ? "重新检查" : "立即同步";

      const key = pairs.map(([a, b]) => [a.id, a.revision, b.id, b.revision].join("/")).join("|");
      if (key !== signature) {
        const restoreFocus = versions.contains(node.getRootNode().activeElement);
        versions.replaceChildren(...pairs.map(([a, b]) => comparison(a, b)));
        signature = key;
        if (restoreFocus) sync.focus();
      }
      onStateChange?.({ warning, busy, label, conflicts: pairs.length, nativeMismatch: Boolean(state.nativeMismatch) });
    }
    return { node, update };
  }
  app.CloudUI = Object.freeze({ mount });
})(globalThis);

// ---- virtual_loadouts.js ----
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
  function save(character, title, snapshot, expected) {
    const validated = app.Core.validateSnapshot(snapshot), scope = owner(character);
    const row = { key: scope + "|" + crypto.randomUUID(), token: crypto.randomUUID(), owner: scope,
      board: null, scenes: [{ id: crypto.randomUUID(), name: app.Core.name(title), snapshot: validated }],
      checked: Date.now(), error: "" };
    return transaction(scope, "readwrite", (rows, store) => {
      // Only the interactive create flow opts into same-name replacement.
      if (expected !== undefined) {
        const matches = rows.filter(old => !old.board && old.scenes[0]?.name === row.scenes[0].name);
        if (matches.length > 1) throw Error("有多个同名虚拟配装，请换个名称或打开指定配装编辑。");
        const before = matches[0];
        if (before) {
          if (!expected || expected.key !== before.key || expected.token !== before.token ||
              app.Core.stable(expected.scenes) !== app.Core.stable(before.scenes))
            throw Object.assign(Error(`再次点击将覆盖“${row.scenes[0].name}”。`), { code: "NAME_EXISTS", existing: before });
          const updated = { ...before, checked: Date.now(), scenes: [{ ...before.scenes[0], snapshot: validated }] };
          store.put(updated); return updated;
        }
        if (expected) throw Error("待覆盖的虚拟配装已变化，请重新保存。");
      }
      store.add(row); return row;
    });
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
  async function importBackup(character, text, expected = []) {
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
      const rawTitle = [item.name, item.loadoutName, item.snapshot?.raw?.name].find(v => typeof v === "string" && v.trim());
      const title = app.Core.name(rawTitle);
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
      const existing = [...rows], additions = [], updates = [], conflicts = [], names = new Set();
      let added = 0, skipped = 0;
      for (const item of parsed) {
        if (item.board) {
          if (existing.some(row => row.board === item.board)) { skipped++; continue; }
        } else {
          const name = item.scenes[0].name;
          if (names.has(name)) throw Error("备份中有重复名称，请先区分名称再导入。");
          names.add(name);
          const targetKey = normalizeKey(item.scenes[0]);
          if (existing.some(row => !row.board && row.scenes[0]?.name === item.scenes[0].name && normalizeKey(row.scenes[0]) === targetKey)) {
            skipped++; continue;
          }
          const sameName = rows.filter(row => !row.board && row.scenes[0]?.name === name);
          if (sameName.length > 1) throw Error("本地有多个同名虚拟配装，请先区分名称再导入。");
          if (sameName.length) {
            const before = sameName[0];
            conflicts.push(before);
            updates.push({ ...before, checked: Date.now(), scenes: [{ ...before.scenes[0], snapshot: item.scenes[0].snapshot }] });
            continue;
          }
        }
        additions.push(item);
        existing.push(item);
        added++;
      }
      const signature = list => app.Core.stable(list.map(row => [row.key, row.token, row.scenes]).sort((a, b) => a[0].localeCompare(b[0])));
      if (signature(conflicts) !== signature(expected)) {
        if (!conflicts.length) throw Error("待覆盖的虚拟配装已变化，请重新导入。");
        throw Object.assign(Error("再次点击将覆盖备份中的同名虚拟配装。"), { code: "NAME_EXISTS", existing: conflicts });
      }
      for (const row of additions) store.add(row);
      for (const row of updates) store.put(row);
      return { added, skipped, ...(updates.length ? { overwritten: updates.length } : {}) };
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

// ---- virtual_preview.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPreview = function (React, NativePanel) {
    const h = React.createElement, noop = () => {};
    const children = node => React.Children.toArray(node?.props?.children);
    const part = (node, name) => node?.props?.className?.includes(`LoadoutsPanel_${name}__`);
    const child = (node, name) => children(node).find(node => part(node, name));
    function preview(snapshot, nativeProps, getCatalog) {
      const raw = { ...app.Core.validateSnapshot(snapshot).raw, missingItemLocationHridSet: {},
        missingFoodIndexSet: {}, missingDrinkIndexSet: {} };
      // Build a separate display model. Never replace the game's loadout dictionary or handlers.
      const props = { ...nativeProps };
      for (const key of Object.keys(props)) if (typeof props[key] === "function" && key !== "t") props[key] = noop;
      props.characterLoadoutDict = { [raw.id]: raw };
      props.characterAbilityMap = new Map(Object.values(raw.abilityMap || {}).filter(Boolean)
        .map(abilityHrid => [abilityHrid, { abilityHrid, level: 1, experience: 0 }]));
      props.characterSkillMap = new Map(nativeProps.characterSkillMap || []);
      // A viewer's locked slots must not hide skills in the shared configuration.
      props.characterSkillMap.set("/skills/intelligence", { level: 999, experience: 0 });
      props.characterItemMap = new Map();
      props.loadLoadoutHandler = noop;
      const renderer = new NativePanel(props);
      renderer.state = { ...renderer.state, selectedCharacterLoadoutId: raw.id };
      // This renderer is never mounted: it only produces the native slot tree.
      const shell = renderer.renderLoadout(), details = child(shell, "details"), setup = child(details, "setup");
      if (!setup) throw Error("原生配装布局暂不可用");
      const showTip = (event, kind, id, enhancement = 0) => {
        if (!id || !event?.currentTarget || !app.VirtualTooltip || typeof getCatalog !== "function") return;
        try {
          app.VirtualTooltip.show(event.currentTarget, { kind, id, enhancement, catalog: getCatalog(), nativeProps });
        } catch (_) { /* Catalog unavailable: fall back to native title attribute. */ }
      };
      const hideTip = event => { app.VirtualTooltip?.hide?.(event?.currentTarget); };
      function decorate(node) {
        if (!node || typeof node !== "object" || !node.props) return node;
        const p = node.props;
        let label, tipKind, tipId, tipEnh = 0;
        if ("currentItem" in p) {
          label = p.name + (p.currentItem ? "：" + app.Adapter.describe({ props: nativeProps },
            { kind: "equipment" }, { itemHrid: p.currentItem.itemHrid,
              ...(raw.useExactEnhancement ? { enhancementLevel: p.currentItem.enhancementLevel } : {}) }) : "：空槽");
          if (p.currentItem?.itemHrid) {
            tipKind = "equipment"; tipId = p.currentItem.itemHrid;
            tipEnh = raw.useExactEnhancement ? (p.currentItem.enhancementLevel || 0) : 0;
          }
        } else if ("slotNumber" in p && "currentAbility" in p) {
          label = "技能 " + p.slotNumber + "：" + app.Adapter.describe({ props: nativeProps }, { kind: "ability" }, p.currentAbility?.abilityHrid || null);
          if (p.currentAbility?.abilityHrid) { tipKind = "ability"; tipId = p.currentAbility.abilityHrid; }
        } else if ("consumableSlotTypeHrid" in p) {
          const isFood = p.consumableSlotTypeHrid.endsWith("food");
          label = (isFood ? "食物 " : "饮料 ") + (p.slotIndex + 1) + "：" +
            app.Adapter.describe({ props: nativeProps }, { kind: "food" }, p.itemHrid || null);
          if (p.itemHrid) { tipKind = isFood ? "food" : "drink"; tipId = p.itemHrid; }
        }
        if (label) {
          const safe = {};
          for (const [key, value] of Object.entries(p)) if (typeof value === "function") safe[key] = key === "getItemSelectionsFunc" ? () => [] : noop;
          safe.shouldCheckLevelRequirements = false;
          safe.shouldHideSelectedItemCount = true;
          const hoverProps = tipId ? {
            onMouseEnter: e => showTip(e, tipKind, tipId, tipEnh),
            onMouseLeave: hideTip,
            onFocus: e => showTip(e, tipKind, tipId, tipEnh),
            onBlur: hideTip
          } : {};
          return h("div", { key: node.key, className: "mwi-virtual-slot" },
            h("div", { title: label, "aria-label": label, role: "img", tabIndex: 0, ...hoverProps },
              h("div", { inert: "", "aria-hidden": true }, React.cloneElement(node, safe))));
        }
        return React.cloneElement(node, null, ...children(node).filter(node => !part(node, "buttonsContainer")).map(decorate));
      }
      // Preserve the native CSS ancestry: its grid rules are scoped through these wrappers.
      return React.cloneElement(shell, null, React.cloneElement(details, null, decorate(setup)));
    }
    return class NativePreview extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidUpdate(previous) {
        if (this.state.failed && previous.snapshot !== this.props.snapshot) this.setState({ failed: false });
      }
      render() {
        if (this.state.failed) return h("p", null, "图标预览暂不可用，请刷新游戏后重试。");
        let slots;
        try { slots = preview(this.props.snapshot, this.props.nativeProps, this.props.getCatalog); }
        catch (_) { return h("p", null, "图标预览暂不可用，请刷新游戏后重试。"); }
        return h("div", { className: "mwi-virtual-native" }, slots);
      }
    };
  };
})(globalThis);

// ---- virtual_editor.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes, Core = app.Core;
  const types = [["combat", "战斗"], ["", "通用"], ...Object.entries(Core.EQUIPMENT)
    .filter(([key]) => key.endsWith("_tool")).map(([key, name]) => [key.slice(0, -5), name.replace(/工具$/, "")])];
  const gearEntries = Object.entries(Core.EQUIPMENT).filter(([key]) => !key.endsWith("_tool"));
  const toolEntries = Object.entries(Core.EQUIPMENT).filter(([key]) => key.endsWith("_tool"));
  const ENHANCEMENT_PRESETS = [0, 5, 7, 10, 12];
  const DEFAULT_MULTIPLIERS = [0, 1, 2.1, 3.3, 4.6, 6, 7.5, 9.1, 10.8, 12.6, 14.5, 16.7, 19.2, 22, 25.1, 28.5, 32.2, 36.2, 40.5, 45.1, 50];
  // Native player model: three body columns, one spacer, accessories on the right.
  const gearPositions = {
    back: [1, 1], head: [1, 2], trinket: [1, 3], neck: [1, 5],
    main_hand: [2, 1], body: [2, 2], off_hand: [2, 3], earrings: [2, 5],
    hands: [3, 1], legs: [3, 2], pouch: [3, 3], ring: [3, 5],
    feet: [4, 2], charm: [4, 5]
  };

  let cachedRawKey = "", cachedParsed = null;
  function readClientData(codec) {
    const cached = root.localStorage.getItem("initClientData");
    if (!cached) throw Error("物品目录尚未加载，请刷新游戏后重试。");
    const key = cached.length + ":" + cached.slice(0, 24) + ":" + cached.slice(-24);
    if (key === cachedRawKey && cachedParsed) return cachedParsed;
    let data;
    try { data = JSON.parse(cached.trimStart().startsWith("{") ? cached : codec?.decompressFromUTF16(cached)); }
    catch (_) { throw Error("物品目录无法读取，请刷新游戏后重试。"); }
    if (!data?.itemDetailMap || !data.abilityDetailMap) throw Error("物品目录不完整，请刷新游戏后重试。");
    cachedRawKey = key;
    cachedParsed = data;
    return data;
  }

  function catalog(codec, loadedSprites = {}) {
    const data = readClientData(codec);
    const multTable = data.enhancementLevelTotalBonusMultiplierTable || {};
    const levels = Object.keys(multTable).map(Number).filter(Number.isSafeInteger);
    const sprites = { ...loadedSprites };
    // Reuse the page's own versioned assets, on either game domain. No fixed hashes.
    for (const use of document.querySelectorAll("svg use")) {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      const match = /(?:^|\/)(items|abilities|skills)_sprite\.[^/#]+\.svg#/.exec(href);
      if (match) sprites[match[1]] = href.split("#")[0];
    }
    return {
      items: data.itemDetailMap,
      abilities: data.abilityDetailMap,
      buffTypes: data.buffTypeDetailMap || {},
      skills: data.skillDetailMap || {},
      actionTypes: data.actionTypeDetailMap || {},
      combatStyles: data.combatStyleDetailMap || {},
      damageTypes: data.damageTypeDetailMap || {},
      multipliers: multTable,
      sprites,
      maxLevel: levels.length ? Math.max(...levels) : 20
    };
  }
  const enhanceable = detail => Array.isArray(detail?.enhancementCosts) && detail.enhancementCosts.length > 0;
  function empty() {
    return Core.snapshot({ id: 1, name: "新虚拟配装", actionTypeHrid: "/action_types/combat",
      useExactEnhancement: true, isDefault: false, suppressValidation: false,
      wearableMap: {}, abilityMap: {}, foodItemHrids: [null, null, null], drinkItemHrids: [null, null, null],
      abilityCombatTriggersMap: {}, consumableCombatTriggersMap: {} });
  }
  function portable(snapshot, title) {
    const source = Core.validateSnapshot(snapshot).raw, raw = empty().raw;
    raw.name = Core.name(title); raw.actionTypeHrid = source.actionTypeHrid || "";
    raw.useExactEnhancement = source.useExactEnhancement;
    for (const [loc, hash] of Object.entries(source.wearableMap)) {
      const slot = loc.split("/").pop();
      const targetSlot = slot === "two_hand" ? "main_hand" : slot;
      if (!Object.hasOwn(Core.EQUIPMENT, targetSlot)) throw Error("存在无法识别的装备槽位。");
      const item = Core.item(hash);
      const targetLoc = location(targetSlot);
      if (!item && raw.wearableMap[targetLoc]) continue;
      raw.wearableMap[targetLoc] = item ? `0::${targetLoc}::${item.itemHrid}::${item.enhancementLevel}` : null;
    }
    for (const key of ["abilityMap", "foodItemHrids", "drinkItemHrids", "abilityCombatTriggersMap", "consumableCombatTriggersMap"])
      if (source[key] != null) raw[key] = Core.copy(source[key]);
    return Core.snapshot(raw);
  }
  function share(scene) {
    return JSON.stringify({ format: "mwi-virtual-loadout", version: 1,
      name: Core.name(scene.name), snapshot: portable(scene.snapshot, scene.name) });
  }
  function parse(text) {
    if (typeof text !== "string" || text.length > 300000) throw Error("分享内容超过大小限制。");
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Error("分享内容不是有效 JSON。"); }
    if (data?.format !== "mwi-virtual-loadout" || data.version !== 1) throw Error("请选择虚拟配装分享文件或粘贴分享内容。");
    const rawName = [data.name, data.loadoutName, data.snapshot?.raw?.name].find(v => typeof v === "string" && v.trim());
    const title = Core.name(rawName);
    return { name: title, snapshot: portable(data.snapshot, title) };
  }
  function level(value, max) {
    if (String(value).trim() === "" || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > max)
      throw Error(`强化等级需为 0–${max} 的整数。`);
    return Number(value);
  }
  const location = slot => "/item_locations/" + slot;
  function equip(raw, slot, hrid, enhancement, data) {
    if (!Object.hasOwn(Core.EQUIPMENT, slot)) throw Error("无法识别装备槽位。");
    if (!hrid) { raw.wearableMap[location(slot)] = null; return; }
    const detail = data.items[hrid], type = detail?.equipmentDetail?.type?.split("/").pop();
    if (type !== slot && !(slot === "main_hand" && type === "two_hand")) throw Error("这件装备不适合当前槽位。");
    const n = enhanceable(detail) ? level(enhancement, data.maxLevel) : 0;
    raw.wearableMap[location(slot)] = `0::${location(slot)}::${hrid}::${n}`;
    if (type === "two_hand") raw.wearableMap[location("off_hand")] = null;
    if (slot === "off_hand") {
      const main = Core.item(raw.wearableMap[location("main_hand")]);
      if (data.items[main?.itemHrid]?.equipmentDetail?.type === "/equipment_types/two_hand") raw.wearableMap[location("main_hand")] = null;
    }
    raw.useExactEnhancement = true;
  }
  function validateDraft(raw, data) {
    for (const [key, hash] of Object.entries(raw.wearableMap)) {
      const item = Core.item(hash);
      if (!item) continue;
      const slot = key.split("/").pop(), detail = data.items[item.itemHrid];
      const type = detail?.equipmentDetail?.type?.split("/").pop();
      if (type !== slot && !(slot === "main_hand" && type === "two_hand")) throw Error(`${Core.EQUIPMENT[slot] || slot}的装备已不可用，请重新选择。`);
      level(item.enhancementLevel, enhanceable(detail) ? data.maxLevel : 0);
      if (type === "two_hand" && raw.wearableMap[location("off_hand")]) throw Error("双手武器不能同时配置副手。");
    }
    const combat = raw.actionTypeHrid === "/action_types/combat";
    if (combat) for (const [slot, id] of Object.entries(raw.abilityMap || {})) {
      if (id && (!data.abilities[id] || Boolean(data.abilities[id].isSpecialAbility) !== (slot === "1"))) throw Error("技能与槽位不匹配，请重新选择。");
    }
    for (const kind of combat ? ["food", "drink"] : ["drink"]) {
      for (const id of raw[kind === "food" ? "foodItemHrids" : "drinkItemHrids"] || []) {
        if (!id) continue;
        const detail = data.items[id];
        if (detail?.categoryHrid !== "/item_categories/" + kind || !detail.consumableDetail ||
            raw.actionTypeHrid && !detail.consumableDetail.usableInActionTypeMap?.[raw.actionTypeHrid])
          throw Error("有消耗品不适用于当前配装类型，请更换或清空对应槽位。");
      }
    }
  }
  const draftKey = owner => `mwi-layu:virtual-draft:v1:${root.location?.origin || ""}|${owner}`;
  function readDraft(owner) {
    try {
      const text = root.localStorage?.getItem(draftKey(owner));
      if (!text) return null;
      const data = JSON.parse(text);
      if (!data || typeof data !== "object") return null;
      const snapshot = Core.validateSnapshot(data.snapshot);
      return {
        entryKey: typeof data.entryKey === "string" ? data.entryKey : null,
        entryToken: typeof data.entryToken === "string" ? data.entryToken : null,
        title: typeof data.title === "string" ? data.title.slice(0, 60) : "",
        slot: typeof data.slot === "string" ? data.slot : "head",
        kind: ["equipment", "ability", "food", "drink"].includes(data.kind) ? data.kind : "equipment",
        snapshot,
        updatedAt: Number.isSafeInteger(data.updatedAt) ? data.updatedAt : Date.now()
      };
    } catch (_) { return null; }
  }
  function saveDraft(owner, draft) {
    try {
      const safeTitle = String(draft.title || "").trim().slice(0, 60);
      const snapshot = portable(Core.snapshot(draft.raw), safeTitle || "未命名草稿");
      root.localStorage?.setItem(draftKey(owner), JSON.stringify({
        entryKey: draft.entryKey || null,
        entryToken: draft.entryToken || null,
        title: String(draft.title || "").slice(0, 60),
        slot: draft.slot || "head",
        kind: draft.kind || "equipment",
        snapshot,
        updatedAt: Date.now()
      }));
    } catch (_) { /* Draft persistence failure must never interrupt editing. */ }
  }
  function clearDraft(owner) {
    try { root.localStorage?.removeItem(draftKey(owner)); } catch (_) { /* Ignore storage errors. */ }
  }
  app.VirtualDraft = Object.freeze({ catalog, empty, portable, share, parse, equip, enhanceable, readDraft, saveDraft, clearDraft });

  // Native-style hover detail tooltip for equipment, tools, abilities, food & drinks.
  const SKILL_ZH = {
    stamina: "耐力", intelligence: "智力", attack: "攻击", melee: "近战", defense: "防御",
    ranged: "远程", magic: "魔法", milking: "挤奶", foraging: "采摘", woodcutting: "伐木",
    cheesesmithing: "奶酪锻造", crafting: "制作", tailoring: "缝纫", cooking: "烹饪",
    brewing: "冲泡", alchemy: "炼金", enhancing: "强化", combat: "战斗"
  };
  const STYLE_ZH = { stab: "刺击", slash: "斩击", smash: "钝击", ranged: "远程", magic: "魔法" };
  const DAMAGE_ZH = { physical: "物理", water: "水系", nature: "自然", fire: "火系", true: "真实" };
  const SLOT_ZH = { ...Core.EQUIPMENT, two_hand: "双手" };
  const STAT_ZH = {
    stabAccuracy: "刺击精准", slashAccuracy: "斩击精准", smashAccuracy: "钝击精准", rangedAccuracy: "远程精准", magicAccuracy: "魔法精准",
    stabDamage: "刺击伤害", slashDamage: "斩击伤害", smashDamage: "钝击伤害", rangedDamage: "远程伤害", magicDamage: "魔法伤害",
    stabEvasion: "刺击闪避", slashEvasion: "斩击闪避", smashEvasion: "钝击闪避", rangedEvasion: "远程闪避", magicEvasion: "魔法闪避",
    armor: "护甲", waterResistance: "水系抗性", natureResistance: "自然抗性", fireResistance: "火系抗性",
    maxHitpoints: "最大生命", maxManapoints: "最大魔法", hpRegenPer10: "生命恢复/10秒", mpRegenPer10: "魔法恢复/10秒",
    attackSpeed: "攻击速度", castSpeed: "施法速度", criticalRate: "暴击率", criticalDamage: "暴击伤害", abilityHaste: "技能急速",
    lifeSteal: "生命偷取", manaLeech: "魔法吸取", physicalAmplify: "物理增伤", waterAmplify: "水系增伤",
    natureAmplify: "自然增伤", fireAmplify: "火系增伤", healingAmplify: "治疗增益",
    physicalThorns: "物理反伤", elementalThorns: "元素反伤", parry: "招架", mayhem: "狂暴", pierce: "穿透",
    curse: "诅咒", fury: "怒火", weeping: "哀泣", untargetable: "不可选中", threat: "仇恨", tenacity: "韧性",
    autoAttackDamage: "普攻伤害", damageTaken: "受到伤害", taskDamage: "任务伤害",
    combatDropRate: "战斗掉落率", combatDropQuantity: "战斗掉落数量", combatRareFind: "战斗稀有发现", combatExperience: "战斗经验",
    skillingSpeed: "生活速度", skillingEfficiency: "生活效率", skillingRareFind: "生活稀有发现", skillingExperience: "生活经验",
    skillingEssenceFind: "精华发现", skillingDropRate: "生活掉落率", gatheringQuantity: "采集数量",
    drinkConcentration: "饮品浓度", foodHaste: "食物急速", drinkHaste: "饮料急速",
    taskSpeed: "任务速度", enhancingSuccess: "强化成功率", alchemySuccess: "炼金成功率", wisdom: "智慧"
  };
  const FLAT_STATS = new Set([
    "stabAccuracy", "slashAccuracy", "smashAccuracy", "rangedAccuracy", "magicAccuracy",
    "stabDamage", "slashDamage", "smashDamage", "rangedDamage", "magicDamage",
    "stabEvasion", "slashEvasion", "smashEvasion", "rangedEvasion", "magicEvasion",
    "armor", "waterResistance", "natureResistance", "fireResistance",
    "maxHitpoints", "maxManapoints", "hpRegenPer10", "mpRegenPer10",
    "physicalThorns", "elementalThorns", "autoAttackDamage", "abilityHaste", "threat", "tenacity"
  ]);
  const BUFF_ZH = {
    efficiency: "效率", action_speed: "行动速度", wisdom: "经验", gathering: "采集数量",
    gourmet: "双倍产出", artisan: "节省材料", processing: "加工概率", rare_find: "稀有发现",
    essence_find: "精华发现", blessed: "双倍强化", enhancing_speed: "强化速度", enhancing_success: "强化成功率",
    alchemy_speed: "炼金速度", alchemy_success: "炼金成功率", catalytic: "催化",
    attack_speed: "攻击速度", cast_speed: "施法速度", critical_rate: "暴击率", critical_damage: "暴击伤害",
    armor: "护甲", water_resistance: "水系抗性", nature_resistance: "自然抗性", fire_resistance: "火系抗性",
    damage: "伤害", accuracy: "精准", evasion: "闪避", hp_regen: "生命恢复", mp_regen: "魔法恢复",
    stamina_level: "耐力等级", intelligence_level: "智力等级", attack_level: "攻击等级",
    melee_level: "近战等级", defense_level: "防御等级", ranged_level: "远程等级", magic_level: "魔法等级"
  };

  function tr(t, key, fallback) {
    if (typeof t === "function") {
      try {
        const value = t(key);
        if (typeof value === "string" && value && value !== key && value !== key.split(".").pop()) return value;
      } catch (_) { /* Use fallback label. */ }
    }
    return fallback;
  }
  const slug = hrid => String(hrid || "").split("/").pop();
  const fmtNum = n => {
    const rounded = Math.round(n * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/\.?0+$/, "");
  };
  const fmtSigned = (n, pct) => {
    const sign = n >= 0 ? "+" : "";
    return pct ? `${sign}${fmtNum(n * 100)}%` : `${sign}${fmtNum(n)}`;
  };
  const fmtSeconds = value => {
    const sec = value >= 1e5 ? value / 1e9 : value;
    if (sec >= 60 && sec % 60 === 0) return `${sec / 60} 分钟`;
    return `${fmtNum(sec)} 秒`;
  };
  function statLabel(t, key) {
    const translated = tr(t, "combatStats." + key, "") || tr(t, "noncombatStats." + key, "");
    if (translated) return translated;
    if (STAT_ZH[key]) return STAT_ZH[key];
    const match = /^([a-z]+)(Speed|Efficiency|RareFind|Experience|Success|Level)$/.exec(key);
    if (match && SKILL_ZH[match[1]]) {
      const suffix = { Speed: "速度", Efficiency: "效率", RareFind: "稀有发现", Experience: "经验", Success: "成功率", Level: "等级" }[match[2]];
      return SKILL_ZH[match[1]] + suffix;
    }
    return key.replace(/([A-Z])/g, " $1").trim();
  }
  function isPercentStat(key, value) {
    if (FLAT_STATS.has(key) || /Level$/.test(key) || /Per10$/.test(key)) return false;
    if (/(Speed|Efficiency|Rate|Ratio|Amplify|Find|Experience|Concentration|Success|Steal|Leech|Chance|Quantity|Damage|Haste|Parry|Pierce|Mayhem|Curse|Fury|Weeping|Taken|Wisdom)$/i.test(key)) return true;
    return Math.abs(value) > 0 && Math.abs(value) < 1;
  }
  function skillName(t, data, hrid) {
    const id = slug(hrid);
    return tr(t, "skillNames." + hrid, SKILL_ZH[id] || data?.skills?.[hrid]?.name || id);
  }
  function actionTypeName(t, data, hrid) {
    const id = slug(hrid);
    return tr(t, "actionTypeNames." + hrid, SKILL_ZH[id] || data?.actionTypes?.[hrid]?.name || id);
  }
  function buffName(t, data, hrid) {
    const id = slug(hrid);
    if (id.endsWith("_level")) {
      const skill = id.slice(0, -6);
      if (SKILL_ZH[skill]) return SKILL_ZH[skill] + "等级";
    }
    return tr(t, "buffTypeNames." + hrid, BUFF_ZH[id] || data?.buffTypes?.[hrid]?.name || id.replace(/_/g, " "));
  }
  function formatBuffLine(t, data, buff, abilityLevel = 1) {
    if (!buff) return null;
    const name = buffName(t, data, buff.typeHrid);
    const flat = (Number(buff.flatBoost) || 0) + (abilityLevel - 1) * (Number(buff.flatBoostLevelBonus) || 0);
    const ratio = (Number(buff.ratioBoost) || 0) + (abilityLevel - 1) * (Number(buff.ratioBoostLevelBonus) || 0);
    const parts = [];
    if (flat) {
      const isFlatPct = !/_level$|armor|resistance|regen|threat|haste/i.test(slug(buff.typeHrid)) && Math.abs(flat) < 1;
      parts.push(fmtSigned(flat, isFlatPct));
    }
    if (ratio) parts.push(fmtSigned(ratio, true));
    const duration = Number(buff.duration) > 0 ? `（${fmtSeconds(buff.duration)}）` : "";
    return { label: name, value: (parts.join(" / ") || "生效") + duration };
  }
  function buildTooltipModel(spec) {
    const { kind, id, catalog: data, nativeProps } = spec || {};
    if (!id || !data) return null;
    const t = nativeProps?.t;
    const isAbility = kind === "ability";
    const detail = isAbility ? data.abilities?.[id] : data.items?.[id];
    if (!detail) return null;
    const title = app.Adapter.describe({ props: nativeProps }, { kind: isAbility ? "ability" : "food" }, id);
    const iconPath = data.sprites?.[isAbility ? "abilities" : "items"];
    const iconHref = iconPath ? `${iconPath}#${slug(id)}` : "";
    const sections = [];
    const meta = [];
    let enhancementTag = "";
    let subtitle = "";

    if (isAbility) {
      const owned = nativeProps?.characterAbilityMap?.get?.(id);
      const lvl = Math.max(1, Number(owned?.level) || 1);
      subtitle = (detail.isSpecialAbility ? "特殊技能" : "技能") + (owned ? ` · Lv.${lvl}` : ` · Lv.${lvl} 预览`);
      if (detail.manaCost) meta.push(`消耗 ${detail.manaCost} 魔法`);
      if (detail.cooldownDuration) meta.push(`冷却 ${fmtSeconds(detail.cooldownDuration)}`);
      if (detail.castDuration) meta.push(`施法 ${fmtSeconds(detail.castDuration)}`);
      const effectRows = [];
      for (const eff of detail.abilityEffects || []) {
        const flat = (Number(eff.baseDamageFlat) || 0) + (lvl - 1) * (Number(eff.baseDamageFlatLevelBonus) || 0);
        const ratio = (Number(eff.baseDamageRatio) || 0) + (lvl - 1) * (Number(eff.baseDamageRatioLevelBonus) || 0);
        const type = slug(eff.effectType);
        const targetText = eff.targetType === "/ability_effect_target_types/self" ? "自身"
          : eff.targetType === "/ability_effect_target_types/all_allies" ? "全体友方"
          : eff.targetType === "/ability_effect_target_types/lowest_hp_ally" ? "最低血量友方"
          : eff.targetType === "/ability_effect_target_types/all_enemies" ? "全体敌人"
          : eff.targetType === "/ability_effect_target_types/enemy" ? "单体敌人" : "";
        if (type === "damage" || flat > 0 || ratio > 0) {
          const isHeal = type === "heal";
          const dmgKind = DAMAGE_ZH[slug(eff.damageType)] || STYLE_ZH[slug(eff.combatStyleHrid)] || "";
          const nums = [flat ? fmtNum(flat) : "", ratio ? `${fmtNum(ratio * 100)}%` : ""].filter(Boolean).join(" + ");
          if (nums) effectRows.push({
            label: (targetText ? targetText + " · " : "") + (isHeal ? "治疗" : (dmgKind ? dmgKind + "伤害" : "伤害")),
            value: nums
          });
        }
        if (eff.bonusAccuracyRatio) effectRows.push({ label: "附加命中", value: fmtSigned(eff.bonusAccuracyRatio, true) });
        if (eff.pierceChance) effectRows.push({ label: "穿透几率", value: `${fmtNum(eff.pierceChance * 100)}%` });
        if (eff.stunChance) effectRows.push({ label: "眩晕几率", value: `${fmtNum(eff.stunChance * 100)}%` });
        if (eff.blindChance) effectRows.push({ label: "致盲几率", value: `${fmtNum(eff.blindChance * 100)}%` });
        if (eff.silenceChance) effectRows.push({ label: "沉默几率", value: `${fmtNum(eff.silenceChance * 100)}%` });
        for (const buff of eff.buffs || []) {
          const line = formatBuffLine(t, data, buff, lvl);
          if (line) effectRows.push({ label: (targetText ? targetText + " · " : "") + line.label, value: line.value });
        }
      }
      if (effectRows.length) sections.push({ heading: "技能效果", rows: effectRows });
      const desc = tr(t, "abilityDescriptions." + id, detail.description || "");
      if (desc && desc !== title) sections.push({ text: desc });
    } else if (detail.equipmentDetail) {
      const eq = detail.equipmentDetail;
      const eqType = slug(eq.type);
      const lvl = enhanceable(detail) ? Math.max(0, Number(spec.enhancement) || 0) : 0;
      const mult = lvl > 0 ? Number(data.multipliers?.[lvl] ?? DEFAULT_MULTIPLIERS[lvl] ?? lvl) : 0;
      if (lvl > 0) enhancementTag = `+${lvl}`;
      const slotName = SLOT_ZH[eqType] || eqType;
      subtitle = detail.itemLevel ? `${slotName} · 物品等级 ${detail.itemLevel}` : slotName;
      if (Array.isArray(eq.levelRequirements) && eq.levelRequirements.length) {
        const reqRows = eq.levelRequirements.map(req => {
          const currentLvl = nativeProps?.characterSkillMap?.get?.(req.skillHrid)?.level;
          const unmet = Number.isFinite(currentLvl) && currentLvl < req.level;
          return { label: "需求 " + skillName(t, data, req.skillHrid), value: `Lv.${req.level}`, warn: unmet };
        });
        sections.push({ rows: reqRows });
      }
      const cStats = eq.combatStats || {}, cBonus = eq.combatEnhancementBonuses || {};
      if (cStats.attackInterval) meta.push(`攻速间隔 ${fmtSeconds(cStats.attackInterval)}`);
      if (Array.isArray(cStats.combatStyleHrids) && cStats.combatStyleHrids.length)
        meta.push(cStats.combatStyleHrids.map(h => STYLE_ZH[slug(h)] || data.combatStyles?.[h]?.name || slug(h)).join("/"));
      if (cStats.damageType) meta.push((DAMAGE_ZH[slug(cStats.damageType)] || data.damageTypes?.[cStats.damageType]?.name || slug(cStats.damageType)) + "伤害");

      const collectStats = (baseObj, bonusObj) => {
        const keys = new Set([...Object.keys(baseObj || {}), ...Object.keys(bonusObj || {})]);
        const rows = [];
        for (const key of keys) {
          if (key === "attackInterval" || key === "combatStyleHrids" || key === "damageType") continue;
          const base = Number(baseObj?.[key]) || 0;
          const perBonus = Number(bonusObj?.[key]) || 0;
          if (!base && !perBonus) continue;
          const delta = perBonus * mult;
          const total = base + delta;
          if (!total && !delta) continue;
          const pct = isPercentStat(key, base || perBonus);
          rows.push({
            label: statLabel(t, key),
            value: fmtSigned(total, pct),
            extra: delta ? `(${fmtSigned(delta, pct)})` : ""
          });
        }
        return rows;
      };
      const combatRows = collectStats(cStats, cBonus);
      if (combatRows.length) sections.push({ heading: "战斗属性", rows: combatRows });
      const noncombatRows = collectStats(eq.noncombatStats, eq.noncombatEnhancementBonuses);
      if (noncombatRows.length) sections.push({ heading: "生活属性", rows: noncombatRows });
      const desc = tr(t, "itemDescriptions." + id, detail.description || "");
      if (desc && desc !== title) sections.push({ text: desc });
    } else if (detail.consumableDetail) {
      const cd = detail.consumableDetail;
      const isFood = detail.categoryHrid === "/item_categories/food" || kind === "food";
      subtitle = (isFood ? "食物" : "饮料") + (detail.itemLevel ? ` · Lv.${detail.itemLevel}` : "");
      if (cd.cooldownDuration) meta.push(`冷却 ${fmtSeconds(cd.cooldownDuration)}`);
      const usable = Object.entries(cd.usableInActionTypeMap || {}).filter(([, ok]) => ok)
        .map(([hrid]) => actionTypeName(t, data, hrid));
      if (usable.length) meta.push(`适用于 ${usable.slice(0, 4).join(" / ")}${usable.length > 4 ? " 等" : ""}`);
      const rows = [];
      const hp = Number(cd.hitpointRestore) || 0;
      const mp = Number(cd.manaRestore ?? cd.manapointRestore) || 0;
      const dur = Number(cd.recoveryDuration) > 0 ? `（${fmtSeconds(cd.recoveryDuration)}）` : "";
      if (hp) rows.push({ label: "生命恢复", value: `+${fmtNum(hp)}${dur}` });
      if (mp) rows.push({ label: "魔法恢复", value: `+${fmtNum(mp)}${dur}` });
      for (const buff of cd.buffs || []) {
        const line = formatBuffLine(t, data, buff, 1);
        if (line) rows.push(line);
      }
      if (rows.length) sections.push({ heading: "使用效果", rows });
      const desc = tr(t, "itemDescriptions." + id, detail.description || "");
      if (desc && desc !== title) sections.push({ text: desc });
    } else {
      const desc = tr(t, "itemDescriptions." + id, detail.description || "");
      if (desc && desc !== title) sections.push({ text: desc });
    }
    return { title, enhancementTag, subtitle, iconHref, meta, sections };
  }

  const tooltip = (() => {
    let box = null, currentAnchor = null, listenersBound = false;
    function restoreTitle(node) {
      if (node?.dataset && Object.hasOwn(node.dataset, "mwiSavedTitle")) {
        if (node.dataset.mwiSavedTitle) node.setAttribute("title", node.dataset.mwiSavedTitle);
        delete node.dataset.mwiSavedTitle;
      }
    }
    function hide(anchor) {
      if (anchor && currentAnchor && anchor !== currentAnchor) return;
      restoreTitle(currentAnchor);
      currentAnchor = null;
      if (box) box.hidden = true;
    }
    function ensureBox() {
      if (box?.isConnected) return box;
      box = document.createElement("div");
      box.id = "mwi-virtual-tooltip";
      box.className = "mwi-item-tooltip";
      box.setAttribute("role", "tooltip");
      box.hidden = true;
      document.body.append(box);
      if (!listenersBound) {
        listenersBound = true;
        const dismiss = () => hide();
        const onScroll = () => {
          if (!box || box.hidden) return;
          if (currentAnchor?.isConnected && currentAnchor.matches?.(":hover")) position(box, currentAnchor);
          else hide();
        };
        root.addEventListener("scroll", onScroll, true);
        root.addEventListener("resize", dismiss);
        root.addEventListener("pointerdown", dismiss, true);
      }
      return box;
    }
    function svgUse(href) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("class", "mwi-item-tooltip-icon");
      svg.setAttribute("aria-hidden", "true");
      const use = document.createElementNS(ns, "use");
      use.setAttribute("href", href);
      svg.append(use);
      return svg;
    }
    function position(el, anchor) {
      const rect = anchor.getBoundingClientRect();
      const pad = 12, gap = 10;
      const vw = root.innerWidth || document.documentElement.clientWidth || 1024;
      const vh = root.innerHeight || document.documentElement.clientHeight || 768;
      const w = el.offsetWidth, h = el.offsetHeight;
      let left = rect.right + gap;
      if (left + w + pad > vw) left = rect.left - w - gap;
      if (left < pad) left = Math.max(pad, Math.min(vw - w - pad, rect.left + (rect.width - w) / 2));
      let top = rect.top;
      if (left < rect.right && left + w > rect.left) {
        top = rect.bottom + gap;
        if (top + h + pad > vh) top = rect.top - h - gap;
      }
      top = Math.max(pad, Math.min(vh - h - pad, top));
      el.style.left = Math.round(left) + "px";
      el.style.top = Math.round(top) + "px";
    }
    function show(anchor, spec) {
      if (!anchor || typeof document === "undefined" || !document.body) return;
      const model = buildTooltipModel(spec);
      if (!model) { hide(anchor); return; }
      if (currentAnchor && currentAnchor !== anchor) restoreTitle(currentAnchor);
      if (anchor.hasAttribute?.("title")) {
        anchor.dataset.mwiSavedTitle = anchor.getAttribute("title") || "";
        anchor.removeAttribute("title");
      }
      currentAnchor = anchor;
      const el = ensureBox();
      el.replaceChildren();
      const head = document.createElement("div");
      head.className = "mwi-item-tooltip-head";
      if (model.iconHref) head.append(svgUse(model.iconHref));
      const titleBox = document.createElement("div");
      titleBox.className = "mwi-item-tooltip-titlebox";
      const titleLine = document.createElement("div");
      titleLine.className = "mwi-item-tooltip-title";
      const nameSpan = document.createElement("strong");
      nameSpan.textContent = model.title;
      titleLine.append(nameSpan);
      if (model.enhancementTag) {
        const enh = document.createElement("span");
        enh.className = "mwi-item-tooltip-enh";
        enh.textContent = model.enhancementTag;
        titleLine.append(enh);
      }
      titleBox.append(titleLine);
      if (model.subtitle) {
        const sub = document.createElement("div");
        sub.className = "mwi-item-tooltip-sub";
        sub.textContent = model.subtitle;
        titleBox.append(sub);
      }
      head.append(titleBox);
      el.append(head);

      if (model.meta.length) {
        const metaRow = document.createElement("div");
        metaRow.className = "mwi-item-tooltip-meta";
        metaRow.textContent = model.meta.join(" · ");
        el.append(metaRow);
      }
      for (const sec of model.sections) {
        const block = document.createElement("div");
        block.className = "mwi-item-tooltip-sec";
        if (sec.heading) {
          const h4 = document.createElement("div");
          h4.className = "mwi-item-tooltip-heading";
          h4.textContent = sec.heading;
          block.append(h4);
        }
        if (sec.rows) {
          const list = document.createElement("div");
          list.className = "mwi-item-tooltip-rows";
          for (const row of sec.rows) {
            const line = document.createElement("div");
            line.className = "mwi-item-tooltip-row" + (row.warn ? " is-warn" : "");
            const k = document.createElement("span");
            k.className = "mwi-item-tooltip-key";
            k.textContent = row.label;
            const v = document.createElement("span");
            v.className = "mwi-item-tooltip-val";
            v.textContent = row.value;
            if (row.extra) {
              const ex = document.createElement("span");
              ex.className = "mwi-item-tooltip-delta";
              ex.textContent = " " + row.extra;
              v.append(ex);
            }
            line.append(k, v);
            list.append(line);
          }
          block.append(list);
        }
        if (sec.text) {
          const p = document.createElement("p");
          p.className = "mwi-item-tooltip-desc";
          p.textContent = sec.text;
          block.append(p);
        }
        el.append(block);
      }
      el.hidden = false;
      position(el, anchor);
    }
    return Object.freeze({ show, hide, build: buildTooltipModel });
  })();
  app.VirtualTooltip = tooltip;

  app.makeVirtualEditor = function (React) {
    const h = React.createElement;
    const icon = (data, id, className = "") => {
      const match = /^\/(items|abilities|skills)\/([a-z0-9_]+)$/.exec(id || "");
      const path = match && data.sprites?.[match[1]];
      return path ? h("svg", { className: "mwi-draft-game-icon " + className, "aria-hidden": true, focusable: "false" },
        h("use", { href: path + "#" + match[2] })) : null;
    };
    return class VirtualEditor extends React.Component {
      constructor(props) {
        super(props);
        const draft = props.draft;
        const snapshot = draft ? Core.validateSnapshot(draft.snapshot) : props.scene ? Core.validateSnapshot(props.scene.snapshot) : empty();
        snapshot.raw.useExactEnhancement = true;
        if (Object.hasOwn(snapshot.raw.wearableMap, "/item_locations/two_hand")) {
          const twoHand = snapshot.raw.wearableMap["/item_locations/two_hand"];
          if (Core.item(twoHand) && !Core.item(snapshot.raw.wearableMap[location("main_hand")]))
            snapshot.raw.wearableMap[location("main_hand")] = twoHand;
          delete snapshot.raw.wearableMap["/item_locations/two_hand"];
        }
        const initialKind = draft?.kind || "equipment";
        const initialSlot = draft?.slot || "head";
        const initialItem = initialKind === "equipment" ? Core.item(snapshot.raw.wearableMap[location(initialSlot)]) : null;
        this.state = {
          raw: snapshot.raw,
          title: draft ? draft.title : props.scene?.name || "",
          slot: initialSlot,
          kind: initialKind,
          query: "",
          enhancement: String(initialItem?.enhancementLevel ?? 0),
          batch: "10",
          notice: "",
          busy: false,
          discard: false,
          dirty: Boolean(draft)
        };
      }
      componentDidMount() { this.alive = true; this.nameInput?.focus(); }
      componentDidUpdate() { this.persistDraft(); }
      componentWillUnmount() {
        this.alive = false;
        tooltip.hide();
        this.persistDraft();
      }
      persistDraft() {
        if (!this.state.dirty || this.cleared) return;
        const { raw, title, slot, kind } = this.state, prev = this.lastDraft;
        if (prev && prev.raw === raw && prev.title === title && prev.slot === slot && prev.kind === kind) return;
        this.lastDraft = { raw, title, slot, kind };
        this.props.onDraftChange?.(this.lastDraft);
      }
      change(work) {
        try {
          const raw = Core.copy(this.state.raw); work(raw);
          this.setState({ raw, dirty: true, discard: false, notice: "", overwrite: null });
        } catch (error) { this.setState({ notice: error.message }); }
      }
      itemName(id, ability = false) {
        return id ? app.Adapter.describe({ props: this.props.nativeProps }, { kind: ability ? "ability" : "food" }, id) : "空槽";
      }
      chooseSlot(kind, slot) {
        const item = kind === "equipment" && Core.item(this.state.raw.wearableMap[location(slot)]);
        this.setState({ kind, slot, query: "", enhancement: String(item?.enhancementLevel ?? 0), notice: "" });
        this.search?.focus();
      }
      requestClose = () => {
        if (this.state.dirty && !this.state.discard) this.setState({ discard: true });
        else { this.cleared = true; tooltip.hide(); this.props.onCancel(); }
      };
      select(id) {
        const { kind, slot } = this.state, data = this.props.catalog;
        this.change(raw => {
          if (kind === "equipment") equip(raw, slot, id, this.state.enhancement, data);
          else if (kind === "ability") {
            if (id && Boolean(data.abilities[id]?.isSpecialAbility) !== (slot === 1)) throw Error("请选择对应技能槽的技能。");
            raw.abilityMap ||= {};
            if (id) for (const key of Object.keys(raw.abilityMap)) if (raw.abilityMap[key] === id) raw.abilityMap[key] = null;
            raw.abilityMap[slot] = id || null;
            raw.abilityCombatTriggersMap ||= {};
            if (id && !raw.abilityCombatTriggersMap[id]) raw.abilityCombatTriggersMap[id] = Core.copy(data.abilities[id].defaultCombatTriggers || []);
          } else {
            const key = kind === "food" ? "foodItemHrids" : "drinkItemHrids";
            raw[key] ||= [null, null, null];
            if (id) raw[key] = raw[key].map(value => value === id ? null : value);
            raw[key][slot] = id || null;
            raw.consumableCombatTriggersMap ||= {};
            if (id && !raw.consumableCombatTriggersMap[id]) raw.consumableCombatTriggersMap[id] = Core.copy(data.items[id].consumableDetail.defaultCombatTriggers || []);
          }
        });
        if (kind === "equipment" && id && !enhanceable(data.items[id])) this.setState({ enhancement: "0" });
      }
      applyLevel(value) {
        try {
          const n = level(value, this.props.catalog.maxLevel), { slot } = this.state;
          const item = Core.item(this.state.raw.wearableMap[location(slot)]);
          this.setState({ enhancement: String(n), notice: "" });
          if (item) this.change(raw => equip(raw, slot, item.itemHrid, n, this.props.catalog));
        } catch (error) { this.setState({ notice: error.message }); }
      }
      save = async (event, asNew = false) => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "" });
        let attemptKey;
        try {
          const title = Core.name(this.state.title);
          validateDraft(this.state.raw, this.props.catalog);
          const snapshot = portable(Core.snapshot(this.state.raw), title);
          attemptKey = Core.stable([title, snapshot, asNew]);
          const expected = this.state.overwrite?.key === attemptKey ? this.state.overwrite.entry : null;
          this.cleared = true;
          tooltip.hide();
          await this.props.onSave(title, snapshot, asNew, expected);
        } catch (error) {
          this.cleared = false;
          if (this.alive) this.setState(error.code === "NAME_EXISTS"
            ? { overwrite: { key: attemptKey, entry: error.existing, asNew }, notice: "" }
            : { overwrite: null, notice: error.message });
        }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      showTip(event, kind, id, enh = 0) {
        if (!id || !event?.currentTarget) return;
        tooltip.show(event.currentTarget, { kind, id, enhancement: enh, catalog: this.props.catalog, nativeProps: this.props.nativeProps });
      }
      hideTip(event) {
        tooltip.hide(event?.currentTarget);
      }
      render() {
        const { raw, title, kind, slot, query, enhancement, batch, notice, busy } = this.state, data = this.props.catalog;
        const combat = raw.actionTypeHrid === "/action_types/combat";
        const current = kind === "equipment" ? Core.item(raw.wearableMap[location(slot)]) : null;
        const currentId = kind === "equipment" ? current?.itemHrid : kind === "ability" ? raw.abilityMap?.[slot] : raw[kind === "food" ? "foodItemHrids" : "drinkItemHrids"]?.[slot];
        const canEnhanceCurrent = !current || enhanceable(data.items[current.itemHrid]);
        const enhNum = Math.max(0, Math.min(data.maxLevel, Number.isFinite(Number(enhancement)) ? Math.trunc(Number(enhancement)) : 0));
        const presets = ENHANCEMENT_PRESETS.filter(n => n <= data.maxLevel);
        const candidates = Object.entries(kind === "ability" ? data.abilities : data.items).filter(([id, detail]) => {
          if (kind === "equipment") {
            const type = detail.equipmentDetail?.type?.split("/").pop();
            if (type !== slot && !(slot === "main_hand" && type === "two_hand")) return false;
          } else if (kind === "ability") {
            if (Boolean(detail.isSpecialAbility) !== (slot === 1)) return false;
          } else if (detail.categoryHrid !== "/item_categories/" + kind || !detail.consumableDetail ||
            raw.actionTypeHrid && !detail.consumableDetail.usableInActionTypeMap?.[raw.actionTypeHrid]) return false;
          return !query || (this.itemName(id, kind === "ability") + " " + (detail.name || "") + " " + id).toLowerCase().includes(query.trim().toLowerCase());
        }).sort((a, b) => (a[1].sortIndex || 0) - (b[1].sortIndex || 0));

        const btn = (text, onClick, extra = {}) => h("button", {
          type: "button", className: "mwi-overview-button", onClick, disabled: busy, ...extra
        }, text);
        const slotButton = (type, key, label, id, enhLevel = null) => {
          const suffix = enhLevel != null ? "+" + enhLevel : "";
          return h("button", {
            type: "button", key: type + key,
            className: "mwi-draft-slot" + (kind === type && slot === key ? " is-active" : "") + (!id ? " is-empty" : ""),
            "aria-pressed": kind === type && slot === key,
            "aria-label": `${label}：${this.itemName(id, type === "ability")}${suffix ? " " + suffix : ""}`,
            title: id ? undefined : `${label}：空槽`,
            style: type === "equipment" && gearPositions[key] ? {
              gridRow: gearPositions[key][0], gridColumn: gearPositions[key][1]
            } : undefined,
            onClick: () => this.chooseSlot(type, key),
            onMouseEnter: id ? e => this.showTip(e, type, id, enhLevel || 0) : undefined,
            onMouseLeave: id ? e => this.hideTip(e) : undefined,
            onFocus: id ? e => this.showTip(e, type, id, enhLevel || 0) : undefined,
            onBlur: id ? e => this.hideTip(e) : undefined,
            onKeyDown: e => {
              if ((e.key === "Delete" || e.key === "Backspace") && id) {
                e.preventDefault();
                tooltip.hide();
                this.chooseSlot(type, key);
                this.change(next => {
                  if (type === "equipment") equip(next, key, null, 0, data);
                  else if (type === "ability") { next.abilityMap ||= {}; next.abilityMap[key] = null; }
                  else { const listKey = type === "food" ? "foodItemHrids" : "drinkItemHrids"; next[listKey] ||= [null, null, null]; next[listKey][key] = null; }
                });
              }
            }
          },
            h("span", { className: "mwi-draft-slot-head" },
              h("small", null, label),
              suffix && h("b", null, suffix)),
            icon(data, id, "mwi-draft-slot-icon"),
            id && h("span", { className: "mwi-draft-slot-val" }, this.itemName(id, type === "ability")));
        };

        const slotLabel = kind === "equipment" ? Core.EQUIPMENT[slot]
          : kind === "ability" ? (slot === 1 ? "特殊技能" : `技能 ${slot - 1}`)
          : `${kind === "food" ? "食物" : "饮料"} ${slot + 1}`;

        return h("form", {
          className: "mwi-draft-editor mwi-overview-card mwi-overview-card-active",
          onSubmit: this.save,
          "aria-label": "编辑虚拟配装",
          onKeyDown: e => {
            if (e.key !== "Escape" || busy) return;
            e.stopPropagation();
            if (this.state.discard) this.setState({ discard: false });
            else this.requestClose();
          }
        },
          h("fieldset", { disabled: busy },
            h("header", { className: "mwi-overview-card-head mwi-draft-head" },
              h("div", { className: "mwi-draft-head-left" },
                h("strong", { className: "mwi-draft-title" }, this.props.scene ? "编辑虚拟配装" : "新建虚拟配装"),
                h("input", {
                  className: "mwi-draft-name-input",
                  "aria-label": "配装名称",
                  value: title, maxLength: 60, required: true,
                  placeholder: "输入配装名称",
                  ref: node => { this.nameInput = node; },
                  onChange: e => this.setState({ title: e.target.value, dirty: true, overwrite: null })
                })),
              h("button", {
                type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn",
                "aria-label": "关闭编辑器", title: "关闭", onClick: this.requestClose
              }, "×")),

            h("div", { className: "mwi-draft-types-bar" },
              h("span", { className: "mwi-draft-group-label" }, "类型"),
              h("div", { className: "mwi-draft-types", role: "group", "aria-label": "配装类型" }, types.map(([id, label]) => {
                const action = id ? "/action_types/" + id : "";
                const active = (raw.actionTypeHrid || "") === action;
                return h("button", {
                  type: "button", key: id || "all",
                  className: "mwi-virtual-pill" + (active ? " is-active" : ""),
                  "aria-pressed": active, disabled: busy,
                  onClick: () => {
                    this.change(next => { next.actionTypeHrid = action; });
                    this.chooseSlot("equipment", "head");
                  }
                }, icon(data, id && id !== "combat" ? "/skills/" + id : null, "mwi-draft-type-icon"), label);
              }))),

            h("div", { className: "mwi-draft-body" },
              h("div", { className: "mwi-draft-layout" },
                h("div", { className: "mwi-draft-groups" },
                  h("div", { className: "mwi-draft-group" },
                    h("div", { className: "mwi-draft-group-label" }, "装备"),
                    h("div", { className: "mwi-draft-slots mwi-draft-gear", "aria-label": "装备槽位" }, gearEntries.map(([key, label]) => {
                      const item = Core.item(raw.wearableMap[location(key)]);
                      return slotButton("equipment", key, label, item?.itemHrid, item ? item.enhancementLevel : null);
                    }))),
                  !combat && h("div", { className: "mwi-draft-group" },
                    h("div", { className: "mwi-draft-group-label" }, "生活工具"),
                    h("div", { className: "mwi-draft-slots", "aria-label": "生活工具槽位" }, toolEntries.map(([key, label]) => {
                      const item = Core.item(raw.wearableMap[location(key)]);
                      return slotButton("equipment", key, label.replace(/工具$/, ""), item?.itemHrid, item ? item.enhancementLevel : null);
                    }))),
                  combat && h("div", { className: "mwi-draft-group" },
                    h("div", { className: "mwi-draft-group-label" }, "技能"),
                    h("div", { className: "mwi-draft-slots", "aria-label": "技能槽位" }, [1, 2, 3, 4, 5].map(index =>
                      slotButton("ability", index, index === 1 ? "特殊技能" : `技能 ${index - 1}`, raw.abilityMap?.[index])))),
                  h("div", { className: "mwi-draft-group" },
                    h("div", { className: "mwi-draft-group-label" }, combat ? "消耗品" : "饮料"),
                    h("div", { className: "mwi-draft-slots", "aria-label": "消耗品槽位" }, (combat ? ["food", "drink"] : ["drink"]).flatMap(type => [0, 1, 2].map(index =>
                      slotButton(type, index, `${type === "food" ? "食物" : "饮料"} ${index + 1}`, raw[type === "food" ? "foodItemHrids" : "drinkItemHrids"]?.[index])))))),

                h("div", { className: "mwi-draft-picker" },
                  h("div", { className: "mwi-draft-picker-head" },
                    h("strong", null, slotLabel),
                    btn("清空", () => this.select(null), { className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy || !currentId })),
                  kind === "equipment" && h("div", { className: "mwi-draft-level-wrap", "aria-label": "装备强化等级" },
                    h("div", { className: "mwi-draft-level" },
                      h("span", { className: "mwi-draft-label" }, "强化"),
                      h("div", { className: "mwi-draft-presets", role: "group", "aria-label": "常用强化等级" }, presets.map(n => h("button", {
                        type: "button", key: n,
                        className: "mwi-draft-preset" + (enhNum === n && String(enhancement).trim() !== "" ? " is-active" : ""),
                        "aria-label": `强化 +${n}`,
                        "aria-pressed": enhNum === n && String(enhancement).trim() !== "",
                        disabled: busy || !canEnhanceCurrent,
                        onClick: () => this.applyLevel(n)
                      }, `+${n}`))),
                      h("div", { className: "mwi-draft-stepper" },
                        btn("−", () => this.applyLevel(enhNum - 1), {
                          className: "mwi-overview-button mwi-overview-icon-btn",
                          "aria-label": "强化减一级", disabled: busy || enhNum <= 0 || !canEnhanceCurrent
                        }),
                        h("input", {
                          type: "number", min: 0, max: data.maxLevel, step: 1, required: true,
                          value: enhancement, "aria-label": "强化等级",
                          disabled: !canEnhanceCurrent,
                          onChange: e => { const value = e.target.value; this.setState({ enhancement: value }); if (value !== "") this.applyLevel(value); },
                          onBlur: () => this.applyLevel(enhancement),
                          onWheel: e => {
                            if (document.activeElement !== e.currentTarget || !canEnhanceCurrent || busy) return;
                            e.preventDefault();
                            const next = Math.max(0, Math.min(data.maxLevel, enhNum + (e.deltaY < 0 ? 1 : -1)));
                            if (next !== enhNum) this.applyLevel(next);
                          }
                        }),
                        btn("+", () => this.applyLevel(enhNum + 1), {
                          className: "mwi-overview-button mwi-overview-icon-btn",
                          "aria-label": "强化加一级", disabled: busy || enhNum >= data.maxLevel || !canEnhanceCurrent
                        }))),
                    canEnhanceCurrent
                      ? h("div", { className: "mwi-draft-slider-row" },
                          h("input", {
                            type: "range", className: "mwi-draft-slider",
                            min: 0, max: data.maxLevel, step: 1, value: enhNum,
                            "aria-label": "拖动选择强化等级",
                            disabled: busy || !canEnhanceCurrent,
                            onChange: e => this.applyLevel(e.target.value)
                          }),
                          h("span", { className: "mwi-draft-slider-max" }, `0–${data.maxLevel}`))
                      : h("small", { className: "mwi-draft-label" }, "不可强化")),
                  h("input", {
                    type: "search", value: query, "aria-label": "搜索可选物品", placeholder: "搜索名称…",
                    ref: node => { this.search = node; },
                    onKeyDown: e => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (candidates.length) this.select(candidates[0][0]);
                      } else if (e.key === "Escape" && query) {
                        e.stopPropagation();
                        this.setState({ query: "" });
                      }
                    },
                    onChange: e => this.setState({ query: e.target.value })
                  }),
                  h("div", { className: "mwi-draft-candidates", role: "group", "aria-label": `${slotLabel}可选内容` },
                    candidates.map(([id, detail]) => {
                      const previewEnh = kind === "equipment" && enhanceable(detail) ? enhNum : 0;
                      return h("button", {
                        type: "button", key: id,
                        className: "mwi-draft-candidate" + (currentId === id ? " is-selected" : ""),
                        "aria-pressed": currentId === id,
                        disabled: busy,
                        onClick: () => this.select(id),
                        onMouseEnter: e => this.showTip(e, kind, id, previewEnh),
                        onMouseLeave: e => this.hideTip(e),
                        onFocus: e => this.showTip(e, kind, id, previewEnh),
                        onBlur: e => this.hideTip(e)
                      }, icon(data, id, "mwi-draft-candidate-icon"), h("span", null, this.itemName(id, kind === "ability")));
                    }),
                    !candidates.length && h("p", { className: "mwi-virtual-empty" }, "没有匹配的物品")))),

              notice && h("p", { role: "alert", className: "mwi-virtual-notice mwi-cloud-warning mwi-draft-alert" }, notice),

              h("div", { className: "mwi-draft-footer" },
                h("div", { className: "mwi-draft-batch" },
                  h("label", null,
                    h("span", { className: "mwi-draft-label" }, "批量强化 +"),
                    h("input", {
                      type: "number", min: 0, max: data.maxLevel, step: 1, value: batch,
                      "aria-label": "批量强化等级", onChange: e => this.setState({ batch: e.target.value })
                    })),
                  btn("应用", () => this.change(next => {
                    const n = level(batch, data.maxLevel);
                    for (const [key, hash] of Object.entries(next.wearableMap)) {
                      const item = Core.item(hash);
                      if (item && enhanceable(data.items[item.itemHrid])) equip(next, key.split("/").pop(), item.itemHrid, n, data);
                    }
                    if (kind === "equipment") {
                      const updated = Core.item(next.wearableMap[location(slot)]);
                      this.setState({ enhancement: String(updated ? updated.enhancementLevel : n) });
                    }
                  }))),
                h("div", { className: "mwi-virtual-actions" },
                  this.state.discard && h("span", { className: "mwi-cloud-warning mwi-virtual-hint" }, "放弃未保存修改？"),
                  this.state.discard && btn("继续编辑", () => this.setState({ discard: false }), { className: "mwi-overview-button mwi-overview-ghost-btn" }),
                  btn(this.state.discard ? "确认放弃" : "取消", this.requestClose,
                    { className: this.state.discard ? "mwi-overview-button mwi-overview-danger" : "mwi-overview-button mwi-overview-ghost-btn" }),
                  this.props.scene && btn(this.state.overwrite?.asNew ? "再次点击覆盖" : "另存为新", event => { if (event.currentTarget.form.reportValidity()) this.save(event, true); }, {
                    className: "mwi-overview-button mwi-overview-ghost-btn", style: { minWidth: "9em" },
                    title: this.state.overwrite?.asNew ? `将覆盖“${this.state.title.trim()}”的原有内容` : "另存为新配装"
                  }),
                  h("button", { type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy,
                    style: { minWidth: "9em" },
                    title: this.state.overwrite && !this.state.overwrite.asNew ? `将覆盖“${this.state.title.trim()}”的原有内容` : "保存虚拟配装"
                  }, this.state.overwrite && !this.state.overwrite.asNew ? "再次点击覆盖" : "保存虚拟配装"))))));
      }
    };
  };
})(globalThis);

// ---- virtual_ui.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  function formatTime(ts) {
    const date = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  app.makeVirtualPanel = function (React, NativePreview) {
    const h = React.createElement;
    const VirtualEditor = app.makeVirtualEditor(React);
    function downloadShare(scene) {
      const url = URL.createObjectURL(new Blob([app.VirtualDraft.share(scene)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = scene.name.replace(/[\\/:*?"<>|]/g, "_") + ".json";
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    class Entry extends React.Component {
      state = {
        selected: "", target: "", title: "", notice: "", noticeError: false, copied: false,
        busy: false, removing: false, expanded: true, adoptOpen: false, menuOpen: false, shareText: ""
      };
      async run(work) {
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try { await work(); }
        catch (error) { if (this.alive) this.setState({ notice: error.message, noticeError: true }); }
        finally { if (this.alive) this.setState({ busy: false }); }
      }
      flashNotice(notice, noticeError = false) {
        clearTimeout(this.noticeTimer);
        if (!this.alive) return;
        this.setState({ notice, noticeError });
        if (notice && !noticeError) {
          this.noticeTimer = setTimeout(() => {
            if (this.alive && this.state.notice === notice) this.setState({ notice: "" });
          }, 2800);
        }
      }
      componentDidMount() { this.alive = true; }
      componentWillUnmount() { this.alive = false; clearTimeout(this.copyTimer); clearTimeout(this.noticeTimer); }
      componentDidUpdate(previous) {
        if (this.state.shareText && previous.entry !== this.props.entry) this.setState({ shareText: "" });
      }
      render() {
        const { entry, owner, nativeProps, nativeIcons, reload } = this.props;
        const { scenes, board } = entry;
        const scene = scenes.find(row => row.id === this.state.selected) || scenes[0];
        const choices = Object.values(nativeProps.characterLoadoutDict || {}).filter(raw =>
          scene && (raw.actionTypeHrid || "") === (scene.snapshot.raw.actionTypeHrid || ""));
        const resolvedTarget = this.state.target && choices.some(row => String(row.id) === this.state.target)
          ? this.state.target
          : choices.length === 1 ? String(choices[0].id) : "";
        const raw = choices.find(row => String(row.id) === resolvedTarget);
        const btn = (label, click, extra = "") => h("button", {
          type: "button",
          className: "mwi-overview-button" + (extra ? " " + extra : ""),
          disabled: this.state.busy,
          onClick: click
        }, label);

        const nativeScene = scenes.find(row => row.native);
        const title = nativeScene ? nativeScene.snapshot.raw.name : scene ? scene.name : "虚拟配装";
        const chipLabel = row => row.native ? "当前配装" : row.name;

        const adoptSubmit = event => {
          event?.preventDefault?.();
          this.run(async () => {
            if (!raw) throw Error("请选择要保存到的原生配装。");
            const fallbackName = (scene.native ? scene.snapshot.raw.name : scene.name).slice(0, 60);
            await app.Virtual.adopt(owner, scene, raw, this.state.title.trim() || fallbackName);
            if (this.alive) {
              this.setState({ adoptOpen: false, title: "" });
              this.flashNotice(`已保存到「${raw.name}」的子方案`);
            }
          });
        };

        const adoptDrawer = this.state.adoptOpen && scene && h("div", { className: "mwi-virtual-drawer" },
          !choices.length
            ? h("p", { className: "mwi-cloud-warning mwi-virtual-hint" }, "当前角色没有同类型的原生配装。")
            : h("form", { className: "mwi-virtual-adopt-form", onSubmit: adoptSubmit },
                h("div", { className: "mwi-virtual-adopt-fields" },
                  h("select", {
                    "aria-label": "保存到哪个原生配装",
                    value: resolvedTarget,
                    onChange: e => this.setState({ target: e.target.value })
                  },
                    choices.length > 1 && h("option", { value: "" }, "选择同类型原生配装…"),
                    choices.map(row => h("option", { key: row.id, value: row.id }, row.name))),
                  h("input", {
                    "aria-label": "子方案名称",
                    maxLength: 60,
                    value: this.state.title,
                    placeholder: scene.native ? scene.snapshot.raw.name : scene.name,
                    onChange: e => this.setState({ title: e.target.value })
                  })),
                h("div", { className: "mwi-virtual-actions" },
                  btn("取消", () => this.setState({ adoptOpen: false, notice: "" }), "mwi-overview-ghost-btn"),
                  h("button", {
                    type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: this.state.busy
                  }, "保存为子方案"))));

        const menuDrawer = (this.state.menuOpen || this.state.removing) && h("div", { className: "mwi-virtual-drawer" },
          h("div", { className: "mwi-virtual-meta-row" },
            h("span", { className: "mwi-virtual-meta", title: "上次读取：" + new Date(entry.checked).toLocaleString() },
              (board ? "同步于 " : "保存于 ") + formatTime(entry.checked)),
            board && h("a", {
              href: "https://clipboard.im/" + board, target: "_blank", rel: "noopener noreferrer",
              className: "mwi-virtual-link"
            }, "来源剪贴板")),
          !this.state.removing
            ? h("div", { className: "mwi-virtual-actions" },
                scene && btn("分享", () => this.setState({
                  expanded: true, menuOpen: false, adoptOpen: false, shareText: app.VirtualDraft.share(scene), notice: ""
                })),
                board && btn("检查更新", () => this.run(async () => {
                  await app.Virtual.refresh(owner, entry);
                  await reload();
                  if (this.alive) this.setState({ menuOpen: false });
                })),
                board && scene && btn("另存为本地副本", () => this.run(async () => {
                  const copyName = (scene.native ? scene.snapshot.raw.name : scene.name).slice(0, 60);
                  await app.Virtual.save(owner, copyName, scene.snapshot);
                  await reload();
                  if (this.alive) {
                    this.setState({ menuOpen: false });
                    this.flashNotice("已存为本地副本");
                  }
                })),
                btn(board ? "取消订阅" : "移除", () => this.setState({ removing: true }), "mwi-overview-danger-ghost"))
            : h("div", { className: "mwi-virtual-confirm" },
                h("span", null, board ? "取消订阅并移除缓存？" : "移除这份虚拟配装？"),
                h("div", { className: "mwi-virtual-actions" },
                  btn("保留", () => this.setState({ removing: false })),
                  btn("确认移除", () => this.run(async () => {
                    const removed = await app.Virtual.remove(owner, entry);
                    if (removed) this.props.onRemoved?.(removed, title);
                    await reload();
                  }), "mwi-overview-danger"))));

        const shareDrawer = this.state.shareText && h("div", { className: "mwi-virtual-drawer mwi-virtual-share" },
          h("div", { className: "mwi-virtual-drawer-head" },
            h("span", { className: "mwi-virtual-drawer-title" }, "分享虚拟配装"),
            h("button", {
              type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn",
              "aria-label": "关闭分享", title: "关闭", onClick: () => this.setState({ shareText: "" })
            }, "×")),
          h("textarea", {
            readOnly: true, rows: 3, value: this.state.shareText,
            "aria-label": "虚拟配装分享内容", onFocus: e => e.target.select()
          }),
          h("div", { className: "mwi-virtual-actions" },
            btn("下载 JSON", () => downloadShare(scene), "mwi-overview-ghost-btn"),
            btn(this.state.copied ? "已复制" : "复制内容", () => this.run(async () => {
              try {
                await navigator.clipboard.writeText(this.state.shareText);
                if (this.alive) {
                  clearTimeout(this.copyTimer);
                  this.setState({ copied: true });
                  this.copyTimer = setTimeout(() => { if (this.alive) this.setState({ copied: false }); }, 1800);
                }
              } catch (_) { throw Error("无法复制，请选中上方内容手动复制，或下载文件。"); }
            }), "mwi-overview-primary mwi-overview-copy-btn" + (this.state.copied ? " is-copied" : ""))));

        const sceneSwitcher = scenes.length > 1 && (scenes.length <= 5
          ? h("div", { className: "mwi-virtual-pills", role: "group", "aria-label": "切换配装内容" },
              scenes.map(row => h("button", {
                key: row.id,
                type: "button",
                className: "mwi-virtual-pill" + (row.id === scene.id ? " is-active" : ""),
                "aria-pressed": row.id === scene.id,
                title: row.name,
                onClick: () => this.setState({ selected: row.id, target: "", title: "", notice: "", shareText: "" })
              }, chipLabel(row))))
          : h("div", { className: "mwi-virtual-select-row" },
              h("select", {
                "aria-label": "切换配装内容",
                value: scene.id,
                onChange: e => this.setState({ selected: e.target.value, target: "", title: "", notice: "", shareText: "" })
              }, scenes.map(row => h("option", { key: row.id, value: row.id }, row.name)))));

        return h("article", {
          className: "mwi-virtual-card mwi-overview-card" +
            ((this.state.adoptOpen || this.state.menuOpen || this.state.shareText) ? " mwi-overview-card-active" : "") +
            (!this.state.expanded ? " mwi-overview-card-collapsed" : ""),
          onKeyDown: e => {
            if (e.key !== "Escape") return;
            if (this.state.removing) { e.stopPropagation(); this.setState({ removing: false }); }
            else if (this.state.adoptOpen || this.state.menuOpen || this.state.shareText) {
              e.stopPropagation();
              this.setState({ adoptOpen: false, menuOpen: false, shareText: "", notice: "" });
            }
          }
        },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null,
              h("button", {
                type: "button",
                className: "mwi-overview-fold",
                "aria-expanded": this.state.expanded,
                onClick: () => this.setState({ expanded: !this.state.expanded })
              },
                h("svg", {
                  className: "mwi-overview-chevron" + (this.state.expanded ? " is-open" : ""),
                  width: 12, height: 12, viewBox: "0 0 16 16",
                  fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round",
                  "aria-hidden": true
                }, h("path", { d: "M6 4l4 4-4 4" })),
                nativeIcons?.[scene?.snapshot.raw.actionTypeHrid || ""],
                h("span", { className: "mwi-overview-name" }, title),
                (entry.error || board) && h("span", {
                  className: "mwi-virtual-tag" + (entry.error ? " mwi-cloud-warning" : "")
                }, entry.error ? "缓存" : "订阅"))),
            h("div", { className: "mwi-overview-card-actions" },
              scene && !board && btn("编辑", () => this.props.onEdit(entry, scene), "mwi-overview-scenes-btn"),
              scene && h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-scenes-btn" + (this.state.adoptOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": this.state.adoptOpen,
                onClick: () => this.setState({
                  expanded: true, adoptOpen: !this.state.adoptOpen, menuOpen: false, shareText: "", removing: false, notice: ""
                })
              }, "存为子方案"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn" + (this.state.menuOpen ? " mwi-overview-scenes-active" : ""),
                "aria-label": "更多操作",
                title: "更多操作",
                "aria-expanded": this.state.menuOpen,
                onClick: () => this.setState({
                  expanded: true, menuOpen: !this.state.menuOpen, adoptOpen: false, shareText: "", removing: false
                })
              }, "⋯"))),
          this.state.expanded && h("div", { className: "mwi-virtual-body" },
            entry.error && h("div", { className: "mwi-virtual-error" },
              h("span", null, "更新失败：" + entry.error),
              board && btn("重试", () => this.run(async () => { await app.Virtual.refresh(owner, entry); await reload(); }))),
            sceneSwitcher,
            adoptDrawer,
            menuDrawer,
            shareDrawer,
            this.state.notice && h("p", {
              role: "status",
              className: "mwi-virtual-notice" + (this.state.noticeError ? " mwi-cloud-warning" : "")
            }, this.state.notice),
            scene
              ? h(Snapshot, { snapshot: scene.snapshot, nativeProps, getCatalog: this.props.getCatalog })
              : h("p", { className: "mwi-virtual-empty" }, "来源暂无可显示的配装内容。")));
      }
    }

    class Snapshot extends React.Component {
      render() {
        const { snapshot, nativeProps, getCatalog } = this.props, raw = snapshot.raw;
        const activeFlags = [
          ["默认", Boolean(raw.isDefault)],
          ["缺失不提醒", Boolean(raw.suppressValidation)],
          ["最高强化", !raw.useExactEnhancement]
        ].filter(([, on]) => on);
        return h("div", null,
          activeFlags.length > 0 && h("div", { className: "mwi-virtual-options", "aria-label": "配装选项（只读）" },
            activeFlags.map(([label]) => h("span", {
              key: label,
              className: "mwi-virtual-flag is-on",
              "aria-label": `${label}：已启用`
            }, "✓ " + label))),
          NativePreview ? h(NativePreview, { snapshot, nativeProps, getCatalog }) : h("p", { className: "mwi-virtual-empty" }, "图标预览暂不可用，请刷新游戏后重试。"));
      }
    }

    return class VirtualPanel extends React.Component {
      state = {
        entries: [], input: "", notice: "", noticeError: false, exported: false, busy: false, loading: true,
        subscribeOpen: false, editor: null, importOpen: false, importText: "",
        draft: null, undo: null
      };
      componentDidMount() {
        this.alive = true;
        const draft = app.VirtualDraft?.readDraft?.(this.props.owner) || null;
        if (draft) this.setState({ draft });
        this.unwatch = app.Virtual.watch?.(() => this.reload());
        this.check();
        this.timer = setInterval(() => this.check(), 30000);
      }
      componentWillUnmount() {
        this.alive = false;
        this.unwatch?.();
        clearInterval(this.timer);
        clearTimeout(this.exportTimer);
        clearTimeout(this.noticeTimer);
        app.VirtualTooltip?.hide?.();
      }
      flashNotice(notice, noticeError = false) {
        clearTimeout(this.noticeTimer);
        if (!this.alive) return;
        this.setState({ notice, noticeError });
        if (notice && !noticeError) {
          this.noticeTimer = setTimeout(() => {
            if (this.alive && this.state.notice === notice) this.setState({ notice: "" });
          }, 3000);
        }
      }
      fail(error) { if (this.alive) this.setState({ notice: error.message, noticeError: true, loading: false }); }
      reload = async () => {
        const entries = await app.Virtual.list(this.props.owner);
        if (this.alive) {
          this.props.onCountChange?.(entries.length);
          const signature = JSON.stringify(entries);
          if (signature !== this.signature) {
            this.signature = signature;
            this.setState({ entries, loading: false });
          } else if (this.state.loading) {
            this.setState({ loading: false });
          }
        }
      };
      async check() {
        if (this.checking) return;
        this.checking = true;
        try {
          const entries = await app.Virtual.list(this.props.owner);
          for (const entry of entries) {
            if (!this.alive || document.hidden || root.navigator.onLine === false) break;
            if (entry.board && Date.now() - (entry.attempted || 0) >= 300000)
              await app.Virtual.refresh(this.props.owner, entry);
          }
          await this.reload();
        } catch (error) { this.fail(error); }
        finally { this.checking = false; }
      }
      subscribe = async event => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          await app.Virtual.subscribe(this.props.owner, this.state.input);
          await this.reload();
          if (this.alive) this.setState({ input: "", subscribeOpen: false, notice: "" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      edit = (entry = null, scene = null, draft = null) => {
        if (this.state.editor) {
          this.setState({ notice: "请先保存或取消当前编辑。", noticeError: true });
          this.editorTop?.scrollIntoView({ block: "nearest" });
          return;
        }
        try {
          this.setState({
            editor: { entry, scene, draft, catalog: this.props.getCatalog() },
            notice: "", noticeError: false, importOpen: false, subscribeOpen: false
          });
        } catch (error) { this.fail(error); }
      };
      resumeDraft = () => {
        const draft = this.state.draft;
        if (!draft) return;
        const matched = draft.entryKey && this.state.entries.find(row =>
          !row.board && row.key === draft.entryKey && row.token === draft.entryToken);
        this.edit(matched || null, matched?.scenes?.[0] || null, draft);
      };
      discardDraft = () => {
        app.VirtualDraft?.clearDraft?.(this.props.owner);
        this.setState({ draft: null });
      };
      persistDraft = payload => {
        const editor = this.state.editor;
        app.VirtualDraft?.saveDraft?.(this.props.owner, {
          ...payload,
          entryKey: editor?.entry?.key || editor?.draft?.entryKey || null,
          entryToken: editor?.entry?.token || editor?.draft?.entryToken || null
        });
      };
      cancelEditor = () => {
        app.VirtualDraft?.clearDraft?.(this.props.owner);
        this.setState({ editor: null, draft: null });
      };
      saveDraft = async (title, snapshot, asNew = false, expected = null) => {
        const { owner } = this.props, editor = this.state.editor;
        if (app.Adapter.cloudContext(false)?.character !== owner) throw Error("角色已变化，请重新打开配装总览。");
        if (editor.entry && !asNew) await app.Virtual.update(owner, editor.entry, title, snapshot);
        else await app.Virtual.save(owner, title, snapshot, expected);
        app.VirtualDraft?.clearDraft?.(owner);
        if (this.alive) this.setState({ editor: null, draft: null, notice: "", noticeError: false });
        await this.reload();
      };
      handleRemoved = (entry, title) => {
        if (this.alive) this.setState({ undo: { entry, title }, notice: "", noticeError: false });
      };
      restoreRemoved = async () => {
        const undo = this.state.undo;
        if (!undo || this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        try {
          await app.Virtual.restore(this.props.owner, undo.entry);
          await this.reload();
          if (this.alive) this.setState({ undo: null, notice: "" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      exportAll = () => {
        try {
          const text = app.Virtual.exportBackup(this.state.entries);
          const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `虚拟配装备份-${new Date().toISOString().slice(0, 10)}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
          clearTimeout(this.exportTimer);
          this.setState({ exported: true });
          this.exportTimer = setTimeout(() => { if (this.alive) this.setState({ exported: false }); }, 1800);
        } catch (error) { this.fail(error); }
      };
      importShare = async event => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "", noticeError: false });
        const key = this.props.owner + "|" + this.state.importText;
        const expected = this.state.importOverwrite?.key === key ? this.state.importOverwrite.existing : null;
        try {
          if (app.Adapter.cloudContext(false)?.character !== this.props.owner) throw Error("角色已变化，请重新打开配装总览。");
          const text = this.state.importText;
          let parsedJson = null;
          try { parsedJson = JSON.parse(text); } catch (_) { /* Validated below. */ }
          if (parsedJson?.format === "mwi-layu-loadout-scenes")
            throw Error("这是子方案备份，请在对应配装卡片的「子方案 → ⋯ → 导入备份」中导入。");
          if (parsedJson?.format === "mwi-vue-solo")
            throw Error("这是战斗模拟器配装，请在战斗配装卡片的「子方案 → 导入」中导入。");
          if (parsedJson?.format === "mwi-virtual-loadouts-backup") {
            const { added, skipped, overwritten = 0 } = await app.Virtual.importBackup(this.props.owner, text, Array.isArray(expected) ? expected : []);
            await this.reload();
            if (this.alive) {
              this.setState({ importOpen: false, importText: "", importOverwrite: null });
              this.flashNotice(added || overwritten ? `已新增 ${added} 项，覆盖 ${overwritten} 项${skipped ? `（跳过 ${skipped} 项重复）` : ""}` : "内容均已存在，未重复导入");
            }
          } else {
            const scene = app.VirtualDraft.parse(text);
            await app.Virtual.save(this.props.owner, scene.name, scene.snapshot, expected);
            await this.reload();
            if (this.alive) this.setState({ importOpen: false, importText: "", importOverwrite: null, notice: "", noticeError: false });
          }
        } catch (error) {
          if (error.code === "NAME_EXISTS" && this.alive) {
            const entries = Array.isArray(error.existing) ? error.existing : [error.existing];
            this.setState({ importOverwrite: { key, existing: error.existing }, noticeError: false,
              notice: "再次点击将覆盖：" + entries.map(row => `“${row.scenes[0].name}”`).join("、") });
          } else { if (this.alive) this.setState({ importOverwrite: null }); this.fail(error); }
        }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      handleImportFile = async event => {
        const input = event.target, file = input.files?.[0];
        if (!file) return;
        this.setState({ busy: true, notice: "", noticeError: false, importOverwrite: null });
        try {
          if (file.size > 5000000) throw Error("文件超过 5 MB 大小限制。");
          const text = await file.text();
          if (this.alive) this.setState({ importText: text, importOverwrite: null });
        } catch (error) { this.fail(error); }
        finally { input.value = ""; if (this.alive) this.setState({ busy: false }); }
      };
      render() {
        const { entries, loading, subscribeOpen, importOpen, editor, draft, undo, input, notice, noticeError, busy } = this.state;
        return h("section", { id: "mwi-virtual-section", className: "mwi-virtual-panel", "aria-label": "虚拟配装" },
          h("div", { className: "mwi-virtual-head" },
            h("div", { className: "mwi-virtual-head-left" },
              h("h2", null, "虚拟配装"),
              entries.length > 0 && h("span", { className: "mwi-overview-scene-count" }, String(entries.length)),
              !loading && !entries.length && !subscribeOpen && !importOpen && !editor && !draft && !undo &&
                h("span", { className: "mwi-virtual-empty-inline" }, "暂无副本或订阅")),
            h("div", { className: "mwi-virtual-actions" },
              h("button", {
                type: "button",
                className: "mwi-overview-button" + (editor ? " mwi-overview-scenes-active" : ""),
                disabled: Boolean(editor),
                onClick: () => this.edit()
              }, "+ 新建"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn" + (importOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": importOpen,
                disabled: Boolean(editor),
                onClick: () => this.setState({ importOpen: !importOpen, subscribeOpen: false, notice: "", importOverwrite: null })
              }, "导入分享"),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn" + (subscribeOpen ? " mwi-overview-scenes-active" : ""),
                "aria-expanded": subscribeOpen,
                disabled: Boolean(editor),
                onClick: () => this.setState({ subscribeOpen: !subscribeOpen, importOpen: false, notice: "" })
              }, "+ 订阅配装"),
              entries.length > 0 && h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-ghost-btn mwi-overview-copy-btn" + (this.state.exported ? " is-copied" : ""),
                disabled: busy,
                title: "导出全部虚拟配装与订阅备份",
                onClick: this.exportAll
              }, this.state.exported ? "已导出" : "导出备份"))),

          !editor && draft && h("div", { className: "mwi-virtual-banner", role: "status" },
            h("span", null, `有未保存草稿「${draft.title || "未命名"}」`),
            h("div", { className: "mwi-virtual-actions" },
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-primary", onClick: this.resumeDraft }, "继续编辑"),
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", onClick: this.discardDraft }, "丢弃"))),

          undo && h("div", { className: "mwi-virtual-banner", role: "status" },
            h("span", null, `已移除“${undo.title}”`),
            h("div", { className: "mwi-virtual-actions" },
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-primary", disabled: busy, onClick: this.restoreRemoved }, "撤销"),
              h("button", { type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn", "aria-label": "关闭提示", onClick: () => this.setState({ undo: null }) }, "×"))),

          editor && h("div", { ref: node => { this.editorTop = node; } }, h(VirtualEditor, {
            scene: editor.scene, draft: editor.draft, catalog: editor.catalog, nativeProps: this.props.nativeProps,
            onDraftChange: this.persistDraft,
            onSave: this.saveDraft, onCancel: this.cancelEditor
          })),

          importOpen && h("form", {
            className: "mwi-virtual-bar mwi-virtual-share",
            onSubmit: this.importShare,
            onKeyDown: e => { if (e.key === "Escape") { e.stopPropagation(); this.setState({ importOpen: false, notice: "" }); } }
          },
            h("div", { className: "mwi-virtual-drawer-head" },
              h("span", { className: "mwi-virtual-drawer-title" }, "导入虚拟配装（分享 / 备份）"),
              h("button", {
                type: "button", className: "mwi-overview-button mwi-overview-icon-btn mwi-overview-ghost-btn",
                "aria-label": "关闭导入", title: "关闭", disabled: busy,
                onClick: () => this.setState({ importOpen: false, notice: "" })
              }, "×")),
            h("textarea", {
              required: true, maxLength: 5000000, rows: 4, value: this.state.importText,
              "aria-label": "虚拟配装分享内容", placeholder: "粘贴单条虚拟配装分享或虚拟配装备份 JSON，或选择文件", disabled: busy,
              onChange: e => this.setState({ importText: e.target.value, importOverwrite: null, notice: "" })
            }),
            h("input", {
              type: "file", accept: ".json,.txt,application/json", hidden: true,
              "aria-label": "选择虚拟配装分享文件",
              ref: node => { this.importFileInput = node; },
              onChange: this.handleImportFile
            }),
            h("div", { className: "mwi-virtual-split-actions" },
              h("button", {
                type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
                onClick: () => this.importFileInput?.click()
              }, "选择文件"),
              h("div", { className: "mwi-virtual-actions" },
                h("button", {
                  type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
                  onClick: () => this.setState({ importOpen: false, notice: "" })
                }, "取消"),
                h("button", {
                  type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy, style: { minWidth: "9em" }
                }, this.state.importOverwrite ? "再次点击覆盖" : "导入为新配装")))),

          subscribeOpen && h("form", {
            className: "mwi-virtual-subscribe",
            onSubmit: this.subscribe,
            onKeyDown: e => { if (e.key === "Escape") { e.stopPropagation(); this.setState({ subscribeOpen: false, notice: "" }); } }
          },
            h("input", {
              "aria-label": "配装分享地址",
              placeholder: "粘贴 clipboard.im 分享地址或 ID",
              value: input,
              onChange: e => this.setState({ input: e.target.value }),
              required: true
            }),
            h("button", { type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy }, busy ? "读取中…" : "订阅"),
            h("button", {
              type: "button", className: "mwi-overview-button mwi-overview-ghost-btn", disabled: busy,
              onClick: () => this.setState({ subscribeOpen: false, notice: "" })
            }, "取消")),

          notice && h("p", {
            role: "status",
            className: "mwi-virtual-notice mwi-virtual-panel-notice" + (noticeError ? " mwi-cloud-warning" : "")
          }, notice),
          loading && h("p", { className: "mwi-virtual-empty" }, "读取中…"),
          entries.length > 0 && h("div", { className: "mwi-virtual-grid" }, entries.map(entry =>
            h(Entry, {
              key: entry.token,
              entry,
              owner: this.props.owner,
              nativeProps: this.props.nativeProps,
              nativeIcons: this.props.nativeIcons,
              getCatalog: this.props.getCatalog,
              onEdit: this.edit,
              onRemoved: this.handleRemoved,
              reload: this.reload
            }))));
      }
    };
  };
})(globalThis);

// ---- overview.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  const css = "/* Overview & Virtual Loadouts — Minimalist Dark Surface System\n   Principles: tonal elevation over heavy borders, ghost-first utilities,\n   single-hue functional accents, crisp tabular numerals. */\n\n.mwi-overview-toolbar,\n[data-mwi-loadout-overview],\n.mwi-virtual-panel {\n  --mwi-inset: #131620;\n  --mwi-drawer: #151824;\n  --mwi-surface: #1b1e2b;\n  --mwi-surface-head: rgba(255, 255, 255, 0.025);\n  --mwi-hover: rgba(255, 255, 255, 0.07);\n  --mwi-active-pill: rgba(255, 255, 255, 0.11);\n  --mwi-line: rgba(255, 255, 255, 0.075);\n  --mwi-line-soft: rgba(255, 255, 255, 0.05);\n  --mwi-line-strong: rgba(255, 255, 255, 0.14);\n  --mwi-text: #eef0f8;\n  --mwi-text-muted: #969db8;\n  --mwi-text-faint: #6c7391;\n  --mwi-accent: #4c63c4;\n  --mwi-accent-hover: #5a72d4;\n  --mwi-accent-line: rgba(132, 154, 248, 0.55);\n  --mwi-ok: #6ad89a;\n  --mwi-warn: #f2c46d;\n  --mwi-warn-bg: rgba(242, 196, 109, 0.11);\n  --mwi-warn-line: rgba(242, 196, 109, 0.34);\n  --mwi-danger: #ec868e;\n  --mwi-danger-bg: rgba(236, 134, 142, 0.14);\n  --mwi-danger-line: rgba(236, 134, 142, 0.48);\n  --mwi-ease: cubic-bezier(0.16, 1, 0.3, 1);\n}\n\n.mwi-overview-toolbar [hidden],\n.mwi-overview-card [hidden],\n.mwi-virtual-panel [hidden] {\n  display: none !important;\n}\n\n/* Overview Toolbar */\n.mwi-overview-toolbar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .45rem .65rem;\n  margin-block: .2rem .75rem;\n  text-align: start;\n}\n.mwi-overview-segmented {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  padding: 2px;\n  background: var(--mwi-inset);\n  border: 1px solid var(--mwi-line);\n  border-radius: 7px;\n}\n.mwi-overview-seg-btn {\n  color: var(--mwi-text-muted);\n  background: transparent;\n  border: 0;\n  border-radius: 5px;\n  font: inherit;\n  font-size: .82rem;\n  font-weight: 500;\n  padding: .26rem .65rem;\n  min-height: 1.8rem;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background-color .14s var(--mwi-ease), color .14s ease;\n}\n.mwi-overview-seg-btn:hover { color: var(--mwi-text); background: var(--mwi-hover); }\n.mwi-overview-seg-btn.is-active {\n  background: var(--mwi-active-pill);\n  color: #ffffff;\n}\n\n.mwi-overview-filter {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .4rem;\n  min-width: 0;\n}\n.mwi-overview-search {\n  position: relative;\n  display: inline-flex;\n  align-items: center;\n  min-width: 0;\n  color: var(--mwi-text-faint);\n}\n.mwi-overview-search-icon {\n  position: absolute;\n  inset-inline-start: .5rem;\n  width: 13px;\n  height: 13px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.6;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  pointer-events: none;\n  transition: color .14s ease;\n}\n.mwi-overview-search:focus-within { color: var(--mwi-text-muted); }\n.mwi-overview-search-input {\n  width: 8.75rem;\n  max-width: 100%;\n  min-height: 1.9rem;\n  padding: .22rem 1.55rem .22rem 1.7rem;\n  background: var(--mwi-inset);\n  color: var(--mwi-text);\n  border: 1px solid var(--mwi-line);\n  border-radius: 7px;\n  font: inherit;\n  font-size: .82rem;\n  transition: width .16s var(--mwi-ease), border-color .14s ease, background-color .14s ease;\n}\n.mwi-overview-search-input::-webkit-search-cancel-button { display: none; }\n.mwi-overview-search-input::placeholder { color: var(--mwi-text-faint); }\n.mwi-overview-search-input:hover { border-color: var(--mwi-line-strong); }\n.mwi-overview-search-input:focus,\n.mwi-overview-search.has-value .mwi-overview-search-input {\n  width: 10.5rem;\n  border-color: var(--mwi-line-strong);\n}\n.mwi-overview-search-clear {\n  position: absolute;\n  inset-inline-end: 3px;\n  width: 1.35rem;\n  height: 1.35rem;\n  padding: 0;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  color: var(--mwi-text-muted);\n  font: inherit;\n  line-height: 1;\n  cursor: pointer;\n  transition: background-color .12s ease, color .12s ease;\n}\n.mwi-overview-search-clear:hover { background: var(--mwi-hover); color: #ffffff; }\n\n.mwi-overview-filter-tabs {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n}\n.mwi-overview-filter-tab {\n  color: var(--mwi-text-muted);\n  background: transparent;\n  border: 0;\n  border-radius: 6px;\n  font: inherit;\n  font-size: .82rem;\n  font-weight: 500;\n  padding: .28rem .58rem;\n  min-height: 1.85rem;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background-color .14s var(--mwi-ease), color .14s ease;\n}\n.mwi-overview-filter-tab:hover { color: var(--mwi-text); background: var(--mwi-hover); }\n.mwi-overview-filter-tab.is-active {\n  background: var(--mwi-active-pill);\n  color: #ffffff;\n}\n\n.mwi-overview-toolbar-right {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .25rem;\n  margin-inline-start: auto;\n}\n.mwi-overview-toolbar-note {\n  flex: 0 0 100%;\n  font-size: .82rem;\n  color: var(--mwi-warn);\n}\n.mwi-overview-empty-filter {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .5rem;\n  padding: .7rem .85rem;\n  background: var(--mwi-drawer);\n  border: 1px solid var(--mwi-line);\n  border-radius: 8px;\n  color: var(--mwi-text-muted);\n  font-size: .84rem;\n}\n\n.mwi-overview-seg-btn:focus-visible,\n.mwi-overview-filter-tab:focus-visible,\n.mwi-overview-search-input:focus-visible,\n.mwi-overview-button:focus-visible,\n.mwi-overview-fold:focus-visible,\n.mwi-overview-cloud-btn:focus-visible,\n.mwi-overview-cloud-tally:focus-visible,\n.mwi-virtual-pill:focus-visible {\n  outline: 2px solid #9ecfff;\n  outline-offset: 2px;\n}\n\n/* Overview Grid & Cards */\n[data-mwi-loadout-overview] {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.5rem), 1fr));\n  align-items: start;\n  gap: .75rem;\n  text-align: start;\n}\n.mwi-overview-card {\n  container-type: inline-size;\n  min-width: 0;\n  border: 1px solid var(--mwi-line);\n  border-radius: var(--radius-sm, 9px);\n  background: var(--mwi-surface);\n  color: var(--mwi-text);\n  transition: border-color .16s var(--mwi-ease), box-shadow .18s var(--mwi-ease);\n}\n.mwi-overview-card:hover {\n  border-color: var(--mwi-line-strong);\n}\n.mwi-overview-card-active {\n  border-color: var(--mwi-accent-line);\n  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.24);\n}\n.mwi-overview-card-active:hover {\n  border-color: rgba(142, 164, 255, 0.72);\n}\n.mwi-overview-card-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .25rem .35rem;\n  min-height: 2.45rem;\n  padding: .25rem .5rem;\n  background: var(--mwi-surface-head);\n  border-block-end: 1px solid var(--mwi-line-soft);\n  border-start-start-radius: inherit;\n  border-start-end-radius: inherit;\n}\n.mwi-overview-card-collapsed .mwi-overview-card-head {\n  border-block-end: 0;\n  border-radius: inherit;\n}\n.mwi-overview-card-head h3 {\n  display: flex;\n  align-items: center;\n  flex: 1 1 6.5rem;\n  min-width: 0;\n  margin: 0;\n  font-size: .92rem;\n  font-weight: 600;\n  letter-spacing: -0.005em;\n}\n.mwi-overview-fold {\n  display: flex;\n  align-items: center;\n  gap: .32rem;\n  flex: 1 1 auto;\n  min-width: 0;\n  min-height: 1.95rem;\n  padding: .15rem .28rem;\n  margin: 0;\n  border: 0;\n  border-radius: 6px;\n  background: transparent;\n  color: inherit;\n  font: inherit;\n  text-align: start;\n  cursor: pointer;\n  transition: background-color .14s var(--mwi-ease);\n}\n.mwi-overview-fold:hover { background: var(--mwi-hover); }\n.mwi-overview-chevron {\n  flex: 0 0 auto;\n  width: 12px;\n  height: 12px;\n  fill: none;\n  stroke: var(--mwi-text-faint);\n  stroke-width: 1.9;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  transition: transform .15s var(--mwi-ease), stroke .14s ease;\n}\n.mwi-overview-chevron.is-open { transform: rotate(90deg); }\n.mwi-overview-fold:hover .mwi-overview-chevron { stroke: var(--mwi-text-muted); }\n.mwi-overview-name {\n  min-width: 0;\n  overflow-wrap: anywhere;\n  line-height: 1.3;\n}\n.mwi-overview-card-actions {\n  display: flex;\n  align-items: center;\n  gap: .15rem;\n  flex: 0 0 auto;\n  margin-inline-start: auto;\n}\n\n/* Buttons — Strict Hierarchy (Primary / Secondary / Ghost) */\n.mwi-overview-button {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: .3rem;\n  color: var(--mwi-text);\n  background: rgba(255, 255, 255, 0.055);\n  border: 1px solid var(--mwi-line);\n  border-radius: 6px;\n  font: inherit;\n  font-size: .81rem;\n  font-weight: 500;\n  padding: .24rem .55rem;\n  min-height: 1.85rem;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background-color .14s var(--mwi-ease), border-color .14s var(--mwi-ease), color .14s ease;\n}\n.mwi-overview-button:hover:not(:disabled) {\n  background: var(--mwi-active-pill);\n  border-color: var(--mwi-line-strong);\n  color: #ffffff;\n}\n.mwi-overview-button:disabled { opacity: .45; cursor: not-allowed; }\n\n.mwi-overview-ghost-btn {\n  background: transparent;\n  border-color: transparent;\n  color: var(--mwi-text-muted);\n}\n.mwi-overview-ghost-btn:hover:not(:disabled) {\n  background: var(--mwi-hover);\n  border-color: transparent;\n  color: var(--mwi-text);\n}\n\n.mwi-overview-primary {\n  background: var(--mwi-accent);\n  border-color: rgba(142, 164, 255, 0.42);\n  color: #ffffff;\n}\n.mwi-overview-primary:hover:not(:disabled) {\n  background: var(--mwi-accent-hover);\n  border-color: rgba(158, 178, 255, 0.65);\n}\n.mwi-overview-copy-btn { min-width: 5.2em; }\n.mwi-overview-copy-btn.is-copied,\n.mwi-overview-copy-btn.is-copied:hover:not(:disabled) {\n  color: var(--mwi-ok);\n}\n.mwi-overview-primary.is-copied,\n.mwi-overview-primary.is-copied:hover:not(:disabled) {\n  background: rgba(106, 216, 154, 0.22);\n  border-color: rgba(106, 216, 154, 0.55);\n  color: #d8fbe6;\n}\n\n.mwi-overview-danger {\n  background: var(--mwi-danger-bg);\n  border-color: var(--mwi-danger-line);\n  color: var(--mwi-danger);\n}\n.mwi-overview-danger:hover:not(:disabled) {\n  background: rgba(236, 134, 142, 0.24);\n  border-color: rgba(236, 134, 142, 0.72);\n}\n.mwi-overview-danger-ghost {\n  background: transparent;\n  border-color: transparent;\n  color: var(--mwi-danger);\n}\n.mwi-overview-danger-ghost:hover:not(:disabled) {\n  background: var(--mwi-danger-bg);\n  border-color: transparent;\n}\n.mwi-overview-icon-btn { min-width: 1.85rem; padding-inline: .32rem; }\n\n.mwi-overview-scenes-btn {\n  background: transparent;\n  border-color: transparent;\n  color: var(--mwi-text-muted);\n  padding: .2rem .48rem;\n}\n.mwi-overview-scenes-btn:hover:not(:disabled) {\n  background: var(--mwi-hover);\n  border-color: transparent;\n  color: var(--mwi-text);\n}\n.mwi-overview-scenes-active,\n.mwi-overview-scenes-active:hover:not(:disabled) {\n  background: var(--mwi-accent);\n  border-color: rgba(142, 164, 255, 0.42);\n  color: #ffffff;\n}\n.mwi-overview-scene-count {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  min-width: 1.1rem;\n  height: 1.1rem;\n  padding: 0 .28rem;\n  border-radius: 999px;\n  background: rgba(255, 255, 255, 0.09);\n  color: var(--mwi-text);\n  font-size: .72rem;\n  font-variant-numeric: tabular-nums;\n  line-height: 1;\n}\n.mwi-overview-scenes-active .mwi-overview-scene-count {\n  background: rgba(255, 255, 255, 0.22);\n  color: #ffffff;\n}\n\n/* Cloud Icon Trigger & Warning Pill */\n.mwi-overview-cloud-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: .3rem;\n  min-width: 1.8rem;\n  min-height: 1.8rem;\n  padding: .18rem .35rem;\n  border: 1px solid transparent;\n  border-radius: 6px;\n  background: transparent;\n  color: var(--mwi-text-faint);\n  font: inherit;\n  font-size: .77rem;\n  font-weight: 500;\n  cursor: pointer;\n  white-space: nowrap;\n  transition: background-color .14s var(--mwi-ease), border-color .14s ease, color .14s ease;\n}\n.mwi-overview-cloud-btn:hover {\n  background: var(--mwi-hover);\n  color: var(--mwi-text);\n}\n.mwi-overview-cloud-icon {\n  width: 15px;\n  height: 15px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.5;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n  flex: 0 0 auto;\n}\n.mwi-overview-cloud-pip {\n  fill: transparent;\n  stroke: none;\n  transition: fill .14s ease;\n}\n.mwi-overview-cloud-btn[data-state=\"ok\"] { color: var(--mwi-text-muted); }\n.mwi-overview-cloud-btn[data-state=\"ok\"] .mwi-overview-cloud-pip { fill: var(--mwi-ok); }\n.mwi-overview-cloud-btn[data-state=\"busy\"] { color: #8ec5ff; }\n.mwi-overview-cloud-btn[data-state=\"busy\"] .mwi-overview-cloud-pip { fill: #70b7ff; }\n.mwi-overview-cloud-btn[data-state=\"warn\"] .mwi-overview-cloud-pip { fill: var(--mwi-warn); }\n.mwi-overview-cloud-active {\n  background: rgba(76, 99, 196, 0.28);\n  border-color: var(--mwi-accent-line);\n  color: #ffffff;\n}\n.mwi-overview-cloud-btn.mwi-cloud-warning {\n  padding: .18rem .48rem;\n  border-radius: 999px;\n  background: var(--mwi-warn-bg);\n  border-color: var(--mwi-warn-line);\n  color: var(--mwi-warn);\n}\n.mwi-overview-cloud-btn.mwi-cloud-warning:hover {\n  background: rgba(242, 196, 109, 0.18);\n  color: var(--mwi-warn);\n}\n\n.mwi-overview-cloud-tally {\n  display: inline-flex;\n  align-items: center;\n  gap: .3rem;\n  padding: .22rem .58rem;\n  min-height: 1.85rem;\n  border-radius: 999px;\n  border: 1px solid var(--mwi-warn-line);\n  background: var(--mwi-warn-bg);\n  color: var(--mwi-warn);\n  font: inherit;\n  font-size: .8rem;\n  font-weight: 500;\n  cursor: pointer;\n  transition: background-color .14s var(--mwi-ease);\n}\n.mwi-overview-cloud-tally:hover { background: rgba(242, 196, 109, 0.18); }\n.mwi-overview-cloud.mwi-cloud-warning { color: var(--mwi-warn); }\n\n/* Card Options & Native Slot Grid */\n.mwi-overview-options {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .1rem .6rem;\n  padding: .12rem .625rem;\n  border-block-end: 1px solid var(--mwi-line-soft);\n  background: transparent;\n}\n.mwi-overview-options [class*=\"MuiFormControlLabel-root\"] { margin: 0; min-height: 1.85rem; }\n.mwi-overview-options [class*=\"MuiTypography-root\"] { font-size: .79rem; color: var(--mwi-text-muted); }\n.mwi-overview-notice { padding: .48rem .625rem; margin: 0; color: var(--mwi-warn); font-size: .84rem; }\n\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_selectedLoadout__\"] { padding: 0; align-items: stretch; }\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_details__\"] { min-width: 0; width: 100%; margin: 0; }\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_details__\"] [class*=\"LoadoutsPanel_setup__\"] {\n  --item-size-normal: min(3.75rem, max(1px, calc((100cqi - 2.25rem) / 5)));\n  width: 100%;\n  box-sizing: border-box;\n  padding: .55rem .625rem .625rem;\n  gap: .55rem;\n  background: transparent;\n}\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_playerModel__\"],\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_abilities__\"],\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_consumables__\"] { gap: .25rem; }\n.mwi-overview-tools {\n  grid-area: 5 / 1 / span 1 / -1;\n  margin-block-start: .25rem;\n  padding-top: .3rem;\n  border-top: 1px solid var(--mwi-line-soft);\n  font-size: .78rem;\n  color: var(--mwi-text-faint);\n}\n.mwi-overview-has-requirement { position: relative; }\n.mwi-overview-requirement {\n  position: absolute;\n  inset: .125rem .1875rem auto auto;\n  z-index: 1;\n  color: #ffc268;\n  font-size: .8125rem;\n  font-variant-numeric: tabular-nums;\n  font-weight: 600;\n  line-height: 1;\n  text-shadow: 0 0 2px #171822, 0 1px 2px #171822;\n  pointer-events: none;\n}\n\n/* Virtual Loadouts & Subscriptions */\n.mwi-virtual-panel {\n  margin-block: 1.25rem .5rem;\n  padding-top: .9rem;\n  border-top: 1px solid var(--mwi-line);\n  text-align: start;\n  color: var(--mwi-text);\n}\n.mwi-virtual-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .5rem;\n  margin-bottom: .7rem;\n}\n.mwi-virtual-head-left {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .45rem;\n}\n.mwi-virtual-panel h2 {\n  margin: 0;\n  font-size: .95rem;\n  font-weight: 600;\n  color: var(--mwi-text);\n  letter-spacing: -0.005em;\n}\n.mwi-virtual-empty-inline { font-size: .82rem; color: var(--mwi-text-faint); }\n.mwi-virtual-empty { font-size: .82rem; color: var(--mwi-text-faint); margin: .35rem 0; }\n\n.mwi-virtual-subscribe {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: .4rem;\n  margin-bottom: .7rem;\n  padding: .5rem .6rem;\n  background: var(--mwi-drawer);\n  border: 1px solid var(--mwi-line);\n  border-radius: 8px;\n}\n.mwi-virtual-subscribe input { flex: 1 1 16rem; }\n.mwi-virtual-panel input, .mwi-virtual-panel select {\n  background: var(--mwi-inset);\n  color: var(--mwi-text);\n  border: 1px solid var(--mwi-line-strong);\n  border-radius: 6px;\n  padding: .32rem .55rem;\n  min-height: 1.9rem;\n  min-width: 0;\n  max-width: 100%;\n  font: inherit;\n  font-size: .82rem;\n  transition: border-color .14s ease;\n}\n.mwi-virtual-panel input::placeholder { color: var(--mwi-text-faint); }\n.mwi-virtual-panel :focus-visible { outline: 2px solid #9ecfff; outline-offset: 2px; }\n\n.mwi-virtual-grid {\n  display: grid;\n  grid-template-columns: repeat(auto-fill, minmax(min(100%, 18.5rem), 1fr));\n  gap: .75rem;\n  align-items: start;\n}\n.mwi-virtual-card { padding: 0; overflow-wrap: anywhere; min-width: 0; }\n.mwi-virtual-card .mwi-overview-card-actions { gap: .08rem; }\n.mwi-virtual-card .mwi-overview-scenes-btn { padding: .2rem .35rem; font-size: .79rem; }\n.mwi-virtual-tag {\n  font-size: .72rem;\n  font-weight: 500;\n  padding: .1rem .42rem;\n  border-radius: 999px;\n  background: rgba(255, 255, 255, 0.06);\n  color: var(--mwi-text-muted);\n  white-space: nowrap;\n}\n.mwi-virtual-tag.mwi-cloud-warning {\n  background: var(--mwi-warn-bg);\n  color: var(--mwi-warn);\n}\n.mwi-virtual-body { padding: 0; }\n.mwi-virtual-error {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .4rem;\n  padding: .42rem .625rem;\n  background: var(--mwi-warn-bg);\n  border-bottom: 1px solid var(--mwi-warn-line);\n  color: var(--mwi-warn);\n  font-size: .81rem;\n}\n.mwi-virtual-pills {\n  display: flex;\n  flex-wrap: wrap;\n  gap: .25rem;\n  padding: .4rem .625rem;\n  background: var(--mwi-drawer);\n  border-bottom: 1px solid var(--mwi-line-soft);\n}\n.mwi-virtual-pill {\n  padding: .2rem .55rem;\n  min-height: 1.7rem;\n  border-radius: 5px;\n  border: 1px solid transparent;\n  background: transparent;\n  color: var(--mwi-text-muted);\n  font: inherit;\n  font-size: .8rem;\n  font-weight: 500;\n  cursor: pointer;\n  transition: background-color .14s var(--mwi-ease), color .14s ease;\n}\n.mwi-virtual-pill:hover { background: var(--mwi-hover); color: var(--mwi-text); }\n.mwi-virtual-pill.is-active {\n  background: var(--mwi-accent);\n  color: #ffffff;\n}\n.mwi-virtual-select-row {\n  padding: .42rem .625rem;\n  background: var(--mwi-drawer);\n  border-bottom: 1px solid var(--mwi-line-soft);\n}\n.mwi-virtual-select-row select { width: 100%; }\n.mwi-virtual-drawer {\n  display: grid;\n  gap: .45rem;\n  padding: .55rem .625rem;\n  background: var(--mwi-drawer);\n  border-bottom: 1px solid var(--mwi-line);\n}\n.mwi-virtual-adopt-form { display: grid; gap: .45rem; }\n.mwi-virtual-adopt-fields { display: grid; gap: .35rem; }\n.mwi-virtual-actions {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  justify-content: flex-end;\n  gap: .25rem;\n}\n.mwi-virtual-meta-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .4rem;\n  font-size: .79rem;\n}\n.mwi-virtual-meta { color: var(--mwi-text-faint); font-variant-numeric: tabular-nums; }\n.mwi-virtual-link { color: #9ecfff; text-decoration: none; }\n.mwi-virtual-link:hover { text-decoration: underline; }\n.mwi-virtual-confirm {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .4rem;\n  font-size: .82rem;\n  color: var(--mwi-warn);\n}\n.mwi-virtual-hint { margin: 0; font-size: .81rem; }\n.mwi-virtual-notice {\n  position: fixed;\n  inset: auto 18px 20px auto;\n  z-index: 99990;\n  max-width: min(380px, calc(100vw - 36px));\n  margin: 0;\n  padding: .48rem .75rem;\n  font-size: .82rem;\n  color: var(--mwi-ok);\n  background: #171b29;\n  border: 1px solid var(--mwi-line-strong);\n  border-radius: 8px;\n  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);\n}\n.mwi-virtual-notice.mwi-cloud-warning {\n  color: var(--mwi-warn);\n  border-color: var(--mwi-warn-line);\n}\n.mwi-virtual-options {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: .3rem .55rem;\n  padding: .3rem .625rem;\n  border-bottom: 1px solid var(--mwi-line-soft);\n  font-size: .77rem;\n}\n.mwi-virtual-options .mwi-virtual-tag { margin-inline-start: auto; }\n.mwi-virtual-flag { color: var(--mwi-text-faint); }\n.mwi-virtual-flag.is-on { color: var(--mwi-text-muted); font-weight: 500; }\n\n/* Read-only Virtual Native Preview */\n.mwi-virtual-native { container-type: inline-size; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_selectedLoadout__\"] { padding: 0; align-items: stretch; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_details__\"] { width: 100%; min-width: 0; margin: 0; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_setup__\"] {\n  --item-size-normal: min(3.75rem, max(1px, calc((100cqi - 2.25rem) / 5)));\n  width: 100%;\n  min-width: 0;\n  box-sizing: border-box;\n  padding: .55rem .625rem .625rem;\n  gap: .55rem;\n  background: transparent;\n}\n.mwi-virtual-native [class*=\"LoadoutsPanel_playerModel__\"],\n.mwi-virtual-native [class*=\"LoadoutsPanel_abilities__\"],\n.mwi-virtual-native [class*=\"LoadoutsPanel_consumables__\"] { gap: .25rem; }\n.mwi-virtual-slot { min-width: 0; width: fit-content; max-width: 100%; border-radius: 5px; }\n.mwi-virtual-slot [inert] { pointer-events: none; }\n/* Native item rules are more specific than the preview wrapper. Inventory is\n   irrelevant to a virtual loadout: hide counts and keep selected icons bright. */\n.mwi-virtual-native [class*=\"Item_count__\"] { display: none !important; }\n.mwi-virtual-native [class*=\"ConsumableSlot_consumableSlotContainer__\"] [class*=\"Item_empty__\"] [class*=\"Item_iconContainer__\"] { opacity: 1 !important; }\n.mwi-virtual-native [class*=\"Ability_level__\"],\n.mwi-virtual-native [class*=\"CombatTriggersSetting_combatTriggersSetting__\"] { display: none; }\n\n/* Virtual Share / Import Bars & Toast Banners */\n.mwi-virtual-drawer-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: .4rem;\n}\n.mwi-virtual-drawer-title {\n  font-size: .83rem;\n  font-weight: 500;\n  color: var(--mwi-text);\n}\n.mwi-virtual-bar {\n  display: grid;\n  gap: .45rem;\n  margin-bottom: .7rem;\n  padding: .6rem .7rem;\n  background: var(--mwi-drawer);\n  border: 1px solid var(--mwi-line);\n  border-radius: 8px;\n}\n.mwi-virtual-split-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .4rem;\n}\n.mwi-virtual-panel-notice {\n  margin: 0;\n}\n.mwi-virtual-banner {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .4rem .6rem;\n  margin-bottom: .7rem;\n  padding: .45rem .65rem;\n  background: var(--mwi-surface);\n  border: 1px solid var(--mwi-line);\n  border-inline-start: 2px solid var(--mwi-warn);\n  border-radius: 7px;\n  color: var(--mwi-text);\n  font-size: .83rem;\n}\n.mwi-virtual-share textarea {\n  box-sizing: border-box;\n  width: 100%;\n  resize: vertical;\n  color: var(--mwi-text);\n  background: var(--mwi-inset);\n  border: 1px solid var(--mwi-line-strong);\n  border-radius: 6px;\n  padding: .45rem .55rem;\n  font: inherit;\n  font-size: .81rem;\n}\n\n/* Local-only Virtual Loadout Editor */\n.mwi-draft-editor {\n  margin-bottom: .8rem;\n  overflow: hidden;\n  width: 100%;\n  max-width: 840px;\n  box-sizing: border-box;\n  container: mwi-draft / inline-size;\n}\n.mwi-draft-editor fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }\n.mwi-draft-head { gap: .5rem; }\n.mwi-draft-head-left {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .45rem .6rem;\n  flex: 1 1 14rem;\n  min-width: 0;\n}\n.mwi-draft-title {\n  font-size: .9rem;\n  font-weight: 600;\n  color: var(--mwi-text);\n  white-space: nowrap;\n}\n.mwi-draft-name-input {\n  flex: 1 1 11rem;\n  min-width: 0;\n}\n.mwi-draft-types-bar {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .3rem .45rem;\n  padding: .42rem .625rem;\n  background: var(--mwi-drawer);\n  border-bottom: 1px solid var(--mwi-line-soft);\n}\n.mwi-draft-types {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 2px;\n  flex: 1 1 16rem;\n}\n.mwi-draft-types .mwi-virtual-pill {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  font-size: 12px;\n  min-height: 27px;\n  padding: 2px 7px;\n}\n.mwi-draft-types .mwi-draft-type-icon { width: 16px; height: 16px; }\n.mwi-draft-body {\n  display: grid;\n  gap: .65rem;\n  padding: .65rem;\n}\n.mwi-draft-layout {\n  display: grid;\n  grid-template-columns: minmax(0, 340px) minmax(240px, 1fr);\n  gap: .75rem;\n  align-items: start;\n}\n.mwi-draft-groups {\n  display: grid;\n  gap: .65rem;\n  min-width: 0;\n}\n.mwi-draft-group {\n  display: grid;\n  gap: .3rem;\n}\n.mwi-draft-group-label {\n  font-size: .76rem;\n  font-weight: 500;\n  color: var(--mwi-text-faint);\n}\n.mwi-draft-slots {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));\n  gap: .3rem;\n}\n.mwi-draft-gear { grid-template-rows: repeat(4, auto); }\n.mwi-draft-slot {\n  display: grid;\n  gap: .15rem;\n  min-width: 0;\n  aspect-ratio: 1;\n  align-content: start;\n  position: relative;\n  box-sizing: border-box;\n  overflow: hidden;\n  text-align: left;\n  padding: 3px;\n  color: var(--mwi-text);\n  background: rgba(255, 255, 255, 0.04);\n  border: 1px solid rgba(255, 255, 255, 0.11);\n  border-radius: 6px;\n  cursor: pointer;\n  font: inherit;\n  font-size: 11px;\n  transition: background-color .14s var(--mwi-ease), border-color .14s var(--mwi-ease);\n}\n.mwi-draft-slot.is-empty {\n  background: rgba(0, 0, 0, 0.22);\n  border-color: var(--mwi-line-soft);\n}\n.mwi-draft-slot:hover:not(:disabled) {\n  background: rgba(255, 255, 255, 0.08);\n  border-color: var(--mwi-line-strong);\n}\n.mwi-draft-slot.is-active {\n  border-color: #7d95f5;\n  background: rgba(76, 99, 196, 0.24);\n}\n.mwi-draft-slot-head {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: .25rem;\n  min-width: 0;\n  position: relative;\n  z-index: 1;\n  pointer-events: none;\n}\n.mwi-draft-slot-head small {\n  font-size: 10px;\n  color: var(--mwi-text-faint);\n  white-space: nowrap;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n.mwi-draft-slot-head b {\n  flex-shrink: 0;\n  font-size: 11.5px;\n  font-weight: 600;\n  color: var(--mwi-warn);\n  font-variant-numeric: tabular-nums;\n}\n.mwi-draft-slot-val {\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n  color: var(--mwi-text);\n  position: absolute;\n  inset: auto 2px 2px;\n  text-align: center;\n  line-height: 1.25;\n  background: rgba(16, 19, 28, 0.88);\n  border-radius: 3px;\n  pointer-events: none;\n}\n.mwi-draft-game-icon { display: block; width: 24px; height: 24px; flex: 0 0 auto; pointer-events: none; }\n.mwi-draft-slot .mwi-draft-slot-icon { position: absolute; width: 70%; height: 70%; inset: 15%; }\n.mwi-draft-slot:not(.is-empty) .mwi-draft-slot-head small { visibility: hidden; }\n.mwi-draft-slot.is-empty .mwi-draft-slot-head { justify-content: center; }\n.mwi-draft-slot.is-empty .mwi-draft-slot-head small { font-size: 11px; }\n.mwi-draft-slot.is-active .mwi-draft-slot-head small { color: var(--mwi-text); }\n.mwi-draft-slot.is-active .mwi-draft-slot-val { color: #ffffff; }\n\n.mwi-draft-picker {\n  display: grid;\n  gap: .45rem;\n  min-width: 0;\n  padding: .6rem .65rem;\n  background: var(--mwi-drawer);\n  border: 1px solid var(--mwi-line);\n  border-radius: 7px;\n  position: sticky;\n  top: .5rem;\n}\n.mwi-draft-picker-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: .4rem;\n}\n.mwi-draft-picker-head strong {\n  font-size: .86rem;\n  font-weight: 600;\n  color: var(--mwi-text);\n}\n.mwi-draft-level-wrap {\n  display: grid;\n  gap: .35rem;\n}\n.mwi-draft-level {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .35rem;\n}\n.mwi-draft-presets {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  padding: 2px;\n  background: var(--mwi-inset);\n  border: 1px solid var(--mwi-line);\n  border-radius: 6px;\n}\n.mwi-draft-preset {\n  min-width: 1.85rem;\n  min-height: 1.55rem;\n  padding: .12rem .34rem;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  color: var(--mwi-text-muted);\n  font: inherit;\n  font-size: .78rem;\n  font-weight: 500;\n  font-variant-numeric: tabular-nums;\n  cursor: pointer;\n  transition: background-color .12s var(--mwi-ease), color .12s ease;\n}\n.mwi-draft-preset:hover:not(:disabled) {\n  background: var(--mwi-hover);\n  color: var(--mwi-text);\n}\n.mwi-draft-preset.is-active {\n  background: var(--mwi-accent);\n  color: #ffffff;\n}\n.mwi-draft-stepper {\n  display: inline-flex;\n  align-items: center;\n  gap: .2rem;\n  margin-inline-start: auto;\n}\n.mwi-draft-slider-row {\n  display: flex;\n  align-items: center;\n  gap: .45rem;\n}\n.mwi-draft-slider {\n  flex: 1 1 auto;\n  height: 4px;\n  min-height: 0 !important;\n  padding: 0 !important;\n  border: 0 !important;\n  border-radius: 999px;\n  background: rgba(255, 255, 255, 0.12) !important;\n  accent-color: #7d95f5;\n  cursor: pointer;\n}\n.mwi-draft-slider-max {\n  font-size: .73rem;\n  color: var(--mwi-text-faint);\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n.mwi-draft-label { font-size: .79rem; color: var(--mwi-text-muted); white-space: nowrap; }\n.mwi-draft-level input[type=\"number\"],\n.mwi-draft-batch input {\n  width: 3.35rem;\n  text-align: center;\n  font-variant-numeric: tabular-nums;\n}\n\n/* Game-Native-Style Hover Detail Tooltip */\n.mwi-item-tooltip {\n  position: fixed;\n  z-index: 99999;\n  pointer-events: none;\n  min-width: 215px;\n  max-width: min(310px, calc(100vw - 24px));\n  padding: 9px 11px;\n  background: #141724;\n  color: #eef0f8;\n  border: 1px solid rgba(255, 255, 255, 0.15);\n  border-radius: 8px;\n  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.58);\n  font-size: 12.5px;\n  line-height: 1.42;\n  text-align: start;\n}\n.mwi-item-tooltip[hidden] { display: none !important; }\n.mwi-item-tooltip-head {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.mwi-item-tooltip-icon {\n  width: 28px;\n  height: 28px;\n  flex: 0 0 28px;\n  display: block;\n}\n.mwi-item-tooltip-titlebox { min-width: 0; flex: 1 1 auto; }\n.mwi-item-tooltip-title {\n  display: flex;\n  align-items: baseline;\n  gap: 5px;\n  flex-wrap: wrap;\n}\n.mwi-item-tooltip-title strong {\n  font-size: 13.5px;\n  font-weight: 600;\n  color: #ffffff;\n}\n.mwi-item-tooltip-enh {\n  font-size: 12.5px;\n  font-weight: 600;\n  color: #f2c46d;\n  font-variant-numeric: tabular-nums;\n}\n.mwi-item-tooltip-sub {\n  font-size: 11.5px;\n  color: #8f96b3;\n}\n.mwi-item-tooltip-meta {\n  margin-top: 6px;\n  padding-top: 6px;\n  border-top: 1px solid rgba(255, 255, 255, 0.08);\n  font-size: 11.5px;\n  color: #b4bcd8;\n  font-variant-numeric: tabular-nums;\n}\n.mwi-item-tooltip-sec {\n  margin-top: 6px;\n  padding-top: 6px;\n  border-top: 1px solid rgba(255, 255, 255, 0.08);\n}\n.mwi-item-tooltip-heading {\n  font-size: 11px;\n  font-weight: 500;\n  color: #7d85a6;\n  margin-bottom: 3px;\n}\n.mwi-item-tooltip-rows {\n  display: grid;\n  gap: 2px;\n}\n.mwi-item-tooltip-row {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  gap: 10px;\n}\n.mwi-item-tooltip-key {\n  color: #a6aecb;\n  min-width: 0;\n}\n.mwi-item-tooltip-val {\n  color: #eef0f8;\n  font-weight: 500;\n  font-variant-numeric: tabular-nums;\n  white-space: nowrap;\n}\n.mwi-item-tooltip-delta {\n  color: #f2c46d;\n  font-weight: 500;\n}\n.mwi-item-tooltip-row.is-warn .mwi-item-tooltip-key,\n.mwi-item-tooltip-row.is-warn .mwi-item-tooltip-val {\n  color: #ec868e;\n}\n.mwi-item-tooltip-desc {\n  margin: 0;\n  font-size: 11.5px;\n  color: #9ba3bf;\n  overflow-wrap: anywhere;\n}\n.mwi-draft-candidates {\n  display: flex;\n  flex-direction: column;\n  gap: 2px;\n  max-height: 360px;\n  overflow-y: auto;\n  padding: 3px;\n  background: var(--mwi-inset);\n  border: 1px solid var(--mwi-line);\n  border-radius: 6px;\n}\n.mwi-draft-candidate {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  padding: .3rem .5rem;\n  min-height: 34px;\n  border: 0;\n  border-radius: 5px;\n  background: transparent;\n  color: var(--mwi-text-muted);\n  font: inherit;\n  font-size: 13px;\n  text-align: left;\n  cursor: pointer;\n  overflow-wrap: anywhere;\n  transition: background-color .12s var(--mwi-ease), color .12s ease;\n}\n.mwi-draft-candidate:hover:not(:disabled) {\n  background: var(--mwi-hover);\n  color: var(--mwi-text);\n}\n.mwi-draft-candidate.is-selected {\n  background: var(--mwi-accent);\n  color: #ffffff;\n}\n.mwi-draft-alert {\n  position: static;\n  inset: auto;\n  z-index: auto;\n  max-width: none;\n  padding: .42rem .625rem;\n  background: var(--mwi-warn-bg);\n  border: 1px solid var(--mwi-warn-line);\n  border-radius: 6px;\n  box-shadow: none;\n}\n.mwi-draft-footer {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: .5rem;\n  padding-top: .55rem;\n  border-top: 1px solid var(--mwi-line-soft);\n}\n.mwi-draft-batch,\n.mwi-draft-batch label {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .35rem;\n}\n.mwi-draft-editor :disabled { opacity: .45; cursor: not-allowed; }\n\n@media (max-width: 720px) {\n  .mwi-draft-layout { grid-template-columns: minmax(0, 1fr); }\n  .mwi-draft-picker { position: static; }\n  .mwi-draft-candidates { max-height: 14rem; }\n  .mwi-draft-groups { width: 100%; max-width: 340px; }\n}\n@container mwi-draft (max-width: 620px) {\n  .mwi-draft-layout { grid-template-columns: minmax(0, 1fr); }\n  .mwi-draft-groups { width: 100%; max-width: 340px; }\n  .mwi-draft-picker { position: static; }\n  .mwi-draft-candidates { max-height: 240px; }\n}\n@media (pointer: coarse) {\n  .mwi-overview-button,\n  .mwi-overview-seg-btn,\n  .mwi-overview-filter-tab,\n  .mwi-overview-fold,\n  .mwi-overview-cloud-btn,\n  .mwi-overview-cloud-tally,\n  .mwi-virtual-pill,\n  .mwi-draft-slot,\n  .mwi-draft-candidate { min-height: 2.5rem; }\n  .mwi-overview-options [class*=\"MuiFormControlLabel-root\"] { min-height: 2.5rem; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .mwi-overview-toolbar *,\n  [data-mwi-loadout-overview] *,\n  .mwi-virtual-panel * { transition: none !important; }\n}\n";
  const marker = "data-mwi-loadout-overview";
  const collapseKey = owner => `mwi-layu:loadout-overview:collapsed:v1:${owner}`;
  const installed = new WeakMap();
  const slotTypes = new Set(["equipment", "ability", "food", "drink", "ability_trigger", "food_trigger", "drink_trigger"]);
  const optionLabels = [
    ["isDefaultChanged", "默认"],
    ["suppressValidationChanged", "缺失不提醒"],
    ["useExactEnhancementChanged", "最高强化"]
  ];
  let runtime, showGrid = true, activeScene = null;

  function shortCloudWarning(info) {
    if (info.nativeMismatch) return "云端不同";
    if (info.conflicts) return "版本冲突";
    if (info.kind === "setup") return "需更新";
    if (info.kind === "blocked") return "同步暂停";
    if (info.kind === "error") return "同步重试";
    if (info.offline && info.warning) return "待联网";
    return info.label;
  }

  // One scene workspace at a time, scoped to the card rather than the game's
  // selected loadout. Read fresh props on every operation and never select a
  // native detail page just to access saved scenes.
  function currentScene() {
    if (!activeScene) return null;
    const { controller, owner: characterId, id, element, tab } = activeScene;
    const props = controller.props, panel = app.Adapter.visibleLoadoutPanel();
    if (!showGrid || controller.state.selectedCharacterLoadoutId !== null ||
        props.characterInfo?.characterID !== characterId || !props.characterLoadoutDict?.[id] ||
        !element.isConnected || !panel?.contains(element)) {
      activeScene = null; return null;
    }
    const sceneMount = element.querySelector("[data-mwi-overview-scenes]"),
      details = element.querySelector('[class*="LoadoutsPanel_details__"]'),
      setup = element.querySelector('[class*="LoadoutsPanel_setup__"]');
    if (!sceneMount || !details || !setup || !element.getClientRects().length) return null;
    const raw = app.Core.validate(props.characterLoadoutDict[id]);
    if (raw.id !== id) throw Error("配装数据已变化，请重新打开这张卡片的子方案。");
    const owner = `${root.location?.origin || ""}|${characterId}`;
    return {
      raw, owner, scope: `${owner}|${id}`, panel, details, setup, props, sceneMount,
      overview: true,
      overviewTab: tab || "scenes",
      setOverviewTab: nextTab => {
        if (!activeScene || activeScene.controller !== controller || activeScene.owner !== characterId || activeScene.id !== id) return;
        const normalized = nextTab === "cloud" ? "cloud" : "scenes";
        if (activeScene.tab !== normalized) {
          activeScene = { ...activeScene, tab: normalized };
          controller.forceUpdate();
        }
      },
      closeOverviewScenes: () => {
        if (!activeScene || activeScene.controller !== controller || activeScene.owner !== characterId || activeScene.id !== id) return;
        activeScene = null;
        controller.forceUpdate();
      }
    };
  }

  function notice(panel, message) {
    let node = panel.querySelector("[data-mwi-overview-status]");
    if (!message) { node?.remove(); return; }
    if (!node) {
      node = document.createElement("p");
      node.setAttribute("data-mwi-overview-status", "");
      node.setAttribute("role", "status");
      node.className = "mwi-overview-notice";
      panel.prepend(node);
    }
    if (node.textContent !== message) node.textContent = message;
  }

  // The game bundles React and its cache codec in webpack 4. Reuse the loaded
  // exports so its components keep their context and renderer in the same tree.
  function gameRuntime() {
    if (runtime) return runtime;
    const page = typeof unsafeWindow === "undefined" ? root : unsafeWindow;
    const chunks = page.webpackJsonprpg_web || root.webpackJsonprpg_web;
    if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
    const id = "mwi-layu-loadout-overview-runtime";
    const probe = [[], { [id]: (module, exports, require) => {
      try {
        const loaded = Object.values(require.c).map(entry => entry.exports);
        const React = loaded.find(value => typeof value?.createElement === "function" &&
          typeof value.cloneElement === "function" && typeof value.Component === "function" && value.Children);
        const codec = loaded.find(value => typeof value?.decompressFromUTF16 === "function" &&
          typeof value.compressToUTF16 === "function");
        const sprites = {};
        for (const value of loaded) {
          const path = typeof value === "string" ? value : typeof value?.default === "string" ? value.default : "";
          const match = /(?:^|\/)(items|abilities|skills)_sprite\.[^/]+\.svg$/.exec(path);
          if (match) sprites[match[1]] = path;
        }
        if (React) runtime = { React, codec, sprites };
      } finally {
        delete require.c[id];
        delete require.m[id];
      }
    } }, [[id]]];
    try { chunks.push(probe); } finally {
      const index = chunks.indexOf(probe);
      if (index !== -1) chunks.splice(index, 1);
    }
    return runtime;
  }

  function readRequirements(codec) {
    const requirements = new Map();
    try {
      const raw = root.localStorage.getItem("initClientData");
      if (!raw) return requirements;
      const text = raw.trimStart().startsWith("{") ? raw : codec?.decompressFromUTF16(raw);
      if (!text) return requirements;
      for (const [hrid, detail] of Object.entries(JSON.parse(text).itemDetailMap || {})) {
        const levels = detail?.equipmentDetail?.levelRequirements;
        if (!Array.isArray(levels)) continue;
        const maximum = levels.reduce((max, entry) => Number.isSafeInteger(entry?.level) ? Math.max(max, entry.level) : max, 0);
        if (maximum) requirements.set(hrid, maximum);
      }
    } catch (_) { /* A missing cache must not stop the game's native editor. */ }
    return requirements;
  }

  function readCollapsed(owner) {
    try {
      const ids = JSON.parse(root.localStorage.getItem(collapseKey(owner)));
      return new Set(Array.isArray(ids) ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : []);
    } catch (_) { return null; }
  }

  const hasClass = (node, name) => typeof node?.props?.className === "string" && node.props.className.includes(`LoadoutsPanel_${name}__`);
  const children = (React, node) => React.Children.toArray(node?.props?.children);
  const child = (React, node, name) => children(React, node).find(entry => hasClass(entry, name));

  function cardOptions(React, details, controller) {
    const controls = children(React, details).filter(entry => hasClass(entry, "metadata"))
      .flatMap(entry => children(React, entry));
    const options = optionLabels.map(([handler, label]) => {
      const control = controls.find(entry => typeof entry?.props?.onChange === "function" && entry.props.onChange === controller[handler]);
      return control && React.createElement("div", { key: handler, title: control.props.label }, React.cloneElement(control, { label }));
    });
    return options.every(Boolean) ? React.createElement("div", {
      className: "mwi-overview-options", role: "group", "aria-label": "配装选项"
    }, options) : null;
  }

  function cardSetup(React, shell, requirements) {
    const details = child(React, shell, "details"), setup = child(React, details, "setup");
    const equipment = child(React, setup, "equipment"), model = child(React, equipment, "playerModel");
    if (!model || !child(React, setup, "buttonsContainer")) throw Error("配装编辑区结构已变化");
    const slots = children(React, model);
    const updated = slots.map(slot => {
      const level = requirements.get(slot.props?.children?.props?.currentItem?.itemHrid);
      const position = slot.props?.style?.gridRowStart;
      const isTool = position === 7 || position === 8;
      if (!level && !isTool) return slot;
      const badge = level && React.createElement("span", {
        className: "mwi-overview-requirement", title: `装备需求等级 ${level}`, "aria-label": `装备需求等级 ${level}`
      }, level);
      return React.cloneElement(slot, {
        className: [slot.props.className, level && "mwi-overview-has-requirement"].filter(Boolean).join(" ") || undefined,
        style: isTool ? { ...slot.props.style, gridRowStart: position - 1 } : slot.props.style
      }, slot.props.children, badge || null);
    });
    if (slots.some(slot => slot.props?.style?.gridRowStart === 7)) {
      updated.push(React.createElement("div", { className: "mwi-overview-tools", key: "tools" }, "生活工具"));
    }
    const modelWithBadges = React.cloneElement(model, null, updated);
    const equipmentWithBadges = React.cloneElement(equipment, null, children(React, equipment)
      .map(entry => hasClass(entry, "playerModel") ? modelWithBadges : entry));
    const sections = children(React, setup).filter(entry => !hasClass(entry, "buttonsContainer"))
      .map(entry => hasClass(entry, "equipment") ? equipmentWithBadges : entry);
    return React.cloneElement(setup, null, sections);
  }

  // Only the small status controls subscribe. An update never rerenders native slots.
  function makeCloudLabel(React) {
    const h = React.createElement;
    return class CloudLabel extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.owner !== this.props.owner || prev.ids !== this.props.ids) this.listen();
        else this.repaint();
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      repaint() {
        if (this.props.tally) this.paintTally(this.warningCount || 0);
        else if (this.lastInfo) this.paintCard(this.lastInfo);
      }
      listen() {
        this.unsubscribe?.();
        const { owner, ids } = this.props;
        const warnings = new Set();
        const idList = ids ? ids.split(",").filter(Boolean).map(Number) : [];
        const refresh = id => {
          const info = app.Cloud.info(owner, id);
          if (!this.props.tally) {
            this.lastInfo = info;
            this.paintCard(info);
            return;
          }
          if (info.warning) warnings.add(id);
          else warnings.delete(id);
          this.firstWarning = idList.find(entry => warnings.has(entry)) || null;
          this.warningCount = warnings.size;
          this.paintTally(warnings.size);
        };
        const stops = idList.map(id => {
          refresh(id);
          return app.Cloud.subscribe(owner, id, () => refresh(id));
        });
        if (!idList.length && this.props.tally) { this.warningCount = 0; this.paintTally(0); }
        this.unsubscribe = () => stops.forEach(stop => stop());
      }
      paintCard(info) {
        if (!this.label) return;
        const state = info.warning ? "warn" :
          info.kind === "busy" || info.kind === "pending" ? "busy" :
          info.kind === "ok" && !info.offline ? "ok" : "idle";
        const fullLabel = "云同步 · " + info.label;
        if (this.label.dataset) this.label.dataset.state = state;
        this.label.title = fullLabel;
        if (typeof this.label.setAttribute === "function") this.label.setAttribute("aria-label", fullLabel);
        this.label.classList.toggle("mwi-cloud-warning", info.warning);
        this.label.hidden = !info.warning;
        if (this.text) {
          const shortText = info.warning ? shortCloudWarning(info) : "";
          if (this.text.textContent !== shortText) this.text.textContent = shortText;
          this.text.hidden = !shortText;
        }
      }
      paintTally(count) {
        if (!this.label) return;
        const text = count ? count + " 套配装待处理" : "";
        if (this.label.textContent !== text) this.label.textContent = text;
        this.label.hidden = !text;
        this.label.classList.toggle("mwi-cloud-warning", count > 0);
      }
      render() {
        if (this.props.tally) {
          return h("button", {
            type: "button",
            className: "mwi-overview-cloud mwi-overview-cloud-tally",
            ref: node => { this.label = node; },
            onClick: () => { if (this.firstWarning != null) this.props.onJumpWarning?.(this.firstWarning); }
          });
        }
        return h("button", {
          type: "button",
          className: "mwi-overview-cloud-btn" + (this.props.active ? " mwi-overview-cloud-active" : ""),
          "aria-expanded": Boolean(this.props.active),
          onClick: this.props.onOpenCloud,
          ref: node => { this.label = node; }
        },
          h("svg", {
            className: "mwi-overview-cloud-icon", width: 15, height: 15, viewBox: "0 0 16 16",
            fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
            "aria-hidden": true
          },
            h("path", { d: "M4.5 12.25h7.25a2.75 2.75 0 0 0 .42-5.47A4 4 0 0 0 4.55 5.6 2.5 2.5 0 0 0 4.5 12.25Z" }),
            h("circle", { className: "mwi-overview-cloud-pip", cx: "13", cy: "3.5", r: "2.1", stroke: "none" })),
          h("span", { className: "mwi-overview-cloud-text", ref: node => { this.text = node; } }));
      }
    };
  }

  // Lightweight scene count badge: reads once per owner and updates via DOM ref without rerendering native slots.
  function makeSceneCount(React) {
    const h = React.createElement;
    return class SceneCount extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.ownerKey !== this.props.ownerKey || prev.id !== this.props.id) this.listen();
        else this.paint(this.props.tracker?.get(this.props.ownerKey, this.props.id) || 0);
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      paint = count => {
        if (!this.node) return;
        const text = count > 0 ? String(count) : "";
        if (this.node.textContent !== text) this.node.textContent = text;
        this.node.hidden = !text;
      };
      listen() {
        this.unsubscribe?.();
        const { tracker, ownerKey, id } = this.props;
        if (!tracker) return;
        this.paint(tracker.get(ownerKey, id));
        this.unsubscribe = tracker.subscribe(ownerKey, id, this.paint);
      }
      render() {
        return h("span", { className: "mwi-overview-scene-count", ref: node => { this.node = node; } });
      }
    };
  }

  function createCountTracker() {
    if (typeof app.Store?.counts !== "function") return null;
    const cache = new Map(), watchers = new Map();
    let activeOwner = "", loadingToken = 0;
    const notifyOwner = ownerKey => {
      const counts = cache.get(ownerKey) || new Map();
      const group = watchers.get(ownerKey);
      if (!group) return;
      for (const [id, fns] of group) {
        const count = counts.get(id) || 0;
        for (const fn of fns) fn(count);
      }
    };
    const refresh = ownerKey => {
      if (!ownerKey) return;
      activeOwner = ownerKey;
      const token = ++loadingToken;
      app.Store.counts(ownerKey).then(result => {
        if (token !== loadingToken && ownerKey === activeOwner) return;
        cache.set(ownerKey, result);
        notifyOwner(ownerKey);
      }).catch(() => { /* Badge counts are decorative; ignore storage read failures. */ });
    };
    app.Store.subscribe?.(scope => {
      const ownerKey = scope ? scope.slice(0, scope.lastIndexOf("|")) : activeOwner;
      if (ownerKey && watchers.has(ownerKey)) refresh(ownerKey);
    });
    if (typeof BroadcastChannel === "function") {
      try {
        const ch = new BroadcastChannel("mwi-layu-loadout-scenes");
        ch.addEventListener("message", event => {
          const scope = event.data?.scope;
          const ownerKey = scope ? scope.slice(0, scope.lastIndexOf("|")) : activeOwner;
          if (ownerKey && watchers.has(ownerKey)) refresh(ownerKey);
        });
      } catch (_) { /* Ignore unavailable BroadcastChannel. */ }
    }
    return {
      get: (ownerKey, id) => cache.get(ownerKey)?.get(id) || 0,
      subscribe(ownerKey, id, fn) {
        const firstForOwner = !watchers.has(ownerKey);
        if (firstForOwner) watchers.set(ownerKey, new Map());
        const group = watchers.get(ownerKey);
        if (!group.has(id)) group.set(id, new Set());
        group.get(id).add(fn);
        if (firstForOwner || !cache.has(ownerKey)) refresh(ownerKey);
        return () => {
          group.get(id)?.delete(fn);
          if (!group.get(id)?.size) group.delete(id);
          if (!group.size) watchers.delete(ownerKey);
        };
      }
    };
  }

  function makeCard(React, NativePanel, CloudLabel, SceneCount) {
    const h = React.createElement;
    class NativeSlots extends NativePanel {
      constructor(props) {
        super(props);
        // This instance owns exactly one ID. Native slot handlers close over
        // this state, independently of the page selection and the other cards.
        this.state = { ...this.state, selectedCharacterLoadoutId: props.overviewId };
      }
      componentDidUpdate() { /* The list owns this card's lifetime. */ }
      render() {
        const shell = this.renderLoadout();
        if (!hasClass(shell, "selectedLoadout")) throw Error("配装详情结构已变化");
        const { overviewContentId, overviewRequirements } = this.props;
        const details = child(React, shell, "details");
        const options = this.props.overviewCanUpdateOptions && cardOptions(React, details, this);
        const setup = cardSetup(React, shell, overviewRequirements);
        // React leaves this empty host's children to the existing scene UI.
        const scenes = this.props.overviewScenesOpen && h("div", {
          key: "scenes", id: `${overviewContentId}-scenes`, "data-mwi-overview-scenes": ""
        });
        return React.cloneElement(shell, null, React.cloneElement(details, { id: overviewContentId }, options, scenes, setup));
      }
    }
    // Keep a malformed native card from taking down the surrounding game UI.
    return class OverviewCard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false, notice: "" };
      }
      static getDerivedStateFromError() { return { failed: true }; }
      rememberCard = element => { this.element = element; };
      update(send, change) {
        if (!this.element) return;
        const notice = send(this.element, change) ? "" : "配装已变化，请重新打开配装页。";
        if (notice !== this.state.notice) this.setState({ notice });
      }
      updateSlot = change => this.update(this.props.sendSlot, change);
      updateOptions = change => this.update(this.props.sendOptions, change);
      render() {
        const { id, name, icon, toggleScenes, toggleCard, nativeProps, overviewCollapsed, countTracker } = this.props;
        const { overviewContentId, overviewScenesOpen, overviewTab } = nativeProps;
        const toggleLabel = overviewCollapsed ? "展开" : "收起";
        const ownerId = nativeProps.characterInfo.characterID;
        const ownerKey = `${root.location?.origin || ""}|${ownerId}`;
        const scenesOpen = Boolean(overviewScenesOpen && overviewTab !== "cloud");
        const cloudOpen = Boolean(overviewScenesOpen && overviewTab === "cloud");
        const content = overviewCollapsed ? h("div", { id: overviewContentId, hidden: true })
          : this.state.failed ? h("p", { id: overviewContentId, className: "mwi-overview-notice", role: "status" }, "这套配装暂时无法展开，请刷新游戏后重试。")
            : h(NativeSlots, { ...nativeProps, updateLoadoutSlotHandler: this.updateSlot, updateLoadoutHandler: this.updateOptions });
        return h("article", {
          ref: this.rememberCard,
          className: "mwi-overview-card" + (overviewScenesOpen ? " mwi-overview-card-active" : "") + (overviewCollapsed ? " mwi-overview-card-collapsed" : ""),
          "data-mwi-overview-id": id,
          "aria-label": name
        },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null,
              h("button", {
                type: "button",
                className: "mwi-overview-fold",
                "aria-label": `${toggleLabel}${name}`,
                "aria-expanded": !overviewCollapsed,
                "aria-controls": overviewContentId,
                onClick: toggleCard
              },
                h("svg", {
                  className: "mwi-overview-chevron" + (!overviewCollapsed ? " is-open" : ""),
                  width: 12, height: 12, viewBox: "0 0 16 16",
                  fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round",
                  "aria-hidden": true
                }, h("path", { d: "M6 4l4 4-4 4" })),
                icon,
                h("span", { className: "mwi-overview-name" }, name))),
            h("div", { className: "mwi-overview-card-actions" },
              app.Cloud && h(CloudLabel, {
                owner: ownerId,
                ids: String(id),
                active: cloudOpen,
                onOpenCloud: () => toggleScenes(this.element, "cloud")
              }),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-scenes-btn" + (scenesOpen ? " mwi-overview-scenes-active" : ""),
                "aria-label": `${name}的子方案`,
                "aria-expanded": scenesOpen,
                "aria-controls": `${overviewContentId}-scenes`,
                onClick: () => toggleScenes(this.element, "scenes")
              }, "子方案", countTracker && h(SceneCount, { tracker: countTracker, ownerKey, id })))),
          content,
          !overviewCollapsed && this.state.notice && h("p", { className: "mwi-overview-notice", role: "status" }, this.state.notice));
      }
    };
  }

  function install(controller, panel, { React, codec, sprites }) {
    if (!(controller instanceof React.Component) || typeof controller.renderLoadout !== "function" ||
        typeof controller.renderMainView !== "function" || typeof controller.forceUpdate !== "function")
      throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    const render = controller.render;
    const CloudLabel = makeCloudLabel(React);
    const SceneCount = makeSceneCount(React);
    const countTracker = createCountTracker();
    const VirtualPanel = app.makeVirtualPanel?.(React, app.makeVirtualPreview?.(React, controller.constructor));
    const Card = makeCard(React, controller.constructor, CloudLabel, SceneCount);
    const mounted = { panel, requirements: readRequirements(codec) };
    let collapsed = new Set(), collapsedOwner, collapseSaveFailed = false;
    let virtualCountNode = null, virtualCount = 0;
    let filterQuery = "", filterType = "all";
    const h = React.createElement;

    function updateVirtualCount(count) {
      virtualCount = count || 0;
      if (!virtualCountNode) return;
      const text = virtualCount > 0 ? String(virtualCount) : "";
      if (virtualCountNode.textContent !== text) virtualCountNode.textContent = text;
      virtualCountNode.hidden = !text;
    }

    function changeCollapsed(owner, change) {
      const { characterInfo, characterLoadoutDict } = controller.props;
      if (!showGrid || owner !== collapsedOwner || owner !== characterInfo?.characterID) return;
      if (!collapseSaveFailed) collapsed = readCollapsed(owner) ?? collapsed;
      change(collapsed);
      if (activeScene?.controller === controller && collapsed.has(activeScene.id)) activeScene = null;
      for (const id of collapsed) if (!Object.hasOwn(characterLoadoutDict, id)) collapsed.delete(id);
      try {
        root.localStorage.setItem(collapseKey(owner), JSON.stringify([...collapsed]));
        collapseSaveFailed = false;
      } catch (_) { collapseSaveFailed = true; }
      controller.forceUpdate();
    }

    function currentCard(owner, id, element, change) {
      const { props, state } = controller;
      return showGrid && state.selectedCharacterLoadoutId === null && owner === props.characterInfo?.characterID &&
        props.characterLoadoutDict?.[id]?.id === id && change?.id === id &&
        element.isConnected && mounted.panel.contains(element) && element.getClientRects().length;
    }

    function sendSlot(owner, id, element, change) {
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || !slotTypes.has(change.slotType) ||
          typeof controller.props.updateLoadoutSlotHandler !== "function") return false;
      controller.props.updateLoadoutSlotHandler(change);
      return true;
    }

    function sendOptions(owner, id, element, change) {
      const { props } = controller;
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || typeof props.updateLoadoutHandler !== "function" ||
          change.name !== props.characterLoadoutDict[id].name ||
          ![change.isDefault, change.suppressValidation, change.useExactEnhancement].every(value => typeof value === "boolean")) return false;
      props.updateLoadoutHandler(change);
      return true;
    }

    function openCardPanel(owner, id, element, tab = "scenes") {
      if (!element || !currentCard(owner, id, element, { id })) return;
      const targetTab = tab === "cloud" ? "cloud" : "scenes";
      const sameCard = activeScene?.controller === controller && activeScene.owner === owner && activeScene.id === id;
      const closing = sameCard && activeScene.tab === targetTab;
      activeScene = closing ? null : { controller, owner, id, element, tab: targetTab };
      if (closing) controller.forceUpdate();
      else changeCollapsed(owner, ids => ids.delete(id));
    }

    function jumpToWarning(owner, id) {
      if (filterQuery || filterType !== "all") {
        filterQuery = "";
        filterType = "all";
        controller.forceUpdate();
      }
      const element = mounted.panel?.querySelector?.(`[data-mwi-overview-id="${id}"]`);
      if (!element) return;
      activeScene = { controller, owner, id, element, tab: "cloud" };
      changeCollapsed(owner, ids => ids.delete(id));
      element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }

    function renderOverview(native) {
      const main = child(React, native, "mainView"), list = child(React, main, "characterLoadouts");
      if (!list) throw Error("配装总览未能识别当前列表，请更新脚本后刷新游戏。");
      const { props } = controller, owner = props.characterInfo?.characterID;
      if (!Number.isSafeInteger(owner) || owner <= 0 || typeof props.updateLoadoutSlotHandler !== "function")
        throw Error("配装总览所需数据尚未就绪，请重新打开配装页。");
      const rows = children(React, list);
      if (!rows.length && !VirtualPanel) return native;
      if (collapsedOwner !== owner) {
        collapsed = readCollapsed(owner) ?? new Set();
        collapsedOwner = owner;
        collapseSaveFailed = false;
        filterQuery = "";
        filterType = "all";
      }
      const cards = rows.map(row => {
        const id = row.props?.["data-loadout-id"], loadout = props.characterLoadoutDict[id];
        if (!Number.isSafeInteger(id) || loadout?.id !== id || typeof loadout.name !== "string" ||
            typeof row.props.onClick !== "function") throw Error("配装列表结构已变化");
        app.Cloud?.observeNative?.(owner, id, loadout);
        const overviewCollapsed = collapsed.has(id);
        const isCardActive = activeScene?.controller === controller && activeScene.owner === owner && activeScene.id === id;
        return h(Card, {
          key: `${owner}:${id}`, id, name: loadout.name, actionType: loadout.actionTypeHrid || "", overviewCollapsed,
          icon: children(React, row)[1],
          countTracker,
          toggleScenes: (element, tab = "scenes") => openCardPanel(owner, id, element, tab),
          toggleCard: () => changeCollapsed(owner, ids => {
            if (overviewCollapsed) ids.delete(id);
            else ids.add(id);
          }),
          nativeProps: {
            ...props,
            overviewId: id,
            overviewRequirements: mounted.requirements,
            overviewContentId: `mwi-loadout-content-${owner}-${id}`,
            overviewScenesOpen: isCardActive,
            overviewTab: isCardActive ? activeScene.tab : "scenes",
            overviewCanUpdateOptions: typeof props.updateLoadoutHandler === "function"
          },
          sendSlot: (element, change) => sendSlot(owner, id, element, change),
          sendOptions: (element, change) => sendOptions(owner, id, element, change)
        });
      });

      const hasCombat = cards.some(card => card.props.actionType === "/action_types/combat");
      const hasLife = cards.some(card => card.props.actionType !== "/action_types/combat");
      const query = filterQuery.trim().toLowerCase();
      const filtering = Boolean(query || filterType !== "all");
      const visibleCards = !filtering ? cards : cards.filter(card => {
        if (filterType === "combat" && card.props.actionType !== "/action_types/combat") return false;
        if (filterType === "life" && card.props.actionType === "/action_types/combat") return false;
        return !query || card.props.name.toLowerCase().includes(query);
      });

      const switchView = nextGrid => {
        if (showGrid === nextGrid) return;
        showGrid = nextGrid;
        activeScene = null;
        controller.forceUpdate();
      };
      const segmented = h("div", { key: "mwi-overview-segmented", className: "mwi-overview-segmented", role: "group", "aria-label": "配装视图" },
        h("button", {
          key: "mwi-overview-mode-grid", type: "button",
          className: "mwi-overview-seg-btn" + (showGrid ? " is-active" : ""),
          "aria-pressed": showGrid,
          onClick: () => switchView(true)
        }, "配装总览"),
        h("button", {
          key: "mwi-overview-toggle", type: "button",
          className: "mwi-overview-seg-btn" + (!showGrid ? " is-active" : ""),
          "aria-pressed": !showGrid,
          onClick: () => switchView(!showGrid)
        }, "原生列表"));

      const filterControls = showGrid && cards.length >= 2 && h("div", { key: "mwi-overview-filter", className: "mwi-overview-filter" },
        h("div", { className: "mwi-overview-search" + (filterQuery ? " has-value" : "") },
          h("svg", {
            className: "mwi-overview-search-icon", width: 13, height: 13, viewBox: "0 0 16 16",
            fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
            "aria-hidden": true
          },
            h("path", { d: "M7.25 12.25a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM13.75 13.75l-2.9-2.9" })),
          h("input", {
            key: "mwi-overview-search-input",
            type: "search",
            className: "mwi-overview-search-input",
            "aria-label": "搜索配装名称",
            placeholder: "搜索配装…",
            value: filterQuery,
            onKeyDown: e => {
              if (e.key === "Escape") {
                if (filterQuery) { filterQuery = ""; controller.forceUpdate(); }
                e.currentTarget?.blur?.();
              }
            },
            onChange: e => { filterQuery = e.target.value; controller.forceUpdate(); }
          }),
          filterQuery && h("button", {
            type: "button",
            className: "mwi-overview-search-clear",
            "aria-label": "清除搜索",
            onClick: () => { filterQuery = ""; controller.forceUpdate(); }
          }, "×")),
        hasCombat && hasLife && h("div", { className: "mwi-overview-filter-tabs", role: "group", "aria-label": "筛选配装类型" },
          [["all", "全部"], ["combat", "战斗"], ["life", "生活"]].map(([key, label]) => h("button", {
            key, type: "button",
            className: "mwi-overview-filter-tab" + (filterType === key ? " is-active" : ""),
            "aria-pressed": filterType === key,
            onClick: () => { filterType = key; controller.forceUpdate(); }
          }, label))));

      const allCollapsed = visibleCards.length > 0 && visibleCards.every(card => collapsed.has(card.props.id));
      const toggleAll = showGrid && visibleCards.length > 0 && h("button", {
        key: "mwi-overview-toggle-all", type: "button", className: "mwi-overview-button mwi-overview-ghost-btn",
        onClick: () => changeCollapsed(owner, ids => {
          for (const card of visibleCards) {
            if (allCollapsed) ids.delete(card.props.id);
            else ids.add(card.props.id);
          }
        })
      }, allCollapsed ? "全部展开" : "全部收起");

      const jumpVirtual = showGrid && VirtualPanel && h("button", {
        key: "mwi-overview-jump-virtual", type: "button", className: "mwi-overview-button mwi-overview-ghost-btn",
        onClick: () => mounted.panel?.querySelector?.("#mwi-virtual-section")?.scrollIntoView?.({ block: "start", behavior: "smooth" })
      }, "虚拟配装", h("span", {
        className: "mwi-overview-scene-count",
        hidden: !virtualCount,
        ref: node => { virtualCountNode = node; }
      }, virtualCount > 0 ? String(virtualCount) : ""));

      const toolbar = h("div", { key: "mwi-overview-toolbar", className: "mwi-overview-toolbar" },
        segmented,
        filterControls,
        h("div", { className: "mwi-overview-toolbar-right" },
          showGrid && app.Cloud && h(CloudLabel, {
            key: "sync", owner, ids: cards.map(card => card.props.id).join(","), tally: true,
            onJumpWarning: id => jumpToWarning(owner, id)
          }),
          jumpVirtual,
          toggleAll),
        showGrid && collapseSaveFailed && h("span", { className: "mwi-overview-toolbar-note", role: "status" }, "折叠状态未能保存，刷新后可能恢复之前的状态。"));

      const gridContent = visibleCards.length
        ? h("div", { key: "mwi-overview-grid", [marker]: "" }, visibleCards)
        : h("div", { key: "mwi-overview-empty", className: "mwi-overview-empty-filter", role: "status" },
            h("span", null, "没有匹配的配装"),
            h("button", {
              type: "button", className: "mwi-overview-button",
              onClick: () => { filterQuery = ""; filterType = "all"; controller.forceUpdate(); }
            }, "清除筛选"));

      const mainChildren = children(React, main).flatMap(entry => !hasClass(entry, "characterLoadouts") ? [entry] : [toolbar,
        showGrid ? gridContent : entry]);
      if (VirtualPanel) {
        mainChildren.push(h(VirtualPanel, {
          key: "virtual-" + owner,
          owner,
          nativeProps: props,
          getCatalog: () => app.VirtualDraft.catalog(codec, sprites),
          onCountChange: updateVirtualCount,
          nativeIcons: Object.fromEntries(rows.map(row => [props.characterLoadoutDict[row.props["data-loadout-id"]].actionTypeHrid || "", children(React, row)[1]]))
        }));
      }
      const updatedMain = React.cloneElement(main, null, mainChildren);
      return React.cloneElement(native, null, children(React, native)
        .map(entry => hasClass(entry, "mainView") ? updatedMain : entry));
    }

    if (typeof render !== "function") throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    controller.render = function () {
      const native = render.call(this);
      if (this.state.selectedCharacterLoadoutId !== null) return native;
      try {
        const result = renderOverview(native);
        mounted.failure = "";
        return result;
      } catch (_) {
        mounted.failure = "配装总览未能显示，已保留原生列表。请更新脚本后刷新游戏。";
        return native;
      }
    };
    installed.set(controller, mounted);
    controller.forceUpdate();
  }

  function sync() {
    let panel;
    try {
      panel = app.Adapter.visibleLoadoutPanel();
      if (!panel) return;
      if (!panel.querySelector('[class*="LoadoutsPanel_mainView__"]')) { notice(panel, ""); return; }
      const controller = app.Adapter.loadoutController(panel);
      if (!controller) { notice(panel, "配装总览尚未读取到游戏组件，请重新打开配装页。"); return; }
      const prior = installed.get(controller);
      if (prior) { prior.panel = panel; notice(panel, prior.failure || ""); }
      else if (controller.state.selectedCharacterLoadoutId === null) {
        const game = gameRuntime();
        if (game) { install(controller, panel, game); notice(panel, installed.get(controller)?.failure || ""); }
        else notice(panel, "配装总览未能访问游戏组件，请确认脚本管理器允许脚本在游戏页面运行，再刷新游戏。");
      }
    } catch (_) {
      if (panel) notice(panel, "配装总览初始化失败，已保留原生列表。请更新脚本后刷新游戏。");
    }
  }

  function start() {
    const style = document.createElement("style");
    style.id = "mwi-loadout-overview-style";
    style.textContent = css;
    document.head.append(style);
  }

  function itemDetails() {
    try {
      const game = gameRuntime();
      if (app.VirtualDraft?.catalog) return app.VirtualDraft.catalog(game?.codec, game?.sprites).items;
      const raw = root.localStorage.getItem("initClientData");
      if (!raw) return null;
      const text = raw.trimStart().startsWith("{") ? raw : game?.codec?.decompressFromUTF16(raw);
      return text ? JSON.parse(text).itemDetailMap || null : null;
    } catch (_) { return null; }
  }

  app.Overview = Object.freeze({ start, sync, currentScene, itemDetails });
})(globalThis);

// ---- app.js ----
(function (root) {
  "use strict";
  if (!/^(www\.)?milkywayidle(cn)?\.com$/.test(location.hostname) || !/^\/game\/?$/.test(location.pathname)) return;
  const app = root.MWILoadoutScenes;
  if (app.started) return;
  app.started = true;
  const { Core, Adapter, Store } = app;
  const css = ":host {\n  display: block;\n  width: 21.25rem;\n  max-width: 100%;\n  min-width: 0;\n  text-align: left;\n  color: #eef0f8;\n  font: inherit;\n  font-size: 13px;\n  line-height: 1.45;\n  --scene-bg: #151824;\n  --scene-inset: #11141d;\n  --scene-surface: rgba(255, 255, 255, 0.05);\n  --scene-surface-hover: rgba(255, 255, 255, 0.1);\n  --scene-line: rgba(255, 255, 255, 0.075);\n  --scene-line-soft: rgba(255, 255, 255, 0.05);\n  --scene-line-strong: rgba(255, 255, 255, 0.14);\n  --scene-primary: #4c63c4;\n  --scene-primary-hover: #5a72d4;\n  --scene-muted: #969db8;\n  --scene-faint: #6c7391;\n  --scene-warn: #f2c46d;\n  --scene-ok: #6ad89a;\n  --scene-danger: #ec868e;\n  --scene-danger-bg: rgba(236, 134, 142, 0.14);\n  --scene-ease: cubic-bezier(0.16, 1, 0.3, 1);\n}\n* { box-sizing: border-box; }\n.sr-only {\n  position: absolute;\n  width: 1px;\n  height: 1px;\n  padding: 0;\n  margin: -1px;\n  overflow: hidden;\n  clip: rect(0, 0, 0, 0);\n  white-space: nowrap;\n  border: 0;\n}\n\nsection {\n  overflow-wrap: anywhere;\n  margin: 10px 0 12px;\n  padding: 10px;\n  background: var(--scene-bg);\n  border: 1px solid var(--scene-line);\n  border-radius: 8px;\n}\n:host([data-overview]) { width: 100%; }\n:host([data-overview]) section {\n  margin: 0;\n  padding: 6px 10px 10px;\n  border: 0;\n  border-radius: 0;\n  border-bottom: 1px solid var(--scene-line);\n}\n\np { margin: 0; line-height: 1.45; }\n\n/* Minimal Underline Tabs Header */\n.header {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n  margin-bottom: 8px;\n  border-bottom: 1px solid var(--scene-line-soft);\n}\n.tabs {\n  display: inline-flex;\n  align-items: center;\n  gap: 2px;\n  min-width: 0;\n}\n.tab {\n  display: inline-flex;\n  align-items: center;\n  gap: 5px;\n  min-height: 30px;\n  padding: 4px 10px 6px;\n  margin-bottom: -1px;\n  border: 0;\n  border-bottom: 2px solid transparent;\n  border-radius: 4px 4px 0 0;\n  background: transparent;\n  color: var(--scene-muted);\n  font-weight: 500;\n  white-space: nowrap;\n  transition: color .14s ease, border-color .14s var(--scene-ease), background-color .14s ease;\n}\n.tab:hover { color: #eef0f8; background: rgba(255, 255, 255, 0.04); border-bottom-color: transparent; }\n.tab[aria-selected=\"true\"] {\n  color: #ffffff;\n  background: transparent;\n  border-bottom-color: #7d95f5;\n}\n.tab.has-warning { color: var(--scene-warn); }\n.tab-dot, .cloud-dot, .active-dot {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  flex: 0 0 6px;\n  background: var(--scene-faint);\n}\n.tab-dot[data-state=\"warn\"], .cloud-dot[data-state=\"warn\"] { background: var(--scene-warn); }\n.tab-dot[data-state=\"busy\"], .cloud-dot[data-state=\"busy\"] { background: #70b7ff; }\n.cloud-dot[data-state=\"ok\"] { background: var(--scene-ok); }\n\n.header-actions {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n  flex: 0 0 auto;\n  padding-bottom: 2px;\n}\n\n/* Base Controls */\nbutton, input, textarea, select {\n  font: inherit;\n  border-radius: 6px;\n}\nbutton {\n  color: inherit;\n  background: var(--scene-surface);\n  border: 1px solid var(--scene-line);\n  padding: 4px 10px;\n  min-height: 30px;\n  cursor: pointer;\n  text-align: start;\n  max-width: 100%;\n  min-width: 0;\n  overflow-wrap: anywhere;\n  transition: background-color .14s var(--scene-ease), border-color .14s var(--scene-ease), color .14s ease;\n}\nbutton:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: var(--scene-line-strong);\n  color: #ffffff;\n}\nbutton[aria-pressed=\"true\"], button.primary {\n  background: var(--scene-primary);\n  border-color: rgba(142, 164, 255, 0.42);\n  color: #ffffff;\n}\nbutton.primary:hover:not(:disabled) {\n  background: var(--scene-primary-hover);\n  border-color: rgba(158, 178, 255, 0.65);\n}\nbutton.danger {\n  background: var(--scene-danger-bg);\n  border-color: rgba(236, 134, 142, 0.5);\n  color: var(--scene-danger);\n}\nbutton.danger:hover:not(:disabled) { background: rgba(236, 134, 142, 0.24); }\nbutton.danger-text { color: var(--scene-danger); }\nbutton.danger-hover:hover:not(:disabled) {\n  color: var(--scene-danger);\n  background: var(--scene-danger-bg);\n  border-color: transparent;\n}\nbutton:disabled { opacity: .45; cursor: not-allowed; }\nbutton:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible, summary:focus-visible, li:focus, a:focus-visible {\n  outline: 2px solid #9ecfff;\n  outline-offset: 2px;\n}\n\n.icon-btn {\n  width: 28px;\n  min-height: 28px;\n  padding: 0;\n  flex: 0 0 28px;\n  display: inline-grid;\n  place-items: center;\n  background: transparent;\n  border-color: transparent;\n  color: var(--scene-muted);\n}\n.icon-btn:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.compact-btn {\n  min-height: 28px;\n  padding: 3px 9px;\n  font-size: 0.92em;\n  font-weight: 500;\n  white-space: nowrap;\n  text-align: center;\n}\n.ghost-btn {\n  background: transparent;\n  border-color: transparent;\n  color: var(--scene-muted);\n  padding: 3px 8px;\n}\n.ghost-btn:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.copy-btn {\n  min-width: 5.5em;\n  text-align: center;\n}\nbutton.is-copied,\nbutton.is-copied:hover:not(:disabled) {\n  color: var(--scene-ok);\n}\nbutton.primary.is-copied,\nbutton.primary.is-copied:hover:not(:disabled) {\n  background: rgba(106, 216, 154, 0.22);\n  border-color: rgba(106, 216, 154, 0.55);\n  color: #d8fbe6;\n}\nsvg {\n  width: 14px;\n  height: 14px;\n  fill: none;\n  stroke: currentColor;\n  stroke-width: 1.7;\n  stroke-linecap: round;\n  stroke-linejoin: round;\n}\n\ninput, textarea, select {\n  color: #eef0f8;\n  background: var(--scene-inset);\n  border: 1px solid var(--scene-line-strong);\n  padding: 5px 9px;\n  min-height: 30px;\n  min-width: 0;\n  width: 100%;\n  caret-color: #9ecfff;\n  transition: border-color .14s ease;\n}\ninput::placeholder, textarea::placeholder { color: var(--scene-faint); }\ntextarea { resize: vertical; }\n\n/* Simulator Export & Multi-Player Import */\n.import-match-row {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n.import-choice-row { display: grid; gap: 4px; }\n.sim-export { gap: 8px; }\n.simulator-source, .simulator-targets {\n  min-width: 0;\n  margin: 0;\n  padding: 0;\n  border: 0;\n}\n.simulator-source legend, .simulator-targets legend {\n  margin-bottom: 5px;\n  padding: 0;\n  font-size: 0.85em;\n  color: var(--scene-faint);\n}\n.sim-source-chips {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 4px;\n  max-height: 108px;\n  overflow-y: auto;\n}\n.sim-chip {\n  min-height: 26px;\n  padding: 2px 9px;\n  font-size: 0.9em;\n  border-radius: 5px;\n  border-color: transparent;\n  background: rgba(255, 255, 255, 0.04);\n  color: var(--scene-muted);\n}\n.sim-chip:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.sim-target-grid {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 2px;\n  background: var(--scene-inset);\n  border: 1px solid var(--scene-line);\n  border-radius: 6px;\n  padding: 3px;\n}\n.simulator-export-target {\n  display: flex;\n  align-items: baseline;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 2px 8px;\n  width: 100%;\n  min-height: 30px;\n  padding: 4px 8px;\n  border: 0;\n  border-radius: 4px;\n  background: transparent;\n  text-align: left;\n}\n.simulator-export-target:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n}\n.simulator-export-target small {\n  color: var(--scene-faint);\n  font-size: 0.82em;\n  overflow-wrap: anywhere;\n}\n.simulator-export-target[aria-pressed=\"true\"] small { color: #d9e2ff; }\n.sim-result {\n  display: grid;\n  gap: 6px;\n  padding-top: 8px;\n  border-top: 1px solid var(--scene-line-soft);\n}\n.sim-route { font-size: 0.9em; color: #e4e7f7; }\n.sim-warn { font-size: 0.85em; color: var(--scene-warn); }\n\n/* Scene Chips Row */\n.choices {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 5px;\n}\n.choice-chip {\n  min-height: 30px;\n  padding: 4px 10px;\n  border-radius: 6px;\n  background: rgba(255, 255, 255, 0.045);\n  border-color: var(--scene-line);\n  -webkit-touch-callout: none;\n  user-select: none;\n}\n.add-btn {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 4px;\n  min-height: 30px;\n  padding: 4px 8px;\n  border-radius: 6px;\n  border-color: transparent;\n  background: transparent;\n  color: var(--scene-muted);\n  white-space: nowrap;\n}\n.add-btn:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.add-btn.compact-icon {\n  width: 30px;\n  padding: 0;\n  flex: 0 0 30px;\n}\n.add-btn.compact-icon .add-label { display: none; }\n.import-btn {\n  min-height: 30px;\n  padding: 4px 8px;\n  border-radius: 6px;\n  border-color: transparent;\n  background: transparent;\n  color: var(--scene-muted);\n  white-space: nowrap;\n}\n.import-btn:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.empty { color: var(--scene-faint); font-size: 0.92em; margin-inline-end: 2px; }\n.muted { color: var(--scene-muted); font-size: 0.9em; }\n\n/* Contextual Active Scene Panel */\n.active-scene {\n  margin-top: 8px;\n  padding: 7px 9px;\n  background: rgba(255, 255, 255, 0.03);\n  border: 1px solid var(--scene-line-soft);\n  border-inline-start: 2px solid var(--scene-ok);\n  border-radius: 6px;\n}\n.active-scene[data-state=\"diff\"] { border-inline-start-color: var(--scene-warn); }\n.active-head {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n}\n.diff-toggle {\n  flex: 1 1 auto;\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 5px;\n  min-height: 26px;\n  padding: 2px 4px;\n  margin: -2px 0 -2px -4px;\n  border: 0;\n  background: transparent;\n  text-align: start;\n}\n.diff-toggle:hover:not(:disabled) { background: rgba(255, 255, 255, 0.05); border: 0; }\n.diff-toggle:disabled { opacity: 1; cursor: default; }\n.active-dot { background: var(--scene-ok); }\n.active-scene[data-state=\"diff\"] .active-dot { background: var(--scene-warn); }\n.active-name { font-weight: 600; color: #eef0f8; }\n.active-sep { color: var(--scene-faint); }\n#summary { color: var(--scene-ok); font-weight: 500; }\n#summary.pending { color: var(--scene-warn); }\n.diff-caret {\n  display: inline-flex;\n  color: var(--scene-faint);\n  transition: transform .15s var(--scene-ease);\n}\n.active-scene.diff-open .diff-caret { transform: rotate(180deg); }\n\n.active-actions {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 6px;\n  margin-top: 5px;\n  padding-top: 5px;\n  border-top: 1px solid var(--scene-line-soft);\n}\n.active-actions-left, .active-actions-right {\n  display: flex;\n  align-items: center;\n  gap: 2px;\n}\n.active-actions-right { margin-inline-start: auto; gap: 4px; }\n.update-button,\n.remove-button {\n  width: calc(4em + 24px);\n  flex: 0 0 auto;\n  text-align: center;\n}\n.remove-button.danger,\n.remove-button.danger:hover:not(:disabled) {\n  background: rgba(236, 134, 142, 0.24);\n  border-color: rgba(236, 134, 142, 0.65);\n  color: #ffd9dc;\n  font-weight: 600;\n}\n\n/* Difference List */\n.diff-panel {\n  margin-top: 7px;\n  padding-top: 6px;\n  border-top: 1px solid var(--scene-line-soft);\n}\nol { list-style: none; padding: 0; margin: 0; }\nli {\n  padding: 6px 0;\n  border-bottom: 1px solid var(--scene-line-soft);\n  overflow-wrap: anywhere;\n}\nli:last-child { border-bottom: 0; padding-bottom: 0; }\n.change-title {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-bottom: 2px;\n}\n.change-title strong { flex: 1; font-weight: 500; color: #eef0f8; }\n.change-title button {\n  min-height: 24px;\n  border: 0;\n  background: transparent;\n  padding: 2px 6px;\n  color: #9ecfff;\n  font-size: 0.9em;\n}\n.change-title button:hover { background: rgba(158, 207, 255, 0.12); border: 0; }\n.unlocated-tag { color: var(--scene-warn); font-size: 0.85em; }\n.values {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);\n  gap: 6px;\n  font-size: 0.92em;\n}\n.values .current { color: var(--scene-muted); }\n.values .arrow { color: var(--scene-faint); }\n.values .goal { color: var(--scene-warn); }\ndetails summary {\n  padding: 4px 0;\n  cursor: pointer;\n  color: var(--scene-muted);\n  font-size: 0.9em;\n}\npre {\n  white-space: pre-wrap;\n  overflow-wrap: anywhere;\n  font-size: 0.84em;\n  padding: 7px 8px;\n  margin: 4px 0 0;\n  background: var(--scene-inset);\n  border-radius: 5px;\n}\n\n/* Inline Editors & Overflow Menu */\n.editor {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 7px;\n  margin-top: 8px;\n  padding: 8px 9px;\n  background: rgba(255, 255, 255, 0.03);\n  border: 1px solid var(--scene-line);\n  border-radius: 7px;\n}\n.editor-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 6px;\n}\n.editor-title {\n  font-size: 0.92em;\n  font-weight: 500;\n  color: #eef0f8;\n}\n.inline-form-row {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n.inline-form-row input { flex: 1 1 140px; }\n.actions {\n  display: flex;\n  align-items: center;\n  justify-content: flex-end;\n  flex-wrap: wrap;\n  gap: 5px;\n}\n.split-actions { justify-content: space-between; }\n\n.menu {\n  display: grid;\n  gap: 5px;\n  margin-bottom: 8px;\n  padding: 5px;\n  background: #1c2030;\n  border: 1px solid var(--scene-line-strong);\n  border-radius: 7px;\n  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.32);\n}\n.menu.menu-inline {\n  margin: 6px 0 0;\n}\n.menu-group {\n  display: grid;\n  gap: 3px;\n  padding-bottom: 5px;\n  border-bottom: 1px solid var(--scene-line);\n}\n.menu-label {\n  font-size: 0.82em;\n  color: var(--scene-faint);\n  padding: 2px 7px 0;\n}\n.menu-grid {\n  display: grid;\n  grid-template-columns: repeat(2, minmax(0, 1fr));\n  gap: 2px;\n}\n.menu button {\n  background: transparent;\n  border-color: transparent;\n  min-height: 30px;\n  padding: 4px 8px;\n  font-size: 0.92em;\n  color: #d9ddf0;\n}\n.menu button:hover:not(:disabled) {\n  background: var(--scene-surface-hover);\n  border-color: transparent;\n  color: #ffffff;\n}\n.menu button.danger-text { color: var(--scene-danger); }\n.menu button.danger-text:hover:not(:disabled) { background: var(--scene-danger-bg); color: var(--scene-danger); }\n.menu button.danger,\n.menu button.danger:hover:not(:disabled) {\n  background: rgba(236, 134, 142, 0.24);\n  border-color: rgba(236, 134, 142, 0.65);\n  color: #ffd9dc;\n  font-weight: 600;\n}\n\n/* Notice / Undo / Error — Non-shifting Floating Toast */\n.notice,\n.cloud-feedback {\n  position: fixed;\n  inset: auto 18px 20px auto;\n  z-index: 99990;\n  max-width: min(360px, calc(100vw - 36px));\n  margin: 0;\n  padding: 7px 11px;\n  background: #191d2c;\n  border: 1px solid var(--scene-line-strong);\n  border-radius: 8px;\n  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.48);\n  font-size: 0.9em;\n  color: #eef0f8;\n}\n.notice {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n#status { flex: 1 1 120px; min-width: 0; overflow-wrap: anywhere; }\n#status.error,\n.cloud-feedback.is-error { color: var(--scene-warn); }\n\n/* Cloud Sync Pane */\n.cloud-panel { display: grid; gap: 7px; }\n.cloud-head {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  flex-wrap: wrap;\n  gap: 6px;\n}\n.cloud-status {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  font-weight: 500;\n  min-width: 0;\n}\n.cloud-status.cloud-warning, .cloud-note, .cloud-compare-title { color: var(--scene-warn); }\n.cloud-note { font-size: 0.9em; }\n.cloud-feedback { color: var(--scene-ok); }\n.cloud-actions { display: flex; flex-wrap: wrap; gap: 4px; }\n.cloud-stats {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 4px 10px;\n  padding: 4px 0;\n  font-size: 0.86em;\n  color: var(--scene-muted);\n}\n.cloud-stat-time {\n  margin-inline-start: auto;\n  color: var(--scene-faint);\n  font-variant-numeric: tabular-nums;\n}\n.cloud-compare {\n  display: grid;\n  gap: 6px;\n  padding: 8px;\n  background: rgba(255, 255, 255, 0.03);\n  border: 1px solid var(--scene-line);\n  border-radius: 6px;\n}\n.cloud-compare-alert { border-inline-start: 2px solid var(--scene-warn); }\n.cloud-compare > summary { font-weight: 500; color: var(--scene-warn); padding: 0; }\n.cloud-facts {\n  display: grid;\n  grid-template-columns: max-content minmax(0, 1fr);\n  gap: 4px 10px;\n  margin: 0;\n  font-size: 0.88em;\n}\n.cloud-facts dt { color: var(--scene-faint); }\n.cloud-facts dd { margin: 0; }\n.cloud-diff { list-style: none; margin: 4px 0 0; padding: 0; font-size: 0.9em; }\n.cloud-diff li { padding: 5px 0; }\n.cloud-diff li div { color: var(--scene-muted); }\n.cloud-confirm {\n  display: grid;\n  gap: 6px;\n  border-inline-start: 2px solid var(--scene-warn);\n  padding-inline-start: 8px;\n  font-size: 0.9em;\n}\n.cloud-tech { border-top: 1px solid var(--scene-line-soft); padding-top: 6px; }\n.cloud-tech-body { display: grid; gap: 3px; font-size: 0.86em; }\n.cloud-link-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: baseline; }\n.cloud-panel a { color: #9ecfff; overflow-wrap: anywhere; text-decoration: none; }\n.cloud-panel a:hover { text-decoration: underline; }\n.cloud-privacy { color: var(--scene-faint); }\n\n/* Slot Markers */\n:host([data-mwi-scene-marker]) {\n  display: block;\n  width: 100%;\n  max-width: 100%;\n  margin-top: 4px;\n  color: #ffe09c;\n  font: 11px/1.36 -apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif;\n}\n.target-markers {\n  display: grid;\n  grid-template-columns: minmax(0, 1fr);\n  gap: 2px;\n  overflow-wrap: anywhere;\n}\n.target-value {\n  display: block;\n  padding: 1px 3px;\n  border-radius: 3px;\n  background: rgba(255, 190, 79, 0.16);\n  color: #ffe3a8;\n  font-weight: 600;\n}\n.target-condition {\n  color: #ffe09c;\n  border: 0;\n  border-radius: 3px;\n  padding: 2px 3px;\n  min-height: 24px;\n  width: 100%;\n  font: inherit;\n  font-weight: 500;\n  text-align: start;\n  background: rgba(255, 190, 79, 0.12);\n  text-decoration: underline;\n  text-underline-offset: 2px;\n}\n\n[hidden] { display: none !important; }\n::selection { background: #4c63c4; color: #fff; }\n* { scrollbar-width: thin; scrollbar-color: rgba(255, 255, 255, 0.16) transparent; }\n@media (pointer: coarse) {\n  button, .tab, .icon-btn, .compact-btn, .choice-chip, .add-btn, .import-btn { min-height: 40px; }\n  .icon-btn { width: 40px; flex-basis: 40px; }\n}\n@media (max-width: 420px) {\n  .menu-grid { grid-template-columns: minmax(0, 1fr); }\n}\n@media (prefers-reduced-motion: reduce) {\n  * { scroll-behavior: auto !important; transition: none !important; }\n}\n";
  let mounted = null, context = null, rows = [], selectedId = null, busy = false, undo = null, confirmation = null;
  let last = "", loading = 0, failure = "", highlighted = [], highlightedSlots = [], comparingSetup = null, unresolved = [];
  const markers = new Map(), pickerGuides = new Map(), scrolledPickers = new WeakMap();
  let menuId = null, pickerHighlights = [], prefilledHighlights = [], activeTab = "scenes", diffOpen = false;
  let cachedDiffKey = "", cachedDiff = null, pickerFrame = 0;
  const pickerSelector = '[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"], [class*="CombatTriggersSetting_combatTriggersEditMenu__"], ul[role="listbox"]';
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("mwi-layu-loadout-scenes") : null;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function button(text, handler, attrs = {}) {
    const node = el("button", text, { type: "button", ...attrs });
    node.addEventListener("click", handler);
    return node;
  }
  function svgIcon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    if (kind === "add") svg.innerHTML = '<path d="M8 3v10M3 8h10"/>';
    else if (kind === "more") svg.innerHTML = '<circle cx="3.2" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.8" cy="8" r="1.1" fill="currentColor" stroke="none"/>';
    else if (kind === "close") svg.innerHTML = '<path d="M4 4l8 8M12 4l-8 8"/>';
    else if (kind === "caret") svg.innerHTML = '<path d="M4.5 6.25L8 9.75l3.5-3.5"/>';
    return svg;
  }
  const activeRows = () => rows.filter(row => !row.removedAt).sort((a, b) => a.createdAt - b.createdAt);
  const selected = () => activeRows().find(row => row.id === selectedId);
  const isCombat = ctx => ctx?.raw?.actionTypeHrid === "/action_types/combat";

  let messageTimer = null;
  function message(text, error = false) {
    if (!mounted) return;
    clearTimeout(messageTimer);
    mounted.status.textContent = text;
    mounted.status.classList.toggle("error", error);
    mounted.status.hidden = !text;
    mounted.retry.hidden = !error;
    mounted.notice.hidden = !text && !undo;
    if (text && !error && !undo) {
      messageTimer = setTimeout(() => {
        if (mounted && mounted.status.textContent === text && !undo) {
          mounted.status.textContent = "";
          mounted.status.hidden = true;
          mounted.notice.hidden = true;
        }
      }, 2800);
    }
  }
  function clearHighlights() {
    for (const element of highlighted) {
      element.removeAttribute("data-mwi-scene-change");
      element.removeAttribute("data-mwi-scene-pulse");
    }
    highlighted = [];
    for (const element of highlightedSlots) element.removeAttribute("data-mwi-scene-slot-change");
    highlightedSlots = [];
    comparingSetup?.removeAttribute("data-mwi-scene-comparing");
    comparingSetup = null;
    unresolved = [];
    for (const node of pickerHighlights) node.removeAttribute("data-mwi-scene-target");
    pickerHighlights = [];
    for (const node of prefilledHighlights) node.removeAttribute("data-mwi-scene-prefilled");
    prefilledHighlights = [];
    for (const { node } of pickerGuides.values()) node.remove();
    pickerGuides.clear();
    for (const { host } of markers.values()) host.remove();
    markers.clear();
  }
  function detach() {
    app.Cloud.setActive(null);
    loading++;
    clearTimeout(messageTimer);
    clearHighlights();
    mounted?.host.remove();
    mounted = null;
    context = null;
    rows = [];
    selectedId = null;
    last = "";
    undo = null;
    confirmation = null;
    diffOpen = false;
    activeTab = "scenes";
    cachedDiffKey = "";
    cachedDiff = null;
    if (pickerFrame) { cancelAnimationFrame(pickerFrame); pickerFrame = 0; }
  }
  function currentContext() {
    const fresh = Adapter.current();
    if (!fresh || fresh.scope !== context?.scope || fresh.details !== context.details) {
      throw Error("当前角色或父配装已变化，请在对应配装下重试。");
    }
    return fresh;
  }
  function notify(ctx) {
    channel?.postMessage({ scope: ctx.scope });
    app.Cloud.changed(ctx.props.characterInfo.characterID, ctx.raw.id);
  }
  async function reload() {
    const token = ++loading, scope = context?.scope;
    if (!scope) return;
    try {
      const result = await Store.list(scope);
      if (token !== loading || context?.scope !== scope) return;
      rows = result;
      mounted.cloud.update(rows, context);
      if (!selected()) selectedId = null;
      render();
      message(failure, Boolean(failure));
    } catch (error) {
      if (token === loading) message(error.message, true);
    }
  }
  async function run(work) {
    if (busy || !mounted) return;
    const ui = mounted;
    busy = true;
    render();
    let success = false;
    try {
      await work();
      success = mounted === ui;
    } catch (error) {
      if (mounted === ui) message(error.message || "操作失败，请重试。", true);
    } finally {
      busy = false;
      if (mounted) render();
    }
    return success;
  }
  function setTab(tab, syncOverview = true) {
    if (!mounted) return;
    activeTab = tab === "cloud" ? "cloud" : "scenes";
    mounted.tabScenes.setAttribute("aria-selected", String(activeTab === "scenes"));
    mounted.tabCloud.setAttribute("aria-selected", String(activeTab === "cloud"));
    mounted.paneScenes.hidden = activeTab !== "scenes";
    mounted.paneCloud.hidden = activeTab !== "cloud";
    setMenu(false);
    if (syncOverview) context?.setOverviewTab?.(activeTab);
  }
  function setDiffOpen(open) {
    if (!mounted) return;
    diffOpen = Boolean(open);
    mounted.differences.hidden = !diffOpen;
    mounted.diffToggle.setAttribute("aria-expanded", String(diffOpen));
    mounted.activeScene.classList.toggle("diff-open", diffOpen);
  }
  async function saveNew() {
    const success = await run(async () => {
      const ctx = currentContext(), title = Core.name(mounted.name.value), ui = mounted;
      let row;
      try { row = await Store.create(ctx, title, ui.overwrite?.name === title ? ui.overwrite : null); }
      catch (error) {
        if (error.code !== "NAME_EXISTS" || mounted !== ui) throw error;
        ui.overwrite = error.existing;
        ui.overwriteNote.textContent = `再次点击将覆盖“${title}”的原有内容。`;
        ui.overwriteNote.hidden = false;
        return;
      }
      notify(ctx);
      if (mounted !== ui) return;
      selectedId = row.id;
      diffOpen = false;
      mounted.name.value = "";
      mounted.form.hidden = true;
      mounted.overwrite = null;
      mounted.overwriteNote.hidden = true;
      await reload();
      if (mounted === ui) message("");
    });
    if (success && mounted.form.hidden) mounted.add.focus();
  }
  function closeImportForm() {
    if (!mounted || mounted.importForm.hidden) return;
    mounted.closeImportSession?.();
    mounted.importForm.hidden = true;
  }
  function requestAction(action, targetRow, source = null) {
    const row = targetRow || (action === "snapshot" ? selected() : activeRows().find(entry => entry.id === menuId) || selected());
    if (!row) return;
    const mode = action === "remove" ? (source || (!mounted.menu.hidden && menuId === row.id ? "menu" : "direct")) : null;
    if (activeTab !== "scenes") setTab("scenes");
    confirmation = { action, row, source: mode };
    mounted.form.hidden = true;
    closeImportForm();
    mounted.simulatorExportForm.hidden = true;
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    if (mode !== "menu") setMenu(false);
    render();
    if (action === "snapshot") mounted.update.focus();
    else if (action === "rename") mounted.rename.focus();
    else if (mode === "menu") mounted.remove.focus();
    else if (mode === "direct") mounted.removeDirect.focus();
    else mounted.commit.focus();
  }
  async function commitAction() {
    const pending = confirmation;
    if (!pending) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const row = await Store.mutate(ctx, pending.row, pending.action, mounted.rename.value);
      notify(ctx);
      if (mounted !== ui) return;
      if (pending.action === "remove") {
        undo = row;
        if (selectedId === row.id) { selectedId = null; diffOpen = false; }
      }
      confirmation = null;
      setMenu(false);
      await reload();
      if (mounted !== ui) return;
      message(pending.action === "remove" ? `已移除“${row.name}”` : "");
    });
    if (success) (pending.action === "snapshot" ? mounted.update : mounted.add).focus();
  }
  async function restore() {
    const row = undo;
    if (!row) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const restored = await Store.mutate(ctx, row, "restore");
      notify(ctx);
      if (mounted !== ui) return;
      undo = null;
      selectedId = restored.id;
      diffOpen = false;
      await reload();
      if (mounted === ui) message("");
    });
    if (success) mounted.add.focus();
  }
  function download() {
    try {
      const ctx = currentContext(), text = Store.exportBackup(ctx, rows);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = el("a", "", { href: url, download: `配装子方案-${ctx.raw.id}-${new Date().toISOString().slice(0, 10)}.json` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMenu(false);
      message("已导出备份");
    } catch (error) {
      message(error.message, true);
    }
  }
  function setMenu(open) {
    if (!mounted) return;
    if (!open) mounted.resetBackupOverwrite?.();
    let clearedRemove = false;
    if (open) {
      const inline = menuId !== null && activeTab === "scenes";
      mounted.menu.classList.toggle("menu-inline", inline);
      if (inline) mounted.choices.after(mounted.menu);
      else mounted.header.after(mounted.menu);
    } else if (confirmation?.action === "remove" && confirmation.source === "menu") {
      confirmation = null;
      clearedRemove = true;
    }
    mounted.menu.hidden = !open;
    mounted.manage.setAttribute("aria-expanded", String(open && menuId === null));
    for (const node of mounted.choices.querySelectorAll("button")) {
      node.setAttribute("aria-expanded", String(open && (node.dataset.sceneId || null) === menuId));
    }
    if (clearedRemove) render();
  }
  function bindMenu(node, id) {
    let timer = null, start = null, suppress = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const open = () => {
      if (busy || !node.isConnected || !mounted) return;
      menuId = id;
      confirmation = null;
      mounted.form.hidden = true;
      closeImportForm();
      mounted.simulatorExportForm.hidden = true;
      render();
      setMenu(true);
      mounted.menu.querySelector("button:not(:disabled):not([hidden])")?.focus();
    };
    node.setAttribute("aria-controls", "scene-menu");
    node.setAttribute("aria-expanded", "false");
    node.addEventListener("contextmenu", event => { event.preventDefault(); cancel(); open(); });
    node.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); open(); }
    });
    node.addEventListener("pointerdown", event => {
      cancel();
      suppress = false;
      if (event.button !== 0 || event.isPrimary === false) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { timer = null; suppress = true; open(); }, 550);
    });
    node.addEventListener("pointermove", event => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) node.addEventListener(type, cancel);
    node.addEventListener("click", event => {
      if (suppress) { suppress = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  function currentDiff(ctx, row) {
    const itemDetails = app.Overview?.itemDetails?.() || null;
    const key = `${ctx.scope}|${last}|${row.id}|${row.revision}|${itemDetails ? 1 : 0}`;
    if (key !== cachedDiffKey || !cachedDiff) {
      cachedDiff = Core.diff(ctx.raw, row.snapshot, { ignoreHarmlessEmpty: true, itemDetails });
      cachedDiffKey = key;
    }
    return cachedDiff;
  }
  function renderGuideNode(guide) {
    const attr = guide.kind === "trigger" ? "data-mwi-trigger-guide" : "data-mwi-picker-guide";
    const box = el("div", null, { [attr]: "", "data-state": guide.state || "guide", role: "status" });
    box.append(el("div", guide.title, { class: "mwi-guide-title" }));
    if (Array.isArray(guide.rows) && guide.rows.length) {
      const ul = el("ul", null, { class: "mwi-guide-list" });
      for (const item of guide.rows) {
        const li = el("li", null, { class: item.done ? "is-done" : "is-todo" });
        li.append(el("span", item.done ? "✓" : "●", { class: "mwi-guide-mark", "aria-hidden": "true" }));
        li.append(el("span", item.text, { class: "mwi-guide-text" }));
        if (item.prefilled) li.append(el("span", "已预填", { class: "mwi-guide-tag" }));
        ul.append(li);
      }
      box.append(ul);
    }
    return box;
  }
  function syncPicker() {
    let next = [], nextPrefilled = [], scrollTargets = [], guides = [];
    const row = selected();
    const hasOpen = pickerHighlights.length || prefilledHighlights.length || pickerGuides.size || document.querySelector(pickerSelector);
    if (mounted && context && row && !failure && hasOpen) {
      try {
        const result = Adapter.pickerGuidance
          ? Adapter.pickerGuidance(context, currentDiff(context, row))
          : { targets: Adapter.pickerTargets(context, currentDiff(context, row)), prefilled: [], scrollTargets: [], guides: [] };
        next = result.targets || [];
        nextPrefilled = result.prefilled || [];
        scrollTargets = result.scrollTargets || [];
        guides = result.guides || [];
      } catch (_) { /* Unknown picker: retain the slot guide. */ }
    }
    for (const node of pickerHighlights) if (!next.includes(node)) node.removeAttribute("data-mwi-scene-target");
    for (const node of next) node.setAttribute("data-mwi-scene-target", "");
    pickerHighlights = next;
    for (const node of prefilledHighlights) if (!nextPrefilled.includes(node)) node.removeAttribute("data-mwi-scene-prefilled");
    for (const node of nextPrefilled) node.setAttribute("data-mwi-scene-prefilled", "");
    prefilledHighlights = nextPrefilled;
    const activeHosts = new Set(guides.map(guide => guide.host));
    for (const [host, entry] of pickerGuides) {
      if (!activeHosts.has(host) || !entry.node.isConnected) {
        entry.node.remove();
        pickerGuides.delete(host);
      }
    }
    for (const guide of guides) {
      const existing = pickerGuides.get(guide.host);
      if (existing && existing.key === guide.key && existing.node.isConnected) continue;
      existing?.node.remove();
      const node = renderGuideNode(guide);
      if (guide.after && guide.after.parentElement === guide.host) guide.after.after(node);
      else guide.host.prepend(node);
      pickerGuides.set(guide.host, { node, key: guide.key });
    }
    for (const item of scrollTargets) {
      if (!item?.container || !item.node || !item.node.isConnected) continue;
      if (scrolledPickers.get(item.container) === item.key) continue;
      scrolledPickers.set(item.container, item.key);
      try { item.node.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      catch (_) { /* Ignore non-scrollable containers. */ }
    }
  }
  function schedulePickerSync() {
    if (pickerFrame || !mounted || !context || !selected() || failure) return;
    if (!pickerHighlights.length && !prefilledHighlights.length && !pickerGuides.size && !document.querySelector(pickerSelector)) return;
    pickerFrame = requestAnimationFrame(() => {
      pickerFrame = 0;
      syncPicker();
    });
  }
  function showNew() {
    if (busy || failure) return;
    mounted.overwrite = null;
    mounted.overwriteNote.hidden = true;
    mounted.simulatorExportForm.hidden = true;
    setTab("scenes");
    confirmation = null;
    setMenu(false);
    closeImportForm();
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    mounted.form.hidden = false;
    render();
    mounted.name.focus();
  }
  function showImportSolo() {
    if (busy || failure) return;
    const wasHidden = mounted.importForm.hidden;
    mounted.simulatorExportForm.hidden = true;
    setTab("scenes");
    confirmation = null;
    setMenu(false);
    mounted.form.hidden = true;
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    mounted.importForm.hidden = false;
    if (wasHidden) mounted.openImportSession?.();
    render();
    mounted.importName.focus();
  }
  function closeEditor() {
    const updating = confirmation?.action === "snapshot";
    const removingDirect = confirmation?.action === "remove" && confirmation.source === "direct";
    mounted.simulatorExportForm.hidden = true;
    confirmation = null;
    mounted.form.hidden = true;
    closeImportForm();
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    render();
    if (updating && !mounted.update.hidden) mounted.update.focus();
    else if (removingDirect && !mounted.removeDirect.hidden) mounted.removeDirect.focus();
    else mounted.add.focus();
  }
  function stopComparison() {
    selectedId = null;
    confirmation = null;
    diffOpen = false;
    setMenu(false);
    render();
    message("");
    mounted.add.focus();
  }

  function mount(ctx) {
    const host = el("div", null, { id: "mwi-loadout-scenes-host" }), shadow = host.attachShadow({ mode: "open" });
    if (ctx.overview) host.setAttribute("data-overview", "");
    shadow.append(el("style", css));

    const section = el("section", null, { "aria-labelledby": "scene-title" });
    const header = el("div", null, { class: "header" });
    const heading = el("h2", "子方案", { id: "scene-title", class: "sr-only" });

    const tabs = el("div", null, { class: "tabs", role: "tablist", "aria-label": "工作区视图" });
    const tabScenes = button("子方案", () => setTab("scenes"), {
      class: "tab", role: "tab", "aria-selected": "true", "data-tab": "scenes"
    });
    const tabCloud = button(null, () => setTab("cloud"), {
      class: "tab", role: "tab", "aria-selected": "false", "data-tab": "cloud"
    });
    const tabCloudDot = el("span", null, { class: "tab-dot", hidden: "", "aria-hidden": "true" });
    tabCloud.append("云同步", tabCloudDot);
    tabs.append(tabScenes, tabCloud);

    const headerActions = el("div", null, { class: "header-actions" });
    const manage = button(null, () => {
      const opening = mounted.menu.hidden || menuId !== null;
      menuId = null;
      confirmation = null;
      form.hidden = true;
      closeImportForm();
      simulatorExportForm.hidden = true;
      render();
      setMenu(opening);
      if (opening) mounted.menu.querySelector("button:not(:disabled):not([hidden])")?.focus();
    }, { class: "icon-btn", "aria-label": "更多操作", title: "更多操作", "aria-controls": "scene-menu", "aria-expanded": "false" });
    manage.append(svgIcon("more"));
    headerActions.append(manage);

    if (ctx.overview && typeof ctx.closeOverviewScenes === "function") {
      const closeTray = button(null, () => ctx.closeOverviewScenes(), {
        class: "icon-btn", "aria-label": "收起子方案面板", title: "收起面板"
      });
      closeTray.append(svgIcon("close"));
      headerActions.append(closeTray);
    }
    header.append(heading, tabs, headerActions);

    const menu = el("div", null, { id: "scene-menu", class: "menu", hidden: "", "aria-label": "方案与备份操作" });
    const menuContextGroup = el("div", null, { class: "menu-group", hidden: "" });
    const menuTargetLabel = el("div", "", { class: "menu-label" });
    const menuContextRow = el("div", null, { class: "menu-grid" });
    const renameButton = button("改名", () => requestAction("rename"));
    const remove = button("移除", () => {
      if (confirmation?.action === "remove" && confirmation.source === "menu" && confirmation.row.id === menuId) commitAction();
      else requestAction("remove", activeRows().find(entry => entry.id === menuId), "menu");
    }, { class: "danger-text" });
    const stop = button("结束对比", stopComparison);
    menuContextRow.append(renameButton, remove, stop);
    menuContextGroup.append(menuTargetLabel, menuContextRow);

    const menuLoadoutRow = el("div", null, { class: "menu-grid" });
    const virtualButton = button("存为虚拟配装", () => run(async () => {
      const fresh = currentContext();
      await app.Virtual.save(fresh.props.characterInfo.characterID, fresh.raw.name, Core.snapshot(fresh.raw));
      if (mounted?.host === host) {
        setMenu(false);
        message("已存为虚拟配装");
      }
    }));
    const menuImportSolo = button("导入配装", showImportSolo);
    const simulatorExportButton = button("导出到模拟器", () => {
      if (busy || failure) return;
      const fresh = currentContext();
      if (fresh.raw.actionTypeHrid !== "/action_types/combat") return;
      setTab("scenes"); setMenu(false); confirmation = null;
      form.hidden = true;
      closeImportForm();
      if (usageBox) usageBox.hidden = true;
      simulatorSourceChips.replaceChildren();
      const sources = [{ id: "current", name: `当前 · ${fresh.raw.name}` },
        ...activeRows().map(row => ({ id: row.id, name: row.name }))];
      selectedSimSource = sources.some(row => row.id === selectedId) ? selectedId : "current";
      for (const row of sources) {
        const chip = button(row.name, () => {
          selectedSimSource = row.id;
          for (const btn of simulatorSourceChips.querySelectorAll("button")) {
            btn.setAttribute("aria-pressed", String(btn.dataset.sourceId === selectedSimSource));
          }
          clearSimulatorExport();
        }, { class: "sim-chip", "data-source-id": row.id, "aria-pressed": String(row.id === selectedSimSource) });
        simulatorSourceChips.append(chip);
      }
      clearSimulatorExport(); simulatorExportForm.hidden = false;
      render(); simulatorTarget.querySelector("button")?.focus();
    });
    const exportButton = button("导出全部", download);
    const file = el("input", null, { type: "file", accept: ".json,application/json", "aria-label": "选择子方案备份", hidden: "" });
    let backupOverwrite = null;
    const backupNote = el("p", "", { class: "muted", role: "status", hidden: "" });
    function resetBackupOverwrite() {
      backupOverwrite = null;
      importButton.textContent = "导入备份";
      backupNote.hidden = true;
    }
    async function importBackupText(fresh, text, expected = []) {
      const ui = mounted;
      let count;
      try { count = await Store.importBackup(fresh, text, expected); }
      catch (error) {
        if (error.code !== "NAME_EXISTS" || mounted !== ui) throw error;
        backupOverwrite = { scope: fresh.scope, text, rows: error.existing };
        importButton.textContent = "再次点击覆盖";
        backupNote.textContent = "将覆盖：" + error.existing.map(row => `“${row.name}”`).join("、");
        backupNote.hidden = false;
        setMenu(true);
        return;
      }
      notify(fresh);
      if (mounted !== ui) return;
      resetBackupOverwrite();
      setMenu(false);
      await reload();
      if (mounted === ui) message(`已导入 ${count} 项`);
    }
    const importButton = button("导入备份", () => {
      if (!backupOverwrite) { file.click(); return; }
      const pending = backupOverwrite;
      run(async () => {
        const fresh = currentContext();
        if (pending.scope !== fresh.scope) { resetBackupOverwrite(); throw Error("当前配装已变化，请重新选择备份。"); }
        await importBackupText(fresh, pending.text, pending.rows);
      });
    }, { style: "min-width:9em" });
    file.addEventListener("change", () => run(async () => {
      const input = file.files?.[0];
      if (!input) return;
      resetBackupOverwrite();
      file.value = "";
      if (input.size > 5000000) throw Error("备份超过 5 MB，未导入。");
      const fresh = currentContext(), text = await input.text();
      if (currentContext().scope !== fresh.scope) throw Error("当前父配装已变化，未导入备份，请在原配装下重试。");
      await importBackupText(fresh, text);
    }));
    menuLoadoutRow.append(virtualButton, menuImportSolo, simulatorExportButton, exportButton, importButton);

    let usageBox = null, usageToggle = null;
    if (root.__layuUsage_mwi_loadout) {
      usageToggle = button("统计设置", () => {
        setMenu(false);
        setTab("scenes");
        usageBox.hidden = !usageBox.hidden;
      });
      menuLoadoutRow.append(usageToggle);
      usageBox = el("div", null, { class: "editor usage-box", hidden: "" });
      const usageHead = el("div", null, { class: "editor-head" });
      const closeUsage = button(null, () => { usageBox.hidden = true; manage.focus(); }, {
        class: "icon-btn", "aria-label": "关闭统计设置", title: "关闭"
      });
      closeUsage.append(svgIcon("close"));
      usageHead.append(el("span", "安装与活跃统计", { class: "editor-title" }), closeUsage);
      usageBox.append(usageHead, el("slot", null, { name: "usage-settings" }));
      // Keep the shared client's settings host in light DOM so its observer can find it.
      host.append(el("div", null, { slot: "usage-settings", "data-layu-usage-settings": "mwi_loadout", lang: "zh-CN" }));
    }
    menu.append(menuContextGroup, menuLoadoutRow, backupNote, file);

    // Tab 1: Scenes workspace
    const paneScenes = el("div", null, { class: "pane", role: "tabpanel" });
    const choices = el("div", null, { class: "choices", "aria-label": "已保存的子方案" });
    const add = button(null, showNew, { class: "add-btn", "aria-label": "新建子方案", title: "保存当前原生配装为新子方案" });
    add.append(svgIcon("add"), el("span", "新建", { class: "add-label" }));
    bindMenu(add, null);
    const importSoloButton = button("导入", showImportSolo, {
      class: "import-btn", title: "导入单人或编号角色战斗配装为子方案"
    });
    choices.append(add, importSoloButton);

    // Contextual Active Scene Bar (object-proximal controls for the selected scene)
    const activeScene = el("div", null, { class: "active-scene", hidden: "" });
    const activeHead = el("div", null, { class: "active-head" });
    const diffToggle = button(null, () => {
      if (mounted.list.childElementCount) setDiffOpen(!diffOpen);
    }, { class: "diff-toggle", "aria-expanded": "false", "aria-controls": "scene-differences" });
    const activeDot = el("span", null, { class: "active-dot", "aria-hidden": "true" });
    const activeName = el("span", "", { class: "active-name" });
    const activeSep = el("span", "·", { class: "active-sep", "aria-hidden": "true" });
    const summary = el("span", "", { id: "summary", role: "status", "aria-live": "polite" });
    const diffCaret = el("span", null, { class: "diff-caret", "aria-hidden": "true" });
    diffCaret.append(svgIcon("caret"));
    diffToggle.append(activeDot, activeName, activeSep, summary, diffCaret);

    const stopDirect = button(null, stopComparison, {
      class: "icon-btn", "aria-label": "结束对比", title: "结束对比"
    });
    stopDirect.append(svgIcon("close"));
    activeHead.append(diffToggle, stopDirect);

    const activeActions = el("div", null, { class: "active-actions" });
    const activeLeft = el("div", null, { class: "active-actions-left" });
    const renameDirect = button("改名", () => requestAction("rename", selected()), { class: "compact-btn ghost-btn" });
    const removeDirect = button("移除", () => {
      const current = selected();
      if (confirmation?.action === "remove" && confirmation.source === "direct" && confirmation.row.id === current?.id) commitAction();
      else requestAction("remove", current, "direct");
    }, { class: "compact-btn ghost-btn danger-hover remove-button" });
    const cancelRemove = button("取消", closeEditor, { class: "compact-btn ghost-btn", hidden: "" });
    activeLeft.append(renameDirect, removeDirect, cancelRemove);

    const activeRight = el("div", null, { class: "active-actions-right" });
    const cancelUpdate = button("取消", closeEditor, { class: "compact-btn", hidden: "" });
    const update = button("更新", () => confirmation?.action === "snapshot" ? commitAction() : requestAction("snapshot", selected()), {
      class: "compact-btn update-button"
    });
    activeRight.append(cancelUpdate, update);
    activeActions.append(activeLeft, activeRight);

    const differences = el("div", null, { id: "scene-differences", class: "diff-panel", hidden: "" });
    const list = el("ol", null, { "aria-label": "需要手动修改的项目" });
    differences.append(list);
    activeScene.append(activeHead, activeActions, differences);

    // Inline New Scene Form
    const form = el("form", null, { class: "editor", hidden: "" });
    const name = el("input", null, {
      id: "scene-name", maxlength: "60", autocomplete: "off",
      "aria-label": "新子方案名称", placeholder: "名称（保存当前原生配装）"
    });
    const save = el("button", "保存", { type: "submit", class: "compact-btn primary", style: "min-width:8em" });
    const overwriteNote = el("p", "", { class: "muted", role: "status", hidden: "" });
    name.addEventListener("input", () => { mounted.overwrite = null; overwriteNote.hidden = true; render(); });
    const cancelNew = button("取消", () => { form.hidden = true; mounted.add.focus(); }, { class: "compact-btn ghost-btn" });
    const formRow = el("div", null, { class: "inline-form-row" });
    formRow.append(name, cancelNew, save);
    form.addEventListener("submit", event => { event.preventDefault(); saveNew(); });
    form.append(formRow, overwriteNote);

    // Single-player and numbered-party import; only the chosen player is saved.
    const importForm = el("form", null, { class: "editor", hidden: "", "aria-label": "导入配装为子方案" });
    const importName = el("input", null, {
      id: "scene-import-name", maxlength: "60", autocomplete: "off", placeholder: "输入子方案名称（含预设名时自动填入）"
    });
    const importText = el("textarea", null, {
      id: "scene-import-text", rows: "5", maxlength: "5000000", required: "",
      spellcheck: "false", placeholder: "粘贴配装 JSON，或选择文件"
    });
    const importChoiceRow = el("div", null, { class: "import-choice-row", hidden: "" });
    const importChoiceLabel = el("label", "导入角色", { for: "scene-import-choice", class: "muted" });
    const importChoice = el("select", null, { id: "scene-import-choice" });
    importChoiceRow.append(importChoiceLabel, importChoice);
    const importMatchRow = el("div", null, { class: "import-match-row", hidden: "" });
    const importMatch = el("p", "", { class: "muted", role: "status" });
    const changeImportMatch = button("更换", () => {
      importChoiceRow.hidden = false;
      importChoice.required = true;
      importMatchRow.hidden = true;
      importChoice.focus();
    }, { class: "compact-btn ghost-btn", hidden: "" });
    importMatchRow.append(importMatch, changeImportMatch);
    let parsedImportText = null, parsedImportOwner = null, parsedImportChoices = [], autoFilledImportName = "", importFileFallbackName = "";
    let importOverwrite = null;
    function resetImportOverwrite() {
      importOverwrite = null;
      saveImport.textContent = "保存为子方案";
      importOverwriteNote.hidden = true;
    }
    function resetImportChoices() {
      resetImportOverwrite();
      parsedImportText = parsedImportOwner = null;
      parsedImportChoices = [];
      importChoice.replaceChildren();
      importChoice.required = false;
      importChoiceRow.hidden = true;
      importMatchRow.hidden = true;
      changeImportMatch.hidden = true;
    }
    function resolveSuggestedImportName() {
      if (!parsedImportChoices.length) return "";
      const picked = importChoice.value
        ? parsedImportChoices.find(choice => choice.key === importChoice.value)
        : (parsedImportChoices.length === 1 ? parsedImportChoices[0] : null);
      if (picked) return picked.suggestedName || "";
      const names = [...new Set(parsedImportChoices.map(choice => choice.suggestedName || ""))];
      return names.length === 1 ? names[0] : "";
    }
    function resolveEffectiveImportName() {
      return resolveSuggestedImportName() || importFileFallbackName;
    }
    function applySuggestedImportName(nextName) {
      const normalized = typeof nextName === "string" ? nextName.trim().slice(0, 60) : "";
      if (normalized) {
        if (!importName.value.trim() || importName.value === autoFilledImportName) {
          importName.value = normalized;
          autoFilledImportName = normalized;
        }
      } else if (autoFilledImportName && importName.value === autoFilledImportName) {
        importName.value = "";
        autoFilledImportName = "";
      }
    }
    function closeImportSession() {
      if (autoFilledImportName && importName.value === autoFilledImportName) importName.value = "";
      autoFilledImportName = "";
      importFileFallbackName = "";
      resetImportChoices();
    }
    function refreshImportChoices() {
      const fresh = currentContext(), nickname = Adapter.currentCharacterName(fresh);
      const owner = JSON.stringify([fresh.scope, nickname]);
      if (parsedImportText === importText.value && parsedImportOwner === owner) return;
      resetImportChoices();
      let parsedJson = null;
      try { parsedJson = JSON.parse(importText.value); } catch (_) { /* Validated by Core.importChoices. */ }
      if (parsedJson?.format === "mwi-layu-loadout-scenes")
        throw Error("这是子方案备份，请在右上角「⋯ → 导入备份」中导入。");
      if (parsedJson?.format === "mwi-virtual-loadout" || parsedJson?.format === "mwi-virtual-loadouts-backup")
        throw Error("这是虚拟配装分享/备份，请在底部「虚拟配装 → 导入分享」中导入。");
      const choices = Core.importChoices(importText.value);
      parsedImportChoices = choices;
      importChoice.append(el("option", "选择要导入的角色", { value: "" }));
      for (const choice of choices) importChoice.append(el("option", choice.label, { value: choice.key }));
      if (choices.length === 1) importChoice.value = choices[0].key;
      else {
        const matched = Core.matchImportNickname(choices, nickname);
        importMatchRow.hidden = false;
        if (matched) {
          importChoice.value = matched;
          importMatch.textContent = `已匹配角色：${nickname}`;
          importMatch.className = "muted";
          changeImportMatch.hidden = false;
        } else {
          importChoiceRow.hidden = false;
          importChoice.required = true;
          importMatch.textContent = "未找到唯一同名角色，请手动选择";
          importMatch.className = "sim-warn";
          changeImportMatch.hidden = true;
        }
      }
      parsedImportText = importText.value;
      parsedImportOwner = owner;
      applySuggestedImportName(resolveEffectiveImportName());
    }
    function tryRefreshImportChoices() {
      const trimmed = importText.value.trim();
      if (!trimmed) {
        resetImportChoices();
        applySuggestedImportName("");
        return;
      }
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        resetImportChoices();
        return;
      }
      try {
        refreshImportChoices();
        if (mounted?.status.classList.contains("error")) message("");
      } catch (_) {
        resetImportChoices();
      }
    }
    function openImportSession() {
      resetImportOverwrite();
      autoFilledImportName = "";
      importFileFallbackName = "";
      tryRefreshImportChoices();
    }
    importText.addEventListener("input", () => {
      resetImportOverwrite();
      importFileFallbackName = "";
      tryRefreshImportChoices();
    });
    importText.addEventListener("change", () => {
      if (!importText.value.trim()) {
        importFileFallbackName = "";
        resetImportChoices();
        applySuggestedImportName("");
        return;
      }
      try { refreshImportChoices(); message(""); } catch (error) { message(error.message, true); }
    });
    importName.addEventListener("input", resetImportOverwrite);
    importChoice.addEventListener("change", () => { resetImportOverwrite(); applySuggestedImportName(resolveEffectiveImportName()); });
    const soloFile = el("input", null, {
      type: "file", accept: ".json,.txt,application/json,text/plain", hidden: "", "aria-label": "选择模拟器配装文件"
    });
    const chooseSoloFile = button("选择文件", () => soloFile.click(), { class: "compact-btn ghost-btn" });
    const cancelImport = button("取消", () => { closeImportForm(); importSoloButton.focus(); }, { class: "compact-btn ghost-btn" });
    const closeImport = button(null, () => { closeImportForm(); importSoloButton.focus(); }, {
      class: "icon-btn", "aria-label": "关闭导入", title: "关闭"
    });
    closeImport.append(svgIcon("close"));
    const importHead = el("div", null, { class: "editor-head" });
    importHead.append(el("span", "导入战斗配装", { class: "editor-title" }), closeImport);
    const saveImport = el("button", "保存为子方案", { type: "submit", class: "compact-btn primary", style: "min-width:9em" });
    const importOverwriteNote = el("p", "", { class: "muted", role: "status", hidden: "" });
    const importActions = el("div", null, { class: "actions split-actions" });
    const importRight = el("div", null, { class: "actions" });
    importRight.append(cancelImport, saveImport);
    importActions.append(chooseSoloFile, importRight);
    importForm.append(
      importHead,
      el("label", "子方案名称", { for: "scene-import-name", class: "sr-only" }), importName,
      el("label", "配装内容", { for: "scene-import-text", class: "sr-only" }), importText,
      importMatchRow, importChoiceRow,
      importActions, importOverwriteNote, soloFile
    );
    soloFile.addEventListener("change", () => run(async () => {
      const input = soloFile.files?.[0];
      if (!input) return;
      const ui = mounted;
      try {
        if (input.size > 5000000) throw Error("配装文件超过 5 MB，请选择较小的文件。");
        const text = await input.text();
        if (mounted !== ui) return;
        importFileFallbackName = input.name.replace(/\.(json|txt)$/i, "").trim().slice(0, 60);
        importText.value = text;
        parsedImportText = null;
        try {
          refreshImportChoices();
        } catch (error) {
          importFileFallbackName = "";
          throw error;
        }
        message("文件已读取，确认名称后保存。");
      } finally { soloFile.value = ""; }
    }));
    importForm.addEventListener("submit", async event => {
      event.preventDefault();
      let shouldFocusName = false;
      const ui = mounted;
      const success = await run(async () => {
        const fresh = currentContext();
        refreshImportChoices();
        const fallbackName = resolveEffectiveImportName();
        const rawTitle = importName.value.trim() ? importName.value : fallbackName;
        if (!rawTitle) shouldFocusName = true;
        const title = Core.name(rawTitle);
        if (!importName.value.trim() && fallbackName) {
          importName.value = title;
          autoFilledImportName = title;
        }
        const raw = Core.importSolo(importText.value, fresh.raw, fresh.props.characterInfo.characterID, importChoice.value);
        const key = Core.stable([fresh.scope, title, raw]);
        let row;
        try { row = await Store.create({ ...fresh, raw }, title, importOverwrite?.key === key ? importOverwrite.row : null); }
        catch (error) {
          if (error.code !== "NAME_EXISTS" || mounted !== ui) throw error;
          importOverwrite = { key, row: error.existing };
          saveImport.textContent = "再次点击覆盖";
          importOverwriteNote.textContent = `再次点击将用导入内容覆盖“${title}”。`;
          importOverwriteNote.hidden = false;
          return;
        }
        notify(fresh);
        if (mounted !== ui) return;
        selectedId = row.id;
        diffOpen = false;
        importText.value = "";
        importName.value = "";
        closeImportForm();
        await reload();
        if (mounted === ui) message("");
      });
      if (mounted !== ui) return;
      if (success && importForm.hidden) importSoloButton.focus();
      else if (shouldFocusName && !importForm.hidden) importName.focus();
    });

    const simulatorExportForm = el("form", null, { class: "editor sim-export", hidden: "", "aria-label": "导出到模拟器" });
    const simulatorHead = el("div", null, { class: "editor-head" });
    const simulatorCancel = button(null, () => { simulatorExportForm.hidden = true; mounted.manage.focus(); }, {
      class: "icon-btn", "aria-label": "关闭导出", title: "关闭"
    });
    simulatorCancel.append(svgIcon("close"));
    simulatorHead.append(el("span", "导出到模拟器", { class: "editor-title" }), simulatorCancel);

    let selectedSimSource = "current";
    const simulatorSource = el("fieldset", null, { class: "simulator-source" });
    const simulatorSourceChips = el("div", null, { class: "sim-source-chips" });
    simulatorSource.append(el("legend", "导出内容"), simulatorSourceChips);

    const simulatorTarget = el("fieldset", null, { class: "simulator-targets" });
    const simulatorTargetGrid = el("div", null, { class: "sim-target-grid" });
    simulatorTarget.append(el("legend", "选择模拟器格式"), simulatorTargetGrid);
    const simulatorTargetButtons = [];
    for (const [value, label, domain] of [
      ["shykai", "Shykai", "shykai.github.io"],
      ["mwisim", "MWISIM", "mwisim.org"],
      ["vue", "MWI Combat Sim", "mwi-combatsi-mulator.pages.dev"]
    ]) {
      const target = button(null, () => run(() => generateSimulatorExport(value)), {
        class: "simulator-export-target", "data-sim-target": value, "aria-pressed": "false"
      });
      target.append(el("span", label), el("small", domain));
      simulatorTargetGrid.append(target);
      simulatorTargetButtons.push(target);
    }

    const simulatorOutput = el("textarea", null, { rows: "4", readonly: "", "aria-label": "模拟器导出内容" });
    simulatorOutput.addEventListener("focus", () => simulatorOutput.select());
    const simulatorRoute = el("p", "", { class: "sim-route", role: "status" });
    const simulatorWarn = el("p", "", { class: "sim-warn", hidden: "" });
    const simulatorResult = el("div", null, { class: "sim-result", hidden: "" });
    let generatedSimulator = null;
    function clearSimulatorExport() {
      generatedSimulator = null;
      simulatorOutput.value = "";
      simulatorResult.hidden = true;
      for (const btn of simulatorTargetButtons) btn.setAttribute("aria-pressed", "false");
    }
    let simCopyTimer = null;
    const simulatorCopy = button("复制内容", () => run(async () => {
      if (!generatedSimulator) return;
      try {
        await navigator.clipboard.writeText(generatedSimulator.text);
        clearTimeout(simCopyTimer);
        simulatorCopy.textContent = "已复制";
        simulatorCopy.classList.add("is-copied");
        simCopyTimer = setTimeout(() => {
          simulatorCopy.textContent = "复制内容";
          simulatorCopy.classList.remove("is-copied");
        }, 1800);
      } catch (_) { simulatorOutput.focus(); simulatorOutput.select(); message("无法访问剪贴板，请手动复制已选中的内容。", true); }
    }), { class: "compact-btn primary copy-btn" });
    const simulatorDownload = button("下载 JSON", () => {
      if (!generatedSimulator) return;
      const url = URL.createObjectURL(new Blob([generatedSimulator.text], { type: "application/json" }));
      el("a", "", { href: url, download: `配装-${generatedSimulator.target}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { class: "compact-btn ghost-btn" });
    const simulatorOutputActions = el("div", null, { class: "actions" });
    simulatorOutputActions.append(simulatorDownload, simulatorCopy);
    simulatorResult.append(simulatorRoute, simulatorWarn, simulatorOutput, simulatorOutputActions);
    simulatorExportForm.append(simulatorHead, simulatorSource, simulatorTarget, simulatorResult);
    simulatorExportForm.addEventListener("submit", event => event.preventDefault());
    async function generateSimulatorExport(target) {
      clearSimulatorExport();
      const sourceId = selectedSimSource;
      const fresh = currentContext(), row = activeRows().find(row => row.id === sourceId);
      if (sourceId !== "current" && !row) throw Error("子方案已变化，请重新选择导出内容。");
      const raw = row ? Core.validateSnapshot(row.snapshot).raw : fresh.raw;
      if (raw.id !== fresh.raw.id) throw Error("子方案不属于当前配装。");
      const result = Core.exportSimulator(raw, row?.name || raw.name, target, fresh.props);
      generatedSimulator = { ...result, target };
      simulatorOutput.value = result.text;
      const route = {
        shykai: "在 Shykai 的 Solo 导入框粘贴。",
        mwisim: "在 MWISIM「数据与基准 → 导入整队方案」选择下载的文件。",
        vue: "在 MWI Combat Simulator「导入/导出 → 单人」中导入到所选玩家。"
      }[target];
      simulatorRoute.textContent = route;
      simulatorWarn.textContent = result.warnings.length ? result.warnings.join("；") + "。" : "";
      simulatorWarn.hidden = !simulatorWarn.textContent;
      for (const btn of simulatorTargetButtons) btn.setAttribute("aria-pressed", String(btn.dataset.simTarget === target));
      simulatorResult.hidden = false;
    }

    // Inline Rename / Remove Confirmation
    const confirm = el("div", null, { class: "editor", hidden: "" }), confirmText = el("p", "", { class: "editor-title" });
    const rename = el("input", null, { maxlength: "60", "aria-label": "修改子方案名称" });
    rename.addEventListener("keydown", event => {
      if (event.key === "Enter" && confirmation?.action === "rename") { event.preventDefault(); commitAction(); }
    });
    const confirmRow = el("div", null, { class: "actions" });
    const commit = button("", commitAction, { class: "compact-btn primary" });
    const cancel = button("取消", closeEditor, { class: "compact-btn ghost-btn" });
    confirmRow.append(cancel, commit);
    confirm.append(confirmText, rename, confirmRow);

    // Notice / Undo / Error Bar
    const notice = el("div", null, { class: "notice", hidden: "" });
    const status = el("p", "", { id: "status", role: "status", "aria-live": "polite" });
    const undoButton = button("撤销", restore, { hidden: "", class: "compact-btn", "aria-label": "撤销移除" });
    const retry = button("重试", () => { tick(); reload(); }, { hidden: "", class: "compact-btn" });
    notice.append(status, undoButton, retry);

    paneScenes.append(choices, form, importForm, simulatorExportForm, confirm, activeScene);
    if (usageBox) paneScenes.append(usageBox);

    // Tab 2: Cloud Sync workspace
    const paneCloud = el("div", null, { class: "pane", role: "tabpanel", hidden: "" });
    const cloud = app.CloudUI.mount(ctx, el, button, (main, copy, choice) => run(async () => {
      const fresh = currentContext(), ui = mounted;
      if (fresh.scope !== ctx.scope) throw Error("请在原配装下比较版本。");
      await Store.resolveConflict(fresh, main, copy, choice);
      notify(fresh);
      if (mounted !== ui) return;
      await reload();
      if (mounted === ui) message("版本选择已存本机。");
    }), info => {
      tabCloudDot.hidden = !info.warning;
      tabCloudDot.dataset.state = info.warning ? "warn" : "";
      tabCloud.classList.toggle("has-warning", info.warning);
    });
    paneCloud.append(cloud.node);

    app.Cloud.setActive(ctx.props.characterInfo.characterID, ctx.raw.id);
    section.append(header, menu, paneScenes, paneCloud, notice);
    shadow.append(section);
    if (ctx.sceneMount) ctx.sceneMount.append(host);
    else ctx.details.insertBefore(host, ctx.setup);

    shadow.addEventListener("keydown", event => {
      if (event.key !== "Escape" || busy) return;
      if (!menu.hidden) {
        event.stopPropagation();
        setMenu(false);
        manage.focus();
        return;
      }
      const hasSubPanel = Boolean(confirmation || !form.hidden || !importForm.hidden || !simulatorExportForm.hidden || (usageBox && !usageBox.hidden));
      if (hasSubPanel) {
        event.stopPropagation();
        closeEditor();
        return;
      }
      if (ctx.overview && typeof ctx.closeOverviewScenes === "function") {
        event.stopPropagation();
        ctx.closeOverviewScenes();
      }
    });
    shadow.addEventListener("pointerdown", event => {
      if (menu.hidden) return;
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !manage.contains(target)) setMenu(false);
    });
    shadow.addEventListener("focusout", event => {
      if (!host.matches(":focus-within") && !shadow.contains(event.relatedTarget)) setMenu(false);
    });

    mounted = {
      cloud, host, shadow, header, tabScenes, tabCloud, tabCloudDot, paneScenes, paneCloud,
      choices, add, menu, menuContextGroup, menuTargetLabel, menuImportSolo,
      form, name, save, cancelNew, overwriteNote, resetBackupOverwrite,
      activeScene, diffToggle, activeDot, activeName, activeSep, summary, diffCaret, stopDirect,
      activeActions, renameDirect, removeDirect, cancelRemove, update, cancelUpdate,
      renameButton, remove, stop, undoButton, manage,
      importSoloButton, importForm, importName, importText, importChoice, changeImportMatch, chooseSoloFile, cancelImport, saveImport,
      openImportSession, closeImportSession,
      simulatorExportButton, simulatorExportForm, simulatorSource, simulatorTarget, simulatorCancel, simulatorCopy, simulatorDownload,
      confirm, confirmText, rename, commit, cancel,
      notice, status, retry, differences, list, exportButton, importButton, usageBox
    };
    context = ctx;
    rows = [];
    selectedId = null;
    undo = null;
    confirmation = null;
    diffOpen = false;
    setTab(ctx.overviewTab === "cloud" ? "cloud" : "scenes", false);
    cloud.update(rows);
    render();
    const emptyEl = choices.querySelector(".empty");
    if (emptyEl) emptyEl.textContent = "读取中…";
    reload();
  }

  function syncTargets(changes) {
    const targets = new Set(), slotTargets = new Set(), groups = new Map();
    unresolved = [];
    for (const [index, change] of changes.entries()) {
      const destination = Adapter.target(context, change);
      if (!destination) { unresolved.push(change); continue; }
      targets.add(destination);
      let slot = Adapter.target(context, { ...change, kind: change.kind.replace(/_trigger$/, "") });
      if (change.kind === "setting") slot = slot?.closest('[class*="LoadoutsPanel_metadata__"]') || slot;
      if (slot?.matches("label")) slot = slot.parentElement;
      if (!slot) continue;
      if (change.kind !== "setting") slotTargets.add(slot);
      const entries = groups.get(slot) || [];
      entries.push({ change, index });
      groups.set(slot, entries);
    }
    for (const old of highlighted) if (!targets.has(old)) {
      old.removeAttribute("data-mwi-scene-change");
      old.removeAttribute("data-mwi-scene-pulse");
    }
    for (const node of targets) node.setAttribute("data-mwi-scene-change", "");
    highlighted = [...targets];
    for (const old of highlightedSlots) if (!slotTargets.has(old)) old.removeAttribute("data-mwi-scene-slot-change");
    for (const node of slotTargets) node.setAttribute("data-mwi-scene-slot-change", "");
    highlightedSlots = [...slotTargets];
    const nextSetup = slotTargets.size ? context.setup : null;
    if (comparingSetup && comparingSetup !== nextSetup) comparingSetup.removeAttribute("data-mwi-scene-comparing");
    if (nextSetup) nextSetup.setAttribute("data-mwi-scene-comparing", "");
    comparingSetup = nextSetup;
    for (const [slot, marker] of markers) if (!groups.has(slot) || !marker.host.isConnected) { marker.host.remove(); markers.delete(slot); }
    for (const [slot, entries] of groups) {
      let marker = markers.get(slot);
      const key = Core.stable(entries.map(({ change, index }) => [index, change.label, Adapter.describe(context, change, change.to)]));
      if (!marker) {
        const host = el("span", null, { "data-mwi-scene-marker": "" }), shadow = host.attachShadow({ mode: "open" });
        const content = el("div", null, { class: "target-markers" });
        shadow.append(el("style", css), content);
        for (const type of ["click", "dblclick", "pointerdown", "keydown"]) host.addEventListener(type, event => event.stopPropagation());
        slot.append(host);
        marker = { host, content, key: null };
        markers.set(slot, marker);
      }
      if (marker.key === key) continue;
      marker.key = key;
      marker.content.replaceChildren();
      for (const { change, index } of entries) {
        const goal = Adapter.describe(context, change, change.to);
        if (change.kind.endsWith("_trigger")) {
          const node = button(change.to.length ? `条件 ${change.to.length} 项` : "无附加条件", () => {
            setTab("scenes");
            setDiffOpen(true);
            const item = mounted.list.children[index];
            item?.querySelector("details")?.setAttribute("open", "");
            item?.focus({ preventScroll: true });
            item?.scrollIntoView({ block: "center", behavior: "instant" });
          }, { class: "target-condition", "aria-label": `${change.label}：${goal}` });
          marker.content.append(node);
        } else {
          marker.content.append(el("span", `→ ${goal}`, { class: "target-value", "aria-label": `${change.label}目标：${goal}` }));
        }
      }
    }
  }

  function render() {
    if (!mounted || !context) return;
    const ui = mounted, active = activeRows(), row = selected(), combat = isCombat(context);
    const existing = new Map([...ui.choices.querySelectorAll("button[data-scene-id]")].map(node => [node.dataset.sceneId, node]));
    for (const [id, node] of existing) if (!active.some(entry => entry.id === id)) node.remove();
    ui.choices.querySelector("p.empty")?.remove();

    active.forEach((entry, index) => {
      let choice = existing.get(entry.id);
      if (!choice) {
        choice = button(entry.name, () => {
          if (selectedId === entry.id) { stopComparison(); return; }
          selectedId = entry.id;
          confirmation = null;
          setMenu(false);
          ui.form.hidden = true;
          closeImportForm();
          ui.simulatorExportForm.hidden = true;
          diffOpen = false;
          render();
          message(failure, Boolean(failure));
        }, { "data-scene-id": entry.id, class: "choice-chip" });
        bindMenu(choice, entry.id);
      }
      const label = active.some(other => other.id !== entry.id && other.name === entry.name)
        ? entry.name + " · " + entry.id.slice(0, 6) : entry.name;
      if (choice.textContent !== label) choice.textContent = label;
      choice.setAttribute("aria-pressed", String(entry.id === selectedId));
      choice.disabled = busy;
      if (ui.choices.children[index] !== choice) ui.choices.insertBefore(choice, ui.choices.children[index] || ui.add);
    });
    if (!active.length) ui.choices.insertBefore(el("p", "暂无方案", { class: "empty" }), ui.add);
    ui.add.classList.toggle("compact-icon", active.length > 0);
    ui.importSoloButton.hidden = !combat;
    ui.menuImportSolo.hidden = !combat;

    ui.save.disabled = ui.add.disabled = busy || Boolean(failure);
    ui.save.textContent = ui.overwrite ? "再次点击覆盖" : "保存";
    ui.manage.disabled = busy || Boolean(failure);
    for (const node of [ui.importSoloButton, ui.menuImportSolo, ui.importName, ui.importText, ui.importChoice, ui.changeImportMatch, ui.chooseSoloFile, ui.saveImport]) {
      node.disabled = busy || Boolean(failure);
    }
    ui.cancelImport.disabled = busy;
    ui.cancelNew.disabled = busy;

    const updating = confirmation?.action === "snapshot";
    const removingDirect = confirmation?.action === "remove" && confirmation.source === "direct" && confirmation.row.id === row?.id;
    const removingInMenu = confirmation?.action === "remove" && confirmation.source === "menu" && confirmation.row.id === menuId;
    ui.update.textContent = updating ? "更新方案" : "更新";
    ui.update.classList.toggle("primary", updating);
    ui.update.title = updating ? `确认用当前原生配装覆盖“${confirmation.row.name}”` : row ? `用当前原生配装更新“${row.name}”` : "";
    ui.cancelUpdate.hidden = !updating;
    ui.cancelUpdate.disabled = busy;
    ui.update.disabled = busy || !row || Boolean(failure);
    ui.removeDirect.textContent = removingDirect ? "确认移除" : "移除";
    ui.removeDirect.classList.toggle("danger", removingDirect);
    ui.removeDirect.classList.toggle("ghost-btn", !removingDirect);
    ui.removeDirect.classList.toggle("danger-hover", !removingDirect);
    ui.removeDirect.title = removingDirect ? `再次点击确认移除“${confirmation.row.name}”` : row ? `移除“${row.name}”` : "";
    ui.cancelRemove.hidden = !removingDirect;
    ui.cancelRemove.disabled = busy;
    ui.renameDirect.disabled = ui.removeDirect.disabled = busy || !row || Boolean(failure);
    ui.stopDirect.disabled = busy;

    const menuRow = active.find(entry => entry.id === menuId);
    ui.menuContextGroup.hidden = !menuRow;
    if (menuRow) ui.menuTargetLabel.textContent = removingInMenu ? `确认移除：${menuRow.name}` : `方案：${menuRow.name}`;
    ui.remove.textContent = removingInMenu ? "确认移除" : "移除";
    ui.remove.classList.toggle("danger", removingInMenu);
    ui.remove.classList.toggle("danger-text", !removingInMenu);
    ui.remove.title = removingInMenu ? `再次点击确认移除“${menuRow?.name || ""}”` : "";
    for (const node of [ui.renameButton, ui.remove]) node.disabled = busy || !menuRow || Boolean(failure);
    ui.stop.hidden = !row || row.id !== menuId;
    ui.stop.disabled = busy || !row || row.id !== menuId;
    if (!ui.menu.hidden && menuId && !menuRow) setMenu(false);

    ui.exportButton.disabled = busy || !active.length || Boolean(failure);
    ui.simulatorExportButton.hidden = !combat;
    for (const node of [ui.simulatorExportButton, ui.simulatorSource, ui.simulatorTarget, ui.simulatorCopy, ui.simulatorDownload])
      node.disabled = busy || Boolean(failure);
    ui.simulatorCancel.disabled = busy;
    ui.importButton.disabled = busy || Boolean(failure);
    ui.undoButton.hidden = !undo;
    ui.undoButton.disabled = busy || Boolean(failure);
    ui.notice.hidden = !undo && !ui.status.textContent;
    ui.retry.disabled = busy;

    const inlineConfirm = updating || removingDirect || removingInMenu;
    ui.confirm.hidden = !confirmation || inlineConfirm;
    if (confirmation && !inlineConfirm) {
      const pending = confirmation;
      ui.confirmText.textContent = pending.action === "remove" ? `移除“${pending.row.name}”？` : `改名：${pending.row.name}`;
      ui.rename.hidden = pending.action !== "rename";
      if (ui.rename.dataset.id !== pending.row.id) {
        ui.rename.value = pending.row.name;
        ui.rename.dataset.id = pending.row.id;
      }
      ui.commit.textContent = pending.action === "remove" ? "确认移除" : "保存";
      ui.commit.classList.toggle("danger", pending.action === "remove");
      ui.commit.classList.toggle("primary", pending.action !== "remove");
      ui.commit.disabled = busy || Boolean(failure);
      ui.cancel.disabled = busy;
    }

    ui.activeScene.hidden = !row && !failure;
    ui.activeActions.hidden = !row || Boolean(failure);
    ui.stopDirect.hidden = !row;
    ui.list.replaceChildren();

    if (failure) {
      clearHighlights();
      ui.activeName.textContent = row ? row.name : "读取异常";
      ui.activeSep.hidden = false;
      ui.summary.textContent = "无法核对";
      ui.diffToggle.setAttribute("aria-label", `${ui.activeName.textContent}：无法核对`);
      ui.summary.classList.add("pending");
      ui.activeScene.dataset.state = "diff";
      ui.diffCaret.hidden = true;
      setDiffOpen(false);
      return;
    }
    if (!row) {
      clearHighlights();
      ui.summary.textContent = "";
      ui.diffToggle.removeAttribute("aria-label");
      setDiffOpen(false);
      return;
    }

    let changes;
    try { changes = currentDiff(context, row); }
    catch (error) {
      clearHighlights();
      message(error.message, true);
      ui.activeName.textContent = row.name;
      ui.summary.textContent = "无法核对";
      ui.diffToggle.setAttribute("aria-label", `${row.name}：无法核对`);
      ui.activeScene.dataset.state = "diff";
      ui.diffCaret.hidden = true;
      setDiffOpen(false);
      return;
    }

    const missing = changes.filter(change => !Adapter.target(context, change)).length;
    ui.activeName.textContent = row.name;
    ui.activeSep.hidden = false;
    ui.summary.textContent = changes.length ? `${changes.length} 项差异${missing ? ` · ${missing} 项未定位` : ""}` : "配装已一致";
    ui.diffToggle.setAttribute("aria-label", changes.length ? `差异清单：${row.name}，${ui.summary.textContent}` : `${row.name}：配装已一致`);
    ui.summary.classList.toggle("pending", Boolean(changes.length));
    ui.activeScene.dataset.state = changes.length ? "diff" : "match";
    ui.diffCaret.hidden = !changes.length;
    ui.diffToggle.disabled = !changes.length;

    for (const change of changes) {
      const li = el("li", null, { tabindex: "-1" }), title = el("div", null, { class: "change-title" });
      title.append(el("strong", change.label));
      const destination = Adapter.target(context, change);
      if (destination) title.append(button("定位", () => {
        destination.scrollIntoView({ block: "center", behavior: "instant" });
        destination.removeAttribute("data-mwi-scene-pulse");
        void destination.offsetWidth;
        destination.setAttribute("data-mwi-scene-pulse", "");
      }, { "aria-label": `定位${change.label}` }));
      else title.append(el("span", "未定位", { class: "unlocated-tag" }));
      const values = el("div", null, { class: "values" });
      const fromText = Adapter.describe(context, change, change.from);
      const toText = Adapter.describe(context, change, change.to);
      values.append(
        el("div", fromText, { class: "current", "aria-label": `当前：${fromText}` }),
        el("span", "→", { class: "arrow", "aria-hidden": "true" }),
        el("div", toText, { class: "goal", "aria-label": `目标：${toText}` })
      );
      li.append(title, values);
      if (change.kind.endsWith("_trigger")) {
        const details = el("details", null);
        details.append(el("summary", "完整数据"), el("pre", JSON.stringify({ current: change.from, target: change.to }, null, 2)));
        li.append(details);
      }
      ui.list.append(li);
    }

    if (!changes.length) setDiffOpen(false);
    else if (missing) setDiffOpen(true);
    else setDiffOpen(diffOpen);
    syncTargets(changes);
    syncPicker();
  }

  function tick() {
    if (document.hidden) return;
    app.Overview.sync();
    try {
      const ctx = Adapter.current();
      if (!ctx) { if (mounted) detach(); return; }
      const recovered = Boolean(failure);
      failure = "";
      document.querySelector("#mwi-loadout-scenes-unavailable")?.remove();
      if (!mounted || context.scope !== ctx.scope || context.details !== ctx.details || !mounted.host.isConnected) {
        detach();
        mount(ctx);
        last = Core.stable(ctx.raw);
        return;
      }
      const fingerprint = Core.stable(ctx.raw);
      context = ctx;
      if (ctx.overviewTab && ctx.overviewTab !== activeTab) setTab(ctx.overviewTab, false);
      if (last !== fingerprint || recovered || highlighted.some(node => !node.isConnected || !node.hasAttribute("data-mwi-scene-change")) ||
          highlightedSlots.some(node => !node.isConnected) ||
          [...markers.values()].some(marker => !marker.host.isConnected) || unresolved.some(change => Adapter.target(ctx, change))) {
        if (last !== fingerprint) app.Cloud?.observeNative?.(ctx.props.characterInfo.characterID, ctx.raw.id, ctx.raw);
        mounted.cloud.update(rows, ctx);
        last = fingerprint;
        cachedDiffKey = "";
        render();
        if (recovered) message("");
      }
      syncPicker();
    } catch (error) {
      if (mounted) {
        failure = error.message;
        clearHighlights();
        render();
        message(error.message, true);
      } else {
        const details = [...document.querySelectorAll('[class*="LoadoutsPanel_details__"]')].filter(node => node.getClientRects().length);
        if (details.length === 1 && !document.querySelector("#mwi-loadout-scenes-unavailable")) {
          const notice = el("p", `子方案：${error.message}`, { id: "mwi-loadout-scenes-unavailable", role: "status" });
          details[0].prepend(notice);
        }
      }
    }
  }

  function start() {
    app.Cloud.start(scope => {
      channel?.postMessage({ scope });
      if (context?.scope === scope) reload();
    }, (character, id) => {
      if (mounted && context?.props.characterInfo.characterID === character && context.raw.id === id) {
        mounted.cloud.update(rows, context);
      }
    });
    app.ActionMemory.start();
    app.Overview.start();
    const style = el("style", [
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_playerModel__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not(.mwi-overview-tools),',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_abilities__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not([class*="LoadoutsPanel_label__"]),',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_consumables__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not([class*="LoadoutsPanel_label__"]) { opacity: 0.42; transition: opacity .15s ease; }',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_playerModel__"] > :hover,',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_abilities__"] > :hover,',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_consumables__"] > :hover { opacity: 1; }',
      '[data-mwi-scene-slot-change]:not([data-mwi-scene-change]) { position: relative; z-index: 1; outline: 1.5px dashed rgba(255, 190, 79, 0.82) !important; outline-offset: 0 !important; border-radius: 6px !important; background: rgba(255, 190, 79, 0.08) !important; }',
      '[data-mwi-scene-change] { position: relative; z-index: 2; outline: 2px solid #ffbe4f !important; outline-offset: 0 !important; border-radius: 6px !important; background: rgba(255, 190, 79, 0.16) !important; box-shadow: 0 0 0 1px rgba(255, 190, 79, 0.48), 0 0 12px rgba(255, 190, 79, 0.36), inset 0 0 10px rgba(255, 190, 79, 0.15) !important; }',
      '[data-mwi-scene-change] [class*="Item_itemContainer__"], [data-mwi-scene-change] [class*="Ability_ability__"] { box-shadow: inset 0 0 0 2px rgba(255, 210, 122, 0.88) !important; }',
      '[data-mwi-scene-target] { position: relative; z-index: 2; outline: 3px solid #70b7ff !important; outline-offset: -3px !important; border-radius: 6px !important; background: rgba(112, 183, 255, 0.2) !important; box-shadow: inset 0 0 0 5px #171822, 0 0 0 2px rgba(112, 183, 255, 0.6), 0 0 14px rgba(112, 183, 255, 0.6) !important; }',
      '[class*="CombatTriggersSetting_combatTriggersEditMenu__"] [data-mwi-scene-target] { outline: 2px solid #70b7ff !important; outline-offset: -1px !important; background: rgba(112, 183, 255, 0.22) !important; box-shadow: 0 0 0 1px rgba(112, 183, 255, 0.55), 0 0 10px rgba(112, 183, 255, 0.45) !important; }',
      'li[data-mwi-scene-target], [role="option"][data-mwi-scene-target] { outline: 2px solid #70b7ff !important; outline-offset: -2px !important; background: #1f4fd6 !important; color: #ffffff !important; font-weight: 600 !important; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.24), 0 0 10px rgba(31, 79, 214, 0.45) !important; }',
      'li[data-mwi-scene-target]:hover, [role="option"][data-mwi-scene-target]:hover { background: #2558e8 !important; color: #ffffff !important; }',
      '[data-mwi-scene-prefilled] { position: relative; z-index: 2; outline: 2px solid #6ad89a !important; outline-offset: -1px !important; border-radius: 6px !important; background: rgba(106, 216, 154, 0.14) !important; box-shadow: 0 0 10px rgba(106, 216, 154, 0.34) !important; }',
      '[data-mwi-picker-guide], [data-mwi-trigger-guide] { margin: 0 0 6px; padding: 6px 8px; border-radius: 6px; background: #141826; border: 1px solid rgba(112, 183, 255, 0.38); border-left: 3px solid #70b7ff; color: #eef0f8; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left; }',
      '[data-mwi-picker-guide][data-state="warn"], [data-mwi-trigger-guide][data-state="warn"] { border-color: rgba(242, 196, 109, 0.45); border-left-color: #f2c46d; color: #ffe3a8; }',
      '[data-mwi-trigger-guide][data-state="ready"] { border-color: rgba(106, 216, 154, 0.45); border-left-color: #6ad89a; color: #d8fbe6; }',
      '[data-mwi-picker-guide] .mwi-guide-title, [data-mwi-trigger-guide] .mwi-guide-title { font-weight: 600; }',
      '[data-mwi-trigger-guide] .mwi-guide-list { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li { display: flex; align-items: baseline; gap: 5px; font-size: 11.5px; color: #d4daf0; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li.is-done { color: #9ee6bc; }',
      '[data-mwi-trigger-guide] .mwi-guide-mark { flex: 0 0 auto; font-weight: 700; color: #70b7ff; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li.is-done .mwi-guide-mark { color: #6ad89a; }',
      '[data-mwi-trigger-guide] .mwi-guide-tag { margin-left: auto; padding: 0 5px; border-radius: 4px; background: rgba(106, 216, 154, 0.18); color: #8be6b2; font-size: 10.5px; font-weight: 600; white-space: nowrap; }',
      '@keyframes mwiScenePulse { 0% { box-shadow: 0 0 0 0 rgba(255, 190, 79, 0.88), 0 0 18px rgba(255, 190, 79, 0.72); } 100% { box-shadow: 0 0 0 10px rgba(255, 190, 79, 0), 0 0 12px rgba(255, 190, 79, 0.36); } }',
      '[data-mwi-scene-pulse] { animation: mwiScenePulse .65s ease-out; }',
      '@media (prefers-reduced-motion: reduce) { [data-mwi-scene-pulse] { animation: none !important; } }'
    ].join("\n"));
    style.id = "mwi-loadout-scenes-highlight-style";
    document.head.append(style);
    const panelSelector = '[class*="LoadoutsPanel_loadoutsPanel__"]';
    const ownedSelector = '.mwi-overview-cloud, .mwi-overview-cloud-btn, .mwi-overview-scene-count, [data-mwi-overview-status], #mwi-loadout-scenes-host, #mwi-loadout-scenes-unavailable, [data-mwi-scene-marker], [data-mwi-picker-guide], [data-mwi-trigger-guide]';
    const options = { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "style", "class"] };
    const observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        const target = record.target;
        if (target.nodeType !== 1 || target.closest(ownedSelector)) return false;
        if (record.type === "attributes") return Boolean(target.closest(panelSelector) || target.querySelector(panelSelector));
        const nodes = [...record.addedNodes, ...record.removedNodes].filter(node =>
          node.nodeType !== 1 || !node.matches(ownedSelector));
        return nodes.length && (target.closest(panelSelector) || nodes.some(node => node.nodeType === 1 &&
          (node.matches(panelSelector) || node.querySelector(panelSelector))));
      });
      if (!relevant) { schedulePickerSync(); return; }
      observer.disconnect();
      try { tick(); } finally { observer.observe(document.documentElement, options); }
    });
    tick();
    observer.observe(document.documentElement, options);
    setInterval(tick, 650);
    channel?.addEventListener("message", event => { if (event.data?.scope === context?.scope) reload(); });
    document.addEventListener("input", event => {
      if (event.target?.closest?.('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]')) schedulePickerSync();
    }, true);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); reload(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(globalThis);
