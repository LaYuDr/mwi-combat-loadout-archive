(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWILoadoutBridge = factory();
})(globalThis, function () {
  "use strict";
  function create({ core, pageWindow, origin, onImport, onStatus = () => {}, timeout = 15000, now = Date.now }) {
    const pending = new Map(), loading = new Map(), recentIds = new Set();
    const prefix = `mwi-archive:${globalThis.crypto.randomUUID()}:`;
    let sequence = 0, clock = 0;
    const report = text => onStatus(text, "error");
    function expire(id) {
      const entry = pending.get(id);
      if (entry) { pending.delete(id); report("未收到网站导入成功回执，本次数据尚未归档。可导出 JSON 后手动导入。"); }
    }
    function observe(event) {
      if (event.source !== pageWindow || event.origin !== origin) return;
      const message = event.data;
      if (!message || message.channel !== "mwi-tm-bridge" || typeof message.requestId !== "string" ||
          !message.requestId || message.requestId.length > 200) return;
      const id = message.requestId;
      if (message.type === "mwi-tm-import") {
        if (id.startsWith(prefix) || pending.has(id) || recentIds.has(id) ||
            (message.importTarget && message.importTarget !== "player")) return;
        if (pending.size >= 50) { report("等待导入回执的请求过多，请稍后重试。"); return; }
        try {
          const snapshot = core.sanitizePayload(message.payload);
          // Receive order survives same-millisecond and out-of-order ACKs.
          clock = Math.max(now(), clock + 1);
          pending.set(id, { payload: snapshot.payload, at: clock, timer: setTimeout(() => expire(id), timeout) });
        } catch (error) { report(`网站可继续导入，但档案未保存：${error.message}`); }
      } else if (message.type === "mwi-tm-import-result") {
        if (loading.has(id)) {
          const task = loading.get(id); loading.delete(id); clearTimeout(task.timer);
          if (message.ok === true) task.resolve(message);
          else task.reject(new Error(message.message || "网站拒绝载入，请先保存或取消网站中尚未提交的编辑。"));
          return;
        }
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer); pending.delete(id);
        recentIds.add(id);
        if (recentIds.size > 200) recentIds.delete(recentIds.values().next().value);
        if (message.ok !== true) { report("网站导入未成功，本次数据未归档。"); return; }
        Promise.resolve().then(() => onImport(entry.payload, entry.at)).catch(error => report(`导入成功，但归档失败：${error.message}`));
      }
    }
    function restore(row, slot) {
      const id = `${prefix}${++sequence}`;
      const message = core.restoreMessage(row, slot, id);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          loading.delete(id);
          reject(new Error("网站未响应。请先打开模拟器主页，等待加载完成后重试；档案仍保留。"));
        }, timeout);
        loading.set(id, { resolve, reject, timer });
        try { pageWindow.postMessage(message, origin); }
        catch (error) { clearTimeout(timer); loading.delete(id); reject(error); }
      });
    }
    function close() {
      for (const entry of pending.values()) clearTimeout(entry.timer);
      for (const entry of loading.values()) { clearTimeout(entry.timer); entry.reject(new Error("档案助手已关闭。")); }
      pending.clear(); loading.clear();
    }
    return Object.freeze({ observe, restore, close });
  }
  return Object.freeze({ create });
});
