(function (root) {
  "use strict";
  if (!/^(www\.)?milkywayidle(cn)?\.com$/.test(location.hostname) || !/^\/game\/?$/.test(location.pathname)) return;
  const app = root.MWILoadoutScenes;
  if (app.started) return;
  app.started = true;
  const { Core, Adapter, Store } = app;
  const css = "__SCENE_CSS__";
  let mounted = null, context = null, rows = [], selectedId = null, busy = false, undo = null, confirmation = null;
  let last = "", loading = 0, failure = "", highlighted = [], highlightedSlots = [], comparingSetup = null, unresolved = [];
  const markers = new Map(), pickerGuides = new Map(), scrolledPickers = new WeakMap();
  let menuId = null, pickerHighlights = [], prefilledHighlights = [], activeTab = "scenes", diffOpen = false;
  let cachedDiffKey = "", cachedDiff = null, pickerFrame = 0;
  const pickerSelector = '[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"], [class*="CombatTriggersSetting_combatTriggersEditMenu__"], ul[role="listbox"]';
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("mwi-layu-loadout-scenes") : null;

  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function button(text, handler, attrs = {}) {
    const node = el("button", text, { type: "button", ...attrs });
    node.addEventListener("click", handler);
    return node;
  }
  function svgIcon(kind) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("aria-hidden", "true");
    if (kind === "add") svg.innerHTML = '<path d="M8 3v10M3 8h10"/>';
    else if (kind === "more") svg.innerHTML = '<circle cx="3.2" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.8" cy="8" r="1.1" fill="currentColor" stroke="none"/>';
    else if (kind === "close") svg.innerHTML = '<path d="M4 4l8 8M12 4l-8 8"/>';
    else if (kind === "caret") svg.innerHTML = '<path d="M4.5 6.25L8 9.75l3.5-3.5"/>';
    return svg;
  }
  const activeRows = () => rows.filter(row => !row.removedAt).sort((a, b) => a.createdAt - b.createdAt);
  const selected = () => activeRows().find(row => row.id === selectedId);
  const isCombat = ctx => ctx?.raw?.actionTypeHrid === "/action_types/combat";

  let messageTimer = null;
  function message(text, error = false) {
    if (!mounted) return;
    clearTimeout(messageTimer);
    mounted.status.textContent = text;
    mounted.status.classList.toggle("error", error);
    mounted.status.hidden = !text;
    mounted.retry.hidden = !error;
    mounted.notice.hidden = !text && !undo;
    if (text && !error && !undo) {
      messageTimer = setTimeout(() => {
        if (mounted && mounted.status.textContent === text && !undo) {
          mounted.status.textContent = "";
          mounted.status.hidden = true;
          mounted.notice.hidden = true;
        }
      }, 2800);
    }
  }
  function clearHighlights() {
    for (const element of highlighted) {
      element.removeAttribute("data-mwi-scene-change");
      element.removeAttribute("data-mwi-scene-pulse");
    }
    highlighted = [];
    for (const element of highlightedSlots) element.removeAttribute("data-mwi-scene-slot-change");
    highlightedSlots = [];
    comparingSetup?.removeAttribute("data-mwi-scene-comparing");
    comparingSetup = null;
    unresolved = [];
    for (const node of pickerHighlights) node.removeAttribute("data-mwi-scene-target");
    pickerHighlights = [];
    for (const node of prefilledHighlights) node.removeAttribute("data-mwi-scene-prefilled");
    prefilledHighlights = [];
    for (const { node } of pickerGuides.values()) node.remove();
    pickerGuides.clear();
    for (const { host } of markers.values()) host.remove();
    markers.clear();
  }
  function detach() {
    app.Cloud.setActive(null);
    loading++;
    clearTimeout(messageTimer);
    clearHighlights();
    mounted?.host.remove();
    mounted = null;
    context = null;
    rows = [];
    selectedId = null;
    last = "";
    undo = null;
    confirmation = null;
    diffOpen = false;
    activeTab = "scenes";
    cachedDiffKey = "";
    cachedDiff = null;
    if (pickerFrame) { cancelAnimationFrame(pickerFrame); pickerFrame = 0; }
  }
  function currentContext() {
    const fresh = Adapter.current();
    if (!fresh || fresh.scope !== context?.scope || fresh.details !== context.details) {
      throw Error("当前角色或父配装已变化，请在对应配装下重试。");
    }
    return fresh;
  }
  function notify(ctx) {
    channel?.postMessage({ scope: ctx.scope });
    app.Cloud.changed(ctx.props.characterInfo.characterID, ctx.raw.id);
  }
  async function reload() {
    const token = ++loading, scope = context?.scope;
    if (!scope) return;
    try {
      const result = await Store.list(scope);
      if (token !== loading || context?.scope !== scope) return;
      rows = result;
      mounted.cloud.update(rows, context);
      if (!selected()) selectedId = null;
      render();
      message(failure, Boolean(failure));
    } catch (error) {
      if (token === loading) message(error.message, true);
    }
  }
  async function run(work) {
    if (busy || !mounted) return;
    const ui = mounted;
    busy = true;
    render();
    let success = false;
    try {
      await work();
      success = mounted === ui;
    } catch (error) {
      if (mounted === ui) message(error.message || "操作失败，请重试。", true);
    } finally {
      busy = false;
      if (mounted) render();
    }
    return success;
  }
  function setTab(tab, syncOverview = true) {
    if (!mounted) return;
    activeTab = tab === "cloud" ? "cloud" : "scenes";
    mounted.tabScenes.setAttribute("aria-selected", String(activeTab === "scenes"));
    mounted.tabCloud.setAttribute("aria-selected", String(activeTab === "cloud"));
    mounted.paneScenes.hidden = activeTab !== "scenes";
    mounted.paneCloud.hidden = activeTab !== "cloud";
    setMenu(false);
    if (syncOverview) context?.setOverviewTab?.(activeTab);
  }
  function setDiffOpen(open) {
    if (!mounted) return;
    diffOpen = Boolean(open);
    mounted.differences.hidden = !diffOpen;
    mounted.diffToggle.setAttribute("aria-expanded", String(diffOpen));
    mounted.activeScene.classList.toggle("diff-open", diffOpen);
  }
  async function saveNew() {
    const success = await run(async () => {
      const ctx = currentContext(), title = Core.name(mounted.name.value), ui = mounted;
      const row = await Store.create(ctx, title);
      notify(ctx);
      if (mounted !== ui) return;
      selectedId = row.id;
      diffOpen = false;
      mounted.name.value = "";
      mounted.form.hidden = true;
      await reload();
      if (mounted === ui) message("");
    });
    if (success) mounted.add.focus();
  }
  function closeImportForm() {
    if (!mounted || mounted.importForm.hidden) return;
    mounted.closeImportSession?.();
    mounted.importForm.hidden = true;
  }
  function requestAction(action, targetRow, source = null) {
    const row = targetRow || (action === "snapshot" ? selected() : activeRows().find(entry => entry.id === menuId) || selected());
    if (!row) return;
    const mode = action === "remove" ? (source || (!mounted.menu.hidden && menuId === row.id ? "menu" : "direct")) : null;
    if (activeTab !== "scenes") setTab("scenes");
    confirmation = { action, row, source: mode };
    mounted.form.hidden = true;
    closeImportForm();
    mounted.simulatorExportForm.hidden = true;
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    if (mode !== "menu") setMenu(false);
    render();
    if (action === "snapshot") mounted.update.focus();
    else if (action === "rename") mounted.rename.focus();
    else if (mode === "menu") mounted.remove.focus();
    else if (mode === "direct") mounted.removeDirect.focus();
    else mounted.commit.focus();
  }
  async function commitAction() {
    const pending = confirmation;
    if (!pending) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const row = await Store.mutate(ctx, pending.row, pending.action, mounted.rename.value);
      notify(ctx);
      if (mounted !== ui) return;
      if (pending.action === "remove") {
        undo = row;
        if (selectedId === row.id) { selectedId = null; diffOpen = false; }
      }
      confirmation = null;
      setMenu(false);
      await reload();
      if (mounted !== ui) return;
      message(pending.action === "remove" ? `已移除“${row.name}”` : "");
    });
    if (success) (pending.action === "snapshot" ? mounted.update : mounted.add).focus();
  }
  async function restore() {
    const row = undo;
    if (!row) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const restored = await Store.mutate(ctx, row, "restore");
      notify(ctx);
      if (mounted !== ui) return;
      undo = null;
      selectedId = restored.id;
      diffOpen = false;
      await reload();
      if (mounted === ui) message("");
    });
    if (success) mounted.add.focus();
  }
  function download() {
    try {
      const ctx = currentContext(), text = Store.exportBackup(ctx, rows);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = el("a", "", { href: url, download: `配装子方案-${ctx.raw.id}-${new Date().toISOString().slice(0, 10)}.json` });
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMenu(false);
      message("已导出备份");
    } catch (error) {
      message(error.message, true);
    }
  }
  function setMenu(open) {
    if (!mounted) return;
    let clearedRemove = false;
    if (open) {
      const inline = menuId !== null && activeTab === "scenes";
      mounted.menu.classList.toggle("menu-inline", inline);
      if (inline) mounted.choices.after(mounted.menu);
      else mounted.header.after(mounted.menu);
    } else if (confirmation?.action === "remove" && confirmation.source === "menu") {
      confirmation = null;
      clearedRemove = true;
    }
    mounted.menu.hidden = !open;
    mounted.manage.setAttribute("aria-expanded", String(open && menuId === null));
    for (const node of mounted.choices.querySelectorAll("button")) {
      node.setAttribute("aria-expanded", String(open && (node.dataset.sceneId || null) === menuId));
    }
    if (clearedRemove) render();
  }
  function bindMenu(node, id) {
    let timer = null, start = null, suppress = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const open = () => {
      if (busy || !node.isConnected || !mounted) return;
      menuId = id;
      confirmation = null;
      mounted.form.hidden = true;
      closeImportForm();
      mounted.simulatorExportForm.hidden = true;
      render();
      setMenu(true);
      mounted.menu.querySelector("button:not(:disabled):not([hidden])")?.focus();
    };
    node.setAttribute("aria-controls", "scene-menu");
    node.setAttribute("aria-expanded", "false");
    node.addEventListener("contextmenu", event => { event.preventDefault(); cancel(); open(); });
    node.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); open(); }
    });
    node.addEventListener("pointerdown", event => {
      cancel();
      suppress = false;
      if (event.button !== 0 || event.isPrimary === false) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { timer = null; suppress = true; open(); }, 550);
    });
    node.addEventListener("pointermove", event => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) node.addEventListener(type, cancel);
    node.addEventListener("click", event => {
      if (suppress) { suppress = false; event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  function currentDiff(ctx, row) {
    const key = `${ctx.scope}|${last}|${row.id}|${row.revision}`;
    if (key !== cachedDiffKey || !cachedDiff) {
      cachedDiff = Core.diff(ctx.raw, row.snapshot);
      cachedDiffKey = key;
    }
    return cachedDiff;
  }
  function renderGuideNode(guide) {
    const attr = guide.kind === "trigger" ? "data-mwi-trigger-guide" : "data-mwi-picker-guide";
    const box = el("div", null, { [attr]: "", "data-state": guide.state || "guide", role: "status" });
    box.append(el("div", guide.title, { class: "mwi-guide-title" }));
    if (Array.isArray(guide.rows) && guide.rows.length) {
      const ul = el("ul", null, { class: "mwi-guide-list" });
      for (const item of guide.rows) {
        const li = el("li", null, { class: item.done ? "is-done" : "is-todo" });
        li.append(el("span", item.done ? "✓" : "●", { class: "mwi-guide-mark", "aria-hidden": "true" }));
        li.append(el("span", item.text, { class: "mwi-guide-text" }));
        if (item.prefilled) li.append(el("span", "已预填", { class: "mwi-guide-tag" }));
        ul.append(li);
      }
      box.append(ul);
    }
    return box;
  }
  function syncPicker() {
    let next = [], nextPrefilled = [], scrollTargets = [], guides = [];
    const row = selected();
    const hasOpen = pickerHighlights.length || prefilledHighlights.length || pickerGuides.size || document.querySelector(pickerSelector);
    if (mounted && context && row && !failure && hasOpen) {
      try {
        const result = Adapter.pickerGuidance
          ? Adapter.pickerGuidance(context, currentDiff(context, row))
          : { targets: Adapter.pickerTargets(context, currentDiff(context, row)), prefilled: [], scrollTargets: [], guides: [] };
        next = result.targets || [];
        nextPrefilled = result.prefilled || [];
        scrollTargets = result.scrollTargets || [];
        guides = result.guides || [];
      } catch (_) { /* Unknown picker: retain the slot guide. */ }
    }
    for (const node of pickerHighlights) if (!next.includes(node)) node.removeAttribute("data-mwi-scene-target");
    for (const node of next) node.setAttribute("data-mwi-scene-target", "");
    pickerHighlights = next;
    for (const node of prefilledHighlights) if (!nextPrefilled.includes(node)) node.removeAttribute("data-mwi-scene-prefilled");
    for (const node of nextPrefilled) node.setAttribute("data-mwi-scene-prefilled", "");
    prefilledHighlights = nextPrefilled;
    const activeHosts = new Set(guides.map(guide => guide.host));
    for (const [host, entry] of pickerGuides) {
      if (!activeHosts.has(host) || !entry.node.isConnected) {
        entry.node.remove();
        pickerGuides.delete(host);
      }
    }
    for (const guide of guides) {
      const existing = pickerGuides.get(guide.host);
      if (existing && existing.key === guide.key && existing.node.isConnected) continue;
      existing?.node.remove();
      const node = renderGuideNode(guide);
      if (guide.after && guide.after.parentElement === guide.host) guide.after.after(node);
      else guide.host.prepend(node);
      pickerGuides.set(guide.host, { node, key: guide.key });
    }
    for (const item of scrollTargets) {
      if (!item?.container || !item.node || !item.node.isConnected) continue;
      if (scrolledPickers.get(item.container) === item.key) continue;
      scrolledPickers.set(item.container, item.key);
      try { item.node.scrollIntoView({ block: "nearest", inline: "nearest" }); }
      catch (_) { /* Ignore non-scrollable containers. */ }
    }
  }
  function schedulePickerSync() {
    if (pickerFrame || !mounted || !context || !selected() || failure) return;
    if (!pickerHighlights.length && !prefilledHighlights.length && !pickerGuides.size && !document.querySelector(pickerSelector)) return;
    pickerFrame = requestAnimationFrame(() => {
      pickerFrame = 0;
      syncPicker();
    });
  }
  function showNew() {
    if (busy || failure) return;
    mounted.simulatorExportForm.hidden = true;
    setTab("scenes");
    confirmation = null;
    setMenu(false);
    closeImportForm();
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    mounted.form.hidden = false;
    render();
    mounted.name.focus();
  }
  function showImportSolo() {
    if (busy || failure) return;
    const wasHidden = mounted.importForm.hidden;
    mounted.simulatorExportForm.hidden = true;
    setTab("scenes");
    confirmation = null;
    setMenu(false);
    mounted.form.hidden = true;
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    mounted.importForm.hidden = false;
    if (wasHidden) mounted.openImportSession?.();
    render();
    mounted.importName.focus();
  }
  function closeEditor() {
    const updating = confirmation?.action === "snapshot";
    const removingDirect = confirmation?.action === "remove" && confirmation.source === "direct";
    mounted.simulatorExportForm.hidden = true;
    confirmation = null;
    mounted.form.hidden = true;
    closeImportForm();
    if (mounted.usageBox) mounted.usageBox.hidden = true;
    render();
    if (updating && !mounted.update.hidden) mounted.update.focus();
    else if (removingDirect && !mounted.removeDirect.hidden) mounted.removeDirect.focus();
    else mounted.add.focus();
  }
  function stopComparison() {
    selectedId = null;
    confirmation = null;
    diffOpen = false;
    setMenu(false);
    render();
    message("");
    mounted.add.focus();
  }

  function mount(ctx) {
    const host = el("div", null, { id: "mwi-loadout-scenes-host" }), shadow = host.attachShadow({ mode: "open" });
    if (ctx.overview) host.setAttribute("data-overview", "");
    shadow.append(el("style", css));

    const section = el("section", null, { "aria-labelledby": "scene-title" });
    const header = el("div", null, { class: "header" });
    const heading = el("h2", "子方案", { id: "scene-title", class: "sr-only" });

    const tabs = el("div", null, { class: "tabs", role: "tablist", "aria-label": "工作区视图" });
    const tabScenes = button("子方案", () => setTab("scenes"), {
      class: "tab", role: "tab", "aria-selected": "true", "data-tab": "scenes"
    });
    const tabCloud = button(null, () => setTab("cloud"), {
      class: "tab", role: "tab", "aria-selected": "false", "data-tab": "cloud"
    });
    const tabCloudDot = el("span", null, { class: "tab-dot", hidden: "", "aria-hidden": "true" });
    tabCloud.append("云同步", tabCloudDot);
    tabs.append(tabScenes, tabCloud);

    const headerActions = el("div", null, { class: "header-actions" });
    const manage = button(null, () => {
      const opening = mounted.menu.hidden || menuId !== null;
      menuId = null;
      confirmation = null;
      form.hidden = true;
      closeImportForm();
      simulatorExportForm.hidden = true;
      render();
      setMenu(opening);
      if (opening) mounted.menu.querySelector("button:not(:disabled):not([hidden])")?.focus();
    }, { class: "icon-btn", "aria-label": "更多操作", title: "更多操作", "aria-controls": "scene-menu", "aria-expanded": "false" });
    manage.append(svgIcon("more"));
    headerActions.append(manage);

    if (ctx.overview && typeof ctx.closeOverviewScenes === "function") {
      const closeTray = button(null, () => ctx.closeOverviewScenes(), {
        class: "icon-btn", "aria-label": "收起子方案面板", title: "收起面板"
      });
      closeTray.append(svgIcon("close"));
      headerActions.append(closeTray);
    }
    header.append(heading, tabs, headerActions);

    const menu = el("div", null, { id: "scene-menu", class: "menu", hidden: "", "aria-label": "方案与备份操作" });
    const menuContextGroup = el("div", null, { class: "menu-group", hidden: "" });
    const menuTargetLabel = el("div", "", { class: "menu-label" });
    const menuContextRow = el("div", null, { class: "menu-grid" });
    const renameButton = button("改名", () => requestAction("rename"));
    const remove = button("移除", () => {
      if (confirmation?.action === "remove" && confirmation.source === "menu" && confirmation.row.id === menuId) commitAction();
      else requestAction("remove", activeRows().find(entry => entry.id === menuId), "menu");
    }, { class: "danger-text" });
    const stop = button("结束对比", stopComparison);
    menuContextRow.append(renameButton, remove, stop);
    menuContextGroup.append(menuTargetLabel, menuContextRow);

    const menuLoadoutRow = el("div", null, { class: "menu-grid" });
    const virtualButton = button("存为虚拟配装", () => run(async () => {
      const fresh = currentContext();
      await app.Virtual.save(fresh.props.characterInfo.characterID, fresh.raw.name, Core.snapshot(fresh.raw));
      if (mounted?.host === host) {
        setMenu(false);
        message("已存为虚拟配装");
      }
    }));
    const menuImportSolo = button("导入配装", showImportSolo);
    const simulatorExportButton = button("导出到模拟器", () => {
      if (busy || failure) return;
      const fresh = currentContext();
      if (fresh.raw.actionTypeHrid !== "/action_types/combat") return;
      setTab("scenes"); setMenu(false); confirmation = null;
      form.hidden = true;
      closeImportForm();
      if (usageBox) usageBox.hidden = true;
      simulatorSourceChips.replaceChildren();
      const sources = [{ id: "current", name: `当前 · ${fresh.raw.name}` },
        ...activeRows().map(row => ({ id: row.id, name: row.name }))];
      selectedSimSource = sources.some(row => row.id === selectedId) ? selectedId : "current";
      for (const row of sources) {
        const chip = button(row.name, () => {
          selectedSimSource = row.id;
          for (const btn of simulatorSourceChips.querySelectorAll("button")) {
            btn.setAttribute("aria-pressed", String(btn.dataset.sourceId === selectedSimSource));
          }
          clearSimulatorExport();
        }, { class: "sim-chip", "data-source-id": row.id, "aria-pressed": String(row.id === selectedSimSource) });
        simulatorSourceChips.append(chip);
      }
      clearSimulatorExport(); simulatorExportForm.hidden = false;
      render(); simulatorTarget.querySelector("button")?.focus();
    });
    const exportButton = button("导出全部", download);
    const file = el("input", null, { type: "file", accept: ".json,application/json", "aria-label": "选择子方案备份", hidden: "" });
    const importButton = button("导入备份", () => file.click());
    file.addEventListener("change", () => run(async () => {
      const input = file.files?.[0];
      if (!input) return;
      if (input.size > 5000000) throw Error("备份超过 5 MB，未导入。");
      const fresh = currentContext(), ui = mounted, text = await input.text();
      if (currentContext().scope !== fresh.scope) throw Error("当前父配装已变化，未导入备份，请在原配装下重试。");
      const count = await Store.importBackup(fresh, text);
      notify(fresh);
      if (mounted !== ui) return;
      file.value = "";
      setMenu(false);
      await reload();
      message(`已导入 ${count} 项`);
    }));
    menuLoadoutRow.append(virtualButton, menuImportSolo, simulatorExportButton, exportButton, importButton);

    let usageBox = null, usageToggle = null;
    if (root.__layuUsage_mwi_loadout) {
      usageToggle = button("统计设置", () => {
        setMenu(false);
        setTab("scenes");
        usageBox.hidden = !usageBox.hidden;
      });
      menuLoadoutRow.append(usageToggle);
      usageBox = el("div", null, { class: "editor usage-box", hidden: "" });
      const usageHead = el("div", null, { class: "editor-head" });
      const closeUsage = button(null, () => { usageBox.hidden = true; manage.focus(); }, {
        class: "icon-btn", "aria-label": "关闭统计设置", title: "关闭"
      });
      closeUsage.append(svgIcon("close"));
      usageHead.append(el("span", "安装与活跃统计", { class: "editor-title" }), closeUsage);
      usageBox.append(usageHead, el("slot", null, { name: "usage-settings" }));
      // Keep the shared client's settings host in light DOM so its observer can find it.
      host.append(el("div", null, { slot: "usage-settings", "data-layu-usage-settings": "mwi_loadout", lang: "zh-CN" }));
    }
    menu.append(menuContextGroup, menuLoadoutRow, file);

    // Tab 1: Scenes workspace
    const paneScenes = el("div", null, { class: "pane", role: "tabpanel" });
    const choices = el("div", null, { class: "choices", "aria-label": "已保存的子方案" });
    const add = button(null, showNew, { class: "add-btn", "aria-label": "新建子方案", title: "保存当前原生配装为新子方案" });
    add.append(svgIcon("add"), el("span", "新建", { class: "add-label" }));
    bindMenu(add, null);
    const importSoloButton = button("导入", showImportSolo, {
      class: "import-btn", title: "导入单人或编号角色战斗配装为子方案"
    });
    choices.append(add, importSoloButton);

    // Contextual Active Scene Bar (object-proximal controls for the selected scene)
    const activeScene = el("div", null, { class: "active-scene", hidden: "" });
    const activeHead = el("div", null, { class: "active-head" });
    const diffToggle = button(null, () => {
      if (mounted.list.childElementCount) setDiffOpen(!diffOpen);
    }, { class: "diff-toggle", "aria-expanded": "false", "aria-controls": "scene-differences" });
    const activeDot = el("span", null, { class: "active-dot", "aria-hidden": "true" });
    const activeName = el("span", "", { class: "active-name" });
    const activeSep = el("span", "·", { class: "active-sep", "aria-hidden": "true" });
    const summary = el("span", "", { id: "summary", role: "status", "aria-live": "polite" });
    const diffCaret = el("span", null, { class: "diff-caret", "aria-hidden": "true" });
    diffCaret.append(svgIcon("caret"));
    diffToggle.append(activeDot, activeName, activeSep, summary, diffCaret);

    const stopDirect = button(null, stopComparison, {
      class: "icon-btn", "aria-label": "结束对比", title: "结束对比"
    });
    stopDirect.append(svgIcon("close"));
    activeHead.append(diffToggle, stopDirect);

    const activeActions = el("div", null, { class: "active-actions" });
    const activeLeft = el("div", null, { class: "active-actions-left" });
    const renameDirect = button("改名", () => requestAction("rename", selected()), { class: "compact-btn ghost-btn" });
    const removeDirect = button("移除", () => {
      const current = selected();
      if (confirmation?.action === "remove" && confirmation.source === "direct" && confirmation.row.id === current?.id) commitAction();
      else requestAction("remove", current, "direct");
    }, { class: "compact-btn ghost-btn danger-hover remove-button" });
    const cancelRemove = button("取消", closeEditor, { class: "compact-btn ghost-btn", hidden: "" });
    activeLeft.append(renameDirect, removeDirect, cancelRemove);

    const activeRight = el("div", null, { class: "active-actions-right" });
    const cancelUpdate = button("取消", closeEditor, { class: "compact-btn", hidden: "" });
    const update = button("更新", () => confirmation?.action === "snapshot" ? commitAction() : requestAction("snapshot", selected()), {
      class: "compact-btn update-button"
    });
    activeRight.append(cancelUpdate, update);
    activeActions.append(activeLeft, activeRight);

    const differences = el("div", null, { id: "scene-differences", class: "diff-panel", hidden: "" });
    const list = el("ol", null, { "aria-label": "需要手动修改的项目" });
    differences.append(list);
    activeScene.append(activeHead, activeActions, differences);

    // Inline New Scene Form
    const form = el("form", null, { class: "editor", hidden: "" });
    const name = el("input", null, {
      id: "scene-name", maxlength: "60", autocomplete: "off",
      "aria-label": "新子方案名称", placeholder: "名称（保存当前原生配装）"
    });
    const save = el("button", "保存", { type: "submit", class: "compact-btn primary" });
    const cancelNew = button("取消", () => { form.hidden = true; mounted.add.focus(); }, { class: "compact-btn ghost-btn" });
    const formRow = el("div", null, { class: "inline-form-row" });
    formRow.append(name, cancelNew, save);
    form.addEventListener("submit", event => { event.preventDefault(); saveNew(); });
    form.append(formRow);

    // Single-player and numbered-party import; only the chosen player is saved.
    const importForm = el("form", null, { class: "editor", hidden: "", "aria-label": "导入配装为子方案" });
    const importName = el("input", null, {
      id: "scene-import-name", maxlength: "60", autocomplete: "off", placeholder: "输入子方案名称（含预设名时自动填入）"
    });
    const importText = el("textarea", null, {
      id: "scene-import-text", rows: "5", maxlength: "5000000", required: "",
      spellcheck: "false", placeholder: "粘贴配装 JSON，或选择文件"
    });
    const importChoiceRow = el("div", null, { class: "import-choice-row", hidden: "" });
    const importChoiceLabel = el("label", "导入角色", { for: "scene-import-choice", class: "muted" });
    const importChoice = el("select", null, { id: "scene-import-choice" });
    importChoiceRow.append(importChoiceLabel, importChoice);
    const importMatchRow = el("div", null, { class: "import-match-row", hidden: "" });
    const importMatch = el("p", "", { class: "muted", role: "status" });
    const changeImportMatch = button("更换", () => {
      importChoiceRow.hidden = false;
      importChoice.required = true;
      importMatchRow.hidden = true;
      importChoice.focus();
    }, { class: "compact-btn ghost-btn", hidden: "" });
    importMatchRow.append(importMatch, changeImportMatch);
    let parsedImportText = null, parsedImportOwner = null, parsedImportChoices = [], autoFilledImportName = "", importFileFallbackName = "";
    function resetImportChoices() {
      parsedImportText = parsedImportOwner = null;
      parsedImportChoices = [];
      importChoice.replaceChildren();
      importChoice.required = false;
      importChoiceRow.hidden = true;
      importMatchRow.hidden = true;
      changeImportMatch.hidden = true;
    }
    function resolveSuggestedImportName() {
      if (!parsedImportChoices.length) return "";
      const picked = importChoice.value
        ? parsedImportChoices.find(choice => choice.key === importChoice.value)
        : (parsedImportChoices.length === 1 ? parsedImportChoices[0] : null);
      if (picked) return picked.suggestedName || "";
      const names = [...new Set(parsedImportChoices.map(choice => choice.suggestedName || ""))];
      return names.length === 1 ? names[0] : "";
    }
    function resolveEffectiveImportName() {
      return resolveSuggestedImportName() || importFileFallbackName;
    }
    function applySuggestedImportName(nextName) {
      const normalized = typeof nextName === "string" ? nextName.trim().slice(0, 60) : "";
      if (normalized) {
        if (!importName.value.trim() || importName.value === autoFilledImportName) {
          importName.value = normalized;
          autoFilledImportName = normalized;
        }
      } else if (autoFilledImportName && importName.value === autoFilledImportName) {
        importName.value = "";
        autoFilledImportName = "";
      }
    }
    function closeImportSession() {
      if (autoFilledImportName && importName.value === autoFilledImportName) importName.value = "";
      autoFilledImportName = "";
      importFileFallbackName = "";
      resetImportChoices();
    }
    function refreshImportChoices() {
      const fresh = currentContext(), nickname = Adapter.currentCharacterName(fresh);
      const owner = JSON.stringify([fresh.scope, nickname]);
      if (parsedImportText === importText.value && parsedImportOwner === owner) return;
      resetImportChoices();
      let parsedJson = null;
      try { parsedJson = JSON.parse(importText.value); } catch (_) { /* Validated by Core.importChoices. */ }
      if (parsedJson?.format === "mwi-layu-loadout-scenes")
        throw Error("这是子方案备份，请在右上角「⋯ → 导入备份」中导入。");
      if (parsedJson?.format === "mwi-virtual-loadout" || parsedJson?.format === "mwi-virtual-loadouts-backup")
        throw Error("这是虚拟配装分享/备份，请在底部「虚拟配装 → 导入分享」中导入。");
      const choices = Core.importChoices(importText.value);
      parsedImportChoices = choices;
      importChoice.append(el("option", "选择要导入的角色", { value: "" }));
      for (const choice of choices) importChoice.append(el("option", choice.label, { value: choice.key }));
      if (choices.length === 1) importChoice.value = choices[0].key;
      else {
        const matched = Core.matchImportNickname(choices, nickname);
        importMatchRow.hidden = false;
        if (matched) {
          importChoice.value = matched;
          importMatch.textContent = `已匹配角色：${nickname}`;
          importMatch.className = "muted";
          changeImportMatch.hidden = false;
        } else {
          importChoiceRow.hidden = false;
          importChoice.required = true;
          importMatch.textContent = "未找到唯一同名角色，请手动选择";
          importMatch.className = "sim-warn";
          changeImportMatch.hidden = true;
        }
      }
      parsedImportText = importText.value;
      parsedImportOwner = owner;
      applySuggestedImportName(resolveEffectiveImportName());
    }
    function tryRefreshImportChoices() {
      const trimmed = importText.value.trim();
      if (!trimmed) {
        resetImportChoices();
        applySuggestedImportName("");
        return;
      }
      if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
        resetImportChoices();
        return;
      }
      try {
        refreshImportChoices();
        if (mounted?.status.classList.contains("error")) message("");
      } catch (_) {
        resetImportChoices();
      }
    }
    function openImportSession() {
      autoFilledImportName = "";
      importFileFallbackName = "";
      tryRefreshImportChoices();
    }
    importText.addEventListener("input", () => {
      importFileFallbackName = "";
      tryRefreshImportChoices();
    });
    importText.addEventListener("change", () => {
      if (!importText.value.trim()) {
        importFileFallbackName = "";
        resetImportChoices();
        applySuggestedImportName("");
        return;
      }
      try { refreshImportChoices(); message(""); } catch (error) { message(error.message, true); }
    });
    importChoice.addEventListener("change", () => applySuggestedImportName(resolveEffectiveImportName()));
    const soloFile = el("input", null, {
      type: "file", accept: ".json,.txt,application/json,text/plain", hidden: "", "aria-label": "选择模拟器配装文件"
    });
    const chooseSoloFile = button("选择文件", () => soloFile.click(), { class: "compact-btn ghost-btn" });
    const cancelImport = button("取消", () => { closeImportForm(); importSoloButton.focus(); }, { class: "compact-btn ghost-btn" });
    const closeImport = button(null, () => { closeImportForm(); importSoloButton.focus(); }, {
      class: "icon-btn", "aria-label": "关闭导入", title: "关闭"
    });
    closeImport.append(svgIcon("close"));
    const importHead = el("div", null, { class: "editor-head" });
    importHead.append(el("span", "导入战斗配装", { class: "editor-title" }), closeImport);
    const saveImport = el("button", "保存为子方案", { type: "submit", class: "compact-btn primary" });
    const importActions = el("div", null, { class: "actions split-actions" });
    const importRight = el("div", null, { class: "actions" });
    importRight.append(cancelImport, saveImport);
    importActions.append(chooseSoloFile, importRight);
    importForm.append(
      importHead,
      el("label", "子方案名称", { for: "scene-import-name", class: "sr-only" }), importName,
      el("label", "配装内容", { for: "scene-import-text", class: "sr-only" }), importText,
      importMatchRow, importChoiceRow,
      importActions, soloFile
    );
    soloFile.addEventListener("change", () => run(async () => {
      const input = soloFile.files?.[0];
      if (!input) return;
      const ui = mounted;
      try {
        if (input.size > 5000000) throw Error("配装文件超过 5 MB，请选择较小的文件。");
        const text = await input.text();
        if (mounted !== ui) return;
        importFileFallbackName = input.name.replace(/\.(json|txt)$/i, "").trim().slice(0, 60);
        importText.value = text;
        parsedImportText = null;
        try {
          refreshImportChoices();
        } catch (error) {
          importFileFallbackName = "";
          throw error;
        }
        message("文件已读取，确认名称后保存。");
      } finally { soloFile.value = ""; }
    }));
    importForm.addEventListener("submit", async event => {
      event.preventDefault();
      let shouldFocusName = false;
      const ui = mounted;
      const success = await run(async () => {
        const fresh = currentContext();
        refreshImportChoices();
        const fallbackName = resolveEffectiveImportName();
        const rawTitle = importName.value.trim() ? importName.value : fallbackName;
        if (!rawTitle) shouldFocusName = true;
        const title = Core.name(rawTitle);
        if (!importName.value.trim() && fallbackName) {
          importName.value = title;
          autoFilledImportName = title;
        }
        const raw = Core.importSolo(importText.value, fresh.raw, fresh.props.characterInfo.characterID, importChoice.value);
        const row = await Store.create({ ...fresh, raw }, title);
        notify(fresh);
        if (mounted !== ui) return;
        selectedId = row.id;
        diffOpen = false;
        importText.value = "";
        importName.value = "";
        closeImportForm();
        await reload();
        if (mounted === ui) message("");
      });
      if (mounted !== ui) return;
      if (success) importSoloButton.focus();
      else if (shouldFocusName && !importForm.hidden) importName.focus();
    });

    const simulatorExportForm = el("form", null, { class: "editor sim-export", hidden: "", "aria-label": "导出到模拟器" });
    const simulatorHead = el("div", null, { class: "editor-head" });
    const simulatorCancel = button(null, () => { simulatorExportForm.hidden = true; mounted.manage.focus(); }, {
      class: "icon-btn", "aria-label": "关闭导出", title: "关闭"
    });
    simulatorCancel.append(svgIcon("close"));
    simulatorHead.append(el("span", "导出到模拟器", { class: "editor-title" }), simulatorCancel);

    let selectedSimSource = "current";
    const simulatorSource = el("fieldset", null, { class: "simulator-source" });
    const simulatorSourceChips = el("div", null, { class: "sim-source-chips" });
    simulatorSource.append(el("legend", "导出内容"), simulatorSourceChips);

    const simulatorTarget = el("fieldset", null, { class: "simulator-targets" });
    const simulatorTargetGrid = el("div", null, { class: "sim-target-grid" });
    simulatorTarget.append(el("legend", "选择模拟器格式"), simulatorTargetGrid);
    const simulatorTargetButtons = [];
    for (const [value, label, domain] of [
      ["shykai", "Shykai", "shykai.github.io"],
      ["mwisim", "MWISIM", "mwisim.org"],
      ["vue", "MWI Combat Sim", "mwi-combatsi-mulator.pages.dev"]
    ]) {
      const target = button(null, () => run(() => generateSimulatorExport(value)), {
        class: "simulator-export-target", "data-sim-target": value, "aria-pressed": "false"
      });
      target.append(el("span", label), el("small", domain));
      simulatorTargetGrid.append(target);
      simulatorTargetButtons.push(target);
    }

    const simulatorOutput = el("textarea", null, { rows: "4", readonly: "", "aria-label": "模拟器导出内容" });
    simulatorOutput.addEventListener("focus", () => simulatorOutput.select());
    const simulatorRoute = el("p", "", { class: "sim-route", role: "status" });
    const simulatorWarn = el("p", "", { class: "sim-warn", hidden: "" });
    const simulatorResult = el("div", null, { class: "sim-result", hidden: "" });
    let generatedSimulator = null;
    function clearSimulatorExport() {
      generatedSimulator = null;
      simulatorOutput.value = "";
      simulatorResult.hidden = true;
      for (const btn of simulatorTargetButtons) btn.setAttribute("aria-pressed", "false");
    }
    let simCopyTimer = null;
    const simulatorCopy = button("复制内容", () => run(async () => {
      if (!generatedSimulator) return;
      try {
        await navigator.clipboard.writeText(generatedSimulator.text);
        clearTimeout(simCopyTimer);
        simulatorCopy.textContent = "已复制";
        simulatorCopy.classList.add("is-copied");
        simCopyTimer = setTimeout(() => {
          simulatorCopy.textContent = "复制内容";
          simulatorCopy.classList.remove("is-copied");
        }, 1800);
      } catch (_) { simulatorOutput.focus(); simulatorOutput.select(); message("无法访问剪贴板，请手动复制已选中的内容。", true); }
    }), { class: "compact-btn primary copy-btn" });
    const simulatorDownload = button("下载 JSON", () => {
      if (!generatedSimulator) return;
      const url = URL.createObjectURL(new Blob([generatedSimulator.text], { type: "application/json" }));
      el("a", "", { href: url, download: `配装-${generatedSimulator.target}.json` }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, { class: "compact-btn ghost-btn" });
    const simulatorOutputActions = el("div", null, { class: "actions" });
    simulatorOutputActions.append(simulatorDownload, simulatorCopy);
    simulatorResult.append(simulatorRoute, simulatorWarn, simulatorOutput, simulatorOutputActions);
    simulatorExportForm.append(simulatorHead, simulatorSource, simulatorTarget, simulatorResult);
    simulatorExportForm.addEventListener("submit", event => event.preventDefault());
    async function generateSimulatorExport(target) {
      clearSimulatorExport();
      const sourceId = selectedSimSource;
      const fresh = currentContext(), row = activeRows().find(row => row.id === sourceId);
      if (sourceId !== "current" && !row) throw Error("子方案已变化，请重新选择导出内容。");
      const raw = row ? Core.validateSnapshot(row.snapshot).raw : fresh.raw;
      if (raw.id !== fresh.raw.id) throw Error("子方案不属于当前配装。");
      const result = Core.exportSimulator(raw, row?.name || raw.name, target, fresh.props);
      generatedSimulator = { ...result, target };
      simulatorOutput.value = result.text;
      const route = {
        shykai: "在 Shykai 的 Solo 导入框粘贴。",
        mwisim: "在 MWISIM「数据与基准 → 导入整队方案」选择下载的文件。",
        vue: "在 MWI Combat Simulator「导入/导出 → 单人」中导入到所选玩家。"
      }[target];
      simulatorRoute.textContent = route;
      simulatorWarn.textContent = result.warnings.length ? result.warnings.join("；") + "。" : "";
      simulatorWarn.hidden = !simulatorWarn.textContent;
      for (const btn of simulatorTargetButtons) btn.setAttribute("aria-pressed", String(btn.dataset.simTarget === target));
      simulatorResult.hidden = false;
    }

    // Inline Rename / Remove Confirmation
    const confirm = el("div", null, { class: "editor", hidden: "" }), confirmText = el("p", "", { class: "editor-title" });
    const rename = el("input", null, { maxlength: "60", "aria-label": "修改子方案名称" });
    rename.addEventListener("keydown", event => {
      if (event.key === "Enter" && confirmation?.action === "rename") { event.preventDefault(); commitAction(); }
    });
    const confirmRow = el("div", null, { class: "actions" });
    const commit = button("", commitAction, { class: "compact-btn primary" });
    const cancel = button("取消", closeEditor, { class: "compact-btn ghost-btn" });
    confirmRow.append(cancel, commit);
    confirm.append(confirmText, rename, confirmRow);

    // Notice / Undo / Error Bar
    const notice = el("div", null, { class: "notice", hidden: "" });
    const status = el("p", "", { id: "status", role: "status", "aria-live": "polite" });
    const undoButton = button("撤销", restore, { hidden: "", class: "compact-btn", "aria-label": "撤销移除" });
    const retry = button("重试", () => { tick(); reload(); }, { hidden: "", class: "compact-btn" });
    notice.append(status, undoButton, retry);

    paneScenes.append(choices, form, importForm, simulatorExportForm, confirm, activeScene);
    if (usageBox) paneScenes.append(usageBox);

    // Tab 2: Cloud Sync workspace
    const paneCloud = el("div", null, { class: "pane", role: "tabpanel", hidden: "" });
    const cloud = app.CloudUI.mount(ctx, el, button, (main, copy, choice) => run(async () => {
      const fresh = currentContext(), ui = mounted;
      if (fresh.scope !== ctx.scope) throw Error("请在原配装下比较版本。");
      await Store.resolveConflict(fresh, main, copy, choice);
      notify(fresh);
      if (mounted !== ui) return;
      await reload();
      if (mounted === ui) message("版本选择已存本机。");
    }), info => {
      tabCloudDot.hidden = !info.warning;
      tabCloudDot.dataset.state = info.warning ? "warn" : "";
      tabCloud.classList.toggle("has-warning", info.warning);
    });
    paneCloud.append(cloud.node);

    app.Cloud.setActive(ctx.props.characterInfo.characterID, ctx.raw.id);
    section.append(header, menu, paneScenes, paneCloud, notice);
    shadow.append(section);
    if (ctx.sceneMount) ctx.sceneMount.append(host);
    else ctx.details.insertBefore(host, ctx.setup);

    shadow.addEventListener("keydown", event => {
      if (event.key !== "Escape" || busy) return;
      if (!menu.hidden) {
        event.stopPropagation();
        setMenu(false);
        manage.focus();
        return;
      }
      const hasSubPanel = Boolean(confirmation || !form.hidden || !importForm.hidden || !simulatorExportForm.hidden || (usageBox && !usageBox.hidden));
      if (hasSubPanel) {
        event.stopPropagation();
        closeEditor();
        return;
      }
      if (ctx.overview && typeof ctx.closeOverviewScenes === "function") {
        event.stopPropagation();
        ctx.closeOverviewScenes();
      }
    });
    shadow.addEventListener("pointerdown", event => {
      if (menu.hidden) return;
      const target = event.target;
      if (target instanceof Node && !menu.contains(target) && !manage.contains(target)) setMenu(false);
    });
    shadow.addEventListener("focusout", event => {
      if (!host.matches(":focus-within") && !shadow.contains(event.relatedTarget)) setMenu(false);
    });

    mounted = {
      cloud, host, shadow, header, tabScenes, tabCloud, tabCloudDot, paneScenes, paneCloud,
      choices, add, menu, menuContextGroup, menuTargetLabel, menuImportSolo,
      form, name, save, cancelNew,
      activeScene, diffToggle, activeDot, activeName, activeSep, summary, diffCaret, stopDirect,
      activeActions, renameDirect, removeDirect, cancelRemove, update, cancelUpdate,
      renameButton, remove, stop, undoButton, manage,
      importSoloButton, importForm, importName, importText, importChoice, changeImportMatch, chooseSoloFile, cancelImport, saveImport,
      openImportSession, closeImportSession,
      simulatorExportButton, simulatorExportForm, simulatorSource, simulatorTarget, simulatorCancel, simulatorCopy, simulatorDownload,
      confirm, confirmText, rename, commit, cancel,
      notice, status, retry, differences, list, exportButton, importButton, usageBox
    };
    context = ctx;
    rows = [];
    selectedId = null;
    undo = null;
    confirmation = null;
    diffOpen = false;
    setTab(ctx.overviewTab === "cloud" ? "cloud" : "scenes", false);
    cloud.update(rows);
    render();
    const emptyEl = choices.querySelector(".empty");
    if (emptyEl) emptyEl.textContent = "读取中…";
    reload();
  }

  function syncTargets(changes) {
    const targets = new Set(), slotTargets = new Set(), groups = new Map();
    unresolved = [];
    for (const [index, change] of changes.entries()) {
      const destination = Adapter.target(context, change);
      if (!destination) { unresolved.push(change); continue; }
      targets.add(destination);
      let slot = Adapter.target(context, { ...change, kind: change.kind.replace(/_trigger$/, "") });
      if (change.kind === "setting") slot = slot?.closest('[class*="LoadoutsPanel_metadata__"]') || slot;
      if (slot?.matches("label")) slot = slot.parentElement;
      if (!slot) continue;
      if (change.kind !== "setting") slotTargets.add(slot);
      const entries = groups.get(slot) || [];
      entries.push({ change, index });
      groups.set(slot, entries);
    }
    for (const old of highlighted) if (!targets.has(old)) {
      old.removeAttribute("data-mwi-scene-change");
      old.removeAttribute("data-mwi-scene-pulse");
    }
    for (const node of targets) node.setAttribute("data-mwi-scene-change", "");
    highlighted = [...targets];
    for (const old of highlightedSlots) if (!slotTargets.has(old)) old.removeAttribute("data-mwi-scene-slot-change");
    for (const node of slotTargets) node.setAttribute("data-mwi-scene-slot-change", "");
    highlightedSlots = [...slotTargets];
    const nextSetup = slotTargets.size ? context.setup : null;
    if (comparingSetup && comparingSetup !== nextSetup) comparingSetup.removeAttribute("data-mwi-scene-comparing");
    if (nextSetup) nextSetup.setAttribute("data-mwi-scene-comparing", "");
    comparingSetup = nextSetup;
    for (const [slot, marker] of markers) if (!groups.has(slot) || !marker.host.isConnected) { marker.host.remove(); markers.delete(slot); }
    for (const [slot, entries] of groups) {
      let marker = markers.get(slot);
      const key = Core.stable(entries.map(({ change, index }) => [index, change.label, Adapter.describe(context, change, change.to)]));
      if (!marker) {
        const host = el("span", null, { "data-mwi-scene-marker": "" }), shadow = host.attachShadow({ mode: "open" });
        const content = el("div", null, { class: "target-markers" });
        shadow.append(el("style", css), content);
        for (const type of ["click", "dblclick", "pointerdown", "keydown"]) host.addEventListener(type, event => event.stopPropagation());
        slot.append(host);
        marker = { host, content, key: null };
        markers.set(slot, marker);
      }
      if (marker.key === key) continue;
      marker.key = key;
      marker.content.replaceChildren();
      for (const { change, index } of entries) {
        const goal = Adapter.describe(context, change, change.to);
        if (change.kind.endsWith("_trigger")) {
          const node = button(change.to.length ? `条件 ${change.to.length} 项` : "无附加条件", () => {
            setTab("scenes");
            setDiffOpen(true);
            const item = mounted.list.children[index];
            item?.querySelector("details")?.setAttribute("open", "");
            item?.focus({ preventScroll: true });
            item?.scrollIntoView({ block: "center", behavior: "instant" });
          }, { class: "target-condition", "aria-label": `${change.label}：${goal}` });
          marker.content.append(node);
        } else {
          marker.content.append(el("span", `→ ${goal}`, { class: "target-value", "aria-label": `${change.label}目标：${goal}` }));
        }
      }
    }
  }

  function render() {
    if (!mounted || !context) return;
    const ui = mounted, active = activeRows(), row = selected(), combat = isCombat(context);
    const existing = new Map([...ui.choices.querySelectorAll("button[data-scene-id]")].map(node => [node.dataset.sceneId, node]));
    for (const [id, node] of existing) if (!active.some(entry => entry.id === id)) node.remove();
    ui.choices.querySelector("p.empty")?.remove();

    active.forEach((entry, index) => {
      let choice = existing.get(entry.id);
      if (!choice) {
        choice = button(entry.name, () => {
          if (selectedId === entry.id) { stopComparison(); return; }
          selectedId = entry.id;
          confirmation = null;
          setMenu(false);
          ui.form.hidden = true;
          closeImportForm();
          ui.simulatorExportForm.hidden = true;
          diffOpen = false;
          render();
          message(failure, Boolean(failure));
        }, { "data-scene-id": entry.id, class: "choice-chip" });
        bindMenu(choice, entry.id);
      }
      const label = active.some(other => other.id !== entry.id && other.name === entry.name)
        ? entry.name + " · " + entry.id.slice(0, 6) : entry.name;
      if (choice.textContent !== label) choice.textContent = label;
      choice.setAttribute("aria-pressed", String(entry.id === selectedId));
      choice.disabled = busy;
      if (ui.choices.children[index] !== choice) ui.choices.insertBefore(choice, ui.choices.children[index] || ui.add);
    });
    if (!active.length) ui.choices.insertBefore(el("p", "暂无方案", { class: "empty" }), ui.add);
    ui.add.classList.toggle("compact-icon", active.length > 0);
    ui.importSoloButton.hidden = !combat;
    ui.menuImportSolo.hidden = !combat;

    ui.save.disabled = ui.add.disabled = busy || Boolean(failure);
    ui.manage.disabled = busy || Boolean(failure);
    for (const node of [ui.importSoloButton, ui.menuImportSolo, ui.importName, ui.importText, ui.importChoice, ui.changeImportMatch, ui.chooseSoloFile, ui.saveImport]) {
      node.disabled = busy || Boolean(failure);
    }
    ui.cancelImport.disabled = busy;
    ui.cancelNew.disabled = busy;

    const updating = confirmation?.action === "snapshot";
    const removingDirect = confirmation?.action === "remove" && confirmation.source === "direct" && confirmation.row.id === row?.id;
    const removingInMenu = confirmation?.action === "remove" && confirmation.source === "menu" && confirmation.row.id === menuId;
    ui.update.textContent = updating ? "更新方案" : "更新";
    ui.update.classList.toggle("primary", updating);
    ui.update.title = updating ? `确认用当前原生配装覆盖“${confirmation.row.name}”` : row ? `用当前原生配装更新“${row.name}”` : "";
    ui.cancelUpdate.hidden = !updating;
    ui.cancelUpdate.disabled = busy;
    ui.update.disabled = busy || !row || Boolean(failure);
    ui.removeDirect.textContent = removingDirect ? "确认移除" : "移除";
    ui.removeDirect.classList.toggle("danger", removingDirect);
    ui.removeDirect.classList.toggle("ghost-btn", !removingDirect);
    ui.removeDirect.classList.toggle("danger-hover", !removingDirect);
    ui.removeDirect.title = removingDirect ? `再次点击确认移除“${confirmation.row.name}”` : row ? `移除“${row.name}”` : "";
    ui.cancelRemove.hidden = !removingDirect;
    ui.cancelRemove.disabled = busy;
    ui.renameDirect.disabled = ui.removeDirect.disabled = busy || !row || Boolean(failure);
    ui.stopDirect.disabled = busy;

    const menuRow = active.find(entry => entry.id === menuId);
    ui.menuContextGroup.hidden = !menuRow;
    if (menuRow) ui.menuTargetLabel.textContent = removingInMenu ? `确认移除：${menuRow.name}` : `方案：${menuRow.name}`;
    ui.remove.textContent = removingInMenu ? "确认移除" : "移除";
    ui.remove.classList.toggle("danger", removingInMenu);
    ui.remove.classList.toggle("danger-text", !removingInMenu);
    ui.remove.title = removingInMenu ? `再次点击确认移除“${menuRow?.name || ""}”` : "";
    for (const node of [ui.renameButton, ui.remove]) node.disabled = busy || !menuRow || Boolean(failure);
    ui.stop.hidden = !row || row.id !== menuId;
    ui.stop.disabled = busy || !row || row.id !== menuId;
    if (!ui.menu.hidden && menuId && !menuRow) setMenu(false);

    ui.exportButton.disabled = busy || !active.length || Boolean(failure);
    ui.simulatorExportButton.hidden = !combat;
    for (const node of [ui.simulatorExportButton, ui.simulatorSource, ui.simulatorTarget, ui.simulatorCopy, ui.simulatorDownload])
      node.disabled = busy || Boolean(failure);
    ui.simulatorCancel.disabled = busy;
    ui.importButton.disabled = busy || Boolean(failure);
    ui.undoButton.hidden = !undo;
    ui.undoButton.disabled = busy || Boolean(failure);
    ui.notice.hidden = !undo && !ui.status.textContent;
    ui.retry.disabled = busy;

    const inlineConfirm = updating || removingDirect || removingInMenu;
    ui.confirm.hidden = !confirmation || inlineConfirm;
    if (confirmation && !inlineConfirm) {
      const pending = confirmation;
      ui.confirmText.textContent = pending.action === "remove" ? `移除“${pending.row.name}”？` : `改名：${pending.row.name}`;
      ui.rename.hidden = pending.action !== "rename";
      if (ui.rename.dataset.id !== pending.row.id) {
        ui.rename.value = pending.row.name;
        ui.rename.dataset.id = pending.row.id;
      }
      ui.commit.textContent = pending.action === "remove" ? "确认移除" : "保存";
      ui.commit.classList.toggle("danger", pending.action === "remove");
      ui.commit.classList.toggle("primary", pending.action !== "remove");
      ui.commit.disabled = busy || Boolean(failure);
      ui.cancel.disabled = busy;
    }

    ui.activeScene.hidden = !row && !failure;
    ui.activeActions.hidden = !row || Boolean(failure);
    ui.stopDirect.hidden = !row;
    ui.list.replaceChildren();

    if (failure) {
      clearHighlights();
      ui.activeName.textContent = row ? row.name : "读取异常";
      ui.activeSep.hidden = false;
      ui.summary.textContent = "无法核对";
      ui.diffToggle.setAttribute("aria-label", `${ui.activeName.textContent}：无法核对`);
      ui.summary.classList.add("pending");
      ui.activeScene.dataset.state = "diff";
      ui.diffCaret.hidden = true;
      setDiffOpen(false);
      return;
    }
    if (!row) {
      clearHighlights();
      ui.summary.textContent = "";
      ui.diffToggle.removeAttribute("aria-label");
      setDiffOpen(false);
      return;
    }

    let changes;
    try { changes = currentDiff(context, row); }
    catch (error) {
      clearHighlights();
      message(error.message, true);
      ui.activeName.textContent = row.name;
      ui.summary.textContent = "无法核对";
      ui.diffToggle.setAttribute("aria-label", `${row.name}：无法核对`);
      ui.activeScene.dataset.state = "diff";
      ui.diffCaret.hidden = true;
      setDiffOpen(false);
      return;
    }

    const missing = changes.filter(change => !Adapter.target(context, change)).length;
    ui.activeName.textContent = row.name;
    ui.activeSep.hidden = false;
    ui.summary.textContent = changes.length ? `${changes.length} 项差异${missing ? ` · ${missing} 项未定位` : ""}` : "配装已一致";
    ui.diffToggle.setAttribute("aria-label", changes.length ? `差异清单：${row.name}，${ui.summary.textContent}` : `${row.name}：配装已一致`);
    ui.summary.classList.toggle("pending", Boolean(changes.length));
    ui.activeScene.dataset.state = changes.length ? "diff" : "match";
    ui.diffCaret.hidden = !changes.length;
    ui.diffToggle.disabled = !changes.length;

    for (const change of changes) {
      const li = el("li", null, { tabindex: "-1" }), title = el("div", null, { class: "change-title" });
      title.append(el("strong", change.label));
      const destination = Adapter.target(context, change);
      if (destination) title.append(button("定位", () => {
        destination.scrollIntoView({ block: "center", behavior: "instant" });
        destination.removeAttribute("data-mwi-scene-pulse");
        void destination.offsetWidth;
        destination.setAttribute("data-mwi-scene-pulse", "");
      }, { "aria-label": `定位${change.label}` }));
      else title.append(el("span", "未定位", { class: "unlocated-tag" }));
      const values = el("div", null, { class: "values" });
      const fromText = Adapter.describe(context, change, change.from);
      const toText = Adapter.describe(context, change, change.to);
      values.append(
        el("div", fromText, { class: "current", "aria-label": `当前：${fromText}` }),
        el("span", "→", { class: "arrow", "aria-hidden": "true" }),
        el("div", toText, { class: "goal", "aria-label": `目标：${toText}` })
      );
      li.append(title, values);
      if (change.kind.endsWith("_trigger")) {
        const details = el("details", null);
        details.append(el("summary", "完整数据"), el("pre", JSON.stringify({ current: change.from, target: change.to }, null, 2)));
        li.append(details);
      }
      ui.list.append(li);
    }

    if (!changes.length) setDiffOpen(false);
    else if (missing) setDiffOpen(true);
    else setDiffOpen(diffOpen);
    syncTargets(changes);
    syncPicker();
  }

  function tick() {
    if (document.hidden) return;
    app.Overview.sync();
    try {
      const ctx = Adapter.current();
      if (!ctx) { if (mounted) detach(); return; }
      const recovered = Boolean(failure);
      failure = "";
      document.querySelector("#mwi-loadout-scenes-unavailable")?.remove();
      if (!mounted || context.scope !== ctx.scope || context.details !== ctx.details || !mounted.host.isConnected) {
        detach();
        mount(ctx);
        last = Core.stable(ctx.raw);
        return;
      }
      const fingerprint = Core.stable(ctx.raw);
      context = ctx;
      if (ctx.overviewTab && ctx.overviewTab !== activeTab) setTab(ctx.overviewTab, false);
      if (last !== fingerprint || recovered || highlighted.some(node => !node.isConnected || !node.hasAttribute("data-mwi-scene-change")) ||
          highlightedSlots.some(node => !node.isConnected) ||
          [...markers.values()].some(marker => !marker.host.isConnected) || unresolved.some(change => Adapter.target(ctx, change))) {
        if (last !== fingerprint) app.Cloud?.observeNative?.(ctx.props.characterInfo.characterID, ctx.raw.id, ctx.raw);
        mounted.cloud.update(rows, ctx);
        last = fingerprint;
        cachedDiffKey = "";
        render();
        if (recovered) message("");
      }
      syncPicker();
    } catch (error) {
      if (mounted) {
        failure = error.message;
        clearHighlights();
        render();
        message(error.message, true);
      } else {
        const details = [...document.querySelectorAll('[class*="LoadoutsPanel_details__"]')].filter(node => node.getClientRects().length);
        if (details.length === 1 && !document.querySelector("#mwi-loadout-scenes-unavailable")) {
          const notice = el("p", `子方案：${error.message}`, { id: "mwi-loadout-scenes-unavailable", role: "status" });
          details[0].prepend(notice);
        }
      }
    }
  }

  function start() {
    app.Cloud.start(scope => {
      channel?.postMessage({ scope });
      if (context?.scope === scope) reload();
    }, (character, id) => {
      if (mounted && context?.props.characterInfo.characterID === character && context.raw.id === id) {
        mounted.cloud.update(rows, context);
      }
    });
    app.ActionMemory.start();
    app.Overview.start();
    const style = el("style", [
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_playerModel__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not(.mwi-overview-tools),',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_abilities__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not([class*="LoadoutsPanel_label__"]),',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_consumables__"] > :not([data-mwi-scene-change]):not([data-mwi-scene-slot-change]):not([class*="LoadoutsPanel_label__"]) { opacity: 0.42; transition: opacity .15s ease; }',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_playerModel__"] > :hover,',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_abilities__"] > :hover,',
      '[data-mwi-scene-comparing] [class*="LoadoutsPanel_consumables__"] > :hover { opacity: 1; }',
      '[data-mwi-scene-slot-change]:not([data-mwi-scene-change]) { position: relative; z-index: 1; outline: 1.5px dashed rgba(255, 190, 79, 0.82) !important; outline-offset: 0 !important; border-radius: 6px !important; background: rgba(255, 190, 79, 0.08) !important; }',
      '[data-mwi-scene-change] { position: relative; z-index: 2; outline: 2px solid #ffbe4f !important; outline-offset: 0 !important; border-radius: 6px !important; background: rgba(255, 190, 79, 0.16) !important; box-shadow: 0 0 0 1px rgba(255, 190, 79, 0.48), 0 0 12px rgba(255, 190, 79, 0.36), inset 0 0 10px rgba(255, 190, 79, 0.15) !important; }',
      '[data-mwi-scene-change] [class*="Item_itemContainer__"], [data-mwi-scene-change] [class*="Ability_ability__"] { box-shadow: inset 0 0 0 2px rgba(255, 210, 122, 0.88) !important; }',
      '[data-mwi-scene-target] { position: relative; z-index: 2; outline: 3px solid #70b7ff !important; outline-offset: -3px !important; border-radius: 6px !important; background: rgba(112, 183, 255, 0.2) !important; box-shadow: inset 0 0 0 5px #171822, 0 0 0 2px rgba(112, 183, 255, 0.6), 0 0 14px rgba(112, 183, 255, 0.6) !important; }',
      'li[data-mwi-scene-target], [role="option"][data-mwi-scene-target], [class*="CombatTriggersSetting_combatTriggersEditMenu__"] [data-mwi-scene-target] { outline: 2px solid #70b7ff !important; outline-offset: -1px !important; background: rgba(112, 183, 255, 0.22) !important; box-shadow: 0 0 0 1px rgba(112, 183, 255, 0.55), 0 0 10px rgba(112, 183, 255, 0.45) !important; }',
      'li[data-mwi-scene-target], [role="option"][data-mwi-scene-target] { color: #ffffff !important; font-weight: 600 !important; }',
      '[data-mwi-scene-prefilled] { position: relative; z-index: 2; outline: 2px solid #6ad89a !important; outline-offset: -1px !important; border-radius: 6px !important; background: rgba(106, 216, 154, 0.14) !important; box-shadow: 0 0 10px rgba(106, 216, 154, 0.34) !important; }',
      '[data-mwi-picker-guide], [data-mwi-trigger-guide] { margin: 0 0 6px; padding: 6px 8px; border-radius: 6px; background: #141826; border: 1px solid rgba(112, 183, 255, 0.38); border-left: 3px solid #70b7ff; color: #eef0f8; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif; text-align: left; }',
      '[data-mwi-picker-guide][data-state="warn"], [data-mwi-trigger-guide][data-state="warn"] { border-color: rgba(242, 196, 109, 0.45); border-left-color: #f2c46d; color: #ffe3a8; }',
      '[data-mwi-trigger-guide][data-state="ready"] { border-color: rgba(106, 216, 154, 0.45); border-left-color: #6ad89a; color: #d8fbe6; }',
      '[data-mwi-picker-guide] .mwi-guide-title, [data-mwi-trigger-guide] .mwi-guide-title { font-weight: 600; }',
      '[data-mwi-trigger-guide] .mwi-guide-list { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li { display: flex; align-items: baseline; gap: 5px; font-size: 11.5px; color: #d4daf0; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li.is-done { color: #9ee6bc; }',
      '[data-mwi-trigger-guide] .mwi-guide-mark { flex: 0 0 auto; font-weight: 700; color: #70b7ff; }',
      '[data-mwi-trigger-guide] .mwi-guide-list li.is-done .mwi-guide-mark { color: #6ad89a; }',
      '[data-mwi-trigger-guide] .mwi-guide-tag { margin-left: auto; padding: 0 5px; border-radius: 4px; background: rgba(106, 216, 154, 0.18); color: #8be6b2; font-size: 10.5px; font-weight: 600; white-space: nowrap; }',
      '@keyframes mwiScenePulse { 0% { box-shadow: 0 0 0 0 rgba(255, 190, 79, 0.88), 0 0 18px rgba(255, 190, 79, 0.72); } 100% { box-shadow: 0 0 0 10px rgba(255, 190, 79, 0), 0 0 12px rgba(255, 190, 79, 0.36); } }',
      '[data-mwi-scene-pulse] { animation: mwiScenePulse .65s ease-out; }',
      '@media (prefers-reduced-motion: reduce) { [data-mwi-scene-pulse] { animation: none !important; } }'
    ].join("\n"));
    style.id = "mwi-loadout-scenes-highlight-style";
    document.head.append(style);
    const panelSelector = '[class*="LoadoutsPanel_loadoutsPanel__"]';
    const ownedSelector = '.mwi-overview-cloud, .mwi-overview-cloud-btn, .mwi-overview-scene-count, [data-mwi-overview-status], #mwi-loadout-scenes-host, #mwi-loadout-scenes-unavailable, [data-mwi-scene-marker], [data-mwi-picker-guide], [data-mwi-trigger-guide]';
    const options = { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "aria-hidden", "style", "class"] };
    const observer = new MutationObserver(records => {
      const relevant = records.some(record => {
        const target = record.target;
        if (target.nodeType !== 1 || target.closest(ownedSelector)) return false;
        if (record.type === "attributes") return Boolean(target.closest(panelSelector) || target.querySelector(panelSelector));
        const nodes = [...record.addedNodes, ...record.removedNodes].filter(node =>
          node.nodeType !== 1 || !node.matches(ownedSelector));
        return nodes.length && (target.closest(panelSelector) || nodes.some(node => node.nodeType === 1 &&
          (node.matches(panelSelector) || node.querySelector(panelSelector))));
      });
      if (!relevant) { schedulePickerSync(); return; }
      observer.disconnect();
      try { tick(); } finally { observer.observe(document.documentElement, options); }
    });
    tick();
    observer.observe(document.documentElement, options);
    setInterval(tick, 650);
    channel?.addEventListener("message", event => { if (event.data?.scope === context?.scope) reload(); });
    document.addEventListener("input", event => {
      if (event.target?.closest?.('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]')) schedulePickerSync();
    }, true);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); reload(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(globalThis);