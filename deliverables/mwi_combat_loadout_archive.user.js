// ==UserScript==
// @name         配装助手
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive
// @version      0.2.12
// @author       柆雨
// @homepageURL  https://github.com/LaYuDr/mwi-combat-loadout-archive
// @supportURL   https://github.com/LaYuDr/mwi-combat-loadout-archive/issues
// @updateURL    https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.user.js
// @description  银河奶牛配装助手：总览并编辑原生配装，保存场景子方案、高亮切换差异，记住生活与战斗项目的配装选择，支持子方案备份与跨设备云同步。
// @match        https://www.milkywayidle.com/game*
// @match        https://milkywayidle.com/game*
// @match        https://www.milkywayidlecn.com/game*
// @match        https://milkywayidlecn.com/game*
// @connect      clipboard.im
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_xmlhttpRequest
// @connect      ukpyedhl.cn-hk1.rainapp.top
// @antifeature  tracking Installation and daily activity statistics; see the script's settings and privacy details.
// @grant        GM_addElement
// @grant        unsafeWindow
// @sandbox      raw
// @noframes
// @license      MIT
// ==/UserScript==

// LAYU_USAGE_START mwi_loadout
/* Usage reporting policies are explicit per plugin; never loads remote code. */
(function () {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  function createUsageClient({
    pluginId,
    version,
    endpoint,
    defaultEnabled = false,
    reportOptOut = false,
    getValue,
    setValue,
    request,
    crypto = globalThis.crypto,
    now = Date.now,
    locks = globalThis.navigator?.locks
  }) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/")
      throw new Error("HTTPS origin required");
    if (!/^[a-z][a-z0-9_]{0,47}$/.test(pluginId) || !/^[a-zA-Z0-9._+-]{1,32}$/.test(version))
      throw new Error("Invalid plugin metadata");
    const key = `layu_usage_v1_${pluginId}`;
    let busy = false,
      nextTry = 0,
      failures = 0,
      generation = 0,
      stopped = false;
    let settingsQueue = Promise.resolve();
    const day = () => new Date(now() + 8 * 3600000).toISOString().slice(0, 10);
    async function enabled() {
      return !stopped && (await getValue(`${key}_consent`, defaultEnabled)) === true;
    }
    async function sendReport() {
      if (stopped || busy || now() < nextTry) return false;
      busy = true;
      const ticket = generation;
      try {
        if (!(await enabled()) || (await getValue(`${key}_day`, "")) === day()) return false;
        // Default-on policies may create an ID, but must never overwrite saved opt-outs.
        let id = await getValue(`${key}_id`, "");
        if (!UUID.test(id) && defaultEnabled && ticket === generation && (await enabled())) {
          await ensureIdentity();
          id = await getValue(`${key}_id`, "");
        }
        if (!UUID.test(id)) return false;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${pluginId}\0${id}`));
        if (ticket !== generation || !(await enabled())) return false;
        const sentDay = day();
        const installationHash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
        const response = await request({
          method: "POST",
          url: new URL("/v1/heartbeat", url).href,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({
            plugin_id: pluginId,
            installation_hash: installationHash,
            version
          }),
          anonymous: true,
          redirect: "error",
          timeout: 10000
        });
        if (
          response.status !== 200 ||
          (response.finalUrl && response.finalUrl !== new URL("/v1/heartbeat", url).href) ||
          JSON.parse(response.responseText).ok !== true
        )
          throw new Error("Usage request failed");
        if (ticket === generation && (await enabled())) await setValue(`${key}_day`, sentDay);
        failures = 0;
        nextTry = now() + 60000;
        return true;
      } catch (_) {
        failures += 1;
        nextTry = now() + Math.min(6 * 3600000, 60000 * 2 ** Math.min(failures, 9));
        return false;
      } finally {
        busy = false;
      }
    }
    function invalidate() {
      generation += 1;
    }
    async function ensureIdentity() {
      if (!UUID.test(await getValue(`${key}_id`, ""))) await setValue(`${key}_id`, crypto.randomUUID());
      if (!UUID.test(await getValue(`${key}_id`, ""))) throw new Error("Identity was not saved");
    }
    async function sendOptOut() {
      // One attempt per actual off transition; no identity, queue, retry or heartbeat accounting.
      try {
        await request({
          method: "POST",
          url: new URL("/v1/opt-out", url).href,
          headers: { "Content-Type": "application/json" },
          data: JSON.stringify({ plugin_id: pluginId, version }),
          anonymous: true,
          redirect: "error",
          timeout: 10000
        });
      } catch (_) {
        /* Disabling is saved locally even when the one-time event cannot be delivered. */
      }
    }
    function setEnabled(value) {
      invalidate();
      settingsQueue = settingsQueue
        .catch(() => {})
        .then(async () => {
          const wasEnabled = await enabled();
          if (value === true) {
            await ensureIdentity();
          }
          await setValue(`${key}_consent`, value === true);
          if (value !== true && wasEnabled && reportOptOut) void sendOptOut();
        });
      return settingsQueue;
    }
    async function report() {
      try {
        return locks ? await locks.request(key, sendReport) : await sendReport();
      } catch (_) {
        return false;
      }
    }
    return {
      report,
      setEnabled,
      enabled,
      invalidate,
      key,
      stop() {
        stopped = true;
        invalidate();
      }
    };
  }

  function boot(config, gm, env = globalThis) {
    // The loader and page runtime are intentionally excluded from production counting.
    if (
      config.development ||
      env.top !== env.self ||
      !/^https:\/\/(www\.)?milkywayidle(cn)?\.com$/.test(env.location?.origin || "")
    )
      return null;
    if (![gm.getValue, gm.setValue, gm.request, gm.listen, gm.unlisten].every((f) => typeof f === "function"))
      return null;
    const guard = `__layuUsage_${config.pluginId}`;
    if (env[guard]) return null;
    env[guard] = true;
    let disposed = false,
      suspended = false,
      timer = null,
      listenerId = null;
    let commandBusy = false;
    const pending = new Set();
    const optOutPending = new Set();
    const settings = new Map();
    const selector = `[data-layu-usage-settings="${config.pluginId}"]`;
    let settingsError = false;
    let observer = null;
    const client = createUsageClient({
      ...config,
      crypto: env.crypto,
      locks: env.navigator?.locks,
      getValue: gm.getValue,
      setValue: gm.setValue,
      request(details) {
        return new Promise((resolve, reject) => {
          const requests = new URL(details.url).pathname === "/v1/opt-out" ? optOutPending : pending;
          let handle,
            finished = false;
          const complete = (error, response) => {
            if (finished) return;
            finished = true;
            env.clearTimeout(deadline);
            requests.delete(cancel);
            if (error) reject(new Error("Usage request failed"));
            else resolve(response);
          };
          const cancel = () => {
            complete(true);
            try {
              handle?.abort();
            } catch (_) {
              /* Best effort. */
            }
          };
          const deadline = env.setTimeout(cancel, 12000);
          requests.add(cancel);
          try {
            handle = gm.request({
              ...details,
              onload: (r) => complete(false, r),
              onerror: () => complete(true),
              ontimeout: () => complete(true),
              onabort: () => complete(true)
            });
          } catch (_) {
            complete(true);
          }
        });
      }
    });
    const cancelPending = () => {
      client.invalidate();
      for (const cancel of [...pending]) cancel();
    };
    const report = () => {
      if (!disposed && !suspended) void client.report();
    };
    function mountSettings(host) {
      if (settings.has(host) || typeof host.attachShadow !== "function") return;
      const zh = /^zh/i.test(host.getAttribute("lang") || env.navigator?.language || "zh");
      const words = zh
        ? {
            title: "使用量统计",
            off: "已关闭",
            on: "已开启",
            enable: "开启",
            disable: "关闭",
            cancel: "取消",
            confirm: "确认开启",
            summary: "仅发送随机安装摘要、插件和版本，用于安装及日活统计。",
            more: "数据范围",
            details: `接收方：柆雨的雨云服务（${new URL(config.endpoint).hostname}）。每天最多一次，不传游戏数据或 Cookie。服务器暂存后同步到开发者电脑，历史永久保留；网络服务可见 IP。关闭只停止后续上报，不删除历史。`,
            question: "确认向柆雨的统计服务发送这些数据？",
            failed: "设置未保存，请重试。",
            unavailable: "统计设置暂不可用。"
          }
        : {
            title: "Usage statistics",
            off: "Off",
            on: "On",
            enable: "Enable",
            disable: "Turn off",
            cancel: "Cancel",
            confirm: "Confirm enable",
            summary: "Sends a random installation hash, plugin ID and version to count installs and daily activity.",
            more: "Data details",
            details: `Recipient: LaYu's Rainyun service (${new URL(config.endpoint).hostname}). At most once daily; no game data or cookies. Reports are transferred to the developer's computer and retained indefinitely. The network service sees your IP. Turning off stops future reports; existing history remains.`,
            question: "Send these data to LaYu’s statistics service?",
            failed: "Settings were not saved. Please retry.",
            unavailable: "Usage settings are unavailable."
          };
      if (config.defaultEnabled) {
        Object.assign(
          words,
          zh
            ? {
                title: "安装与活跃统计",
                summary: "默认开启，可随时关闭，不影响插件功能。统计安装数和每日活跃安装数，不统计游戏内操作。",
                more: "隐私与数据说明",
                details: `开启时，仅向柆雨的统计服务（${new URL(config.endpoint).hostname}）发送插件标识、版本和随机安装标识的 SHA-256 摘要。标识仅保存在该脚本的 Tampermonkey 存储中，不使用硬件指纹，不发送账号、角色、聊天、资产、交易或 Cookie。摘要用于识别同一安装，不代表完全匿名；网络服务可见来源 IP。数据通过 HTTPS 发送，按北京时间每日去重，失败时可能重试。服务器暂存后同步到开发者电脑，历史及备份不设自动删除期限。安装数不等于设备数或人数。`,
                question: "开启后将发送上述安装与活跃统计，是否继续？"
              }
            : {
                title: "Installation and activity statistics",
                summary:
                  "On by default. Turn off at any time without affecting plugin features. Counts installations and daily active installations, not in-game actions.",
                more: "Privacy and data details",
                details: `While on, sends only the plugin ID, version and SHA-256 hash of a random installation ID to LaYu's statistics service (${new URL(config.endpoint).hostname}). The ID stays in this script's Tampermonkey storage. No hardware fingerprint, account, character, chat, asset, trade data or cookies are sent. The hash recognises the same installation, so this is not fully anonymous; the network service sees the source IP. Sent over HTTPS, deduplicated by Beijing calendar day; failures may be retried. Reports are transferred from the server to the developer's computer. History and backups have no automatic deletion deadline. Installation counts are not device or person counts.`,
                question: "Enable the installation and activity reports described above?"
              }
        );
      }
      if (config.reportOptOut) {
        words.summary += zh
          ? "关闭时仍会尝试发送一次仅含插件标识和版本的关闭事件，失败不重试，之后不再上报；已有历史保留。"
          : " Turning off still attempts one opt-out report containing only the plugin ID and version, with no retry or further reports. Existing history remains.";
      }
      const root = host.shadowRoot || host.attachShadow({ mode: "open" });
      root.innerHTML = `<style>
        :host { display:block; margin-block:12px; color:inherit; font:inherit; min-width:0; }
        *,*::before,*::after { box-sizing:border-box; }
        .row,.actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; }
        .row { justify-content:space-between; } strong { font-size:14px; }
        p,details { margin:6px 0 0; font-size:13px; line-height:1.5; overflow-wrap:anywhere; }
        button { font:inherit; font-size:13px; color:inherit; background:#34394f; border:1px solid #626b86; border-radius:4px; padding:5px 10px; min-height:32px; cursor:pointer; }
        button:hover { background:#454e68; } button:disabled { opacity:.55; cursor:default; }
        button:focus-visible,summary:focus-visible { outline:2px solid #91dfcb; outline-offset:2px; }
        summary { cursor:pointer; width:fit-content; } .confirm { margin-top:8px; } .actions { margin-top:6px; }
        [hidden] { display:none!important; } .status { min-height:0; }
      </style><section><div class="row"><strong></strong><button type="button" data-action="toggle" aria-pressed="false" aria-expanded="false"></button></div>
      <p class="summary"></p><details><summary></summary><p class="details"></p></details>
      <div class="confirm" role="group" hidden><p class="question"></p><div class="actions"><button type="button" data-action="confirm"></button><button type="button" data-action="cancel"></button></div></div>
      <p class="status" role="status" aria-live="polite"></p></section>`;
      const toggle = root.querySelector('[data-action="toggle"]');
      const confirmation = root.querySelector(".confirm");
      const confirm = root.querySelector('[data-action="confirm"]');
      const cancel = root.querySelector('[data-action="cancel"]');
      root.querySelector("strong").textContent = words.title;
      root.querySelector(".summary").textContent = words.summary;
      root.querySelector("summary").textContent = words.more;
      root.querySelector(".details").textContent = words.details;
      root.querySelector(".question").textContent = words.question;
      confirmation.setAttribute("aria-label", words.question);
      confirmation.id = `${config.pluginId}-usage-confirm`;
      toggle.setAttribute("aria-controls", confirmation.id);
      confirm.textContent = words.confirm;
      cancel.textContent = words.cancel;
      const binding = {
        pending: false,
        render(on, unavailable = false) {
          if (on || unavailable) binding.pending = false;
          toggle.textContent = on ? words.disable : words.enable;
          toggle.setAttribute("aria-label", `${words.title}: ${on ? words.disable : words.enable}`);
          toggle.setAttribute("aria-pressed", String(on));
          toggle.setAttribute("aria-expanded", String(binding.pending));
          toggle.disabled = commandBusy || unavailable;
          confirm.disabled = cancel.disabled = commandBusy;
          confirmation.hidden = !binding.pending;
          root.querySelector(".status").textContent = unavailable
            ? words.unavailable
            : settingsError
              ? words.failed
              : on
                ? words.on
                : words.off;
        },
        dispose() {
          root.removeEventListener("click", click);
          root.replaceChildren();
        }
      };
      async function click(event) {
        // Page scripts must not opt in by dispatching synthetic clicks.
        if (event.isTrusted !== true || commandBusy || disposed) return;
        const action = event.target.closest?.("button[data-action]")?.dataset.action;
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        let active;
        try {
          active = await client.enabled();
        } catch (_) {
          settingsError = true;
          update();
          return;
        }
        if (action === "cancel") {
          binding.pending = false;
          update();
          toggle.focus();
          return;
        }
        if (action === "toggle" && !active) {
          binding.pending = !binding.pending;
          if (binding.pending) root.querySelector("details").open = true;
          settingsError = false;
          update();
          if (binding.pending) confirm.focus();
          return;
        }
        if (action !== "toggle" && (action !== "confirm" || !binding.pending || active)) return;
        commandBusy = true;
        settingsError = false;
        binding.pending = false;
        cancelPending();
        update();
        try {
          await client.setEnabled(!active);
          if (!active) report();
        } catch (_) {
          settingsError = true;
        } finally {
          commandBusy = false;
          update();
          if (host.isConnected) toggle.focus();
        }
      }
      root.addEventListener("click", click);
      settings.set(host, binding);
    }
    function discover(nodes) {
      if (disposed) return;
      for (const [host, binding] of settings) {
        if (!host.isConnected) {
          binding.dispose();
          settings.delete(host);
        }
      }
      for (const node of nodes) {
        if (node.matches?.(selector)) mountSettings(node);
        for (const host of node.querySelectorAll?.(selector) || []) mountSettings(host);
      }
      update();
    }
    function update() {
      if (disposed) return;
      try {
        const on = gm.getValue(`${client.key}_consent`, config.defaultEnabled === true) === true;
        for (const binding of settings.values()) binding.render(on);
        if (timer !== null) {
          env.clearInterval(timer);
          timer = null;
        }
        if (on && !suspended) timer = env.setInterval(report, 15 * 60000);
        if (!on) cancelPending();
      } catch (_) {
        cancelPending();
        if (timer !== null) {
          env.clearInterval(timer);
          timer = null;
        }
        for (const binding of settings.values()) binding.render(false, true);
      }
    }
    function changed() {
      cancelPending();
      update();
      report();
    }
    function visible() {
      if (env.document.visibilityState === "visible") report();
    }
    function pagehide(event) {
      suspended = true;
      cancelPending();
      for (const cancel of [...optOutPending]) cancel();
      if (timer !== null) {
        env.clearInterval(timer);
        timer = null;
      }
      if (!event.persisted) dispose();
    }
    function pageshow() {
      if (!disposed) {
        suspended = false;
        update();
        report();
      }
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      client.stop();
      cancelPending();
      for (const cancel of [...optOutPending]) cancel();
      if (timer !== null) env.clearInterval(timer);
      observer?.disconnect();
      for (const binding of settings.values()) binding.dispose();
      settings.clear();
      try {
        if (listenerId !== null) gm.unlisten(listenerId);
      } catch (_) {
        /* Page closing. */
      }
      env.removeEventListener("online", report);
      env.removeEventListener("pagehide", pagehide);
      env.removeEventListener("pageshow", pageshow);
      env.document.removeEventListener("visibilitychange", visible);
      delete env[guard];
    }
    try {
      listenerId = gm.listen(`${client.key}_consent`, changed);
      env.addEventListener("online", report);
      env.addEventListener("pagehide", pagehide);
      env.addEventListener("pageshow", pageshow);
      env.document.addEventListener("visibilitychange", visible);
      if (typeof env.MutationObserver === "function" && typeof env.document.querySelectorAll === "function") {
        observer = new env.MutationObserver((records) => {
          const added = records.flatMap((record) => Array.from(record.addedNodes || []));
          if (added.length || records.some((record) => record.removedNodes?.length)) discover(added);
        });
        observer.observe(env.document, {
          childList: true,
          subtree: true
        });
      }
      discover([env.document]);
      report();
    } catch (_) {
      dispose();
    }
    return { dispose, report, client };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { createUsageClient, boot };
  try { boot({"pluginId":"mwi_loadout","name":"配装助手","version":"0.2.12","endpoint":"https://ukpyedhl.cn-hk1.rainapp.top","development":false,"defaultEnabled":true,"reportOptOut":true}, {getValue: typeof GM_getValue === "function" ? GM_getValue : null,
setValue: typeof GM_setValue === "function" ? GM_setValue : null,
listen: typeof GM_addValueChangeListener === "function" ? GM_addValueChangeListener : null,
unlisten: typeof GM_removeValueChangeListener === "function" ? GM_removeValueChangeListener : null,
request: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null}); } catch (_) { /* Telemetry is optional. */ }
})();

