(function installEquipmentFilter(win) {
  "use strict";
  if (!(location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/")) ||
    win.__MWIEquipmentFilterInstalled) return;
  win.__MWIEquipmentFilterInstalled = true;
  const doc = document, catalog = win.MWIEquipmentCatalog, F = win.MWIEquipmentFilter;
  const state = { category: "all", min: "", max: "", search: "" };
  const entries = new Map();
  let toolbar, fields, toggle, summary, message, expanded = false, busy = false, scheduled = false;
  function el(tag, text) { const n = doc.createElement(tag); if (text !== undefined) n.textContent = text; return n; }
  function status(text, error = false) {
    if (message.textContent !== text) message.textContent = text;
    message.dataset.error = String(error);
  }
  function slotOf(input) {
    const label = F.normalize(input.getAttribute("aria-label"));
    return Object.keys(catalog.slots).find(slot => Object.values(catalog.slots[slot]).some(name => F.normalize(name) === label));
  }
  function sameName(text, name) {
    return F.normalize(text).replace(/^(?:lv\.?|等级)\s*\d+\s*/i, "") === F.normalize(name);
  }
  function active() { return F.active(state); }
  function layout(entry) {
    const native = entry.anchor.getBoundingClientRect(), row = entry.row.getBoundingClientRect();
    for (const [key, value] of Object.entries({ left: native.left - row.left, top: native.top - row.top,
      width: native.width, height: native.height })) {
      const text = `${value}px`; if (entry.select.style[key] !== text) entry.select.style[key] = text;
    }
  }
  function apply(entry) {
    const enabled = active() && !F.isExempt(entry.slot);
    if (!enabled) {
      entry.select.hidden = true; entry.current.hidden = true;
      if (entry.applied) {
        entry.anchor.style.opacity = entry.oldOpacity; entry.anchor.style.pointerEvents = entry.oldPointer;
        if (entry.oldAria === null) entry.anchor.removeAttribute("aria-hidden"); else entry.anchor.setAttribute("aria-hidden", entry.oldAria);
        if (entry.oldTab === null) entry.input.removeAttribute("tabindex"); else entry.input.setAttribute("tabindex", entry.oldTab);
      }
      entry.applied = false; entry.signature = ""; return;
    }
    if (!entry.applied) {
      entry.anchor.style.opacity = "0"; entry.anchor.style.pointerEvents = "none";
      entry.anchor.setAttribute("aria-hidden", "true"); entry.input.tabIndex = -1; entry.applied = true;
    }
    entry.select.hidden = false; entry.current.hidden = false; entry.select.disabled = busy;
    layout(entry);
    const locale = F.localeForLabel(catalog, entry.slot, entry.input.getAttribute("aria-label"));
    const key = JSON.stringify([state, entry.input.value, locale]);
    if (entry.signature === key) return;
    entry.signature = key;
    const candidates = F.options(catalog, entry.slot, state);
    entry.select.replaceChildren();
    const placeholder = el("option", candidates.length ? `选择装备 · ${candidates.length} 项` : "无符合条件的装备");
    placeholder.value = "__keep__"; placeholder.disabled = true; entry.select.append(placeholder);
    const none = el("option", locale === "en" ? "None" : "无"); none.value = ""; entry.select.append(none);
    let current = "__keep__";
    for (const item of candidates) {
      const option = el("option", `Lv${F.level(item, state.category)} ${item[locale]}`); option.value = item.hrid;
      if (sameName(entry.input.value, item[locale])) current = item.hrid;
      entry.select.append(option);
    }
    if (/^(?:无|None)$/i.test(entry.input.value.trim())) current = "";
    entry.select.value = current;
    const equipped = catalog.items.find(item => item.slot === entry.slot && sameName(entry.input.value, item[locale]));
    entry.current.textContent = `当前：${equipped ? `Lv${F.level(equipped)} ${equipped[locale]}` : entry.input.value || "无"}`;
  }
  function update(resetStatus = true) {
    const parts = [];
    if (state.category !== "all") parts.push(F.categories[state.category]);
    if (state.min !== "") parts.push(`≥ ${state.min}`);
    if (state.max !== "") parts.push(`< ${state.max}`);
    if (state.search.trim()) parts.push(`搜索“${state.search.trim()}”`);
    const text = parts.length ? parts.join(" · ") : "显示全部装备";
    if (summary.textContent !== text) summary.textContent = text;
    if (resetStatus) {
      if (!F.validRange(state)) status("等级范围为空：下限必须小于上限。", true);
      else if (!busy) status(active() ? "袋子、项链、戒指、耳环保留原列表；其他装备按条件筛选，已选装备保留。" : "按职业与穿戴等级筛选；袋子、项链、戒指、耳环不参与筛选。");
    }
    for (const entry of entries.values()) if (entry.row.isConnected) apply(entry);
  }
  async function wait(check, text) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const result = check(); if (result) return result;
      await new Promise(resolve => win.setTimeout(resolve, 30));
    }
    throw new Error(text);
  }
  async function choose(entry, hrid) {
    if (busy || hrid === "__keep__") return;
    const item = hrid ? F.options(catalog, entry.slot, state).find(candidate => candidate.hrid === hrid) : null;
    if (hrid && !item) throw new Error("候选已变化，请重新选择装备。");
    if ([...doc.querySelectorAll('[role="dialog"]')].some(node => node.getClientRects().length && !node.hidden))
      throw new Error("请先关闭网页弹窗，再选择装备。");
    if (!entry.row.isConnected || !/^#\/home(?:[/?]|$)/.test(location.hash)) throw new Error("装备面板已变化，请回到主页重试。");
    busy = true; update(); status("正在通过网页原生选择器换装…");
    let popup, oldPopupStyle, clicked = false;
    const originalDisplay = entry.input.value;
    try {
      const locale = F.localeForLabel(catalog, entry.slot, entry.input.getAttribute("aria-label"));
      const text = item ? item[locale] : "";
      if (entry.input.getAttribute("aria-expanded") !== "true") entry.trigger.click();
      popup = await wait(() => {
        const id = entry.input.getAttribute("aria-controls") || entry.trigger.getAttribute("aria-controls");
        return entry.input.getAttribute("aria-expanded") === "true" && doc.getElementById(id);
      }, "网页装备选择器未打开。请重置筛选，使用原列表重试。");
      // The native picker is used for the final choice only. Its unfiltered
      // first-60 preview must not flash over the complete filtered candidate list.
      oldPopupStyle = popup.style.opacity; popup.style.opacity = "0";
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(entry.input, text);
      entry.input.dispatchEvent(new win.Event("input", { bubbles: true }));
      const option = await wait(() => {
        const found = [...popup.querySelectorAll('[role="option"]')].filter(node => item
          ? sameName(node.textContent, text) : /^(?:无|None)$/i.test(node.textContent.trim()));
        return found.length === 1 ? found[0] : null;
      }, "网页目录中未能唯一找到这件装备。请重置筛选，使用网页原列表；当前配装未被主动替换。");
      option.click();
      clicked = true;
      await wait(() => entry.input.getAttribute("aria-expanded") !== "true", "网页尚未确认选择，请核对当前装备后重试。");
      await wait(() => item ? sameName(entry.input.value, text) : /^(?:无|None)$/i.test(entry.input.value.trim()),
        "网页尚未确认装备显示，请核对当前配装。");
      status(`已选择${entry.input.getAttribute("aria-label")}：${item ? item[locale] : "无"}。`);
    } catch (error) {
      entry.input.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      if (!clicked) Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value").set.call(entry.input, originalDisplay);
      status(error.message, true);
    } finally {
      if (popup?.isConnected) popup.style.opacity = oldPopupStyle;
      busy = false;
      for (const entry of entries.values()) { entry.signature = ""; apply(entry); }
      if (entry.select.isConnected && !entry.select.hidden) entry.select.focus();
    }
  }
  function makeToolbar(panel, heading) {
    toolbar = el("div"); toolbar.dataset.mwiEquipmentFilters = "";
    const head = el("div"); head.className = "mwi-ef-heading";
    toggle = el("button", "装备筛选"); toggle.type = "button"; toggle.setAttribute("aria-expanded", String(expanded));
    fields = el("div"); fields.className = "mwi-ef-fields"; fields.id = "mwi-equipment-filter-fields"; fields.hidden = !expanded;
    toggle.setAttribute("aria-controls", fields.id); toggle.onclick = () => { expanded = !expanded; fields.hidden = !expanded; toggle.setAttribute("aria-expanded", String(expanded)); };
    summary = el("span"); summary.className = "mwi-ef-summary"; head.append(toggle, summary);
    function selectField(label, key, values) {
      const wrap = el("label", label), select = el("select"); select.setAttribute("aria-label", label);
      for (const [value, title] of values) { const option = el("option", title); option.value = value; select.append(option); }
      select.value = state[key]; select.onchange = () => { state[key] = select.value; update(); }; wrap.append(select); fields.append(wrap);
    }
    selectField("职业", "category", Object.entries(F.categories));
    const levels = [...new Set(catalog.items.map(item => F.level(item)))].sort((a, b) => a - b);
    const bounds = [["", "全部"], ...levels.map(level => [String(level), String(level)])];
    selectField("等级：大于等于", "min", bounds); selectField("小于", "max", bounds);
    const wrap = el("label", "搜索装备"), search = el("input"); search.type = "search"; search.value = state.search;
    search.setAttribute("aria-label", "搜索装备"); search.placeholder = "名称或 HRID";
    search.oninput = () => { state.search = search.value; update(); }; wrap.append(search); fields.append(wrap);
    const reset = el("button", "重置筛选"); reset.type = "button";
    reset.onclick = () => { Object.assign(state, { category: "all", min: "", max: "", search: "" });
      for (const node of fields.querySelectorAll("select")) node.value = node.getAttribute("aria-label") === "职业" ? "all" : "";
      search.value = ""; update(); };
    fields.append(reset); message = el("p"); message.className = "mwi-ef-status"; message.setAttribute("role", "status"); message.setAttribute("aria-live", "polite");
    toolbar.append(head, fields, message); heading.after(toolbar);
    status("按职业与穿戴等级筛选；袋子、项链、戒指、耳环不参与筛选。");
  }
  function attach() {
    scheduled = false;
    for (const [row, entry] of entries) if (!row.isConnected) { entry.resize.disconnect(); entries.delete(row); }
    if (!/^#\/home(?:[/?]|$)/.test(location.hash)) return;
    const rows = [...doc.querySelectorAll("[data-equipment-input-row]")];
    if (!rows.length) return;
    const panels = [...new Set(rows.map(row => row.closest(".surface-panel")))].filter(Boolean);
    if (panels.length !== 1) return;
    const panel = panels[0], heading = panel.querySelector("h2"); if (!heading) return;
    if (!toolbar?.isConnected) makeToolbar(panel, heading);
    for (const row of rows) {
      const input = row.querySelector('input[role="combobox"]'); if (!input) continue;
      const slot = slotOf(input); if (!slot || F.isExempt(slot)) continue;
      let entry = entries.get(row);
      if (!entry) {
        const anchor = input.parentElement, trigger = anchor.querySelector("button"); if (!trigger) continue;
        const select = el("select"); select.dataset.mwiEquipmentSelect = slot;
        select.setAttribute("aria-label", `${input.getAttribute("aria-label")}（筛选装备）`); select.hidden = true;
        const current = el("p"); current.dataset.mwiEquipmentCurrent = slot; current.hidden = true;
        if (win.getComputedStyle(row).position === "static") row.style.position = "relative";
        row.append(select); row.after(current);
        entry = { row, slot, input, anchor, trigger, select, current, applied: false, signature: "",
          oldOpacity: anchor.style.opacity, oldPointer: anchor.style.pointerEvents,
          oldAria: anchor.getAttribute("aria-hidden"), oldTab: input.getAttribute("tabindex") };
        select.onchange = () => choose(entry, select.value).catch(error => status(error.message, true));
        entry.resize = new win.ResizeObserver(() => { if (entry.applied) layout(entry); }); entry.resize.observe(anchor);
        entries.set(row, entry);
      }
      const label = `${input.getAttribute("aria-label")}（筛选装备）`;
      if (entry.select.getAttribute("aria-label") !== label) entry.select.setAttribute("aria-label", label);
      apply(entry);
    }
    update(false);
  }
  function schedule() { if (!scheduled) { scheduled = true; win.requestAnimationFrame(attach); } }
  function start() {
    const style = el("style", "__EQUIPMENT_FILTER_CSS__"); style.dataset.mwiEquipmentFilterStyle = ""; doc.head.append(style);
    new win.MutationObserver(schedule).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "value"] });
    // Vue may update an input's value property without changing its HTML attribute.
    // Re-read visible controls after normal player selection/edit interactions.
    for (const event of ["click", "input", "change", "keyup"]) doc.addEventListener(event, schedule, true);
    win.addEventListener("hashchange", schedule); attach();
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})(window);
