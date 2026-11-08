"use strict";
const fs = require("node:fs");
const path = require("node:path");
const endpoint = "https://ukpyedhl.cn-hk1.rainapp.top";
const metadata =
  [
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// @grant        GM_addValueChangeListener",
    "// @grant        GM_removeValueChangeListener",
    "// @grant        GM_xmlhttpRequest",
    "// @connect      ukpyedhl.cn-hk1.rainapp.top",
    "// @antifeature  tracking Installation and daily activity statistics; see the script's settings and privacy details."
  ].join("\n") + "\n";
function buildUsage(root, file, pluginId, name, version, development = false) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const marker = "/* USAGE_BOOTSTRAP */";
  if (source.split(marker).length !== 2) throw new Error("Usage bootstrap marker missing or duplicated");
  const config = JSON.stringify({
    pluginId,
    name,
    version,
    endpoint,
    development,
    defaultEnabled: ["mwi_guild", "mwi_invite", "mwi_enhancement", "mwi_assets", "mwi_loadout", "mwi_labyrinth"].includes(pluginId),
    reportOptOut: ["mwi_guild", "mwi_invite", "mwi_enhancement", "mwi_assets", "mwi_loadout", "mwi_labyrinth"].includes(pluginId)
  });
  const api = {
    getValue: "GM_getValue",
    setValue: "GM_setValue",
    listen: "GM_addValueChangeListener",
    unlisten: "GM_removeValueChangeListener",
    request: "GM_xmlhttpRequest"
  };
  const bindings = Object.entries(api)
    .map(([key, value]) => `${key}: typeof ${value} === "function" ? ${value} : null`)
    .join(",\n");
  return (
    `\n// LAYU_USAGE_START ${pluginId}\n` +
    source.replace(marker, `try { boot(${config}, {${bindings}}); } catch (_) { /* Telemetry is optional. */ }`) +
    `\n// LAYU_USAGE_END ${pluginId}\n`
  );
}
module.exports = { buildUsage, metadata, endpoint };