// LAYU_USAGE_END mwi_loadout

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

if (typeof GM_xmlhttpRequest === 'function') globalThis.__mwiLoadoutClipboardV2 = mwiLoadoutClipboard;
})();
// MWI_COMBAT_LOADOUT_ARCHIVE_RUNTIME
// ---- scene_core.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const EQUIPMENT = {
    back: "背部", head: "头部", trinket: "徽章", main_hand: "主手", off_hand: "副手",
    body: "身体", hands: "手部", legs: "腿部", pouch: "食物袋", feet: "脚部",
    neck: "项链", earrings: "耳环", ring: "戒指", charm: "护符",
    milking_tool: "挤奶工具", foraging_tool: "采摘工具", woodcutting_tool: "伐木工具",
    cheesesmithing_tool: "奶酪锻造工具", crafting_tool: "制作工具", tailoring_tool: "缝纫工具",
    cooking_tool: "烹饪工具", brewing_tool: "冲泡工具", alchemy_tool: "炼金工具", enhancing_tool: "强化工具"
  };
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const hrid = (value, kind) => typeof value === "string" && new RegExp(`^/${kind}/[a-z0-9_]+$`).test(value);
  function copy(value) {
    let nodes = 0;
    function check(v, depth) {
      if (++nodes > 30000 || depth > 24) throw Error("配置结构过于复杂，未保存。 ");
      if (v === null || typeof v === "boolean" || typeof v === "string") return;
      if (typeof v === "number" && Number.isFinite(v)) return;
      if (typeof v !== "object" || !v) throw Error("配置含不可保存的字段，请等待网页数据完整后重试。");
      for (const key of Object.keys(v)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw Error("配置包含不安全字段，未保存。");
        check(v[key], depth + 1);
      }
    }
    check(value, 0);
    const text = JSON.stringify(value);
    if (text.length > 300000) throw Error("单份配置超过大小限制，未保存。");
    return JSON.parse(text);
  }
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
    if (object(value)) return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value);
  }
  function item(hash) {
    if (!hash) return null;
    const match = /^(\d+)::\/item_locations\/[a-z0-9_]+::(\/items\/[a-z0-9_]+)::(\d+)$/.exec(hash);
    if (!match) throw Error("装备标识无法识别，请等待网页数据完整后重试。");
    const level = Number(match[3]);
    if (!Number.isSafeInteger(level) || level > 1000) throw Error("装备强化等级无法识别。");
    return { itemHrid: match[2], enhancementLevel: level };
  }
  function validate(raw) {
    if (!object(raw) || !Number.isSafeInteger(raw.id) || raw.id <= 0 || typeof raw.name !== "string" ||
        !(raw.actionTypeHrid === "" || raw.actionTypeHrid === null || hrid(raw.actionTypeHrid, "action_types")) ||
        !object(raw.wearableMap) || typeof raw.useExactEnhancement !== "boolean")
      throw Error("未能完整读取原生配装，请重新打开配装详情后重试。");
    const combat = raw.actionTypeHrid === "/action_types/combat";
    // Native life/all-skills loadouts do not render combat slots. Keep absent
    // inactive fields unchanged; active fields must still be complete before saving.
    if ((combat || raw.abilityMap != null) && !object(raw.abilityMap) ||
        (combat || raw.foodItemHrids != null) && !Array.isArray(raw.foodItemHrids) ||
        (raw.actionTypeHrid || raw.drinkItemHrids != null) && !Array.isArray(raw.drinkItemHrids))
      throw Error("未能完整读取原生配装，请重新打开配装详情后重试。");
    for (const [key, value] of Object.entries(raw.wearableMap)) {
      if (!hrid(key, "item_locations") || !(value === null || typeof value === "string")) throw Error("装备槽位数据无法识别。");
      item(value);
    }
    for (const [key, value] of Object.entries(raw.abilityMap || {})) {
      if (!/^[1-5]$/.test(key) || !(value === null || value === "" || hrid(value, "abilities"))) throw Error("技能槽位数据无法识别。");
    }
    for (const list of [raw.foodItemHrids || [], raw.drinkItemHrids || []]) {
      if (list.length > 3 || list.some(v => !(v === null || v === "" || hrid(v, "items")))) throw Error("消耗品槽位数据无法识别。");
    }
    for (const key of ["abilityCombatTriggersMap", "consumableCombatTriggersMap"]) {
      // The verified native renderer treats an absent map/entry as an empty trigger list.
      if (raw[key] === undefined || raw[key] === null) continue;
      if (!object(raw[key])) throw Error("触发条件数据不完整，未保存。");
      for (const [id, triggers] of Object.entries(raw[key])) {
        if (!hrid(id, key === "abilityCombatTriggersMap" ? "abilities" : "items") || !Array.isArray(triggers) || triggers.length > 100)
          throw Error("触发条件格式无法识别，未保存。");
        for (const trigger of triggers) {
          if (!object(trigger) || !hrid(trigger.dependencyHrid, "combat_trigger_dependencies") ||
              !hrid(trigger.conditionHrid, "combat_trigger_conditions") || !hrid(trigger.comparatorHrid, "combat_trigger_comparators") ||
              typeof trigger.value !== "number" || !Number.isFinite(trigger.value)) throw Error("触发条件尚未完整设置，未保存。");
        }
      }
    }
    return copy(raw);
  }
  function name(value) {
    const result = String(value || "").trim();
    if (!result || result.length > 60) throw Error("请输入 1–60 字的子方案名称。");
    return result;
  }
  function snapshot(raw) { return { schemaVersion: 1, raw: validate(raw) }; }
  function validateSnapshot(value) {
    if (!object(value) || value.schemaVersion !== 1) throw Error("子方案版本无法识别，请使用兼容版本。");
    return snapshot(value.raw);
  }
  function equipment(raw) {
    const result = {}, combat = raw.actionTypeHrid === "/action_types/combat";
    const available = key => !combat || !key.endsWith("_tool");
    for (const key of Object.keys(EQUIPMENT)) if (available(key)) result[key] = null;
    for (const [location, hash] of Object.entries(raw.wearableMap)) {
      const key = location.split("/").pop();
      if (hash && available(key)) result[key === "two_hand" ? "main_hand" : key] = item(hash);
    }
    return result;
  }
  function diff(current, target) {
    const a = validate(current), b = validateSnapshot(target).raw, changes = [];
    if (a.id !== b.id || (a.actionTypeHrid || "") !== (b.actionTypeHrid || ""))
      throw Error("子方案与当前父配装不匹配，请重新选择。");
    const combat = b.actionTypeHrid === "/action_types/combat";
    const add = (kind, slot, label, from, to) => {
      if (stable(from) !== stable(to)) changes.push({ kind, slot, label, from, to });
    };
    add("setting", "enhancement", "强化选择", a.useExactEnhancement, b.useExactEnhancement);
    const ae = equipment(a), be = equipment(b);
    for (const key of new Set([...Object.keys(ae), ...Object.keys(be)])) {
      const normalize = v => v ? { itemHrid: v.itemHrid, ...(b.useExactEnhancement ? { enhancementLevel: v.enhancementLevel } : {}) } : null;
      add("equipment", key, EQUIPMENT[key] || key, normalize(ae[key]), normalize(be[key]));
    }
    if (combat) for (let slot = 1; slot <= 5; slot++) {
      const from = a.abilityMap[slot] || null, to = b.abilityMap[slot] || null;
      add("ability", slot, `技能 ${slot}`, from, to);
      add("ability_trigger", slot, `技能 ${slot} · 触发条件`, from ? a.abilityCombatTriggersMap?.[from] || [] : [], to ? b.abilityCombatTriggersMap?.[to] || [] : []);
    }
    for (const kind of combat ? ["food", "drink"] : b.actionTypeHrid ? ["drink"] : []) {
      for (let slot = 0; slot < 3; slot++) {
        const from = a[`${kind}ItemHrids`][slot] || null, to = b[`${kind}ItemHrids`][slot] || null;
        const label = `${kind === "food" ? "食物" : "饮料"} ${slot + 1}`;
        add(kind, slot, label, from, to);
        if (combat) add(`${kind}_trigger`, slot, `${label} · 触发条件`, from ? a.consumableCombatTriggersMap?.[from] || [] : [], to ? b.consumableCombatTriggersMap?.[to] || [] : []);
      }
    }
    return changes;
  }
  app.Core = Object.freeze({ copy, stable, item, validate, name, snapshot, validateSnapshot, diff, EQUIPMENT });
  if (typeof module !== "undefined" && module.exports) module.exports = app.Core;
})(globalThis);

