"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");

const overviewFixture = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
:root{--color-midnight-700:#1e2130;--color-midnight-500:#272c40;--color-midnight-300:#394464;--color-divider:#4c5677;--color-space-300:#7d87b0;--color-text-dark-mode:#f1f2fa;--radius-sm:8px}
*{box-sizing:border-box}
body{background:#131520;color:#f1f2fa;font:14px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;padding:18px}
main{max-width:1320px;margin:auto}
.LoadoutsPanel_loadoutsPanel__fixture{display:flex;flex-direction:column;gap:10px}
.LoadoutsPanel_mainView__fixture{display:flex;flex-direction:column;gap:8px}
.LoadoutsPanel_newLoadoutInputs__fixture{display:flex;gap:8px;align-items:center}
.LoadoutsPanel_newLoadoutInputs__fixture input{background:#12141e;color:#f1f2fa;border:1px solid #4c5677;border-radius:5px;padding:6px 10px}
.LoadoutsPanel_newLoadoutInputs__fixture button{background:#465bb3;color:#fff;border:0;border-radius:5px;padding:6px 12px;cursor:pointer}
.LoadoutsPanel_characterLoadouts__fixture{display:grid;gap:6px}
.LoadoutsPanel_characterLoadout__fixture{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#1e2130;border:1px solid #4c5677;border-radius:6px;cursor:pointer}
.LoadoutsPanel_selectedLoadout__fixture{display:flex;flex-direction:column;width:100%}
.LoadoutsPanel_details__fixture{display:flex;flex-direction:column;width:100%}
.LoadoutsPanel_setup__fixture{display:flex;flex-direction:column;gap:10px;padding:12px;background:#1e2130;border-radius:6px}
.LoadoutsPanel_playerModel__fixture{display:grid;grid-template-columns:repeat(5,var(--item-size-normal,52px));gap:4px;justify-content:center}
.LoadoutsPanel_gearSlot__fixture{width:var(--item-size-normal,52px);min-height:var(--item-size-normal,52px);background:#171a26;border:1px solid rgba(132,145,194,.32);border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3px;position:relative;font-size:11px;text-align:center}
.LoadoutsPanel_abilities__fixture,.LoadoutsPanel_consumables__fixture{display:grid;grid-template-columns:repeat(5,var(--item-size-normal,52px));gap:4px;justify-content:center}
.AbilitySlot_abilitySlot__fixture,.ConsumableSlot_consumableSlotContainer__fixture{width:var(--item-size-normal,52px);min-height:var(--item-size-normal,52px);background:#171a26;border:1px solid rgba(132,145,194,.32);border-radius:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3px;position:relative;font-size:11px;text-align:center}
.Item_itemContainer__fixture{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;position:relative}
.Item_iconContainer__fixture{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:4px;background:#2a314a;color:#e6ecff;font-size:11px;font-weight:600}
.ConsumableSlot_consumableSlotContainer__fixture .Item_empty__fixture .Item_iconContainer__fixture{opacity:.35}
.Item_count__fixture{position:absolute;bottom:-2px;left:0;font-size:10px;color:#b8c0dd;background:rgba(18,20,30,.85);padding:0 2px;border-radius:2px}
.Item_enhancement__fixture{position:absolute;top:-2px;left:0;font-size:10px;color:#9ecfff;font-weight:600}
.Ability_level__fixture{font-size:10px;color:#9ecfff}
.CombatTriggersSetting_combatTriggersSetting__fixture{position:absolute;bottom:2px;right:2px}
.CombatTriggersSetting_settingButton__fixture{background:#2d3452;color:#d6daf0;border:0;border-radius:3px;font-size:10px;padding:1px 3px;cursor:pointer}
.MuiFormControlLabel-root{display:inline-flex;align-items:center;gap:4px;cursor:pointer}
.MuiTypography-root{font-size:12.5px}
.cat-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:4px;background:#36426e;color:#d9e2ff;font-size:11px;flex:0 0 18px}
@media(max-width:520px){body{padding:10px}}
</style></head><body><main id="root"></main><script>
(function(){
  const createElement = (type, props, ...children) => ({
    type, key: props?.key ?? null,
    props: { ...props, children: children.length === 1 ? children[0] : children }
  });
  const cloneElement = (node, props, ...children) => ({
    ...node,
    key: props?.key ?? node.key,
    props: { ...node.props, ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) }
  });
  const Children = { toArray: v => [v].flat(Infinity).filter(x => x != null && typeof x !== "boolean") };

  let rootInstance = null, renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    queueMicrotask(() => { renderScheduled = false; rerenderRoot(); });
  }
  class Component {
    constructor(props) { this.props = props; this.state = {}; }
    setState(patch) { Object.assign(this.state, typeof patch === "function" ? patch(this.state, this.props) : patch); scheduleRender(); }
    forceUpdate() { scheduleRender(); }
  }
  const React = { createElement, cloneElement, Children, Component };

  function mountTree(vnode, parentFiber, prev) {
    if (vnode == null || typeof vnode === "boolean") return null;
    if (typeof vnode === "string" || typeof vnode === "number") {
      return { kind: "text", dom: document.createTextNode(String(vnode)), vnode };
    }
    if (typeof vnode.type === "function") {
      let inst;
      const reuse = prev && prev.kind === "comp" && prev.type === vnode.type && prev.key === vnode.key;
      if (reuse) {
        inst = prev.inst;
        const prevProps = inst.props, prevState = inst.state;
        inst.props = vnode.props;
        const fiber = { stateNode: inst, memoizedProps: vnode.props, return: parentFiber };
        const rendered = inst.render();
        const child = mountTree(rendered, fiber, prev.child);
        fiber.child = child?.fiber;
        return { kind: "comp", type: vnode.type, key: vnode.key, inst, fiber, child, dom: child?.dom, didUpdate: [prevProps, prevState] };
      }
      inst = new vnode.type(vnode.props);
      const fiber = { stateNode: inst, memoizedProps: vnode.props, return: parentFiber };
      const rendered = inst.render();
      const child = mountTree(rendered, fiber, null);
      fiber.child = child?.fiber;
      return { kind: "comp", type: vnode.type, key: vnode.key, inst, fiber, child, dom: child?.dom, didMount: true };
    }
    const reuse = prev && prev.kind === "host" && prev.type === vnode.type && prev.key === vnode.key;
    const isSvg = vnode.type === "svg" || vnode.type === "path" || vnode.type === "circle";
    const dom = reuse ? prev.dom : isSvg ? document.createElementNS("http://www.w3.org/2000/svg", vnode.type) : document.createElement(vnode.type);
    const fiber = { stateNode: dom, memoizedProps: vnode.props, return: parentFiber };
    dom.__reactFiber$fixture = fiber;
    const oldProps = reuse ? prev.props : {};
    const newProps = vnode.props || {};
    for (const k of Object.keys(oldProps)) {
      if (k === "children" || k === "key" || k === "ref" || k in newProps) continue;
      if (k.startsWith("on")) dom[k.toLowerCase()] = null;
      else if (k === "className") { if (isSvg) dom.removeAttribute("class"); else dom.className = ""; }
      else if (k === "style") dom.removeAttribute("style");
      else if (!isSvg && k in dom) dom[k] = false;
      else dom.removeAttribute(k);
    }
    for (const [k, v] of Object.entries(newProps)) {
      if (k === "children" || k === "key" || k === "ref") continue;
      if (k.startsWith("on")) {
        const ev = k === "onChange" && (vnode.type === "input" || vnode.type === "textarea") && newProps.type !== "checkbox" ? "oninput" : k.toLowerCase();
        dom[ev] = v;
      } else if (k === "className") {
        if (isSvg) dom.setAttribute("class", v || "");
        else if (dom.className !== (v || "")) dom.className = v || "";
      } else if (k === "style" && v && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) dom.style[sk] = sv == null ? "" : String(sv);
      } else if (k === "hidden" || k === "disabled" || k === "checked" || k === "required") {
        dom[k] = Boolean(v);
      } else if (k === "value") {
        if (dom.value !== String(v ?? "")) dom.value = String(v ?? "");
      } else if (k === "tabIndex") {
        dom.tabIndex = v;
      } else if (v === true) {
        dom.setAttribute(k, "");
      } else if (v === false || v == null) {
        dom.removeAttribute(k);
      } else {
        dom.setAttribute(k, String(v));
      }
    }
    if (typeof newProps.ref === "function") newProps.ref(dom);
    // Leave external Shadow DOM mount containers untouched by React reconciler.
    const kids = [];
    if (!Object.hasOwn(newProps, "data-mwi-overview-scenes")) {
      const nextChildren = Children.toArray(newProps.children);
      const prevMap = new Map();
      if (reuse) prev.kids.forEach((c, idx) => prevMap.set(c.key ?? ("@" + idx), c));
      let prevSiblingFiber = null;
      nextChildren.forEach((childNode, idx) => {
        const lookupKey = (typeof childNode === "object" && childNode?.key != null) ? childNode.key : ("@" + idx);
        const old = prevMap.get(lookupKey);
        if (old) prevMap.delete(lookupKey);
        const built = mountTree(childNode, fiber, old);
        if (built) {
          kids.push(built);
          if (built.fiber) {
            if (!fiber.child) fiber.child = built.fiber;
            if (prevSiblingFiber) prevSiblingFiber.sibling = built.fiber;
            prevSiblingFiber = built.fiber;
          }
        }
      });
      for (const leftover of prevMap.values()) unmountTree(leftover);
      const desired = kids.map(c => c.dom).filter(Boolean);
      const preserve = [...dom.children].filter(node => node.hasAttribute("data-mwi-scene-marker") || node.hasAttribute("data-mwi-overview-status"));
      desired.forEach((node, idx) => {
        const current = dom.childNodes[idx];
        if (current !== node) dom.insertBefore(node, current || null);
      });
      while (dom.childNodes.length > desired.length) {
        const last = dom.lastChild;
        if (preserve.includes(last)) break;
        dom.removeChild(last);
      }
      for (const p of preserve) if (p.parentNode !== dom) dom.append(p);
    }
    return { kind: "host", type: vnode.type, key: vnode.key, props: newProps, dom, fiber, kids };
  }
  function unmountTree(node) {
    if (!node) return;
    if (node.kind === "comp") { node.inst.componentWillUnmount?.(); unmountTree(node.child); }
    else if (node.kind === "host") { node.kids.forEach(unmountTree); }
  }
  function flushEffects(node) {
    if (!node) return;
    if (node.kind === "comp") {
      flushEffects(node.child);
      if (node.didMount) { node.didMount = false; node.inst.componentDidMount?.(); }
      else if (node.didUpdate) { const [pp, ps] = node.didUpdate; node.didUpdate = null; node.inst.componentDidUpdate?.(pp, ps); }
    } else if (node.kind === "host") {
      node.kids.forEach(flushEffects);
    }
  }

  const words = {
    "/items/bow": "银杏弓", "/items/hood": "远程兜帽", "/items/tunic": "远程皮甲",
    "/items/sword": "神圣剑", "/items/shield": "骑士盾", "/items/coffee": "远程咖啡",
    "/items/tea": "迅捷茶", "/items/yogurt": "桃子酸奶", "/items/cake": "蓝莓蛋糕",
    "/items/enhancing_tool": "神圣强化锤", "/items/milking_tool": "神圣挤奶桶",
    "/abilities/shot": "精准射击", "/abilities/heal": "治疗", "/abilities/slash": "重斩",
    "/combat_trigger_dependencies/self": "自身",
    "/combat_trigger_conditions/current_hp": "当前生命值",
    "/combat_trigger_comparators/less_than_equal": "小于或等于"
  };
  const h = React.createElement;
  const part = (name, props, ...kids) => h("div", { ...props, className: "LoadoutsPanel_" + name + "__fixture" + (props?.className ? " " + props.className : "") }, ...kids);
  const positions = {
    back:[1,1], head:[1,2], trinket:[1,3], main_hand:[2,1], off_hand:[2,3], body:[2,2],
    hands:[3,1], legs:[3,2], pouch:[3,3], feet:[4,2], neck:[1,5], earrings:[2,5], ring:[3,5], charm:[4,5],
    milking_tool:[7,1], foraging_tool:[7,2], woodcutting_tool:[7,3], cheesesmithing_tool:[7,4], crafting_tool:[7,5],
    tailoring_tool:[8,1], cooking_tool:[8,2], brewing_tool:[8,3], alchemy_tool:[8,4], enhancing_tool:[8,5]
  };
  const shortName = hrid => (words[hrid] || hrid?.split("/").pop() || "").slice(0, 2);

  class NativePanel extends React.Component {
    constructor(props) {
      super(props);
      this.state = { selectedCharacterLoadoutId: null };
      this.isDefaultChanged = e => this.saveOption("isDefault", e.target.checked);
      this.suppressValidationChanged = e => this.saveOption("suppressValidation", e.target.checked);
      this.useExactEnhancementChanged = e => this.saveOption("useExactEnhancement", !e.target.checked);
    }
    saveOption(key, val) {
      const row = this.props.characterLoadoutDict[this.state.selectedCharacterLoadoutId];
      this.props.updateLoadoutHandler({ ...row, [key]: val });
    }
    renderMainView() {
      const list = Object.values(this.props.characterLoadoutDict);
      return part("mainView", {},
        part("newLoadoutInputs", {}, h("input", { placeholder: "新配装名称" }), h("button", { type: "button" }, "新建配装")),
        part("characterLoadouts", {}, ...list.map(row =>
          part("characterLoadout", {
            key: row.id, "data-loadout-id": row.id,
            onClick: () => this.setState({ selectedCharacterLoadoutId: row.id })
          },
          h("span", { key: "h" }, "⋮⋮"),
          h("span", { key: "i", className: "cat-icon" }, row.actionTypeHrid === "/action_types/combat" ? "战" : "强"),
          row.name))));
    }
    renderLoadout() {
      const raw = this.props.characterLoadoutDict[this.state.selectedCharacterLoadoutId];
      const combat = raw.actionTypeHrid === "/action_types/combat";
      class MuiCheckbox extends React.Component {
        render() {
          return h("label", { className: "MuiFormControlLabel-root" },
            h("input", { type: "checkbox", checked: Boolean(this.props.checked), onChange: this.props.onChange }),
            h("span", { className: "MuiTypography-root" }, this.props.label));
        }
      }
      const checkbox = (label, checked, onChange) => part("metadata", {},
        h(MuiCheckbox, { label, checked, onChange }));

      const gearSlots = Object.entries(positions)
        .filter(([slot]) => !combat || !slot.endsWith("_tool"))
        .map(([slot, [r, c]]) => {
          const hash = raw.wearableMap["/item_locations/" + slot] || (slot === "main_hand" ? raw.wearableMap["/item_locations/two_hand"] : "");
          const parts = hash ? hash.split("::") : null;
          const currentItem = parts ? { itemHrid: parts[2], enhancementLevel: Number(parts[3]) } : null;
          return part("gearSlot", { key: slot, style: { gridRowStart: r, gridColumnStart: c } },
            h("div", {
              className: "Item_itemContainer__fixture",
              name: slot, currentItem,
              onClick: () => this.props.updateLoadoutSlotHandler({ id: raw.id, slotType: "equipment", slot })
            },
              currentItem ? h("span", { className: "Item_enhancement__fixture" }, "+" + currentItem.enhancementLevel) : null,
              h("span", { className: "Item_iconContainer__fixture" }, currentItem ? shortName(currentItem.itemHrid) : "空"),
              currentItem ? h("span", { className: "Item_count__fixture" }, "1") : null));
        });

      const abilityNodes = combat ? [1, 2, 3, 4, 5].map(slotNumber => {
        const abilityHrid = raw.abilityMap?.[slotNumber] || "";
        const currentAbility = abilityHrid ? (this.props.characterAbilityMap.get(abilityHrid) || { abilityHrid, level: 1 }) : null;
        return h("div", {
          key: "ab-" + slotNumber, className: "AbilitySlot_abilitySlot__fixture",
          slotNumber, currentAbility
        },
          h("span", { className: "Item_iconContainer__fixture" }, currentAbility ? shortName(abilityHrid) : "技" + slotNumber),
          currentAbility ? h("span", { className: "Ability_level__fixture" }, "Lv." + currentAbility.level) : null,
          h("div", { className: "CombatTriggersSetting_combatTriggersSetting__fixture" },
            h("button", { type: "button", className: "CombatTriggersSetting_settingButton__fixture" }, "⚙")));
      }) : [];

      const consumableKinds = combat ? ["food", "drink"] : raw.actionTypeHrid ? ["drink"] : [];
      const consumableNodes = consumableKinds.flatMap(kind => [0, 1, 2].map(slotIndex => {
        const itemHrid = raw[kind + "ItemHrids"]?.[slotIndex] || "";
        return h("div", {
          key: kind + "-" + slotIndex, className: "ConsumableSlot_consumableSlotContainer__fixture",
          slotIndex, consumableSlotTypeHrid: "/consumable_slot_types/" + kind, itemHrid
        },
          h("div", { className: "Item_itemContainer__fixture " + (itemHrid ? "Item_empty__fixture" : "") },
            h("span", { className: "Item_iconContainer__fixture" }, itemHrid ? shortName(itemHrid) : (kind === "food" ? "食" : "饮")),
            itemHrid ? h("span", { className: "Item_count__fixture" }, "0") : null),
          combat ? h("div", { className: "CombatTriggersSetting_combatTriggersSetting__fixture" },
            h("button", { type: "button", className: "CombatTriggersSetting_settingButton__fixture" }, "⚙")) : null);
      }));

      return part("selectedLoadout", {},
        part("details", {},
          checkbox("设为默认配装", raw.isDefault, this.isDefaultChanged),
          checkbox("缺失物品时不要提醒", raw.suppressValidation, this.suppressValidationChanged),
          checkbox("使用最高强化等级", !raw.useExactEnhancement, this.useExactEnhancementChanged),
          part("setup", {},
            part("buttonsContainer", {}, h("button", { type: "button" }, "装备")),
            part("equipment", {}, part("playerModel", {}, ...gearSlots)),
            combat ? part("abilities", {}, ...abilityNodes) : null,
            consumableNodes.length ? part("consumables", {}, ...consumableNodes) : null)));
    }
    render() {
      return part("loadoutsPanel", {},
        this.state.selectedCharacterLoadoutId === null ? this.renderMainView() : this.renderLoadout());
    }
  }

  localStorage.setItem("initClientData", JSON.stringify({
    enhancementLevelTotalBonusMultiplierTable: {
      0: 0, 1: 1, 2: 2.1, 3: 3.3, 4: 4.6, 5: 6, 6: 7.5, 7: 9.1, 8: 10.8, 9: 12.6, 10: 14.5,
      11: 16.7, 12: 19.2, 13: 22, 14: 25.1, 15: 28.5, 16: 32.2, 17: 36.2, 18: 40.5, 19: 45.1, 20: 50
    },
    itemDetailMap: {
      "/items/bow": {
        name: "Ginkgo Bow", itemLevel: 95, sortIndex: 1,
        equipmentDetail: {
          type: "/equipment_types/two_hand",
          levelRequirements: [{ skillHrid: "/skills/ranged", level: 95 }],
          combatStats: { attackInterval: 2400000000, combatStyleHrids: ["/combat_styles/ranged"], damageType: "/damage_types/physical", rangedAccuracy: 80, rangedDamage: 120 },
          combatEnhancementBonuses: { rangedAccuracy: 3, rangedDamage: 5 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/sword": {
        name: "Holy Sword", itemLevel: 100, sortIndex: 2,
        equipmentDetail: {
          type: "/equipment_types/main_hand",
          levelRequirements: [{ skillHrid: "/skills/melee", level: 100 }],
          combatStats: { attackInterval: 2200000000, combatStyleHrids: ["/combat_styles/slash"], damageType: "/damage_types/physical", slashAccuracy: 70, slashDamage: 105 },
          combatEnhancementBonuses: { slashAccuracy: 2.5, slashDamage: 4 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/shield": {
        name: "Knight Shield", itemLevel: 85, sortIndex: 3,
        equipmentDetail: {
          type: "/equipment_types/off_hand",
          levelRequirements: [{ skillHrid: "/skills/defense", level: 85 }],
          combatStats: { armor: 90, slashEvasion: 25 },
          combatEnhancementBonuses: { armor: 4 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/hood": {
        name: "Ranged Hood", itemLevel: 80, sortIndex: 4,
        equipmentDetail: {
          type: "/equipment_types/head",
          levelRequirements: [{ skillHrid: "/skills/ranged", level: 80 }],
          combatStats: { armor: 42, rangedAccuracy: 18, rangedEvasion: 24 },
          combatEnhancementBonuses: { armor: 2, rangedAccuracy: 1 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/tunic": {
        name: "Ranged Tunic", itemLevel: 80, sortIndex: 5,
        equipmentDetail: {
          type: "/equipment_types/body",
          levelRequirements: [{ skillHrid: "/skills/ranged", level: 80 }],
          combatStats: { armor: 65, rangedEvasion: 32 },
          combatEnhancementBonuses: { armor: 3 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/enhancing_tool": {
        name: "Holy Enhancer", itemLevel: 90, sortIndex: 6,
        equipmentDetail: {
          type: "/equipment_types/enhancing_tool",
          levelRequirements: [{ skillHrid: "/skills/enhancing", level: 90 }],
          noncombatStats: { enhancingSpeed: 0.2, enhancingSuccess: 0.05 },
          noncombatEnhancementBonuses: { enhancingSpeed: 0.01, enhancingSuccess: 0.002 }
        },
        enhancementCosts: [{ count: 1 }]
      },
      "/items/yogurt": {
        name: "Peach Yogurt", itemLevel: 70, sortIndex: 10, categoryHrid: "/item_categories/food",
        consumableDetail: {
          cooldownDuration: 20000000000, hitpointRestore: 420, recoveryDuration: 10000000000,
          usableInActionTypeMap: { "/action_types/combat": true }, defaultCombatTriggers: []
        }
      },
      "/items/cake": {
        name: "Blueberry Cake", itemLevel: 75, sortIndex: 11, categoryHrid: "/item_categories/food",
        consumableDetail: {
          cooldownDuration: 20000000000, manaRestore: 260, recoveryDuration: 10000000000,
          usableInActionTypeMap: { "/action_types/combat": true }, defaultCombatTriggers: []
        }
      },
      "/items/coffee": {
        name: "Ranged Coffee", itemLevel: 70, sortIndex: 12, categoryHrid: "/item_categories/drink",
        consumableDetail: {
          cooldownDuration: 60000000000,
          buffs: [{ typeHrid: "/buff_types/ranged_level", flatBoost: 8, duration: 300000000000 }],
          usableInActionTypeMap: { "/action_types/combat": true }, defaultCombatTriggers: []
        }
      },
      "/items/tea": {
        name: "Swiftness Tea", itemLevel: 65, sortIndex: 13, categoryHrid: "/item_categories/drink",
        consumableDetail: {
          cooldownDuration: 60000000000,
          buffs: [{ typeHrid: "/buff_types/action_speed", flatBoost: 0.1, duration: 300000000000 }],
          usableInActionTypeMap: { "/action_types/combat": true, "/action_types/enhancing": true }, defaultCombatTriggers: []
        }
      }
    },
    abilityDetailMap: {
      "/abilities/shot": {
        name: "Precision Shot", sortIndex: 1, isSpecialAbility: true,
        manaCost: 25, cooldownDuration: 15000000000, castDuration: 1500000000,
        abilityEffects: [{
          effectType: "/ability_effect_types/damage", targetType: "/ability_effect_target_types/enemy",
          combatStyleHrid: "/combat_styles/ranged", damageType: "/damage_types/physical",
          baseDamageFlat: 40, baseDamageFlatLevelBonus: 4, baseDamageRatio: 1.5, baseDamageRatioLevelBonus: 0.02
        }],
        defaultCombatTriggers: []
      },
      "/abilities/slash": {
        name: "Heavy Slash", sortIndex: 2, isSpecialAbility: true,
        manaCost: 20, cooldownDuration: 12000000000,
        abilityEffects: [{
          effectType: "/ability_effect_types/damage", targetType: "/ability_effect_target_types/enemy",
          combatStyleHrid: "/combat_styles/slash", damageType: "/damage_types/physical",
          baseDamageFlat: 35, baseDamageFlatLevelBonus: 3, baseDamageRatio: 1.4, baseDamageRatioLevelBonus: 0.02
        }],
        defaultCombatTriggers: []
      },
      "/abilities/heal": {
        name: "Heal", sortIndex: 3, isSpecialAbility: false,
        manaCost: 30, cooldownDuration: 20000000000,
        abilityEffects: [{
          effectType: "/ability_effect_types/heal", targetType: "/ability_effect_target_types/self",
          baseDamageFlat: 60, baseDamageFlatLevelBonus: 5
        }],
        defaultCombatTriggers: []
      }
    }
  }));

  const webpackModules = {
    0: { exports: React },
    1: { exports: { decompressFromUTF16: s => s, compressToUTF16: s => s } }
  };
  const chunks = [];
  chunks.push = probe => {
    const id = probe[2][0][0];
    const m = {};
    probe[1][id](m, {}, { c: webpackModules, m: {} });
    return Array.prototype.push.call(chunks, probe);
  };
  window.webpackJsonprpg_web = chunks;

  window.slotCalls = [];
  window.optionCalls = [];
  const loadouts = {
    12: {
      id: 12, name: "远程迷宫", actionTypeHrid: "/action_types/combat",
      isDefault: true, suppressValidation: false, useExactEnhancement: true,
      wearableMap: {
        "/item_locations/two_hand": "71::/item_locations/inventory::/items/bow::12",
        "/item_locations/head": "71::/item_locations/inventory::/items/hood::10",
        "/item_locations/body": "71::/item_locations/inventory::/items/tunic::8"
      },
      abilityMap: { 1: "/abilities/shot", 2: "/abilities/heal", 3: "", 4: "", 5: "" },
      foodItemHrids: ["/items/yogurt", "/items/cake", ""],
      drinkItemHrids: ["/items/coffee", "/items/tea", ""],
      abilityCombatTriggersMap: {
        "/abilities/shot": [{ dependencyHrid: "/combat_trigger_dependencies/self", conditionHrid: "/combat_trigger_conditions/current_hp", comparatorHrid: "/combat_trigger_comparators/less_than_equal", value: 80 }]
      },
      consumableCombatTriggersMap: {}
    },
    13: {
      id: 13, name: "强化冲级", actionTypeHrid: "/action_types/enhancing",
      isDefault: false, suppressValidation: true, useExactEnhancement: false,
      wearableMap: {
        "/item_locations/enhancing_tool": "71::/item_locations/inventory::/items/enhancing_tool::12",
        "/item_locations/milking_tool": "71::/item_locations/inventory::/items/milking_tool::8"
      },
      abilityMap: null, foodItemHrids: null, drinkItemHrids: ["/items/tea", "", ""]
    },
    14: {
      id: 14, name: "近战组队", actionTypeHrid: "/action_types/combat",
      isDefault: false, suppressValidation: false, useExactEnhancement: true,
      wearableMap: {
        "/item_locations/main_hand": "71::/item_locations/inventory::/items/sword::12",
        "/item_locations/off_hand": "71::/item_locations/inventory::/items/shield::10"
      },
      abilityMap: { 1: "/abilities/slash", 2: "/abilities/heal", 3: "", 4: "", 5: "" },
      foodItemHrids: ["/items/yogurt", "", ""],
      drinkItemHrids: ["/items/coffee", "", ""],
      abilityCombatTriggersMap: {},
      consumableCombatTriggersMap: {}
    }
  };

  window.overviewProps = {
    characterInfo: { characterID: 71, name: "测号甲" },
    characterLoadoutDict: loadouts,
    characterAbilityMap: new Map([["/abilities/shot", { abilityHrid: "/abilities/shot", level: 40 }], ["/abilities/heal", { abilityHrid: "/abilities/heal", level: 35 }], ["/abilities/slash", { abilityHrid: "/abilities/slash", level: 42 }]]),
    characterSkillMap: new Map([
      ["/skills/stamina", { level: 90, experience: 1000 }],
      ["/skills/intelligence", { level: 99, experience: 2000 }],
      ["/skills/attack", { level: 92, experience: 1100 }],
      ["/skills/melee", { level: 91, experience: 1200 }],
      ["/skills/defense", { level: 93, experience: 1300 }],
      ["/skills/ranged", { level: 98, experience: 1900 }],
      ["/skills/magic", { level: 88, experience: 900 }]
    ]),
    characterItemMap: new Map(),
    t: key => words[key.slice(key.indexOf(".") + 1)] || key,
    updateLoadoutSlotHandler: change => window.slotCalls.push(change),
    updateLoadoutHandler: change => {
      window.optionCalls.push(change);
      window.overviewProps.characterLoadoutDict[change.id] = change;
      scheduleRender();
    },
    loadLoadoutHandler: () => { throw Error("must never call loadLoadoutHandler"); }
  };

  const container = document.getElementById("root");
  function rerenderRoot() {
    const vnode = h(NativePanel, window.overviewProps);
    rootInstance = mountTree(vnode, null, rootInstance);
    window.controller = rootInstance.inst;
    if (container.firstChild !== rootInstance.dom) container.replaceChildren(rootInstance.dom);
    flushEffects(rootInstance);
  }
  rerenderRoot();
  window.rerenderOverview = rerenderRoot;
})();
</script></body></html>`;

module.exports = async function checkOverviewWorkspace(browser, content, root, pass) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  const remoteBoards = new Map();
  const sharedSnapshot = {
    schemaVersion: 1,
    raw: {
      id: 12, name: "大佬远程分享", actionTypeHrid: "/action_types/combat",
      isDefault: false, suppressValidation: false, useExactEnhancement: true,
      wearableMap: {
        "/item_locations/two_hand": "72::/item_locations/inventory::/items/bow::14",
        "/item_locations/head": "72::/item_locations/inventory::/items/hood::12"
      },
      abilityMap: { 1: "/abilities/shot", 2: "/abilities/heal", 3: "", 4: "", 5: "" },
      foodItemHrids: ["/items/yogurt", "", ""],
      drinkItemHrids: ["/items/coffee", "", ""],
      abilityCombatTriggersMap: {}, consumableCombatTriggersMap: {}
    }
  };
  remoteBoards.set("72loadout12", JSON.stringify({
    format: "mwi-layu-loadouts-cloud", version: 3, character: 72, loadoutId: 12,
    native: { snapshot: sharedSnapshot, updatedAt: Date.now() },
    scenes: [{
      id: "11111111-1111-4111-8111-111111111111",
      revision: "22222222-2222-4222-8222-222222222222",
      parentId: 12, name: "速刷变体", createdAt: 1, updatedAt: 2, removedAt: null,
      snapshot: { schemaVersion: 1, raw: { ...sharedSnapshot.raw, drinkItemHrids: ["/items/tea", "", ""] } }
    }],
    memories: []
  }));
  // Give loadout 14 an occupied board so we verify cloud warning badge & toolbar tally.
  remoteBoards.set("71loadout14", "not-loadout-json");

  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: overviewFixture }));
  await context.exposeFunction("mockOverviewClipboard", (method, url, payload) => {
    const name = url.split("/").pop();
    if (method === "PUT") remoteBoards.set(name, JSON.parse(payload).text_content);
    return {
      status: 200,
      responseText: JSON.stringify({ clip_name: name, has_password: false, files: [], text_content: remoteBoards.get(name) ?? null })
    };
  });
  await context.addInitScript({
    content: `window.GM_xmlhttpRequest=o=>window.mockOverviewClipboard(o.method,o.url,o.data).then(o.onload,o.onerror);` + content
  });

  try {
    const page = await context.newPage();
    page.on("pageerror", err => errors.push(err.message));
    await page.goto("https://www.milkywayidlecn.com/game");

    const grid = page.locator("[data-mwi-loadout-overview]");
    await grid.waitFor();
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 3);

    const card12 = page.locator('[data-mwi-overview-id="12"]');
    const card13 = page.locator('[data-mwi-overview-id="13"]');
    const card14 = page.locator('[data-mwi-overview-id="14"]');
    const host = page.locator("#mwi-loadout-scenes-host");

    // Create a scene on card 14 so its occupied cloud board surfaces a warning badge and toolbar tally.
    await card14.getByRole("button", { name: "近战组队的子方案" }).click();
    await card14.locator("#mwi-loadout-scenes-host").waitFor();
    await host.getByRole("button", { name: "新建子方案" }).click();
    await host.getByLabel("新子方案名称").fill("近战常驻");
    await host.getByRole("button", { name: "保存", exact: true }).click();
    await host.locator('.choices [data-scene-id][aria-pressed="true"]').filter({ hasText: "近战常驻" }).waitFor();

    const tally = page.locator(".mwi-overview-cloud-tally");
    await tally.filter({ hasText: "1 套配装待处理" }).waitFor();

    // Normal card 12 completely hides the cloud status button; warning card 14 displays compact amber warning badge.
    await page.waitForFunction(() => document.querySelector('[data-mwi-overview-id="12"] .mwi-overview-cloud-btn')?.dataset.state === "ok");
    assert.equal(await card12.locator(".mwi-overview-cloud-btn").isVisible(), false);
    assert.equal(await card12.locator(".mwi-overview-cloud-text").isVisible(), false);
    assert.equal(await card14.locator(".mwi-overview-cloud-text").isVisible(), true);
    assert.equal(await card14.locator(".mwi-overview-cloud-text").textContent(), "同步暂停");

    // Clicking toolbar warning tally jumps directly to card 14's Cloud tab.
    await tally.click();
    assert.equal(await card14.locator("#mwi-loadout-scenes-host").count(), 1);
    assert.equal(await host.getByRole("tab", { name: /云同步/ }).getAttribute("aria-selected"), "true");
    assert.equal(await host.locator(".cloud-panel").isVisible(), true);
    assert.equal(await host.getByRole("button", { name: "重新检查" }).isVisible(), true);

    // Open card 12's Scenes workspace directly in overview (never enters native detail).
    await card12.getByRole("button", { name: "远程迷宫的子方案" }).click();
    await card12.locator("#mwi-loadout-scenes-host").waitFor();
    assert.equal(await page.evaluate(() => controller.state.selectedCharacterLoadoutId), null);

    // Open card 12's Cloud tab: healthy card header keeps cloud button hidden, and copying share URL causes 0px layout shift.
    await host.getByRole("tab", { name: /云同步/ }).click();
    await host.locator(".cloud-panel").waitFor();
    assert.equal(await card12.locator(".mwi-overview-cloud-btn").isVisible(), false);
    await page.evaluate(() => {
      window.__copiedUrl = "";
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async text => { window.__copiedUrl = text; } }
      });
    });
    const beforeCopy = await page.evaluate(() => {
      const shadow = document.querySelector("#mwi-loadout-scenes-host").shadowRoot;
      const stats = shadow.querySelector(".cloud-stats").getBoundingClientRect().top;
      const setup = document.querySelector('[data-mwi-overview-id="12"] [class*="LoadoutsPanel_setup__"]').getBoundingClientRect().top;
      return { stats, setup };
    });
    await host.getByRole("button", { name: "复制地址" }).click();
    await host.getByRole("button", { name: "已复制" }).waitFor();
    const afterCopy = await page.evaluate(() => {
      const shadow = document.querySelector("#mwi-loadout-scenes-host").shadowRoot;
      const stats = shadow.querySelector(".cloud-stats").getBoundingClientRect().top;
      const setup = document.querySelector('[data-mwi-overview-id="12"] [class*="LoadoutsPanel_setup__"]').getBoundingClientRect().top;
      const feedbackHidden = shadow.querySelector(".cloud-feedback").hidden;
      return { stats, setup, feedbackHidden, copied: window.__copiedUrl };
    });
    assert.equal(afterCopy.copied, "https://clipboard.im/71loadout12");
    assert.equal(afterCopy.feedbackHidden, true);
    assert.equal(afterCopy.stats, beforeCopy.stats, "copying share URL must not shift .cloud-stats");
    assert.equal(afterCopy.setup, beforeCopy.setup, "copying share URL must not shift native equipment grid");
    await host.getByRole("tab", { name: "子方案" }).click();

    // Save a scene, edit card 12 native data, see slot highlights & markers inside card 12.
    await host.getByRole("button", { name: "新建子方案" }).click();
    await host.getByLabel("新子方案名称").fill("迷宫稳态");
    await host.getByRole("button", { name: "保存", exact: true }).click();
    await host.locator('.choices [data-scene-id][aria-pressed="true"]').filter({ hasText: "迷宫稳态" }).waitFor();
    // Card 12's scene count badge updates to 1, while card 13 with 0 scenes keeps its badge hidden.
    await card12.locator(".mwi-overview-scene-count").filter({ hasText: "1" }).waitFor();
    assert.equal(await card13.locator(".mwi-overview-scene-count").isVisible(), false);

    // Import mwi-vue-solo v2 combat loadout directly inside card 12.
    const soloPayload = JSON.stringify({
      format: "mwi-vue-solo", version: 2,
      player: {
        equipment: {
          two_hand: { itemHrid: "/items/bow", enhancementLevel: 14 },
          head: { itemHrid: "/items/hood", enhancementLevel: 10 },
          body: null
        },
        abilities: [{ abilityHrid: "/abilities/shot" }, { abilityHrid: "/abilities/heal" }, null, null, null],
        food: ["/items/yogurt", "", ""],
        drinks: ["/items/tea", "", ""],
        triggerMap: { "/abilities/shot": [] }
      }
    });
    await host.locator(".import-btn").click();
    await host.locator("#scene-import-name").fill("独狼速刷");
    await host.locator("#scene-import-text").fill(soloPayload);
    await host.getByRole("button", { name: "保存为子方案" }).click();
    await host.locator('.choices [data-scene-id][aria-pressed="true"]').filter({ hasText: "独狼速刷" }).waitFor();
    await host.locator("#summary").filter({ hasText: "项差异" }).waitFor();
    assert.ok(await card12.locator("[data-mwi-scene-change]").count() >= 4);
    assert.ok(await card12.locator("[data-mwi-scene-marker]").count() >= 4);
    await card12.locator(".mwi-overview-scene-count").filter({ hasText: "2" }).waitFor();

    // Save card 12 as local virtual loadout via the single unified More menu (no duplicate bottom button).
    await host.getByRole("button", { name: "更多操作" }).click();
    await host.locator("#scene-menu").getByRole("button", { name: "存为虚拟配装" }).click();
    const virtualSection = page.locator("#mwi-virtual-section");
    await virtualSection.locator(".mwi-virtual-card").first().waitFor();

    // Subscribe to 72loadout12 via on-demand subscribe bar.
    await virtualSection.getByRole("button", { name: "+ 订阅配装" }).click();
    await virtualSection.getByLabel("配装分享地址").fill("https://clipboard.im/72loadout12");
    await virtualSection.getByRole("button", { name: "订阅", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mwi-virtual-card").length === 2);

    // Verify virtual preview rules: counts hidden, empty consumables bright (opacity 1), trigger gears hidden.
    const previewChecks = await virtualSection.evaluate(root => {
      const counts = [...root.querySelectorAll('.mwi-virtual-native [class*="Item_count__"]')];
      const icons = [...root.querySelectorAll('.mwi-virtual-native [class*="ConsumableSlot_consumableSlotContainer__"] [class*="Item_empty__"] [class*="Item_iconContainer__"]')];
      const gears = [...root.querySelectorAll('.mwi-virtual-native [class*="CombatTriggersSetting_combatTriggersSetting__"]')];
      return {
        countsCount: counts.length,
        countsHidden: counts.every(n => getComputedStyle(n).display === "none"),
        iconsCount: icons.length,
        iconsBright: icons.every(n => getComputedStyle(n).opacity === "1"),
        gearsHidden: gears.every(n => getComputedStyle(n).display === "none")
      };
    });
    assert.ok(previewChecks.countsCount > 0 && previewChecks.countsHidden, "virtual preview hides counts");
    assert.ok(previewChecks.iconsCount > 0 && previewChecks.iconsBright, "virtual preview keeps icons bright");
    assert.ok(previewChecks.gearsHidden, "virtual preview hides trigger gears");

    // Switch pill on subscription card and adopt into card 12.
    const subCard = virtualSection.locator(".mwi-virtual-card").filter({ hasText: "大佬远程分享" });
    await subCard.getByRole("button", { name: "速刷变体" }).click();
    await subCard.getByRole("button", { name: "存为子方案" }).click();
    await subCard.getByLabel("保存到哪个原生配装").selectOption("12");
    await subCard.getByRole("button", { name: "保存为子方案" }).click();
    await subCard.getByText("已保存到「远程迷宫」的子方案").waitFor();
    await card12.locator(".mwi-overview-scene-count").filter({ hasText: "3" }).waitFor();

    // Capture wide (1440px) and narrow (390px) full-overview screenshots for visual verification.
    fs.mkdirSync(path.join(root, ".impeccable/review"), { recursive: true });
    async function captureOverview(width, height, name, afterResize) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      assert.equal(overflow, false, `no horizontal overflow at ${width}px`);
      const fullH = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ width, height: Math.max(height, fullH) });
      await page.evaluate(() => new Promise(r => { scrollTo(0, 0); requestAnimationFrame(() => requestAnimationFrame(r)); }));
      if (afterResize) await afterResize();
      await page.screenshot({ path: path.join(root, ".impeccable/review", name), animations: "disabled" });
      await page.setViewportSize({ width, height });
    }
    await captureOverview(1440, 960, "overview-desktop.png");
    await captureOverview(390, 844, "overview-mobile.png");
    await page.setViewportSize({ width: 1440, height: 960 });

    // Verify new UIs: Simulator Export drawer + Virtual Loadout Editor + Share/Import Share.
    await host.getByRole("button", { name: "更多操作" }).click();
    await host.locator("#scene-menu").getByRole("button", { name: "导出到模拟器" }).click();
    await host.locator(".sim-export").waitFor();
    await host.locator('.simulator-export-target[data-sim-target="shykai"]').click();
    await host.locator(".sim-result").waitFor();
    assert.equal(await host.locator('.simulator-export-target[data-sim-target="shykai"]').getAttribute("aria-pressed"), "true");
    assert.doesNotMatch(await host.locator(".sim-route").textContent(), /。。/);

    // Open Virtual Loadout Editor and configure slots + enhancement presets/slider + hover tooltips.
    await virtualSection.getByRole("button", { name: "+ 新建" }).click();
    const draftEditor = virtualSection.locator(".mwi-draft-editor");
    await draftEditor.waitFor();
    await draftEditor.getByLabel("配装名称").fill("测试虚拟弓");
    await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "远程兜帽" }).click();
    // Enhancement quick presets (0, 5, 7, 10, 12) + slider for arbitrary levels.
    for (const preset of ["+0", "+5", "+7", "+10", "+12"]) {
      assert.equal(await draftEditor.getByRole("button", { name: `强化 ${preset}`, exact: true }).isVisible(), true);
    }
    await draftEditor.getByRole("button", { name: "强化 +12", exact: true }).click();
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "12");
    await draftEditor.getByLabel("拖动选择强化等级").fill("15");
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "15");
    await draftEditor.getByRole("button", { name: "强化 +10", exact: true }).click();
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "10");

    // Hover equipment slot & candidate shows scaled stats tooltip.
    const tooltipEl = page.locator("#mwi-virtual-tooltip");
    await draftEditor.locator(".mwi-draft-slot").filter({ hasText: "远程兜帽" }).hover();
    await tooltipEl.waitFor({ state: "visible" });
    assert.match(await tooltipEl.textContent(), /远程兜帽.*\+10.*护甲/);

    await draftEditor.locator(".mwi-draft-slot").filter({ hasText: "主手" }).click();
    await draftEditor.getByRole("button", { name: "强化 +12", exact: true }).click();
    await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "银杏弓" }).click();
    await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "银杏弓" }).hover();
    await tooltipEl.waitFor({ state: "visible" });
    assert.match(await tooltipEl.textContent(), /银杏弓.*\+12.*远程伤害/);

    // Verify ability & food hover tooltips in editor too.
    await draftEditor.locator(".mwi-draft-slot").filter({ hasText: "特殊技能" }).click();
    await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "精准射击" }).hover();
    await tooltipEl.waitFor({ state: "visible" });
    assert.match(await tooltipEl.textContent(), /精准射击.*消耗 25 魔法.*冷却 15 秒/);
    await draftEditor.locator(".mwi-draft-slot").filter({ hasText: "食物 1" }).click();
    await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "桃子酸奶" }).hover();
    await tooltipEl.waitFor({ state: "visible" });
    assert.match(await tooltipEl.textContent(), /桃子酸奶.*生命恢复.*\+420/);

    // Leave bow selected and hover bow candidate for visual screenshot check of presets + slider + tooltip.
    await draftEditor.locator(".mwi-draft-slot").filter({ hasText: "银杏弓" }).click();
    await captureOverview(1440, 960, "new-ui-desktop.png", async () => {
      await draftEditor.locator(".mwi-draft-candidates button").filter({ hasText: "银杏弓" }).hover();
      await tooltipEl.waitFor({ state: "visible" });
    });
    await page.mouse.move(0, 0);
    await captureOverview(390, 844, "new-ui-mobile.png");

    await draftEditor.getByRole("button", { name: "保存虚拟配装" }).click();
    await draftEditor.waitFor({ state: "detached" });
    await page.waitForFunction(() => document.querySelectorAll(".mwi-virtual-card").length === 3);

    // Hovering read-only virtual preview slot also displays native-style detail tooltip.
    const createdCard = virtualSection.locator(".mwi-virtual-card").filter({ hasText: "测试虚拟弓" });
    await createdCard.locator('.mwi-virtual-slot [role="img"]').filter({ hasText: "远程" }).first().hover();
    await tooltipEl.waitFor({ state: "visible" });
    assert.match(await tooltipEl.textContent(), /远程兜帽.*\+10.*护甲/);
    await page.mouse.move(0, 0);

    // Fix 1: Re-opening existing virtual loadout reads actual head enhancement (+10), '+' increments to +11 (not +1).
    await createdCard.getByRole("button", { name: "编辑", exact: true }).click();
    await draftEditor.waitFor();
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "10");
    await draftEditor.getByLabel("强化加一级").click();
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "11");
    await draftEditor.getByLabel("配装名称").fill("测试虚拟弓草稿");

    // Fix 2: Reloading page while editor has dirty draft offers recovery banner and restores state.
    await page.reload();
    await grid.waitFor();
    await virtualSection.getByText("有未保存草稿「测试虚拟弓草稿」").waitFor();
    await virtualSection.getByRole("button", { name: "继续编辑" }).click();
    await draftEditor.waitFor();
    assert.equal(await draftEditor.getByLabel("配装名称").inputValue(), "测试虚拟弓草稿");
    assert.equal(await draftEditor.getByLabel("强化等级", { exact: true }).inputValue(), "11");
    await draftEditor.getByRole("button", { name: "保存虚拟配装" }).click();
    await draftEditor.waitFor({ state: "detached" });
    assert.equal(await virtualSection.getByText("有未保存草稿").count(), 0);

    // Fix 3: Share, undo removal, and batch virtual backup import/dedupe.
    const editedCard = virtualSection.locator(".mwi-virtual-card").filter({ hasText: "测试虚拟弓草稿" });
    await editedCard.getByRole("button", { name: "更多操作" }).click();
    await editedCard.getByRole("button", { name: "分享", exact: true }).click();
    const shareJson = await editedCard.getByLabel("虚拟配装分享内容").inputValue();
    assert.match(shareJson, /"format":"mwi-virtual-loadout"/);
    await editedCard.getByRole("button", { name: "关闭分享" }).click();

    await editedCard.getByRole("button", { name: "更多操作" }).click();
    await editedCard.getByRole("button", { name: "移除", exact: true }).click();
    await editedCard.getByRole("button", { name: "确认移除", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mwi-virtual-card").length === 2);
    await virtualSection.getByText("已移除“测试虚拟弓草稿”").waitFor();
    await virtualSection.getByRole("button", { name: "撤销", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mwi-virtual-card").length === 3);

    const backupJson = await page.evaluate(async () => {
      const entries = await MWILoadoutScenes.Virtual.list(71);
      return MWILoadoutScenes.Virtual.exportBackup(entries);
    });
    await virtualSection.getByRole("button", { name: "导入分享" }).click();
    await virtualSection.getByLabel("虚拟配装分享内容").fill(backupJson);
    await virtualSection.getByRole("button", { name: "导入为新配装" }).click();
    await virtualSection.getByText("内容均已存在，未重复导入").waitFor();

    await virtualSection.getByRole("button", { name: "导入分享" }).click();
    await virtualSection.getByLabel("虚拟配装分享内容").fill(shareJson);
    await virtualSection.getByRole("button", { name: "导入为新配装" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".mwi-virtual-card").length === 4);

    // Fix 6 + Keyboard UX: Overview search (Esc clears) and type filter work cleanly without overflow.
    const overviewSearch = page.getByLabel("搜索配装名称");
    await overviewSearch.fill("强化");
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 1);
    await overviewSearch.press("Escape");
    assert.equal(await overviewSearch.inputValue(), "");
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 3);
    await overviewSearch.fill("强化");
    await page.getByRole("button", { name: "清除搜索" }).click();
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 3);
    await page.getByRole("group", { name: "筛选配装类型" }).getByRole("button", { name: "生活" }).click();
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 1);
    await page.getByRole("group", { name: "筛选配装类型" }).getByRole("button", { name: "全部" }).click();
    assert.equal(await page.locator("[data-mwi-overview-id]").count(), 3);
    await captureOverview(1440, 960, "overview-desktop.png");
    await captureOverview(390, 844, "overview-mobile.png");
    await page.setViewportSize({ width: 1440, height: 960 });

    // Verify life loadout tool highlights in overview (shifted rows 6 & 7) and fold cleanup.
    await card13.getByRole("button", { name: "强化冲级的子方案" }).click();
    await card13.locator("#mwi-loadout-scenes-host").waitFor();
    assert.equal(await card12.locator("[data-mwi-scene-change]").count(), 0);
    await host.getByRole("button", { name: "新建子方案" }).click();
    await host.getByLabel("新子方案名称").fill("全工具");
    await host.getByRole("button", { name: "保存", exact: true }).click();
    await page.evaluate(() => {
      window.overviewProps.characterLoadoutDict[13].wearableMap["/item_locations/enhancing_tool"] = "";
      window.rerenderOverview();
    });
    await host.locator("#summary").filter({ hasText: "1 项差异" }).waitFor();
    assert.equal(await card13.locator("[data-mwi-scene-change]").count(), 1);
    assert.equal(await card13.locator("[data-mwi-scene-change]").evaluate(n => n.style.gridRowStart), "7");

    // Folding card 13 clears scene workspace and highlights cleanly.
    await card13.getByRole("button", { name: "收起强化冲级" }).click();
    await page.waitForFunction(() => !document.querySelector("#mwi-loadout-scenes-host"));
    assert.equal(await page.locator("[data-mwi-scene-change]").count(), 0);

    // Verify auto-filled preset loadout names across solo/group paste, choice switch, manual edit protection, file fallback, and submit fallback.
    await card12.getByRole("button", { name: "远程迷宫的子方案" }).click();
    await card12.locator("#mwi-loadout-scenes-host").waitFor();
    const basePlayer = (name, extra = {}) => ({
      name,
      equipment: {
        two_hand: { itemHrid: "/items/bow", enhancementLevel: 14 },
        head: { itemHrid: "/items/hood", enhancementLevel: 10 },
        body: null
      },
      abilities: [{ abilityHrid: "/abilities/shot" }, { abilityHrid: "/abilities/heal" }, null, null, null],
      food: ["/items/yogurt", "", ""],
      drinks: ["/items/tea", "", ""],
      triggerMap: { "/abilities/shot": [] },
      ...extra
    });
    const namedSoloPayload = JSON.stringify({
      format: "mwi-vue-solo", version: 2, loadoutName: "P1 远程·巫师之塔T0",
      player: basePlayer("测号甲")
    });
    const namedGroupPayload = JSON.stringify({
      format: "mwi-vue-group", version: 2, loadoutName: "3人·巫师之塔T0",
      players: [basePlayer("测号甲", { loadoutName: "主C·巫师T0" }), basePlayer("测号乙")]
    });
    await host.locator(".import-btn").click();
    // Instant parse on input auto-fills preset loadoutName (not character nickname).
    await host.locator("#scene-import-text").fill(namedSoloPayload);
    assert.equal(await host.locator("#scene-import-name").inputValue(), "P1 远程·巫师之塔T0");
    // Clearing text clears the untouched auto-filled name.
    await host.locator("#scene-import-text").fill("");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "");
    // Multi-player group updates name when switching choice, and respects manual overrides.
    await host.locator("#scene-import-text").fill(namedGroupPayload);
    await host.locator("#scene-import-choice").selectOption("1");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "主C·巫师T0");
    await host.locator("#scene-import-choice").selectOption("2");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "3人·巫师之塔T0");
    await host.locator("#scene-import-name").fill("手改名不被覆盖");
    await host.locator("#scene-import-choice").selectOption("1");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "手改名不被覆盖");
    await host.locator("#scene-import-name").fill("");
    // File upload prefers JSON loadoutName and falls back to filename only when JSON has no preset name.
    await host.getByLabel("选择模拟器配装文件").setInputFiles({
      name: "文件回退测试.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ format: "mwi-vue-solo", version: 2, loadoutName: "文件内预设名", player: basePlayer("测号甲") }))
    });
    await page.waitForFunction(() => document.querySelector("#mwi-loadout-scenes-host")?.shadowRoot.querySelector("#scene-import-name")?.value === "文件内预设名");
    await host.getByLabel("选择模拟器配装文件").setInputFiles({
      name: "纯模拟器文件.json", mimeType: "application/json",
      buffer: Buffer.from(soloPayload)
    });
    await page.waitForFunction(() => document.querySelector("#mwi-loadout-scenes-host")?.shadowRoot.querySelector("#scene-import-name")?.value === "纯模拟器文件");
    // Unnamed multi-player file retains filename fallback when choosing a player, and mixed-name file falls back to filename for unnamed player.
    await host.getByLabel("选择模拟器配装文件").setInputFiles({
      name: "外部3人组队文件.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        format: "mwi-vue-group", version: 2,
        players: [basePlayer("测号甲"), basePlayer("测号乙")]
      }))
    });
    await page.waitForFunction(() => document.querySelector("#mwi-loadout-scenes-host")?.shadowRoot.querySelector("#scene-import-name")?.value === "外部3人组队文件");
    await host.locator("#scene-import-choice").selectOption("1");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "外部3人组队文件");
    await host.getByLabel("选择模拟器配装文件").setInputFiles({
      name: "混合组队文件.json", mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({
        format: "mwi-vue-group", version: 2,
        players: [basePlayer("测号甲", { loadoutName: "单人专属名" }), basePlayer("测号乙")]
      }))
    });
    await page.waitForFunction(() => document.querySelector("#mwi-loadout-scenes-host")?.shadowRoot.querySelector("#scene-import-name")?.value === "混合组队文件");
    await host.locator("#scene-import-choice").selectOption("1");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "单人专属名");
    await host.locator("#scene-import-choice").selectOption("2");
    assert.equal(await host.locator("#scene-import-name").inputValue(), "混合组队文件");
    // Submitting unnamed external JSON with empty name shows validation error and focuses #scene-import-name after run() re-enables controls.
    await host.locator("#scene-import-text").fill(soloPayload);
    assert.equal(await host.locator("#scene-import-name").inputValue(), "");
    await host.getByRole("button", { name: "保存为子方案" }).click();
    await host.locator("#status").filter({ hasText: "请输入 1–60 字的子方案名称" }).waitFor();
    assert.equal(await host.locator("#scene-import-name").evaluate(node => node.getRootNode().activeElement === node), true);
    // Submit fallback uses suggestedName when name box is cleared, and duplicate name still fails safely.
    const fallbackSoloPayload = JSON.stringify({
      format: "mwi-vue-solo", version: 2, loadoutName: "P1 远程·兜底保存",
      player: basePlayer("测号甲")
    });
    await host.locator("#scene-import-text").fill(fallbackSoloPayload);
    assert.equal(await host.locator("#scene-import-name").inputValue(), "P1 远程·兜底保存");
    await host.locator("#scene-import-name").fill("");
    await host.getByRole("button", { name: "保存为子方案" }).click();
    await host.locator('.choices [data-scene-id][aria-pressed="true"]').filter({ hasText: "P1 远程·兜底保存" }).waitFor();
    await host.locator(".import-btn").click();
    await host.locator("#scene-import-text").fill(fallbackSoloPayload);
    assert.equal(await host.locator("#scene-import-name").inputValue(), "P1 远程·兜底保存");
    await host.getByRole("button", { name: "保存为子方案" }).click();
    await host.locator("#status").filter({ hasText: "已有同名子方案" }).waitFor();
    await host.locator('form[aria-label="导入配装为子方案"]').getByRole("button", { name: "取消", exact: true }).click();

    // Switching to native list restores drag-sortable rows cleanly.
    await page.getByRole("button", { name: "原生列表" }).click();
    assert.equal(await page.locator("[data-mwi-loadout-overview]").count(), 0);
    assert.equal(await page.locator('[data-loadout-id="12"]').count(), 1);

    assert.deepEqual(errors, []);
    pass("overview workspace, inline scenes/cloud tabs, solo v2 import, virtual loadouts/subscriptions, life tool highlights, fold cleanup, and 1440px/390px layouts all pass");
  } finally {
    await context.close();
  }
};
