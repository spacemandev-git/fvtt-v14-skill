/**
 * __TITLE__
 * Entry point, loaded through the "esmodules" list in system.json.
 *
 * Everything the system plugs into Foundry is registered in the `init` hook, which runs once, before documents are
 * created and before the world's data is available.
 */
import { SYSTEM } from "./config.mjs";
import * as dataModels from "./data/_module.mjs";
import SystemActor from "./documents/actor.mjs";
import SystemItem from "./documents/item.mjs";
import SystemActorSheet from "./sheets/actor-sheet.mjs";
import SystemItemSheet from "./sheets/item-sheet.mjs";

Hooks.once("init", async () => {
  console.log(`${SYSTEM.id} | Initializing`);

  // Expose the static config so other packages and macros can read it: CONFIG.__PREFIX__.abilities
  CONFIG.__PREFIX__ = SYSTEM;

  // Document classes. Keep them thin; most logic belongs in the data models.
  CONFIG.Actor.documentClass = SystemActor;
  CONFIG.Item.documentClass = SystemItem;

  // Data models. The keys must match the sub-types declared under "documentTypes" in system.json.
  // (template.json still loads in v14 but is deprecated, removal is planned for v16: this system does not use it.)
  CONFIG.Actor.dataModels = {
    character: dataModels.CharacterData,
    npc: dataModels.NPCData
  };
  CONFIG.Item.dataModels = {
    item: dataModels.ItemData,
    feature: dataModels.FeatureData
  };

  // Sheets. `types` limits a sheet to some sub-types; `label` is what players see in the sheet configuration.
  const { DocumentSheetConfig } = foundry.applications.apps;
  DocumentSheetConfig.registerSheet(foundry.documents.Actor, SYSTEM.id, SystemActorSheet, {
    types: ["character", "npc"],
    makeDefault: true,
    label: "__PREFIX__.Sheets.Actor"
  });
  DocumentSheetConfig.registerSheet(foundry.documents.Item, SYSTEM.id, SystemItemSheet, {
    types: ["item", "feature"],
    makeDefault: true,
    label: "__PREFIX__.Sheets.Item"
  });

  // Preload every template so that partials can be included with {{> "path"}} and sheets render without a fetch.
  // (Template parts listed in an ApplicationV2's PARTS are loaded automatically; partials must be preloaded.)
  await foundry.applications.handlebars.loadTemplates([
    "systems/__ID__/templates/actor/item-row.hbs"
  ]);
});

Hooks.once("ready", () => {
  // The world is fully loaded: game.actors, game.settings, game.user etc. are available.
  console.log(`${SYSTEM.id} | Ready`);
});
