"use strict";
// Read-only extraction from the simulator's published Milky Way Idle data snapshot.
// Usage: node source/generate_equipment_catalog.cjs /path/to/MWICombatSimulator
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const upstream = process.argv[2];
if (!upstream) throw new Error("请提供模拟器公开源码快照路径，不读取玩家数据。");
const paths = ["src/shared/gameDataIndex.generated.json", "src/combatsimulator/data/itemDetailMap.json",
  "locales/zh/translation.official.generated.json", "locales/en/translation.official.generated.json"];
const raw = paths.map(file => fs.readFileSync(path.join(upstream, file), "utf8"));
const [index, definitions, zh, en] = raw.map(text => JSON.parse(text));
const rows = [], slots = {};
for (const slot of index.metadata.equipmentSlotKeys) {
  const equipmentType = `/equipment_types/${slot === "weapon" ? "main_hand" : slot}`;
  slots[slot] = { zh: zh.equipmentTypeNames[equipmentType], en: en.equipmentTypeNames[equipmentType] };
  for (const entry of index.equipmentBySlot[slot]) {
    // Match the website's existing exclusion of skilling-only charms.
    if (slot === "charm" && entry.isCombatInert === true) continue;
    const definition = definitions[entry.hrid];
    if (!definition?.equipmentDetail) throw new Error(`缺少装备定义：${entry.hrid}`);
    rows.push({ hrid: entry.hrid, slot, itemLevel: definition.itemLevel,
      requirements: definition.equipmentDetail.levelRequirements || [],
      zh: zh.itemNames[entry.hrid] || definition.name, en: en.itemNames[entry.hrid] || definition.name });
  }
}
const metadata = { source: "https://github.com/azhu949/MWICombatSimulator", generatedAt: index.metadata.generatedAt || null,
  inputSha256: Object.fromEntries(paths.map((file, i) => [file, crypto.createHash("sha256").update(raw[i]).digest("hex")])) };
const output = `// Milky Way Idle public item names and equipment requirements; rights belong to the game authors.
// Extracted from the simulator's official-data snapshot; no player data or runtime network requests.
// Regenerate with source/generate_equipment_catalog.cjs. Do not hand-edit the catalogue.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.MWIEquipmentCatalog=factory();})(globalThis,function(){'use strict';return ${JSON.stringify({ metadata, slots, items: rows })};});
`;
fs.writeFileSync(path.join(__dirname, "equipment_catalog.js"), output);
console.log(`Generated equipment catalogue: ${rows.length} items, ${Object.keys(slots).length} slots.`);
