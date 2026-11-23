(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPreview = function (React, NativePanel) {
    const h = React.createElement, noop = () => {};
    const children = node => React.Children.toArray(node?.props?.children);
    const part = (node, name) => node?.props?.className?.includes(`LoadoutsPanel_${name}__`);
    const child = (node, name) => children(node).find(node => part(node, name));
    function preview(snapshot, nativeProps) {
      const raw = { ...app.Core.validateSnapshot(snapshot).raw, missingItemLocationHridSet: {},
        missingFoodIndexSet: {}, missingDrinkIndexSet: {} };
      // Build a separate display model. Never replace the game's loadout dictionary or handlers.
      const props = { ...nativeProps };
      for (const key of Object.keys(props)) if (typeof props[key] === "function" && key !== "t") props[key] = noop;
      props.characterLoadoutDict = { [raw.id]: raw };
      props.characterAbilityMap = new Map(Object.values(raw.abilityMap || {}).filter(Boolean)
        .map(abilityHrid => [abilityHrid, { abilityHrid, level: 1, experience: 0 }]));
      props.characterSkillMap = new Map(nativeProps.characterSkillMap || []);
      // A viewer's locked slots must not hide skills in the shared configuration.
      props.characterSkillMap.set("/skills/intelligence", { level: 999, experience: 0 });
      props.characterItemMap = new Map();
      props.loadLoadoutHandler = noop;
      const renderer = new NativePanel(props);
      renderer.state = { ...renderer.state, selectedCharacterLoadoutId: raw.id };
      // This renderer is never mounted: it only produces the native slot tree.
      const shell = renderer.renderLoadout(), details = child(shell, "details"), setup = child(details, "setup");
      if (!setup) throw Error("原生配装布局暂不可用");
      function decorate(node) {
        if (!node || typeof node !== "object" || !node.props) return node;
        const p = node.props;
        let label;
        if ("currentItem" in p) {
          label = p.name + (p.currentItem ? "：" + app.Adapter.describe({ props: nativeProps },
            { kind: "equipment" }, { itemHrid: p.currentItem.itemHrid,
              ...(raw.useExactEnhancement ? { enhancementLevel: p.currentItem.enhancementLevel } : {}) }) : "：空槽");
        } else if ("slotNumber" in p && "currentAbility" in p) {
          label = "技能 " + p.slotNumber + "：" + app.Adapter.describe({ props: nativeProps }, { kind: "ability" }, p.currentAbility?.abilityHrid || null);
        } else if ("consumableSlotTypeHrid" in p) {
          label = (p.consumableSlotTypeHrid.endsWith("food") ? "食物 " : "饮料 ") + (p.slotIndex + 1) + "：" +
            app.Adapter.describe({ props: nativeProps }, { kind: "food" }, p.itemHrid || null);
        }
        if (label) {
          const safe = {};
          for (const [key, value] of Object.entries(p)) if (typeof value === "function") safe[key] = key === "getItemSelectionsFunc" ? () => [] : noop;
          safe.shouldCheckLevelRequirements = false;
          safe.shouldHideSelectedItemCount = true;
          return h("div", { key: node.key, className: "mwi-virtual-slot" },
            h("div", { title: label, "aria-label": label, role: "img", tabIndex: 0 },
              h("div", { inert: "", "aria-hidden": true }, React.cloneElement(node, safe))),
            p.combatTriggers && h("details", { className: "mwi-virtual-trigger" },
              h("summary", { "aria-label": label + "的触发条件" }, "⚙"),
              h("p", null, app.Adapter.describe({ props: nativeProps }, { kind: "ability_trigger" }, p.combatTriggers))));
        }
        return React.cloneElement(node, null, ...children(node).filter(node => !part(node, "buttonsContainer")).map(decorate));
      }
      // Preserve the native CSS ancestry: its grid rules are scoped through these wrappers.
      return React.cloneElement(shell, null, React.cloneElement(details, null, decorate(setup)));
    }
    return class NativePreview extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidUpdate(previous) {
        if (this.state.failed && previous.snapshot !== this.props.snapshot) this.setState({ failed: false });
      }
      render() {
        if (this.state.failed) return h("p", null, "图标预览暂不可用，请展开文字与触发条件查看。");
        let slots;
        try { slots = preview(this.props.snapshot, this.props.nativeProps); }
        catch (_) { return h("p", null, "图标预览暂不可用，请展开文字与触发条件查看。"); }
        return h("div", { className: "mwi-virtual-native" }, slots);
      }
    };
  };
})(globalThis);
