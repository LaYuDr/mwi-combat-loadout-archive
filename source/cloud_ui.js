(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  function mount(ctx, el, button, resolve) {
    const character = ctx.props.characterInfo.characterID, id = ctx.raw.id;
    const board = app.Cloud.boardName(character, id), url = "https://clipboard.im/" + board;
    const node = el("details", null, { class: "cloud-panel" });
    const summary = el("summary", ""), note = el("p", "", { class: "cloud-note" });
    const facts = el("dl", null, { class: "cloud-facts" });
    function fact(label) {
      const value = el("dd", "");
      facts.append(el("dt", label), value);
      return value;
    }
    const nativeStatus = fact("原生配装内容"), sceneStatus = fact("场景子方案"), memoryStatus = fact("行动选择记录");
    const checked = fact("上次核对"), address = fact("剪贴板 ID");
    const link = el("a", board, { href: url, target: "_blank", rel: "noopener noreferrer", title: "打开这套配装的剪贴板" });
    address.append(link);
    const sync = button("立即同步", () => app.Cloud.request(character, id));
    const feedback = el("p", "", { role: "status", class: "cloud-feedback" });
    const copy = button("复制地址", async () => {
      try { await navigator.clipboard.writeText(url); feedback.textContent = "已复制剪贴板地址"; }
      catch (_) { feedback.textContent = "请长按或右键剪贴板 ID，复制链接地址。"; }
    });
    const controls = el("div", null, { class: "cloud-actions" });
    controls.append(sync, copy);
    const versions = el("div", null, { class: "cloud-versions" });
    const nativeConflict = el("details", null, { class: "cloud-compare", hidden: "" });
    const nativeDiff = el("ul", null, { class: "cloud-diff" });
    const nativeConfirm = el("div", null, { hidden: "" });
    nativeConfirm.append(el("p", "确认用当前游戏配装更新云端分享？订阅者之后会收到这份配置。"),
      button("确认更新分享", () => {
        try { app.Cloud.publishCurrent(character, id); nativeConfirm.hidden = true; }
        catch (error) { feedback.textContent = error.message; }
      }), button("取消", () => { nativeConfirm.hidden = true; }));
    nativeConflict.append(el("summary", "比较当前与云端配装"), nativeDiff,
      button("用当前配装更新分享", () => { nativeConfirm.hidden = false; }),
      button("将云端配置保存为子方案", async () => {
        try {
          const snapshot = app.Cloud.info(character, id).nativeSnapshot;
          if (!snapshot) throw Error("暂无云端配装内容，请先核对。");
          await app.Virtual.adopt(character, { snapshot }, ctx.raw, "云端 · " + snapshot.raw.name.slice(0, 50));
          feedback.textContent = "已保存云端配置为独立子方案。";
        } catch (error) { feedback.textContent = error.message; }
      }), nativeConfirm);
    node.append(summary, note, facts, controls, feedback,
      el("p", "分享此地址可让其他玩家订阅当前原生配装及子方案。知道地址的人可以读写这套配装的同步数据。", { class: "cloud-privacy" }), nativeConflict, versions);

    function comparison(main, copyRow) {
      const view = el("details", null, { class: "cloud-compare" });
      const toggle = el("summary", "比较版本 · " + main.name);
      view.append(toggle);
      view.addEventListener("toggle", () => {
        if (!view.open || view.childElementCount > 1) return;
        const names = el("dl", null, { class: "cloud-facts" });
        for (const [label, row] of [["版本 A", main], ["版本 B", copyRow]]) {
          names.append(el("dt", label), el("dd", row.name + (row.removedAt != null ? " · 已移除" : "") +
            " · " + new Date(row.updatedAt).toLocaleString()));
        }
        view.append(names);
        const list = el("ul", null, { class: "cloud-diff", "aria-label": "版本 A 到版本 B 的差异" });
        try {
          for (const diff of app.Core.diff(main.snapshot.raw, copyRow.snapshot)) {
            const li = el("li", null);
            li.append(el("strong", diff.label), el("div", "A · " + app.Adapter.describe(ctx, diff, diff.from)),
              el("div", "B · " + app.Adapter.describe(ctx, diff, diff.to)));
            list.append(li);
          }
          view.append(list.childElementCount ? list : el("p", "两个版本的配装项目一致。"));
        } catch (error) { view.append(el("p", error.message)); }
        const choices = el("div", null, { class: "cloud-actions" });
        const confirmation = el("div", null, { class: "cloud-confirm", hidden: "" });
        const prompt = el("p", ""), actions = el("div", null, { class: "cloud-actions" });
        let choice, trigger;
        const commit = button("确认", () => resolve(main, copyRow, choice), { class: "primary" });
        const cancel = button("取消", () => { confirmation.hidden = true; choices.hidden = false; trigger.focus(); });
        confirmation.addEventListener("keydown", event => {
          if (event.key === "Escape") { event.stopPropagation(); cancel.click(); }
        });
        actions.append(commit, cancel); confirmation.append(prompt, actions);
        for (const [key, label] of [["both", "保留两份"], ["a", "仅保留 A"], ["b", "仅保留 B"]]) {
          const btn = button(label, () => {
            if (key === "both") { resolve(main, copyRow, key); return; }
            choice = key; trigger = btn; choices.hidden = true; confirmation.hidden = false;
            prompt.textContent = "确认" + label + "？另一版本将从子方案列表移除，结果会同步到其他设备。";
            cancel.focus();
          });
          choices.append(btn);
        }
        view.append(choices, confirmation);
      });
      return view;
    }
    let lastRows, pairs = [], signature = "", nativeSignature = "";
    nativeConflict.addEventListener("toggle", () => { if (lastRows) update(lastRows); });
    function update(rows, freshContext) {
      if (freshContext?.scope === ctx.scope) ctx = freshContext;
      const state = app.Cloud.info(character, id);
      if (rows !== lastRows) { pairs = app.Cloud.conflictPairs(rows); lastRows = rows; }
      let label = state.label;
      if (pairs.length) {
        const pending = pairs.length + " 组版本待比较";
        label = state.kind === "ok" && !state.offline ? pending : state.label + " · " + pending;
      }
      const heading = "云同步 · " + label;
      if (summary.textContent !== heading) summary.textContent = heading;
      summary.classList.toggle("cloud-warning", state.warning || Boolean(pairs.length));
      note.textContent = state.kind === "setup" || state.kind === "blocked" || state.kind === "error" ? state.detail :
        state.offline ? "可以继续保存子方案，联网后会自动核对。" :
        state.nativeMismatch ? "当前游戏配置与云端分享不同，已保留云端内容。请比较后选择；不会自动更换游戏装备。" :
        pairs.length ? pairs.length + " 组修改需要比较。两个版本都已保留。" : "";
      note.hidden = !note.textContent;
      checked.textContent = state.checked == null ? "尚未核对" : new Date(state.checked).toLocaleString();
      nativeStatus.textContent = state.checked == null ? "待核对" : state.nativeMismatch ? "与当前游戏配置不同，待确认" :
        state.nativeAvailable ? "已上传装备、技能、消耗品及配置选项" : "尚无配装快照";
      sceneStatus.textContent = state.sceneCount == null ? "待核对" : state.sceneCount + " 个 · 已核对";
      memoryStatus.textContent = state.memoryCount == null ? "待核对" : state.memoryCount + " 条 · 已核对";
      nativeConflict.hidden = !state.nativeMismatch;
      if (state.nativeMismatch && nativeConflict.open) {
        const key = app.Core.stable([ctx.raw, state.nativeSnapshot]);
        if (key !== nativeSignature) {
          nativeSignature = key;
          try {
            const differences = app.Core.diff(ctx.raw, state.nativeSnapshot);
            nativeDiff.replaceChildren(...differences.map(diff => el("li", diff.label + "：当前 " +
              app.Adapter.describe(ctx, diff, diff.from) + " → 云端 " + app.Adapter.describe(ctx, diff, diff.to))));
            if (!differences.length) nativeDiff.append(el("li", "装备项目一致，名称或其他原生配置字段不同。"));
          } catch (error) { nativeDiff.replaceChildren(el("li", error.message)); }
        }
      }
      sync.disabled = state.offline || state.kind === "busy";
      sync.textContent = state.kind === "setup" || state.kind === "blocked" || state.kind === "error" ? "重新检查" : "立即同步";
      const key = pairs.map(([a, b]) => [a.id, a.revision, b.id, b.revision].join("/")).join("|");
      if (key !== signature) {
        const restoreFocus = versions.contains(node.getRootNode().activeElement);
        versions.replaceChildren(...pairs.map(([a, b]) => comparison(a, b)));
        signature = key;
        if (restoreFocus) summary.focus();
      }
    }
    return { node, update };
  }
  app.CloudUI = Object.freeze({ mount });
})(globalThis);
