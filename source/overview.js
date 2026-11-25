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
  let runtime, showGrid = true, activeScene = null;

  function shortCloudWarning(info) {
    if (info.nativeMismatch) return "云端不同";
    if (info.conflicts) return "版本冲突";
    if (info.kind === "setup") return "需更新";
    if (info.kind === "blocked") return "同步暂停";
    if (info.kind === "error") return "同步重试";
    if (info.offline && info.warning) return "待联网";
    return info.label;
  }

  // One scene workspace at a time, scoped to the card rather than the game's
  // selected loadout. Read fresh props on every operation and never select a
  // native detail page just to access saved scenes.
  function currentScene() {
    if (!activeScene) return null;
    const { controller, owner: characterId, id, element, tab } = activeScene;
    const props = controller.props, panel = app.Adapter.visibleLoadoutPanel();
    if (!showGrid || controller.state.selectedCharacterLoadoutId !== null ||
        props.characterInfo?.characterID !== characterId || !props.characterLoadoutDict?.[id] ||
        !element.isConnected || !panel?.contains(element)) {
      activeScene = null; return null;
    }
    const sceneMount = element.querySelector("[data-mwi-overview-scenes]"),
      details = element.querySelector('[class*="LoadoutsPanel_details__"]'),
      setup = element.querySelector('[class*="LoadoutsPanel_setup__"]');
    if (!sceneMount || !details || !setup || !element.getClientRects().length) return null;
    const raw = app.Core.validate(props.characterLoadoutDict[id]);
    if (raw.id !== id) throw Error("配装数据已变化，请重新打开这张卡片的子方案。");
    const owner = `${root.location?.origin || ""}|${characterId}`;
    return {
      raw, owner, scope: `${owner}|${id}`, panel, details, setup, props, sceneMount,
      overview: true,
      overviewTab: tab || "scenes",
      setOverviewTab: nextTab => {
        if (!activeScene || activeScene.controller !== controller || activeScene.owner !== characterId || activeScene.id !== id) return;
        const normalized = nextTab === "cloud" ? "cloud" : "scenes";
        if (activeScene.tab !== normalized) {
          activeScene = { ...activeScene, tab: normalized };
          controller.forceUpdate();
        }
      },
      closeOverviewScenes: () => {
        if (!activeScene || activeScene.controller !== controller || activeScene.owner !== characterId || activeScene.id !== id) return;
        activeScene = null;
        controller.forceUpdate();
      }
    };
  }

  function notice(panel, message) {
    let node = panel.querySelector("[data-mwi-overview-status]");
    if (!message) { node?.remove(); return; }
    if (!node) {
      node = document.createElement("p");
      node.setAttribute("data-mwi-overview-status", "");
      node.setAttribute("role", "status");
      node.className = "mwi-overview-notice";
      panel.prepend(node);
    }
    if (node.textContent !== message) node.textContent = message;
  }

  // The game bundles React and its cache codec in webpack 4. Reuse the loaded
  // exports so its components keep their context and renderer in the same tree.
  function gameRuntime() {
    if (runtime) return runtime;
    const page = typeof unsafeWindow === "undefined" ? root : unsafeWindow;
    const chunks = page.webpackJsonprpg_web || root.webpackJsonprpg_web;
    if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
    const id = "mwi-layu-loadout-overview-runtime";
    const probe = [[], { [id]: (module, exports, require) => {
      try {
        const loaded = Object.values(require.c).map(entry => entry.exports);
        const React = loaded.find(value => typeof value?.createElement === "function" &&
          typeof value.cloneElement === "function" && typeof value.Component === "function" && value.Children);
        const codec = loaded.find(value => typeof value?.decompressFromUTF16 === "function" &&
          typeof value.compressToUTF16 === "function");
        const sprites = {};
        for (const value of loaded) {
          const path = typeof value === "string" ? value : typeof value?.default === "string" ? value.default : "";
          const match = /(?:^|\/)(items|abilities|skills)_sprite\.[^/]+\.svg$/.exec(path);
          if (match) sprites[match[1]] = path;
        }
        if (React) runtime = { React, codec, sprites };
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

  // Only the small status controls subscribe. An update never rerenders native slots.
  function makeCloudLabel(React) {
    const h = React.createElement;
    return class CloudLabel extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.owner !== this.props.owner || prev.ids !== this.props.ids) this.listen();
        else this.repaint();
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      repaint() {
        if (this.props.tally) this.paintTally(this.warningCount || 0);
        else if (this.lastInfo) this.paintCard(this.lastInfo);
      }
      listen() {
        this.unsubscribe?.();
        const { owner, ids } = this.props;
        const warnings = new Set();
        const idList = ids ? ids.split(",").filter(Boolean).map(Number) : [];
        const refresh = id => {
          const info = app.Cloud.info(owner, id);
          if (!this.props.tally) {
            this.lastInfo = info;
            this.paintCard(info);
            return;
          }
          if (info.warning) warnings.add(id);
          else warnings.delete(id);
          this.firstWarning = idList.find(entry => warnings.has(entry)) || null;
          this.warningCount = warnings.size;
          this.paintTally(warnings.size);
        };
        const stops = idList.map(id => {
          refresh(id);
          return app.Cloud.subscribe(owner, id, () => refresh(id));
        });
        if (!idList.length && this.props.tally) { this.warningCount = 0; this.paintTally(0); }
        this.unsubscribe = () => stops.forEach(stop => stop());
      }
      paintCard(info) {
        if (!this.label) return;
        const state = info.warning ? "warn" :
          info.kind === "busy" || info.kind === "pending" ? "busy" :
          info.kind === "ok" && !info.offline ? "ok" : "idle";
        const fullLabel = "云同步 · " + info.label;
        if (this.label.dataset) this.label.dataset.state = state;
        this.label.title = fullLabel;
        if (typeof this.label.setAttribute === "function") this.label.setAttribute("aria-label", fullLabel);
        this.label.classList.toggle("mwi-cloud-warning", info.warning);
        this.label.hidden = !info.warning;
        if (this.text) {
          const shortText = info.warning ? shortCloudWarning(info) : "";
          if (this.text.textContent !== shortText) this.text.textContent = shortText;
          this.text.hidden = !shortText;
        }
      }
      paintTally(count) {
        if (!this.label) return;
        const text = count ? count + " 套配装待处理" : "";
        if (this.label.textContent !== text) this.label.textContent = text;
        this.label.hidden = !text;
        this.label.classList.toggle("mwi-cloud-warning", count > 0);
      }
      render() {
        if (this.props.tally) {
          return h("button", {
            type: "button",
            className: "mwi-overview-cloud mwi-overview-cloud-tally",
            ref: node => { this.label = node; },
            onClick: () => { if (this.firstWarning != null) this.props.onJumpWarning?.(this.firstWarning); }
          });
        }
        return h("button", {
          type: "button",
          className: "mwi-overview-cloud-btn" + (this.props.active ? " mwi-overview-cloud-active" : ""),
          "aria-expanded": Boolean(this.props.active),
          onClick: this.props.onOpenCloud,
          ref: node => { this.label = node; }
        },
          h("svg", {
            className: "mwi-overview-cloud-icon", width: 15, height: 15, viewBox: "0 0 16 16",
            fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round",
            "aria-hidden": true
          },
            h("path", { d: "M4.5 12.25h7.25a2.75 2.75 0 0 0 .42-5.47A4 4 0 0 0 4.55 5.6 2.5 2.5 0 0 0 4.5 12.25Z" }),
            h("circle", { className: "mwi-overview-cloud-pip", cx: "13", cy: "3.5", r: "2.1", stroke: "none" })),
          h("span", { className: "mwi-overview-cloud-text", ref: node => { this.text = node; } }));
      }
    };
  }

  // Lightweight scene count badge: reads once per owner and updates via DOM ref without rerendering native slots.
  function makeSceneCount(React) {
    const h = React.createElement;
    return class SceneCount extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.ownerKey !== this.props.ownerKey || prev.id !== this.props.id) this.listen();
        else this.paint(this.props.tracker?.get(this.props.ownerKey, this.props.id) || 0);
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      paint = count => {
        if (!this.node) return;
        const text = count > 0 ? String(count) : "";
        if (this.node.textContent !== text) this.node.textContent = text;
        this.node.hidden = !text;
      };
      listen() {
        this.unsubscribe?.();
        const { tracker, ownerKey, id } = this.props;
        if (!tracker) return;
        this.paint(tracker.get(ownerKey, id));
        this.unsubscribe = tracker.subscribe(ownerKey, id, this.paint);
      }
      render() {
        return h("span", { className: "mwi-overview-scene-count", ref: node => { this.node = node; } });
      }
    };
  }

  function createCountTracker() {
    if (typeof app.Store?.counts !== "function") return null;
    const cache = new Map(), watchers = new Map();
    let activeOwner = "", loadingToken = 0;
    const notifyOwner = ownerKey => {
      const counts = cache.get(ownerKey) || new Map();
      const group = watchers.get(ownerKey);
      if (!group) return;
      for (const [id, fns] of group) {
        const count = counts.get(id) || 0;
        for (const fn of fns) fn(count);
      }
    };
    const refresh = ownerKey => {
      if (!ownerKey) return;
      activeOwner = ownerKey;
      const token = ++loadingToken;
      app.Store.counts(ownerKey).then(result => {
        if (token !== loadingToken && ownerKey === activeOwner) return;
        cache.set(ownerKey, result);
        notifyOwner(ownerKey);
      }).catch(() => { /* Badge counts are decorative; ignore storage read failures. */ });
    };
    app.Store.subscribe?.(scope => {
      const ownerKey = scope ? scope.slice(0, scope.lastIndexOf("|")) : activeOwner;
      if (ownerKey && watchers.has(ownerKey)) refresh(ownerKey);
    });
    if (typeof BroadcastChannel === "function") {
      try {
        const ch = new BroadcastChannel("mwi-layu-loadout-scenes");
        ch.addEventListener("message", event => {
          const scope = event.data?.scope;
          const ownerKey = scope ? scope.slice(0, scope.lastIndexOf("|")) : activeOwner;
          if (ownerKey && watchers.has(ownerKey)) refresh(ownerKey);
        });
      } catch (_) { /* Ignore unavailable BroadcastChannel. */ }
    }
    return {
      get: (ownerKey, id) => cache.get(ownerKey)?.get(id) || 0,
      subscribe(ownerKey, id, fn) {
        const firstForOwner = !watchers.has(ownerKey);
        if (firstForOwner) watchers.set(ownerKey, new Map());
        const group = watchers.get(ownerKey);
        if (!group.has(id)) group.set(id, new Set());
        group.get(id).add(fn);
        if (firstForOwner || !cache.has(ownerKey)) refresh(ownerKey);
        return () => {
          group.get(id)?.delete(fn);
          if (!group.get(id)?.size) group.delete(id);
          if (!group.size) watchers.delete(ownerKey);
        };
      }
    };
  }

  function makeCard(React, NativePanel, CloudLabel, SceneCount) {
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
        // React leaves this empty host's children to the existing scene UI.
        const scenes = this.props.overviewScenesOpen && h("div", {
          key: "scenes", id: `${overviewContentId}-scenes`, "data-mwi-overview-scenes": ""
        });
        return React.cloneElement(shell, null, React.cloneElement(details, { id: overviewContentId }, options, scenes, setup));
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
        const { id, name, icon, toggleScenes, toggleCard, nativeProps, overviewCollapsed, countTracker } = this.props;
        const { overviewContentId, overviewScenesOpen, overviewTab } = nativeProps;
        const toggleLabel = overviewCollapsed ? "展开" : "收起";
        const ownerId = nativeProps.characterInfo.characterID;
        const ownerKey = `${root.location?.origin || ""}|${ownerId}`;
        const scenesOpen = Boolean(overviewScenesOpen && overviewTab !== "cloud");
        const cloudOpen = Boolean(overviewScenesOpen && overviewTab === "cloud");
        const content = overviewCollapsed ? h("div", { id: overviewContentId, hidden: true })
          : this.state.failed ? h("p", { id: overviewContentId, className: "mwi-overview-notice", role: "status" }, "这套配装暂时无法展开，请刷新游戏后重试。")
            : h(NativeSlots, { ...nativeProps, updateLoadoutSlotHandler: this.updateSlot, updateLoadoutHandler: this.updateOptions });
        return h("article", {
          ref: this.rememberCard,
          className: "mwi-overview-card" + (overviewScenesOpen ? " mwi-overview-card-active" : "") + (overviewCollapsed ? " mwi-overview-card-collapsed" : ""),
          "data-mwi-overview-id": id,
          "aria-label": name
        },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null,
              h("button", {
                type: "button",
                className: "mwi-overview-fold",
                "aria-label": `${toggleLabel}${name}`,
                "aria-expanded": !overviewCollapsed,
                "aria-controls": overviewContentId,
                onClick: toggleCard
              },
                h("svg", {
                  className: "mwi-overview-chevron" + (!overviewCollapsed ? " is-open" : ""),
                  width: 12, height: 12, viewBox: "0 0 16 16",
                  fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round",
                  "aria-hidden": true
                }, h("path", { d: "M6 4l4 4-4 4" })),
                icon,
                h("span", { className: "mwi-overview-name" }, name))),
            h("div", { className: "mwi-overview-card-actions" },
              app.Cloud && h(CloudLabel, {
                owner: ownerId,
                ids: String(id),
                active: cloudOpen,
                onOpenCloud: () => toggleScenes(this.element, "cloud")
              }),
              h("button", {
                type: "button",
                className: "mwi-overview-button mwi-overview-scenes-btn" + (scenesOpen ? " mwi-overview-scenes-active" : ""),
                "aria-label": `${name}的子方案`,
                "aria-expanded": scenesOpen,
                "aria-controls": `${overviewContentId}-scenes`,
                onClick: () => toggleScenes(this.element, "scenes")
              }, "子方案", countTracker && h(SceneCount, { tracker: countTracker, ownerKey, id })))),
          content,
          !overviewCollapsed && this.state.notice && h("p", { className: "mwi-overview-notice", role: "status" }, this.state.notice));
      }
    };
  }

  function install(controller, panel, { React, codec, sprites }) {
    if (!(controller instanceof React.Component) || typeof controller.renderLoadout !== "function" ||
        typeof controller.renderMainView !== "function" || typeof controller.forceUpdate !== "function")
      throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    const render = controller.render;
    const CloudLabel = makeCloudLabel(React);
    const SceneCount = makeSceneCount(React);
    const countTracker = createCountTracker();
    const VirtualPanel = app.makeVirtualPanel?.(React, app.makeVirtualPreview?.(React, controller.constructor));
    const Card = makeCard(React, controller.constructor, CloudLabel, SceneCount);
    const mounted = { panel, requirements: readRequirements(codec) };
    let collapsed = new Set(), collapsedOwner, collapseSaveFailed = false;
    let virtualCountNode = null, virtualCount = 0;
    let filterQuery = "", filterType = "all";
    const h = React.createElement;

    function updateVirtualCount(count) {
      virtualCount = count || 0;
      if (!virtualCountNode) return;
      const text = virtualCount > 0 ? String(virtualCount) : "";
      if (virtualCountNode.textContent !== text) virtualCountNode.textContent = text;
      virtualCountNode.hidden = !text;
    }

    function changeCollapsed(owner, change) {
      const { characterInfo, characterLoadoutDict } = controller.props;
      if (!showGrid || owner !== collapsedOwner || owner !== characterInfo?.characterID) return;
      if (!collapseSaveFailed) collapsed = readCollapsed(owner) ?? collapsed;
      change(collapsed);
      if (activeScene?.controller === controller && collapsed.has(activeScene.id)) activeScene = null;
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

    function openCardPanel(owner, id, element, tab = "scenes") {
      if (!element || !currentCard(owner, id, element, { id })) return;
      const targetTab = tab === "cloud" ? "cloud" : "scenes";
      const sameCard = activeScene?.controller === controller && activeScene.owner === owner && activeScene.id === id;
      const closing = sameCard && activeScene.tab === targetTab;
      activeScene = closing ? null : { controller, owner, id, element, tab: targetTab };
      if (closing) controller.forceUpdate();
      else changeCollapsed(owner, ids => ids.delete(id));
    }

    function jumpToWarning(owner, id) {
      if (filterQuery || filterType !== "all") {
        filterQuery = "";
        filterType = "all";
        controller.forceUpdate();
      }
      const element = mounted.panel?.querySelector?.(`[data-mwi-overview-id="${id}"]`);
      if (!element) return;
      activeScene = { controller, owner, id, element, tab: "cloud" };
      changeCollapsed(owner, ids => ids.delete(id));
      element.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }

    function renderOverview(native) {
      const main = child(React, native, "mainView"), list = child(React, main, "characterLoadouts");
      if (!list) throw Error("配装总览未能识别当前列表，请更新脚本后刷新游戏。");
      const { props } = controller, owner = props.characterInfo?.characterID;
      if (!Number.isSafeInteger(owner) || owner <= 0 || typeof props.updateLoadoutSlotHandler !== "function")
        throw Error("配装总览所需数据尚未就绪，请重新打开配装页。");
      const rows = children(React, list);
      if (!rows.length && !VirtualPanel) return native;
      if (collapsedOwner !== owner) {
        collapsed = readCollapsed(owner) ?? new Set();
        collapsedOwner = owner;
        collapseSaveFailed = false;
        filterQuery = "";
        filterType = "all";
      }
      const cards = rows.map(row => {
        const id = row.props?.["data-loadout-id"], loadout = props.characterLoadoutDict[id];
        if (!Number.isSafeInteger(id) || loadout?.id !== id || typeof loadout.name !== "string" ||
            typeof row.props.onClick !== "function") throw Error("配装列表结构已变化");
        app.Cloud?.observeNative?.(owner, id, loadout);
        const overviewCollapsed = collapsed.has(id);
        const isCardActive = activeScene?.controller === controller && activeScene.owner === owner && activeScene.id === id;
        return h(Card, {
          key: `${owner}:${id}`, id, name: loadout.name, actionType: loadout.actionTypeHrid || "", overviewCollapsed,
          icon: children(React, row)[1],
          countTracker,
          toggleScenes: (element, tab = "scenes") => openCardPanel(owner, id, element, tab),
          toggleCard: () => changeCollapsed(owner, ids => {
            if (overviewCollapsed) ids.delete(id);
            else ids.add(id);
          }),
          nativeProps: {
            ...props,
            overviewId: id,
            overviewRequirements: mounted.requirements,
            overviewContentId: `mwi-loadout-content-${owner}-${id}`,
            overviewScenesOpen: isCardActive,
            overviewTab: isCardActive ? activeScene.tab : "scenes",
            overviewCanUpdateOptions: typeof props.updateLoadoutHandler === "function"
          },
          sendSlot: (element, change) => sendSlot(owner, id, element, change),
          sendOptions: (element, change) => sendOptions(owner, id, element, change)
        });
      });

      const hasCombat = cards.some(card => card.props.actionType === "/action_types/combat");
      const hasLife = cards.some(card => card.props.actionType !== "/action_types/combat");
      const query = filterQuery.trim().toLowerCase();
      const filtering = Boolean(query || filterType !== "all");
      const visibleCards = !filtering ? cards : cards.filter(card => {
        if (filterType === "combat" && card.props.actionType !== "/action_types/combat") return false;
        if (filterType === "life" && card.props.actionType === "/action_types/combat") return false;
        return !query || card.props.name.toLowerCase().includes(query);
      });

      const switchView = nextGrid => {
        if (showGrid === nextGrid) return;
        showGrid = nextGrid;
        activeScene = null;
        controller.forceUpdate();
      };
      const segmented = h("div", { key: "mwi-overview-segmented", className: "mwi-overview-segmented", role: "group", "aria-label": "配装视图" },
        h("button", {
          key: "mwi-overview-mode-grid", type: "button",
          className: "mwi-overview-seg-btn" + (showGrid ? " is-active" : ""),
          "aria-pressed": showGrid,
          onClick: () => switchView(true)
        }, "配装总览"),
        h("button", {
          key: "mwi-overview-toggle", type: "button",
          className: "mwi-overview-seg-btn" + (!showGrid ? " is-active" : ""),
          "aria-pressed": !showGrid,
          onClick: () => switchView(!showGrid)
        }, "原生列表"));

      const filterControls = showGrid && cards.length >= 2 && h("div", { key: "mwi-overview-filter", className: "mwi-overview-filter" },
        h("div", { className: "mwi-overview-search" + (filterQuery ? " has-value" : "") },
          h("svg", {
            className: "mwi-overview-search-icon", width: 13, height: 13, viewBox: "0 0 16 16",
            fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round",
            "aria-hidden": true
          },
            h("path", { d: "M7.25 12.25a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM13.75 13.75l-2.9-2.9" })),
          h("input", {
            key: "mwi-overview-search-input",
            type: "search",
            className: "mwi-overview-search-input",
            "aria-label": "搜索配装名称",
            placeholder: "搜索配装…",
            value: filterQuery,
            onKeyDown: e => {
              if (e.key === "Escape") {
                if (filterQuery) { filterQuery = ""; controller.forceUpdate(); }
                e.currentTarget?.blur?.();
              }
            },
            onChange: e => { filterQuery = e.target.value; controller.forceUpdate(); }
          }),
          filterQuery && h("button", {
            type: "button",
            className: "mwi-overview-search-clear",
            "aria-label": "清除搜索",
            onClick: () => { filterQuery = ""; controller.forceUpdate(); }
          }, "×")),
        hasCombat && hasLife && h("div", { className: "mwi-overview-filter-tabs", role: "group", "aria-label": "筛选配装类型" },
          [["all", "全部"], ["combat", "战斗"], ["life", "生活"]].map(([key, label]) => h("button", {
            key, type: "button",
            className: "mwi-overview-filter-tab" + (filterType === key ? " is-active" : ""),
            "aria-pressed": filterType === key,
            onClick: () => { filterType = key; controller.forceUpdate(); }
          }, label))));

      const allCollapsed = visibleCards.length > 0 && visibleCards.every(card => collapsed.has(card.props.id));
      const toggleAll = showGrid && visibleCards.length > 0 && h("button", {
        key: "mwi-overview-toggle-all", type: "button", className: "mwi-overview-button mwi-overview-ghost-btn",
        onClick: () => changeCollapsed(owner, ids => {
          for (const card of visibleCards) {
            if (allCollapsed) ids.delete(card.props.id);
            else ids.add(card.props.id);
          }
        })
      }, allCollapsed ? "全部展开" : "全部收起");

      const jumpVirtual = showGrid && VirtualPanel && h("button", {
        key: "mwi-overview-jump-virtual", type: "button", className: "mwi-overview-button mwi-overview-ghost-btn",
        onClick: () => mounted.panel?.querySelector?.("#mwi-virtual-section")?.scrollIntoView?.({ block: "start", behavior: "smooth" })
      }, "虚拟配装", h("span", {
        className: "mwi-overview-scene-count",
        hidden: !virtualCount,
        ref: node => { virtualCountNode = node; }
      }, virtualCount > 0 ? String(virtualCount) : ""));

      const toolbar = h("div", { key: "mwi-overview-toolbar", className: "mwi-overview-toolbar" },
        segmented,
        filterControls,
        h("div", { className: "mwi-overview-toolbar-right" },
          showGrid && app.Cloud && h(CloudLabel, {
            key: "sync", owner, ids: cards.map(card => card.props.id).join(","), tally: true,
            onJumpWarning: id => jumpToWarning(owner, id)
          }),
          jumpVirtual,
          toggleAll),
        showGrid && collapseSaveFailed && h("span", { className: "mwi-overview-toolbar-note", role: "status" }, "折叠状态未能保存，刷新后可能恢复之前的状态。"));

      const gridContent = visibleCards.length
        ? h("div", { key: "mwi-overview-grid", [marker]: "" }, visibleCards)
        : h("div", { key: "mwi-overview-empty", className: "mwi-overview-empty-filter", role: "status" },
            h("span", null, "没有匹配的配装"),
            h("button", {
              type: "button", className: "mwi-overview-button",
              onClick: () => { filterQuery = ""; filterType = "all"; controller.forceUpdate(); }
            }, "清除筛选"));

      const mainChildren = children(React, main).flatMap(entry => !hasClass(entry, "characterLoadouts") ? [entry] : [toolbar,
        showGrid ? gridContent : entry]);
      if (VirtualPanel) {
        mainChildren.push(h(VirtualPanel, {
          key: "virtual-" + owner,
          owner,
          nativeProps: props,
          getCatalog: () => app.VirtualDraft.catalog(codec, sprites),
          onCountChange: updateVirtualCount,
          nativeIcons: Object.fromEntries(rows.map(row => [props.characterLoadoutDict[row.props["data-loadout-id"]].actionTypeHrid || "", children(React, row)[1]]))
        }));
      }
      const updatedMain = React.cloneElement(main, null, mainChildren);
      return React.cloneElement(native, null, children(React, native)
        .map(entry => hasClass(entry, "mainView") ? updatedMain : entry));
    }

    if (typeof render !== "function") throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    controller.render = function () {
      const native = render.call(this);
      if (this.state.selectedCharacterLoadoutId !== null) return native;
      try {
        const result = renderOverview(native);
        mounted.failure = "";
        return result;
      } catch (_) {
        mounted.failure = "配装总览未能显示，已保留原生列表。请更新脚本后刷新游戏。";
        return native;
      }
    };
    installed.set(controller, mounted);
    controller.forceUpdate();
  }

  function sync() {
    let panel;
    try {
      panel = app.Adapter.visibleLoadoutPanel();
      if (!panel) return;
      if (!panel.querySelector('[class*="LoadoutsPanel_mainView__"]')) { notice(panel, ""); return; }
      const controller = app.Adapter.loadoutController(panel);
      if (!controller) { notice(panel, "配装总览尚未读取到游戏组件，请重新打开配装页。"); return; }
      const prior = installed.get(controller);
      if (prior) { prior.panel = panel; notice(panel, prior.failure || ""); }
      else if (controller.state.selectedCharacterLoadoutId === null) {
        const game = gameRuntime();
        if (game) { install(controller, panel, game); notice(panel, installed.get(controller)?.failure || ""); }
        else notice(panel, "配装总览未能访问游戏组件，请确认脚本管理器允许脚本在游戏页面运行，再刷新游戏。");
      }
    } catch (_) {
      if (panel) notice(panel, "配装总览初始化失败，已保留原生列表。请更新脚本后刷新游戏。");
    }
  }

  function start() {
    const style = document.createElement("style");
    style.id = "mwi-loadout-overview-style";
    style.textContent = css;
    document.head.append(style);
  }

  function itemDetails() {
    try {
      const game = gameRuntime();
      if (app.VirtualDraft?.catalog) return app.VirtualDraft.catalog(game?.codec, game?.sprites).items;
      const raw = root.localStorage.getItem("initClientData");
      if (!raw) return null;
      const text = raw.trimStart().startsWith("{") ? raw : game?.codec?.decompressFromUTF16(raw);
      return text ? JSON.parse(text).itemDetailMap || null : null;
    } catch (_) { return null; }
  }

  app.Overview = Object.freeze({ start, sync, currentScene, itemDetails });
})(globalThis);
