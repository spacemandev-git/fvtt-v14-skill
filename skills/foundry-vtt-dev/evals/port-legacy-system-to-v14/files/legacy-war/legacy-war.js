import { FactionSheet } from "./modules/faction-sheet.js";
import { TerritorySheet } from "./modules/territory-sheet.js";

Hooks.once("init", async () => {
  console.log("Legacy War | Initializing");
  Actors.unregisterSheet("core", ActorSheet);
  Actors.registerSheet("legacy-war", FactionSheet, { types: ["faction"], makeDefault: true });
  Items.unregisterSheet("core", ItemSheet);
  Items.registerSheet("legacy-war", TerritorySheet, { types: ["territory", "power"], makeDefault: true });

  game.settings.register("legacy-war", "startingMissiles", {
    name: "LW.SettingStartingMissiles",
    config: true,
    type: Number,
    default: 0
  });

  loadTemplates(["systems/legacy-war/templates/parts/territory-row.html"]);
});

Hooks.on("preCreateActor", (createData, options, userId) => {
  if (createData.type === "faction") {
    mergeObject(createData, { "data.missiles": game.settings.get("legacy-war", "startingMissiles") });
  }
});

Hooks.on("renderChatMessage", (message, html, data) => {
  html.find(".lw-star").css("color", "gold");
});
