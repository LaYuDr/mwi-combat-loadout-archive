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
    if (change.kind.endsWith("_trigger")) {
      return candidates[0].querySelector('[class*="CombatTriggersSetting_settingButton__"]') ||
        candidates[0].querySelector('[class*="CombatTriggersSetting_combatTriggersSetting__"]') ||
        candidates[0];
    }
    return candidates[0];
  }
  // Match only choices in a visible picker belonging to the changed native slot.
  // Item identity comes from component props, never translated labels or icon URLs.
  let lastPickerMatches = [];
  const prefilledTriggerRows = new WeakMap();
  const triggerFieldOrder = ["dependencyHrid", "conditionHrid", "comparatorHrid"];
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
  function resolveScope(ctx) {
    let scope = ctx.setup || ctx.panel;
    if (!visible(scope)) return null;
    let scopeFiber = hostFiber(scope, null, true);
    if (!scopeFiber && !ctx.overview && scope !== ctx.panel) {
      scope = ctx.panel;
      scopeFiber = hostFiber(scope, null, true);
    }
    return { scope, scopeFiber };
  }
  function triggerRowText(ctx, trigger, includeValue = true) {
    const parts = [
      translate(ctx, "combatTriggerDependencyNames", trigger.dependencyHrid),
      translate(ctx, "combatTriggerConditionNames", trigger.conditionHrid),
      translate(ctx, "combatTriggerComparatorNames", trigger.comparatorHrid)
    ];
    if (includeValue) parts.push(String(trigger.value));
    return parts.join(" · ");
  }
  function findOptionByValue(listbox, targetValue) {
    const options = [...listbox.querySelectorAll('[role="option"], li')].filter(visible);
    for (const option of options) {
      if (option.dataset?.value === targetValue || option.getAttribute("data-value") === targetValue) return option;
      const fiber = hostFiber(option);
      let node = fiber;
      for (let depth = 0; node && depth < 8; depth++, node = node.return) {
        const props = node.memoizedProps || node.stateNode?.props;
        if (props?.value === targetValue) return option;
      }
    }
    return null;
  }
  function inspectTriggerMenus(ctx, changes, scope, scopeFiber, targets, prefilled, scrollTargets, guides) {
    const menus = [...document.querySelectorAll('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]')].filter(visible);
    if (!menus.length) return;
    const listboxes = [...document.querySelectorAll('ul[role="listbox"]')].filter(visible);
    for (const editMenu of menus) {
      const path = pickerPath(scopeFiber, editMenu);
      if (!path) continue;
      const editMenuFiber = path[0];
      const ancestors = new Set();
      let controller = null, ownerSlot = null;
      for (const owner of path) {
        ancestors.add(owner.stateNode);
        if (!controller && owner.stateNode && Array.isArray(owner.stateNode.state?.combatTriggers) &&
            typeof owner.stateNode.setState === "function") {
          controller = owner.stateNode;
        }
        const props = owner.memoizedProps || owner.stateNode?.props;
        if (!ownerSlot && props) {
          if (Number.isInteger(props.slotNumber)) {
            ownerSlot = { kind: "ability_trigger", baseKind: "ability", slot: props.slotNumber };
          } else if (Number.isInteger(props.slotIndex) &&
              ["/consumable_slot_types/food", "/consumable_slot_types/drink"].includes(props.consumableSlotTypeHrid)) {
            const baseKind = props.consumableSlotTypeHrid.split("/").pop();
            ownerSlot = { kind: `${baseKind}_trigger`, baseKind, slot: props.slotIndex };
          }
        }
      }
      if (!ancestors.has(scope) || !controller || !ownerSlot) continue;
      const labelNode = editMenu.querySelector('[class*="CombatTriggersSetting_label__"]');
      const baseChange = changes.find(change => change.kind === ownerSlot.baseKind && change.slot === ownerSlot.slot);
      const triggerChange = changes.find(change => change.kind === ownerSlot.kind && change.slot === ownerSlot.slot);
      if (baseChange) {
        const goalName = describe(ctx, baseChange, baseChange.to);
        guides.push({
          host: editMenu, after: labelNode, kind: "trigger", state: "warn",
          key: `base:${baseChange.kind}:${baseChange.slot}:${goalName}`,
          title: `请先将槽位更换为「${goalName}」，再设置触发条件`
        });
        continue;
      }
      if (!triggerChange) continue;
      const targetTriggers = Array.isArray(triggerChange.to) ? triggerChange.to : [];
      const currentTriggers = controller.state.combatTriggers;
      const rowEls = [...editMenu.querySelectorAll('[class*="CombatTriggersSetting_combatTrigger__"]')];
      let rowMap = prefilledTriggerRows.get(editMenu);
      if (!rowMap) { rowMap = new Map(); prefilledTriggerRows.set(editMenu, rowMap); }
      const prefills = [], activePrefillRows = new Set();
      for (let i = 0; i < Math.min(currentTriggers.length, targetTriggers.length); i++) {
        const cur = currentTriggers[i], tgt = targetTriggers[i], rowEl = rowEls[i];
        if (!cur || !tgt || !rowEl) continue;
        if (cur.dependencyHrid !== tgt.dependencyHrid || cur.conditionHrid !== tgt.conditionHrid ||
            cur.comparatorHrid !== tgt.comparatorHrid) continue;
        const valInput = rowEl.querySelector('[class*="CombatTriggersSetting_valueInputContainer__"] input');
        if (!valInput) continue;
        const sig = `${ctx.scope}|${triggerChange.kind}|${triggerChange.slot}|${cur.dependencyHrid}|${cur.conditionHrid}|${cur.comparatorHrid}|${tgt.value}`;
        const curEmpty = cur.value === "" || cur.value === null || cur.value === undefined;
        const curMatches = !curEmpty && Number(cur.value) === Number(tgt.value);
        if (!curMatches && rowMap.get(i) !== sig) {
          rowMap.set(i, sig);
          prefills.push({ index: i, value: tgt.value });
          activePrefillRows.add(i);
        } else if (curMatches && rowMap.get(i) === sig) {
          activePrefillRows.add(i);
        }
      }
      let effectiveTriggers = currentTriggers;
      if (prefills.length) {
        effectiveTriggers = currentTriggers.map((item, idx) => {
          const hit = prefills.find(entry => entry.index === idx);
          return hit ? { ...item, value: hit.value } : { ...item };
        });
        controller.setState({ combatTriggers: effectiveTriggers });
      }
      const guideRows = [];
      let allRowsDone = effectiveTriggers.length === targetTriggers.length;
      const openSelectTarget = { row: -1, field: null, controls: null };
      for (let i = 0; i < Math.max(effectiveTriggers.length, targetTriggers.length); i++) {
        const rowEl = rowEls[i];
        const inputsWrap = rowEl?.querySelector('[class*="CombatTriggersSetting_inputs__"]');
        const controls = inputsWrap ? [...inputsWrap.children] : [];
        if (i < targetTriggers.length) {
          const cur = effectiveTriggers[i], tgt = targetTriggers[i];
          const valBox = rowEl?.querySelector('[class*="CombatTriggersSetting_valueInputContainer__"]');
          const hasValInput = Boolean(valBox?.querySelector("input"));
          const depOk = Boolean(cur && cur.dependencyHrid === tgt.dependencyHrid);
          const condOk = depOk && cur.conditionHrid === tgt.conditionHrid;
          const compOk = condOk && cur.comparatorHrid === tgt.comparatorHrid;
          const curEmpty = !cur || cur.value === "" || cur.value === null || cur.value === undefined;
          const valOk = compOk && (!hasValInput || (!curEmpty && Number(cur.value) === Number(tgt.value)));
          const rowDone = depOk && condOk && compOk && valOk;
          if (!rowDone) allRowsDone = false;
          const showVal = !compOk || hasValInput;
          guideRows.push({
            text: `${i + 1}. ${triggerRowText(ctx, tgt, showVal)}`,
            done: rowDone,
            prefilled: Boolean(rowDone && hasValInput && activePrefillRows.has(i))
          });
          if (rowEl && !rowDone) {
            if (!depOk && controls[0]) targets.push(controls[0]);
            else if (!condOk && controls[1]) targets.push(controls[1]);
            else if (!compOk && controls[2]) targets.push(controls[2]);
            else if (!valOk && valBox) targets.push(valBox);
          } else if (rowDone && hasValInput && activePrefillRows.has(i) && valBox) {
            prefilled.push(valBox);
          }
          for (let cIdx = 0; cIdx < 3; cIdx++) {
            const expanded = controls[cIdx]?.querySelector('[aria-expanded="true"]');
            if (expanded) {
              openSelectTarget.row = i;
              openSelectTarget.field = triggerFieldOrder[cIdx];
              openSelectTarget.controls = expanded.getAttribute("aria-controls") || "";
            }
          }
        } else if (rowEl) {
          allRowsDone = false;
          const removeBtn = rowEl.querySelector('[class*="CombatTriggersSetting_removeButtonContainer__"] button') ||
            rowEl.querySelector('[class*="CombatTriggersSetting_removeButtonContainer__"]');
          if (removeBtn) targets.push(removeBtn);
        }
      }
      if (effectiveTriggers.length < targetTriggers.length && effectiveTriggers.length < 4) {
        const addBtn = editMenu.querySelector('[class*="CombatTriggersSetting_buttonContainer__"] button');
        if (addBtn && !addBtn.disabled) targets.push(addBtn);
      }
      if (allRowsDone) {
        const saveBtn = [...editMenu.children].find(node => node.tagName === "BUTTON" && !node.disabled);
        if (saveBtn) targets.push(saveBtn);
      }
      for (const listbox of listboxes) {
        let rowIdx = -1, field = null;
        if (openSelectTarget.row >= 0 && openSelectTarget.field &&
            (!openSelectTarget.controls || listbox.id === openSelectTarget.controls ||
              listbox.closest(`[id="${openSelectTarget.controls.replace(/"/g, '\\"')}"]`) || listboxes.length === 1)) {
          rowIdx = openSelectTarget.row;
          field = openSelectTarget.field;
        } else {
          const lbPath = pickerPath(editMenuFiber, listbox);
          if (lbPath) {
            const lbAncestors = new Set(lbPath.map(f => f.stateNode));
            for (let i = 0; i < rowEls.length && rowIdx < 0; i++) {
              const inputsWrap = rowEls[i]?.querySelector('[class*="CombatTriggersSetting_inputs__"]');
              const controls = inputsWrap ? [...inputsWrap.children] : [];
              for (let cIdx = 0; cIdx < 3; cIdx++) {
                if (controls[cIdx] && lbAncestors.has(controls[cIdx])) {
                  rowIdx = i;
                  field = triggerFieldOrder[cIdx];
                  break;
                }
              }
            }
          }
        }
        if (rowIdx >= 0 && field && targetTriggers[rowIdx]?.[field]) {
          const tgtVal = targetTriggers[rowIdx][field];
          const option = findOptionByValue(listbox, tgtVal);
          if (option) {
            targets.push(option);
            scrollTargets.push({ container: listbox, node: option, key: `opt:${rowIdx}:${field}:${tgtVal}` });
          }
        }
      }
      guides.push({
        host: editMenu, after: labelNode, kind: "trigger",
        state: allRowsDone ? "ready" : "guide",
        key: JSON.stringify([allRowsDone, targetTriggers.length, guideRows]),
        title: allRowsDone
          ? "已与子方案一致，点击下方「保存」生效"
          : targetTriggers.length ? "子方案目标触发条件" : "目标：冷却结束即使用（移除下方条件后保存）",
        rows: guideRows
      });
    }
  }
  function pickerGuidance(ctx, changes) {
    const targets = [], prefilled = [], scrollTargets = [], guides = [], matches = [];
    const desired = changes.filter(change => ["equipment", "ability", "food", "drink"].includes(change.kind));
    const lists = [...document.querySelectorAll('[class*="AbilitySlot_availableAbilities__"], [class*="ItemSelector_itemList__"]')].filter(visible);
    const hasTriggerMenus = Boolean(document.querySelector('[class*="CombatTriggersSetting_combatTriggersEditMenu__"]'));
    if ((!desired.length || !lists.length) && !hasTriggerMenus) {
      lastPickerMatches = [];
      return { targets, prefilled, scrollTargets, guides };
    }
    // Host expandos may retain an alternate from before a popup opened or its
    // filter changed. Traverse only the committed tree of this card's setup.
    const resolved = resolveScope(ctx);
    if (!resolved) {
      lastPickerMatches = [];
      return { targets, prefilled, scrollTargets, guides };
    }
    const { scope, scopeFiber } = resolved;
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
            targets.push(prior.node); matches.push(prior);
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
      const matching = changes.filter(change =>
        (ability ? change.kind === "ability" : ["equipment", "food", "drink"].includes(change.kind)) &&
        (ownerSlot ? change.kind === ownerSlot.kind && change.slot === ownerSlot.slot : ancestors.has(target(ctx, change))));
      if (matching.length !== 1) continue;
      const change = matching[0];
      const changeKey = app.Core.stable(change);
      let matchedAny = false, blockedMatch = false;
      if (change.to === null) {
        for (const choice of list.children) {
          if (!visible(choice)) continue;
          if (/removeButton/.test(choice.className)) {
            matchedAny = true;
            targets.push(choice);
            scrollTargets.push({ container: list, node: choice, key: changeKey });
            matches.push({ node: choice, list, scope: ctx.scope, setup: scope,
              changeKey, className: choice.className, html: choice.innerHTML });
          }
        }
      } else {
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
          if (!visible(choice)) continue;
          const disabledChoice = /insufficient|requirementsNotMet/.test(choice.className);
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
            if (disabledChoice) { blockedMatch = true; continue; }
            matchedAny = true;
            targets.push(choice);
            scrollTargets.push({ container: list, node: choice, key: changeKey });
            matches.push({ node: choice, list, scope: ctx.scope, setup: scope,
              changeKey, className: choice.className, html: choice.innerHTML });
          }
        }
      }
      const menuHost = list.closest('[class*="ItemSelector_menu__"], [class*="AbilitySlot_abilitySelector__"]');
      if (menuHost) {
        const goalLabel = change.to === null ? "清空槽位（点「移除」）" : describe(ctx, change, change.to);
        const title = matchedAny
          ? `目标：${goalLabel}`
          : `目标：${goalLabel}（${blockedMatch ? "数量不足或未满足等级要求" : "当前列表暂无可选项"}）`;
        guides.push({
          host: menuHost, after: null, kind: "picker",
          state: matchedAny ? "guide" : "warn",
          key: `${changeKey}:${matchedAny}:${blockedMatch}:${title}`,
          title
        });
      }
    }
    lastPickerMatches = matches;
    if (hasTriggerMenus) inspectTriggerMenus(ctx, changes, scope, scopeFiber, targets, prefilled, scrollTargets, guides);
    return { targets, prefilled, scrollTargets, guides };
  }
  function pickerTargets(ctx, changes) {
    return pickerGuidance(ctx, changes).targets;
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
  app.Adapter = Object.freeze({ currentCharacterName, nativeSnapshot, cloudContext, current, describe, target, pickerTargets, pickerGuidance, actionContexts, visibleLoadoutPanel, loadoutController });
})(globalThis);
