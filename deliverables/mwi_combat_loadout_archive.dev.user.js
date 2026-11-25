// ==UserScript==
// @name         A配装助手 开发加载器
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive/dev
// @version      0.2.15
// @author       柆雨
// @homepageURL  https://github.com/LaYuDr/mwi-combat-loadout-archive
// @supportURL   https://github.com/LaYuDr/mwi-combat-loadout-archive/issues
// @description  银河奶牛配装助手：总览并编辑原生配装，保存场景子方案、高亮切换差异，记住生活与战斗项目的配装选择，支持子方案备份与跨设备云同步。
// @match        https://www.milkywayidle.com/game*
// @match        https://milkywayidle.com/game*
// @match        https://www.milkywayidlecn.com/game*
// @match        https://milkywayidlecn.com/game*
// @connect      clipboard.im
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addElement
// @connect      127.0.0.1
// @grant        unsafeWindow
// @noframes
// @license      MIT
// ==/UserScript==

(function () {
// Called inside the userscript sandbox. The development loader exposes only this
// fixed-host text operation to its page-world runtime, never a generic GM request.
function mwiLoadoutClipboard(name, text) {
  const match = typeof name === "string" && /^([1-9]\d*)loadout(0|[1-9]\d*)$/.exec(name);
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])) ||
      (text !== undefined && (typeof text !== "string" || !text.length || text.length > 5000000))) {
    throw Error("云同步参数无效。");
  }
  const url = "https://clipboard.im/api/clipboard/" + name;
  const reading = text === undefined;
  if (!reading) {
    const doc = JSON.parse(text);
    if (doc?.format !== "mwi-layu-loadouts-cloud" || doc.character !== Number(match[1]) || doc.loadoutId !== Number(match[2]) || ![2, 3].includes(doc.version) ||
        !Array.isArray(doc.scenes) || !Array.isArray(doc.memories)) throw Error("仅支持配装同步文本。");
  }
  return new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      url, method: reading ? "GET" : "PUT", anonymous: true, nocache: true, redirect: "error", timeout: 12000,
      headers: reading ? { Accept: "application/json" } : { "Content-Type": "application/json" },
      data: reading ? undefined : JSON.stringify({ text_content: text }),
      onload(response) {
        try {
          if (response.status < 200 || response.status >= 300) throw Error("剪贴板返回 HTTP " + response.status);
          if (!reading) { resolve(); return; }
          if (response.responseText.length > 12000000) throw Error("剪贴板内容过大。");
          const data = JSON.parse(response.responseText);
          if (data.clip_name !== name || data.has_password !== false || !Array.isArray(data.files) ||
              data.files.length || !(data.text_content === null || typeof data.text_content === "string")) {
            throw Object.assign(Error("剪贴板已加密、含文件或格式不兼容。"), { code: "BOARD_OCCUPIED" });
          }
          resolve(data.text_content ?? "");
        } catch (error) { reject(error); }
      },
      onerror: () => reject(Error("无法连接 clipboard.im，请检查网络或脚本权限。")),
      ontimeout: () => reject(Error("剪贴板请求超时。")),
      onabort: () => reject(Error("剪贴板请求已中断。"))
    });
  });
}
mwiLoadoutClipboard.protocolVersion = 3;

if (typeof GM_xmlhttpRequest === 'function') (typeof unsafeWindow === 'undefined' ? globalThis : unsafeWindow).__mwiLoadoutClipboardV2 = mwiLoadoutClipboard;
})();
(function () {
  "use strict";
  if (globalThis.__MWILoadoutDevLoader) return;
  globalThis.__MWILoadoutDevLoader = true;
  const fail = reason => console.error("[配装助手] 开发加载失败，请启动本地开发服务后刷新游戏。", reason);
  GM_xmlhttpRequest({
    method: "GET", url: "http://127.0.0.1:4178/runtime.js?cacheBust=" + Date.now(),
    anonymous: true, nocache: true, redirect: "error", timeout: 30000,
    onload(response) {
      if (response.status !== 200 || !response.responseText.startsWith("// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n")) {
        fail(`运行时校验失败，HTTP ${response.status}`); return;
      }
      const inject = () => {
        try {
          // Execute the local entry point in the page world.
          GM_addElement(document.documentElement, "script", {
            textContent: response.responseText + "\n//# sourceURL=mwi-loadout-archive-runtime.js"
          }).remove();
        } catch (error) { fail(error); }
      };
      if (document.documentElement) inject();
      else document.addEventListener("DOMContentLoaded", inject, { once: true });
    },
    onerror: fail, ontimeout: fail
  });
})();
