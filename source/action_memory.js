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
