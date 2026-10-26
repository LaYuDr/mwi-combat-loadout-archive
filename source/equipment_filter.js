(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MWIEquipmentFilter = factory();
})(globalThis, function () {
  "use strict";
  const categories = Object.freeze({ all: "全部", attack: "攻击", melee: "近战", defense: "防御", ranged: "远程", magic: "魔法", other: "其他" });
  const skills = ["attack", "melee", "defense", "ranged", "magic"];
  const exemptSlots = Object.freeze(["pouch", "neck", "ring", "earrings"]);
  const isExempt = slot => exemptSlots.includes(slot);
  const normalize = text => String(text || "").normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
  function groups(item) {
    const names = new Set(item.requirements.map(r => r.skillHrid.replace("/skills/", "")));
    const found = skills.filter(skill => names.has(skill));
    return found.length ? found : ["other"];
  }
  function level(item, category = "all") {
    const requirements = item.requirements.filter(r => r.skillHrid !== "/skills/total_level" &&
      (skills.includes(category) ? r.skillHrid === `/skills/${category}` : true));
    // Wear requirements differ from economic itemLevel, especially for refined equipment.
    return requirements.length ? Math.max(...requirements.map(r => r.level)) : item.itemLevel;
  }
  function validRange({ min = "", max = "" }) {
    return (min === "" || Number.isFinite(Number(min)) && Number(min) >= 0) &&
      (max === "" || Number.isFinite(Number(max)) && Number(max) >= 0) &&
      (min === "" || max === "" || Number(min) < Number(max));
  }
  function active({ category = "all", min = "", max = "", search = "" }) {
    return category !== "all" || min !== "" || max !== "" || normalize(search) !== "";
  }
  function options(catalogue, slot, filters) {
    if (isExempt(slot)) return catalogue.items.filter(item => item.slot === slot);
    if (!validRange(filters)) return [];
    const { category = "all", min = "", max = "", search = "" } = filters;
    const needle = normalize(search);
    return catalogue.items.filter(item => item.slot === slot &&
      (category === "all" || groups(item).includes(category)) &&
      (min === "" || level(item, category) >= Number(min)) &&
      (max === "" || level(item, category) < Number(max)) &&
      (!needle || normalize(`${item.zh} ${item.en} ${item.hrid}`).includes(needle)));
  }
  function localeForLabel(catalogue, slot, nativeLabel) {
    return normalize(nativeLabel) === normalize(catalogue.slots[slot]?.en) ? "en" : "zh";
  }
  return Object.freeze({ categories, exemptSlots, isExempt, normalize, groups, level, validRange, active, options, localeForLabel });
});
