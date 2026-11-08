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
