"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../action_memory.js"), "utf8");
const prefix = "mwi-layu:action-loadouts:v1:";
function harness() {
  const data = new Map(), queue = [], notices = [];
  let visible = true, blocked = false;
  const panel = { isConnected: true, getClientRects: () => visible ? [{}] : [], append: node => notices.push(node) };
  const action = (name, type = "foraging") => ({ hrid: "/actions/" + name, type: "/action_types/" + type });
  const props = { characterInfo: { characterID: 71 }, actionDetail: action("apple"), characterLoadoutDict: {
    1: { id: 1, actionTypeHrid: "" }, 2: { id: 2, actionTypeHrid: "/action_types/foraging" },
    3: { id: 3, actionTypeHrid: "/action_types/combat" } } };
  const controller = { props, state: { actionDetail: props.actionDetail, selectedCharacterLoadoutId: 1,
    loadoutOptions: [0, 1, 2].map(value => ({ value })), maxActionCount: 10 },
    setState(patch, callback) { queue.push(() => { const next = typeof patch === "function" ? patch(this.state, this.props) : patch;
      if (next) Object.assign(this.state, next); callback?.call(this); }); } };
  const original = controller.setState;
  const context = { MWILoadoutScenes: { Adapter: { actionContexts: () => visible ? [{ panel, controller }] : [] } },
    location: { origin: "https://www.milkywayidlecn.com" },
    localStorage: { getItem: key => { if (blocked) throw Error("denied"); return data.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw Error("quota"); data.set(key, value); } },
    document: { createElement: () => ({ setAttribute() {}, remove() { this.removed = true; } }) } };
  vm.runInNewContext(source, context);
  const tick = context.MWILoadoutScenes.ActionMemory.tick;
  const key = () => prefix + JSON.stringify([context.location.origin, props.characterInfo.characterID, props.actionDetail.type, props.actionDetail.hrid]);
  const flush = () => { while (queue.length) queue.shift()(); };
  const choose = value => { controller.setState({ selectedCharacterLoadoutId: value }); flush(); };
  const open = (name = "apple", type = "foraging", selected = 1) => {
    props.actionDetail = action(name, type); controller.state.actionDetail = props.actionDetail;
    controller.state.selectedCharacterLoadoutId = selected;
    controller.state.loadoutOptions = [0, 1, type === "combat" ? 3 : 2].map(value => ({ value }));
    tick(); flush();
  };
  const reopen = () => { visible = false; tick(); visible = true; open(); };
  return { data, queue, notices, context, controller, props, original, tick, key, flush, choose, open, reopen,
    block: () => { blocked = true; }, hide: () => { visible = false; tick(); } };
}
test("explicit choices including zero persist per action and restore without replacing unrelated state", () => {
  const h = harness(); h.tick(); h.flush(); assert.equal(h.data.size, 0);
  h.choose(2); const apple = h.key(); h.open("pear"); h.choose(1);
  h.open(); assert.equal(h.controller.state.selectedCharacterLoadoutId, 2);
  assert.equal(h.controller.state.maxActionCount, 10);
  h.choose(0); h.reopen(); assert.equal(h.controller.state.selectedCharacterLoadoutId, 0);
  assert.equal(JSON.parse(h.data.get(apple)).loadoutId, 0);
});
test("combat actions, characters and origins are isolated; difficulty is not part of project identity", () => {
  const h = harness(); h.open("wizard_tower", "combat"); h.choose(3);
  h.props.characterInfo.characterID = 72; h.open("wizard_tower", "combat");
  assert.equal(h.controller.state.selectedCharacterLoadoutId, 1);
  h.props.characterInfo.characterID = 71; h.open("other", "combat"); h.open("wizard_tower", "combat");
  assert.equal(h.controller.state.selectedCharacterLoadoutId, 3);
  h.controller.setState({ difficultyTier: 2 }); h.flush();
  assert.equal(h.data.size, 1);
  h.context.location.origin = "https://www.milkywayidle.com"; h.open("wizard_tower", "combat");
  assert.equal(h.controller.state.selectedCharacterLoadoutId, 1);
});
test("default recalculation, full state patches and opening an unremembered action never save", () => {
  const h = harness(); h.tick(); h.flush();
  h.controller.setState({ selectedCharacterLoadoutId: 2, loadoutOptions: h.controller.state.loadoutOptions }); h.flush();
  h.tick(); assert.equal(h.data.size, 0);
  h.choose(2); h.reopen(); assert.equal(h.data.size, 1);
  h.open("pear"); assert.equal(h.data.size, 1);
});
test("later user selection wins over queued restoration and quick navigation cannot restore to another action", () => {
  const h = harness(); h.tick(); h.choose(2); h.open("pear");
  h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/apple" };
  h.controller.state.actionDetail = h.props.actionDetail; h.tick();
  h.choose(0); assert.equal(h.controller.state.selectedCharacterLoadoutId, 0);
  h.open("pear"); h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/apple" };
  h.controller.state.actionDetail = h.props.actionDetail; h.tick();
  h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/pear" }; h.controller.state.actionDetail = h.props.actionDetail;
  h.controller.state.selectedCharacterLoadoutId = 1; h.flush();
  assert.equal(h.controller.state.selectedCharacterLoadoutId, 1);
});
test("renaming preserves ID; missing, disabled and wrong-type loadouts are never restored", () => {
  for (const invalidate of [h => delete h.props.characterLoadoutDict[2],
    h => { h.props.characterLoadoutDict[2].actionTypeHrid = "/action_types/combat"; },
    h => { h.controller.state.loadoutOptions.find(o => o.value === 2).disabled = true; }]) {
    const h = harness(); h.tick(); h.choose(2); h.props.characterLoadoutDict[2].name = "renamed";
    h.reopen(); assert.equal(h.controller.state.selectedCharacterLoadoutId, 2);
    h.open("pear"); invalidate(h); h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/apple" };
    h.controller.state.actionDetail = h.props.actionDetail; h.tick(); h.flush();
    assert.equal(h.controller.state.selectedCharacterLoadoutId, 1);
    assert.match(h.notices.at(-1).textContent, /不可用/);
  }
});
test("corrupt/blocked storage leaves native selection usable, preserves other records and reports failure", () => {
  const h = harness(); h.data.set("other-plugin", "keep"); h.data.set(h.key(), "bad JSON");
  h.tick(); h.flush(); assert.match(h.notices.at(-1).textContent, /没能读取/);
  h.choose(2); assert.equal(h.data.get("other-plugin"), "keep");
  assert.equal(JSON.parse(h.data.get(h.key())).loadoutId, 2);
  h.block(); h.choose(0); assert.equal(h.controller.state.selectedCharacterLoadoutId, 0);
  assert.match(h.notices.at(-1).textContent, /没能记住/);
});
test("detach restores setter and cancels queued restoration; repeated ticks never stack wrappers", () => {
  const h = harness(); h.tick(); const wrapper = h.controller.setState;
  h.tick(); assert.equal(h.controller.setState, wrapper); h.choose(2); h.open("pear");
  h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/apple" }; h.controller.state.actionDetail = h.props.actionDetail;
  h.tick(); h.hide(); h.flush(); assert.equal(h.controller.state.selectedCharacterLoadoutId, 1);
  assert.equal(h.controller.setState, h.original);
});
test("missing character or stale action state never reads, saves or restores a preference", () => {
  const h = harness(); h.tick(); h.choose(2); const saved = [...h.data];
  h.props.characterInfo.characterID = undefined; h.choose(1); assert.deepEqual([...h.data], saved);
  h.props.characterInfo.characterID = 71; h.props.actionDetail = { ...h.props.actionDetail, hrid: "/actions/pear" };
  h.choose(0); assert.deepEqual([...h.data], saved);
});
