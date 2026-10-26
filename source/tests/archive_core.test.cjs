"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const C = require("../archive_core.js"), F = require("./fixtures.cjs");
test("current payload preserves gear, zero, null slots and numeric official maps; strips unrelated data", () => {
  const result = C.sanitizePayload(F.current()), p = result.payload;
  assert.equal(result.format, "main-site-current-character");
  assert.deepEqual(p.character, { id: 101, name: "测试角色·当前" });
  assert.equal(p.characterItems.length, 1); assert.equal(p.characterItems[0].enhancementLevel, 0);
  assert.equal(p.characterItems[0].hash, undefined);
  assert.deepEqual(p.actionTypeFoodSlotsMap["/action_types/combat"], ["", null, { itemHrid: "/items/star_fruit_gummy" }]);
  assert.equal(p.characterHouseRoomMap[11].level, 0);
  assert.equal(p.guildBuildingLevelMap["/guild_shrines/force"], 2);
  assert.equal(p.characterAchievements[7].isCompleted, false);
  for (const key of ["account", "marketItemValues", "mainSiteCombat", "characterInfo"]) assert.equal(p[key], undefined);
  assert.ok(!JSON.stringify(p).includes("never-keep"));
});
test("native empty-object combat slots archive and restore without conflating missing, arrays or zero", async () => {
  const raw = F.emptyCombatSlots(), p = C.sanitizePayload(raw).payload;
  assert.deepEqual(p.actionTypeFoodSlotsMap["/action_types/combat"], {});
  assert.deepEqual(p.actionTypeDrinkSlotsMap["/action_types/combat"], {});
  assert.equal(p.characterItems[0].enhancementLevel, 0);
  assert.deepEqual(C.sanitizePayload(p).payload, p);
  const row = await C.prepare(raw);
  assert.deepEqual(C.restoreMessage(row, "3", "empty-slots").payload, p);
  assert.deepEqual(C.parseFile(C.exportFile([row]))[0].payload, p);
  const absent = F.emptyCombatSlots(); delete absent.actionTypeFoodSlotsMap;
  assert.equal(C.sanitizePayload(absent).payload.actionTypeFoodSlotsMap, undefined);
  const emptyMap = F.emptyCombatSlots(); emptyMap.actionTypeFoodSlotsMap = {};
  assert.deepEqual(C.sanitizePayload(emptyMap).payload.actionTypeFoodSlotsMap, {});
  assert.notEqual((await C.prepare(emptyMap)).fingerprint, row.fingerprint);
  const array = F.emptyCombatSlots(); array.actionTypeFoodSlotsMap["/action_types/combat"] = [];
  assert.deepEqual(C.sanitizePayload(array).payload.actionTypeFoodSlotsMap["/action_types/combat"], []);
  assert.notEqual((await C.prepare(array)).fingerprint, row.fingerprint);
});
test("empty-object native slot compatibility does not admit malformed objects or alter modern slot arrays", () => {
  for (const field of ["actionTypeFoodSlotsMap", "actionTypeDrinkSlotsMap"]) {
    for (const value of [{ 0: "/items/star_fruit_gummy" }, { token: "must-not-be-stored" }, null, false, 0, ""]) {
      const raw = F.emptyCombatSlots(); raw[field]["/action_types/combat"] = value;
      assert.throws(() => C.sanitizePayload(raw), /数据格式不兼容/);
    }
  }
  for (const field of ["food", "drinks"]) {
    const raw = F.modern(); raw.player[field] = {};
    assert.throws(() => C.sanitizePayload(raw), /数据格式不兼容/);
  }
});
test("wrapped shared profiles keep nested loadouts and authoritative empty guild map", () => {
  const p = C.sanitizePayload(F.shared()).payload;
  assert.equal(p.profile.sharableCharacter.characterId, 202);
  assert.deepEqual(p.profile.guildBuffLevelMap, {});
  assert.equal(p.profile.currentCombatLoadout.foodItemHrids[0], "");
  assert.deepEqual(p.profile.currentCombatLoadout.abilityCombatTriggersMap["/abilities/mystic_aura"], []);
  assert.ok(!JSON.stringify(p).includes("never-keep"));
  assert.equal(p.marketItemValues, undefined);
});
test("modern portable data retain five positions, zero, null, disabled triggers and no simulation settings", () => {
  const raw = F.modern(), p = C.sanitizePayload(raw).payload;
  assert.deepEqual(p.player, raw.player); assert.equal(p.simulationSettings, undefined);
  assert.deepEqual(p.player.triggerMap["/items/star_fruit_gummy"], []);
  assert.equal(p.player.abilities.length, 5); assert.equal(p.player.abilities[1], null);
});
test("sanitizing twice changes neither content nor missing field semantics", () => {
  for (const raw of [F.modern(), F.current(), F.shared()]) {
    const first = C.sanitizePayload(raw).payload;
    assert.deepEqual(C.sanitizePayload(first).payload, first);
  }
  const raw = F.current(); delete raw.characterGuildBuffMap;
  assert.equal(C.sanitizePayload(raw).payload.characterGuildBuffMap, undefined);
});
test("hash excludes unrelated inventory and includes changed equipment", async () => {
  const first = F.current(), other = F.current(); other.marketItemValues = { fake: 999 }; other.account.password = "different";
  const a = await C.prepare(first), b = await C.prepare(other);
  assert.equal(a.fingerprint, b.fingerprint); assert.equal(a.id, b.id);
  other.characterItems[0].enhancementLevel = 5;
  assert.notEqual((await C.prepare(other)).fingerprint, a.fingerprint);
});
test("canonical hashing does not depend on object key order", async () => {
  assert.equal(await C.digest({ b: 0, a: null }), await C.digest({ a: null, b: 0 }));
  assert.notEqual(await C.digest({}), await C.digest({ a: 0 }));
});
test("restore only targets requested slot and never clears or activates another slot", async () => {
  const row = await C.prepare(F.current());
  const message = C.restoreMessage(row, "3", "request-1");
  assert.equal(message.targetPlayerId, "3"); assert.equal(message.requestId, "request-1");
  for (const key of ["clearOtherPlayers", "clearPlayerIds", "resetTeamSelection", "selectAfterImport", "activateAfterImport"]) assert.equal(message[key], undefined);
  assert.throws(() => C.restoreMessage(row, 6, "x"));
});
test("backup roundtrip revalidates all entries, retaining name and capture time", async () => {
  const row = await C.prepare(F.current(), { kind: "named", name: "法系日常", now: 100 });
  const [entry] = C.parseFile(C.exportFile([row]));
  assert.equal(entry.name, "法系日常"); assert.equal(entry.capturedAt, 100);
  assert.deepEqual(entry.payload, row.payload);
});
test("native group and single files import with no settings overwrites", () => {
  assert.equal(C.parseFile(JSON.stringify(F.modern())).length, 1);
  const group = { version: 2, players: [F.modern("一").player, F.modern("二").player] };
  assert.equal(C.parseFile(JSON.stringify(group)).length, 2);
});
test("malformed entries, prototype keys, NaN, huge files and unsupported versions are rejected", () => {
  assert.throws(() => C.parseFile("<html>"), /JSON/);
  assert.throws(() => C.parseFile('{"format":"mwi-loadout-archive","version":99,"archives":[]}'), /版本/);
  const bad = F.modern(); bad.player.triggerMap = JSON.parse('{"__proto__":{}}');
  assert.throws(() => C.sanitizePayload(bad));
  const nan = F.modern(); nan.player.levels.magic = NaN; assert.throws(() => C.sanitizePayload(nan));
  assert.throws(() => C.sanitizePayload({ padding: "x".repeat(C.MAX_BYTES) }), /过大/);
  assert.throws(() => C.parseFile(JSON.stringify({ version: 2, players: [F.modern().player, { invalid: true }] })));
});
test("oversize trigger/slot lists reject instead of silently truncating a configuration", () => {
  const raw = F.current(); raw.actionTypeFoodSlotsMap["/action_types/combat"].push("");
  assert.throws(() => C.sanitizePayload(raw));
  const raw2 = F.modern(); raw2.player.triggerMap["/abilities/fireball"] = Array(5).fill(F.trigger);
  assert.throws(() => C.sanitizePayload(raw2));
});
test("coverage distinguishes absent guild buffs and authoritative empty map", () => {
  const raw = F.modern(); assert.deepEqual(C.details(raw).missing, []);
  delete raw.player.guildBuffs; assert.ok(C.details(raw).missing.includes("公会增益"));
});
