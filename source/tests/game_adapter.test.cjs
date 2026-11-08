"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const Core = require("../scene_core.js");
const adapter = fs.readFileSync(path.join(__dirname, "../game_adapter.js"), "utf8");
function harness() {
  const details = { isConnected: true, getClientRects: () => [{}], closest: () => null };
  const setup = { ...details };
  const panel = { ...details, querySelector: selector => selector.includes("_details__") ? details : setup };
  const raw = { id: 12, name: "远程", actionTypeHrid: "/action_types/combat", useExactEnhancement: false,
    wearableMap: {}, abilityMap: {}, foodItemHrids: [], drinkItemHrids: [] };
  const controller = { state: { selectedCharacterLoadoutId: 12 }, props: { characterLoadoutDict: { 12: raw }, characterInfo: { characterID: 71 } } };
  const classFiber = { stateNode: controller }, hostFiber = { stateNode: panel, return: classFiber };
  classFiber.child = hostFiber;
  const root = { _reactRootContainer: { current: classFiber } };
  const context = { MWILoadoutScenes: { Core }, document: { querySelectorAll: () => [panel], getElementById: () => root },
    location: { origin: "https://www.milkywayidlecn.com" } };
  vm.runInNewContext(adapter, context);
  return { root, panel, classFiber, hostFiber, controller, read: () => context.MWILoadoutScenes.Adapter.current() };
}
test("root fallback skips unrelated DOM branches and binds only the exact visible panel", () => {
  const h = harness(); let enteredUnrelated = false;
  const unrelated = { stateNode: { nodeType: 1, contains: () => false }, sibling: h.classFiber,
    get child() { enteredUnrelated = true; throw Error("must not inspect unrelated page branch"); } };
  h.root._reactRootContainer.current = { child: unrelated };
  assert.equal(h.read().scope, "https://www.milkywayidlecn.com|71|12");
  assert.equal(enteredUnrelated, false);
});
test("fallback reads current tree, does not search stale alternate trees or unrelated controllers", () => {
  const h = harness();
  h.root._reactRootContainer.current = { stateNode: { props: h.controller.props, state: h.controller.state }, alternate: h.classFiber };
  assert.throws(h.read, /无法读取/);
  h.root._reactRootContainer.current = h.classFiber;
  assert.equal(h.read().raw.id, 12);
});
test("root traversal terminates on cycles and enforces its scan budget", () => {
  const h = harness(); const cycle = {}; cycle.child = cycle; cycle.sibling = cycle;
  h.root._reactRootContainer.current = cycle;
  assert.throws(h.read, /无法读取/);
  const first = {}; let tail = first;
  for (let i = 0; i < 4100; i++) tail = tail.child = {};
  tail.child = h.classFiber; h.root._reactRootContainer.current = first;
  assert.throws(h.read, /无法读取/);
});
