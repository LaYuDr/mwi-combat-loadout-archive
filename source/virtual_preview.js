(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPreview = function (React, NativePanel) {
    const h = React.createElement, noop = () => {};
    const children = node => React.Children.toArray(node?.props?.children);
    const part = (node, name) => node?.props?.className?.includes(`LoadoutsPanel_${name}__`);
    const child = (node, name) => children(node).find(node => part(node, name));
    function preview(snapshot, nativeProps, getCatalog) {
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
      const showTip = (event, kind, id, enhancement = 0) => {
        if (!id || !event?.currentTarget || !app.VirtualTooltip || typeof getCatalog !== "function") return;
        try {
          app.VirtualTooltip.show(event.currentTarget, { kind, id, enhancement, catalog: getCatalog(), nativeProps });
        } catch (_) { /* Catalog unavailable: fall back to native title attribute. */ }
      };
      const hideTip = event => { app.VirtualTooltip?.hide?.(event?.currentTarget); };
      function decorate(node) {
        if (!node || typeof node !== "object" || !node.props) return node;
        const p = node.props;
        let label, tipKind, tipId, tipEnh = 0;
        if ("currentItem" in p) {
          label = p.name + (p.currentItem ? "：" + app.Adapter.describe({ props: nativeProps },
            { kind: "equipment" }, { itemHrid: p.currentItem.itemHrid,
              ...(raw.useExactEnhancement ? { enhancementLevel: p.currentItem.enhancementLevel } : {}) }) : "：空槽");
          if (p.currentItem?.itemHrid) {
            tipKind = "equipment"; tipId = p.currentItem.itemHrid;
            tipEnh = raw.useExactEnhancement ? (p.currentItem.enhancementLevel || 0) : 0;
          }
        } else if ("slotNumber" in p && "currentAbility" in p) {
          label = "技能 " + p.slotNumber + "：" + app.Adapter.describe({ props: nativeProps }, { kind: "ability" }, p.currentAbility?.abilityHrid || null);
          if (p.currentAbility?.abilityHrid) { tipKind = "ability"; tipId = p.currentAbility.abilityHrid; }
        } else if ("consumableSlotTypeHrid" in p) {
          const isFood = p.consumableSlotTypeHrid.endsWith("food");
          label = (isFood ? "食物 " : "饮料 ") + (p.slotIndex + 1) + "：" +
            app.Adapter.describe({ props: nativeProps }, { kind: "food" }, p.itemHrid || null);
          if (p.itemHrid) { tipKind = isFood ? "food" : "drink"; tipId = p.itemHrid; }
        }
        if (label) {
          const safe = {};
          for (const [key, value] of Object.entries(p)) if (typeof value === "function") safe[key] = key === "getItemSelectionsFunc" ? () => [] : noop;
          safe.shouldCheckLevelRequirements = false;
          safe.shouldHideSelectedItemCount = true;
          const hoverProps = tipId ? {
            onMouseEnter: e => showTip(e, tipKind, tipId, tipEnh),
            onMouseLeave: hideTip,
            onFocus: e => showTip(e, tipKind, tipId, tipEnh),
            onBlur: hideTip
          } : {};
          return h("div", { key: node.key, className: "mwi-virtual-slot" },
            h("div", { title: label, "aria-label": label, role: "img", tabIndex: 0, ...hoverProps },
              h("div", { inert: "", "aria-hidden": true }, React.cloneElement(node, safe))));
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
        if (this.state.failed) return h("p", null, "图标预览暂不可用，请刷新游戏后重试。");
        let slots;
        try { slots = preview(this.props.snapshot, this.props.nativeProps, this.props.getCatalog); }
        catch (_) { return h("p", null, "图标预览暂不可用，请刷新游戏后重试。"); }
        return h("div", { className: "mwi-virtual-native" }, slots);
      }
    };
  };
})(globalThis);
