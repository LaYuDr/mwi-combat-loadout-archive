// ==UserScript==
// @name         MWI 配装助手
// @namespace    https://mwi-combatsi-mulator.pages.dev/loadout-archive
// @version      0.2.6
// @author       柆雨
// @homepageURL  https://github.com/LaYuDr/mwi-combat-loadout-archive
// @supportURL   https://github.com/LaYuDr/mwi-combat-loadout-archive/issues
// @updateURL    https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.meta.js
// @downloadURL  https://update.greasyfork.org/scripts/602254/mwi_combat_loadout_archive.user.js
// @description  保存游戏原生配装的场景子方案，对照装备、技能和消耗品及触发条件，提示玩家手动切换。
// @match        https://www.milkywayidle.com/game*
// @match        https://milkywayidle.com/game*
// @match        https://www.milkywayidlecn.com/game*
// @match        https://milkywayidlecn.com/game*
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
  try { boot({"pluginId":"mwi_loadout","name":"配装助手","version":"0.2.6","endpoint":"https://ukpyedhl.cn-hk1.rainapp.top","development":false,"defaultEnabled":true,"reportOptOut":true}, {getValue: typeof GM_getValue === "function" ? GM_getValue : null,
setValue: typeof GM_setValue === "function" ? GM_setValue : null,
listen: typeof GM_addValueChangeListener === "function" ? GM_addValueChangeListener : null,
unlisten: typeof GM_removeValueChangeListener === "function" ? GM_removeValueChangeListener : null,
request: typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : null}); } catch (_) { /* Telemetry is optional. */ }
})();