// ---- game_adapter.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const selector = part => `[class*="LoadoutsPanel_${part}__"]`;
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length && !element.closest('[hidden], [aria-hidden="true"]'));
  function hostFiber(element, portalRoot = null) {
    const key = Object.getOwnPropertyNames(element).find(key => /^__react(?:Fiber|InternalInstance)\$/.test(key));
    if (key && element[key]) return element[key];
    // Some live pages expose no host expandos. Read only the committed tree,
    // locating this exact DOM node instead of choosing an unrelated controller.
    const container = document.getElementById("root");
    if (!container) return null;
    const roots = [container._reactRootContainer];
    for (const key of Object.getOwnPropertyNames(container)) {
      if (/^__reactContainer\$/.test(key)) roots.push(container[key]);
    }
    const pending = portalRoot ? [portalRoot] : roots.map(root => root?.current || root?._internalRoot?.current || root?.stateNode?.current).filter(Boolean);
    const seen = new Set();
    for (let scanned = 0; pending.length && scanned < 4000; scanned++) {
      const fiber = pending.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      if (fiber.stateNode === element) return fiber;
      if (fiber.sibling) pending.push(fiber.sibling);
      const node = fiber.stateNode;
      // Skip chat, inventory and other DOM branches, even on very large pages.
      if (!portalRoot && node?.nodeType === 1 && !node.contains(element)) continue;
      if (fiber.child) pending.push(fiber.child);
    }
    return null;
  }
  function visibleLoadoutPanel() {
    const panels = [...document.querySelectorAll(selector("loadoutsPanel"))].filter(visible);
    return panels.length === 1 ? panels[0] : null;
  }
  function loadoutController(panel) {
    let fiber = hostFiber(panel), controller = null;
    if (!fiber) throw Error("无法读取游戏配装数据；请重新打开配装详情，若仍失败请反馈页面版本。");
    const seen = new Set();
    for (let i = 0; fiber && i < 80 && !seen.has(fiber); i++, fiber = fiber.return) {
      seen.add(fiber);
      const instance = fiber.stateNode;
      if (instance?.state && Object.hasOwn(instance.state, "selectedCharacterLoadoutId") && instance.props?.characterLoadoutDict) {
        if (controller && controller !== instance) throw Error("检测到多个配装上下文，已停止读取。");
        controller = instance;
      }
    }
    return controller;
  }
  function current() {
    const panel = visibleLoadoutPanel();
    if (!panel) return null;
    const details = panel.querySelector(selector("details")), setup = panel.querySelector(selector("setup"));
    if (!visible(details) || !visible(setup) || details.closest("[data-mwi-loadout-overview]")) return null;
    const controller = loadoutController(panel);
    if (!controller) throw Error("原生配装数据尚未就绪，请重新打开配装。");
    const props = controller.props, id = controller.state.selectedCharacterLoadoutId;
    const characterId = props.characterInfo?.characterID;
    if (!Number.isSafeInteger(characterId) || characterId <= 0) throw Error("无法确认当前角色，已停止保存。");
    const raw = app.Core.validate(props.characterLoadoutDict[id]);
    if (raw.id !== id) throw Error("原生配装选择尚未同步，请稍后重试。");
    const owner = `${location.origin}|${characterId}`, scope = `${owner}|${raw.id}`;
    return { raw, owner, scope, panel, details, setup, props };
  }
  function translate(ctx, group, hrid) {
    if (!hrid) return "空槽";
    const key = `${group}.${hrid}`;
    try {
      const translated = ctx?.props?.t?.(key);
      if (typeof translated === "string" && translated !== key) return translated;
    } catch (_) { /* A missing translation must not prevent comparison. */ }
    return hrid.split("/").pop();
  }
  function triggersText(ctx, triggers) {
    if (!triggers.length) return "冷却结束即使用（无附加条件）";
    return triggers.map(t => [translate(ctx, "combatTriggerDependencyNames", t.dependencyHrid),
      translate(ctx, "combatTriggerConditionNames", t.conditionHrid),
      translate(ctx, "combatTriggerComparatorNames", t.comparatorHrid), String(t.value)].join(" ")).join("；并且 ");
  }
  function describe(ctx, change, value) {
    if (change.kind === "setting") return value ? "指定强化等级" : "使用最高强化等级";
    if (change.kind.endsWith("_trigger")) return triggersText(ctx, value);
    if (!value) return "空槽";
    if (typeof value === "string") return translate(ctx, change.kind === "ability" ? "abilityNames" : "itemNames", value);
    return translate(ctx, "itemNames", value.itemHrid) + (Object.hasOwn(value, "enhancementLevel") ? ` +${value.enhancementLevel}` : "（最高强化）");
  }
  function fibers(element, select) {
    let fiber = hostFiber(element);
    for (let depth = 0; fiber && depth < 20; depth++, fiber = fiber.return) {
      for (const props of [fiber.stateNode?.props, fiber.memoizedProps]) {
        if (props && select(props)) return true;
      }
    }
    return false;
  }
  function target(ctx, change) {
    if (change.kind === "setting") return [...ctx.details.querySelectorAll('input[type="checkbox"]')].find(input =>
      fibers(input, props => props.checked === !ctx.raw.useExactEnhancement &&
        typeof props.label === "string" && /最高|Highest/i.test(props.label)))?.closest("label") || ctx.details.querySelectorAll(selector("metadata"))[3] || ctx.setup;
    const kind = change.kind.replace(/_trigger$/, "");
    if (kind === "equipment") {
      const slots = ctx.setup.querySelector(selector("playerModel"));
      if (!slots) return null;
      const position = { back: [1,1], head: [1,2], trinket: [1,3], main_hand: [2,1], off_hand: [2,3], body: [2,2],
        hands: [3,1], legs: [3,2], pouch: [3,3], feet: [4,2], neck: [1,5], earrings: [2,5], ring: [3,5], charm: [4,5],
        milking_tool: [7,1], foraging_tool: [7,2], woodcutting_tool: [7,3], cheesesmithing_tool: [7,4], crafting_tool: [7,5],
        tailoring_tool: [8,1], cooking_tool: [8,2], brewing_tool: [8,3], alchemy_tool: [8,4], enhancing_tool: [8,5] }[change.slot];
      if (!position) return null;
      return [...slots.children].find(el => el.style.gridRowStart === String(position[0]) && el.style.gridColumnStart === String(position[1])) || null;
    }
    const container = ctx.setup.querySelector(selector(kind === "ability" ? "abilities" : "consumables"));
    if (!container) return null;
    const candidates = [...container.children].filter(el => fibers(el, props => kind === "ability"
      ? props.slotNumber === change.slot
      : props.slotIndex === change.slot && props.consumableSlotTypeHrid === `/consumable_slot_types/${kind}`));
    if (candidates.length !== 1) return null;
    if (change.kind.endsWith("_trigger")) return candidates[0].querySelector('[class*="CombatTriggersSetting_settingButton__"]') || candidates[0];
    return candidates[0];
  }
  // Match only choices in a visible picker belonging to the changed native slot.
  // Item identity comes from component props, never translated labels or icon URLs.
  function pickerTargets(ctx, changes) {
    const result = [];
    for (const list of document.querySelectorAll('[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"]')) {
      if (!visible(list)) continue;
      const ability = list.className.includes("AbilitySlot_");
      const listFiber = hostFiber(list, hostFiber(ctx.panel)), ancestors = new Set(); let owner = listFiber;
      for (let i = 0; owner && i < 80; i++, owner = owner.return) ancestors.add(owner.stateNode);
      const change = changes.find(change => change.to && (ability ? change.kind === "ability" : ["equipment", "food", "drink"].includes(change.kind)) && ancestors.has(target(ctx, change)));
      if (!change) continue;
      const itemTarget = change.kind === "equipment" ? change.to : { itemHrid: change.to };
      const hosts = new Map(), queue = listFiber?.child ? [listFiber.child] : [], visited = new Set();
      for (let count = 0; queue.length && count < 4000; count++) {
        const fiber = queue.pop(); if (!fiber || visited.has(fiber)) continue; visited.add(fiber);
        if (fiber.stateNode?.nodeType === 1) hosts.set(fiber.stateNode, fiber);
        if (fiber.child) queue.push(fiber.child); if (fiber.sibling) queue.push(fiber.sibling);
      }
      for (const choice of list.children) {
        if (!visible(choice) || /insufficient|requirementsNotMet/.test(choice.className)) continue;
        const first = hosts.get(choice) || hostFiber(choice), pending = first ? [first] : [], seen = new Set(); let match = false;
        for (let count = 0; pending.length && count < 400; count++) {
          const fiber = pending.pop(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
          const props = fiber.memoizedProps || fiber.stateNode?.props;
          if (props && (ability ? props.abilityHrid === change.to : props.itemHrid === itemTarget.itemHrid &&
              (!Object.hasOwn(itemTarget, "enhancementLevel") || props.enhancementLevel === itemTarget.enhancementLevel))) { match = true; break; }
          if (fiber.child) pending.push(fiber.child);
          if (fiber !== first && fiber.sibling) pending.push(fiber.sibling);
        }
        if (match) result.push(choice);
      }
    }
    return result;
  }
  function actionContexts() {
    const contexts = [];
    for (const panel of document.querySelectorAll('[class*="SkillActionDetail_skillActionDetail__"]')) {
      // MUI temporarily sets aria-hidden on the background while its menu is open.
      if (!panel.isConnected || !panel.getClientRects().length || panel.closest('[hidden]')) continue;
      const dropdown = panel.querySelector('[class*="SkillActionDetail_loadoutDropdown__"]');
      if (!dropdown?.getClientRects().length) continue;
      let fiber = hostFiber(panel);
      const seen = new Set();
      for (let depth = 0; fiber && depth < 80 && !seen.has(fiber); depth++, fiber = fiber.return) {
        seen.add(fiber);
        const controller = fiber.stateNode;
        if (controller?.props?.actionDetail && Array.isArray(controller.state?.loadoutOptions) &&
            typeof controller.loadoutSelected === "function" && typeof controller.setState === "function") {
          contexts.push({ panel, dropdown, controller }); break;
        }
      }
    }
    return contexts;
  }
  function cloudContext(listLoadouts = true) {
    let character, dict;
    const host = document.querySelector('[class*="GamePage_gamePage"]');
    let fiber = host && hostFiber(host);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const state = fiber.stateNode?.state;
      if (state?.characterItemMap && state.character) {
        if (state.isLoading || state.isFullDisconnected) return null;
        character = state.character.id;
        dict = state.characterLoadoutDict;
        break;
      }
    }
    if (!character || listLoadouts && !dict) {
      const panel = visibleLoadoutPanel();
      const props = (panel ? loadoutController(panel) : actionContexts()[0]?.controller)?.props;
      if (!character || props?.characterInfo?.characterID === character) {
        character = props?.characterInfo?.characterID;
        dict = props?.characterLoadoutDict;
      }
    }
    if (!Number.isSafeInteger(character) || character <= 0) return null;
    if (!listLoadouts) return { character };
    const loadoutIds = Object.values(dict || {}).map(row => row?.id).filter(id => Number.isSafeInteger(id) && id > 0);
    return { character, loadoutIds: dict ? loadoutIds : null, loadouts: dict };
  }
  function nativeSnapshot(character, id) {
    const ctx = cloudContext();
    if (ctx?.character !== character || ctx.loadouts?.[id]?.id !== id)
      throw Error("当前原生配装尚未完整加载，请稍后重试。");
    return app.Core.snapshot(ctx.loadouts[id]);
  }
  app.Adapter = Object.freeze({ nativeSnapshot, cloudContext, current, describe, target, pickerTargets, actionContexts, visibleLoadoutPanel, loadoutController });
})(globalThis);

// ---- scene_store.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  let opening;
  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("mwi-layu-loadout-scenes", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("scenes", { keyPath: "id" });
        store.createIndex("scope", "scope", { unique: false });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = () => { opening = null; reject(Error("无法打开子方案数据库，请检查浏览器存储权限后重试。")); };
      request.onblocked = () => { opening = null; reject(Error("数据库被其他标签页占用，请关闭旧标签页后重试。")); };
    });
    return opening;
  }
  async function transaction(scope, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("scenes", mode), store = tx.objectStore("scenes");
      const request = store.index("scope").getAll(scope);
      let result, error;
      request.onsuccess = () => {
        try { result = work(request.result, store); }
        catch (e) { error = e; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(error || Error("子方案未能保存，原有记录保持不变；请检查存储空间后重试。"));
    });
  }
  function unique(rows, title, except) {
    if (rows.some(row => row.id !== except && !row.removedAt && row.name === title))
      throw Error("已有同名子方案，请改名或选择“更新”。");
  }
  const Core = () => app.Core;
  function record(ctx, title, raw) {
    return { id: crypto.randomUUID(), scope: ctx.scope, owner: ctx.owner, parentId: raw.id,
      name: Core().name(title), snapshot: Core().snapshot(raw), revision: crypto.randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), removedAt: null };
  }
  async function create(ctx, title) {
    const row = record(ctx, title, ctx.raw);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      unique(rows, row.name); store.add(row); return row;
    });
  }
  function revise(before) {
    return { ...before, updatedAt: Math.max(Date.now(), before.updatedAt + 1), revision: crypto.randomUUID(),
      ancestors: [...new Set([...(before.ancestors || []), before.revision])] };
  }
  function resolveConflict(ctx, main, copy, choice) {
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const pair = app.Cloud.conflictPairs(rows).find(([a, b]) => a.id === main.id && b.id === copy.id);
      if (!pair || pair[0].revision !== main.revision || pair[1].revision !== copy.revision)
        throw Error("这两个版本已有变化，请重新读取后再比较。");
      const [a, b] = pair;
      const retired = revise(b);
      delete retired.conflictOf;
      const originalName = b.name.replace(/（冲突副本）$/, "") || "子方案";
      if (choice === "both") {
        let index = 2;
        do { retired.name = originalName.slice(0, 48) + "（版本 " + index++ + "）"; }
        while (rows.some(row => row.id !== b.id && !row.removedAt && row.name === retired.name));
      } else if (choice === "a" || choice === "b") {
        const updated = revise(a);
        if (choice === "b") {
          Object.assign(updated, { name: originalName, snapshot: b.snapshot, removedAt: b.removedAt });
          if (updated.removedAt == null) unique(rows.filter(row => row.id !== b.id), updated.name, a.id);
        }
        store.put(updated);
        retired.removedAt = retired.updatedAt;
      } else throw Error("请选择要保留的版本。");
      store.put(retired);
    });
  }
  async function mutate(ctx, expected, action, value) {
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const before = rows.find(row => row.id === expected.id);
      if (!before || before.revision !== expected.revision) throw Error("这个子方案已在其他标签页更新，请重新读取后再操作。");
      const row = revise(before);
      if (action === "rename") { row.name = Core().name(value); unique(rows, row.name, row.id); }
      else if (action === "snapshot") row.snapshot = Core().snapshot(ctx.raw);
      else if (action === "remove") { row.removedAt = Date.now(); delete row.conflictOf; }
      else if (action === "restore") { unique(rows, row.name, row.id); row.removedAt = null; }
      else throw Error("无法识别的子方案操作。");
      store.put(row); return row;
    });
  }
  function parseBackup(text, ctx) {
    if (typeof text !== "string" || text.length > 5000000) throw Error("备份超过 5 MB，未导入。");
    let data;
    try { data = JSON.parse(text); } catch (_) { throw Error("备份不是有效 JSON，未导入。"); }
    if (data?.format !== "mwi-layu-loadout-scenes" || data.schemaVersion !== 1 || data.scope !== ctx.scope ||
        !Array.isArray(data.scenes) || data.scenes.length > 200) throw Error("备份格式或所属角色、父配装不匹配，未导入。");
    return data.scenes.map(row => {
      const snapshot = Core().validateSnapshot(row.snapshot);
      if (snapshot.raw.id !== ctx.raw.id || (snapshot.raw.actionTypeHrid || "") !== (ctx.raw.actionTypeHrid || ""))
        throw Error("备份包含其他父配装或配装类型，未导入。");
      return record(ctx, row.name, snapshot.raw);
    });
  }
  async function importBackup(ctx, text) {
    const incoming = parseBackup(text, ctx);
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const active = rows.filter(row => !row.removedAt), added = [];
      for (const row of incoming) {
        if (active.some(old => old.name === row.name && Core().stable(old.snapshot) === Core().stable(row.snapshot))) continue;
        unique(active, row.name);
        active.push(row); added.push(row);
      }
      for (const row of added) store.add(row);
      return added.length;
    });
  }
  async function mergeCloud(owner, loadoutId, remote, merge) {
    const scope = owner + "|" + loadoutId;
    if (!remote.length) {
      return transaction(scope, "readonly", local => ({ scenes: merge(local, remote), changed: [] }));
    }
    return transaction(scope, "readwrite", (local, store) => {
      const previous = new Map(local.map(row => [row.id, row]));
      const scenes = merge(local, remote);
      const changed = new Set();
      for (const scene of scenes) {
        if (scene.parentId !== loadoutId) throw Error("子方案不属于当前配装。");
        const before = previous.get(scene.id);
        if (before && before.scope !== scope) throw Error("方案编号与本机父配装冲突。");
        if (before && before.revision === scene.revision && before.conflictOf === scene.conflictOf &&
            Core().stable(before.ancestors || []) === Core().stable(scene.ancestors || [])) continue;
        const row = { ...scene, owner, scope };
        if (before) store.put(row);
        else store.add(row); // Never replace an ID belonging to another character.
        changed.add(scope);
      }
      return { scenes, changed: [...changed] };
    });
  }
  app.Store = Object.freeze({ resolveConflict, mergeCloud, list: scope => transaction(scope, "readonly", rows => rows), create, mutate, importBackup,
    exportBackup: (ctx, rows) => JSON.stringify({ format: "mwi-layu-loadout-scenes", schemaVersion: 1, scope: ctx.scope,
      scenes: rows.filter(row => !row.removedAt).map(({ name, snapshot }) => ({ name, snapshot })) }, null, 2) });
})(globalThis);

