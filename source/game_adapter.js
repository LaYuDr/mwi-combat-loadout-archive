(function (root) {
  "use strict";
  const app = root.MWILoadoutScenes = root.MWILoadoutScenes || {};
  const selector = part => `[class*="LoadoutsPanel_${part}__"]`;
  // Popup libraries hide the background from assistive technology while it
  // remains on screen. That must not detach the active scene and its highlights.
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length && !element.closest('[hidden]'));
  function isCommitted(fiber) {
    if (!fiber) return false;
    let node = fiber;
    const seen = new Set();
    for (let depth = 0; node && depth < 240 && !seen.has(node); depth++) {
      seen.add(node);
      if (!node.return) return Boolean(node.stateNode && node.stateNode.current === node);
      node = node.return;
    }
    return false;
  }
  function hostFiber(element, portalRoot = null, committedOnly = false) {
    const key = Object.getOwnPropertyNames(element).find(key => /^__react(?:Fiber|InternalInstance)\$/.test(key));
    if (key && element[key]) {
      if (!committedOnly) return element[key];
      if (isCommitted(element[key])) return element[key];
      if (isCommitted(element[key].alternate)) return element[key].alternate;
    }
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
    const overview = app.Overview?.currentScene?.();
    if (overview) return overview;
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
      const row = position[0] - (ctx.overview && change.slot.endsWith("_tool") ? 1 : 0);
      return [...slots.children].find(el => el.style.gridRowStart === String(row) && el.style.gridColumnStart === String(position[1])) || null;
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
  let lastPickerMatches = [];
  function pickerPath(scopeFiber, list) {
    const pending = scopeFiber ? [{ fiber: scopeFiber, parent: null }] : [], seen = new Set();
    for (let count = 0; pending.length && count < 30000; count++) {
      const entry = pending.pop(), { fiber, parent } = entry;
      if (seen.has(fiber)) continue;
      seen.add(fiber);
      if (fiber.stateNode === list) {
        const path = [];
        for (let node = entry; node; node = node.parent) path.push(node.fiber);
        return path;
      }
      // Do not leave this setup via its siblings. Record the downward path:
      // reused React children can have return pointers into an old alternate.
      if (fiber !== scopeFiber && fiber.sibling) pending.push({ fiber: fiber.sibling, parent });
      if (fiber.child && fiber.stateNode?.namespaceURI !== "http://www.w3.org/2000/svg") {
        pending.push({ fiber: fiber.child, parent: entry });
      }
    }
    return null;
  }
  function matchesChoice(props, ability, change, itemTarget) {
    if (!props) return false;
    if (ability) {
      const id = props.abilityHrid || props.ability?.abilityHrid;
      return id === change.to;
    }
    const item = props.itemHrid ? props : (props.item?.itemHrid ? props.item : props.characterItem?.itemHrid ? props.characterItem : null);
    if (!item || item.itemHrid !== itemTarget.itemHrid) return false;
    return !Object.hasOwn(itemTarget, "enhancementLevel") || (item.enhancementLevel ?? 0) === itemTarget.enhancementLevel;
  }
  function pickerTargets(ctx, changes) {
    const result = [], matches = [];
    const desired = changes.filter(change => change.to && ["equipment", "ability", "food", "drink"].includes(change.kind));
    if (!desired.length) { lastPickerMatches = []; return result; }
    const lists = [...document.querySelectorAll('[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"]')].filter(visible);
    if (!lists.length) { lastPickerMatches = []; return result; }
    // Host expandos may retain an alternate from before a popup opened or its
    // filter changed. Traverse only the committed tree of this card's setup.
    let scope = ctx.setup || ctx.panel;
    if (!visible(scope)) { lastPickerMatches = []; return result; }
    let scopeFiber = hostFiber(scope, null, true);
    if (!scopeFiber && !ctx.overview && scope !== ctx.panel) {
      scope = ctx.panel;
      scopeFiber = hostFiber(scope, null, true);
    }
    const changeKeys = new Set(desired.map(change => app.Core.stable(change)));
    for (const list of lists) {
      const ability = list.className.includes("AbilitySlot_");
      const path = pickerPath(scopeFiber, list);
      if (!path) {
        // A commit can briefly expose the DOM before its readable tree. Keep
        // only previously verified, unchanged choices in this same open list.
        // Changed targets, replaced/reused content and closed lists never survive.
        for (const prior of lastPickerMatches) {
          if (prior.list === list && prior.scope === ctx.scope && prior.setup === scope && visible(scope) &&
              changeKeys.has(prior.changeKey) && prior.node.parentElement === list && visible(prior.node) &&
              prior.node.className === prior.className && prior.node.innerHTML === prior.html) {
            result.push(prior.node); matches.push(prior);
          }
        }
        continue;
      }
      const listFiber = path[0];
      const ancestors = new Set(); let ownerSlot = null;
      for (const owner of path) {
        ancestors.add(owner.stateNode);
        const props = owner.memoizedProps || owner.stateNode?.props;
        // Read the slot owner from the same committed portal branch. Searching
        // the background slot's DOM expando can still return an old alternate.
        if (!ownerSlot && props) {
          if (ability && Number.isInteger(props.slotNumber)) ownerSlot = { kind: "ability", slot: props.slotNumber };
          if (!ability && Number.isInteger(props.slotIndex) &&
              ["/consumable_slot_types/food", "/consumable_slot_types/drink"].includes(props.consumableSlotTypeHrid))
            ownerSlot = { kind: props.consumableSlotTypeHrid.split("/").pop(), slot: props.slotIndex };
        }
      }
      if (!ancestors.has(scope)) continue;
      const matching = changes.filter(change => change.to &&
        (ability ? change.kind === "ability" : ["equipment", "food", "drink"].includes(change.kind)) &&
        (ownerSlot ? change.kind === ownerSlot.kind && change.slot === ownerSlot.slot : ancestors.has(target(ctx, change))));
      if (matching.length !== 1) continue;
      const change = matching[0];
      const itemTarget = change.kind === "equipment" ? change.to : { itemHrid: change.to };
      // Index direct choice elements without descending into their subtrees so
      // large pickers (100+ items) never starve early options, and retain each
      // choice's exclusive component wrappers strictly below listFiber.
      const choiceSet = new Set(list.children), hosts = new Map(), wrapperUse = new Map();
      const queue = listFiber?.child ? [{ fiber: listFiber.child, wrappers: [] }] : [], visited = new Set();
      for (let count = 0; queue.length && count < 30000; count++) {
        const { fiber, wrappers } = queue.pop(); if (!fiber || visited.has(fiber)) continue; visited.add(fiber);
        if (fiber.sibling) queue.push({ fiber: fiber.sibling, wrappers });
        if (fiber.stateNode?.nodeType === 1) {
          if (choiceSet.has(fiber.stateNode)) {
            hosts.set(fiber.stateNode, { fiber, wrappers });
            for (const wrapper of wrappers) wrapperUse.set(wrapper, (wrapperUse.get(wrapper) || 0) + 1);
            continue;
          }
          if (fiber.stateNode.namespaceURI === "http://www.w3.org/2000/svg") continue;
        }
        if (fiber.child) {
          const nextWrappers = fiber.stateNode?.nodeType === 1 ? wrappers : [...wrappers, fiber];
          queue.push({ fiber: fiber.child, wrappers: nextWrappers });
        }
      }
      const multi = list.children.length > 1;
      for (const choice of list.children) {
        if (!visible(choice) || /insufficient|requirementsNotMet/.test(choice.className)) continue;
        const entry = hosts.get(choice);
        let match = false;
        if (entry) {
          for (const wrapper of entry.wrappers) {
            if (multi && (wrapperUse.get(wrapper) || 0) > 1) continue;
            if (matchesChoice(wrapper.memoizedProps || wrapper.stateNode?.props, ability, change, itemTarget)) {
              match = true; break;
            }
          }
          if (!match) {
            const first = entry.fiber, pending = [first], seen = new Set();
            for (let count = 0; pending.length && count < 400; count++) {
              const fiber = pending.pop(); if (!fiber || seen.has(fiber)) continue; seen.add(fiber);
              if (matchesChoice(fiber.memoizedProps || fiber.stateNode?.props, ability, change, itemTarget)) {
                match = true; break;
              }
              if (fiber.child && fiber.stateNode?.namespaceURI !== "http://www.w3.org/2000/svg") pending.push(fiber.child);
              if (fiber !== first && fiber.sibling) pending.push(fiber.sibling);
            }
          }
        }
        if (match) {
          result.push(choice);
          matches.push({ node: choice, list, scope: ctx.scope, setup: scope,
            changeKey: app.Core.stable(change), className: choice.className, html: choice.innerHTML });
        }
      }
    }
    lastPickerMatches = matches;
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
  function currentCharacterName(ctx) {
    const expected = ctx?.props?.characterInfo?.characterID;
    if (!Number.isSafeInteger(expected) || expected <= 0) return "";
    const host = document.querySelector('[class*="GamePage_gamePage"]');
    let fiber = host && hostFiber(host);
    for (let depth = 0; fiber && depth < 80; depth++, fiber = fiber.return) {
      const state = fiber.stateNode?.state;
      if (state?.characterItemMap && state.character) {
        if (state.isLoading || state.isFullDisconnected || state.character.id !== expected) return "";
        return typeof state.character.name === "string" ? state.character.name : "";
      }
    }
    return "";
  }
  function nativeSnapshot(character, id) {
    const ctx = cloudContext();
    if (ctx?.character !== character || ctx.loadouts?.[id]?.id !== id)
      throw Error("当前原生配装尚未完整加载，请稍后重试。");
    return app.Core.snapshot(ctx.loadouts[id]);
  }
  app.Adapter = Object.freeze({ currentCharacterName, nativeSnapshot, cloudContext, current, describe, target, pickerTargets, actionContexts, visibleLoadoutPanel, loadoutController });
})(globalThis);
