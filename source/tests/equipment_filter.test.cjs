"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const F = require("../equipment_filter.js"), catalog = require("../equipment_catalog.js");
const item = slug => catalog.items.find(row => row.hrid === `/items/${slug}`);
test("categories follow wear skill requirements, not weapon names or combat bonus stats", () => {
  assert.deepEqual(F.groups(item("cheese_sword")), ["melee"]);
  assert.deepEqual(F.groups(item("cheese_helmet")), ["defense"]);
  assert.deepEqual(F.groups(item("wooden_bow")), ["ranged"]);
  assert.deepEqual(F.groups(item("magicians_hat")), ["magic"]);
  assert.deepEqual(F.groups(item("ring_of_regeneration")), ["other"]);
  assert.deepEqual(F.groups({ requirements: [{ skillHrid: "/skills/attack", level: 1 }, { skillHrid: "/skills/defense", level: 1 }] }), ["attack", "defense"]);
});
test("refined equipment uses actual wear level rather than lower economic itemLevel", () => {
  const refined = item("magicians_hat_refined");
  assert.equal(refined.itemLevel, 95); assert.equal(F.level(refined), 110);
  assert.equal(F.level(item("guzzling_pouch")), 90); // total level 1250 is not an equipment level
  assert.equal(F.level(item("ring_of_regeneration")), 45);
});
test("slot, category, inclusive lower bound, exclusive upper bound and bilingual search combine", () => {
  const filters = { category: "magic", min: "95", max: "110", search: "" };
  const matches = F.options(catalog, "head", filters);
  assert.ok(matches.some(row => row.hrid === "/items/magicians_hat"));
  assert.ok(!matches.some(row => row.hrid === "/items/magicians_hat_refined"));
  for (const row of matches) { assert.equal(row.slot, "head"); assert.ok(F.groups(row).includes("magic")); assert.ok(F.level(row) >= 95 && F.level(row) < 110); }
  assert.equal(F.options(catalog, "head", { ...filters, search: "Magician's Hat" }).length, 1);
  assert.equal(F.options(catalog, "head", { ...filters, search: "unmatched-name" }).length, 0);
});
test("complete candidate catalogue is independent of the website's first 60 rendered options", () => {
  const matches = F.options(catalog, "weapon", { category: "all", min: "1" });
  assert.ok(matches.length > 60); assert.equal(matches.length, catalog.items.filter(row => row.slot === "weapon").length);
  const last = matches.at(-1);
  assert.ok(F.options(catalog, "weapon", { search: last.hrid }).some(row => row.hrid === last.hrid));
});
test("invalid ranges show no matches and do not swap bounds or mutate the catalogue", () => {
  const original = JSON.stringify(catalog);
  for (const range of [{ min: "95", max: "95" }, { min: "110", max: "95" }, { min: "bad" }, { max: "-1" }]) {
    assert.equal(F.validRange(range), false); assert.deepEqual(F.options(catalog, "head", range), []);
  }
  assert.equal(JSON.stringify(catalog), original);
});
test("all and neutral categories remain distinct, and skilling-only charms stay excluded", () => {
  assert.ok(F.options(catalog, "ring", { category: "other" }).length > 0);
  assert.deepEqual(F.options(catalog, "ring", { category: "ranged" }), F.options(catalog, "ring", { category: "all" }));
  assert.ok(!catalog.items.some(row => row.hrid === "/items/trainee_alchemy_charm"));
  assert.equal(F.active({}), false); assert.equal(F.active({ search: "  " }), false);
  assert.equal(F.active({ min: "0" }), true); assert.equal(F.active({ category: "other" }), true);
});
test("pouch, neck, ring and earrings ignore category, level, search and invalid ranges", () => {
  assert.deepEqual(F.exemptSlots, ["pouch", "neck", "ring", "earrings"]);
  for (const slot of F.exemptSlots) {
    const all = catalog.items.filter(item => item.slot === slot); assert.ok(all.length);
    for (const filters of [{ category: "ranged" }, { min: "110", max: "1", search: "no-match" },
      { category: "magic", min: "999", max: "1000" }, { min: "bad" }]) {
      assert.deepEqual(F.options(catalog, slot, filters), all);
    }
  }
  for (const slot of ["head", "weapon", "off_hand", "back", "charm"]) {
    assert.equal(F.isExempt(slot), false);
    assert.deepEqual(F.options(catalog, slot, { min: "110", max: "1" }), []);
  }
});
test("catalogue provides original Chinese and English names for public native selection", () => {
  assert.equal(F.localeForLabel(catalog, "weapon", "Main Hand"), "en");
  assert.equal(F.localeForLabel(catalog, "weapon", "主手"), "zh");
  assert.ok(catalog.items.every(row => row.zh && row.en && Number.isFinite(F.level(row))));
  assert.ok(Object.keys(catalog.metadata.inputSha256).length === 4);
});
