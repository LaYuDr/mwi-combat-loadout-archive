(function startArchive(root) {
  "use strict";
  const supported = location.hostname === "mwi-combatsi-mulator.pages.dev" ||
    (location.hostname === "azhu949.github.io" && location.pathname.startsWith("/MWICombatSimulator/"));
  if (!supported || root.__MWILoadoutArchiveInstalled) return;
  root.__MWILoadoutArchiveInstalled = true;
  const D = root.MWINativeDocument, S = root.MWILoadoutStore;
  const native = root.MWINativeAdapter.create({ inspect: D.inspect });
  let storePromise, rows = [], selected = "", scope = "solo", query = "", filter = "all";
  let busy = false, ready = false, confirmGroup = false, pending = null, undo = null;
  let ui;
  const date = value => new Date(value).toLocaleString("zh-CN", { hour12: false });
  const label = row => row.schemaVersion === 2 ? row.documentKind === "group" ? "整队" : "单人" : "旧版档案";
  const db = () => storePromise ||= S.create().catch(error => { storePromise = null; throw error; });
  function el(tag, text, cls) {
    const result = document.createElement(tag); if (text !== undefined) result.textContent = text;
    if (cls) result.className = cls; return result;
  }
  function button(text, fn, cls) {
    const b = el("button", text, cls); b.type = "button";
    b.addEventListener("click", () => Promise.resolve().then(fn).catch(error => status(error.message, "error")));
    return b;
  }
  function status(message, tone = "info") {
    ui.status.textContent = message; ui.status.dataset.tone = tone;
    ui.recovery.hidden = !native.recoveryAvailable;
    ui.undo.hidden = !undo;
  }
  function setBusy(value) {
    busy = value; ui.panel.setAttribute("aria-busy", String(value));
    for (const control of ui.shadow.querySelectorAll("button,input,select")) control.disabled = value;
    ui.capture.disabled = value || !ready;
    ui.source.disabled = value || scope === "group";
  }
  async function task(message, action, { focus } = {}) {
    if (busy) return;
    const previousFocus = ui.shadow.activeElement;
    setBusy(true); status(message);
    try { return await action(); }
    finally {
      setBusy(false); ui.recovery.hidden = !native.recoveryAvailable;
      const nativeDialog = [...document.querySelectorAll('[role="dialog"]')].some(e => !e.hidden && e.getClientRects().length);
      if (ui.host.isConnected && !nativeDialog && (focus || previousFocus)) {
        const target = focus?.() || (previousFocus?.isConnected ? previousFocus : ui.captureName);
        target?.focus();
      }
    }
  }
  async function nativeCall(action) {
    // Reserve the embedded page space while the website's own modal takes focus.
    ui.host.style.visibility = "hidden";
    try { return await action(); }
    finally { ui.host.style.visibility = ""; }
  }
  function visibleRows() {
    return rows.filter(row => (filter === "trash" ? !!row.deletedAt : !row.deletedAt) &&
      (filter === "solo" ? row.schemaVersion === 2 && row.documentKind === "solo"
        : filter === "group" ? row.schemaVersion === 2 && row.documentKind === "group"
        : filter === "legacy" ? row.schemaVersion !== 2 : true) &&
      `${row.name} ${row.characterName || ""}`.toLowerCase().includes(query.toLowerCase()));
  }
  async function refresh() {
    const data = await (await db()).all(); ready = true;
    rows = data.sort((a, b) => b.updatedAt - a.updatedAt);
    if (!visibleRows().some(row => row.id === selected)) { selected = visibleRows()[0]?.id || ""; confirmGroup = false; }
    render();
  }
  function download(text, name) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
    const a = el("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderList() {
    ui.list.replaceChildren();
    const items = visibleRows();
    if (!items.length) {
      const filtered = query || !["all", "trash"].includes(filter);
      ui.list.append(el("p", filter === "trash" ? "回收站为空。" : filtered ? "没有匹配的档案。" : "还没有保存的配置。", "empty"));
      if (filtered) ui.list.append(button("清除筛选", () => { query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all"; selected = visibleRows()[0]?.id || ""; render(); }));
      return;
    }
    for (const row of items) {
      const item = button("", () => { selected = row.id; confirmGroup = false; render(); ui.list.querySelector('[aria-pressed="true"]')?.focus(); });
      item.className = "archive"; item.setAttribute("aria-pressed", String(row.id === selected));
      item.append(el("strong", row.name), el("small", `${label(row)} · ${row.characterName || "未命名角色"}`), el("small", date(row.capturedAt)));
      ui.list.append(item);
    }
  }
  function renderDetail() {
    ui.detail.replaceChildren(); const row = rows.find(r => r.id === selected && visibleRows().some(v => v.id === r.id));
    if (!row) {
      const box = el("div", undefined, "detail-empty");
      box.append(el("h3", filter === "trash" ? "已删除的档案可在这里恢复" : "把网页上调好的配置留下来"),
        el("p", "选择上方的单人或整队，点击“保存网页当前配置”。", "muted"),
        el("p", "直接使用网页原生导出，不需要先从游戏重新导入，也不需要下载再上传。", "muted"));
      ui.detail.append(box); return;
    }
    ui.detail.append(el("h3", row.name), el("p", `${label(row)} · 保存于 ${date(row.capturedAt)}`, "note"));
    let info;
    try { info = D.describe(row); }
    catch (error) {
      ui.detail.append(el("p", `这份档案暂时无法读取：${error.message}`, "note"),
        button("下载原始档案供修复", () => download(JSON.stringify(row, null, 2), "MWI待修复档案.json")));
      return;
    }
    const scopeBox = el("div", undefined, "scope");
    scopeBox.append(el("p", info.legacy ? "旧版导入快照：不含保存后在网页上的手动修改，也可能缺少原生配置字段。"
      : info.scope === "group" ? `完整整队 JSON · ${info.players.length} 个玩家槽位及模拟设置。`
        : "完整单人 JSON · 玩家配装及原生导出的模拟设置。"));
    scopeBox.append(el("p", info.legacy ? "恢复时交给网页原生单人导入；缺失字段沿用网页规则，请核对结果。"
      : "保存内容完整保留；恢复范围和字段处理由网页原生导入决定。", "note"));
    ui.detail.append(scopeBox);
    if (row.deletedAt) {
      ui.detail.append(button("恢复这份档案", () => task("正在恢复档案…", async () => {
        await (await db()).update(row.id, { deletedAt: null, updatedAt: Date.now() }); if (undo === row.id) undo = null; filter = "all"; ui.filter.value = "all";
        selected = row.id; await refresh(); status("档案已从回收站恢复。");
      }), "primary")); return;
    }
    const naming = el("form", undefined, "name-field"), name = el("input");
    name.value = row.name; name.maxLength = 120; name.setAttribute("aria-label", "档案名称");
    const rename = el("button", "保存名称"); rename.type = "submit";
    naming.append(name, rename); naming.addEventListener("submit", event => {
      event.preventDefault(); const value = name.value;
      task("正在保存名称…", async () => {
        const valueName = D.validName(value);
        await (await db()).update(row.id, { name: valueName, updatedAt: Date.now() }); await refresh(); status("档案名称已保存。");
      }, { focus: () => ui.detail.querySelector('input[aria-label="档案名称"]') }).catch(error => status(error.message, "error"));
    }); ui.detail.append(naming);
    if (info.players.length) {
      const table = el("table"); const caption = el("caption", "保存的玩家", "sr-only");
      table.append(caption); const head = el("thead"), tr = el("tr");
      for (const word of ["槽位", "角色", "已配装备"]) { const th = el("th", word); th.scope = "col"; tr.append(th); }
      head.append(tr); table.append(head); const body = el("tbody");
      for (const p of info.players) {
        const line = el("tr"); const equipped = Object.values(p.equipment).filter(v => v?.itemHrid).length;
        line.append(el("td", `玩家 ${p.id}`), el("td", p.name || "未命名"), el("td", `${equipped} 件`)); body.append(line);
      }
      table.append(body); ui.detail.append(table);
    } else ui.detail.append(el("p", `角色：${row.characterName}`, "muted"));
    const actions = el("div", undefined, "actions");
    if (info.scope === "solo") {
      const targetLabel = el("label", "导入目标 "), target = el("select"); target.setAttribute("aria-label", "导入目标玩家");
      for (let n = 1; n <= 5; n++) { const opt = el("option", `玩家 ${n}`); opt.value = String(n); target.append(opt); }
      target.value = ui.targetSlot || "1"; target.addEventListener("change", () => { ui.targetSlot = target.value; }); targetLabel.append(target);
      actions.append(targetLabel, button("导入到网页", () => restore(row, info, target.value), "primary"));
      scopeBox.append(el("p", info.legacy ? "仅导入指定玩家；旧档案缺失字段请在网页中核对。"
        : "会替换所选玩家，并按网页原生规则导入包内模拟设置；其他玩家配装保留。", "note"));
    } else actions.append(button("导入整队配置", () => { confirmGroup = true; renderDetail(); ui.detail.querySelector('[data-group-confirm]')?.focus(); }, "primary"));
    ui.detail.insertBefore(actions, naming);
    if (info.scope === "group" && confirmGroup) {
      const confirmation = el("div", undefined, "confirmation");
      confirmation.append(el("p", `将恢复“${row.name}”中的玩家 ${info.players.map(p => p.id).join("、")} 及模拟设置。当前相应配置会被替换，优化结果可能重置。`));
      const yes = button("确认恢复整队及模拟设置", () => restore(row, info, null, true), "primary"); yes.dataset.groupConfirm = "";
      confirmation.append(yes, button("取消整队恢复", () => { confirmGroup = false; renderDetail(); ui.detail.querySelector('.primary')?.focus(); })); ui.detail.insertBefore(confirmation, naming);
    }
    const tools = el("div", undefined, "actions secondary-actions");
    tools.append(button(info.legacy ? "导出旧版档案" : "下载原生 JSON", () => {
      download(info.legacy ? D.backup([row]) : row.jsonText, info.legacy ? "MWI旧版档案.json" : `MWI-${info.scope}-${Date.now()}.json`);
      status("已生成下载文件，档案仍保留。");
    }), button("移入回收站", () => task("正在移动档案…", async () => {
      await (await db()).update(row.id, { deletedAt: Date.now(), updatedAt: Date.now() }); undo = row.id;
      confirmGroup = false; await refresh(); status("档案已移入回收站，可撤销或稍后恢复。");
    }), "danger")); ui.detail.append(tools);
    const details = el("details"), summary = el("summary", info.legacy ? "查看旧版保存内容" : "查看保存的原生 JSON");
    details.append(summary); details.addEventListener("toggle", () => {
      if (details.open && !details.querySelector("pre")) {
        details.append(el("pre", info.text.slice(0,12000)));
        if (info.text.length > 12000) details.append(el("p", "仅预览前 12,000 个字符；下载文件包含完整内容。", "note"));
      }
    }); ui.detail.append(details);
  }
  async function restore(row, info, target, confirmed = false) {
    await task("正在调用网页原生导入，请等待网页确认…", async () => {
      await nativeCall(() => native.restore(info.text, info.scope, target, { confirmedGroup: confirmed, legacy: info.legacy }));
      confirmGroup = false; renderDetail(); status(info.scope === "group" ? "网页已确认：整队配置导入成功。" : `网页已确认：已导入玩家 ${target}。`);
    }, { focus: () => ui.detail.querySelector('.actions > .primary') });
  }
  function render() {
    renderList(); renderDetail();
    ui.count.textContent = `${rows.filter(row => !row.deletedAt).length} 份档案`;
    setBusy(busy);
  }
  function renderPending() {
    ui.pending.replaceChildren(); if (!pending) return;
    const groups = pending.filter(row => row.documentKind === "group").length;
    ui.pending.append(el("p", `已校验 ${pending.length} 份档案${groups ? `，其中 ${groups} 份整队配置` : ""}。添加到档案库不会修改网页配置。`),
      button("添加到档案库", () => task("正在添加档案…", async () => {
        const source = pending; if (!source) return;
        const count = await (await db()).addNamed(source); pending = null; renderPending();
        query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all";
        if (count) selected = source[0].id;
        await refresh(); status(`已添加 ${count} 份档案，跳过 ${source.length - count} 份同名同内容档案。`);
      })), button("取消添加", () => { pending = null; renderPending(); status("已取消添加，已有档案保留。"); }));
  }
  function mount() {
    if (document.getElementById("mwi-loadout-archive-host")) return;
    const host = el("div"); host.id = "mwi-loadout-archive-host";
    const shadow = host.attachShadow({ mode: "open" }), style = el("style", "__ARCHIVE_CSS__"); shadow.append(style);
    const panel = el("section", undefined, "panel"); panel.setAttribute("aria-label", "配装档案管理");
    const head = el("header"), title = el("div"), count = el("span", "0 份档案", "archive-count");
    title.append(el("h2", "配装档案"), el("p", "保存网页当前配置，随时交回网页恢复")); head.append(title, count);
    const capture = el("form", undefined, "capture");
    const mode = el("fieldset"), legend = el("legend", "保存范围"); mode.append(legend);
    for (const [value, text] of [["solo", "单人"], ["group", "整队"]]) {
      const l = el("label"), radio = el("input"); radio.type = "radio"; radio.name = "capture-scope"; radio.value = value; radio.checked = value === scope;
      radio.addEventListener("change", () => { scope = value; ui.source.disabled = value === "group"; ui.sourceLabel.hidden = value === "group"; }); l.append(radio, document.createTextNode(text)); mode.append(l);
    }
    const sourceLabel = el("label", "来源槽位 "), source = el("select"); source.setAttribute("aria-label", "保存来源玩家");
    for (let n = 1; n <= 5; n++) { const option = el("option", `玩家 ${n}`); option.value = String(n); source.append(option); } sourceLabel.append(source);
    const captureName = el("input"); captureName.maxLength = 120; captureName.placeholder = "配置名称（留空自动命名）"; captureName.setAttribute("aria-label", "新配置名称");
    const captureButton = el("button", "保存网页当前配置", "primary"); captureButton.type = "submit";
    const fields = el("div", undefined, "capture-fields"); fields.append(captureName, captureButton); capture.append(mode, sourceLabel, fields,
      el("p", "包含原生导出中的模拟设置。每次保存新建档案，不覆盖已有配置。", "note"));
    capture.addEventListener("submit", event => { event.preventDefault();
      const captureScope = scope, slot = source.value, name = captureName.value;
      task("正在调用网页原生导出，请等待导出完成…", async () => {
        const text = await nativeCall(() => native.capture(captureScope, slot));
        const row = await D.prepare(text, { name });
        const count = await (await db()).addNamed([row]);
        query = ""; filter = "all"; ui.search.value = ""; ui.filter.value = "all";
        await refresh();
        selected = count ? row.id : rows.find(r => !r.deletedAt && r.fingerprint === row.fingerprint && r.name === row.name)?.id || selected;
        render(); status(count ? `已保存“${row.name}”，包含网页当前${captureScope === "group" ? "整队" : "单人"}配置。` : "同名同内容档案已存在，未重复添加。");
      }, { focus: () => ui.captureName }).catch(error => status(error.message, "error"));
    });
    const toolbar = el("div", undefined, "toolbar"), search = el("input"); search.type = "search"; search.placeholder = "搜索配置或角色"; search.setAttribute("aria-label", "搜索配置或角色");
    search.addEventListener("input", () => { query = search.value; confirmGroup = false; if (!visibleRows().some(r => r.id === selected)) selected = visibleRows()[0]?.id || ""; renderList(); renderDetail(); });
    const filterSelect = el("select"); filterSelect.setAttribute("aria-label", "档案分类");
    for (const [value, text] of [["all", "全部档案"], ["solo", "单人"], ["group", "整队"], ["legacy", "旧版档案"], ["trash", "回收站"]]) {
      const option = el("option", text); option.value = value; filterSelect.append(option);
    }
    filterSelect.addEventListener("change", () => { filter = filterSelect.value; confirmGroup = false; selected = visibleRows()[0]?.id || ""; render(); });
    const file = el("input", undefined, "file"); file.type = "file"; file.accept = ".json,application/json"; file.setAttribute("aria-label", "导入档案文件");
    file.addEventListener("change", () => {
      const chosen = file.files?.[0]; file.value = ""; if (!chosen || busy) return;
      task("正在校验档案文件…", async () => {
        pending = null; renderPending(); if (chosen.size > D.MAX_BYTES) throw new Error("文件超过 20 MB，请拆分后重试。");
        pending = await D.importFile(await chosen.text()); renderPending(); status("文件已校验，请点击“添加到档案库”。");
      }).catch(error => status(error.message, "error"));
    });
    toolbar.append(search, filterSelect, button("导入档案文件", () => file.click()), button("备份全部", () => {
      download(D.backup(rows.filter(row => !row.deletedAt)), `MWI配装档案备份-${Date.now()}.json`); status("已生成完整备份，不包含回收站档案。");
    }));
    const layout = el("div", undefined, "layout"), list = el("div", undefined, "list"), detail = el("div", undefined, "detail");
    list.setAttribute("aria-label", "档案列表"); detail.setAttribute("aria-label", "档案详情"); layout.append(list, detail);
    const pendingBox = el("div", undefined, "import-preview"), live = el("div", undefined, "status"); live.setAttribute("role", "status"); live.setAttribute("aria-live", "polite");
    const foot = el("div", undefined, "footer-actions"), undoButton = button("撤销移入回收站", () => task("正在恢复档案…", async () => {
      const id = undo; if (!id) return; await (await db()).update(id, { deletedAt: null, updatedAt: Date.now() }); undo = null; await refresh(); status("已撤销，档案恢复。");
    })); undoButton.hidden = true;
    const recovery = button("下载网页原有输入备份", () => { download(native.backupDraft(), "MWI网页原有输入备份.json"); status("已生成原输入备份，可打开文件取回单人或整队文本。请核对网页后再重试。"); }); recovery.hidden = true;
    foot.append(button("重新读取档案", () => task("正在读取本地档案…", async () => { await refresh(); status("档案列表已刷新。"); })), undoButton, recovery);
    panel.append(head, capture, toolbar, pendingBox, layout, live, foot, el("p", "仅保存在当前网站和浏览器。清除网站数据前，请先备份。", "bottom"));
    shadow.append(panel, file);
    ui = { host, shadow, panel, count, list, detail, status: live, search, filter: filterSelect, file, pending: pendingBox,
      capture: captureButton, captureName, source, sourceLabel, recovery, undo: undoButton, targetSlot: "1" };
    function syncTheme() { host.dataset.theme = document.documentElement.classList.contains("dark") || document.documentElement.dataset.theme === "dark" ? "dark" : "light"; }
    syncTheme(); new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    root.addEventListener("focus", () => { if (host.isConnected && !busy) refresh().catch(error => status(error.message, "error")); });
    // The Vue route mounts asynchronously and may later replace its section.
    // Keep one host and move it into the verified home workspace, preserving
    // archive selection and form drafts across ordinary route changes.
    let scheduled = false;
    function attachToHome() {
      scheduled = false;
      if (!/^#\/home(?:[/?]|$)/.test(location.hash)) { host.remove(); return; }
      const sections = [...document.querySelectorAll('main [role="tablist"]')].filter(tabs => {
        const labels = [...tabs.querySelectorAll('[role="tab"]')].map(tab => tab.textContent || "");
        return labels.length === 3 && labels.some(text => /战斗|combat/i.test(text)) && labels.some(text => /结果|results/i.test(text));
      }).map(tabs => tabs.closest("section")).filter(Boolean);
      const unique = [...new Set(sections)];
      if (unique.length !== 1) { host.remove(); return; }
      if (host.parentElement !== unique[0]) unique[0].append(host);
    }
    function scheduleAttach() {
      if (!scheduled) { scheduled = true; root.requestAnimationFrame(attachToHome); }
    }
    new MutationObserver(() => {
      if (!host.isConnected && /^#\/home(?:[/?]|$)/.test(location.hash)) scheduleAttach();
    }).observe(document.body, { childList: true, subtree: true });
    root.addEventListener("hashchange", scheduleAttach);
    attachToHome();
    render(); task("正在读取本地档案…", async () => { await refresh(); status("选择单人或整队，保存网页当前配置。"); }).catch(error => status(error.message, "error"));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount, { once: true }); else mount();
})(window);
