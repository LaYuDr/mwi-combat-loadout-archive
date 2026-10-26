(function startArchive(root) {
  "use strict";
  const supported = location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    (location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/"));
  if (!supported || root.__MWILoadoutArchiveInstalled) return;
  root.__MWILoadoutArchiveInstalled = true;
  const C = root.MWILoadoutCore, S = root.MWILoadoutStore;
  let storePromise, rows = [], selected = "", query = "", filter = "all", draftName = "", slot = "1";
  let ui, panelOpen = false, busy = false, pendingFile = null, undo = null;
  let lastStatus = "等待主站一键导入，或导入网站的现代单人 JSON。", lastTone = "info";
  const date = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const db = () => storePromise ||= S.create().catch(error => { storePromise = null; throw error; });
  function node(tag, text, className) {
    const el = document.createElement(tag); if (text !== undefined) el.textContent = text;
    if (className) el.className = className; return el;
  }
  function button(text, fn, className) {
    const b = node("button", text, className); b.type = "button";
    b.addEventListener("click", () => { Promise.resolve().then(fn).catch(error => status(error.message, "error")); });
    return b;
  }
  function status(message, tone = "info") {
    lastStatus = message; lastTone = tone;
    if (!ui) return;
    ui.status.replaceChildren(document.createTextNode(message)); ui.status.dataset.tone = tone;
    if (undo) ui.status.append(button("撤销删除", async () => {
      const id = undo; undo = null;
      await (await db()).update(id, { deletedAt: null, updatedAt: Date.now() });
      await refresh(); status("档案已恢复。");
    }));
  }
  const bridge = root.MWILoadoutBridge.create({ core: C, pageWindow: root, origin: location.origin,
    onStatus: status,
    onImport: async (payload, capturedAt) => {
      const row = await C.prepare(payload, { now: capturedAt });
      const result = await (await db()).autoSave(row);
      await refresh();
      status(result === "saved" ? `${row.characterName} 的配装已归档。可另存命名配装，保留这一版本。`
        : result === "unchanged" ? `${row.characterName} 的配装没有变化，已保留现有档案。` : "较旧的导入回执已忽略，保留较新的配装。");
    }
  });
  root.addEventListener("message", bridge.observe);

  function visibleRows() {
    return rows.filter(row => (filter === "trash" ? !!row.deletedAt : !row.deletedAt) &&
      (!["named", "recent"].includes(filter) || row.kind === filter) &&
      `${row.name} ${row.characterName}`.toLowerCase().includes(query.toLowerCase()));
  }
  function choose(id) {
    selected = id; draftName = rows.find(row => row.id === id)?.name || ""; render();
  }
  async function refresh() {
    rows = (await (await db()).all()).sort((a, b) => b.updatedAt - a.updatedAt);
    if (!rows.some(row => row.id === selected)) { selected = ""; draftName = ""; }
    if (!selected && visibleRows().length) { selected = visibleRows()[0].id; draftName = visibleRows()[0].name; }
    render();
  }
  function exportRows(values) {
    if (!values.length) throw new Error("没有可导出的档案。");
    const blob = new Blob([C.exportFile(values)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = node("a");
    a.href = url; a.download = `MWI配装档案_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`;
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`已生成 ${values.length} 套配装的 JSON 备份。`);
  }
  async function addFile(file) {
    if (!file) return;
    pendingFile = null; renderImportPreview();
    if (file.size > C.MAX_BYTES * 10) throw new Error("文件超过 20 MB，请拆分后重试。");
    const entries = C.parseFile(await file.text());
    // All entries and hashes are checked before any database write.
    const prepared = await Promise.all(entries.map(async entry => {
      const identity = C.sanitizePayload(entry.payload);
      const row = await C.prepare(entry.payload, { id: `named:${crypto.randomUUID()}`, kind: "named",
        name: entry.name?.trim() || `${identity.characterName} · 文件配装` });
      if (Number.isFinite(entry.capturedAt) && entry.capturedAt > 0 && entry.capturedAt <= Date.now()) row.capturedAt = entry.capturedAt;
      return row;
    }));
    pendingFile = prepared; renderImportPreview();
    status(`已校验 ${prepared.length} 套配装，请点击“添加档案”完成导入。相同名称及内容会去重。`);
  }
  function renderImportPreview() {
    if (!ui) return;
    ui.importPreview.replaceChildren();
    if (!pendingFile) return;
    ui.importPreview.append(node("span", `${pendingFile.length} 套待导入`), button("添加档案", async () => {
      if (busy || !pendingFile) return;
      const prepared = pendingFile; busy = true; render();
      try {
        const count = await (await db()).addNamed(prepared); pendingFile = null;
        await refresh(); status(`已添加 ${count} 套配装，跳过 ${prepared.length - count} 套重复配装。`);
      } finally { busy = false; render(); }
    }, "primary"), button("取消导入", () => { pendingFile = null; renderImportPreview(); status("已取消文件导入。"); }));
  }
  function itemMark(hrid) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "item-mark"); svg.setAttribute("aria-hidden", "true");
    const symbol = document.getElementById(`mwi-item-icon-${hrid.slice(7)}`);
    // Reuse already-rendered local symbols only. Do not fetch assets or copy executable markup.
    if (symbol) {
      for (const part of symbol.querySelectorAll("path,rect,circle,ellipse,polygon,polyline,line,g")) {
        if (part.parentNode !== symbol) continue;
        const safe = document.createElementNS(svg.namespaceURI, part.tagName);
        for (const key of ["d", "fill", "stroke", "stroke-width", "x", "y", "width", "height", "cx", "cy", "r", "rx", "ry", "points", "transform"])
          if (part.hasAttribute(key) && !/url\s*\(/i.test(part.getAttribute(key))) safe.setAttribute(key, part.getAttribute(key));
        // Group nodes are intentionally omitted unless flat geometry is available.
        if (part.tagName !== "g") svg.append(safe);
      }
      if (symbol.hasAttribute("viewBox")) svg.setAttribute("viewBox", symbol.getAttribute("viewBox"));
    }
    if (!svg.childNodes.length) {
      const path = document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M4 7 12 3 20 7 20 17 12 21 4 17Z M4 7 12 11 20 7 M12 11V21");
      path.setAttribute("fill", "none"); path.setAttribute("stroke", "currentColor"); path.setAttribute("stroke-width", "1.5"); svg.append(path);
      const title = document.createElementNS(svg.namespaceURI, "title"); title.textContent = "物品图标未在本页加载，显示占位图标"; svg.append(title);
    }
    return svg;
  }
  function renderDetail() {
    const area = ui.detail; area.replaceChildren();
    const row = rows.find(r => r.id === selected && visibleRows().some(v => v.id === r.id));
    if (!row) {
      const empty = node("div", undefined, "detail-empty");
      empty.append(node("h3", "把这一套配装留下来"), node("p", "在网站“导入/导出”中使用主站一键导入，成功后会自动归档。", "muted"),
        node("p", "也可导入网站的现代单人 JSON，或本助手导出的备份。", "muted"),
        button("选择 JSON 文件", () => ui.file.click()), button("重新读取档案", () => refresh()));
      area.append(empty); return;
    }
    let info;
    try { info = C.details(row.payload); } catch (error) { area.append(node("p", error.message)); return; }
    area.append(node("h3", row.name), node("p", `角色：${row.characterName}`, "muted"),
      node("p", `数据采集：${date(row.capturedAt)}`, "note"),
      node("p", `来源：${row.sourceFormat} · 服务器未提供`, "note"));
    const scope = node("div", undefined, "scope");
    scope.append(node("p", "仅载入角色配装；地图、时长、市场估值和全局迷宫设置保持当前值。"));
    if (info.missing.length) scope.append(node("p", `源数据缺少或待核对：${info.missing.join("、")}。这些字段由网站规则处理，可能沿用原值或回退默认值，请载入后核对。`));
    area.append(scope);
    if (row.deletedAt) {
      area.append(button("恢复这份档案", async () => {
        await (await db()).update(row.id, { deletedAt: null, updatedAt: Date.now() }); undo = null;
        filter = "all"; ui.filter.value = filter; await refresh(); status("档案已恢复。");
      }, "primary"));
      return;
    }
    const naming = node("div", undefined, "name-field");
    const input = node("input"); input.value = draftName; input.maxLength = 120; input.setAttribute("aria-label", "配装名称");
    input.dataset.focus = "name"; input.addEventListener("input", () => { draftName = input.value; });
    naming.append(input, button(row.kind === "recent" ? "另存为配装" : "保存名称", async () => {
      const label = draftName.trim(); if (!label) throw new Error("请填写配装名称。");
      if (row.kind === "recent") {
        const copy = await C.prepare(row.payload, { id: `named:${crypto.randomUUID()}`, kind: "named", name: label });
        copy.capturedAt = row.capturedAt;
        const count = await (await db()).addNamed([copy]);
        if (count) selected = copy.id;
        await refresh(); status(count ? "命名配装已保存，后续自动导入不会覆盖它。" : "相同名称和内容的配装已存在。");
      } else {
        await (await db()).update(row.id, { name: label, updatedAt: Date.now() }); await refresh(); status("配装名称已保存。");
      }
    })); area.append(naming);
    const actions = node("div", undefined, "actions"), target = node("select"); target.setAttribute("aria-label", "载入目标玩家");
    for (let n = 1; n <= 5; n++) { const option = node("option", `玩家 ${n}`); option.value = String(n); target.append(option); }
    target.value = slot; target.onchange = () => { slot = target.value; renderDetail(); };
    const load = button(`载入玩家 ${slot}`, async () => {
      if (busy) return;
      if (!/^#\/home(?:[/?]|$)/.test(location.hash)) throw new Error("请先切换到模拟器主页，等待加载完成后再载入。");
      busy = true; render(); status(`正在载入玩家 ${slot}，等待网站确认…`);
      try { await bridge.restore(row, slot); status(`已载入玩家 ${slot}。其他玩家槽位保留；请核对源数据缺失的字段。`); }
      finally { busy = false; render(); }
    }, "primary");
    actions.append(target, load, button("导出这一套", () => exportRows([row])));
    actions.append(button("移入回收站", async () => {
      await (await db()).update(row.id, { deletedAt: Date.now(), updatedAt: Date.now() }); undo = row.id;
      selected = ""; await refresh(); status("档案已移入回收站，可随时恢复。");
    }, "danger")); area.append(actions);
    area.append(node("p", "载入会替换选中玩家槽位的角色字段，并可能重置该玩家的优化结果。", "note"));
    if (!/^#\/home(?:[/?]|$)/.test(location.hash)) area.append(button("前往模拟器主页", () => { location.hash = "/home"; }));
    const gear = node("ul", undefined, "gear");
    const names = { head: "头部", body: "身体", legs: "腿部", feet: "脚部", hands: "手部", weapon: "武器", main_hand: "主手", two_hand: "双手", off_hand: "副手", pouch: "袋子", neck: "项链", earrings: "耳环", ring: "戒指", back: "背部", charm: "护符", trinket: "饰品" };
    for (const item of info.gear) {
      const li = node("li"); li.append(node("span", names[item.slot] || item.slot, "slot"), itemMark(item.itemHrid),
        node("code", item.itemHrid), node("span", item.enhancementLevel === undefined ? "等级未知" : `+${item.enhancementLevel}`, "level")); gear.append(li);
    }
    area.append(gear);
    if (!info.gear.length) area.append(node("p", "此档案未包含已装备物品。", "note"));
  }
  function render() {
    if (!ui) return;
    const active = ui.shadow.activeElement;
    const focus = active?.dataset.focus, start = active?.selectionStart, end = active?.selectionEnd;
    const visible = visibleRows(); ui.list.replaceChildren();
    for (const row of visible) {
      const entry = button("", () => choose(row.id), "archive"); entry.setAttribute("aria-pressed", String(row.id === selected));
      entry.append(node("strong", row.name), node("small", `${row.kind === "recent" ? "最近导入" : "命名配装"} · ${row.characterName}`), node("small", date(row.capturedAt)));
      ui.list.append(entry);
    }
    if (!visible.length) ui.list.append(node("p", query ? "没有匹配的档案。" : filter === "trash" ? "回收站为空。" : "还没有配装档案。", "empty"));
    ui.launcherText.textContent = `配装档案 · ${rows.filter(row => !row.deletedAt).length}`;
    renderDetail(); renderImportPreview();
    for (const el of ui.panel.querySelectorAll("button,input,select")) el.disabled = busy;
    if (focus) {
      const next = ui.shadow.querySelector(`[data-focus="${focus}"]`);
      if (next) { next.focus(); if (start != null) next.setSelectionRange(start, end); }
    }
  }
  function mount() {
    if (ui || !document.body) return;
    const host = node("div"); host.id = "mwi-loadout-archive-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = node("style", "__ARCHIVE_CSS__");
    const launcherText = node("span", "配装档案");
    const launcher = button("", () => {
      panelOpen = !panelOpen; panel.hidden = !panelOpen; launcher.setAttribute("aria-expanded", String(panelOpen));
      if (panelOpen) { refresh().catch(error => status(error.message, "error")); search.focus(); }
    }, "launcher"); launcher.setAttribute("aria-expanded", "false"); launcher.setAttribute("aria-controls", "archive-panel");
    launcher.append(launcherText);
    const panel = node("aside", undefined, "panel"); panel.hidden = true; panel.id = "archive-panel";
    panel.setAttribute("aria-label", "配装档案管理");
    const head = node("header"), heading = node("div");
    heading.append(node("h2", "配装档案"), node("p", "当前浏览器本地保存 · 支持 JSON 备份"));
    head.append(heading, button("关闭", () => { panelOpen = false; panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); launcher.focus(); }, "close"));
    const toolbar = node("div", undefined, "toolbar"), search = node("input");
    search.type = "search"; search.placeholder = "搜索配装或角色"; search.setAttribute("aria-label", "搜索配装或角色");
    search.addEventListener("input", () => { query = search.value; render(); });
    const filterSelect = node("select"); filterSelect.setAttribute("aria-label", "档案分类");
    for (const [value, label] of [["all", "全部档案"], ["recent", "最近导入"], ["named", "命名配装"], ["trash", "回收站"]]) {
      const option = node("option", label); option.value = value; filterSelect.append(option);
    }
    filterSelect.onchange = () => { filter = filterSelect.value; selected = ""; const first = visibleRows()[0]; if (first) choose(first.id); else render(); };
    const file = node("input", undefined, "file"); file.type = "file"; file.accept = ".json,application/json";
    file.setAttribute("aria-label", "导入 JSON 文件");
    file.onchange = () => { const selectedFile = file.files[0]; file.value = ""; addFile(selectedFile).catch(error => status(error.message, "error")); };
    toolbar.append(search, filterSelect, button("导入 JSON", () => file.click()),
      button("备份全部", () => exportRows(rows.filter(row => !row.deletedAt))));
    const layout = node("div", undefined, "layout"), list = node("nav", undefined, "list"), detail = node("section", undefined, "detail");
    list.setAttribute("aria-label", "配装列表"); detail.setAttribute("aria-label", "档案详情"); layout.append(list, detail);
    const importPreview = node("div", undefined, "toolbar"), live = node("div", undefined, "status");
    live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite"); live.setAttribute("aria-atomic", "true");
    panel.append(head, toolbar, layout, importPreview, live, node("p", "自动归档一键导入数据；手动调整后的方案请从网站导出单人 JSON 再导入。", "bottom"));
    shadow.append(style, panel, launcher, file); document.body.append(host);
    ui = { host, shadow, panel, launcher, launcherText, status: live, list, detail, file,
      filter: filterSelect, importPreview };
    const syncTheme = () => host.dataset.theme = document.documentElement.dataset.theme === "light" ||
      (!document.documentElement.classList.contains("dark") && document.documentElement.dataset.theme !== "dark") ? "light" : "dark";
    syncTheme(); new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    shadow.addEventListener("keydown", event => {
      if (event.key === "Escape" && panelOpen) { panelOpen = false; panel.hidden = true; launcher.setAttribute("aria-expanded", "false"); launcher.focus(); event.stopPropagation(); }
    });
    window.addEventListener("hashchange", () => { if (panelOpen) renderDetail(); });
    // Reload on focus to see committed changes from another tab; no timer or global storage clearing.
    window.addEventListener("focus", () => { if (panelOpen && !busy) refresh().catch(error => status(error.message, "error")); });
    status(lastStatus, lastTone); refresh().catch(error => status(error.message, "error"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
})(window);
