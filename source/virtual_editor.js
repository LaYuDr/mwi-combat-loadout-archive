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
          this.setState({ raw, dirty: true, discard: false, notice: "" });
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
        try {
          const title = Core.name(this.state.title);
          validateDraft(this.state.raw, this.props.catalog);
          const snapshot = portable(Core.snapshot(this.state.raw), title);
          this.cleared = true;
          tooltip.hide();
          await this.props.onSave(title, snapshot, asNew);
        } catch (error) { this.cleared = false; if (this.alive) this.setState({ notice: error.message }); }
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
                  onChange: e => this.setState({ title: e.target.value, dirty: true })
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
                  this.props.scene && btn("另存为新", event => { if (event.currentTarget.form.reportValidity()) this.save(event, true); }, { className: "mwi-overview-button mwi-overview-ghost-btn" }),
                  h("button", { type: "submit", className: "mwi-overview-button mwi-overview-primary", disabled: busy }, "保存虚拟配装"))))));
      }
    };
  };
})(globalThis);