// ---- action_memory.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const prefix = "mwi-layu:action-loadouts:v1:";
  const field = "selectedCharacterLoadoutId";
  const sessions = new Map();
  // Only keep keys for one character. Values are read at export time so a
  // queued storage event cannot publish an obsolete selection for a known key.
  let cloudIndex = null;
  root.addEventListener?.("storage", event => {
    if (event.key === null || event.key.startsWith(prefix)) cloudIndex = null;
  });
  const id = value => Number.isSafeInteger(value) && value >= 0;
  function scope(props, state) {
    const action = props?.actionDetail, character = props?.characterInfo?.characterID;
    if (!Number.isSafeInteger(character) || character <= 0 ||
        typeof action?.hrid !== "string" || !action.hrid.startsWith("/actions/") ||
        typeof action.type !== "string" || !action.type.startsWith("/action_types/") ||
        state?.actionDetail?.hrid !== action.hrid || !Array.isArray(state.loadoutOptions)) return null;
    return prefix + JSON.stringify([location.origin, character, action.type, action.hrid]);
  }
  function available(props, state, value) {
    if (!id(value) || !state.loadoutOptions.some(option => option.value === value && !option.disabled)) return false;
    if (value === 0) return true;
    const loadout = props.characterLoadoutDict?.[value];
    return loadout?.id === value && (loadout.actionTypeHrid === "" || loadout.actionTypeHrid === props.actionDetail.type);
  }
  function notice(session, text) {
    if (!session.panel.isConnected) return;
    if (!session.notice) {
      session.notice = document.createElement("small");
      session.notice.setAttribute("role", "status");
      session.notice.setAttribute("data-mwi-action-memory-status", "");
      session.panel.append(session.notice);
    }
    session.notice.textContent = text;
  }
  function clearNotice(session) { session.notice?.remove(); session.notice = null; }
  function read(key) {
    const text = localStorage.getItem(key);
    if (text === null) return null;
    const row = JSON.parse(text);
    if (row?.version !== 1 || !id(row.loadoutId)) throw Error("invalid record");
    return row;
  }
  function remember(session, key, value) {
    try {
      let previous;
      try { previous = read(key); } catch (_) { /* An explicit choice repairs a malformed local preference. */ }
      const updatedAt = Math.max(Date.now(), (previous?.updatedAt || 0) + 1);
      localStorage.setItem(key, JSON.stringify({ version: 1, loadoutId: value, updatedAt }));
      cloudIndex = null;
      const character = session.controller.props.characterInfo.characterID;
      app.Cloud?.changed(character, value);
      if (previous && previous.loadoutId !== value) app.Cloud?.changed(character, previous.loadoutId);
      clearNotice(session);
    } catch (_) { notice(session, "没能记住这次配装。当前选择仍可使用，请检查浏览器存储权限或空间后重新选择。"); }
  }
  function detach(session) {
    session.active = false;
    const controller = session.controller;
    if (controller.setState === session.wrapper) {
      if (session.descriptor) Object.defineProperty(controller, "setState", session.descriptor);
      else delete controller.setState;
    }
    clearNotice(session);
    sessions.delete(controller);
  }
  function attach(ctx) {
    const controller = ctx.controller;
    const session = { ...ctx, active: true, key: null, revision: 0,
      original: controller.setState, descriptor: Object.getOwnPropertyDescriptor(controller, "setState") };
    // The native selection handler writes exactly this one field. Full initial
    // states/default recomputations must never replace an explicit preference.
    session.wrapper = function (patch, callback) {
      const key = session.active && scope(this.props, this.state);
      const selection = this === controller && key && patch && typeof patch === "object" &&
        Object.keys(patch).length === 1 && Object.hasOwn(patch, field) && available(this.props, this.state, patch[field]);
      if (selection) { session.key = key; session.revision++; }
      const result = session.original.call(this, patch, callback);
      if (selection) remember(session, key, patch[field]);
      return result;
    };
    controller.setState = session.wrapper;
    sessions.set(controller, session);
    return session;
  }
  function restore(session) {
    const controller = session.controller, key = scope(controller.props, controller.state);
    if (!key || !controller.state.loadoutOptions.length) return;
    if (session.key === key) return;
    session.key = key;
    clearNotice(session);
    let row;
    try { row = read(key); }
    catch (_) { notice(session, "没能读取记住的配装，请手动选择；重新选择后会尝试保存。"); return; }
    if (!row) return;
    if (!available(controller.props, controller.state, row.loadoutId)) {
      notice(session, "上次选择的配装已不可用，请重新选择。"); return;
    }
    const revision = session.revision;
    // Use the original state setter, not a game action handler. Revalidate when
    // React processes the queued update so a later user selection always wins.
    session.original.call(controller, (state, props) => {
      if (!session.active || session.revision !== revision || scope(props, state) !== key ||
          !session.panel.isConnected || !session.panel.getClientRects().length ||
          !available(props, state, row.loadoutId) || state[field] === row.loadoutId) return null;
      return { [field]: row.loadoutId };
    });
  }
  function tick() {
    const contexts = app.Adapter.actionContexts(), active = new Set(contexts.map(ctx => ctx.controller));
    for (const session of sessions.values()) {
      const ctx = contexts.find(ctx => ctx.controller === session.controller);
      if (!active.has(session.controller) || ctx.panel !== session.panel) detach(session);
    }
    for (const ctx of contexts) {
      try {
        const session = sessions.get(ctx.controller) || attach(ctx);
        session.dropdown = ctx.dropdown;
        restore(session);
      }
      catch (_) { /* An incompatible/frozen native component must remain usable. */ }
    }
  }
  function reselect(event) {
    // MUI does not emit onChange when the already-selected option is chosen.
    // Bind its portal to this exact dropdown; never infer from translated text.
    if (!event.isTrusted) return;
    if (event.type === "keydown" && event.key !== "Enter" && event.key !== " ") return;
    const option = event.target.closest?.('[role="option"]');
    const menu = option?.closest('[role="listbox"]');
    const value = option?.getAttribute("data-value");
    if (!menu?.id || !/^\d+$/.test(value || "") || option.getAttribute("aria-disabled") === "true") return;
    tick();
    for (const session of sessions.values()) {
      const controls = [...session.dropdown.querySelectorAll('[aria-controls], [aria-owns]')];
      if (!controls.some(node => [node.getAttribute("aria-controls"), node.getAttribute("aria-owns")]
        .some(ids => ids?.split(/\s+/).includes(menu.id)))) continue;
      const { props, state } = session.controller, key = scope(props, state), selected = Number(value);
      if (key && selected === state[field] && available(props, state, selected)) {
        session.key = key; session.revision++;
        remember(session, key, selected);
      }
    }
  }
  let started = false;
  function start() {
    if (started) return;
    started = true;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => { queued = false; tick(); });
    };
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    // Capture before the first menu interaction, including portals and keyboard use.
    document.addEventListener("pointerdown", tick, true);
    document.addEventListener("keydown", tick, true);
    document.addEventListener("keydown", reselect, true);
    document.addEventListener("click", reselect, true);
    document.addEventListener("visibilitychange", tick);
    tick(); setInterval(tick, 650);
  }
  function keysByLoadout(character) {
    const now = Date.now();
    if (cloudIndex?.character === character && now < cloudIndex.expires) return cloudIndex.groups;
    const groups = new Map();
    const base = prefix + JSON.stringify([location.origin, character]).slice(0, -1) + ",";
    for (let i = 0, count = localStorage.length; i < count; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(base)) continue;
      let row;
      try { row = JSON.parse(localStorage.getItem(key)); } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
      if (row?.version !== 1 || !id(row.loadoutId)) continue;
      if (!groups.has(row.loadoutId)) groups.set(row.loadoutId, new Set());
      groups.get(row.loadoutId).add(key);
    }
    if (root.addEventListener) cloudIndex = { character, groups, expires: now + 30000 };
    return groups;
  }
  function mergeCloud(character, loadoutId, incoming) {
    for (const row of incoming) {
      const key = prefix + JSON.stringify([location.origin, character, row.type, row.action]);
      const before = read(key);
      const updatedAt = before?.updatedAt ?? 0;
      if (before && (updatedAt > row.updatedAt ||
          updatedAt === row.updatedAt && before.loadoutId >= row.loadoutId)) continue;
      localStorage.setItem(key, JSON.stringify({ version: 1, loadoutId: row.loadoutId, updatedAt: row.updatedAt }));
      if (cloudIndex?.character === character) {
        const groups = cloudIndex.groups;
        if (before) groups.get(before.loadoutId)?.delete(key);
        if (!groups.has(loadoutId)) groups.set(loadoutId, new Set());
        groups.get(loadoutId).add(key);
      }
      for (const session of sessions.values()) {
        if (session.key === key) { session.revision++; session.key = null; restore(session); }
      }
    }
    const keys = keysByLoadout(character).get(loadoutId);
    if (!keys) return [];
    const memories = [];
    for (const key of [...keys].sort()) {
      const row = read(key);
      if (row?.loadoutId !== loadoutId) continue;
      const [, , type, action] = JSON.parse(key.slice(prefix.length));
      memories.push({ type, action, loadoutId, updatedAt: row.updatedAt ?? 0 });
    }
    return memories;
  }
  app.ActionMemory = Object.freeze({ start, tick, mergeCloud });
})(globalThis);

// ---- cloud_sync.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  const format = "mwi-layu-loadouts-cloud";
  const uuid = value => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
  const time = value => Number.isSafeInteger(value) && value >= 0;
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function scene(row) {
    if (!row || !uuid(row.id) || !uuid(row.revision) || !time(row.createdAt) || !time(row.updatedAt) ||
        !(row.removedAt === null || time(row.removedAt)) || typeof row.name !== "string" ||
        !(row.ancestors === undefined || Array.isArray(row.ancestors) && row.ancestors.every(uuid))) throw Error("云端子方案格式无效。");
    const snapshot = app.Core.validateSnapshot(row.snapshot);
    if (snapshot.raw.id !== row.parentId) throw Error("云端子方案父配装不匹配。");
    return { id: row.id, parentId: row.parentId, name: app.Core.name(row.name), revision: row.revision,
      ...(uuid(row.conflictOf) && row.conflictOf !== row.id ? { conflictOf: row.conflictOf } : {}),
      createdAt: row.createdAt, updatedAt: row.updatedAt, removedAt: row.removedAt, snapshot,
      ancestors: [...new Set(row.ancestors || [])].sort() };
  }
  function memory(row) {
    if (!/^\/action_types\/[a-z0-9_]+$/.test(row?.type) || !/^\/actions\/(?:[a-z0-9_]+\/)*[a-z0-9_]+$/.test(row?.action) ||
        !time(row.loadoutId) || !time(row.updatedAt)) throw Error("行动配装记录无效。");
    return { type: row.type, action: row.action, loadoutId: row.loadoutId, updatedAt: row.updatedAt };
  }
  const boardName = (character, loadoutId) => character + "loadout" + loadoutId;
  const occupied = message => Object.assign(Error(message), { code: "BOARD_OCCUPIED" });
  function parse(character, loadoutId, text) {
    if (text === "") return { scenes: [], memories: [], native: null };
    let doc;
    try { if (text.length <= 5000000) doc = JSON.parse(text); } catch (_) { /* Show a recoverable board conflict. */ }
    if (doc?.format !== format || ![2, 3].includes(doc.version) || doc.character !== character || doc.loadoutId !== loadoutId ||
        !Array.isArray(doc.scenes) || !Array.isArray(doc.memories)) throw occupied("剪贴板已有其他内容或版本不兼容，已保留原文。");
    const scenes = doc.scenes.map(scene);
    if (new Set(scenes.map(row => row.id)).size !== scenes.length) throw Error("云端方案编号重复。");
    const memories = doc.memories.map(memory);
    if (scenes.some(row => row.parentId !== loadoutId) || memories.some(row => row.loadoutId !== loadoutId)) {
      throw occupied("剪贴板含其他配装的数据，已保留原文。");
    }
    let native = null;
    if (doc.native != null) {
      if (doc.version !== 3 || !time(doc.native.updatedAt)) throw occupied("云端原生配装格式无效，已保留原文。");
      const snapshot = app.Core.validateSnapshot(doc.native.snapshot);
      if (!loadoutId || snapshot.raw.id !== loadoutId) throw occupied("云端原生配装编号不匹配，已保留原文。");
      native = { snapshot, updatedAt: doc.native.updatedAt };
    }
    return { scenes, memories, native };
  }
  function mergeScenes(local, incoming) {
    const rows = new Map(local.map(row => [row.id, scene(row)]));
    const copies = [];
    for (const remote of incoming) {
      const old = rows.get(remote.id);
      if (!old) { rows.set(remote.id, remote); continue; }
      if (old.parentId !== remote.parentId) throw Error("云端方案编号与父配装冲突。");
      if (old.revision === remote.revision) {
        if (app.Core.stable({ ...old, ancestors: [], conflictOf: null }) !== app.Core.stable({ ...remote, ancestors: [], conflictOf: null })) throw Error("云端同一版本的内容不一致。");
        if (old.conflictOf && remote.conflictOf && old.conflictOf !== remote.conflictOf) throw Error("冲突副本的来源不一致。");
        rows.set(old.id, { ...remote, ...old, ancestors: [...new Set([...old.ancestors, ...remote.ancestors])].sort() });
        continue;
      }
      if (old.ancestors.includes(remote.revision)) continue;
      if (remote.ancestors.includes(old.revision)) { rows.set(old.id, remote); continue; }
      const localWins = old.updatedAt > remote.updatedAt || old.updatedAt === remote.updatedAt && old.revision > remote.revision;
      const [winner, other] = localWins ? [old, remote] : [remote, old];
      rows.set(winner.id, { ...winner, ancestors: [...new Set([...winner.ancestors, ...other.ancestors, other.revision])].sort() });
      if (other.removedAt == null || winner.removedAt == null) copies.push({ ...other, conflictOf: winner.id, id: other.revision, name: other.name.slice(0, 50) + "（冲突副本）" });
    }
    for (const copy of copies) if (!rows.has(copy.id)) rows.set(copy.id, copy);
    return [...rows.values()].sort((a, b) => order(a.id, b.id));
  }
  function conflictPairs(rows) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const pairs = [];
    // Older boards identified a copy by its revision-derived ID and suffix.
    const legacy = new Map(rows.filter(row => !row.conflictOf && row.removedAt == null &&
      row.name.endsWith("（冲突副本）")).map(row => [row.id, row]));
    for (const row of rows) {
      if (row.conflictOf) {
        const main = byId.get(row.conflictOf);
        if (main && main.parentId === row.parentId && main.ancestors?.includes(row.id)) pairs.push([main, row]);
      }
      if (!legacy.size) continue;
      for (const revision of row.ancestors || []) {
        const copy = legacy.get(revision);
        if (copy && copy !== row && copy.parentId === row.parentId) {
          pairs.push([row, copy]); legacy.delete(revision);
        }
      }
    }
    return pairs;
  }
  async function synchronize(character, loadoutId, io, current, refresh) {
    const check = () => { if (current() !== character) throw Error("角色已切换。"); };
    const name = boardName(character, loadoutId);
    const owner = location.origin + "|" + character;
    check();
    const before = await io(name);
    check();
    const remote = parse(character, loadoutId, before);
    const b = board(character, loadoutId);
    const localNative = loadoutId && app.Adapter?.nativeSnapshot ? app.Adapter.nativeSnapshot(character, loadoutId) : null;
    const localKey = localNative ? app.Core.stable(localNative) : null;
    const remoteKey = remote.native ? app.Core.stable(remote.native.snapshot) : null;
    // Do not let an unchanged/stale game tab replace another device's published configuration.
    // A fresh client with differing data requires an explicit choice in the cloud panel.
    const canPublish = localNative && (!remote.native || localKey === remoteKey || b.forceNative === localKey ||
      b.localBaseline != null && localKey !== b.localBaseline && remoteKey === b.remoteBaseline);
    const native = canPublish && localKey !== remoteKey ? { snapshot: localNative, updatedAt: Date.now() } : remote.native;
    const { scenes, changed } = loadoutId === 0 ? { scenes: [], changed: [] } : await app.Store.mergeCloud(owner, loadoutId, remote.scenes, mergeScenes);
    for (const scope of changed) refresh(scope);
    check();
    const memories = app.ActionMemory.mergeCloud(character, loadoutId, remote.memories).map(memory);
    const counts = { nativeAvailable: Boolean(native), nativeMismatch: Boolean(native && localNative && app.Core.stable(native.snapshot) !== localKey),
      sceneCount: scenes.filter(row => row.removedAt == null).length,
      memoryCount: memories.length, conflicts: conflictPairs(scenes).length };
    const complete = () => {
      b.localBaseline = localKey; b.remoteBaseline = native ? app.Core.stable(native.snapshot) : null;
      b.nativeSnapshot = native?.snapshot || null;
      if (b.forceNative === localKey) b.forceNative = null;
      return counts;
    };
    if (!before && !native && !scenes.length && !memories.length) return complete();
    const text = JSON.stringify({ format, version: native || JSON.parse(before || "null")?.version === 3 ? 3 : 2,
      character, loadoutId, scenes, memories, ...(native ? { native } : {}) });
    if (text.length > 5000000) throw Error("配装数据超出同步大小限制。");
    if (text === before) return complete();
    if (await io(name) !== before) throw Error("另一台设备刚刚更新，稍后会重新合并。");
    check();
    if (localNative && app.Core.stable(app.Adapter.nativeSnapshot(character, loadoutId)) !== localKey)
      throw Error("原生配装刚刚变化，稍后会重新读取并同步。");
    await io(name, text);
    if (await io(name) !== text) throw Error("写入后未能核对云端内容，稍后重试。");
    return complete();
  }

  const activeInterval = 30000, otherInterval = 300000;
  const boards = new Map(), urgent = new Set(), routine = new Set();
  let timer, running = null, active = null, refreshScope, onStatus;
  const watchers = new Map();
  function subscribe(character, id, listener) {
    const key = boardName(character, id);
    if (!watchers.has(key)) watchers.set(key, new Set());
    const group = watchers.get(key);
    group.add(listener);
    return () => { group.delete(listener); if (!group.size) watchers.delete(key); };
  }
  function emit(b) {
    onStatus?.(b.character, b.loadoutId, b.status);
    watchers.get(boardName(b.character, b.loadoutId))?.forEach(listener => listener());
  }
  const online = () => root.navigator?.onLine !== false;
  function board(character, loadoutId) {
    const name = boardName(character, loadoutId);
    if (!boards.has(name)) boards.set(name, { character, loadoutId, kind: "waiting", status: "等待同步", checked: null, sceneCount: null, memoryCount: null, conflicts: 0, last: null, retryAt: 0, failures: 0, dirty: false });
    return boards.get(name);
  }
  function report(b, text, kind) {
    if (b.status === text && b.kind === kind) return;
    b.status = text; b.kind = kind;
    emit(b);
  }
  function kick() {
    if (!timer && !running && online()) timer = setTimeout(drain, 250);
  }
  function enqueue(b, priority) {
    if (priority) { routine.delete(b); urgent.add(b); }
    else if (running !== b && !urgent.has(b)) routine.add(b);
    kick();
  }
  function changed(character, loadoutId) {
    if (!Number.isSafeInteger(character) || character <= 0 || !time(loadoutId)) return;
    const b = board(character, loadoutId);
    b.dirty = true;
    if (b.kind === "blocked" || b.kind === "setup") return;
    report(b, online() ? "已存本机，待上传" : "已存本机，等待联网", "pending");
    enqueue(b, true);
  }
  function request(character, loadoutId) {
    const b = board(character, loadoutId);
    if (running !== b && online()) enqueue(b, true);
  }
  function publishCurrent(character, loadoutId) {
    const b = board(character, loadoutId);
    b.forceNative = app.Core.stable(app.Adapter.nativeSnapshot(character, loadoutId));
    changed(character, loadoutId);
  }
  function setActive(character, loadoutId) {
    active = character == null ? null : board(character, loadoutId);
    if (active && active.kind !== "blocked" && active.kind !== "setup" && !active.retryAt && (active.last === null || Date.now() - active.last >= activeInterval)) {
      request(character, loadoutId);
    }
  }
  async function drain() {
    timer = null;
    while (online()) {
      const b = urgent.values().next().value || (!document.hidden && routine.values().next().value);
      if (!b) break;
      running = b;
      urgent.delete(b); routine.delete(b);
      const wasDirty = b.dirty;
      try {
        const current = () => app.Adapter.cloudContext(false)?.character;
        if (current() !== b.character) continue;
        b.last = Date.now();
        b.dirty = false;
        report(b, wasDirty ? "正在同步本机修改…" : "正在核对…", "busy");
        const io = root.__mwiLoadoutClipboardV2;
        if (typeof io !== "function" || app.Adapter.nativeSnapshot && io.protocolVersion !== 3)
          throw Object.assign(Error("云同步接口需要更新，请更新已安装的配装助手或开发加载器，再刷新游戏页面。"), { code: "BRIDGE_MISSING" });
        const counts = await synchronize(b.character, b.loadoutId, io, current, refreshScope);
        b.failures = 0; b.retryAt = 0;
        Object.assign(b, counts, { checked: Date.now() });
        if (!b.dirty) report(b, counts.nativeMismatch ? "原生配装与云端不同" : counts.nativeAvailable ? "配装已同步" :
          counts.sceneCount || counts.memoryCount ? "附加记录已同步 · 尚无配装快照" : "已核对 · 无附加记录", "ok");
      } catch (error) {
        b.retryAt = Date.now() + Math.min(otherInterval, activeInterval * 2 ** Math.min(b.failures++, 4));
        const setup = error.code === "BRIDGE_MISSING";
        const blocked = setup || error.code === "BOARD_OCCUPIED";
        const editedDuringSync = b.dirty;
        b.dirty ||= wasDirty;
        if (blocked) { urgent.delete(b); routine.delete(b); }
        if (blocked || !editedDuringSync) report(b, error.message, setup ? "setup" : blocked ? "blocked" : "error");
      } finally { running = null; }
    }
  }
  function start(refresh, statusChanged) {
    refreshScope = refresh; onStatus = statusChanged;
    let poll;
    function scan() {
      clearTimeout(poll);
      if (document.hidden || !online()) return;
      let delay = activeInterval;
      try {
        const ctx = app.Adapter.cloudContext();
        if (!ctx?.loadoutIds) delay = 3000;
        else {
          const now = Date.now();
          for (const id of [...ctx.loadoutIds, 0]) {
            const b = board(ctx.character, id);
            if (b.kind === "blocked" || b.kind === "setup") continue;
            if (id && ctx.loadouts?.[id]) {
              const key = app.Core.stable(ctx.loadouts[id]);
              const edited = b.observedNative != null && key !== b.observedNative;
              b.observedNative = key;
              if (edited) changed(ctx.character, id);
            }
            const due = b.retryAt || (b.last === null ? now : b.last + (active === b ? activeInterval : otherInterval));
            if (now >= due) enqueue(b, (active === b || b.dirty) && running !== b);
            else delay = Math.min(delay, Math.max(500, due - now));
          }
        }
      } catch (_) { delay = 3000; }
      finally { poll = setTimeout(scan, delay); }
    }
    function resume() {
      if (urgent.size || !document.hidden && routine.size) kick();
      scan();
    }
    document.addEventListener("visibilitychange", resume);
    const connectivityChanged = () => {
      for (const b of boards.values()) emit(b);
    };
    root.addEventListener("offline", connectivityChanged);
    root.addEventListener("online", () => {
      connectivityChanged();
      for (const b of boards.values()) if (b.retryAt && b.kind !== "blocked" && b.kind !== "setup") {
        b.retryAt = 0; b.last = null;
        if (b.dirty) enqueue(b, true);
      }
      resume();
    });
    scan();
  }
  function info(character, id) {
    const b = board(character, id);
    let label = b.status;
    if (b.kind === "setup") label = "需要更新加载器";
    else if (b.kind === "blocked") label = "同步已暂停";
    else if (!online()) label = b.dirty ? "已存本机，等待联网" : "离线";
    else if (b.kind === "error") label = b.dirty ? "已存本机，待重试" : "同步待重试";
    else if (b.conflicts && b.kind === "ok") label = "有版本待比较";
    return { label, kind: b.kind, detail: b.status, checked: b.checked, sceneCount: b.sceneCount,
      nativeAvailable: b.nativeAvailable, nativeMismatch: b.nativeMismatch, nativeSnapshot: b.nativeSnapshot,
      memoryCount: b.memoryCount, conflicts: b.conflicts, offline: !online(),
      warning: Boolean(b.nativeMismatch || b.conflicts || b.kind === "setup" || b.kind === "blocked" || b.kind === "error" || (!online() && b.dirty)) };
  }
  app.Cloud = Object.freeze({ subscribe, info, conflictPairs, changed, request, publishCurrent, setActive, start, synchronize, boardName, parse, mergeScenes,
    status: (character, loadoutId) => boards.get(boardName(character, loadoutId))?.status || "等待同步" });
})(globalThis);

