(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./archive_core.js"));
  else root.MWINativeDocument = factory(root.MWILoadoutCore);
})(globalThis, function (legacy) {
  "use strict";
  const FORMAT = "mwi-loadout-archive", MAX_BYTES = 20 * 1024 * 1024, MAX_RECORDS = 500;
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function parse(text) {
    if (typeof text !== "string" || new TextEncoder().encode(text).length > MAX_BYTES)
      throw new Error("JSON 文件超过 20 MB，请拆分后重试。");
    try {
      return JSON.parse(text, (key, value) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw Error("不安全的字段");
        return value;
      });
    } catch (_) { throw new Error("JSON 无法解析或包含不安全字段，请选择网页原生导出或本助手的备份。"); }
  }
  function inspect(text) {
    const data = parse(text);
    const scope = data?.version === 2 && data.format === "mwi-vue-solo" && object(data.player) ? "solo"
      : data?.version === 2 && data.format === "mwi-vue-group" && Array.isArray(data.players) ? "group" : null;
    if (!scope) throw new Error("不是网页原生的现代单人或整队 JSON，请在网页导入/导出中重新导出。");
    const players = scope === "solo" ? [data.player] : data.players;
    if (!players.length || players.length > 5) throw new Error("原生配置必须包含 1 至 5 位玩家。");
    const ids = new Set();
    for (const p of players) {
      if (!object(p) || !/^[1-5]$/.test(String(p.id)) || ids.has(String(p.id)) || typeof p.name !== "string" ||
          p.name.length > 1000 || !object(p.levels) || !object(p.equipment))
        throw new Error("玩家槽位或配置格式不完整，未保存或导入任何数据。");
      ids.add(String(p.id));
    }
    // Inspect structure, never rebuild or remove fields from a native export.
    // This also retains future fields, explicit zero, null, empty objects and arrays.
    let nodes = 0;
    function check(value, depth = 0) {
      if (++nodes > 200000 || depth > 64) throw new Error("JSON 结构过大或嵌套过深。");
      if (value && typeof value === "object") for (const entry of Object.values(value)) check(entry, depth + 1);
    }
    check(data);
    return { scope, data, players, names: players.map(p => p.name || `玩家 ${p.id}`) };
  }
  function validName(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().length > 120) throw new Error("名称需要 1 至 120 个字符。");
    return value.trim();
  }
  async function prepare(text, options = {}) {
    const info = inspect(text), now = options.now ?? Date.now();
    const label = (options.name === undefined || options.name === "" ? "" : validName(options.name)) || (info.scope === "solo" ? `${info.names[0].slice(0, 110)} · 配装` : `${info.players.length} 人整队配置`);
    return { schemaVersion: 2, id: options.id || `native:${globalThis.crypto.randomUUID()}`, kind: "named",
      name: validName(label), documentKind: info.scope, jsonText: text, characterName: info.names.join("、"),
      sourceFormat: info.data.format, fingerprint: await legacy.digest(info.data),
      capturedAt: now, createdAt: now, updatedAt: now, deletedAt: null };
  }
  function describe(row) {
    if (row.schemaVersion === 2 && typeof row.jsonText === "string") return { ...inspect(row.jsonText), legacy: false, text: row.jsonText };
    const cleaned = legacy.sanitizePayload(row.payload);
    return { legacy: true, scope: "solo", text: JSON.stringify(cleaned.payload),
      names: [row.characterName || cleaned.characterName], players: [], data: cleaned.payload };
  }
  async function importFile(text) {
    const data = parse(text);
    let entries;
    if (data?.format === FORMAT && data.version === 2 && Array.isArray(data.archives)) {
      entries = data.archives;
    } else if (data?.format === FORMAT && data.version === 1) {
      entries = legacy.parseFile(text).map(e => ({ name: e.name, capturedAt: e.capturedAt, legacyPayload: e.payload }));
    } else if (data?.format === "mwi-vue-solo" || data?.format === "mwi-vue-group") entries = [{ jsonText: text }];
    else throw new Error("请选择网页原生 JSON 或配装助手备份；游戏原始资料请先导入网页，再保存当前配置。");
    if (!entries.length || entries.length > MAX_RECORDS) throw new Error("每个文件需包含 1 至 500 份档案。");
    // Validate every entry before returning anything to the storage transaction.
    const rows = [];
    for (const entry of entries) {
      if (!object(entry)) throw new Error("备份档案格式错误。");
      let row;
      if (typeof entry.jsonText === "string" && !Object.hasOwn(entry, "legacyPayload")) row = await prepare(entry.jsonText, { name: entry.name });
      else if (object(entry.legacyPayload) && !Object.hasOwn(entry, "jsonText")) row = await legacy.prepare(entry.legacyPayload,
        { id: `legacy:${globalThis.crypto.randomUUID()}`, kind: "named", name: validName(entry.name) });
      else throw new Error("备份档案缺少原生 JSON，或包含冲突的配装格式。");
      if (entry.name !== undefined) row.name = validName(entry.name);
      if (Number.isFinite(entry.capturedAt) && entry.capturedAt > 0 && entry.capturedAt <= Date.now()) row.capturedAt = entry.capturedAt;
      rows.push(row);
    }
    return rows;
  }
  function backup(rows) {
    if (!rows.length) throw new Error("没有可备份的档案。");
    return JSON.stringify({ format: FORMAT, version: 2, exportedAt: new Date().toISOString(), archives: rows.map(row => {
      const info = describe(row);
      return { name: validName(row.name), capturedAt: row.capturedAt,
        ...(info.legacy ? { legacyPayload: info.data } : { jsonText: row.jsonText }) };
    }) }, null, 2);
  }
  return Object.freeze({ FORMAT, MAX_BYTES, MAX_RECORDS, parse, inspect, prepare, describe, validName, importFile, backup });
});
