"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const Core = require("../scene_core.js");
const raw = () => ({ id: 12, name: "远程", actionTypeHrid: "/action_types/combat", useExactEnhancement: true,
  wearableMap: { "/item_locations/two_hand": "71::/item_locations/inventory::/items/bow::12", "/item_locations/back": "" },
  abilityMap: { 1: "/abilities/shot", 2: "/abilities/heal", 3: "", 4: null },
  foodItemHrids: ["/items/yogurt", "", null], drinkItemHrids: ["/items/coffee"],
  abilityCombatTriggersMap: { "/abilities/shot": [{ dependencyHrid: "/combat_trigger_dependencies/self", conditionHrid: "/combat_trigger_conditions/current_hp",
    comparatorHrid: "/combat_trigger_comparators/less_than_equal", value: 0, extension: { enabled: false, empty: {} } }] },
  consumableCombatTriggersMap: { "/items/yogurt": [] }, nativeExtension: { explicitZero: 0, empty: [], emptyMap: {}, missing: null } });
test("snapshot keeps all original fields, zero, empty slots and unknown trigger extensions without sharing mutable references", () => {
  const a = raw(), snapshot = Core.snapshot(a); assert.deepEqual(snapshot.raw, a);
  a.abilityCombatTriggersMap["/abilities/shot"][0].value = 40;
  assert.equal(snapshot.raw.abilityCombatTriggersMap["/abilities/shot"][0].value, 0);
  assert.equal(Object.hasOwn(snapshot.raw, "unrecorded"), false);
});
test("comparison finds skill order, food/drink/empty slots and full trigger changes including explicit zero and unknown extensions", () => {
  const a = raw(), target = Core.snapshot(a), b = structuredClone(a);
  [b.abilityMap[1], b.abilityMap[2]] = [b.abilityMap[2], b.abilityMap[1]];
  b.foodItemHrids[0] = ""; b.drinkItemHrids[0] = "/items/tea";
  const changes = Core.diff(b, target);
  for (const kind of ["ability", "ability_trigger", "food", "drink"]) assert.ok(changes.some(c => c.kind === kind), kind);
  b.abilityMap = structuredClone(a.abilityMap);
  b.abilityCombatTriggersMap["/abilities/shot"][0].extension.enabled = true;
  assert.ok(Core.diff(b, target).some(c => c.kind === "ability_trigger"));
  b.abilityCombatTriggersMap["/abilities/shot"][0].value = 1;
  assert.ok(Core.diff(b, target).find(c => c.kind === "ability_trigger").to[0].value === 0);
});
test("highest enhancement compares item identity; exact enhancement compares level; inventory location does not create a false difference", () => {
  const a = raw(), b = raw();
  b.wearableMap["/item_locations/two_hand"] = "71::/item_locations/two_hand::/items/bow::12";
  assert.deepEqual(Core.diff(b, Core.snapshot(a)), []);
  b.wearableMap["/item_locations/two_hand"] = "71::/item_locations/two_hand::/items/bow::15";
  assert.equal(Core.diff(b, Core.snapshot(a))[0].kind, "equipment");
  a.useExactEnhancement = false; b.useExactEnhancement = false;
  assert.deepEqual(Core.diff(b, Core.snapshot(a)), []);
  b.wearableMap["/item_locations/two_hand"] = "71::/item_locations/two_hand::/items/another_bow::15";
  assert.equal(Core.diff(b, Core.snapshot(a))[0].kind, "equipment");
});
test("native absent trigger entries mean no additional conditions; unknown shape and unsafe payloads are rejected", () => {
  const a = raw(); a.abilityCombatTriggersMap = {}; delete a.consumableCombatTriggersMap;
  assert.deepEqual(Core.diff(a, Core.snapshot(a)), []);
  const broken = raw(); delete broken.abilityMap;
  assert.throws(() => Core.snapshot(broken), /完整读取/);
  const unfinished = raw(); unfinished.abilityCombatTriggersMap["/abilities/shot"][0].dependencyHrid = "";
  assert.throws(() => Core.snapshot(unfinished), /尚未完整/);
  assert.throws(() => Core.copy(JSON.parse('{"__proto__":{"polluted":true}}')), /不安全/);
  assert.throws(() => Core.copy({ value: NaN }), /不可保存/);
  assert.throws(() => Core.name(" "), /名称/);
});

