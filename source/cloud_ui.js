(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  function formatTime(ts) {
    const date = new Date(ts);
    const pad = n => String(n).padStart(2, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function mount(ctx, el, button, resolve, onStateChange) {
    const character = ctx.props.characterInfo.characterID, id = ctx.raw.id;
    const board = app.Cloud.boardName(character, id), url = "https://clipboard.im/" + board;
    const node = el("div", null, { class: "cloud-panel" });

    const top = el("div", null, { class: "cloud-head" });
    const statusWrap = el("div", null, { class: "cloud-status" });
    const dot = el("span", null, { class: "cloud-dot", "aria-hidden": "true" });
    const statusText = el("span", "", { class: "cloud-status-text" });
    statusWrap.append(dot, statusText);

    const sync = button("立即同步", () => app.Cloud.request(character, id), { class: "compact-btn" });
    let copyTimer = null, feedbackTimer = null;
    function showFeedback(text, isError = false) {
      clearTimeout(feedbackTimer);
      feedback.textContent = text;
      feedback.classList.toggle("is-error", isError);
      feedback.hidden = !text;
      if (text) feedbackTimer = setTimeout(() => { feedback.hidden = true; }, isError ? 3600 : 2400);
    }
    const copy = button("复制地址", async () => {
      try {
        await navigator.clipboard.writeText(url);
        clearTimeout(copyTimer);
        copy.textContent = "已复制";
        copy.classList.add("is-copied");
        copyTimer = setTimeout(() => {
          copy.textContent = "复制地址";
          copy.classList.remove("is-copied");
        }, 1800);
      } catch (_) {
        showFeedback("请手动复制下方地址。", true);
      }
    }, { class: "compact-btn ghost-btn copy-btn" });
    const controls = el("div", null, { class: "cloud-actions" });
    controls.append(sync, copy);
    top.append(statusWrap, controls);

    const note = el("p", "", { class: "cloud-note", hidden: "" });
    const feedback = el("p", "", { role: "status", class: "cloud-feedback", hidden: "" });

    const stats = el("div", null, { class: "cloud-stats", "aria-label": "同步概览" });
    const nativeStat = el("span", "", { class: "cloud-stat" });
    const sceneStat = el("span", "", { class: "cloud-stat" });
    const memoryStat = el("span", "", { class: "cloud-stat" });
    const checkedStat = el("span", "", { class: "cloud-stat cloud-stat-time" });
    stats.append(nativeStat, sceneStat, memoryStat, checkedStat);

    const nativeConflict = el("div", null, { class: "cloud-compare cloud-compare-alert", hidden: "" });
    const nativeTitle = el("p", "当前游戏配装与云端不一致（已保留云端）", { class: "cloud-compare-title" });
    const nativeDetails = el("details", null, { class: "cloud-diff-box" });
    const nativeDiff = el("ul", null, { class: "cloud-diff" });
    nativeDetails.append(el("summary", "查看差异"), nativeDiff);
    const nativeConfirm = el("div", null, { class: "cloud-confirm", hidden: "" });
    const nativeConfirmActions = el("div", null, { class: "cloud-actions" });
    nativeConfirmActions.append(
      button("取消", () => { nativeConfirm.hidden = true; nativeChoiceRow.hidden = false; }, { class: "compact-btn" }),
      button("确认更新分享", () => {
        try {
          app.Cloud.publishCurrent(character, id);
          nativeConfirm.hidden = true;
          nativeChoiceRow.hidden = false;
        } catch (error) {
          showFeedback(error.message, true);
        }
      }, { class: "compact-btn primary" })
    );
    nativeConfirm.append(el("p", "确认用当前游戏配装覆盖云端分享？订阅者将收到这份配置。"), nativeConfirmActions);
    const nativeChoiceRow = el("div", null, { class: "cloud-actions" });
    let adoptTimer = null;
    const adoptCloudBtn = button("云端存为子方案", async () => {
      try {
        const snapshot = app.Cloud.info(character, id).nativeSnapshot;
        if (!snapshot) throw Error("暂无云端配装内容，请先核对。");
        await app.Virtual.adopt(character, { snapshot }, ctx.raw, "云端 · " + snapshot.raw.name.slice(0, 50));
        clearTimeout(adoptTimer);
        adoptCloudBtn.textContent = "已存为子方案";
        adoptCloudBtn.classList.add("is-copied");
        adoptTimer = setTimeout(() => {
          adoptCloudBtn.textContent = "云端存为子方案";
          adoptCloudBtn.classList.remove("is-copied");
        }, 1800);
      } catch (error) {
        showFeedback(error.message, true);
      }
    }, { class: "compact-btn" });
    nativeChoiceRow.append(
      button("用当前覆盖云端", () => { nativeChoiceRow.hidden = true; nativeConfirm.hidden = false; }, { class: "compact-btn" }),
      adoptCloudBtn
    );
    nativeConflict.append(nativeTitle, nativeDetails, nativeChoiceRow, nativeConfirm);

    const versions = el("div", null, { class: "cloud-versions" });

    const tech = el("div", null, { class: "cloud-tech cloud-tech-body" });
    const linkRow = el("div", null, { class: "cloud-link-row" });
    const link = el("a", board, { href: url, target: "_blank", rel: "noopener noreferrer", title: "打开分享地址" });
    linkRow.append(el("span", "分享地址：", { class: "muted" }), link);
    tech.append(linkRow, el("p", "可订阅配装及子方案，持有链接者可读写。", { class: "cloud-privacy" }));

    node.append(top, note, feedback, stats, nativeConflict, versions, tech);

    function comparison(main, copyRow) {
      const view = el("details", null, { class: "cloud-compare", open: "" });
      const toggle = el("summary", "版本冲突 · " + main.name);
      view.append(toggle);
      let built = false;
      function build() {
        if (built) return;
        built = true;
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
          view.append(list.childElementCount ? list : el("p", "两个版本的配装项目一致。", { class: "muted" }));
        } catch (error) { view.append(el("p", error.message)); }
        const choices = el("div", null, { class: "cloud-actions" });
        const confirmation = el("div", null, { class: "cloud-confirm", hidden: "" });
        const prompt = el("p", ""), actions = el("div", null, { class: "cloud-actions" });
        let choice, trigger;
        const commit = button("确认", () => resolve(main, copyRow, choice), { class: "compact-btn primary" });
        const cancel = button("取消", () => { confirmation.hidden = true; choices.hidden = false; trigger.focus(); }, { class: "compact-btn" });
        confirmation.addEventListener("keydown", event => {
          if (event.key === "Escape") { event.stopPropagation(); cancel.click(); }
        });
        actions.append(cancel, commit); confirmation.append(prompt, actions);
        for (const [key, label] of [["both", "保留两份"], ["a", "仅保留 A"], ["b", "仅保留 B"]]) {
          const btn = button(label, () => {
            if (key === "both") { resolve(main, copyRow, key); return; }
            choice = key; trigger = btn; choices.hidden = true; confirmation.hidden = false;
            prompt.textContent = "确认" + label + "？另一版本将被移除并同步到其他设备。";
            cancel.focus();
          }, { class: "compact-btn" });
          choices.append(btn);
        }
        view.append(choices, confirmation);
      }
      build();
      return view;
    }

    let lastRows, pairs = [], signature = "", nativeSignature = "";
    nativeDetails.addEventListener("toggle", () => { if (lastRows) update(lastRows); });

    function update(rows, freshContext) {
      if (freshContext?.scope === ctx.scope) ctx = freshContext;
      const state = app.Cloud.info(character, id);
      if (rows !== lastRows) { pairs = app.Cloud.conflictPairs(rows); lastRows = rows; }
      const warning = Boolean(state.warning || pairs.length);
      let label = warning ? state.label : "";
      if (pairs.length) {
        const pending = pairs.length + " 组版本待比较";
        label = state.kind === "ok" && !state.offline ? pending : state.label + " · " + pending;
      }
      const busy = state.kind === "busy" || state.kind === "pending";
      if (statusText.textContent !== label) statusText.textContent = label;
      statusWrap.hidden = !warning;
      statusWrap.classList.toggle("cloud-warning", warning);
      dot.dataset.state = warning ? "warn" : "idle";

      note.textContent = state.kind === "setup" || state.kind === "blocked" || state.kind === "error" ? state.detail :
        state.offline ? "离线修改已存本机，联网后自动同步。" :
        pairs.length ? pairs.length + " 组冲突待处理，两个版本均已保留。" : "";
      note.hidden = !note.textContent;

      nativeStat.textContent = state.nativeMismatch ? "原生：待确认" : "";
      nativeStat.hidden = !nativeStat.textContent;
      sceneStat.textContent = state.sceneCount == null ? "" : `子方案：${state.sceneCount}`;
      sceneStat.hidden = !sceneStat.textContent;
      memoryStat.textContent = state.memoryCount == null ? "" : `行动：${state.memoryCount}`;
      memoryStat.hidden = !memoryStat.textContent;
      checkedStat.textContent = "";
      checkedStat.hidden = true;
      checkedStat.removeAttribute("title");
      stats.hidden = nativeStat.hidden && sceneStat.hidden && memoryStat.hidden;

      nativeConflict.hidden = !state.nativeMismatch;
      if (state.nativeMismatch && nativeDetails.open) {
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
        if (restoreFocus) sync.focus();
      }
      onStateChange?.({ warning, busy, label, conflicts: pairs.length, nativeMismatch: Boolean(state.nativeMismatch) });
    }
    return { node, update };
  }
  app.CloudUI = Object.freeze({ mount });
})(globalThis);
