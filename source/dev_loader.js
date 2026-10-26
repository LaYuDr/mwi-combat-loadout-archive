(function () {
  "use strict";
  if (globalThis.__MWILoadoutDevLoader) return;
  globalThis.__MWILoadoutDevLoader = true;
  const fail = reason => console.error("[配装助手] 开发加载失败，请启动本地开发服务后刷新模拟器。", reason);
  GM_xmlhttpRequest({
    method: "GET", url: "http://127.0.0.1:4178/runtime.js?cacheBust=" + Date.now(),
    anonymous: true, nocache: true, redirect: "error", timeout: 30000,
    onload(response) {
      if (response.status !== 200 || !response.responseText.startsWith("// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME\n")) {
        fail(`运行时校验失败，HTTP ${response.status}`); return;
      }
      const inject = () => {
        try {
          // Run in the page world so message.source and the public import bridge
          // retain exactly the same semantics as the standalone userscript.
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