const lifeTypes = ["milking", "foraging", "woodcutting", "cheesesmithing", "crafting", "tailoring", "cooking", "brewing", "alchemy", "enhancing"];
function life(type) {
  const result = raw(); result.actionTypeHrid = type; result.abilityMap = null; delete result.foodItemHrids;
  delete result.abilityCombatTriggersMap; delete result.consumableCombatTriggersMap;
  if (!type) delete result.drinkItemHrids;
  for (const skill of lifeTypes) result.wearableMap[`/item_locations/${skill}_tool`] = `71::/item_locations/inventory::/items/${skill}_tool::8`;
  return result;
}
test("every life type and all-skills preserve raw snapshots and compare all ten tool slots including empty targets", () => {
  for (const type of [...lifeTypes.map(type => `/action_types/${type}`), "", null]) {
    const target = life(type), current = structuredClone(target);
    assert.deepEqual(Core.snapshot(target).raw, target);
    for (const skill of lifeTypes) current.wearableMap[`/item_locations/${skill}_tool`] = "";
    const changes = Core.diff(current, Core.snapshot(target));
    assert.equal(changes.length, 10); assert.ok(changes.every(change => change.kind === "equipment"));
    assert.ok(changes.every(change => change.label.endsWith("工具")));
    assert.ok(Core.diff(target, Core.snapshot(current)).every(change => change.to === null));
    target.useExactEnhancement = false; current.useExactEnhancement = false;
    for (const skill of lifeTypes) current.wearableMap[`/item_locations/${skill}_tool`] = `71::/item_locations/${skill}_tool::/items/${skill}_tool::12`;
    assert.deepEqual(Core.diff(current, Core.snapshot(target)), []);
  }
});
test("comparison follows native editable slots: life drinks, no life combat triggers, all-skills equipment only", () => {
  const target = raw(), current = raw();
  current.abilityMap[1] = "/abilities/heal"; current.foodItemHrids[0] = ""; current.drinkItemHrids[0] = "/items/tea";
  current.consumableCombatTriggersMap["/items/coffee"] = target.abilityCombatTriggersMap["/abilities/shot"];
  current.actionTypeHrid = target.actionTypeHrid = "/action_types/enhancing";
  assert.deepEqual(Core.diff(current, Core.snapshot(target)).map(change => change.kind), ["drink"]);
  current.actionTypeHrid = target.actionTypeHrid = "";
  assert.deepEqual(Core.diff(current, Core.snapshot(target)), []);
  current.actionTypeHrid = target.actionTypeHrid = "/action_types/combat";
  const snapshot = Core.snapshot(current);
  current.wearableMap["/item_locations/enhancing_tool"] = "71::/item_locations/inventory::/items/hammer::8";
  assert.deepEqual(Core.diff(current, snapshot), []);
});
test("active life slots remain required; malformed types and cross-parent/type comparisons are rejected", () => {
  const target = life("/action_types/enhancing"), broken = structuredClone(target);
  delete broken.drinkItemHrids;
  assert.throws(() => Core.snapshot(broken), /完整读取/);
  for (const value of [undefined, false, "all", "/items/milk"]) {
    broken.actionTypeHrid = value; assert.throws(() => Core.snapshot(broken), /完整读取/);
  }
  const all = life(""); all.abilityMap = []; assert.throws(() => Core.snapshot(all), /完整读取/);
  assert.throws(() => Core.diff(raw(), Core.snapshot(target)), /不匹配/);
  assert.throws(() => Core.diff({ ...target, id: 13 }, Core.snapshot(target)), /不匹配/);
  assert.deepEqual(Core.diff(life(null), Core.snapshot(life(""))), []);
});