// ---- cloud_ui.js ----
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

// ---- virtual_loadouts.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  let opening;
  const pending = new Map();
  function source(value) {
    let name = String(value || "").trim();
    if (name.startsWith("https://")) {
      const url = new URL(name);
      if (url.origin !== "https://clipboard.im" || url.search || url.hash || url.username || url.password)
        throw Error("请使用配装助手复制的 clipboard.im 分享地址。");
      name = url.pathname.replace(/^\//, "").replace(/\/$/, "");
    }
    const match = /^([1-9]\d*)loadout([1-9]\d*)$/.exec(name);
    if (!match || !match.slice(1).every(v => Number.isSafeInteger(Number(v))))
      throw Error("请粘贴配装助手的剪贴板地址或 ID，来源需要包含原生配装快照或子方案。");
    return { board: name, character: Number(match[1]), loadoutId: Number(match[2]) };
  }
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open("mwi-layu-virtual-loadouts", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("entries", { keyPath: "key" })
        .createIndex("owner", "owner", { unique: false });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
      request.onerror = request.onblocked = () => { opening = null; reject(Error("无法打开虚拟配装存储，请检查浏览器存储权限。")); };
    });
    return opening;
  }
  async function transaction(owner, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("entries", mode), store = tx.objectStore("entries");
      const request = store.index("owner").getAll(owner);
      let result, failure;
      request.onsuccess = () => {
        try { result = work(request.result, store); }
        catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || Error("虚拟配装保存失败，请检查存储空间后重试。"));
    });
  }
  const owner = character => location.origin + "|" + character;
  const list = character => transaction(owner(character), "readonly", rows => rows);
  async function read(board) {
    const parsed = source(board), io = root.__mwiLoadoutClipboardV2;
    if (typeof io !== "function") throw Error("请更新开发加载器后刷新游戏页面。");
    const text = await io(parsed.board); // Subscriptions always read, never write to the author's board.
    const doc = app.Cloud.parse(parsed.character, parsed.loadoutId, text);
    const scenes = doc.scenes.filter(row => row.removedAt == null);
    if (doc.native) scenes.unshift({ id: "native:" + parsed.loadoutId, name: "当前配装 · " + doc.native.snapshot.raw.name,
      snapshot: doc.native.snapshot, updatedAt: doc.native.updatedAt, native: true });
    return scenes;
  }
  async function subscribe(character, input) {
    const { board } = source(input), scope = owner(character);
    const scenes = await read(board);
    if (!scenes.length) throw Error("这个地址尚无可订阅的配装内容，请让分享者更新配装助手并完成同步。");
    return transaction(scope, "readwrite", (rows, store) => {
      const existing = rows.find(row => row.board === board);
      if (existing) return existing;
      const row = { key: scope + "|" + board, token: crypto.randomUUID(), owner: scope,
        board, scenes, checked: Date.now(), error: "", attempted: Date.now() };
      store.add(row); return row;
    });
  }
  function refresh(character, entry) {
    if (!entry.board) return Promise.resolve();
    if (pending.has(entry.key)) return pending.get(entry.key);
    const task = (async () => {
      let scenes, error = "";
      try { scenes = await read(entry.board); }
      catch (failure) { error = failure.message || "订阅更新失败"; }
      return transaction(owner(character), "readwrite", (rows, store) => {
        const current = rows.find(row => row.key === entry.key && row.token === entry.token);
        if (!current) return;
        store.put({ ...current, ...(scenes ? { scenes, checked: Date.now() } : {}),
          attempted: Date.now(), error });
      });
    })().finally(() => pending.delete(entry.key));
    pending.set(entry.key, task); return task;
  }
  function save(character, title, snapshot) {
    const validated = app.Core.validateSnapshot(snapshot), scope = owner(character);
    const row = { key: scope + "|" + crypto.randomUUID(), token: crypto.randomUUID(), owner: scope,
      board: null, scenes: [{ id: crypto.randomUUID(), name: app.Core.name(title), snapshot: validated }],
      checked: Date.now(), error: "" };
    return transaction(scope, "readwrite", (_, store) => { store.add(row); return row; });
  }
  function remove(character, entry) {
    return transaction(owner(character), "readwrite", (rows, store) => {
      const current = rows.find(row => row.key === entry.key && row.token === entry.token);
      if (current) store.delete(current.key);
    });
  }
  async function adopt(character, scene, raw, title) {
    if (app.Adapter.cloudContext(false)?.character !== character) throw Error("角色已变化，请重新打开配装总览。");
    const snapshot = app.Core.validateSnapshot(scene.snapshot);
    if ((snapshot.raw.actionTypeHrid || "") !== (raw.actionTypeHrid || ""))
      throw Error("请选择相同类型的原生配装。");
    const scopeOwner = owner(character);
    const ctx = { owner: scopeOwner, scope: scopeOwner + "|" + raw.id,
      raw: { ...snapshot.raw, id: raw.id } };
    const row = await app.Store.create(ctx, title);
    app.Cloud.changed(character, raw.id);
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("mwi-layu-loadout-scenes");
      channel.postMessage({ scope: ctx.scope }); channel.close();
    }
    return row;
  }
  app.Virtual = Object.freeze({ source, list, subscribe, refresh, save, remove, adopt });
})(globalThis);

// ---- virtual_preview.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPreview = function (React, NativePanel) {
    const h = React.createElement, noop = () => {};
    const children = node => React.Children.toArray(node?.props?.children);
    const part = (node, name) => node?.props?.className?.includes(`LoadoutsPanel_${name}__`);
    const child = (node, name) => children(node).find(node => part(node, name));
    function preview(snapshot, nativeProps) {
      const raw = { ...app.Core.validateSnapshot(snapshot).raw, missingItemLocationHridSet: {},
        missingFoodIndexSet: {}, missingDrinkIndexSet: {} };
      // Build a separate display model. Never replace the game's loadout dictionary or handlers.
      const props = { ...nativeProps };
      for (const key of Object.keys(props)) if (typeof props[key] === "function" && key !== "t") props[key] = noop;
      props.characterLoadoutDict = { [raw.id]: raw };
      props.characterAbilityMap = new Map(Object.values(raw.abilityMap || {}).filter(Boolean)
        .map(abilityHrid => [abilityHrid, { abilityHrid, level: 1, experience: 0 }]));
      props.characterSkillMap = new Map(nativeProps.characterSkillMap || []);
      // A viewer's locked slots must not hide skills in the shared configuration.
      props.characterSkillMap.set("/skills/intelligence", { level: 999, experience: 0 });
      props.characterItemMap = new Map();
      props.loadLoadoutHandler = noop;
      const renderer = new NativePanel(props);
      renderer.state = { ...renderer.state, selectedCharacterLoadoutId: raw.id };
      // This renderer is never mounted: it only produces the native slot tree.
      const shell = renderer.renderLoadout(), details = child(shell, "details"), setup = child(details, "setup");
      if (!setup) throw Error("原生配装布局暂不可用");
      function decorate(node) {
        if (!node || typeof node !== "object" || !node.props) return node;
        const p = node.props;
        let label;
        if ("currentItem" in p) {
          label = p.name + (p.currentItem ? "：" + app.Adapter.describe({ props: nativeProps },
            { kind: "equipment" }, { itemHrid: p.currentItem.itemHrid,
              ...(raw.useExactEnhancement ? { enhancementLevel: p.currentItem.enhancementLevel } : {}) }) : "：空槽");
        } else if ("slotNumber" in p && "currentAbility" in p) {
          label = "技能 " + p.slotNumber + "：" + app.Adapter.describe({ props: nativeProps }, { kind: "ability" }, p.currentAbility?.abilityHrid || null);
        } else if ("consumableSlotTypeHrid" in p) {
          label = (p.consumableSlotTypeHrid.endsWith("food") ? "食物 " : "饮料 ") + (p.slotIndex + 1) + "：" +
            app.Adapter.describe({ props: nativeProps }, { kind: "food" }, p.itemHrid || null);
        }
        if (label) {
          const safe = {};
          for (const [key, value] of Object.entries(p)) if (typeof value === "function") safe[key] = key === "getItemSelectionsFunc" ? () => [] : noop;
          safe.shouldCheckLevelRequirements = false;
          safe.shouldHideSelectedItemCount = true;
          return h("div", { key: node.key, className: "mwi-virtual-slot" },
            h("div", { title: label, "aria-label": label, role: "img", tabIndex: 0 },
              h("div", { inert: "", "aria-hidden": true }, React.cloneElement(node, safe))));
        }
        return React.cloneElement(node, null, ...children(node).filter(node => !part(node, "buttonsContainer")).map(decorate));
      }
      // Preserve the native CSS ancestry: its grid rules are scoped through these wrappers.
      return React.cloneElement(shell, null, React.cloneElement(details, null, decorate(setup)));
    }
    return class NativePreview extends React.Component {
      state = { failed: false };
      static getDerivedStateFromError() { return { failed: true }; }
      componentDidUpdate(previous) {
        if (this.state.failed && previous.snapshot !== this.props.snapshot) this.setState({ failed: false });
      }
      render() {
        if (this.state.failed) return h("p", null, "图标预览暂不可用，请刷新游戏后重试。");
        let slots;
        try { slots = preview(this.props.snapshot, this.props.nativeProps); }
        catch (_) { return h("p", null, "图标预览暂不可用，请刷新游戏后重试。"); }
        return h("div", { className: "mwi-virtual-native" }, slots);
      }
    };
  };
})(globalThis);

