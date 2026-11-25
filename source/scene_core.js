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