test("importChoices extracts suggestedName across supported formats without ever treating player nickname as loadout name", () => {
  const player = (name, extra = {}) => ({
    name,
    levels: { stamina: 100, intelligence: 100, attack: 100, melee: 100, defense: 100, ranged: 100, magic: 100 },
    equipment: { weapon: { itemHrid: "/items/bow", enhancementLevel: 10 } },
    abilities: [{ abilityHrid: "/abilities/shot", level: 10 }, null, null, null, null],
    food: ["/items/yogurt", "", ""],
    drinks: ["/items/coffee", "", ""],
    triggerMap: { "/abilities/shot": [] },
    ...extra
  });

  // mwi-vue-solo v2: priority loadoutName > name > title > meta.loadoutName; never player.name
  const soloWithLoadoutName = Core.importChoices(JSON.stringify({
    format: "mwi-vue-solo", version: 2, loadoutName: "  P1 远程·巫师之塔T0  ", name: "fallback",
    player: player("角色甲")
  }));
  assert.equal(soloWithLoadoutName[0].nickname, "角色甲");
  assert.equal(soloWithLoadoutName[0].suggestedName, "P1 远程·巫师之塔T0");

  const soloFallbackOrder = Core.importChoices(JSON.stringify({
    format: "mwi-vue-solo", version: 2, loadoutName: "   ", name: 123, title: "标题回退", meta: { loadoutName: "meta回退" },
    player: player("角色甲")
  }));
  assert.equal(soloFallbackOrder[0].suggestedName, "标题回退");

  const soloMetaFallback = Core.importChoices(JSON.stringify({
    format: "mwi-vue-solo", version: 2, meta: { loadoutName: "A".repeat(75) },
    player: player("角色甲")
  }));
  assert.equal(soloMetaFallback[0].suggestedName.length, 60);
  assert.equal(soloMetaFallback[0].suggestedName, "A".repeat(60));

  const soloExternalPlain = Core.importChoices(JSON.stringify({
    format: "mwi-vue-solo", version: 2, player: player("角色甲")
  }));
  assert.equal(soloExternalPlain[0].nickname, "角色甲");
  assert.equal(soloExternalPlain[0].suggestedName, "");

  // mwi-vue-group v2: player.loadoutName > top-level loadoutName/name/title/meta.loadoutName; never player.name
  const groupChoices = Core.importChoices(JSON.stringify({
    format: "mwi-vue-group", version: 2, loadoutName: "3人·巫师之塔T0",
    players: [player("测号甲", { loadoutName: "主T·巫师之塔T0" }), player("测号乙")]
  }));
  assert.deepEqual(groupChoices.map(c => [c.nickname, c.suggestedName]), [
    ["测号甲", "主T·巫师之塔T0"],
    ["测号乙", "3人·巫师之塔T0"]
  ]);
  assert.equal(Core.matchImportNickname(groupChoices, "测号甲"), "1");
  assert.equal(Core.matchImportNickname(groupChoices, "测号乙"), "2");

  const groupPlain = Core.importChoices(JSON.stringify({
    format: "mwi-vue-group", version: 2, players: [player("测号甲"), player("测号乙")]
  }));
  assert.deepEqual(groupPlain.map(c => c.suggestedName), ["", ""]);

  // combat-party-builds v1: player.loadoutName > build.loadoutName > build.name > obj.loadoutName
  const partyBuilds = Core.importChoices(JSON.stringify({
    schemaVersion: 1, kind: "combat-party-builds", loadoutName: "顶层整队名",
    builds: [
      { name: "地牢常规", players: [player("甲", { loadoutName: "甲专属" }), player("乙")] },
      { players: [player("丙")] }
    ]
  }));
  assert.deepEqual(partyBuilds.map(c => c.suggestedName), ["甲专属", "地牢常规", "顶层整队名"]);

  // MWISIM full simulation export
  const mwisimFull = Core.importChoices(JSON.stringify({
    players: [player("甲"), player("乙", { loadoutName: "乙单独名" })],
    rows: [], targets: [], simulationSettings: {}, meta: { loadoutName: "模拟导出名" }
  }));
  assert.deepEqual(mwisimFull.map(c => c.suggestedName), ["模拟导出名", "乙单独名"]);

  // Bare modern single player: never treat data.name (character nickname) as suggestedName
  const barePlain = Core.importChoices(JSON.stringify(player("仅昵称")));
  assert.equal(barePlain[0].nickname, "仅昵称");
  assert.equal(barePlain[0].suggestedName, "");
  const bareNamed = Core.importChoices(JSON.stringify(player("仅昵称", { loadoutName: "裸对象配装名" })));
  assert.equal(bareNamed[0].suggestedName, "裸对象配装名");

  // Legacy Shykai solo and numbered dict: read optional loadoutName / meta.loadoutName, never player.name
  const shykaiBase = extra => ({
    player: { name: "Shykai角色", equipment: [{ itemLocationHrid: "/item_locations/two_hand", itemHrid: "/items/bow", enhancementLevel: 10 }] },
    food: { "/action_types/combat": [{ itemHrid: "/items/yogurt" }, null, null] },
    drinks: { "/action_types/combat": [{ itemHrid: "/items/coffee" }, null, null] },
    abilities: [{ abilityHrid: "/abilities/shot" }, null, null, null, null],
    triggerMap: { "/abilities/shot": [] },
    ...extra
  });
  assert.equal(Core.importChoices(JSON.stringify(shykaiBase()))[0].suggestedName, "");
  assert.equal(Core.importChoices(JSON.stringify(shykaiBase({ loadoutName: "Shykai方案" })))[0].suggestedName, "Shykai方案");
  const shykaiNumbered = Core.importChoices(JSON.stringify({
    "1": JSON.stringify(shykaiBase({ meta: { loadoutName: "一号位配装" } })),
    "2": shykaiBase()
  }));
  assert.deepEqual(shykaiNumbered.map(c => c.suggestedName), ["一号位配装", ""]);
});