// ---- virtual_ui.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  app.makeVirtualPanel = function (React, NativePreview) {
    const h = React.createElement;
    class Entry extends React.Component {
      state = { selected: "", target: "", title: "", notice: "", busy: false, removing: false, expanded: true, detailsOpen: false };
      async run(work) {
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "" });
        try { await work(); }
        catch (error) { if (this.alive) this.setState({ notice: error.message }); }
        finally { if (this.alive) this.setState({ busy: false }); }
      }
      componentDidMount() { this.alive = true; }
      componentWillUnmount() { this.alive = false; }
      render() {
        const { entry, owner, nativeProps, nativeIcons, reload } = this.props;
        const { scenes, board } = entry;
        const scene = scenes.find(row => row.id === this.state.selected) || scenes[0];
        const choices = Object.values(nativeProps.characterLoadoutDict || {}).filter(raw =>
          scene && (raw.actionTypeHrid || "") === (scene.snapshot.raw.actionTypeHrid || ""));
        const raw = choices.find(row => String(row.id) === this.state.target);
        const btn = (label, click) => h("button", { type: "button", className: "mwi-overview-button",
          disabled: this.state.busy, onClick: click }, label);
        const details = scene && h("div", { className: "mwi-virtual-transfer" },
          h("label", null, "保存到自己的配装",
            h("select", { value: this.state.target, onChange: e => this.setState({ target: e.target.value }) },
              h("option", { value: "" }, "选择同类型的原生配装"), choices.map(row => h("option", { key: row.id, value: row.id }, row.name)))),
          h("label", null, "子方案名称", h("input", { maxLength: 60, value: this.state.title,
            placeholder: scene.name, onChange: e => this.setState({ title: e.target.value }) })),
          btn("保存为我的子方案", () => this.run(async () => {
            if (!raw) throw Error("请选择用于保存的原生配装。");
            await app.Virtual.adopt(owner, scene, raw, this.state.title.trim() || scene.name.slice(0, 60));
            if (this.alive) this.setState({ notice: "已保存为子方案，可到对应配装的详情中查看切换指引。" });
          })),
          board && btn("另存为本地虚拟配装", () => this.run(async () => {
            await app.Virtual.save(owner, scene.name.slice(0, 60), scene.snapshot); await reload();
            if (this.alive) this.setState({ notice: "已保存独立副本。" });
          })));
        const title = scene ? (scene.native ? scene.snapshot.raw.name : scene.name) : "虚拟配装";
        const status = entry.error ? "更新失败 · 保留上次内容" : board ? "订阅配装 · 已缓存" : "本地虚拟配装";
        return h("article", { className: "mwi-virtual-card mwi-overview-card" },
          h("div", { className: "mwi-overview-card-head" },
            h("h3", null, nativeIcons?.[scene?.snapshot.raw.actionTypeHrid || ""], title),
            h("button", { type: "button", className: "mwi-overview-button", "aria-expanded": this.state.expanded,
              onClick: () => this.setState({ expanded: !this.state.expanded }) }, this.state.expanded ? "收起" : "展开"),
            h("button", { type: "button", className: "mwi-overview-button", "aria-expanded": this.state.detailsOpen,
              onClick: () => this.setState({ expanded: true, detailsOpen: !this.state.detailsOpen }) }, "详情"),
            h("span", { className: "mwi-overview-cloud" + (entry.error ? " mwi-cloud-warning" : "") }, status)),
          this.state.expanded && h("div", { className: "mwi-virtual-body" },
            scenes.length > 1 && h("label", null, "配装内容",
              h("select", { value: scene.id, onChange: e => this.setState({ selected: e.target.value, target: "", title: "" }) },
                scenes.map(row => h("option", { key: row.id, value: row.id }, row.name)))),
            scene ? h(Snapshot, { snapshot: scene.snapshot, nativeProps }) : h("p", null, "来源已无可订阅的配装内容。"),
            this.state.detailsOpen && h("div", { className: "mwi-virtual-management" },
              board && h("a", { href: "https://clipboard.im/" + board, target: "_blank", rel: "noopener noreferrer" }, "查看来源"),
              h("p", null, "上次读取 " + new Date(entry.checked).toLocaleString()),
              entry.error && h("p", { className: "mwi-cloud-warning" }, entry.error),
              details,
              h("div", { className: "mwi-virtual-actions" },
                board && btn("检查更新", () => this.run(async () => { await app.Virtual.refresh(owner, entry); await reload(); })),
                btn(board ? "取消订阅" : "移除虚拟配装", () => this.setState({ removing: true }))),
              this.state.removing && h("div", null,
                h("p", null, board ? "取消这项订阅并移除本机缓存？" : "移除这份本地虚拟配装？"),
                btn("确认移除", () => this.run(async () => { await app.Virtual.remove(owner, entry); await reload(); })),
                btn("保留", () => this.setState({ removing: false }))),
              h("p", { role: "status" }, this.state.notice))));
      }
    }
    class Snapshot extends React.Component {
      render() {
        const { snapshot, nativeProps } = this.props, raw = snapshot.raw;
        return h("div", null,
          h("div", { className: "mwi-virtual-options", "aria-label": "配装选项（只读）" },
            [["默认", raw.isDefault], ["缺失不提醒", raw.suppressValidation], ["最高强化", !raw.useExactEnhancement]].map(([label, checked]) =>
              h("label", { key: label }, h("input", { type: "checkbox", checked: Boolean(checked), disabled: true }), label))),
          NativePreview ? h(NativePreview, { snapshot, nativeProps }) : h("p", null, "图标预览暂不可用，请刷新游戏后重试。"));
      }
    }
    return class VirtualPanel extends React.Component {
      state = { entries: [], input: "", notice: "", busy: false, loading: true };
      componentDidMount() {
        this.alive = true;
        this.check();
        this.timer = setInterval(() => this.check(), 30000);
      }
      componentWillUnmount() { this.alive = false; clearInterval(this.timer); }
      fail(error) { if (this.alive) this.setState({ notice: error.message, loading: false }); }
      reload = async () => {
        const entries = await app.Virtual.list(this.props.owner);
        if (this.alive) {
          const signature = JSON.stringify(entries);
          if (signature !== this.signature) {
            this.signature = signature;
            this.setState({ entries, loading: false });
          }
        }
      };
      async check() {
        if (this.checking) return;
        this.checking = true;
        try {
          const entries = await app.Virtual.list(this.props.owner);
          for (const entry of entries) {
            if (!this.alive || document.hidden || root.navigator.onLine === false) break;
            if (entry.board && Date.now() - (entry.attempted || 0) >= 300000)
              await app.Virtual.refresh(this.props.owner, entry);
          }
          await this.reload();
        } catch (error) { this.fail(error); }
        finally { this.checking = false; }
      }
      subscribe = async event => {
        event.preventDefault();
        if (this.state.busy) return;
        this.setState({ busy: true, notice: "" });
        try {
          await app.Virtual.subscribe(this.props.owner, this.state.input);
          await this.reload();
          if (this.alive) this.setState({ input: "", notice: "已订阅，打开配装总览时每 5 分钟检查更新。" });
        } catch (error) { this.fail(error); }
        finally { if (this.alive) this.setState({ busy: false }); }
      };
      render() {
        return h("section", { className: "mwi-virtual-panel", "aria-label": "虚拟配装" },
          h("h2", null, "虚拟配装"),
          h("p", null, "订阅他人的当前原生配装及子方案，或在配装详情中保存一份本地虚拟配装。"),
          h("p", null, "订阅列表与虚拟配装保存在本机；订阅只读，保存为自己的子方案后可参与云同步。"),
          h("form", { onSubmit: this.subscribe },
            h("input", { "aria-label": "配装分享地址", placeholder: "粘贴配装助手的剪贴板地址", value: this.state.input,
              onChange: e => this.setState({ input: e.target.value }), required: true }),
            h("button", { type: "submit", className: "mwi-overview-button", disabled: this.state.busy }, this.state.busy ? "读取中…" : "订阅配装")),
          h("p", { role: "status" }, this.state.notice),
          this.state.loading ? h("p", null, "读取中…") :
            !this.state.entries.length && h("p", null, "暂无虚拟配装"),
          h("div", { className: "mwi-virtual-grid" }, this.state.entries.map(entry =>
            h(Entry, { key: entry.token, entry, owner: this.props.owner, nativeProps: this.props.nativeProps, nativeIcons: this.props.nativeIcons, reload: this.reload }))));
      }
    };
  };
})(globalThis);

