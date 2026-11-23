"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), Core = require("../scene_core.js");
test("native virtual preview isolates game state, shows unowned skills and removes game actions", () => {
  const h = (type, props, ...children) => ({ type, props: { ...props, children } });
  const React = { createElement: h, cloneElement: (node, props, ...children) => ({ ...node,
    props: { ...node.props, ...props, ...(children.length ? { children } : {}) } }),
    Children: { toArray: value => [value].flat(Infinity).filter(v => v != null) },
    Component: class { constructor(props) { this.props = props; } } };
  const part = (name, ...children) => h("div", { className: `LoadoutsPanel_${name}__fixture` }, ...children);
  let gameWrites = 0, mounted = 0, rendererProps;
  class NativePanel extends React.Component {
    constructor(props) { super(props); rendererProps = props; this.state = {}; }
    componentDidMount() { mounted++; }
    renderLoadout() {
      const raw = this.props.characterLoadoutDict[this.state.selectedCharacterLoadoutId];
      return part("selectedLoadout", part("details", part("setup",
        part("buttonsContainer", h("button", { onClick: this.props.loadLoadoutHandler }, "装备")),
        part("playerModel", h("NativeItem", {name:"头部",currentItem:{itemHrid:"/items/hood",enhancementLevel:7},selectItemHandler:this.props.updateLoadoutSlotHandler})),
        part("abilities", h("NativeAbility", {slotNumber:1,currentAbility:this.props.characterAbilityMap.get(raw.abilityMap[1]),equipAbilityHandler:this.props.updateLoadoutSlotHandler})),
        part("consumables", h("NativeConsumable", {slotIndex:0,consumableSlotTypeHrid:"/consumable_slot_types/drink",itemHrid:"/items/tea",addConsumableHandler:this.props.updateLoadoutSlotHandler})))));
    }
  }
  const app = { Core, Adapter: { describe: (_, __, value) => typeof value === "object" ? value.itemHrid +
    (Object.hasOwn(value,"enhancementLevel") ? "+"+value.enhancementLevel : "最高强化") : value || "空槽" } };
  vm.runInNewContext(fs.readFileSync(require.resolve("../virtual_preview.js"),"utf8"),{MWILoadoutScenes:app});
  const snapshot = Core.snapshot({id:71,name:"分享",actionTypeHrid:"/action_types/combat",useExactEnhancement:false,
    wearableMap:{},abilityMap:{1:"/abilities/shot"},foodItemHrids:[],drinkItemHrids:[]});
  const nativeProps = {characterLoadoutDict:{},characterAbilityMap:new Map(),characterSkillMap:new Map([["/skills/intelligence",{level:1}]]),
    characterItemMap:new Map(),updateLoadoutSlotHandler:()=>gameWrites++,loadLoadoutHandler:()=>gameWrites++};
  const Preview = app.makeVirtualPreview(React,NativePanel);
  const output = new Preview({snapshot,nativeProps}).render();
  const all = [];
  function walk(node) { if (!node?.props) return; all.push(node); React.Children.toArray(node.props.children).forEach(walk); }
  walk(output);
  assert.equal(all.some(n=>n.props.className?.includes("buttonsContainer")),false);
  const slots = all.filter(n=>n.props.className === "mwi-virtual-slot");
  assert.equal(slots.length,3); assert.match(slots[0].props.children[0].props.title,/最高强化/); assert.doesNotMatch(slots[0].props.children[0].props.title,/null/);
  for (const slot of slots) assert.equal(slot.props.children[0].props.children[0].props.inert,"");
  for (const node of all) for (const value of Object.values(node.props)) if(typeof value === "function") value();
  assert.equal(gameWrites,0); assert.equal(mounted,0);
  assert.equal(rendererProps.characterAbilityMap.get("/abilities/shot").abilityHrid,"/abilities/shot");
  assert.equal(nativeProps.characterAbilityMap.size,0);
  assert.equal(nativeProps.characterSkillMap.get("/skills/intelligence").level,1);
  assert.deepEqual(nativeProps.characterLoadoutDict,{});
});
