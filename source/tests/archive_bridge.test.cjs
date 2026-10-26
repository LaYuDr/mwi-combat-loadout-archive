"use strict";
const { test } = require("node:test"), assert = require("node:assert/strict");
const C = require("../archive_core.js"), B = require("../archive_bridge.js"), F = require("./fixtures.cjs");
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(options = {}) {
  const saved = [], statuses = [], sent = [], window = { postMessage: message => sent.push(message) };
  const bridge = B.create({ core: C, pageWindow: window, origin: "https://example.test", onImport: (p, at) => saved.push({ p, at }),
    onStatus: s => statuses.push(s), ...options });
  const emit = data => bridge.observe({ source: window, origin: "https://example.test", data: { channel: "mwi-tm-bridge", ...data } });
  const request = (id = "a", payload = F.current()) => emit({ type: "mwi-tm-import", requestId: id, payload });
  const result = (id = "a", ok = true) => emit({ type: "mwi-tm-import-result", requestId: id, ok });
  return { bridge, saved, statuses, sent, emit, request, result, window };
}
test("only a matched successful ACK archives a sanitized copy, once", async () => {
  const h = harness(); h.request(); assert.equal(h.saved.length, 0); h.result("unmatched"); h.result(); h.result(); await tick();
  assert.equal(h.saved.length, 1); assert.equal(h.saved[0].p.account, undefined); h.bridge.close();
});
test("native empty-object food/drink maps survive the successful import bridge", async () => {
  const h = harness(); h.request("empty-combat", F.emptyCombatSlots());
  assert.equal(h.saved.length, 0); h.result("empty-combat"); await tick();
  assert.equal(h.saved.length, 1); assert.deepEqual(h.statuses, []);
  assert.deepEqual(h.saved[0].p.actionTypeFoodSlotsMap["/action_types/combat"], {});
  assert.deepEqual(h.saved[0].p.actionTypeDrinkSlotsMap["/action_types/combat"], {});
  h.bridge.close();
});
test("wrong origins/sources, failed ACKs and other tool imports cannot archive", async () => {
  const h = harness();
  for (const event of [{ source: {}, origin: "https://example.test" }, { source: h.window, origin: "https://wrong.test" }])
    h.bridge.observe({ ...event, data: { channel: "mwi-tm-bridge", type: "mwi-tm-import", requestId: "x", payload: F.current() } });
  h.result("x"); h.request("failed"); h.result("failed", false);
  h.emit({ type: "mwi-tm-import", requestId: "other", importTarget: "enhancement", payload: F.current() }); h.result("other");
  await tick(); assert.equal(h.saved.length, 0); h.bridge.close();
});
test("out of order and same millisecond requests retain original observation order", async () => {
  const h = harness({ now: () => 100 }); h.request("old"); h.request("new"); h.result("new"); h.result("old"); await tick();
  assert.equal(h.saved[0].at, 101); assert.equal(h.saved[1].at, 100); h.bridge.close();
});
test("expired requests are not archived by late ACKs", async () => {
  const h = harness({ timeout: 5 }); h.request(); await new Promise(resolve => setTimeout(resolve, 20)); h.result(); await tick();
  assert.equal(h.saved.length, 0); assert.ok(h.statuses[0].includes("尚未归档")); h.bridge.close();
});
test("restore waits for ACK and does not recursively archive its own message", async () => {
  const h = harness(); const row = await C.prepare(F.modern()); const promise = h.bridge.restore(row, "5");
  const msg = h.sent[0]; h.emit(msg); h.result(msg.requestId); await promise; await tick();
  assert.equal(msg.targetPlayerId, "5"); assert.equal(h.saved.length, 0); h.bridge.close();
});
test("restore rejection and timeout remain actionable, not false success", async () => {
  const h = harness({ timeout: 5 }), row = await C.prepare(F.modern());
  const rejected = h.bridge.restore(row, "1"); h.result(h.sent[0].requestId, false); await assert.rejects(rejected);
  await assert.rejects(h.bridge.restore(row, "1"), /网站未响应/); h.bridge.close();
});
test("unknown shapes and persistence failures produce status errors", async () => {
  const h = harness({ onImport: () => { throw new Error("磁盘已满"); } });
  h.request("unknown", { account: "secret" }); h.result("unknown"); h.request(); h.result(); await tick();
  assert.ok(h.statuses.some(s => s.includes("格式"))); assert.ok(h.statuses.some(s => s.includes("磁盘已满"))); h.bridge.close();
});
