(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWINativeAdapter = factory();
})(globalThis, function () {
  "use strict";
  const words = {
    open: /^(?:导入\s*\/\s*导出|Import\s*\/\s*Export)$/i,
    soloExport: /^(?:导出单人|Export Solo)$/i, groupExport: /^(?:导出组队|Export Group)$/i,
    soloImport: /^(?:导入到玩家|Import To Player)$/i, groupImport: /^(?:导入组队|Import Group)$/i,
    close: /^(?:关闭|Close)$/i
  };
  const label = element => (element.getAttribute("aria-label") || element.textContent || "").replace(/\s+/g, " ").trim();
  const visible = element => !!element && !element.hidden && element.getClientRects().length > 0;
  function uniqueButton(parent, expression) {
    const all = [...parent.querySelectorAll("button")].filter(b => visible(b) && expression.test(label(b)));
    if (all.length !== 1) throw new Error("未能唯一识别网页原生导入/导出控件，请关闭其他弹窗并回到模拟器主页后重试。");
    if (all[0].disabled) throw new Error("网页原生操作暂不可用，请先处理当前编辑或等待网页加载。");
    return all[0];
  }
  function create({ document: doc = document, inspect, timeout = 45000 } = {}) {
    let locked = false, recovery = null, recoveryBackedUp = false;
    const win = doc.defaultView;
    const sleep = () => new Promise(resolve => win.setTimeout(resolve, 50));
    async function wait(check, message, state) {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        if (state?.interrupted) throw new Error("检测到你正在操作网页，已停止后续自动步骤；请核对当前网页状态。");
        if (state?.modal && [...doc.querySelectorAll('[role="dialog"]')].some(el => el !== state.modal && visible(el))) {
          state.interrupted = true;
          throw new Error("网页出现了其他弹窗，已停止后续步骤；请先处理网页提示，再下载原有输入备份。");
        }
        if (state?.modal && !visible(state.modal)) throw new Error("网页导入/导出窗口已关闭，本次操作未获确认。");
        const result = check(); if (result) return result;
        await sleep();
      }
      if (state) state.uncertain = true;
      throw new Error(message);
    }
    function findModal() {
      const matches = [...doc.querySelectorAll('[role="dialog"]')].filter(el => visible(el) &&
        [...el.querySelectorAll("button")].some(b => words.soloExport.test(label(b))));
      if (matches.length > 1) throw new Error("存在多个原生导入/导出窗口，请先关闭多余窗口。");
      return matches[0];
    }
    function controls(modal, scope) {
      const exportButton = uniqueButton(modal, words[`${scope}Export`]);
      let section = exportButton.parentElement;
      while (section && section !== modal && !section.querySelector("textarea")) section = section.parentElement;
      if (!section || section === modal || section.querySelectorAll("textarea").length !== 1 || section.querySelectorAll('input[type="file"]').length !== 1)
        throw new Error("网页原生表单结构已变化，未执行保存或导入，请更新配装助手。");
      return { section, textarea: section.querySelector("textarea"), file: section.querySelector('input[type="file"]'),
        exportButton, importButton: uniqueButton(section, words[`${scope}Import`]) };
    }
    function setText(element, value) {
      const setter = Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, "value").set;
      setter.call(element, value); element.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
    function status(modal) {
      const candidates = [...modal.querySelectorAll(".modal-body-text > div > p.text-success,.modal-body-text > div > p.text-destructive,.modal-body-text > div > p.text-muted-foreground")].filter(visible);
      if (candidates.length > 1) throw new Error("网页结果区域有歧义，请关闭其他提示后重试。");
      return candidates[0]?.textContent.trim() || "";
    }
    function assertPage() {
      if (!/^#\/home(?:[/?]|$)/.test(win.location.hash)) throw new Error("请先打开模拟器主页，等待配置加载完成后重试。");
    }
    async function selectPlayer(modal, slot, state) {
      if (!/^[1-5]$/.test(String(slot))) throw new Error("请选择玩家 1 至 5。");
      const { section } = controls(modal, "solo");
      const trigger = section.querySelector('[role="combobox"]');
      if (!trigger) throw new Error("未找到网页原生玩家选择器，请更新插件后重试。");
      // Use the public keyboard interaction of the native Reka selector.
      trigger.dispatchEvent(new win.KeyboardEvent("keydown", { key: "ArrowDown", code: "ArrowDown", bubbles: true }));
      const options = await wait(() => {
        const popup = doc.getElementById(trigger.getAttribute("aria-controls"));
        const items = popup && [...popup.querySelectorAll('[role="option"]')].filter(visible);
        return items?.length ? items : null;
      }, "网页玩家选择器没有打开，请手动关闭弹窗后重试。", state);
      // The verified native form enumerates simulator.players in fixed slot order.
      // Refuse changed cardinality; single export also verifies the resulting player.id.
      if (options.length !== 5) throw new Error("网页玩家槽位结构已变化，未执行导入。");
      const old = options.findIndex(o => o.getAttribute("aria-selected") === "true");
      options[Number(slot) - 1].dispatchEvent(new win.KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      await wait(() => trigger.getAttribute("aria-expanded") !== "true", "网页玩家选择未完成。", state);
      return old >= 0 ? String(old + 1) : null;
    }
    async function exportCurrent(modal, scope, slot, state) {
      const c = controls(modal, scope), beforeStatus = status(modal);
      setText(c.textarea, ""); c.exportButton.click();
      return wait(() => {
        if (c.textarea.value.trim()) {
          const info = inspect(c.textarea.value);
          if (info.scope !== scope || (scope === "solo" && String(info.players[0].id) !== String(slot)))
            throw new Error("网页返回的导出范围与选择不符，本次没有保存或导入。");
          return c.textarea.value;
        }
        const message = status(modal);
        if (message && message !== beforeStatus && /失败|failed|error/i.test(message)) throw new Error(`网页导出失败：${message}`);
        return null;
      }, "网页未在限定时间内生成新的导出内容；档案没有写入，请核对网页后重试。", state);
    }
    async function session(scope, slot, action, { confirmedGroup = false } = {}) {
      if (locked) throw new Error("上一项网页操作还未结束，请稍后重试。");
      assertPage();
      if (recovery && !recoveryBackedUp) throw new Error("上次网页操作未获确认，请先下载网页原有输入备份，再开始新操作。");
      locked = true;
      const state = { modal: null, interrupted: false, uncertain: false }, previousFocus = doc.activeElement;
      let opened = false, draft, savedSlot = null;
      const onInteraction = event => {
        if (event.isTrusted) {
          state.interrupted = true;
          try { state.inputSnapshot = { solo: controls(state.modal, "solo").textarea.value, group: controls(state.modal, "group").textarea.value }; }
          catch (_) { /* Keep the original copy if the website removed its form. */ }
        }
      };
      const rememberDraft = () => {
        if (draft) { recovery = { original: draft, interrupted: state.inputSnapshot || null }; recoveryBackedUp = false; }
      };
      try {
        let modal = findModal(); opened = !modal;
        if (!modal) {
          if ([...doc.querySelectorAll('[role="dialog"]')].some(visible)) throw new Error("请先关闭网页上其他弹窗，再保存或导入配置。");
          uniqueButton(doc, words.open).click();
          modal = await wait(findModal, "网页导入/导出窗口未打开，请等待主页加载后重试。");
        }
        state.modal = modal;
        // Opening a portaled selector while the native dialog is still zooming
        // destabilizes its ResizeObserver/Floating UI measurements. Wait for the
        // website's finite entrance animation before interacting with controls.
        await wait(() => !modal.getAnimations().some(a => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity),
          "网页导入/导出窗口仍在加载，请稍后重试。", state);
        draft = { solo: controls(modal, "solo").textarea.value, group: controls(modal, "group").textarea.value };
        modal.addEventListener("input", onInteraction, true); modal.addEventListener("click", onInteraction, true); modal.addEventListener("keydown", onInteraction, true);
        if (scope === "solo") savedSlot = await selectPlayer(modal, slot, state);
        return await action(modal, state);
      } finally {
        const modal = state.modal;
        if (modal) {
          modal.removeEventListener("input", onInteraction, true); modal.removeEventListener("click", onInteraction, true); modal.removeEventListener("keydown", onInteraction, true);
          if (state.uncertain || state.interrupted) {
            // Native async handlers cannot be cancelled. Keep a recoverable copy of
            // draft text instead of overwriting text while they may still finish.
            rememberDraft();
          } else if (visible(modal)) {
            try {
              if (draft) for (const key of ["solo", "group"]) setText(controls(modal, key).textarea, draft[key]);
              if (!opened && savedSlot) await selectPlayer(modal, savedSlot);
              if (opened) {
                uniqueButton(modal, words.close).click();
                // Reka keeps closing dialogs mounted during the exit transition.
                // Do not let the next operation adopt that disappearing instance.
                await wait(() => !visible(modal), "网页窗口尚未关闭，请手动关闭后重试。");
              }
            } catch (_) { rememberDraft(); }
          } else { rememberDraft(); }
        }
        locked = false;
        if (previousFocus?.isConnected && !findModal()) previousFocus.focus();
      }
    }
    return Object.freeze({
      capture(scope, slot) {
        if (!["solo", "group"].includes(scope)) return Promise.reject(new Error("请选择保存单人还是整队。"));
        return session(scope, slot, (modal, state) => exportCurrent(modal, scope, slot, state));
      },
      restore(text, scope, slot, { confirmedGroup = false, legacy = false } = {}) {
        if (scope === "group" && !confirmedGroup) return Promise.reject(new Error("恢复整队配置前，请先确认影响范围。"));
        if (!["solo", "group"].includes(scope)) return Promise.reject(new Error("档案恢复范围无效。"));
        if (!legacy && inspect(text).scope !== scope) return Promise.reject(new Error("档案范围与导入入口不一致。"));
        return session(scope, slot, async (modal, state) => {
          // Prove the native target id before any configuration replacement.
          if (scope === "solo") await exportCurrent(modal, scope, slot, state);
          const c = controls(modal, scope), filename = `mwi-archive-${win.crypto.randomUUID()}.json`;
          const transfer = new win.DataTransfer(); transfer.items.add(new win.File([text], filename, { type: "application/json" }));
          c.file.files = transfer.files; c.file.dispatchEvent(new win.Event("change", { bubbles: true }));
          await wait(() => c.textarea.value === text && status(modal).includes(filename), "网页未确认读取档案文件，尚未点击导入。", state);
          c.importButton.click();
          const message = await wait(() => {
            const result = status(modal); return result && !result.includes(filename) ? result : null;
          }, "网页没有确认导入结果，可能仍在处理中；请核对网页配置，不要反复点击导入。", state);
          if (!/导入成功|导入.*成功|import success|imported successfully/i.test(message)) throw new Error(`网页未完成导入：${message}`);
          return message;
        }, { confirmedGroup });
      },
      get recoveryAvailable() { return !!recovery; },
      backupDraft() {
        if (!recovery) throw new Error("没有需要取回的原有输入文本。");
        const text = JSON.stringify({ format: "mwi-native-input-recovery", version: 1, savedAt: new Date().toISOString(), ...recovery }, null, 2);
        // Keep the copy available for repeated download. Do not write it back
        // into a form whose native asynchronous handler may still be running.
        recoveryBackedUp = true;
        return text;
      }
    });
  }
  return Object.freeze({ create });
});
