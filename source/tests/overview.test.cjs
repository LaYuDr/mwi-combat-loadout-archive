"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../overview.js"), "utf8");

function harness() {
  const requests = [], views = [], optionChanges = [];
  const createElement = (type, props, ...children) => ({ type, key: props?.key, props: { ...props, children } });
  const React = {
    createElement,
    cloneElement: (node, props, ...children) => ({ ...node, props: { ...node.props, ...props, children } }),
    Children: { toArray: value => [value].flat(Infinity).filter(entry => entry != null && typeof entry !== "boolean") },
    Component: class {
      constructor(props) { this.props = props; }
      forceUpdate() { this.output = this.render(); }
      setState(patch) { Object.assign(this.state, patch); }
    }
  };
  const native = (part, properties, ...children) => createElement("div", { ...properties, className: `LoadoutsPanel_${part}__test` }, ...children);
  class NativePanel extends React.Component {
    constructor(props) {
      super(props);
      this.state = { selectedCharacterLoadoutId: null };
      this.save = slotType => this.props.updateLoadoutSlotHandler({ id: this.state.selectedCharacterLoadoutId, slotType });
      this.isDefaultChanged = event => this.saveOption("isDefault", event.target.checked);
      this.suppressValidationChanged = event => this.saveOption("suppressValidation", event.target.checked);
      this.useExactEnhancementChanged = event => this.saveOption("useExactEnhancement", !event.target.checked);
    }
    saveOption(key, checked) {
      const row = this.props.characterLoadoutDict[this.state.selectedCharacterLoadoutId];
      this.props.updateLoadoutHandler({ ...row, [key]: checked });
    }
    renderMainView() {
      return native("mainView", {}, native("newLoadoutInputs"), native("characterLoadouts", {},
        ...Object.values(this.props.characterLoadoutDict).map(row => native("characterLoadout", {
          "data-loadout-id": row.id, onClick: () => views.push(row.id)
        }, "handle", "icon", row.name))));
    }
    renderLoadout() {
      const slot = native("gearSlot", { style: { gridRowStart: 7 } }, createElement("button", { currentItem: { itemHrid: "/items/hatchet" } }));
      // The native equipment cell receives one child, not a children array.
      slot.props.children = slot.props.children[0];
      const row = this.props.characterLoadoutDict[this.state.selectedCharacterLoadoutId];
      const checkbox = (label, checked, onChange) => native("metadata", {}, createElement("input", { label, checked, onChange }));
      return native("selectedLoadout", {}, native("details", {},
        checkbox("设为默认配装", row.isDefault, this.isDefaultChanged),
        checkbox("缺失物品时不要提醒", row.suppressValidation, this.suppressValidationChanged),
        checkbox("使用最高强化等级", !row.useExactEnhancement, this.useExactEnhancementChanged),
        native("setup", {}, native("buttonsContainer"), native("equipment", {}, native("playerModel", {}, slot)), native("abilities"), native("consumables"))));
    }
    render() { return native("loadoutsPanel", {}, this.state.selectedCharacterLoadoutId === null ? this.renderMainView() : this.renderLoadout()); }
  }
  const controller = new NativePanel({ characterInfo: { characterID: 71 }, characterLoadoutDict: {
    12: { id: 12, name: "甲", isDefault: true, suppressValidation: false, useExactEnhancement: false },
    13: { id: 13, name: "乙", isDefault: false, suppressValidation: false, useExactEnhancement: true }
  }, updateLoadoutSlotHandler: change => requests.push(change), updateLoadoutHandler: change => {
    optionChanges.push(change);
    controller.props.characterLoadoutDict[change.id] = change;
  } });
  const panel = { querySelector: () => ({}), contains: node => node.isConnected };
  const webpack = { c: { 0: { exports: React }, 1: { exports: {
    compressToUTF16() {}, decompressFromUTF16: () => JSON.stringify({ itemDetailMap: { "/items/hatchet": {
      equipmentDetail: { levelRequirements: [{ level: 60 }, { level: 1250 }] }
    } } })
  } } }, m: {} };
  const chunks = [];
  chunks.push = probe => {
    const id = probe[2][0][0];
    webpack.m[id] = probe[1][id];
    webpack.c[id] = {};
    webpack.m[id](webpack.c[id], {}, webpack);
    return Array.prototype.push.call(chunks, probe);
  };
  const app = { Adapter: { visibleLoadoutPanel: () => panel, loadoutController: () => controller } };
  vm.runInNewContext(source, { MWILoadoutScenes: app, webpackJsonprpg_web: chunks,
    localStorage: { getItem: () => "compressed native cache" } });
  const find = (node, predicate) => {
    if (predicate(node)) return node;
    for (const entry of React.Children.toArray(node?.props?.children)) {
      const match = find(entry, predicate);
      if (match) return match;
    }
  };
  const grid = () => find(controller.output, node => Object.hasOwn(node?.props || {}, "data-mwi-loadout-overview"));
  function mountCard(node) {
    const card = new node.type(node.props);
    const element = { isConnected: true, getClientRects: () => [{}] };
    card.rememberCard(element);
    const nativeSlots = React.Children.toArray(card.render().props.children)[1];
    return { card, element, slots: new nativeSlots.type(nativeSlots.props) };
  }
  app.Overview.sync();
  return { app, controller, requests, views, optionChanges, find, grid, mountCard, chunks, webpack };
}

