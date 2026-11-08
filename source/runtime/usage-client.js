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
  /* USAGE_BOOTSTRAP */
})();
