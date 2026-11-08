(function (root) {
  "use strict";
  if (!/^(www\.)?milkywayidle(cn)?\.com$/.test(location.hostname) || !/^\/game\/?$/.test(location.pathname)) return;
  const app = root.MWILoadoutScenes;
  if (app.started) return;
  app.started = true;
  const { Core, Adapter, Store } = app;
  const css = "__SCENE_CSS__";
  let mounted = null, context = null, rows = [], selectedId = null, busy = false, undo = null, confirmation = null;
  let last = "", loading = 0, failure = "", highlighted = [], unresolved = [];
  const markers = new Map();
  let menuId = null, pickerHighlights = [];
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel("mwi-layu-loadout-scenes") : null;
  function el(tag, text, attrs = {}) {
    const node = document.createElement(tag);
    if (text !== null) node.textContent = text;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  function button(text, handler, attrs = {}) {
    const node = el("button", text, { type: "button", ...attrs });
    node.addEventListener("click", handler); return node;
  }
  function iconButton(kind, label, handler, attrs = {}) {
    const node = button(null, handler, { class: "icon-button", "aria-label": label, title: label, ...attrs });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 18 18"); svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = kind === "add" ? '<path d="M9 3v12M3 9h12"/>' : '<circle cx="3" cy="9" r=".8"/><circle cx="9" cy="9" r=".8"/><circle cx="15" cy="9" r=".8"/>';
    node.append(svg); return node;
  }
  const activeRows = () => rows.filter(row => !row.removedAt).sort((a,b) => a.createdAt - b.createdAt);
  const selected = () => activeRows().find(row => row.id === selectedId);
  function message(text, error = false) {
    if (!mounted) return;
    mounted.status.textContent = text; mounted.status.classList.toggle("error", error);
    mounted.status.hidden = !text; mounted.retry.hidden = !error;
    mounted.notice.hidden = !text && !undo;
  }
  function clearHighlights() {
    for (const element of highlighted) element.removeAttribute("data-mwi-scene-change");
    highlighted = []; unresolved = [];
    for (const node of pickerHighlights) node.removeAttribute("data-mwi-scene-target");
    pickerHighlights = [];
    for (const { host } of markers.values()) host.remove();
    markers.clear();
  }
  function detach() {
    loading++; clearHighlights(); mounted?.host.remove(); mounted = null; context = null; rows = []; selectedId = null;
    last = ""; undo = null; confirmation = null;
  }
  function currentContext() {
    const fresh = Adapter.current();
    if (!fresh || fresh.scope !== context?.scope || fresh.details !== context.details) throw Error("当前角色或父配装已变化，请在对应配装下重试。");
    return fresh;
  }
  function notify(scope) { channel?.postMessage({ scope }); }
  async function reload() {
    const token = ++loading, scope = context?.scope;
    if (!scope) return;
    try {
      const result = await Store.list(scope);
      if (token !== loading || context?.scope !== scope) return;
      rows = result;
      if (!selected()) selectedId = null;
      render(); message(failure, Boolean(failure));
    } catch (error) { if (token === loading) message(error.message, true); }
  }
  async function run(work) {
    if (busy || !mounted) return;
    const ui = mounted;
    busy = true; render();
    let success = false;
    try { await work(); success = mounted === ui; }
    catch (error) { if (mounted === ui) message(error.message || "操作失败，请重试。", true); }
    finally { busy = false; if (mounted) render(); }
    return success;
  }
  async function saveNew() {
    const success = await run(async () => {
      const ctx = currentContext(), title = Core.name(mounted.name.value), ui = mounted;
      const row = await Store.create(ctx, title);
      notify(ctx.scope);
      if (mounted !== ui) return;
      selectedId = row.id; mounted.name.value = ""; mounted.form.hidden = true;
      await reload(); if (mounted === ui) message(`已保存“${row.name}”`);
    });
    if (success) mounted.add.focus();
  }
  function requestAction(action) {
    const row = action === "snapshot" ? selected() : activeRows().find(row => row.id === menuId);
    if (!row) return;
    confirmation = { action, row }; mounted.form.hidden = true; setMenu(false); render();
    (action === "rename" ? mounted.rename : mounted.commit).focus();
  }
  async function commitAction() {
    const pending = confirmation;
    if (!pending) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const row = await Store.mutate(ctx, pending.row, pending.action, mounted.rename.value);
      notify(ctx.scope);
      if (mounted !== ui) return;
      if (pending.action === "remove") { undo = row; if (selectedId === row.id) selectedId = null; }
      confirmation = null; await reload();
      if (mounted !== ui) return;
      message(pending.action === "remove" ? `已移除“${row.name}”` : `已${pending.action === "rename" ? "改名" : "更新"}“${row.name}”`);
    });
    if (success) mounted.add.focus();
  }
  async function restore() {
    const row = undo;
    if (!row) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const restored = await Store.mutate(ctx, row, "restore"); notify(ctx.scope);
      if (mounted !== ui) return;
      undo = null; selectedId = restored.id; await reload(); if (mounted === ui) message(`已恢复“${restored.name}”`);
    });
    if (success) mounted.add.focus();
  }
  function download() {
    try {
      const ctx = currentContext(), text = Store.exportBackup(ctx, rows);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const link = el("a", "", { href: url, download: `配装子方案-${ctx.raw.id}-${new Date().toISOString().slice(0,10)}.json` });
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMenu(false); message("已导出");
    } catch (error) { message(error.message, true); }
  }
  function setMenu(open) {
    if (!mounted) return;
    mounted.menu.hidden = !open;
    for (const node of mounted.choices.querySelectorAll("button")) node.setAttribute("aria-expanded", String(open && (node.dataset.sceneId || null) === menuId));
  }
  function bindMenu(node, id) {
    let timer = null, start = null, suppress = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    const open = () => {
      if (busy || !node.isConnected || !mounted) return;
      menuId = id; confirmation = null; mounted.form.hidden = true;
      render(); setMenu(true); mounted.menu.querySelector("button:not(:disabled)")?.focus();
    };
    node.setAttribute("aria-controls", "scene-menu"); node.setAttribute("aria-expanded", "false");
    node.addEventListener("contextmenu", event => { event.preventDefault(); cancel(); open(); });
    node.addEventListener("keydown", event => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); open(); }
    });
    node.addEventListener("pointerdown", event => {
      cancel(); suppress = false;
      if (event.button !== 0 || event.isPrimary === false) return;
      start = { x: event.clientX, y: event.clientY };
      timer = setTimeout(() => { timer = null; suppress = true; open(); }, 550);
    });
    node.addEventListener("pointermove", event => {
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"]) node.addEventListener(type, cancel);
    node.addEventListener("click", event => { if (suppress) { suppress = false; event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  }
  function syncPicker() {
    let next = [];
    if (mounted && context && selected() && !failure) {
      try { next = Adapter.pickerTargets(context, Core.diff(context.raw, selected().snapshot)); } catch (_) { /* Unknown picker: retain the slot guide. */ }
    }
    for (const node of pickerHighlights) if (!next.includes(node)) node.removeAttribute("data-mwi-scene-target");
    for (const node of next) node.setAttribute("data-mwi-scene-target", "");
    pickerHighlights = next;
  }
  function showNew() {
    if (busy || failure) return;
    confirmation = null; setMenu(false); mounted.form.hidden = false; render(); mounted.name.focus();
  }
  function closeEditor() {
    confirmation = null; mounted.form.hidden = true; render(); mounted.add.focus();
  }
  function stopComparison() {
    selectedId = null; confirmation = null; setMenu(false); render(); message(""); mounted.add.focus();
  }
  function mount(ctx) {
    const host = el("div", null, { id: "mwi-loadout-scenes-host" }), shadow = host.attachShadow({ mode: "open" });
    shadow.append(el("style", css));
    const section = el("section", null, { "aria-labelledby": "scene-title" });
    const header = el("div", null, { class: "header" });
    const heading = el("h2", "子方案", { id: "scene-title" });
    const update = button("更新", () => requestAction("snapshot"));
    header.append(heading, update);
    const choices = el("div", null, { class: "choices", "aria-label": "已保存的子方案" });
    const add = iconButton("add", "新建子方案", showNew); choices.append(add); bindMenu(add, null);
    const form = el("form", null, { class: "editor", hidden: "" }), label = el("label", "新建子方案", { for: "scene-name" });
    const name = el("input", null, { id: "scene-name", maxlength: "60", autocomplete: "off", "aria-label": "新子方案名称" });
    const save = el("button", "保存", { type: "submit", class: "primary" });
    const formActions = el("div", null, { class: "actions" });
    const cancelNew = button("取消", () => { form.hidden = true; mounted.add.focus(); });
    form.addEventListener("submit", event => { event.preventDefault(); saveNew(); });
    formActions.append(cancelNew, save); form.append(label, name, formActions);
    const menu = el("div", null, { id: "scene-menu", class: "menu", hidden: "", "aria-label": "方案管理" });
    const renameButton = button("改名", () => requestAction("rename"));
    const remove = button("移除", () => requestAction("remove"));
    const stop = button("结束对比", stopComparison);
    const exportButton = button("导出全部", download);
    const file = el("input", null, { type: "file", accept: ".json,application/json", "aria-label": "选择子方案备份", hidden: "" });
    const importButton = button("导入备份", () => file.click());
    file.addEventListener("change", () => run(async () => {
      const input = file.files?.[0]; if (!input) return;
      if (input.size > 5000000) throw Error("备份超过 5 MB，未导入。");
      const ctx = currentContext(), ui = mounted, text = await input.text();
      if (currentContext().scope !== ctx.scope) throw Error("当前父配装已变化，未导入备份，请在原配装下重试。");
      const count = await Store.importBackup(ctx, text); notify(ctx.scope);
      if (mounted !== ui) return;
      file.value = ""; setMenu(false); await reload(); message(`已导入 ${count} 项`);
    }));
    menu.append(renameButton, remove, stop, exportButton, importButton, file);
    const confirm = el("div", null, { class: "editor", hidden: "" }), confirmText = el("p", "");
    const rename = el("input", null, { maxlength: "60", "aria-label": "修改子方案名称" });
    const confirmRow = el("div", null, { class: "actions" });
    const commit = button("", commitAction, { class: "primary" });
    const cancel = button("取消", closeEditor);
    confirmRow.append(cancel, commit); confirm.append(confirmText, rename, confirmRow);
    const notice = el("div", null, { class: "notice" });
    const status = el("p", "", { id: "status", role: "status", "aria-live": "polite" });
    const undoButton = button("撤销", restore, { hidden: "", "aria-label": "撤销移除" });
    const retry = button("重试", () => { tick(); reload(); }, { hidden: "" });
    notice.append(status, undoButton, retry);
    const differences = el("details", null, { id: "scene-differences", hidden: "" });
    const summaryControl = el("summary", null), summary = el("span", "", { id: "summary", role: "status", "aria-live": "polite" });
    summaryControl.append(summary);
    const list = el("ol", null, { "aria-label": "需要手动修改的项目" }); differences.append(summaryControl, list);
    section.append(header, choices, menu, form, confirm, notice, differences);
    shadow.append(section); ctx.details.insertBefore(host, ctx.setup);
    shadow.addEventListener("keydown", event => {
      if (event.key === "Escape" && !busy) { setMenu(false); closeEditor(); }
    });
    shadow.addEventListener("focusout", event => {
      if (!host.matches(":focus-within") && !shadow.contains(event.relatedTarget)) setMenu(false);
    });
    mounted = { host, shadow, choices, add, menu, form, name, save, cancelNew, update, renameButton, remove, stop, undoButton,
      confirm, confirmText, rename, commit, cancel, notice, status, retry, differences, summary, list, exportButton, importButton };
    context = ctx; rows = []; selectedId = null; undo = null; confirmation = null;
    render();
    // Keep loading in the choices row so removing a temporary notice won't move native controls.
    choices.querySelector(".empty").textContent = "读取中…";
    reload();
  }
  function syncTargets(changes) {
    const targets = new Set(), groups = new Map();
    unresolved = [];
    for (const [index, change] of changes.entries()) {
      const destination = Adapter.target(context, change);
      if (!destination) { unresolved.push(change); continue; }
      targets.add(destination);
      // Trigger buttons remain untouched; their marker shares the containing slot.
      let slot = Adapter.target(context, { ...change, kind: change.kind.replace(/_trigger$/, "") });
      if (change.kind === "setting") slot = slot?.closest('[class*="LoadoutsPanel_metadata__"]') || slot;
      if (slot?.matches("label")) slot = slot.parentElement;
      if (!slot) continue;
      const entries = groups.get(slot) || [];
      entries.push({ change, index }); groups.set(slot, entries);
    }
    for (const old of highlighted) if (!targets.has(old)) old.removeAttribute("data-mwi-scene-change");
    for (const node of targets) node.setAttribute("data-mwi-scene-change", "");
    highlighted = [...targets];
    for (const [slot, marker] of markers) if (!groups.has(slot) || !marker.host.isConnected) { marker.host.remove(); markers.delete(slot); }
    for (const [slot, entries] of groups) {
      let marker = markers.get(slot);
      const key = Core.stable(entries.map(({ change, index }) => [index, change.label, Adapter.describe(context, change, change.to)]));
      if (!marker) {
        const host = el("span", null, { "data-mwi-scene-marker": "" }), shadow = host.attachShadow({ mode: "open" });
        const content = el("div", null, { class: "target-markers" }); shadow.append(el("style", css), content);
        // Never let marker interactions bubble into a native equipment picker.
        for (const type of ["click", "dblclick", "pointerdown", "keydown"]) host.addEventListener(type, event => event.stopPropagation());
        slot.append(host); marker = { host, content, key: null }; markers.set(slot, marker);
      }
      if (marker.key === key) continue;
      marker.key = key; marker.content.replaceChildren();
      for (const { change, index } of entries) {
        const goal = Adapter.describe(context, change, change.to);
        if (change.kind.endsWith("_trigger")) {
          const node = button(change.to.length ? `条件 ${change.to.length} 项` : "无附加条件", () => {
            mounted.differences.open = true;
            const item = mounted.list.children[index];
            item?.querySelector("details")?.setAttribute("open", ""); item?.focus({ preventScroll: true });
            item?.scrollIntoView({ block: "center", behavior: "instant" });
          }, { class: "target-condition", "aria-label": `${change.label}：${goal}` });
          marker.content.append(node);
        } else marker.content.append(el("span", `→ ${goal}`, { class: "target-value", "aria-label": `${change.label}目标：${goal}` }));
      }
    }
  }
  function render() {
    if (!mounted || !context) return;
    const ui = mounted, active = activeRows(), row = selected();
    const existing = new Map([...ui.choices.querySelectorAll("button[data-scene-id]")].map(node => [node.dataset.sceneId, node]));
    for (const [id, node] of existing) if (!active.some(entry => entry.id === id)) node.remove();
    ui.choices.querySelector("p")?.remove();
    active.forEach((entry, index) => {
      let choice = existing.get(entry.id);
      if (!choice) { choice = button(entry.name, () => {
        selectedId = entry.id; confirmation = null; setMenu(false); ui.form.hidden = true;
        ui.differences.open = false; render(); message(failure, Boolean(failure));
      }, { "data-scene-id": entry.id }); bindMenu(choice, entry.id); }
      if (choice.textContent !== entry.name) choice.textContent = entry.name;
      choice.setAttribute("aria-pressed", String(entry.id === selectedId));
      choice.disabled = busy;
      if (ui.choices.children[index] !== choice) ui.choices.insertBefore(choice, ui.choices.children[index] || ui.add);
    });
    if (!active.length) ui.choices.insertBefore(el("p", "暂无方案", { class: "empty" }), ui.add);
    ui.save.disabled = ui.add.disabled = busy || Boolean(failure);
    ui.cancelNew.disabled = busy;
    ui.update.disabled = busy || !row || Boolean(failure);
    const menuRow = active.find(entry => entry.id === menuId);
    for (const node of [ui.renameButton, ui.remove]) node.disabled = busy || !menuRow || Boolean(failure);
    ui.stop.disabled = busy || !row || row.id !== menuId;
    if (!ui.menu.hidden && menuId && !menuRow) setMenu(false);
    ui.exportButton.disabled = busy || !active.length || Boolean(failure); ui.importButton.disabled = busy || Boolean(failure);
    ui.undoButton.hidden = !undo; ui.undoButton.disabled = busy || Boolean(failure);
    ui.notice.hidden = !undo && !ui.status.textContent;
    ui.retry.disabled = busy;
    ui.confirm.hidden = !confirmation;
    if (confirmation) {
      const pending = confirmation;
      ui.confirmText.textContent = pending.action === "snapshot" ? `更新“${pending.row.name}”？` :
        pending.action === "remove" ? `移除“${pending.row.name}”？` : "改名";
      ui.rename.hidden = pending.action !== "rename";
      if (ui.rename.dataset.id !== pending.row.id) { ui.rename.value = pending.row.name; ui.rename.dataset.id = pending.row.id; }
      ui.commit.textContent = { snapshot: "更新方案", remove: "移除", rename: "保存" }[pending.action];
      ui.commit.disabled = busy || Boolean(failure); ui.cancel.disabled = busy;
    }
    ui.differences.hidden = !row && !failure;
    ui.list.replaceChildren();
    if (failure) { clearHighlights(); ui.summary.textContent = "无法核对"; return; }
    if (!row) { clearHighlights(); ui.summary.textContent = ""; return; }
    let changes;
    try { changes = Core.diff(context.raw, row.snapshot); }
    catch (error) { clearHighlights(); message(error.message, true); ui.summary.textContent = "无法核对"; return; }
    const missing = changes.filter(change => !Adapter.target(context, change)).length;
    ui.summary.textContent = changes.length ? `${changes.length} 项差异${missing ? ` · ${missing} 项未定位` : ""}` : "配装已一致";
    if (missing) ui.differences.open = true;
    ui.summary.classList.toggle("pending", Boolean(changes.length));
    for (const change of changes) {
      const li = el("li", null, { tabindex: "-1" }), title = el("div", null, { class: "change-title" });
      title.append(el("strong", change.label));
      const destination = Adapter.target(context, change);
      if (destination) title.append(button("定位", () => destination.scrollIntoView({ block: "center", behavior: "instant" }), { "aria-label": `定位${change.label}` }));
      else title.append(el("span", "未定位", { class: "muted" }));
      const values = el("div", null, { class: "values" });
      values.append(el("div", Adapter.describe(context, change, change.from), { class: "current", "aria-label": `当前：${Adapter.describe(context, change, change.from)}` }),
        el("span", "→", { class: "arrow", "aria-hidden": "true" }), el("div", Adapter.describe(context, change, change.to), { class: "goal", "aria-label": `目标：${Adapter.describe(context, change, change.to)}` }));
      li.append(title, values);
      if (change.kind.endsWith("_trigger")) {
        const details = el("details", null); details.append(el("summary", "完整数据"),
          el("pre", JSON.stringify({ current: change.from, target: change.to }, null, 2))); li.append(details);
      }
      ui.list.append(li);
    }
    syncTargets(changes); syncPicker();
  }
  function tick() {
    if (document.hidden) return;
    try {
      const ctx = Adapter.current();
      if (!ctx) { if (mounted) detach(); return; }
      const recovered = Boolean(failure); failure = "";
      document.querySelector("#mwi-loadout-scenes-unavailable")?.remove();
      if (!mounted || context.scope !== ctx.scope || context.details !== ctx.details || !mounted.host.isConnected) {
        detach(); mount(ctx); last = Core.stable(ctx.raw); return;
      }
      const fingerprint = Core.stable(ctx.raw);
      context = ctx;
      if (last !== fingerprint || recovered || highlighted.some(node => !node.isConnected) || [...markers.values()].some(marker => !marker.host.isConnected) || unresolved.some(change => Adapter.target(ctx, change))) {
        last = fingerprint; render(); if (recovered) message("");
      }
      syncPicker();
    } catch (error) {
      if (mounted) {
        failure = error.message; clearHighlights(); render(); message(error.message, true);
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
    app.ActionMemory.start();
    const style = el("style", '[data-mwi-scene-change] { outline: 2px solid #ffd27a !important; outline-offset: 3px !important; } [data-mwi-scene-target] { outline: 3px solid #ffd27a !important; outline-offset: -3px !important; box-shadow: inset 0 0 0 5px #171822 !important; }');
    style.id = "mwi-loadout-scenes-highlight-style"; document.head.append(style);
    const panelSelector = '[class*="LoadoutsPanel_loadoutsPanel__"]';
    const ownedSelector = '#mwi-loadout-scenes-host, #mwi-loadout-scenes-unavailable, [data-mwi-scene-marker]';
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
      if (!relevant) { syncPicker(); return; }
      // Mutation delivery runs before paint. Disconnect while changing our own DOM to avoid feedback loops.
      observer.disconnect();
      try { tick(); } finally { observer.observe(document.documentElement, options); }
    });
    tick(); observer.observe(document.documentElement, options); setInterval(tick, 650);
    channel?.addEventListener("message", event => { if (event.data?.scope === context?.scope) reload(); });
    document.addEventListener("visibilitychange", () => { if (!document.hidden) { tick(); reload(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(globalThis);