test("the overview reuses one native editor per loadout and renders its cache badges without issuing updates", () => {
  const h = harness(), cards = h.grid().props.children.flat();
  assert.deepEqual(Array.from(cards, card => card.key), ["71:12", "71:13"]);
  const first = h.mountCard(cards[0]), second = h.mountCard(cards[1]);
  assert.equal(first.slots.state.selectedCharacterLoadoutId, 12);
  assert.equal(second.slots.state.selectedCharacterLoadoutId, 13);
  assert.equal(h.controller.state.selectedCharacterLoadoutId, null);
  const firstSlots = first.slots.render();
  assert.equal(h.find(firstSlots, node => node?.props?.className === "mwi-overview-requirement").props.title, "装备需求等级 1250");
  assert.equal(h.find(firstSlots, node => node?.props?.className?.includes("buttonsContainer")), undefined);
  assert.equal(h.chunks.length, 0);
  assert.deepEqual(Object.keys(h.webpack.m), []);
  assert.deepEqual(Object.keys(h.webpack.c), ["0", "1"]);
  assert.deepEqual(h.requests, []);
  cards[0].props.openDetails();
  assert.deepEqual(h.views, [12]);
});

test("native edits stay on their card and stale cards cannot write after deletion, character switch or unmount", () => {
  const h = harness(), cards = h.grid().props.children.flat();
  const first = h.mountCard(cards[0]), second = h.mountCard(cards[1]);
  first.slots.save("equipment");
  second.slots.save("ability_trigger");
  second.card.updateSlot({ id: 12, slotType: "equipment" });
  second.card.updateSlot({ id: 13, slotType: "equip_loadout" });
  delete h.controller.props.characterLoadoutDict[12];
  first.slots.save("equipment");
  h.controller.props.characterInfo.characterID = 72;
  second.slots.save("ability_trigger");
  h.controller.props.characterInfo.characterID = 71;
  second.element.isConnected = false;
  second.slots.save("ability_trigger");
  assert.deepEqual(h.requests.map(change => [change.id, change.slotType]), [[12,"equipment"],[13,"ability_trigger"]]);
  assert.match(second.card.state.notice, /配装已变化/);
});

test("compact settings keep the native checked state and update only the associated loadout", () => {
  const h = harness(), cards = h.grid().props.children.flat();
  const first = h.mountCard(cards[0]), second = h.mountCard(cards[1]);
  const options = h.find(first.slots.render(), node => node?.props?.className === "mwi-overview-options");
  assert.deepEqual(Array.from(options.props.children.flat(), wrapper => wrapper.props.title),
    ["设为默认配装", "缺失物品时不要提醒", "使用最高强化等级"]);
  const control = (card, label) => h.find(card.slots.render(), node => node?.props?.label === label);
  assert.equal(control(first, "默认").props.checked, true);
  assert.equal(control(second, "最高强化").props.checked, false);
  control(second, "默认").props.onChange({ target: { checked: true } });
  control(first, "缺失不提醒").props.onChange({ target: { checked: true } });
  control(second, "最高强化").props.onChange({ target: { checked: true } });
  h.controller.props.characterInfo.characterID = 72;
  control(first, "默认").props.onChange({ target: { checked: false } });
  assert.deepEqual(h.optionChanges, [
    { id: 13, name: "乙", isDefault: true, suppressValidation: false, useExactEnhancement: true },
    { id: 12, name: "甲", isDefault: true, suppressValidation: true, useExactEnhancement: false },
    { id: 13, name: "乙", isDefault: true, suppressValidation: false, useExactEnhancement: false }
  ]);
  assert.deepEqual(h.requests, []);
});

test("the native list can be restored and a changed game tree falls back to the native view", () => {
  const h = harness();
  const toggle = () => h.find(h.controller.output, node => node?.key === "mwi-overview-toggle");
  toggle().props.onClick();
  assert.equal(h.grid(), undefined);
  assert(h.find(h.controller.output, node => node?.props?.["data-loadout-id"] === 13));
  toggle().props.onClick();
  assert(h.grid());
  h.app.Overview.sync();
  assert(h.grid());
  h.controller.props.characterLoadoutDict[13].id = "unexpected";
  h.controller.forceUpdate();
  assert.equal(h.grid(), undefined);
  assert.deepEqual(h.requests, []);
});