// LAYU_USAGE_END mwi_loadout
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
  function current() {
    const panels = [...document.querySelectorAll(selector("loadoutsPanel"))].filter(visible);
    if (panels.length !== 1) return null;
    const panel = panels[0], details = panel.querySelector(selector("details")), setup = panel.querySelector(selector("setup"));
    if (!visible(details) || !visible(setup)) return null;
    let fiber = hostFiber(panel), controller = null;
    if (!fiber) throw Error("无法读取游戏配装数据；请重新打开配装详情，若仍失败请反馈页面版本。");
    const seen = new Set();
    for (let i = 0; fiber && i < 80 && !seen.has(fiber); i++, fiber = fiber.return) {
      seen.add(fiber);
      const instance = fiber.stateNode;
      if (instance?.state?.selectedCharacterLoadoutId && instance?.props?.characterLoadoutDict) {
        if (controller && controller !== instance) throw Error("检测到多个配装上下文，已停止读取。");
        controller = instance;
      }
    }
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
  app.Adapter = Object.freeze({ current, describe, target, pickerTargets, actionContexts });
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
  async function mutate(ctx, expected, action, value) {
    return transaction(ctx.scope, "readwrite", (rows, store) => {
      const before = rows.find(row => row.id === expected.id);
      if (!before || before.revision !== expected.revision) throw Error("这个子方案已在其他标签页更新，请重新读取后再操作。");
      const row = { ...before, updatedAt: Date.now(), revision: crypto.randomUUID() };
      if (action === "rename") { row.name = Core().name(value); unique(rows, row.name, row.id); }
      else if (action === "snapshot") row.snapshot = Core().snapshot(ctx.raw);
      else if (action === "remove") row.removedAt = Date.now();
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
  app.Store = Object.freeze({ list: scope => transaction(scope, "readonly", rows => rows), create, mutate, importBackup,
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
      localStorage.setItem(key, JSON.stringify({ version: 1, loadoutId: value }));
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
  app.ActionMemory = Object.freeze({ start, tick });
})(globalThis);

// ---- app.js ----
(function (root) {
  "use strict";
  if (!/^(www\.)?milkywayidle(cn)?\.com$/.test(location.hostname) || !/^\/game\/?$/.test(location.pathname)) return;
  const app = root.MWILoadoutScenes;
  if (app.started) return;
  app.started = true;
  const { Core, Adapter, Store } = app;
  const css = ":host { display: block; width: 21.25rem; max-width: 100%; min-width: 0; text-align: left; color: #eeeef5; font: inherit; --scene-surface: #202130; --scene-line: #555a7e; --scene-primary: #465bb3; --scene-muted: #c3c6db; --scene-warn: #ffd27a; }\n* { box-sizing: border-box; }\nsection { overflow-wrap: anywhere; margin: 12px 0 16px; padding: 12px 0; border-top: 1px solid var(--scene-line); border-bottom: 1px solid var(--scene-line); }\nh2 { margin: 0; font-size: 1em; font-weight: 600; }\np { margin: 0; line-height: 1.5; }\n.header, .actions, .notice, .change-title { display: flex; align-items: center; gap: 8px; }\n.header { justify-content: space-between; margin-bottom: 10px; }\n.header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }\n.header-actions .update-button { width: calc(4em + 22px); flex: 0 0 auto; white-space: nowrap; text-align: center; }\n.choices { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }\nbutton, input { font: inherit; border-radius: 5px; min-height: 36px; }\nbutton { color: inherit; background: var(--scene-surface); border: 1px solid var(--scene-line); padding: 6px 10px; cursor: pointer; text-align: start; max-width: 100%; min-width: 0; overflow-wrap: anywhere; }\nbutton:hover { background: #30344e; }\nbutton[aria-pressed=\"true\"], button.primary { background: var(--scene-primary); border-color: #8a9ce8; }\nbutton:disabled { opacity: .55; cursor: not-allowed; }\nbutton:focus-visible, input:focus-visible, summary:focus-visible, li:focus { outline: 2px solid #c0ccff; outline-offset: 3px; }\n.icon-button { width: 36px; flex: 0 0 36px; padding: 8px; display: inline-grid; place-items: center; }\nsvg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }\ninput { color: inherit; background: #171822; border: 1px solid var(--scene-line); padding: 8px; min-width: 0; width: 100%; caret-color: #c0ccff; }\ninput::placeholder { color: var(--scene-muted); }\n.editor { display: grid; grid-template-columns: minmax(0,1fr); gap: 8px; margin: 12px 0; }\n.editor label { font-size: .9em; }\n.actions { justify-content: flex-end; }\n.menu { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 4px; margin: 10px 0; padding: 5px; background: var(--scene-surface); border: 1px solid var(--scene-line); border-radius: 5px; }\n.menu button { background: transparent; border-color: transparent; }\n.menu button:hover { background: #30344e; }\n.notice { margin-top: 10px; flex-wrap: wrap; font-size: .85em; color: var(--scene-muted); }\n#status { flex: 1 1 140px; min-width: 0; overflow-wrap: anywhere; }\n#status.error, .pending { color: var(--scene-warn); }\n.notice button { min-height: 30px; padding: 3px 8px; }\n.empty, .muted { color: var(--scene-muted); font-size: .85em; }\n.empty { flex: 1; }\n#scene-differences { margin-top: 10px; }\nsummary { padding: 7px 0; cursor: pointer; min-height: 36px; font-size: .9em; }\n#summary { font-weight: 500; }\nol { list-style: none; padding: 0; margin: 6px 0 0; }\nli { padding: 10px 0; border-bottom: 1px solid #3d405c; overflow-wrap: anywhere; }\nli:last-child { border-bottom: 0; padding-bottom: 0; }\n.change-title { flex-wrap: wrap; margin-bottom: 5px; font-size: .9em; }\n.change-title strong { flex: 1; font-weight: 500; }\n.change-title button { min-height: 30px; border: 0; background: transparent; padding: 3px 0 3px 8px; color: var(--scene-muted); }\n.values { display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); gap: 8px; line-height: 1.5; font-size: .9em; }\n.values .current { color: var(--scene-muted); }\n.values .goal { color: var(--scene-warn); }\npre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: .85em; padding: 10px; background: #171822; border-radius: 5px; }\n:host([data-mwi-scene-marker]) { width: 100%; max-width: 100%; margin-top: 5px; color: var(--scene-warn); font: 11px/1.4 -apple-system, BlinkMacSystemFont, \"PingFang SC\", \"Microsoft YaHei\", sans-serif; }\n.target-markers { display: grid; grid-template-columns: minmax(0,1fr); gap: 3px; overflow-wrap: anywhere; }\n.target-value { display: block; }\n.target-condition { color: var(--scene-warn); border: 0; border-radius: 2px; padding: 3px 0; min-height: 26px; width: 100%; font: inherit; text-align: start; background: transparent; text-decoration: underline; text-underline-offset: 3px; }\n[hidden] { display: none !important; }\n::selection { background: #465bb3; color: #fff; }\n* { scrollbar-width: thin; scrollbar-color: var(--scene-line) #171822; }\n@media (max-width: 520px) { .choices button { flex-grow: 1; } .choices .icon-button { flex-grow: 0; } }\n@media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }\n\n.choices button { -webkit-touch-callout: none; user-select: none; }\n";
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
    loading++; clearHighlights(); mounted?.host.remove(); mounted = null; context = null; rows = []; selectedId = null;
    last = ""; undo = null; confirmation = null;
  }
  function currentContext() {
    const fresh = Adapter.current();
    if (!fresh || fresh.scope !== context?.scope || fresh.details !== context.details) throw Error("当前角色或父配装已变化，请在对应配装下重试。");
    return fresh;
  }
  function notify(scope) { channel?.postMessage({ scope }); }
  async function reload() {
    const token = ++loading, scope = context?.scope;
    if (!scope) return;
    try {
      const result = await Store.list(scope);
      if (token !== loading || context?.scope !== scope) return;
      rows = result;
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
      notify(ctx.scope);
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
      notify(ctx.scope);
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
      const restored = await Store.mutate(ctx, row, "restore"); notify(ctx.scope);
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
      const count = await Store.importBackup(ctx, text); notify(ctx.scope);
      if (mounted !== ui) return;
      file.value = ""; setMenu(false); await reload(); message(`已导入 ${count} 项`);
    }));
    menu.append(renameButton, remove, stop, exportButton, importButton, file);
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
    mounted = { host, shadow, choices, add, menu, form, name, save, cancelNew, update, cancelUpdate, renameButton, remove, stop, undoButton,
      confirm, confirmText, rename, commit, cancel, notice, status, retry, differences, summary, list, exportButton, importButton };
    context = ctx; rows = []; selectedId = null; undo = null; confirmation = null;
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
      if (choice.textContent !== entry.name) choice.textContent = entry.name;
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
    app.ActionMemory.start();
    const style = el("style", '[data-mwi-scene-change] { outline: 2px solid #ffd27a !important; outline-offset: 3px !important; } [data-mwi-scene-target] { outline: 3px solid #70b7ff !important; outline-offset: -3px !important; box-shadow: inset 0 0 0 5px #171822 !important; }');
    style.id = "mwi-loadout-scenes-highlight-style"; document.head.append(style);
    const panelSelector = '[class*="LoadoutsPanel_loadoutsPanel__"]';
    const ownedSelector = '#mwi-loadout-scenes-host, #mwi-loadout-scenes-unavailable, [data-mwi-scene-marker]';
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
