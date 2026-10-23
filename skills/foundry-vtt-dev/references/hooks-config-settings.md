# Runtime foundations: init sequence, hooks, CONFIG, game, settings, sockets (Foundry v14)

Verified against Foundry v14 build 369 source (`client/game.mjs`, `client/hooks.mjs`, `client/config.mjs`,
`client/helpers/*`) and the SWADE system (v14-verified). Where v13 differs it is flagged **[v13]**.

## Table of contents
1. [Obsolete patterns and their replacements](#1-obsolete-patterns-and-their-replacements)
2. [Globals that still exist in v14](#2-globals-that-still-exist-in-v14)
3. [Init sequence and what exists when](#3-init-sequence-and-what-exists-when)
4. [Hooks API](#4-hooks-api)
5. [Hook catalogue with signatures](#5-hook-catalogue-with-signatures)
6. [CONFIG](#6-config)
7. [The game object](#7-the-game-object)
8. [Settings](#8-settings)
9. [Keybindings](#9-keybindings)
10. [Sockets and user queries](#10-sockets-and-user-queries)
11. [Text enrichers](#11-text-enrichers)
12. [Templates, Handlebars, i18n](#12-templates-handlebars-i18n)
13. [Module etiquette: libWrapper, flags, utils, module API](#13-module-etiquette)
14. [v13 vs v14 cheat sheet](#14-v13-vs-v14-cheat-sheet)
15. [Verify-in-source pointers](#15-verify-in-source-pointers)

---

## 1. Obsolete patterns and their replacements

Models trained on pre-v13 code produce these. All of them are wrong or deprecated in v14.

| Obsolete (do NOT write) | Modern replacement |
|---|---|
| `Hooks.on("renderChatMessage", (msg, html) => html.find(".x"))` | `Hooks.on("renderChatMessageHTML", (message, html, context) => html.querySelector(".x"))`. `html` is an `HTMLElement`, not jQuery. The old hook is only shimmed until v15 and logs a warning. |
| `Hooks.on("renderActorSheet", (app, html, data) => html.find(...))` (jQuery) | AppV2 render hooks pass `(app, element: HTMLElement, context, options)` and are named after each class in the chain: `renderActorSheetV2`, `renderDocumentSheetV2`, `renderApplicationV2`, `renderMySheetClassName`. jQuery only survives for ApplicationV1. |
| `getSceneControlButtons` with `controls.find(c => c.name === "token")` and `tools.push({...})` | `controls` is a **Record** keyed by control name: `controls.tokens.tools.myTool = {...}`. See 5.7. |
| `getActorDirectoryEntryContext` / `getActorSheetHeaderButtons` / `{name, callback, condition}` menu entries | `getActorContextOptions(app, entries)` with `{label, icon, onClick(event, target), visible(target)}`. `name`/`callback`/`condition` log compat warnings. Sheet header buttons: `getHeaderControlsApplicationV2`. |
| `game.settings.register(ns, key, {config: true, ...})` with no `scope` | Always give `scope`. **A missing/invalid scope silently becomes `"client"`** (localStorage), so a "world" setting you forgot to scope is per-browser. Also give a `type` (prefer a DataField instance). |
| `type: Number, range: {min,max,step}` / `type: String, choices:{}` | Still work, but prefer `type: new foundry.data.fields.NumberField({min, max, step, integer: true})` / `new StringField({choices})`: the form input is derived from the field. |
| `game.settings.get("core", "rollMode")`, `CONST.DICE_ROLL_MODES`, `CONFIG.Dice.rollModes` | `game.settings.get("core", "messageMode")`, `CONFIG.ChatMessage.modes` (keys `public gm blind self ic`). See dice-chat-combat.md. |
| `mergeObject(...)`, `duplicate()`, `getProperty()`, `setProperty()`, `randomID()`, `isNewerVersion()`, `expandObject()`, `flattenObject()` as bare globals | `foundry.utils.mergeObject(...)` etc. The bare globals are gone. |
| `loadTemplates()`, `renderTemplate()`, `getTemplate()` as globals | `foundry.applications.handlebars.loadTemplates / renderTemplate / getTemplate` |
| `class X extends Application / FormApplication / Dialog / DocumentSheet` (globals) | `foundry.applications.api.ApplicationV2` (+ `HandlebarsApplicationMixin`), `DialogV2`, `DocumentSheetV2`. The old globals are ApplicationV1 aliases deprecated until v16. |
| `Token`, `Wall`, `Canvas`, `TokenLayer`, `Ruler`, `PlaceableObject`, `ActorSheet`, `ItemSheet` as bare globals | `foundry.canvas.placeables.Token`, `foundry.canvas.Canvas`, `foundry.canvas.layers.TokenLayer`, `foundry.applications.sheets.ActorSheet` (= `ActorSheetV2`)... Use `foundry.*` paths in every new file. |
| `game.data.version`, `game.version` string comparisons | `game.release.generation` (integer major, 14), `game.release.build`, `foundry.utils.isNewerVersion(game.version, "14.0")` |
| `Hooks.on("canvasReady", () => false)` or any handler returning `false` from `canvasReady`/`ready` | `canvasReady` is fired with `Hooks.call` (see 4.2). Returning `false` skips the remaining handlers. Never return `false` from lifecycle hooks. |
| `async` handler on a cancelable hook (`preUpdateActor`, `hotbarDrop`, `dropCanvasData`, `chatMessage`, `preMoveToken`) | Hooks are never awaited. An `async` function returns a Promise, not `false`, so it cannot cancel. Decide synchronously, then start async work and return `false`. |
| `TextEditor.enrichHTML(text, {async: true})` | Always async, no option. `await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {rollData, relativeTo, secrets})` |
| `CONFIG.Token.layerClass`, `CONFIG.AmbientLight.layerClass`... | Deprecated v14: `CONFIG.Canvas.layers.tokens.layerClass` (keys: `tokens regions drawings tiles walls sounds lighting notes controls grid weather`) |
| MeasuredTemplate documents / `CONFIG.MeasuredTemplate`, `canvas.templates` | **Deprecated v14.** Use Regions: `canvas.regions.placeRegion(...)`. See canvas.md. |
| `localize` via `game.i18n.localize(key)` | Still valid. v14 adds the shortcut global `_loc(key, data)` (same function; `game.i18n.format` is an alias too). Use `game.i18n.localize` if you also support v13. |

---

## 2. Globals that still exist in v14

From `client/client.mjs` (`Object.assign(globalThis, ...)`):

- Namespaces/singletons: `foundry`, `CONST`, `CONFIG`, `game`, `ui`, `canvas`, `Hooks`, `_loc`, `_del`, `_replace`, `logger`, `vtt`, `animejs`
- Document classes (the *base* classes, not necessarily the system override): `Actor`, `ActorDelta`, `ActiveEffect`, `Adventure`, `AmbientLightDocument`, `AmbientSoundDocument`, `Card`, `Cards`, `ChatMessage`, `Combat`, `Combatant`, `CombatantGroup`, `DrawingDocument`, `FogExploration`, `Folder`, `Item`, `JournalEntry`, `JournalEntryCategory`, `JournalEntryPage`, `Level`, `Macro`, `NoteDocument`, `Playlist`, `PlaylistSound`, `RegionBehavior`, `RegionDocument`, `RollTable`, `Scene`, `Setting`, `TableResult`, `TileDocument`, `TokenDocument`, `User`, `WallDocument`
- Helpers: `Color`, `Collection`, `fromUuid`, `fromUuidSync`, `getDocumentClass`, `Roll`, `TextEditor`, `ProseMirror`
- Deprecated until v16: `Application`, `Dialog`, `FormApplication`, `DocumentSheet`

Everything else is namespaced. In modules prefer `getDocumentClass("ChatMessage")` / `CONFIG.ChatMessage.documentClass` over the bare global so a system's subclass is honoured. `Roll.create(formula)` honours `CONFIG.Dice.rolls[0]`; `new Roll()` does not.

---

## 3. Init sequence and what exists when

Source: `Game#initialize` and `Game#setupGame` in `client/game.mjs`, `Localization#initialize`.

```
(your esmodules/scripts execute; register Hooks.once handlers at top level)
Hooks "init"
   -> core settings registered
   -> game.i18n.initialize()  (loads translations, localizes DataModel schemas)  -> Hooks "i18nInit"
   -> setupGame():
        game.permissions, game.time, initializeConfig()
        game.packs  (initializePacks)
        game.actors/items/scenes/... + prepareData() on EVERY world document   <- before "setup"!
   Hooks "setup"
   -> RTC, mouse, gamepad, keyboard (game.keybindings.initialize())
   -> Hooks "initializeDynamicTokenRingConfig", "initializeCombatConfiguration"
   -> canvas init starts in parallel with UI init:
        Hooks "canvasConfig" -> "canvasInit" -> ... draw ... -> "canvasReady"
        initializeUI(): CONFIG.ui classes instantiated, ui.* exist, first renders
   -> DocumentSheetConfig.initializeSheets() (pending sheet registrations applied)
   -> documentIndex.index(), await canvas
   -> game.ready = true, socket listeners activated
   Hooks "ready"
```

Consequences:

| Stage | Available | NOT available |
|---|---|---|
| top level of script | `Hooks`, `CONFIG`, `CONST`, `foundry` | `game.settings` etc. (game is a stub `{view}`) |
| `init` | `game.system`, `game.modules`, `game.world`, `game.model`, `game.documentTypes`, `game.userId`, `game.settings` (register; client-scope get), `game.keybindings` (register), `game.socket`, `game.release`, `CONFIG` (all of it), `game.i18n` object | **translations** (localize returns the key), `game.user`, `game.users`, `game.actors`, `game.packs`, `game.time`, `canvas.scene`, `ui.*` instances |
| `i18nInit` | translations loaded, `game.i18n.localize` works | documents, `game.user` |
| `setup` | `game.user`, `game.users`, all world collections (`game.actors`, `game.items`, `game.scenes`, `game.combats`...), `game.packs`, `game.time`, `game.settings.get` for world/user scope, keybindings registered (editable) | `ui.*` apps, `canvas.ready`, `game.ready === false` |
| `canvasInit` / `canvasReady` | `canvas.scene`, `canvas.tokens`, `canvas.grid`, `canvas.dimensions`. Fire *before* `ready` on first load, and again on every scene switch | `game.ready` is still false on the first `canvasReady` |
| `ready` | everything, `game.ready === true`, `game.settings.set` for world/user scope, `game.users.activeGM`, `ui.*` | |

Key traps:
- **Register everything that data preparation depends on in `init`** (`CONFIG.*.documentClass`, `dataModels`, status effects, `trackableAttributes`, Handlebars helpers, settings you read in `prepareData`). Actors are already prepared when `setup` fires, and DataModels are localized right after `init`.
- **Never read `game.user` / `game.actors` in `init`.** Use `game.userId` if you only need the id.
- `game.settings.set` of a world/user setting throws before `ready` ("You may not set a World-level Setting before the Game is ready").
- `canvas` is a global from the start, but `canvas.ready` is false until `canvasReady`. Always guard: `if (!canvas.ready) return;`.
- If the canvas is disabled (`core.noCanvas`), do not assume `canvasReady` ever fires; keep non-canvas logic in `ready`.

### Where to register what

| Thing | Where | API |
|---|---|---|
| Document classes, DataModels, `CONFIG.MYSYS`, status effects, trackable attributes, dice classes/terms, `CONFIG.ui.*`, canvas layers, token ruler/HUD classes | `init` | `CONFIG.Actor.documentClass = MyActor; CONFIG.Actor.dataModels = {...}` |
| Sheets | `init` (applied at setup end) | `foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "my-sys", MyActorSheet, {types: ["character"], makeDefault: true, label: "MYSYS.Sheet.Actor"})`; unregister core: `DocumentSheetConfig.unregisterSheet(Actor, "core", foundry.applications.sheets.ActorSheet)` |
| Settings, settings menus | `init` | `game.settings.register`, `registerMenu` |
| Keybindings | `init` (throws after `game.keybindings.initialize()` runs in `setupGame`) | `game.keybindings.register` |
| Handlebars helpers / partials, `loadTemplates` | `init` | `Handlebars.registerHelper`, `foundry.applications.handlebars.loadTemplates` |
| Text enrichers | `init` | `CONFIG.TextEditor.enrichers.push({...})` |
| CONFIG.queries | `init` | `CONFIG.queries["my-sys.thing"] = async (data, ctx) => ...` |
| Socket listeners | `init` or `ready` | `game.socket.on("system.my-sys", handler)` |
| Region behavior types, chat commands | `init` | `CONFIG.RegionBehavior.dataModels[...]`, `ChatLog.CHAT_COMMANDS` |
| Things needing documents/canvas (migrations, welcome message, compendium art, `game.modules.get(id).api = {}`) | `setup` / `ready` | |
| One-time per-scene canvas work | `canvasReady` | |

Minimal system entry skeleton:

```js
// module/my-system.mjs   (system.json: "esmodules": ["module/my-system.mjs"])
import { MYSYS } from "./config.mjs";
import { MyActor } from "./documents/actor.mjs";
import { CharacterData } from "./data/character.mjs";
import { MyActorSheet } from "./sheets/actor-sheet.mjs";

Hooks.once("init", () => {
  CONFIG.MYSYS = MYSYS;                       // system-owned config; keep your constants here
  game.mysys = { rollAttack, migrate };       // optional public API for macros
  CONFIG.Actor.documentClass = MyActor;
  CONFIG.Actor.dataModels = { character: CharacterData };
  CONFIG.Combat.initiative = { formula: "1d20 + @attributes.init", decimals: 2 };
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "mysys", MyActorSheet, {
    types: ["character"], makeDefault: true, label: "MYSYS.SheetActor"
  });
  registerSettings();
  registerKeybindings();
  foundry.applications.handlebars.loadTemplates(["systems/mysys/templates/parts/stat.hbs"]);
});

Hooks.once("setup", () => { /* documents exist, user exists */ });
Hooks.once("ready", () => { if (game.user.isGM) checkMigration(); });
```

---

## 4. Hooks API

Source: `client/helpers/hooks.mjs` (global `Hooks` = `foundry.helpers.Hooks`).

```js
const id = Hooks.on("updateActor", fn);          // returns numeric id
Hooks.once("ready", fn);                          // = Hooks.on(hook, fn, {once: true}); removed BEFORE it runs
Hooks.off("updateActor", id);                     // by id (preferred) or by function reference
Hooks.callAll("my-sys.thing", a, b);              // run every listener; return values ignored
const ok = Hooks.call("my-sys.preThing", a, b);   // stops at first listener returning === false; ok = false then
```

### 4.1 Semantics
- Listeners run in registration order. Exceptions are caught and logged (`Error thrown in hooked function...`), the remaining listeners still run.
- Only a strict `false` cancels, and only for hooks that core fires with `Hooks.call`. Hooks are **never awaited**.
- `Hooks.on` with an arrow function you cannot later remove by reference unless you keep it; keep the id.
- `CONFIG.debug.hooks = true` logs every hook call with its args. Use it to discover hook names and argument order empirically.
- `Hooks.onError(location, error, {msg, log, notify, data})` fires the `error` hook; use it to report errors the core way.

### 4.2 Which hooks can be cancelled (fired with `Hooks.call`)
Found by grepping `Hooks.call(` in the client source: `preCreate<Doc>`, `preUpdate<Doc>`, `preDelete<Doc>`, `preMoveToken`, `chatMessage`, `hotbarDrop`, `dropCanvasData`, `dropActorSheetData`, `dropItemSheetData`, `dropRollTableSheetData`, `paste<PlaceableName>`, `modifyTokenAttribute`, `activateNote`, `chatBubbleHTML`, `hotReload`, `dealCards/passCards/returnCards`, `preImportAdventure`, `configureCanvasEnvironment`, and (gotcha) **`canvasReady`**.
Everything else (`render*`, `update*`, `create*`, `delete*`, `controlToken`, `targetToken`, `combatTurnChange`, `ready`, ...) is `callAll`; return values are ignored.

### 4.3 Hook naming rules
- Document hooks substitute the Document name: `preCreateActor`, `updateItem`, `deleteCombatant`, `createChatMessage`, `updateToken`, `createActiveEffect`. **Embedded documents fire the same hook** (`createItem` fires for world Items and for Items embedded in Actors; check `doc.parent`).
- `pre*` hooks run only on the client that initiated the operation. Post hooks (`create/update/delete`) run on **every** client after the server applied it. Guard side effects: `if (game.user.id !== userId) return;` (the initiator) or `if (!game.user.isActiveGM) return;` (one GM).
- ApplicationV2 hooks: `preRender<Class>`, `render<Class>`, `close<Class>`, `getHeaderControls<Class>` for **every class in the inheritance chain** (e.g. `renderMyActorSheet`, `renderActorSheetV2`, `renderDocumentSheetV2`, `renderApplicationV2`).
- Canvas hooks: `draw<Layer class name>` (`drawTokenLayer`, `drawGridLayer`), `activate<...>Layer`, `tearDown<...>Layer`. Class names are *singular* (`TokenLayer`, not `TokensLayer`, despite the typedef text in `hooks.mjs`). Placeables: `drawToken`, `refreshToken`, `destroyToken`, `controlToken`, `hoverToken`, `pasteToken`.
- Context-menu hooks: `get<Doc>ContextOptions` for sidebar directories, plus `getChatMessageContextOptions`, `getFolderContextOptions`, `getCombatContextOptions`, `getCompendiumContextOptions`, `getMacroContextOptions` (hotbar), `getUserContextOptions` (players list), `getSceneContextOptions` (navigation), `getJournalEntryPageContextOptions`, `get<Doc>PlaceableContextOptions`. Other apps default to `get<ClassName>ContextOptions`.
- Custom hooks: prefix with your id: `Hooks.callAll("mysys.rollComplete", actor, roll)`; use `Hooks.call("mysys.preRoll", ...)` when you want listeners to be able to veto.

---

## 5. Hook catalogue with signatures

Signatures copied from `client/hooks.mjs` (v14). Not exhaustive; grep that file for the rest.

### 5.1 Lifecycle and game

| Hook | Args | Notes |
|---|---|---|
| `init`, `i18nInit`, `setup`, `ready` | none | See section 3 |
| `canvasConfig` | `(config)` | before PIXI.Application is constructed; mutate renderer config |
| `canvasInit` | `(canvas)` | |
| `canvasReady` | `(canvas)` | `Hooks.call`: never return false |
| `canvasDraw` / `canvasTearDown` | `(canvas)` / `(canvas, options)` | |
| `canvasPan` | `(canvas, position)` | |
| `pauseGame` | `(paused, {broadcast, userId})` | |
| `updateWorldTime` | `(worldTime, dt, options, userId)` | |
| `userConnected` | `(user, connected)` | |
| `clientSettingChanged` | `(key, value, options)` | client-scope settings only |
| `hotReload` | `(data)` | return false to handle it yourself |
| `error` | `(location, error, data)` | |
| `initializeDynamicTokenRingConfig`, `initializeCombatConfiguration` | `(config)` | register custom ring/turn-marker presets |

### 5.2 Document hooks (generic, substitute the name)

```js
Hooks.on("preCreateItem", (item, data, options, userId) => {   // initiator only; return false cancels
  item.updateSource({ "system.quantity": 1 });                  // mutate via updateSource, not item.update
});
Hooks.on("createItem",   (item, options, userId) => {});        // all clients
Hooks.on("preUpdateActor", (actor, changed, options, userId) => {   // `changed` is the diff; mutate it freely
  if (foundry.utils.hasProperty(changed, "system.hp.value")) { /* clamp */ }
});
Hooks.on("updateActor",  (actor, changed, options, userId) => {});
Hooks.on("preDeleteItem",(item, options, userId) => {});
Hooks.on("deleteItem",   (item, options, userId) => {});
```
`options` carries operation flags you can set in `update(data, {myFlag: true})` and read in the hooks (`options.myFlag`) to prevent loops. `game.user.id === userId` tells you whether you initiated it.

Token movement (v13+, fully used in v14):
- `preMoveToken(tokenDocument, movement, operation)` initiator only, return false to block. Only `movement.autoRotate` and `movement.showRuler` are writable.
- `moveToken(tokenDocument, movement, operation, user)` all clients. `pauseToken`, `stopToken`, `planToken`, `recordToken(tokenDocument)`.
- `preUpdateToken` still fires for x/y changes but movement logic lives in the movement API (see canvas.md).

### 5.3 Render and application hooks

```js
Hooks.on("renderChatMessageHTML", (message, html, context) => {});           // html: HTMLElement
Hooks.on("renderActorSheetV2",    (app, element, context, options) => {});   // every AppV2 actor sheet
Hooks.on("renderSettingsConfig",  (app, element, context, options) => {});   // inject into Configure Settings
Hooks.on("getHeaderControlsApplicationV2", (app, controls) => {              // controls: [{icon,label,action,visible,onClick}]
  if (app.document?.documentName === "Actor") controls.push({ icon: "fa-solid fa-bolt", label: "MYSYS.Quick", action: "quick", onClick: () => {} });
});
Hooks.on("renderTokenHUD", (hud, element, context, options) => {});
```
The 3rd arg `context` is the object `_prepareContext` returned. The element is already populated but not yet attached on first render; add listeners with `element.querySelector(...)?.addEventListener(...)`. For a re-rendering sheet put listeners in `_onRender` of your own class instead; render hooks run on every re-render so guard against double-binding.

### 5.4 Chat hooks

| Hook | Args | Notes |
|---|---|---|
| `renderChatMessageHTML` | `(message, html, context?)` | `context` only present for the core template; customizing roll cards happens here |
| `chatMessage` | `(chatLog, text, {user, speaker})` | `Hooks.call`: return false to swallow a typed message (custom slash commands). Sync only. |
| `preCreateChatMessage` / `createChatMessage` / `updateChatMessage` / `deleteChatMessage` | generic document signatures | |
| `chatInput` | `(event, options)` | keystroke level |
| `getChatMessageContextOptions` | `(chatLog, entries)` | add right-click entries |
| `chatBubbleHTML` | `(token, html, text, options)` | |

### 5.5 Combat hooks

| Hook | Args | When |
|---|---|---|
| `combatStart` | `(combat, updateData{round,turn})` | initiating client, before DB update; `updateData` mutable |
| `combatRound` | `(combat, updateData, updateOptions{direction,worldTime})` | initiating client, before update |
| `combatTurn` | `(combat, updateData, updateOptions)` | initiating client, before update |
| `combatTurnChange` | `(combat, prior, current)` | **all clients, after update**, only if started. `prior/current = {round, turn, combatantId, tokenId}` |
| `createCombat`, `updateCombat(combat, changed, options, userId)`, `deleteCombat` | generic | `changed.round`, `changed.turn` |
| `createCombatant`, `updateCombatant`, `deleteCombatant` | generic | `updateCombatant` for initiative changes |
| `initializeCombatConfiguration` | `(CONFIG.Combat.settings)` | turn marker presets |

For per-turn game logic prefer overriding `Combat#_onStartTurn / _onEndTurn / _onStartRound / _onEndRound` (run on one designated GM after the update) instead of listening to `combatTurnChange` on every client. See dice-chat-combat.md.

### 5.6 Canvas and token hooks

| Hook | Args |
|---|---|
| `controlToken` | `(token, controlled)` (placeable) |
| `targetToken` | `(user, token, targeted)` |
| `hoverToken` | `(token, hovered)` |
| `drawToken`, `refreshToken`, `destroyToken` | `(token[, flags])` |
| `applyTokenStatusEffect` | `(token, statusId, active)` |
| `modifyTokenAttribute` | `({attribute, value, isDelta, isBar}, updates, actor)` cancelable |
| `dropCanvasData` | `(canvas, data{x,y,type,uuid,...}, event)` cancelable. Return false after handling the drop yourself |
| `activateTokenLayer` etc. | `(layer)` |
| `initializeLightSources`, `initializeVisionSources`, `lightingRefresh`, `sightRefresh`, `visibilityRefresh` | perception pipeline |
| `activateNote` | `(note, options)` cancelable |

### 5.7 Scene controls (v13+ object shape)

```js
Hooks.on("getSceneControlButtons", (controls) => {   // controls: Record<string, SceneControl>
  // add a tool to an existing control (keys: tokens regions drawings tiles walls lighting sounds notes)
  controls.tokens.tools.mysysRoll = {
    name: "mysysRoll",                     // must equal the key
    title: "MYSYS.Controls.Roll",          // localization key
    icon: "fa-solid fa-dice-d20",
    order: Object.keys(controls.tokens.tools).length,
    button: true,                          // fires onChange once, never becomes the active tool
    visible: game.user.isGM,
    onChange: (event, active) => new MyRollDialog().render({ force: true })
  };
  // or a toggle:   toggle: true, active: false, onChange: (event, active) => {...}
  // a full new control group:
  controls.mysys = {
    name: "mysys", order: 20, title: "MYSYS.Controls.Group", icon: "fa-solid fa-dragon",
    activeTool: "inspect",
    onChange: (event, active) => { if (active) canvas.mysysLayer?.activate(); },   // layer optional
    tools: { inspect: { name: "inspect", order: 0, title: "MYSYS.Inspect", icon: "fa-solid fa-magnifying-glass" } }
  };
});
```
`button` and `toggle` are mutually exclusive. `visible: false` removes a tool. The old array form (`controls.push`, `control.tools.push`, `onClick`) is gone. Extra built-in tool keys can be edited in place (SWADE adds `controls.regions.tools.*` and shifts `.order`). Call `ui.controls.render({reset: true})` to rebuild after changing conditions.

### 5.8 Sheets, drops, hotbar

```js
Hooks.on("hotbarDrop", (hotbar, data, slot) => {          // data = {type:"Item", uuid:...}
  if (data.type !== "Item") return;                       // returning undefined lets core handle it
  createItemMacro(data, slot);                            // async work is fine to START...
  return false;                                           // ...but you must return false synchronously
});
Hooks.on("dropActorSheetData", (actor, sheet, data) => {  // cancelable: return false if you consumed the drop
  if (data.type === "Folder") { handleFolderDrop(actor, data); return false; }
});
```
Also `dropItemSheetData(item, sheet, data)` and `dropRollTableSheetData(table, sheet, data)` (fired by the sheets; `dropItemSheetData` is not in the `hooks.mjs` typedef file but is fired by `item-sheet.mjs`).

```js
// Context menus (sidebar directory). entries: ContextMenuEntry[], mutate in place.
Hooks.on("getActorContextOptions", (app, entries) => {
  if (app instanceof foundry.applications.sidebar.apps.Compendium) return;  // this hook also fires for compendium actors
  entries.push({
    label: "MYSYS.Summarize", icon: "fa-solid fa-scroll",          // class string or full HTML
    visible: (li) => game.actors.get(li.dataset.entryId)?.isOwner, // li is HTMLElement
    onClick: (event, li) => summarize(game.actors.get(li.dataset.entryId))
  });
});
```

### 5.9 Settings and other

`renderSettingsConfig(app, element)` to add buttons/notes to the settings window; `renderSettings` (sidebar tab) to add buttons to the Settings tab; `updateCompendium(pack, docs, options, userId)`; `createProseMirrorEditor(uuid, plugins, options)`, `getProseMirrorMenuItems(menu, items)`; `applyActiveEffect(actor, change, current, delta, changes)` for custom change keys; `userConnected`; `pauseGame`.

---

## 6. CONFIG

`CONFIG` is a mutable per-session object (`client/config.mjs`). Mutate in `init`. Locked after startup: `CONFIG.Combat.settings`, `CONFIG.Token.ring` (properties cannot be replaced; mutate their content).

### 6.1 Document configuration (same shape for most documents)

```js
CONFIG.Actor.documentClass = MyActor;                    // class used for ALL new Actor instances
CONFIG.Actor.dataModels = { character: CharacterData, npc: NpcData };   // TypeDataModel per sub-type
CONFIG.Actor.typeLabels = { character: "MYSYS.Types.character" };       // else default TYPES.Actor.<type>
CONFIG.Actor.typeIcons  = { character: "fa-solid fa-user" };
CONFIG.Actor.trackableAttributes = {                     // token bar choices, per actor type, paths under actor.system
  character: { bar: ["attributes.hp"], value: ["attributes.ac"] }
};                                                       // if empty, inferred from the DataModel schema
CONFIG.Actor.compendiumIndexFields.push("system.level"); // extra fields kept in pack indexes
CONFIG.Item.documentClass = MyItem; CONFIG.Item.dataModels = {...};
```
The same `documentClass` / `dataModels` / `typeLabels` / `typeIcons` / `typeHints` pattern exists on `CONFIG.Item`, `Cards`, `Card`, `ChatMessage`, `Combat`, `Combatant`, `CombatantGroup`, `JournalEntryPage`, `ActiveEffect` (default `dataModels.base`), `RegionBehavior`, `Region`... (confirm in `config.mjs`). Declared sub-types must also be listed in the manifest (`documentTypes` or `template.json`; see manifest/data-model reference).

### 6.2 Important keys

| Key | Purpose |
|---|---|
| `CONFIG.Combat.initiative = {formula, decimals}` | Default initiative formula (overrides the manifest `initiative`); `decimals` = display precision in the Combat Tracker only (scores are stored unrounded). `Combatant#_getInitiativeFormula` = `CONFIG.Combat.initiative.formula \|\| game.system.initiative`. |
| `CONFIG.Combat.settings` | Locked `CombatConfiguration` (tracked resource, skip defeated, turn markers). Use hook `initializeCombatConfiguration`. |
| `CONFIG.Combat.sounds`, `initiativeIcon` | combat tracker audio/icon |
| `CONFIG.time.roundTime / turnTime` | seconds of world time per round/turn (SWADE: `roundTime = 6`) |
| `CONFIG.Dice.rolls` (array) | Roll classes. `[0]` is `Roll.defaultImplementation`; all must be registered so chat messages can deserialize them (`fromData` looks up `data.class`). `unshift` to make yours the default, `push` for extras. |
| `CONFIG.Dice.terms` / `CONFIG.Dice.types` | denomination letter -> DiceTerm class (`d`, `c`, `f` built in); array of die types |
| `CONFIG.Dice.functions` | custom functions usable in formulas: `CONFIG.Dice.functions.cap = (v, max) => Math.min(v, max)` then `cap(@x, 5)` |
| `CONFIG.Dice.randomUniform`, `parser`, `fulfillment` | RNG, grammar parser, manual-fulfillment config |
| `CONFIG.ChatMessage.template / modes / batchSize / documentClass / dataModels` | chat card template path, message visibility modes, typed messages |
| `CONFIG.statusEffects` | Proxy-array of `{id, name, img, ...}`, also indexable by id (`CONFIG.statusEffects.dead`). Assigning an array/object still works in v14 (SWADE does `CONFIG.statusEffects = deepClone(...)`), the accessor is annotated deprecated; mutating in place (`.push`, `.length = 0`) is safest. `name`/`img` replace `label`/`icon`. `hud: false` or `{actorTypes}` hides from the Token HUD. |
| `CONFIG.specialStatusEffects` | `{DEFEATED:"dead", INVISIBLE, BLIND, BURROW, HOVER, FLY}` ids with built-in mechanics |
| `CONFIG.ActiveEffect` | `documentClass`, `dataModels` (must define `changes` with numeric `priority`, string `type`, `phase`), `changeTypes`, `phases`, `expiryEvents`, `expiryAction` ("update" or "delete") **v14 reworked effects; see the documents reference.** |
| `CONFIG.Token` | `documentClass`, `objectClass`, `rulerClass`, `hudClass`, `prototypeSheetClass`, `movement.{actions,defaultAction,defaultSpeed,costAggregator,TerrainData}`, `barConfig`, `ring` |
| `CONFIG.Canvas` | `layers` (custom layers), `groups`, `rulerClass`, `visionModes`, `detectionModes`, `lightAnimations`, `gridStyles`, `pings` |
| `CONFIG.ui` | UI class overrides: `CONFIG.ui.combat = MyCombatTracker; CONFIG.ui.chat = MyChatLog; CONFIG.ui.actors`, `hotbar`, `players`, `controls`... instantiated in `initializeUI()` so set in `init` |
| `CONFIG.ux` | helper overrides: `TextEditor`, `ContextMenu`, `DragDrop`, `FilePicker`, `Autocomplete`, `TooltipManager` |
| `CONFIG.TextEditor.enrichers / inserts / engines` | See section 11 |
| `CONFIG.queries` | user query handlers (section 10) |
| `CONFIG.sounds` | `dice`, `lock`, `notification`, `combat` sound paths |
| `CONFIG.compendium.uuidRedirects` | remap moved UUIDs (before `ready`) |
| `CONFIG.i18n`, `CONFIG.supportedLanguages`, `CONFIG.fontDefinitions`, `CONFIG.cursors`, `CONFIG.formulaEditor.contexts` | misc |
| `CONFIG.debug.*` | booleans: `hooks dice combat documents i18n queries rollParsing keybindings applications audio av canvas...`. Set from the console while developing. |
| `CONFIG.compatibility` | `{mode, includePatterns, excludePatterns}` to filter deprecation warnings (`CONST.COMPATIBILITY_MODES`) |

### 6.3 System-owned config object

Convention (used by dnd5e = `CONFIG.DND5E`, SWADE = `CONFIG.SWADE`): put all system constants, label maps, and registries in one exported object and attach it:

```js
// config.mjs
export const MYSYS = {
  abilities: { str: { label: "MYSYS.Ability.str", abbr: "MYSYS.Ability.strAbbr" } },
  damageTypes: { fire: { label: "MYSYS.Damage.fire", icon: "icons/magic/fire/flame-burning.webp" } },
  statusEffects: [{ id: "stunned", name: "MYSYS.Status.stunned", img: "icons/svg/daze.svg" }],
  ASCII: ""
};
// in init:  CONFIG.MYSYS = MYSYS;  foundry.utils.deepFreeze(CONFIG.MYSYS.CONST)   (optional)
```
Why: other packages can extend `CONFIG.MYSYS.damageTypes` in their own `init`; templates can reference via a helper; no collisions with core keys. Label values are localization keys, localized at render time (`game.i18n.localize(label)`), never at definition time (translations do not exist in `init`).

---

## 7. The game object

Essentials (`client/game.mjs`):

```js
game.system.id; game.system.title; game.system.version; game.system.flags; game.system.initiative  // manifest initiative formula
game.world.id; game.world.title
game.release.generation  // 14  (integer, use for version branches)
game.release.build       // 369
game.version             // "14.369"  -> foundry.utils.isNewerVersion(game.version, "14.0")
game.modules.get("my-mod")?.active          // Module object; .active only true if enabled in this world
game.modules.get("my-mod").api = { doThing } // convention for a public module API (not a built-in field)
game.user                // current User (null before setup); game.userId always set
game.user.isGM; game.user.isActiveGM; game.user.can("TOKEN_CREATE"); game.user.hasPermission("QUERY_USER")
game.users; game.users.activeGM; game.users.players; game.users.getDesignatedUser(u => u.active && u.can("TOKEN_CREATE"))
game.actors; game.items; game.scenes; game.journal; game.macros; game.messages; game.combats; game.folders;
game.tables; game.playlists; game.cards; game.collections   // WorldCollections (Collection subclasses): .get(id), .getName(name), .filter, .find
game.combat              // currently viewed Combat (or first active); game.combat?.combatant
game.packs               // CompendiumCollection map: game.packs.get("my-sys.items")
game.settings; game.keybindings; game.socket; game.i18n; game.time; game.audio; game.tooltip; game.webrtc
game.paused; game.togglePause(true, {broadcast: true})
game.ready               // true after "ready"
game.documentTypes       // {Actor: ["character","npc"], ...} sub-types the active world allows
game.model               // template.json defaults per type (legacy template system)
game.time.worldTime; await game.time.advance(60)   // seconds of world time
```

Lookup helpers: `await fromUuid("Actor.abc")` / `fromUuidSync(uuid)` (sync only for already-loaded docs; compendium docs return an index entry), `game.actors.get(id)`, `game.actors.getName("Bob")`, `actor.uuid`.
Permission checks: `doc.isOwner`, `doc.testUserPermission(user, "OWNER")`, `doc.canUserModify(user, "update")`.

---

## 8. Settings

Source: `client/helpers/client-settings.mjs`, `client/applications/settings/config.mjs`, `client/documents/setting.mjs`.

### 8.1 Scopes
| scope | storage | who can write | notes |
|---|---|---|---|
| `"client"` | browser localStorage | anyone, this device only | UI prefs, performance. `onChange` fires locally only. |
| `"world"` | Settings DB | needs `SETTINGS_MODIFY` permission (GM by default) | rules variants. Shown only to users who may modify. Players calling `set` get a permission error. |
| `"user"` | Settings DB with `user` id | that user | per-player preferences that follow the account across devices (dice skins, tutorial flags). Players can write their own. |

Before v13 only client/world existed; `"user"` is new since v13 **[v13+]**. For a v12-compatible package avoid it.

### 8.2 register

```js
const { fields } = foundry.data;

game.settings.register("mysys", "critRule", {
  name: "MYSYS.Settings.CritRule.Name",          // localization keys (plain strings also display)
  hint: "MYSYS.Settings.CritRule.Hint",
  scope: "world",                                // ALWAYS set (default silently = "client")
  config: true,                                  // show in Configure Settings (false = hidden, API-only storage)
  type: new fields.StringField({ required: true, blank: false, initial: "double",
    choices: { double: "MYSYS.Crit.double", max: "MYSYS.Crit.max" } }),   // renders a <select>
  requiresReload: true,                          // prompts reload; for world scope it reloads ALL clients via socket
  onChange: (value, options, userId) => { CONFIG.MYSYS.critRule = value; }   // all clients for world/user scope
});

game.settings.register("mysys", "maxDice", {
  name: "MYSYS.MaxDice", scope: "client", config: true,
  type: new fields.NumberField({ required: true, integer: true, min: 1, max: 20, step: 1, initial: 6 })  // min+max+step => range slider
});
game.settings.register("mysys", "showHints", {                    // checkbox
  name: "MYSYS.ShowHints", scope: "user", config: true, type: new fields.BooleanField({ initial: true })
});
game.settings.register("mysys", "chatImage", {                    // file picker
  name: "MYSYS.Banner", scope: "world", config: true, type: new fields.FilePathField({ categories: ["IMAGE"], blank: true })
});
game.settings.register("mysys", "state", { scope: "world", config: false, type: Object, default: {} });  // hidden blob
```

`type` accepts (validated at register time): a `DataField` instance (**preferred**: gives validation, defaults via `getInitialValue()`, and the config form input), a `DataModel` subclass (value is a model instance; `default` defaults to `{}`), or a function (`String`, `Number`, `Boolean`, `Array`, `Object`, or a constructor taking the stored value). Anything else throws. Legacy options still honoured by the config UI: `choices` (with `type: String/Number`), `range: {min, max, step}` (with `type: Number`), `filePicker: "image"|"audio"|"folder"|...`, `input` (custom form input factory for a DataField). `default` is required for non-field types, or the value is `null`.

DataModel-typed setting:

```js
class RulesData extends foundry.abstract.DataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    return { critRange: new f.NumberField({ integer: true, initial: 20 }), houseRules: new f.ArrayField(new f.StringField()) };
  }
}
game.settings.register("mysys", "rules", { scope: "world", config: false, type: RulesData });
const rules = game.settings.get("mysys", "rules");          // RulesData instance
await game.settings.set("mysys", "rules", { ...rules.toObject(), critRange: 19 });   // validated strictly
```

### 8.3 get / set

```js
game.settings.get("mysys", "critRule");                         // typed value; throws if not registered
game.settings.get("mysys", "critRule", { document: true });     // the Setting document
await game.settings.set("mysys", "critRule", "max");            // validated/cleaned via the type; JSON stored
game.settings.settings.get("mysys.critRule");                   // registered config (mutable: SWADE flips core defaults in setup)
```
- `set` on world/user settings is a database operation: needs `game.ready`, returns a Promise, triggers `onChange` on all clients.
- `set` on a client setting is synchronous inside, fires `onChange(value, options)` and hook `clientSettingChanged`.
- Reading world/user settings before `setup` is not supported; client settings can be read in `init`.
- Namespaces: use your package id as `namespace`. Settings of your *system* appear under the "System" category, modules under their title.

### 8.4 Submenus and GM-only settings

```js
game.settings.registerMenu("mysys", "advanced", {
  name: "MYSYS.Advanced.Name", label: "MYSYS.Advanced.Label", hint: "MYSYS.Advanced.Hint",
  icon: "fa-solid fa-sliders",
  type: AdvancedSettingsApp,        // ApplicationV2 subclass (or legacy FormApplication); instantiated with `new type()`
  restricted: true                  // only users with SETTINGS_MODIFY see/open it
});
```
Inside the menu app read/write with `game.settings.get/set` in a form handler.

Players need to change a world setting (or any GM-only data): do not call `set` from the player. Delegate to a GM client:

```js
// init
CONFIG.queries["mysys.setWorldSetting"] = async ({ key, value }, { user }) => {   // runs on the GM client
  if (!game.user.isGM) throw new Error("not a GM");
  if (!ALLOWED_KEYS.has(key)) throw new Error("forbidden");                        // validate! `user` is the asker
  return game.settings.set("mysys", key, value);
};
// player side
const gm = game.users.activeGM;
if (!gm) return ui.notifications.warn("MYSYS.NoGM", { localize: true });
await gm.query("mysys.setWorldSetting", { key: "critRule", value: "max" }, { timeout: 15_000 });
```

### 8.5 Config window tips
- Settings with `config: true` and `scope: "world"` are invisible to non-GMs automatically.
- Hide/disable settings dynamically with `Hooks.on("renderSettingsConfig", (app, el) => {...})` querying `[name="mysys.critRule"]`.
- Core setting ids you may read: `core.messageMode` (client), `core.time`, `core.permissions`, `core.sheetClasses`, `core.tokenAutoRotate`, `core.gridDiagonals`, `core.combatTrackerConfig`, `core.keybindings`.
- `core.rollMode` is deprecated (v14) in favour of `core.messageMode`.

---

## 9. Keybindings

```js
// init only (throws once game.keybindings.initialize() ran in setupGame)
const { MODIFIER_KEYS } = foundry.helpers.interaction.KeyboardManager;
game.keybindings.register("mysys", "quickRoll", {
  name: "MYSYS.Keys.QuickRoll", hint: "MYSYS.Keys.QuickRollHint",
  editable: [{ key: "KeyR", modifiers: [MODIFIER_KEYS.SHIFT] }],   // user can rebind; key = KeyboardEvent.code
  uneditable: [],                                                  // fixed extra bindings
  reservedModifiers: [MODIFIER_KEYS.ALT],                          // ALT may be held for a variant (ctx.isAlt) and can't be a binding
  precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,                  // PRIORITY | NORMAL | DEFERRED
  restricted: false,                                               // true = GM only
  repeat: false,
  onDown: (ctx) => {                                               // ctx: {key, isShift, isControl, isAlt, isMeta, event, ...}
    rollForControlled({ advantage: ctx.isAlt });
    return true;                                                   // true consumes the event
  },
  onUp: undefined
});
game.keybindings.get("mysys", "quickRoll");   // current bindings
```
Modifier strings are `"Control" | "Shift" | "Alt"` (use the `MODIFIER_KEYS` constants).

---

## 10. Sockets and user queries

### 10.1 Raw sockets
1. Manifest: `"socket": true` (system.json or module.json). Without it the server drops your events.
2. Event name must be exactly `system.<id>` or `module.<id>`. One event name per package; multiplex with a `type` field.
3. `game.socket.emit(name, payload)` broadcasts to **every other** connected client; **the sender never receives its own event**, so call the handler locally too.
4. Handlers receive exactly the emitted args. **No sender id is passed**: put `userId: game.user.id` in the payload (and do not trust it for permissions; re-check against `game.users.get(id)` or use queries).
5. Payload must be JSON-serializable. Send UUIDs, not documents.
6. An optional ack callback (`emit(name, payload, ackFn)`) only confirms the **server** received it, not that anyone handled it.

```js
const EVENT = "system.mysys";
Hooks.once("init", () => game.socket.on(EVENT, onSocket));

function emit(type, payload) { game.socket.emit(EVENT, { type, userId: game.user.id, payload }); }

async function onSocket({ type, userId, payload }) {
  if (!game.user.isActiveGM) return;                       // GM-executes pattern: exactly one GM acts
  switch (type) {
    case "applyDamage": {
      const actor = await fromUuid(payload.uuid);
      if (!actor) return;
      await actor.update({ "system.hp.value": Math.max(0, actor.system.hp.value - payload.amount) });
      break;
    }
  }
}

// player: ask the GM to do something players lack permission for
export function requestDamage(actor, amount) {
  if (game.user.isGM) return applyDamageLocal(actor, amount);   // emitter never hears itself
  emit("applyDamage", { uuid: actor.uuid, amount });
}
```
Pitfalls: if no GM is online nothing happens; there is no reply channel (use queries when you need a result); if several GMs are connected, filter with `game.user.isActiveGM` so only one acts; validate the request server-side-ish (is the requester an owner of that actor?).

### 10.2 Queries (preferred for request/response)
Verified in `client/documents/user.mjs`, `collections/users.mjs`, `config.mjs`.

```js
// register (init). Name MUST be prefixed with your package id; unprefixed names are reserved by core.
CONFIG.queries["mysys.rollForUser"] = async (queryData, { user, timeout }) => {   // runs on the TARGET client
  // `user` = the User who sent the query. Return JSON-serializable data; throw to reject.
  const roll = await new Roll(queryData.formula).evaluate();
  return roll.toJSON();
};

// call
const target = game.users.activeGM;                                    // or any active User
const result = await target.query("mysys.rollForUser", { formula: "1d20" }, { timeout: 30_000 });
// many at once -> Map<User, PromiseSettledResult>
const results = await foundry.documents.User.queryMany(game.users.filter(u => u.active && !u.isSelf), "mysys.ping", {});
```
Rules: the target must be `active` (connected) or `query` throws; the caller needs the `QUERY_USER` permission (players have it by default; a GM can revoke it); handler exceptions come back as a rejected promise with the message; unregistered names throw locally. Core uses it for `dialog` (remote prompts) and `confirmTeleportToken`. `CONFIG.debug.queries = true` logs traffic. This replaces most hand-rolled "ask the GM" socket code and gives you awaitable results.

Helpers: `game.users.activeGM` (highest-role active GM or null), `game.user.isActiveGM`, `game.users.getDesignatedUser(cond)`.

---

## 11. Text enrichers

Register in `init`; the enricher returns an **HTMLElement** (not a string) or `null` for no replacement.

```js
CONFIG.TextEditor.enrichers.push({
  id: "mysysCheck",                                   // required for onRender
  pattern: /\[\[\/check (?<ability>\w+)(?: (?<dc>\d+))?\]\](?:\{(?<label>[^}]+)\})?/gi,   // MUST have the g flag
  replaceParent: false,                               // hoist result if it replaces the whole parent element
  enricher: async (match, options) => {               // options: EnrichmentOptions {rollData, relativeTo, secrets, ...}
    const { ability, dc, label } = match.groups;
    const a = document.createElement("a");
    a.classList.add("mysys-check");
    a.dataset.ability = ability; if (dc) a.dataset.dc = dc;
    a.innerHTML = `<i class="fa-solid fa-dice-d20"></i> ${label ?? `${ability.toUpperCase()} check`}`;
    return a;
  },
  onRender: (enrichedEl) => {                         // called when inserted into the DOM; enrichedEl is a wrapper <enriched-content enricher="mysysCheck">
    enrichedEl.addEventListener("click", (ev) => { const a = ev.target.closest("a.mysys-check"); if (a) rollCheck(a.dataset); });
  }
});
// use:  const html = await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, { rollData: actor.getRollData(), relativeTo: item });
```
Fields (`TextEditorEnricherConfig`): `id?`, `pattern`, `enricher(match, options)`, `replaceParent?`, `onRender?`. Enrichers run after the built-ins (UUID links, hyperlinks, `[[/r]]` inline rolls, embeds). ProseMirror editor inserts: `CONFIG.TextEditor.inserts.push({action, title, html, inline?, children?})`.

---

## 12. Templates, Handlebars, i18n

```js
// init: preload templates; each loaded path is also registered as a partial under its own path
foundry.applications.handlebars.loadTemplates(["systems/mysys/templates/parts/stat.hbs"]);   // use as {{> "systems/mysys/templates/parts/stat.hbs"}}
Handlebars.registerHelper("mysysMod", (n) => (n >= 0 ? `+${n}` : String(n)));                 // global Handlebars still exists
const html = await foundry.applications.handlebars.renderTemplate("systems/mysys/templates/card.hbs", ctx);
```
Built-in helpers: `localize`, `selectOptions`, `formInput`, `formGroup`, `numberInput`, `rangePicker`, `filePicker`, `editor`, `checked`, `disabled`, `ifThen`, `concat`, `numberFormat`, `object`.

i18n: language files declared in the manifest `languages`, keyed JSON (`"MYSYS.Ability.str": "Strength"` or nested). `game.i18n.localize("MYSYS.X")`, `game.i18n.format("MYSYS.Y", {name})` (placeholders `{name}`), `game.i18n.has(key)`. Data model field labels auto-localize from `LOCALIZATION_PREFIXES = ["MYSYS.Actor.Character"]` + `FIELDS.<path>.label`. Never call `localize` before `i18nInit` (use keys in `CONFIG` and localize at render).

---

## 13. Module etiquette

**libWrapper** (`lib-wrapper` module; list it under `relationships.requires` in `module.json` with `type: "module"`):

```js
Hooks.once("init", () => {
  libWrapper.register("my-mod", "foundry.canvas.placeables.Token.prototype._onClickLeft",
    function (wrapped, event) { /* before */ const r = wrapped(event); /* after */ return r; }, "WRAPPER");
  libWrapper.register("my-mod", "CONFIG.Actor.documentClass.prototype.prepareDerivedData",
    function (wrapped, ...args) { wrapped(...args); this.system.myBonus = 1; }, "WRAPPER");
});
```
Types: `WRAPPER` (always calls `wrapped`; safest), `MIXED` (may skip `wrapped`), `OVERRIDE` (last resort), `LISTENER` (observe only, no return value, no `wrapped` param). Use `function`, not arrow functions, to keep `this`. Target strings use real namespaces (`foundry.canvas.placeables.Token.prototype...`) and must be resolvable at `init`. Only wrap when no hook or CONFIG class override exists. If you are a **system**, prefer subclassing via `CONFIG.*.documentClass` instead of libWrapper.

Other etiquette:
- Prefix everything with your package id: settings namespace, flags (`doc.setFlag("my-mod", "key", v)` / `getFlag`), CSS classes, Handlebars helpers, socket event, custom hooks, query names, keybinding namespace, custom region behavior type ids (`"my-mod.thing"` in `dataModels`).
- Don't mutate core `CONFIG` arrays destructively; push/add keys.
- Don't write to `game.system`/`game.modules` entries other than your own `api`.
- Gate optional integrations: `game.modules.get("dice-so-nice")?.active`, `game.modules.get("lib-wrapper")?.active`.
- Check version once: `if (game.release.generation < 13) { ui.notifications.error("..."); return; }` or declare `compatibility: {minimum: "13", verified: "14"}`.
- Expose a module API: `Hooks.once("setup", () => { game.modules.get("my-mod").api = { rollCheck, ... }; });` consumers do `game.modules.get("my-mod")?.api?.rollCheck(...)`. Fire `Hooks.callAll("my-mod.ready", api)` for late binding.

`foundry.utils` toolbox (all under `foundry.utils.`):

| Function | Use |
|---|---|
| `mergeObject(orig, other, {insertKeys, insertValues, overwrite, recursive, inplace=true, enforceTypes})` | deep merge; **mutates `orig` by default**, pass `{inplace:false}` for a copy; supports `-=key` deletion |
| `deepClone(obj)` | structured deep copy (the old `duplicate` is removed) |
| `getProperty(obj, "a.b.c")`, `setProperty`, `hasProperty`, `deleteProperty` | dot-path access |
| `expandObject({"a.b": 1})` / `flattenObject({a:{b:1}})` | nested <-> dotted, used for update payloads |
| `diffObject(a, b)`, `isEmpty`, `equals`, `isSubclass`, `getType` | |
| `randomID(length=16)` | ids |
| `debounce(fn, ms)`, `throttle(fn, ms)`, `debouncedReload()` | |
| `isNewerVersion(v1, v0)` | `isNewerVersion("14.1", "13")` true |
| `escapeHTML(str)` | always escape user text interpolated into HTML |
| `parseUuid`, `buildUuid`, `fromUuid`, `fromUuidSync`, `parseHTML` | |
| `logCompatibilityWarning(msg, {since, until, once})` | for your own deprecations |

Note v14 adds data-operators for updates (`_del`, `_replace` globals, `ForcedDeletion`/`ForcedReplacement`) alongside the older `"-=key": null` syntax; see the documents reference.

---

## 14. v13 vs v14 cheat sheet

| Area | v13 | v14 |
|---|---|---|
| Message visibility | `rollMode` strings `publicroll gmroll blindroll selfroll`, `CONST.DICE_ROLL_MODES`, `core.rollMode` | `messageMode` keys `public gm blind self ic`, `CONFIG.ChatMessage.modes`, `core.messageMode`; legacy names still accepted via `Roll._mapLegacyRollMode` with warnings until v16 |
| Measured templates | MeasuredTemplate documents + `canvas.templates` | deprecated; placing areas = Regions (`canvas.regions.placeRegion`) |
| Scene Levels | n/a | `Level` documents, `canvas.level`, `PlaceablesLayer#viewedDocuments()` (replaces `getDocuments()`), token `level` + `elevation` |
| Layer config | `CONFIG.Token.layerClass` | `CONFIG.Canvas.layers.tokens.layerClass` |
| `_loc` | absent | global shortcut for `game.i18n.localize` |
| Context menu entries | `name/callback/condition` (jQuery) | `label/onClick/visible` (HTMLElement) |
| Active effects | `changes` array on the effect | typed `ActiveEffect` data models, `system.changes`, `CONFIG.ActiveEffect.changeTypes/phases` |
| Chat render hook | `renderChatMessageHTML` introduced (v13), `renderChatMessage` deprecated | `renderChatMessage` still shimmed (until v15) |
| Token movement | movement API introduced (v13) | refined (`moveTokens`, `TokenDocument#move`, ruler classes, terrain) |
| Settings scopes | `client world user` | same |

---

## 15. Verify-in-source pointers

| Question | Look here (under `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/`) |
|---|---|
| Hook name or args | `client/hooks.mjs`; dynamic names: `grep -rn "Hooks.call" client/` |
| Init order | `client/game.mjs` `initialize`, `setupGame`; `client/helpers/localization.mjs` |
| CONFIG keys | `client/config.mjs` |
| Setting options | `client/_types.mjs` (`SettingConfig`), `client/helpers/client-settings.mjs`, `client/applications/settings/config.mjs` |
| Keybinding options | `client/_types.mjs` (`KeybindingActionConfig`), `client/helpers/interaction/client-keybindings.mjs` |
| Query internals | `client/documents/user.mjs` (`query`), `client/documents/collections/users.mjs` (`#handleUserQuery`) |
| Enricher internals | `client/applications/ux/text-editor.mjs` |
| Globals | `client/client.mjs` (`Object.assign(globalThis, ...)`) |
| Real-world v14 patterns | `~/Library/Application Support/FoundryVTT/Data/systems/swade/swade.js` (search `Hooks.once("init"`) |
