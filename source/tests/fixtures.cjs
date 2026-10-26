"use strict";
const trigger = { dependencyHrid: "/combat_trigger_dependencies/self", conditionHrid: "/combat_trigger_conditions/current_hp",
  comparatorHrid: "/combat_trigger_comparators/less_than_equal", value: 0 };
function modern(name = "测试角色·法系") {
  return { version: 2, format: "mwi-vue-solo", simulationSettings: { simulationTimeHours: 99 }, player: {
    id: "1", name, levels: { stamina: 80, intelligence: 80, attack: 60, melee: 40, defense: 75, ranged: 20, magic: 90 },
    skillExperience: { stamina: 0, magic: null },
    equipment: { weapon: { itemHrid: "/items/blazing_trident", enhancementLevel: 10 },
      off_hand: { itemHrid: "/items/bishops_codex", enhancementLevel: 0 }, head: { itemHrid: "", enhancementLevel: 0 } },
    food: ["/items/star_fruit_gummy", "", "/items/dragon_fruit_yogurt"], drinks: ["/items/wisdom_coffee", "", ""],
    abilities: [{ abilityHrid: "/abilities/mystic_aura", level: 10 }, null,
      { abilityHrid: "/abilities/fireball", level: 20 }, { abilityHrid: "", level: 1 }, { abilityHrid: "", level: 1 }],
    triggerMap: { "/items/star_fruit_gummy": [], "/abilities/fireball": [trigger] },
    houseRooms: { "/house_rooms/library": 0 }, achievements: {}, guildBuffs: {}, combatScrolls: { "/items/critical_scroll": { quantity: null } }
  } };
}
function current(name = "测试角色·当前", id = 101) {
  return { character: { id, name, email: "secret@example.invalid", authToken: "never-keep" },
    account: { password: "never-keep" }, characterInfo: { labyrinthAttackSpeedLevel: 3 },
    characterSkills: [{ skillHrid: "/skills/magic", level: 90, experience: "0" }],
    characterItems: [{ itemHrid: "/items/blazing_trident", itemLocationHrid: "/item_locations/two_hand", enhancementLevel: 0,
      hash: "secret-hash", count: 1 }, { itemHrid: "/items/coin", itemLocationHrid: "/item_locations/inventory", enhancementLevel: 0, count: 9999 }],
    combatUnit: { combatAbilities: [{ abilityHrid: "/abilities/fireball", level: 20, slotNumber: 3 }], currentHp: 123 },
    actionTypeFoodSlotsMap: { "/action_types/combat": ["", null, { itemHrid: "/items/star_fruit_gummy", count: 100 }],
      "/action_types/enhancing": ["/items/blessed_tea"] },
    actionTypeDrinkSlotsMap: { "/action_types/combat": ["/items/wisdom_coffee", "", ""] },
    consumableCombatTriggersMap: { "/items/star_fruit_gummy": [] }, abilityCombatTriggersMap: { "/abilities/fireball": [trigger] },
    characterHouseRoomMap: { 11: { houseRoomHrid: "/house_rooms/library", level: 0 } },
    characterAchievements: { 7: { achievementHrid: "/achievements/novice", isCompleted: false } },
    characterGuildBuffMap: { "/guild_buffs/force_combat": { guildBuffHrid: "/guild_buffs/force_combat", level: 3 } },
    guildBuildingLevelMap: { "/guild_shrines/force": 2 },
    marketItemValues: { "/items/coin": { 0: 1 } }, mainSiteCombat: { actionHrid: "/actions/combat/fly", difficultyTier: 1 }
  };
}
function shared() {
  return { profile: { sharableCharacter: { characterId: 202, name: "测试队友", isOnline: true },
    characterSkills: [{ skillHrid: "/skills/stamina", level: 70, experience: 0 }],
    wearableItemMap: { head: { currentItem: { itemHrid: "/items/magicians_hat", itemLocationHrid: "/item_locations/head", enhancementLevel: 0 }, privateData: "never-keep" } },
    equippedAbilities: [{ abilityHrid: "/abilities/mystic_aura", level: 20, slotNumber: 0 }],
    currentCombatLoadout: { actionTypeHrid: "/action_types/combat", foodItemHrids: ["", "/items/star_fruit_gummy", ""],
      drinkItemHrids: ["", "", ""], abilityCombatTriggersMap: { "/abilities/mystic_aura": [] } },
    characterHouseRoomMap: {}, characterAchievements: [], guildBuffLevelMap: {} },
    mainSiteConsumables: { foodItemHrids: ["", "/items/star_fruit_gummy", ""], drinkItemHrids: ["", "", ""],
      abilityCombatTriggersMap: {}, consumableCombatTriggersMap: {} }, marketItemValues: { large: true }
  };
}
module.exports = { modern, current, shared, trigger };