test("ignoreHarmlessEmpty suppresses only zero-impact empty target slots while keeping impactful empty reminders", () => {
  const itemDetails = {
    "/items/bow": { equipmentDetail: { type: "/equipment_types/two_hand", combatStats: { rangedDamage: 120 } } },
    "/items/sword": { equipmentDetail: { type: "/equipment_types/main_hand", combatStats: { meleeDamage: 90 } } },
    "/items/shield": { equipmentDetail: { type: "/equipment_types/off_hand", combatStats: { armor: 60 } } },
    "/items/task_badge": { equipmentDetail: { type: "/equipment_types/trinket", noncombatStats: { taskSpeed: 0.05 } } },
    "/items/large_pouch": { equipmentDetail: { type: "/equipment_types/pouch", combatStats: { foodSlots: 2, drinkSlots: 2 } } },
    "/items/medium_pouch": { equipmentDetail: { type: "/equipment_types/pouch", combatStats: { foodSlots: 1, drinkSlots: 1 } } },
    "/items/guzzling_pouch": { equipmentDetail: { type: "/equipment_types/pouch", combatStats: { foodSlots: 2, drinkSlots: 2, drinkConcentration: 0.1 }, noncombatStats: { drinkConcentration: 0.1 } } },
    "/items/gluttonous_pouch": { equipmentDetail: { type: "/equipment_types/pouch", combatStats: { foodSlots: 2, drinkSlots: 2, foodHaste: 0.1 } } },
    "/items/woodcutting_shirt": { equipmentDetail: { type: "/equipment_types/body", noncombatStats: { woodcuttingEfficiency: 0.05 } } },
    "/items/cheesesmithing_shirt": { equipmentDetail: { type: "/equipment_types/body", noncombatStats: { cheesesmithingEfficiency: 0.05 } } },
    "/items/philosopher_neck": { equipmentDetail: { type: "/equipment_types/neck", noncombatStats: { skillingExperience: 0.05 } } },
    "/items/gathering_cloak": { equipmentDetail: { type: "/equipment_types/back", noncombatStats: { gatheringQuantity: 0.05 } } },
    "/items/enhancing_gloves": { equipmentDetail: { type: "/equipment_types/hands", noncombatStats: { enhancingSuccess: 0.02 } } }
  };

  // 1. Combat: two-hand target suppresses empty off_hand; trinket & plain pouch empty suppressed;
  //    regular gear, abilities, unlocked food/drinks still remind; raw diff without option stays exact.
  const combatTarget = raw();
  combatTarget.wearableMap = { "/item_locations/main_hand": "71::/item_locations/inventory::/items/bow::12" }; // normalized two-hand (like simulator import)
  combatTarget.abilityMap = { 1: "/abilities/shot", 2: "", 3: "", 4: "", 5: "" };
  combatTarget.foodItemHrids = ["/items/yogurt", "", ""];
  combatTarget.drinkItemHrids = ["/items/coffee", "", ""];
  const combatCurrent = structuredClone(combatTarget);
  combatCurrent.wearableMap["/item_locations/off_hand"] = "71::/item_locations/inventory::/items/shield::10";
  combatCurrent.wearableMap["/item_locations/trinket"] = "71::/item_locations/inventory::/items/task_badge::0";
  combatCurrent.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/large_pouch::0";
  // Raw diff (used by cloud conflict UI) keeps all 3 differences.
  assert.deepEqual(Core.diff(combatCurrent, Core.snapshot(combatTarget)).map(c => c.slot).sort(), ["off_hand", "pouch", "trinket"]);
  // Guided diff suppresses all 3 zero-impact empty slots.
  assert.deepEqual(Core.diff(combatCurrent, Core.snapshot(combatTarget), { ignoreHarmlessEmpty: true, itemDetails }), []);

  // Single-hand weapon target + empty off_hand MUST still remind (shield affects combat stats/threat).
  const oneHandTarget = structuredClone(combatTarget);
  oneHandTarget.wearableMap = { "/item_locations/main_hand": "71::/item_locations/inventory::/items/sword::12" };
  const oneHandCurrent = structuredClone(oneHandTarget);
  oneHandCurrent.wearableMap["/item_locations/off_hand"] = "71::/item_locations/inventory::/items/shield::10";
  assert.deepEqual(Core.diff(oneHandCurrent, Core.snapshot(oneHandTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => c.slot), ["off_hand"]);

  // 2. Pouch with side-effect stats (guzzling_pouch / gluttonous_pouch):
  //    reminds when target actually has drinks/food, suppresses when target has no drinks/food.
  const guzzleCur = structuredClone(combatTarget);
  guzzleCur.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/guzzling_pouch::10";
  assert.deepEqual(Core.diff(guzzleCur, Core.snapshot(combatTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => c.slot), ["pouch"]);
  const noDrinkTarget = structuredClone(combatTarget);
  noDrinkTarget.drinkItemHrids = ["", "", ""];
  const guzzleNoDrinkCur = structuredClone(noDrinkTarget);
  guzzleNoDrinkCur.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/guzzling_pouch::10";
  assert.deepEqual(Core.diff(guzzleNoDrinkCur, Core.snapshot(noDrinkTarget), { ignoreHarmlessEmpty: true, itemDetails }), []);

  const gluttonCur = structuredClone(combatTarget);
  gluttonCur.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/gluttonous_pouch::10";
  assert.deepEqual(Core.diff(gluttonCur, Core.snapshot(combatTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => c.slot), ["pouch"]);
  const noFoodTarget = structuredClone(combatTarget);
  noFoodTarget.foodItemHrids = ["", "", ""];
  const gluttonNoFoodCur = structuredClone(noFoodTarget);
  gluttonNoFoodCur.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/gluttonous_pouch::10";
  assert.deepEqual(Core.diff(gluttonNoFoodCur, Core.snapshot(noFoodTarget), { ignoreHarmlessEmpty: true, itemDetails }), []);

  // 3. Locked consumable slots beyond effective pouch cap are ignored when target is empty;
  //    unlocked extra food/drinks and abilities MUST still remind!
  const noPouchCur = structuredClone(combatTarget);
  noPouchCur.foodItemHrids = ["/items/yogurt", "/items/cake", ""]; // slot 1 locked (no pouch -> cap 1)
  noPouchCur.drinkItemHrids = ["/items/coffee", "/items/tea", ""]; // slot 1 locked (no pouch -> cap 1)
  assert.deepEqual(Core.diff(noPouchCur, Core.snapshot(combatTarget), { ignoreHarmlessEmpty: true, itemDetails }), []);
  // When effective pouch is medium_pouch (cap 2), slot 1 IS unlocked (must remind!) while slot 2 is locked (ignored!).
  const medTarget = structuredClone(combatTarget);
  medTarget.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/medium_pouch::0";
  const medCur = structuredClone(medTarget);
  medCur.foodItemHrids = ["/items/yogurt", "/items/cake", "/items/apple"];
  medCur.abilityMap[2] = "/abilities/heal";
  assert.deepEqual(
    Core.diff(medCur, Core.snapshot(medTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => `${c.kind}:${c.slot}`),
    ["ability:2", "food:1"]
  );
  // If target leaves pouch empty and current has large_pouch (retained via rule 3 -> cap 3), slot 1 IS unlocked so extra food reminds!
  const keptLargeCur = structuredClone(combatTarget);
  keptLargeCur.wearableMap["/item_locations/pouch"] = "71::/item_locations/inventory::/items/large_pouch::0";
  keptLargeCur.foodItemHrids = ["/items/yogurt", "/items/cake", ""];
  assert.deepEqual(
    Core.diff(keptLargeCur, Core.snapshot(combatTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => `${c.kind}:${c.slot}`),
    ["food:1"]
  );

  // 4. Single-skill life loadout: unrelated 9 tools + unrelated combat/other-skill gear ignored when empty;
  //    active skill tool & gear with active life/universal stats still remind; all-skills keeps all 10 tools.
  const wcTarget = life("/action_types/woodcutting");
  wcTarget.wearableMap = { "/item_locations/woodcutting_tool": "71::/item_locations/inventory::/items/woodcutting_tool::10" };
  wcTarget.drinkItemHrids = ["/items/tea", "", ""];
  const wcCur = structuredClone(wcTarget);
  for (const skill of lifeTypes) if (skill !== "woodcutting") wcCur.wearableMap[`/item_locations/${skill}_tool`] = `71::/item_locations/inventory::/items/${skill}_tool::8`;
  wcCur.wearableMap["/item_locations/main_hand"] = "71::/item_locations/inventory::/items/sword::10"; // combat-only
  wcCur.wearableMap["/item_locations/body"] = "71::/item_locations/inventory::/items/cheesesmithing_shirt::8"; // wrong life skill
  wcCur.wearableMap["/item_locations/hands"] = "71::/item_locations/inventory::/items/enhancing_gloves::8"; // enhancingSuccess doesn't affect woodcutting
  wcCur.wearableMap["/item_locations/trinket"] = "71::/item_locations/inventory::/items/task_badge::0";
  assert.deepEqual(Core.diff(wcCur, Core.snapshot(wcTarget), { ignoreHarmlessEmpty: true, itemDetails }), []);
  // Active skill stats & universal life stats & gatheringQuantity DO affect woodcutting -> MUST remind!
  wcCur.wearableMap["/item_locations/body"] = "71::/item_locations/inventory::/items/woodcutting_shirt::8";
  wcCur.wearableMap["/item_locations/neck"] = "71::/item_locations/inventory::/items/philosopher_neck::8";
  wcCur.wearableMap["/item_locations/back"] = "71::/item_locations/inventory::/items/gathering_cloak::8";
  assert.deepEqual(
    Core.diff(wcCur, Core.snapshot(wcTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => c.slot).sort(),
    ["back", "body", "neck"]
  );
  // Active skill tool empty MUST still remind!
  const wcNoToolTarget = structuredClone(wcTarget);
  wcNoToolTarget.wearableMap = {};
  assert.deepEqual(
    Core.diff(wcTarget, Core.snapshot(wcNoToolTarget), { ignoreHarmlessEmpty: true, itemDetails }).map(c => c.slot),
    ["woodcutting_tool"]
  );
  // All-skills loadout keeps all 10 tools when empty.
  const allTarget = life(""), allCur = structuredClone(allTarget);
  for (const skill of lifeTypes) allTarget.wearableMap[`/item_locations/${skill}_tool`] = "";
  assert.equal(Core.diff(allCur, Core.snapshot(allTarget), { ignoreHarmlessEmpty: true, itemDetails }).length, 10);
});