// ---- overview.js ----
(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes;
  const css = "[data-mwi-loadout-overview] {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18.5rem), 1fr));\n  align-items: start;\n  gap: .75rem;\n  text-align: start;\n}\n.mwi-overview-card {\n  container-type: inline-size;\n  min-width: 0;\n  border: 1px solid var(--color-divider, #4c5677);\n  border-radius: var(--radius-sm, 8px);\n  background: var(--color-midnight-700, #202333);\n  color: var(--color-text-dark-mode, #f1f2fa);\n}\n.mwi-overview-card-head {\n  display: flex;\n  align-items: center;\n  flex-wrap: wrap;\n  gap: .25rem .5rem;\n  min-height: 2.75rem;\n  padding: .35rem .625rem;\n  background: var(--color-midnight-500, #2b3045);\n  border-block-end: 1px solid var(--color-divider, #4c5677);\n  border-start-start-radius: inherit;\n  border-start-end-radius: inherit;\n}\n.mwi-overview-card-head h3 {\n  display: flex;\n  align-items: center;\n  flex: 1 1 6rem;\n  min-width: 0;\n  margin: 0;\n  font-size: 1rem;\n  font-weight: 600;\n  overflow-wrap: anywhere;\n}\n.mwi-overview-options {\n  display: flex;\n  align-items: center;\n  gap: .25rem .625rem;\n  padding: .125rem .625rem 0;\n  white-space: nowrap;\n}\n.mwi-overview-options [class*=\"MuiFormControlLabel-root\"] { margin: 0; min-height: 2rem; }\n.mwi-overview-options [class*=\"MuiTypography-root\"] { font-size: .8rem; }\n.mwi-overview-button {\n  color: var(--color-text-dark-mode, #f1f2fa);\n  background: var(--color-midnight-500, #2b3045);\n  border: 1px solid var(--color-space-300, #7d87b0);\n  border-radius: var(--radius-sm, 5px);\n  font: inherit;\n  font-size: .82rem;\n  padding: .3rem .55rem;\n  min-height: 2rem;\n  cursor: pointer;\n}\n.mwi-overview-button:hover { background: var(--color-midnight-300, #394464); }\n.mwi-overview-button:focus-visible { outline: 2px solid #9ecfff; outline-offset: 2px; }\n.mwi-overview-toolbar { display: flex; flex-wrap: wrap; gap: .375rem; }\n.mwi-overview-notice { padding: .5rem .625rem; margin: 0; }\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_selectedLoadout__\"] { padding: 0; align-items: stretch; }\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_details__\"] { min-width: 0; width: 100%; margin: 0; }\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_details__\"] [class*=\"LoadoutsPanel_setup__\"] {\n  --item-size-normal: min(3.75rem, max(1px, calc((100cqi - 2.25rem) / 5)));\n  width: 100%;\n  box-sizing: border-box;\n  padding: .625rem;\n  gap: .625rem;\n  background: transparent;\n}\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_playerModel__\"],\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_abilities__\"],\n[data-mwi-loadout-overview] .mwi-overview-card [class*=\"LoadoutsPanel_consumables__\"] { gap: .25rem; }\n.mwi-overview-tools { grid-area: 5 / 1 / span 1 / -1; margin-block-start: .25rem; }\n.mwi-overview-has-requirement { position: relative; }\n.mwi-overview-requirement {\n  position: absolute;\n  inset: .125rem .1875rem auto auto;\n  z-index: 1;\n  color: #ffc268;\n  font-size: .8125rem;\n  font-variant-numeric: tabular-nums;\n  font-weight: 600;\n  line-height: 1;\n  text-shadow: 0 0 2px #171822, 0 1px 2px #171822;\n  pointer-events: none;\n}\n@media (pointer: coarse) {\n  .mwi-overview-button { min-height: 2.75rem; }\n  .mwi-overview-options [class*=\"MuiFormControlLabel-root\"] { min-height: 2.75rem; }\n}\n\n.mwi-overview-cloud { color: #c3c6db; font-size: .78rem; line-height: 1.4; }\n.mwi-overview-card-head .mwi-overview-cloud { flex: 0 0 100%; }\n.mwi-overview-cloud.mwi-cloud-warning { color: #ffd27a; }\n\n.mwi-virtual-panel { margin-block: 1.25rem; text-align: start; color: #eeeef5; }\n.mwi-virtual-panel h2 { font-size: 1.1rem; }\n.mwi-virtual-panel p { font-size: .85rem; color: #c3c6db; margin: .4rem 0; }\n.mwi-virtual-panel form, .mwi-virtual-actions { display: flex; flex-wrap: wrap; gap: .5rem; margin: .6rem 0; }\n.mwi-virtual-panel input, .mwi-virtual-panel select { background: #171822; color: #eeeef5; border: 1px solid #7d87b0; border-radius: 5px; padding: .5rem; min-width: 0; max-width: 100%; font: inherit; }\n.mwi-virtual-panel form input { flex: 1 1 16rem; }\n.mwi-virtual-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr)); gap: .75rem; align-items: start; }\n.mwi-virtual-card { padding: 0; overflow-wrap: anywhere; min-width: 0; }\n.mwi-virtual-card h3 { font-size: 1rem; margin: 0; }\n.mwi-virtual-body { padding: .5rem .625rem; }\n.mwi-virtual-management { border-top: 1px solid #4c5677; margin-top: .5rem; padding-top: .5rem; }\n.mwi-virtual-card .mwi-virtual-options { display: flex; flex-wrap: wrap; gap: .4rem; font-size: .85rem; }\n.mwi-virtual-card .mwi-virtual-options label { display: flex; align-items: center; gap: .2rem; margin: 0; }\n.mwi-virtual-card .mwi-virtual-options input { margin: 0; accent-color: #bdc7ed; }\n.mwi-virtual-card a { color: #bbcaff; }\n.mwi-virtual-card label { display: grid; gap: .3rem; margin: .6rem 0; }\n.mwi-virtual-card summary { cursor: pointer; padding: .5rem 0; }\n.mwi-virtual-panel .mwi-cloud-warning { color: #ffd27a; }\n.mwi-virtual-panel :focus-visible { outline: 2px solid #bbcaff; outline-offset: 2px; }\n\n.mwi-virtual-native { container-type: inline-size; margin-block: .5rem; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_selectedLoadout__\"] { padding: 0; align-items: stretch; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_details__\"] { width: 100%; min-width: 0; margin: 0; }\n.mwi-virtual-native [class*=\"LoadoutsPanel_setup__\"] {\n  --item-size-normal: min(3.75rem, max(1px, calc((100cqi - 1.5rem) / 5)));\n  width: 100%; min-width: 0; box-sizing: border-box; padding: .5rem;\n  gap: .75rem; background: transparent;\n}\n.mwi-virtual-native [class*=\"LoadoutsPanel_playerModel__\"],\n.mwi-virtual-native [class*=\"LoadoutsPanel_abilities__\"],\n.mwi-virtual-native [class*=\"LoadoutsPanel_consumables__\"] { gap: .25rem; }\n.mwi-virtual-slot { min-width: 0; width: fit-content; max-width: 100%; border-radius: 5px; }\n.mwi-virtual-slot [inert] { pointer-events: none; }\n.mwi-virtual-native [class*=\"Item_count__\"],\n.mwi-virtual-native [class*=\"Ability_level__\"],\n.mwi-virtual-native [class*=\"CombatTriggersSetting_combatTriggersSetting__\"] { display: none; }\n";
  const marker = "data-mwi-loadout-overview";
  const collapseKey = owner => `mwi-layu:loadout-overview:collapsed:v1:${owner}`;
  const installed = new WeakMap();
  const slotTypes = new Set(["equipment", "ability", "food", "drink", "ability_trigger", "food_trigger", "drink_trigger"]);
  const optionLabels = [
    ["isDefaultChanged", "默认"],
    ["suppressValidationChanged", "缺失不提醒"],
    ["useExactEnhancementChanged", "最高强化"]
  ];
  let runtime, showGrid = true;

  function notice(panel, message) {
    let node = panel.querySelector("[data-mwi-overview-status]");
    if (!message) { node?.remove(); return; }
    if (!node) {
      node = document.createElement("p");
      node.setAttribute("data-mwi-overview-status", "");
      node.setAttribute("role", "status");
      node.className = "mwi-overview-notice";
      panel.prepend(node);
    }
    if (node.textContent !== message) node.textContent = message;
  }

  // The game bundles React and its cache codec in webpack 4. Reuse the loaded
  // exports so its components keep their context and renderer in the same tree.
  function gameRuntime() {
    if (runtime) return runtime;
    // With GM grants, the installed script's global can differ from the page
    // global. The development loader already runs in the page world.
    const page = typeof unsafeWindow === "undefined" ? root : unsafeWindow;
    const chunks = page.webpackJsonprpg_web || root.webpackJsonprpg_web;
    if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) return null;
    const id = "mwi-layu-loadout-overview-runtime";
    const probe = [[], { [id]: (module, exports, require) => {
      try {
        const loaded = Object.values(require.c).map(entry => entry.exports);
        const React = loaded.find(value => typeof value?.createElement === "function" &&
          typeof value.cloneElement === "function" && typeof value.Component === "function" && value.Children);
        const codec = loaded.find(value => typeof value?.decompressFromUTF16 === "function" &&
          typeof value.compressToUTF16 === "function");
        if (React) runtime = { React, codec };
      } finally {
        delete require.c[id];
        delete require.m[id];
      }
    } }, [[id]]];
    try { chunks.push(probe); } finally {
      const index = chunks.indexOf(probe);
      if (index !== -1) chunks.splice(index, 1);
    }
    return runtime;
  }

  function readRequirements(codec) {
    const requirements = new Map();
    try {
      const raw = root.localStorage.getItem("initClientData");
      if (!raw) return requirements;
      const text = raw.trimStart().startsWith("{") ? raw : codec?.decompressFromUTF16(raw);
      if (!text) return requirements;
      for (const [hrid, detail] of Object.entries(JSON.parse(text).itemDetailMap || {})) {
        const levels = detail?.equipmentDetail?.levelRequirements;
        if (!Array.isArray(levels)) continue;
        const maximum = levels.reduce((max, entry) => Number.isSafeInteger(entry?.level) ? Math.max(max, entry.level) : max, 0);
        if (maximum) requirements.set(hrid, maximum);
      }
    } catch (_) { /* A missing cache must not stop the game's native editor. */ }
    return requirements;
  }

  function readCollapsed(owner) {
    try {
      const ids = JSON.parse(root.localStorage.getItem(collapseKey(owner)));
      return new Set(Array.isArray(ids) ? ids.filter(id => Number.isSafeInteger(id) && id > 0) : []);
    } catch (_) { return null; }
  }

  const hasClass = (node, name) => typeof node?.props?.className === "string" && node.props.className.includes(`LoadoutsPanel_${name}__`);
  const children = (React, node) => React.Children.toArray(node?.props?.children);
  const child = (React, node, name) => children(React, node).find(entry => hasClass(entry, name));

  function cardOptions(React, details, controller) {
    const controls = children(React, details).filter(entry => hasClass(entry, "metadata"))
      .flatMap(entry => children(React, entry));
    const options = optionLabels.map(([handler, label]) => {
      const control = controls.find(entry => typeof entry?.props?.onChange === "function" && entry.props.onChange === controller[handler]);
      return control && React.createElement("div", { key: handler, title: control.props.label }, React.cloneElement(control, { label }));
    });
    return options.every(Boolean) ? React.createElement("div", {
      className: "mwi-overview-options", role: "group", "aria-label": "配装选项"
    }, options) : null;
  }

  function cardSetup(React, shell, requirements) {
    const details = child(React, shell, "details"), setup = child(React, details, "setup");
    const equipment = child(React, setup, "equipment"), model = child(React, equipment, "playerModel");
    if (!model || !child(React, setup, "buttonsContainer")) throw Error("配装编辑区结构已变化");
    const slots = children(React, model);
    const updated = slots.map(slot => {
      const level = requirements.get(slot.props?.children?.props?.currentItem?.itemHrid);
      const position = slot.props?.style?.gridRowStart;
      const isTool = position === 7 || position === 8;
      if (!level && !isTool) return slot;
      const badge = level && React.createElement("span", {
        className: "mwi-overview-requirement", title: `装备需求等级 ${level}`, "aria-label": `装备需求等级 ${level}`
      }, level);
      return React.cloneElement(slot, {
        className: [slot.props.className, level && "mwi-overview-has-requirement"].filter(Boolean).join(" ") || undefined,
        style: isTool ? { ...slot.props.style, gridRowStart: position - 1 } : slot.props.style
      }, slot.props.children, badge || null);
    });
    if (slots.some(slot => slot.props?.style?.gridRowStart === 7)) {
      updated.push(React.createElement("div", { className: "mwi-overview-tools", key: "tools" }, "生活工具"));
    }
    const modelWithBadges = React.cloneElement(model, null, updated);
    const equipmentWithBadges = React.cloneElement(equipment, null, children(React, equipment)
      .map(entry => hasClass(entry, "playerModel") ? modelWithBadges : entry));
    const sections = children(React, setup).filter(entry => !hasClass(entry, "buttonsContainer"))
      .map(entry => hasClass(entry, "equipment") ? equipmentWithBadges : entry);
    return React.cloneElement(setup, null, sections);
  }

  // Only the small status labels subscribe. An update never rerenders native slots.
  function makeCloudLabel(React) {
    return class CloudLabel extends React.Component {
      componentDidMount() { this.listen(); }
      componentDidUpdate(prev) {
        if (prev.owner !== this.props.owner || prev.ids !== this.props.ids) this.listen();
      }
      componentWillUnmount() { this.unsubscribe?.(); }
      listen() {
        this.unsubscribe?.();
        const { owner, ids } = this.props;
        const warnings = new Set();
        const refresh = id => {
          const info = app.Cloud.info(owner, id);
          if (!this.props.tally) { this.paint("云同步 · " + info.label, info.warning); return; }
          if (info.warning) warnings.add(id);
          else warnings.delete(id);
          this.paint(warnings.size ? warnings.size + " 套配装待处理" : "", warnings.size > 0);
        };
        const stops = ids.split(",").map(Number).map(id => {
          refresh(id);
          return app.Cloud.subscribe(owner, id, () => refresh(id));
        });
        this.unsubscribe = () => stops.forEach(stop => stop());
      }
      paint(text, warning) {
        if (this.label.textContent !== text) this.label.textContent = text;
        this.label.hidden = !text;
        this.label.classList.toggle("mwi-cloud-warning", warning);
      }
      render() {
        return React.createElement("span", { className: "mwi-overview-cloud", ref: node => { this.label = node; } });
      }
    };
  }

  function makeCard(React, NativePanel, CloudLabel) {
    const h = React.createElement;
    class NativeSlots extends NativePanel {
      constructor(props) {
        super(props);
        // This instance owns exactly one ID. Native slot handlers close over
        // this state, independently of the page selection and the other cards.
        this.state = { ...this.state, selectedCharacterLoadoutId: props.overviewId };
      }
      componentDidUpdate() { /* The list owns this card's lifetime. */ }
      render() {
        const shell = this.renderLoadout();
        if (!hasClass(shell, "selectedLoadout")) throw Error("配装详情结构已变化");
        const { overviewContentId, overviewRequirements } = this.props;
        const details = child(React, shell, "details");
        const options = this.props.overviewCanUpdateOptions && cardOptions(React, details, this);
        const setup = cardSetup(React, shell, overviewRequirements);
        return React.cloneElement(shell, null, React.cloneElement(details, { id: overviewContentId }, options, setup));
      }
    }
    // Keep a malformed native card from taking down the surrounding game UI.
    return class OverviewCard extends React.Component {
      constructor(props) {
        super(props);
        this.state = { failed: false, notice: "" };
      }
      static getDerivedStateFromError() { return { failed: true }; }
      rememberCard = element => { this.element = element; };
      update(send, change) {
        if (!this.element) return;
        const notice = send(this.element, change) ? "" : "配装已变化，请重新打开配装页。";
        if (notice !== this.state.notice) this.setState({ notice });
      }
      updateSlot = change => this.update(this.props.sendSlot, change);
      updateOptions = change => this.update(this.props.sendOptions, change);
      render() {
        const { id, name, icon, openDetails, toggleCard, nativeProps, overviewCollapsed } = this.props;
        const { overviewContentId } = nativeProps;
        const toggleLabel = overviewCollapsed ? "展开" : "收起";
        const content = overviewCollapsed ? h("div", { id: overviewContentId, hidden: true })
          : this.state.failed ? h("p", { id: overviewContentId, className: "mwi-overview-notice", role: "status" }, "这套配装暂时无法展开，可以打开详情编辑。")
            : h(NativeSlots, { ...nativeProps, updateLoadoutSlotHandler: this.updateSlot, updateLoadoutHandler: this.updateOptions });
        return h("article", { ref: this.rememberCard, className: "mwi-overview-card", "data-mwi-overview-id": id, "aria-label": name },
          h("header", { className: "mwi-overview-card-head" },
            h("h3", null, icon, name),
            h("button", { type: "button", className: "mwi-overview-button",
              "aria-label": `${toggleLabel}${name}`, "aria-expanded": !overviewCollapsed, "aria-controls": overviewContentId, onClick: toggleCard }, toggleLabel),
            h("button", { type: "button", className: "mwi-overview-button", "aria-label": `${name}的详情和子方案`, onClick: openDetails }, "详情"),
            app.Cloud && h(CloudLabel, { owner: nativeProps.characterInfo.characterID, ids: String(id) })),
          content, !overviewCollapsed && this.state.notice && h("p", { className: "mwi-overview-notice", role: "status" }, this.state.notice));
      }
    };
  }

  function install(controller, panel, { React, codec }) {
    if (!(controller instanceof React.Component) || typeof controller.renderLoadout !== "function" ||
        typeof controller.renderMainView !== "function" || typeof controller.forceUpdate !== "function")
      throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    const render = controller.render;
    const CloudLabel = makeCloudLabel(React);
    const VirtualPanel = app.makeVirtualPanel?.(React, app.makeVirtualPreview?.(React, controller.constructor));
    const Card = makeCard(React, controller.constructor, CloudLabel);
    const mounted = { panel, requirements: readRequirements(codec) };
    let collapsed = new Set(), collapsedOwner, collapseSaveFailed = false;
    const h = React.createElement;

    function changeCollapsed(owner, change) {
      const { characterInfo, characterLoadoutDict } = controller.props;
      if (!showGrid || owner !== collapsedOwner || owner !== characterInfo?.characterID) return;
      // Use the latest saved choices so edits in another tab are preserved.
      if (!collapseSaveFailed) collapsed = readCollapsed(owner) ?? collapsed;
      change(collapsed);
      for (const id of collapsed) if (!Object.hasOwn(characterLoadoutDict, id)) collapsed.delete(id);
      try {
        root.localStorage.setItem(collapseKey(owner), JSON.stringify([...collapsed]));
        collapseSaveFailed = false;
      } catch (_) { collapseSaveFailed = true; }
      controller.forceUpdate();
    }

    function currentCard(owner, id, element, change) {
      const { props, state } = controller;
      return showGrid && state.selectedCharacterLoadoutId === null && owner === props.characterInfo?.characterID &&
        props.characterLoadoutDict?.[id]?.id === id && change?.id === id &&
        element.isConnected && mounted.panel.contains(element) && element.getClientRects().length;
    }

    function sendSlot(owner, id, element, change) {
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || !slotTypes.has(change.slotType) ||
          typeof controller.props.updateLoadoutSlotHandler !== "function") return false;
      controller.props.updateLoadoutSlotHandler(change);
      return true;
    }

    function sendOptions(owner, id, element, change) {
      const { props } = controller;
      if (collapsed.has(id) || !currentCard(owner, id, element, change) || typeof props.updateLoadoutHandler !== "function" ||
          change.name !== props.characterLoadoutDict[id].name ||
          ![change.isDefault, change.suppressValidation, change.useExactEnhancement].every(value => typeof value === "boolean")) return false;
      props.updateLoadoutHandler(change);
      return true;
    }

    function renderOverview(native) {
      const main = child(React, native, "mainView"), list = child(React, main, "characterLoadouts");
      if (!list) throw Error("配装总览未能识别当前列表，请更新脚本后刷新游戏。");
      const { props } = controller, owner = props.characterInfo?.characterID;
      if (!Number.isSafeInteger(owner) || owner <= 0 || typeof props.updateLoadoutSlotHandler !== "function")
        throw Error("配装总览所需数据尚未就绪，请重新打开配装页。");
      const rows = children(React, list);
      if (!rows.length && !VirtualPanel) return native;
      if (collapsedOwner !== owner) {
        collapsed = readCollapsed(owner) ?? new Set();
        collapsedOwner = owner;
        collapseSaveFailed = false;
      }
      const cards = rows.map(row => {
        const id = row.props?.["data-loadout-id"], loadout = props.characterLoadoutDict[id];
        if (!Number.isSafeInteger(id) || loadout?.id !== id || typeof loadout.name !== "string" ||
            typeof row.props.onClick !== "function") throw Error("配装列表结构已变化");
        const overviewCollapsed = collapsed.has(id);
        return h(Card, {
          key: `${owner}:${id}`, id, name: loadout.name, overviewCollapsed,
          icon: children(React, row)[1], openDetails: row.props.onClick,
          toggleCard: () => changeCollapsed(owner, ids => {
            if (overviewCollapsed) ids.delete(id);
            else ids.add(id);
          }),
          nativeProps: { ...props, overviewId: id, overviewRequirements: mounted.requirements,
            overviewContentId: `mwi-loadout-content-${owner}-${id}`,
            overviewCanUpdateOptions: typeof props.updateLoadoutHandler === "function" },
          sendSlot: (element, change) => sendSlot(owner, id, element, change),
          sendOptions: (element, change) => sendOptions(owner, id, element, change)
        });
      });
      const toggle = h("button", {
        key: "mwi-overview-toggle", type: "button", className: "mwi-overview-button",
        onClick: () => { showGrid = !showGrid; controller.forceUpdate(); }
      }, showGrid ? "原生列表" : "配装总览");
      const allCollapsed = cards.every(card => collapsed.has(card.props.id));
      const toggleAll = showGrid && h("button", {
        key: "mwi-overview-toggle-all", type: "button", className: "mwi-overview-button",
        onClick: () => changeCollapsed(owner, ids => {
          for (const card of cards) {
            if (allCollapsed) ids.delete(card.props.id);
            else ids.add(card.props.id);
          }
        })
      }, allCollapsed ? "全部展开" : "全部收起");
      const toolbar = h("div", { key: "mwi-overview-toolbar", className: "mwi-overview-toolbar" }, toggle, toggleAll,
        showGrid && app.Cloud && h(CloudLabel, { key: "sync", owner, ids: cards.map(card => card.props.id).join(","), tally: true }),
        showGrid && collapseSaveFailed && h("span", { role: "status" }, "折叠状态未能保存，刷新后可能恢复之前的状态。"));
      const mainChildren = children(React, main).flatMap(entry => !hasClass(entry, "characterLoadouts") ? [entry] : [toolbar,
        showGrid ? h("div", { key: "mwi-overview-grid", [marker]: "" }, cards) : entry]);
      if (VirtualPanel) mainChildren.push(h(VirtualPanel, { key: "virtual-" + owner, owner, nativeProps: props,
        nativeIcons: Object.fromEntries(rows.map(row => [props.characterLoadoutDict[row.props["data-loadout-id"]].actionTypeHrid || "", children(React, row)[1]])) }));
      const updatedMain = React.cloneElement(main, null, mainChildren);
      return React.cloneElement(native, null, children(React, native)
        .map(entry => hasClass(entry, "mainView") ? updatedMain : entry));
    }

    if (typeof render !== "function") throw Error("配装总览暂不兼容当前游戏组件，请更新脚本后刷新游戏。");
    controller.render = function () {
      const native = render.call(this);
      if (this.state.selectedCharacterLoadoutId !== null) return native;
      try {
        const result = renderOverview(native);
        mounted.failure = "";
        return result;
      } catch (_) {
        mounted.failure = "配装总览未能显示，已保留原生列表。请更新脚本后刷新游戏。";
        return native;
      }
    };
    installed.set(controller, mounted);
    controller.forceUpdate();
  }

  function sync() {
    let panel;
    try {
      panel = app.Adapter.visibleLoadoutPanel();
      if (!panel) return;
      if (!panel.querySelector('[class*="LoadoutsPanel_mainView__"]')) { notice(panel, ""); return; }
      const controller = app.Adapter.loadoutController(panel);
      if (!controller) { notice(panel, "配装总览尚未读取到游戏组件，请重新打开配装页。"); return; }
      const prior = installed.get(controller);
      if (prior) { prior.panel = panel; notice(panel, prior.failure || ""); }
      else if (controller.state.selectedCharacterLoadoutId === null) {
        const game = gameRuntime();
        if (game) { install(controller, panel, game); notice(panel, installed.get(controller)?.failure || ""); }
        else notice(panel, "配装总览未能访问游戏组件，请确认脚本管理器允许脚本在游戏页面运行，再刷新游戏。");
      }
    } catch (_) {
      if (panel) notice(panel, "配装总览初始化失败，已保留原生列表。请更新脚本后刷新游戏。");
    }
  }

  function start() {
    const style = document.createElement("style");
    style.id = "mwi-loadout-overview-style";
    style.textContent = css;
    document.head.append(style);
  }

  app.Overview = Object.freeze({ start, sync });
})(globalThis);

