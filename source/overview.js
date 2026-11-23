(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  const css = "__OVERVIEW_CSS__";
  const marker = "data-mwi-loadout-overview";
  const collapseKey = owner => `mwi-layu:loadout-overview:collapsed:v1:${owner}`;
  const installed = new WeakMap();
  const slotTypes = new Set(["equipment", "ability", "food", "drink", "ability_trigger", "food_trigger", "drink_trigger"]);
  const optionLabels = [
    ["isDefaultChanged", "默认"],
    ["suppressValidationChanged", "缺失不提醒"],
    ["useExactEnhancementChanged", "最高强化"]
  ];
  let runtime, showGrid = true;

  // The game bundles React and its cache codec in webpack 4. Reuse the loaded
  // exports so its components keep their context and renderer in the same tree.
  function gameRuntime() {
    if (runtime) return runtime;
    const chunks = root.webpackJsonprpg_web;
    if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
    const id = "mwi-layu-loadout-overview-runtime";
    const probe = [[], { [id]: (module, exports, require) => {
      try {
        const loaded = Object.values(require.c).map(entry => entry.exports);
        const React = loaded.find(value => typeof value?.createElement === "function" &&
          typeof value.cloneElement === "function" && typeof value.Component === "function" && value.Children);
        const codec = loaded.find(value => typeof value?.decompressFromUTF16 === "function" &&
          typeof value.compressToUTF16 === "function");
        if (React) runtime = { React, codec };
      } finally {
        delete require.c[id];
        delete require.m[id];
      }
    } }, [[id]]];
    try { chunks.push(probe); } finally {
      const index = chunks.indexOf(probe);
      if (index !== -1) chunks.splice(index, 1);
    }
    return runtime;
  }

  function readRequirements(codec) {
    const requirements = new Map();
    try {
      const raw = root.localStorage.getItem("initClientData");
      if (!raw) return requirements;
      const text = raw.trimStart().startsWith("{") ? raw : codec?.decompressFromUTF16(raw);
      if (!text) return requirements;
      for (const [hrid, detail] of Object.entries(JSON.parse(text).itemDetailMap || {})) {
        const levels = detail?.equipmentDetail?.levelRequirements;
        if (!Array.isArray(levels)) continue;
        const maximum = levels.reduce((max, entry) => Number.isSafeInteger(entry?.level) ? Math.max(max, entry.level) : max, 0);
        if (maximum) requirements.set(hrid, maximum);
      }
    } catch (_) { /* A missing cache must not stop the game's native editor. */ }
    return requirements;
  }

  function readCollapsed(owner) {
    try {
      const ids = JSON.parse(root.localStorage.getItem(collapseKey(owner)));
      return new Set(Array.isArray(ids) ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : []);
    } catch (_) { return null; }
  }

  const hasClass = (node, name) => typeof node?.props?.className === "string" && node.props.className.includes(`LoadoutsPanel_${name}__`);
  const children = (React, node) => React.Children.toArray(node?.props?.children);
  const child = (React, node, name) => children(React, node).find(entry => hasClass(entry, name));

  function cardOptions(React, details, controller) {
    const controls = children(React, details).filter(entry => hasClass(entry, "metadata"))
      .flatMap(entry => children(React, entry));
    const options = optionLabels.map(([handler, label]) => {
      const control = controls.find(entry => typeof entry?.props?.onChange === "function" && entry.props.onChange === controller[handler]);
      return control && React.createElement("div", { key: handler, title: control.props.label }, React.cloneElement(control, { label }));
    });
    return options.every(Boolean) ? React.createElement("div", {
      className: "mwi-overview-options", role: "group", "aria-label": "配装选项"
    }, options) : null;
  }

  function cardSetup(React, shell, requirements) {
    const details = child(React, shell, "details"), setup = child(React, details, "setup");
    const equipment = child(React, setup, "equipment"), model = child(React, equipment, "playerModel");
    if (!model || !child(React, setup, "buttonsContainer")) throw Error("配装编辑区结构已变化");
    const slots = children(React, model);
    const updated = slots.map(slot => {
      const level = requirements.get(slot.props?.children?.props?.currentItem?.itemHrid);
      const position = slot.props?.style?.gridRowStart;
      const isTool = position === 7 || position === 8;
      if (!level && !isTool) return slot;
      const badge = level && React.createElement("span", {
        className: "mwi-overview-requirement", title: `装备需求等级 ${level}`, "aria-label": `装备需求等级 ${level}`
      }, level);
      return React.cloneElement(slot, {
        className: [slot.props.className, level && "mwi-overview-has-requirement"].filter(Boolean).join(" ") || undefined,
        style: isTool ? { ...slot.props.style, gridRowStart: position - 1 } : slot.props.style
      }, slot.props.children, badge || null);
    });
    if (slots.some(slot => slot.props?.style?.gridRowStart === 7)) {
      updated.push(React.createElement("div", { className: "mwi-overview-tools", key: "tools" }, "生活工具"));
    }
    const modelWithBadges = React.cloneElement(model, null, updated);
    const equipmentWithBadges = React.cloneElement(equipment, null, children(React, equipment)
      .map(entry => hasClass(entry, "playerModel") ? modelWithBadges : entry));
    const sections = children(React, setup).filter(entry => !hasClass(entry, "buttonsContainer"))
      .map(entry => hasClass(entry, "equipment") ? equipmentWithBadges : entry);
    return React.cloneElement(setup, null, sections);
  }

  // Only the small status labels subscribe. An update never rerenders native slots.
  function makeCloudLabel(React) {
    return class CloudLabel extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.owner !== this.props.owner || prev.ids !== this.props.ids) this.listen();
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      listen() {
        this.unsubscribe?.();
        const { owner, ids } = this.props;
        const warnings = new Set();
        const refresh = id => {
          const info = app.Cloud.info(owner, id);
          if (!this.props.tally) { this.paint("云同步 · " + info.label, info.warning); return; }
          if (info.warning) warnings.add(id);
          else warnings.delete(id);
          this.paint(warnings.size ? warnings.size + " 套配装待处理" : "", warnings.size > 0);
        };
        const stops = ids.split(",").map(Number).map(id => {
          refresh(id);
          return app.Cloud.subscribe(owner, id, () => refresh(id));
        });
        this.unsubscribe = () => stops.forEach(stop => stop());
      }
      paint(text, warning) {
        if (this.label.textContent !== text) this.label.textContent = text;
        this.label.hidden = !text;
        this.label.classList.toggle("mwi-cloud-warning", warning);
      }
      render() {
        return React.createElement("span", { className: "mwi-overview-cloud", ref: node => { this.label = node; } });
      }
    };
  }

  function makeCard(React, NativePanel, CloudLabel) {
    const h = React.createElement;
    class NativeSlots extends NativePanel {
      constructor(props) {
        super(props);
        // This instance owns exactly one ID. Native slot handlers close over
        // this state, independently of the page selection and the other cards.
        this.state = { ...this.state, selectedCharacterLoadoutId: props.overviewId };
      }
      componentDidUpdate() { /* The list owns this card's lifetime. */ }
      render() {
        const shell = this.renderLoadout();
        if (!hasClass(shell, "selectedLoadout")) throw Error("配装详情结构已变化");
        const { overviewContentId, overviewRequirements } = this.props;
        const details = child(React, shell, "details");
        const options = this.props.overviewCanUpdateOptions && cardOptions(React, details, this);
        const setup = cardSetup(React, shell, overviewRequirements);
        return React.cloneElement(shell, null, React.cloneElement(details, { id: overviewContentId }, options, setup));
      }
    }
    // Keep a malformed native card from taking down the surrounding game UI.
    return class OverviewCard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false, notice: "" };
      }
      static getDerivedStateFromError() { return { failed: true }; }
      rememberCard = element => { this.element = element; };
      update(send, change) {
        if (!this.element) return;
        const notice = send(this.element, change) ? "" : "配装已变化，请重新打开配装页。";
        if (notice !== this.state.notice) this.setState({ notice });
      }
      updateSlot = change => this.update(this.props.sendSlot, change);
      updateOptions = change => this.update(this.props.sendOptions, change);
      render() {
        const { id, name, icon, openDetails, toggleCard, nativeProps, overviewCollapsed } = this.props;
        const { overviewContentId } = nativeProps;
        const toggleLabel = overviewCollapsed ? "展开" : "收起";
        const content = overviewCollapsed ? h("div", { id: overviewContentId, hidden: true })
          : this.state.failed ? h("p", { id: overviewContentId, className: "mwi-overview-notice", role: "status" }, "这套配装暂时无法展开，可以打开详情编辑。")
            : h(NativeSlots, { ...nativeProps, updateLoadoutSlotHandler: this.updateSlot, updateLoadoutHandler: this.updateOptions });
        return h("article", { ref: this.rememberCard, className: "mwi-overview-card", "data-mwi-overview-id": id, "aria-label": name },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null, icon, name),
            h("button", { type: "button", className: "mwi-overview-button",
              "aria-label": `${toggleLabel}${name}`, "aria-expanded": !overviewCollapsed, "aria-controls": overviewContentId, onClick: toggleCard }, toggleLabel),
            h("button", { type: "button", className: "mwi-overview-button", "aria-label": `${name}的详情和子方案`, onClick: openDetails }, "详情"),
            app.Cloud && h(CloudLabel, { owner: nativeProps.characterInfo.characterID, ids: String(id) })),
          content, !overviewCollapsed && this.state.notice && h("p", { className: "mwi-overview-notice", role: "status" }, this.state.notice));
      }
    };
  }

  function install(controller, panel, { React, codec }) {
    if (!(controller instanceof React.Component) || typeof controller.renderLoadout !== "function" ||
        typeof controller.renderMainView !== "function" || typeof controller.forceUpdate !== "function") return;
    const render = controller.render;
    const CloudLabel = makeCloudLabel(React);
    const VirtualPanel = app.makeVirtualPanel?.(React);
    const Card = makeCard(React, controller.constructor, CloudLabel);
    const mounted = { panel, requirements: readRequirements(codec) };
    let collapsed = new Set(), collapsedOwner, collapseSaveFailed = false;
    const h = React.createElement;

    function changeCollapsed(owner, change) {
      const { characterInfo, characterLoadoutDict } = controller.props;
      if (!showGrid || owner !== collapsedOwner || owner !== characterInfo?.characterID) return;
      // Use the latest saved choices so edits in another tab are preserved.
      if (!collapseSaveFailed) collapsed = readCollapsed(owner) ?? collapsed;
      change(collapsed);
      for (const id of collapsed) if (!Object.hasOwn(characterLoadoutDict, id)) collapsed.delete(id);
      try {
        root.localStorage.setItem(collapseKey(owner), JSON.stringify([...collapsed]));
        collapseSaveFailed = false;
      } catch (_) { collapseSaveFailed = true; }
      controller.forceUpdate();
    }

    function currentCard(owner, id, element, change) {
      const { props, state } = controller;
      return showGrid && state.selectedCharacterLoadoutId === null && owner === props.characterInfo?.characterID &&
        props.characterLoadoutDict?.[id]?.id === id && change?.id === id &&
        element.isConnected && mounted.panel.contains(element) && element.getClientRects().length;
    }

    function sendSlot(owner, id, element, change) {
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || !slotTypes.has(change.slotType) ||
          typeof controller.props.updateLoadoutSlotHandler !== "function") return false;
      controller.props.updateLoadoutSlotHandler(change);
      return true;
    }

    function sendOptions(owner, id, element, change) {
      const { props } = controller;
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || typeof props.updateLoadoutHandler !== "function" ||
          change.name !== props.characterLoadoutDict[id].name ||
          ![change.isDefault, change.suppressValidation, change.useExactEnhancement].every(value => typeof value === "boolean")) return false;
      props.updateLoadoutHandler(change);
      return true;
    }

    function renderOverview(native) {
      const main = child(React, native, "mainView"), list = child(React, main, "characterLoadouts");
      if (!list) return native;
      const { props } = controller, owner = props.characterInfo?.characterID;
      if (!Number.isSafeInteger(owner) || owner <= 0 || typeof props.updateLoadoutSlotHandler !== "function") return native;
      const rows = children(React, list);
      if (!rows.length && !VirtualPanel) return native;
      if (collapsedOwner !== owner) {
        collapsed = readCollapsed(owner) ?? new Set();
        collapsedOwner = owner;
        collapseSaveFailed = false;
      }
      const cards = rows.map(row => {
        const id = row.props?.["data-loadout-id"], loadout = props.characterLoadoutDict[id];
        if (!Number.isSafeInteger(id) || loadout?.id !== id || typeof loadout.name !== "string" ||
            typeof row.props.onClick !== "function") throw Error("配装列表结构已变化");
        const overviewCollapsed = collapsed.has(id);
        return h(Card, {
          key: `${owner}:${id}`, id, name: loadout.name, overviewCollapsed,
          icon: children(React, row)[1], openDetails: row.props.onClick,
          toggleCard: () => changeCollapsed(owner, ids => {
            if (overviewCollapsed) ids.delete(id);
            else ids.add(id);
          }),
          nativeProps: { ...props, overviewId: id, overviewRequirements: mounted.requirements,
            overviewContentId: `mwi-loadout-content-${owner}-${id}`,
            overviewCanUpdateOptions: typeof props.updateLoadoutHandler === "function" },
          sendSlot: (element, change) => sendSlot(owner, id, element, change),
          sendOptions: (element, change) => sendOptions(owner, id, element, change)
        });
      });
      const toggle = h("button", {
        key: "mwi-overview-toggle", type: "button", className: "mwi-overview-button",
        onClick: () => { showGrid = !showGrid; controller.forceUpdate(); }
      }, showGrid ? "原生列表" : "配装总览");
      const allCollapsed = cards.every(card => collapsed.has(card.props.id));
      const toggleAll = showGrid && h("button", {
        key: "mwi-overview-toggle-all", type: "button", className: "mwi-overview-button",
        onClick: () => changeCollapsed(owner, ids => {
          for (const card of cards) {
            if (allCollapsed) ids.delete(card.props.id);
            else ids.add(card.props.id);
          }
        })
      }, allCollapsed ? "全部展开" : "全部收起");
      const toolbar = h("div", { key: "mwi-overview-toolbar", className: "mwi-overview-toolbar" }, toggle, toggleAll,
        showGrid && app.Cloud && h(CloudLabel, { key: "sync", owner, ids: cards.map(card => card.props.id).join(","), tally: true }),
        showGrid && collapseSaveFailed && h("span", { role: "status" }, "折叠状态未能保存，刷新后可能恢复之前的状态。"));
      const mainChildren = children(React, main).flatMap(entry => !hasClass(entry, "characterLoadouts") ? [entry] : [toolbar,
        showGrid ? h("div", { key: "mwi-overview-grid", [marker]: "" }, cards) : entry]);
      if (VirtualPanel) mainChildren.push(h(VirtualPanel, { key: "virtual-" + owner, owner, nativeProps: props }));
      const updatedMain = React.cloneElement(main, null, mainChildren);
      return React.cloneElement(native, null, children(React, native)
        .map(entry => hasClass(entry, "mainView") ? updatedMain : entry));
    }

    if (typeof render !== "function") return;
    controller.render = function () {
      const native = render.call(this);
      if (this.state.selectedCharacterLoadoutId !== null) return native;
      try { return renderOverview(native); }
      catch (_) { return native; }
    };
    installed.set(controller, mounted);
    controller.forceUpdate();
  }

  function sync() {
    try {
      const panel = app.Adapter.visibleLoadoutPanel();
      if (!panel?.querySelector('[class*="LoadoutsPanel_mainView__"]')) return;
      const controller = app.Adapter.loadoutController(panel);
      if (!controller) return;
      const prior = installed.get(controller);
      if (prior) prior.panel = panel;
      else if (controller.state.selectedCharacterLoadoutId === null) {
        const game = gameRuntime();
        if (game) install(controller, panel, game);
      }
    } catch (_) { /* Keep the native list usable if a game update changes the integration. */ }
  }

  function start() {
    const style = document.createElement("style");
    style.id = "mwi-loadout-overview-style";
    style.textContent = css;
    document.head.append(style);
  }

  app.Overview = Object.freeze({ start, sync });
})(globalThis);