// ---- app.js ----
(function (root) {
  "use strict";
  if (!/^(www\.)?milkywayidle(cn)?\.com$/.test(location.hostname) || !/^\/game\/?$/.test(location.pathname)) return;
  const app = root.MWILoadoutScenes;
  if (app.started) return;
  app.started = true;
  const { Core, Adapter, Store } = app;
  const css = ":host { display: block; width: 21.25rem; max-width: 100%; min-width: 0; text-align: left; color: #eeeef5; font: inherit; --scene-surface: #202130; --scene-line: #555a7e; --scene-primary: #465bb3; --scene-muted: #c3c6db; --scene-warn: #ffd27a; }\n* { box-sizing: border-box; }\nsection { overflow-wrap: anywhere; margin: 12px 0 16px; padding: 12px 0; border-top: 1px solid var(--scene-line); border-bottom: 1px solid var(--scene-line); }\nh2 { margin: 0; font-size: 1em; font-weight: 600; }\np { margin: 0; line-height: 1.5; }\n.header, .actions, .notice, .change-title { display: flex; align-items: center; gap: 8px; }\n.header { justify-content: space-between; margin-bottom: 10px; }\n.header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }\n.header-actions .update-button { width: calc(4em + 22px); flex: 0 0 auto; white-space: nowrap; text-align: center; }\n.choices { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }\nbutton, input { font: inherit; border-radius: 5px; min-height: 36px; }\nbutton { color: inherit; background: var(--scene-surface); border: 1px solid var(--scene-line); padding: 6px 10px; cursor: pointer; text-align: start; max-width: 100%; min-width: 0; overflow-wrap: anywhere; }\nbutton:hover { background: #30344e; }\nbutton[aria-pressed=\"true\"], button.primary { background: var(--scene-primary); border-color: #8a9ce8; }\nbutton:disabled { opacity: .55; cursor: not-allowed; }\nbutton:focus-visible, input:focus-visible, summary:focus-visible, li:focus { outline: 2px solid #c0ccff; outline-offset: 3px; }\n.icon-button { width: 36px; flex: 0 0 36px; padding: 8px; display: inline-grid; place-items: center; }\nsvg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }\ninput { color: inherit; background: #171822; border: 1px solid var(--scene-line); padding: 8px; min-width: 0; width: 100%; caret-color: #c0ccff; }\ninput::placeholder { color: var(--scene-muted); }\n.editor { display: grid; grid-template-columns: minmax(0,1fr); gap: 8px; margin: 12px 0; }\n.editor label { font-size: .9em; }\n.actions { justify-content: flex-end; }\n.menu { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px; margin: 10px 0; padding: 5px; background: var(--scene-surface); border: 1px solid var(--scene-line); border-radius: 5px; }\n.menu button { background: transparent; border-color: transparent; }\n.menu button:hover { background: #30344e; }\n.notice { margin-top: 10px; flex-wrap: wrap; font-size: .85em; color: var(--scene-muted); }\n#status { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }\n#status.error, .pending { color: var(--scene-warn); }\n.notice button { min-height: 30px; padding: 3px 8px; }\n.empty, .muted { color: var(--scene-muted); font-size: .85em; }\n.empty { flex: 1; }\n#scene-differences { margin-top: 10px; }\nsummary { padding: 7px 0; cursor: pointer; min-height: 36px; font-size: .9em; }\n#summary { font-weight: 500; }\nol { list-style: none; padding: 0; margin: 6px 0 0; }\nli { padding: 10px 0; border-bottom: 1px solid #3d405c; overflow-wrap: anywhere; }\nli:last-child { border-bottom: 0; padding-bottom: 0; }\n.change-title { flex-wrap: wrap; margin-bottom: 5px; font-size: .9em; }\n.change-title strong { flex: 1; font-weight: 500; }\n.change-title button { min-height: 30px; border: 0; background: transparent; padding: 3px 0 3px 8px; color: var(--scene-muted); }\n.values { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 8px; line-height: 1.5; font-size: .9em; }\n.values .current { color: var(--scene-muted); }\n.values .goal { color: var(--scene-warn); }\npre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .85em; padding: 10px; background: #171822; border-radius: 5px; }\n:host([data-mwi-scene-marker]) { width: 100%; max-width: 100%; margin-top: 5px; color: var(--scene-warn); font: 11px/1.4 -apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif; }\n.target-markers { display: grid; grid-template-columns: minmax(0,1fr); gap: 3px; overflow-wrap: anywhere; }\n.target-value { display: block; }\n.target-condition { color: var(--scene-warn); border: 0; border-radius: 2px; padding: 3px 0; min-height: 26px; width: 100%; font: inherit; text-align: start; background: transparent; text-decoration: underline; text-underline-offset: 3px; }\n[hidden] { display: none !important; }\n::selection { background: #465bb3; color: #fff; }\n* { scrollbar-width: thin; scrollbar-color: var(--scene-line) #171822; }\n@media (max-width: 520px) { .choices button { flex-grow: 1; } .choices .icon-button { flex-grow: 0; } }\n@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }\n\n.choices button { -webkit-touch-callout: none; user-select: none; }\n\n.cloud-panel { border-top: 1px solid var(--scene-line); margin-top: 10px; }\n.cloud-panel > summary { padding: 8px 0; }\n.cloud-panel a { color: #bbcaff; overflow-wrap: anywhere; }\n.cloud-panel a:focus-visible { outline: 2px solid #c0ccff; outline-offset: 2px; }\n.cloud-warning, .cloud-note { color: var(--scene-warn); }\n.cloud-facts { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 5px 12px; margin: 8px 0; }\n.cloud-facts dt, .cloud-privacy { color: var(--scene-muted); }\n.cloud-facts dd { margin: 0; }\n.cloud-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }\n.cloud-feedback:empty { display: none; }\n.cloud-privacy, .cloud-facts { font-size: .88em; }\n.cloud-compare { padding: 8px; margin-top: 8px; background: var(--scene-surface); border: 1px solid var(--scene-line); border-radius: 5px; }\n.cloud-diff { list-style: none; margin: 0; padding: 0; }\n.cloud-diff li div { color: var(--scene-muted); }\n.cloud-confirm { border-inline-start: 2px solid var(--scene-warn); padding-inline-start: 8px; }\n";
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
    app.Cloud.setActive(null);
    loading++; clearHighlights(); mounted?.host.remove(); mounted = null; context = null; rows = []; selectedId = null;
    last = ""; undo = null; confirmation = null;
  }
  function currentContext() {
    const fresh = Adapter.current();
    if (!fresh || fresh.scope !== context?.scope || fresh.details !== context.details) throw Error("当前角色或父配装已变化，请在对应配装下重试。");
    return fresh;
  }
  function notify(ctx) {
    channel?.postMessage({ scope: ctx.scope });
    app.Cloud.changed(ctx.props.characterInfo.characterID, ctx.raw.id);
  }
  async function reload() {
    const token = ++loading, scope = context?.scope;
    if (!scope) return;
    try {
      const result = await Store.list(scope);
      if (token !== loading || context?.scope !== scope) return;
      rows = result;
      mounted.cloud.update(rows, context);
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
      notify(ctx);
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
    (action === "snapshot" ? mounted.update : action === "rename" ? mounted.rename : mounted.commit).focus();
  }
  async function commitAction() {
    const pending = confirmation;
    if (!pending) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const row = await Store.mutate(ctx, pending.row, pending.action, mounted.rename.value);
      notify(ctx);
      if (mounted !== ui) return;
      if (pending.action === "remove") { undo = row; if (selectedId === row.id) selectedId = null; }
      confirmation = null; await reload();
      if (mounted !== ui) return;
      message(pending.action === "snapshot" ? "" : pending.action === "remove" ? `已移除“${row.name}”` : `已改名“${row.name}”`);
    });
    if (success) (pending.action === "snapshot" ? mounted.update : mounted.add).focus();
  }
  async function restore() {
    const row = undo;
    if (!row) return;
    const success = await run(async () => {
      const ctx = currentContext(), ui = mounted;
      const restored = await Store.mutate(ctx, row, "restore"); notify(ctx);
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
    const updating = confirmation?.action === "snapshot";
    confirmation = null; mounted.form.hidden = true; render();
    (updating ? mounted.update : mounted.add).focus();
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
    const update = button("更新", () => confirmation?.action === "snapshot" ? commitAction() : requestAction("snapshot"), { class: "update-button" });
    const cancelUpdate = button("取消", closeEditor, { hidden: "" });
    const headerActions = el("div", null, { class: "header-actions" });
    headerActions.append(cancelUpdate, update); header.append(heading, headerActions);
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
      const count = await Store.importBackup(ctx, text); notify(ctx);
      if (mounted !== ui) return;
      file.value = ""; setMenu(false); await reload(); message(`已导入 ${count} 项`);
    }));
    const virtualButton = button("保存为虚拟配装", () => run(async () => {
      const fresh = currentContext();
      await app.Virtual.save(fresh.props.characterInfo.characterID, fresh.raw.name, Core.snapshot(fresh.raw));
      if (mounted?.host === host) { setMenu(false); message("已保存到配装总览的虚拟配装。"); }
    }));
    menu.append(renameButton, remove, stop, virtualButton, exportButton, importButton, file);
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
    const cloud = app.CloudUI.mount(ctx, el, button, (main, copy, choice) => run(async () => {
      const fresh = currentContext(), ui = mounted;
      if (fresh.scope !== ctx.scope) throw Error("请在原配装下比较版本。");
      await Store.resolveConflict(fresh, main, copy, choice);
      notify(fresh);
      if (mounted !== ui) return;
      await reload();
      if (mounted === ui) message("版本选择已存本机。");
    }));
    app.Cloud.setActive(ctx.props.characterInfo.characterID, ctx.raw.id);
    section.append(cloud.node, button("保存为虚拟配装", () => virtualButton.click()));
    if (root.__layuUsage_mwi_loadout) {
      const settings = el("details", null);
      settings.append(el("summary", "统计"), el("slot", null, { name: "usage-settings" }));
      // Keep the shared client's settings host in light DOM so its observer can find it.
      host.append(el("div", null, { slot: "usage-settings", "data-layu-usage-settings": "mwi_loadout", lang: "zh-CN" }));
      section.append(settings);
    }
    shadow.append(section); ctx.details.insertBefore(host, ctx.setup);
    shadow.addEventListener("keydown", event => {
      if (event.key === "Escape" && !busy) { setMenu(false); closeEditor(); }
    });
    shadow.addEventListener("focusout", event => {
      if (!host.matches(":focus-within") && !shadow.contains(event.relatedTarget)) setMenu(false);
    });
    mounted = { cloud, host, shadow, choices, add, menu, form, name, save, cancelNew, update, cancelUpdate, renameButton, remove, stop, undoButton,
      confirm, confirmText, rename, commit, cancel, notice, status, retry, differences, summary, list, exportButton, importButton };
    context = ctx; rows = []; selectedId = null; undo = null; confirmation = null;
    cloud.update(rows);
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
      const label = active.some(other => other.id !== entry.id && other.name === entry.name)
        ? entry.name + " · " + entry.id.slice(0, 6) : entry.name;
      if (choice.textContent !== label) choice.textContent = label;
      choice.setAttribute("aria-pressed", String(entry.id === selectedId));
      choice.disabled = busy;
      if (ui.choices.children[index] !== choice) ui.choices.insertBefore(choice, ui.choices.children[index] || ui.add);
    });
    if (!active.length) ui.choices.insertBefore(el("p", "暂无方案", { class: "empty" }), ui.add);
    ui.save.disabled = ui.add.disabled = busy || Boolean(failure);
    ui.cancelNew.disabled = busy;
    const updating = confirmation?.action === "snapshot";
    ui.update.textContent = updating ? "更新方案" : "更新";
    ui.update.classList.toggle("primary", updating);
    ui.update.title = updating ? `更新“${confirmation.row.name}”？` : "";
    ui.cancelUpdate.hidden = !updating; ui.cancelUpdate.disabled = busy;
    ui.update.disabled = busy || !row || Boolean(failure);
    const menuRow = active.find(entry => entry.id === menuId);
    for (const node of [ui.renameButton, ui.remove]) node.disabled = busy || !menuRow || Boolean(failure);
    ui.stop.disabled = busy || !row || row.id !== menuId;
    if (!ui.menu.hidden && menuId && !menuRow) setMenu(false);
    ui.exportButton.disabled = busy || !active.length || Boolean(failure); ui.importButton.disabled = busy || Boolean(failure);
    ui.undoButton.hidden = !undo; ui.undoButton.disabled = busy || Boolean(failure);
    ui.notice.hidden = !undo && !ui.status.textContent;
    ui.retry.disabled = busy;
    ui.confirm.hidden = !confirmation || updating;
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
    app.Overview.sync();
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
        mounted.cloud.update(rows, ctx);
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
    app.Cloud.start(scope => {
      channel?.postMessage({ scope });
      if (context?.scope === scope) reload();
    }, (character, id) => {
      if (mounted && context?.props.characterInfo.characterID === character && context.raw.id === id) {
        mounted.cloud.update(rows, context);
      }
    });
    app.ActionMemory.start();
    app.Overview.start();
    const style = el("style", '[data-mwi-scene-change] { outline: 2px solid #ffd27a !important; outline-offset: 3px !important; } [data-mwi-scene-target] { outline: 3px solid #70b7ff !important; outline-offset: -3px !important; box-shadow: inset 0 0 0 5px #171822 !important; }');
    style.id = "mwi-loadout-scenes-highlight-style"; document.head.append(style);
    const panelSelector = '[class*="LoadoutsPanel_loadoutsPanel__"]';
    const ownedSelector = '.mwi-overview-cloud, [data-mwi-overview-status], #mwi-loadout-scenes-host, #mwi-loadout-scenes-unavailable, [data-mwi-scene-marker]';
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
