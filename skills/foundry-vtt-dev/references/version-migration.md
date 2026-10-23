# Version migration: v12 -> v13 -> v14 (for package developers)

Verified against the installed v14.369 source (`client/`, `common/`) and the official release notes / GitHub removal issues. "Removed in vN" means calls fail or silently no-op in vN; "deprecated" means it still works but logs a warning (see section 4).

## Contents
1. [Obsolete -> modern cheat sheet](#1-obsolete--modern-cheat-sheet)
2. [Per-version breaking changes](#2-per-version-breaking-changes): [v12](#21-v12) - [v13](#22-v13) - [v14](#23-v14)
3. [Supporting v13 and v14 at once](#3-supporting-v13-and-v14-at-once)
4. [Reading deprecation warnings](#4-reading-deprecation-warnings)
5. [Appendix: what is still deprecated in v14 and when it dies](#5-appendix-deprecation-inventory-v14369)
6. [Appendix: API surface diff v13 -> v14](#6-appendix-api-surface-diff-v13--v14)

Version facts: v12 stable 12.324 (2024-05), Node >= 18. v13 stable 13.341 (2025-04), Node >= 20 in its release notes (KB now says 22). v14 stable 14.359 (2026-04), latest 14.369; **Node >= 24** (`package.json` engines `>=24.13.1 <25`). Deprecation windows are normally two generations: deprecated in vN -> removed in vN+2 (v13 deprecations die in **v15**, v14 deprecations in **v16**).

---

## 1. Obsolete -> modern cheat sheet

"Works in" = generations where the modern form is valid. When it says "14 only", gate it (section 3).

### 1.1 Applications, sheets, dialogs

| Obsolete (LLMs still emit this) | Modern | Works in |
|---|---|---|
| `class X extends ActorSheet` / `ItemSheet` / `FormApplication` / `Application` / `DocumentSheet` (globals; or `foundry.appv1.*`) | `class X extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)` (also `ItemSheetV2`, `DocumentSheetV2`, `ApplicationV2`). AppV1 is deprecated, **removed in v16**; V1 sheets do not get pop-out, theming or new core features | 12+ (sheets solid from 13) |
| `static get defaultOptions()` + `mergeObject` | `static DEFAULT_OPTIONS = { classes, position:{width,height}, window:{title,icon,resizable,controls}, actions:{...}, form:{handler, submitOnChange, closeOnSubmit}, tag }` (merged automatically up the class chain) | 12+ |
| `template: "..."` / `getData()` | `static PARTS = { body: {template: "systems/id/templates/x.hbs"} }` + `async _prepareContext(options)` (per-part: `_preparePartContext(partId, ctx, opts)`) | 12+ |
| `activateListeners(html)` with `html.find(".x").click(fn)` | Declarative `actions: {roll: Sheet.#onRoll}` + `data-action="roll"` in HTML (handlers are static, `this` = app). For other listeners: `_onRender(context, options)` with `this.element.querySelector(...).addEventListener(...)`, or `_attachPartListeners(partId, el, opts)` | 12+ |
| `this.object` (V1 FormApplication/DocumentSheet) | `this.document`; on V2 sheets also `this.actor` / `this.item` | 12+ |
| `_updateObject(event, formData)` | `form: {handler: Sheet.#onSubmit}` with `static async #onSubmit(event, form, formData)` and `formData.object`; DocumentSheetV2 does the update for you via `_processSubmitData` | 12+ |
| `this.options.tabs` + `new Tabs()` | `static TABS = { primary: {tabs:[{id,...}], initial} }`, `this.tabGroups`, `_prepareTabs(group)`, `data-action="tab" data-group=... data-tab=...` | 13+ |
| `render(true)` / `render(false, {...})` | `render({force: true})` / `render({parts: ["body"]})` | 12+ |
| `_getHeaderButtons()` | `_getHeaderControls()` / `static DEFAULT_OPTIONS.window.controls` / hook `getHeaderControlsApplicationV2` | 13+ |
| `Dialog.confirm/prompt/wait`, `new Dialog({buttons:{a:{callback:html=>...}}})` | `foundry.applications.api.DialogV2.confirm({window:{title}, content, yes:{callback}})`, `.prompt`, `.input`, `.wait({buttons:[{action,label,callback}]})`. Callback signature `(event, button, dialog)`; `rejectClose` defaults to **false** since 13 (returns null on close). `content`/notification text is HTML-cleaned | 12+ (details 13+) |
| `ui.windows` to find open apps | `foundry.applications.instances` (Map id -> ApplicationV2); `ApplicationV2.instances()` generator (14). `ui.windows` only holds V1 apps | 13+ |
| `Actor.createDialog(data, {parent, pack})` (old) | `Actor.createDialog(data, createOptions, dialogOptions)` - DB options 2nd, DialogV2.prompt options 3rd. Same for `Folder.createDialog` | 13+ |
| Document `deleteDialog(options)` with Dialog options | `deleteDialog(dialogOptions, operation)` - options are DialogV2.confirm entries | 13+ |
| `Hooks.on("renderSceneControls")` + mutate `ui.controls.controls[]` array | `Hooks.on("getSceneControlButtons", controls => {controls.tokens.tools.myTool = {name:"myTool", title, icon, order, button:true, visible, onChange:(event, active)=>{}}})` - `controls` is a **Record**, tools are a Record, `onClick` -> `onChange` (13). `SceneControls#activeControl/activeTool` -> `control.name` / `tool.name`. In 14, `tool`/`game.activeTool` may be null (layers with no tools) | 13+ |
| `ContextMenu.create(app, html, selector, items)` with jQuery callbacks | `this._createContextMenu(this._getXContextOptions, ".selector", {hookName, parentClassHooks})` in AppV2; entries `{label (was name), icon, onClick (was callback), visible (was condition)}` receive `HTMLElement`. Entry key renames are 14 | 13 (menu) / 14 (renamed keys) |
| `new TextEditor...` TinyMCE; `{{editor}}` with `engine: "tinymce"` | ProseMirror only (TinyMCE removed in 14): `{{formInput fields.x enriched=...}}`, `<prose-mirror>`, `foundry.applications.elements.HTMLProseMirrorElement`, `foundry.applications.fields.createEditorInput` | 13+ |
| `TextEditor.enrichHTML(text, {async:true, ...})`, global `TextEditor` | `await foundry.applications.ux.TextEditor.implementation.enrichHTML(text, {secrets, rollData, relativeTo})` (always async; `async` option gone). `TextEditor.getDragEventData` -> same `.implementation` static | 13+ |
| `FilePicker` global, `new FilePicker({...}).browse()` | `foundry.applications.apps.FilePicker.implementation`; in forms use the `<file-picker name=... type="image">` element or `{{formInput}}` (see 1.5) | 13+ |
| `Actors.registerSheet("sys", Sheet, {makeDefault:true})`, `Actors.unregisterSheet("core", ActorSheet)` | `foundry.documents.collections.Actors.registerSheet("sys", Sheet, {types:["character"], makeDefault:true, label:"..."})` or `foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "sys", Sheet, opts)`. No core default sheet is registered for Actor/Item (13.341), so a system **must** register its own | 13+ |
| `ui.notifications.info(msg)` with HTML in msg | Notification text is escaped by default (13): options `{localize, format:{k:v}, permanent, escape=true, clean=true, progress}`; pass `escape:false` only for trusted markup; `format` values are escaped automatically | 13+ |

### 1.2 Hooks

| Obsolete | Modern | Notes |
|---|---|---|
| `Hooks.on("renderActorSheet", (app, html, data) => html.find(...))` | `Hooks.on("renderActorSheetV2", (app, element, context, options) => element.querySelector(...))` or the concrete class name: `render<ClassName>`; every class in the chain fires (`renderApplicationV2`, `renderDocumentSheetV2`, `renderMySheet`) | `element` is an HTMLElement. `renderActorSheet` still fires only for V1 sheets |
| `Hooks.on("renderApplication"/"closeApplication"/"getApplicationHeaderButtons")` | `renderApplicationV2` / `closeApplicationV2` / `getHeaderControlsApplicationV2(app, controls)`; V1 equivalents renamed `renderApplicationV1`, `closeApplicationV1`, `getApplicationV1HeaderButtons` | 13+ |
| `renderChatMessage(msg, html: jQuery, data)` | `renderChatMessageHTML(msg, html: HTMLElement, data)`; `ChatMessage#getHTML()` -> `await msg.renderHTML()` | deprecated 13, removed 15 |
| `chatBubble` | `chatBubbleHTML` (HTMLElement) | removed 15 |
| `getActorDirectoryEntryContext` / `getApplicationEntryContext(html, options)` | `getActorContextOptions`, `get<Doc>ContextOptions` (`getDocumentContextOptions`); first arg is the application, 2nd the menu items array | 12-13 |
| `preCreateChatMessage` etc. (document hooks) | Unchanged: `preCreate<Doc>(doc, data, options, userId)`, `create<Doc>`, `preUpdate<Doc>(doc, changes, options, userId)`, ... Return `false` from `pre*` to cancel | all |
| `initializeDarknessSources` | gone (13); sources recompute from `Scene#initializeEdges`/perception | removed |
| New in 13/14 worth knowing | `preMoveToken`, `moveToken`, `stopToken`, `pauseToken`, `recordToken`, `planToken` (14); `activateSceneControls`, `clientSettingChanged`, `renderChatInput`, `streamReady`, `preRenderApplication` (14), `openDetachedWindow`/`closeDetachedWindow` (14), `getPlaceableContextOptions` (14) | see section 6 |

### 1.3 Globals and namespaces

Core classes moved into the ES-module `foundry.*` namespace in v13. The old bare globals still work in v14 but log `You are accessing the global "X" which is now namespaced under foundry.Y` and **disappear in v15**.

| Obsolete global | Modern |
|---|---|
| `renderTemplate`, `loadTemplates`, `getTemplate`, `HandlebarsHelpers` | `foundry.applications.handlebars.renderTemplate/loadTemplates/getTemplate` |
| `FilePicker`, `ImagePopout`, `DocumentSheetConfig`, `GridConfig`, `DocumentOwnershipConfig` | `foundry.applications.apps.*` (`FilePicker.implementation`) |
| `Hotbar`, `SceneControls`, `SceneNavigation`, `Players`, `Notifications`, `MainMenu` | `foundry.applications.ui.*` |
| `ActiveEffectConfig`, `TokenConfig`, `SceneConfig`, `RollTableConfig`, `JournalPDFPageSheet`, ... | `foundry.applications.sheets.*` (`RollTableSheet`, `journal.JournalEntryPagePDFSheet`) |
| `ChatLog`, `CombatTracker`, `ActorDirectory`, `Compendium`, `Sidebar`, `Settings` | `foundry.applications.sidebar.tabs.*` / `.apps.*` |
| `ContextMenu`, `DragDrop`, `Draggable`, `FormDataExtended`, `Tabs`, `SearchFilter`, `TextEditor`, `ProseMirrorEditor`, `HTMLSecret` | `foundry.applications.ux.*` (`ContextMenu.implementation`, `DragDrop.implementation`, `TextEditor.implementation`) |
| `Token`, `Tile`, `Wall`, `AmbientLight`, `AmbientSound`, `Drawing`, `Note`, `Region`, `PlaceableObject` | `foundry.canvas.placeables.*` |
| `TokenLayer`, `WallsLayer`, `PlaceablesLayer`, `InteractionLayer`, `CanvasLayer`, ... | `foundry.canvas.layers.*` |
| `Canvas`, `SceneManager`, `TextureLoader`, `loadTexture`, `getTexture`, `srcExists` | `foundry.canvas.*` (`srcExists` -> `foundry.utils.srcExists`) |
| `Ray`, `PointSourcePolygon`, `ClockwiseSweepPolygon`, `Quadtree`, `PIXI` helpers | `foundry.canvas.geometry.*` (PIXI itself is still a global) |
| `SpriteMesh`, `PreciseText`, `ControlIcon`, `GridMesh` | `foundry.canvas.containers.*` |
| `Ping`, `Ruler`, `MouseInteractionManager`, `RenderFlags`, `CanvasAnimation`, `ChatBubbles` | `foundry.canvas.interaction.*` / `foundry.canvas.animation.*` |
| `Localization`, `ClientSettings`, `GameTime`, `SocketInterface`, `KeyboardManager`, `TooltipManager`, `ImageHelper`, `VideoHelper` | `foundry.helpers.*` (`.interaction`, `.media`) |
| `Actors`, `Items`, `Journal`, `Scenes`, `Folders`, `Macros`, `Messages`, `CompendiumCollection`, `DocumentCollection`, `WorldCollection` | `foundry.documents.collections.*` / `foundry.documents.abstract.*` (`Messages` -> `ChatMessages`) |
| `ClientDocumentMixin`, `CanvasDocumentMixin` | `foundry.documents.abstract.*` |
| `Game` | `foundry.Game` |
| `SortingHelpers`, `saveDataToFile`, `readTextFromFile` | `foundry.utils.*` (`performIntegerSort`) |
| `Module`, `System`, `World`, `PACKAGE_TYPES` | `foundry.packages.*` |
| **Removed in 14 (hard error)**: `Die`, `DiceTerm`, `Coin`, `FateDie`, `NumericTerm`, `OperatorTerm`, `ParentheticalTerm`, `PoolTerm`, `RollTerm`, `StringTerm`, `MathTerm` | `foundry.dice.terms.*` (`MathTerm` -> `FunctionTerm`) |
| **Removed in 14**: `Sound`, `AudioHelper`, `SquareGrid`, `HexagonalGrid`, `GridHex`, `BaseGrid`, `MersenneTwister`/`twist`, `WordTree`, `LightSource`, `DarknessSource`, `VisionSource`, `SoundSource`, `MovementSource`, `GlobalLightSource`, `AmbientLightConfig`, `AmbientSoundConfig`, `UserConfig`, `PermissionConfig` | `foundry.audio.Sound/AudioHelper`, `foundry.grid.*`, `foundry.dice.MersenneTwister`, `foundry.utils.WordTree`, `foundry.canvas.sources.Point{Light,Darkness,Vision,Sound,Movement}Source`, `foundry.applications.sheets/apps.*` |
| Bare utilities `mergeObject`, `duplicate`, `getProperty`, `setProperty`, `expandObject`, `flattenObject`, `randomID`, `isNewerVersion`, `deepClone`, `isEmpty`, `diffObject` | `foundry.utils.*`. These bare globals **do not exist** in v13/v14 (use `foundry.utils.mergeObject(...)`) |
| Still valid globals in v14 | `game`, `canvas`, `ui`, `CONFIG`, `CONST`, `foundry`, `Hooks`, `Roll`, `Handlebars`, `PIXI`, `$`/`jQuery`, `io`, `ProseMirror`, `Color`, `Collection`, `fromUuid`, `fromUuidSync`, `getDocumentClass`, all Document classes (`Actor`, `Item`, `ChatMessage`, `Scene`, `TokenDocument`, `Folder`, ...), `animejs`, `logger`, `vtt`; v14 adds `_loc`, `_del`, `_replace` |
| Deprecated (not removed) till v16 | globals `Application`, `FormApplication`, `Dialog`, `DocumentSheet` -> `foundry.appv1.api.*` (migrate to V2) |

### 1.4 Data, documents, effects

| Obsolete | Modern | Works in |
|---|---|---|
| `template.json` with `Actor: {types:[...], templates, character:{...}}` | `system.json` `documentTypes: {Actor: {character: {htmlFields:[...]}}}` + `class CharacterData extends foundry.abstract.TypeDataModel` registered in `init`: `CONFIG.Actor.dataModels.character = CharacterData`. Deprecated since 14.352; **removed v16** (server logs a package warning) | 11+ |
| `CONFIG.Actor.systemDataModels` | `CONFIG.Actor.dataModels` (old name removed 13) | 11+ |
| `actor.data.data`, `item.data.data`, `"data.attributes"` update paths | `actor.system`, `"system.attributes"` (gone since v12) | all |
| Updating with `{"-=key": null}` or `{"==key": {...}}`; `mergeObject(a, b, {performDeletions:true})` | **14**: `{key: _del}` (= `new foundry.data.operators.ForcedDeletion()`) and `{key: _replace(obj)}` (= `ForcedReplacement.create(obj)`); `mergeObject(..., {applyOperators:true})`; `foundry.utils.applySpecialKeys` -> `applyDataOperators`. Legacy string keys still work in 14 with a warning (13+: delete key value must be `null`) | 14 only (gate) |
| `foundry.utils.objectsEqual(a,b)` | `foundry.utils.equals(a,b)` (14) | 14 only |
| `new Roll(f).evaluate({async:true})`, `roll.evaluate({async:false})`, `roll.roll()` | `await new Roll(f, data).evaluate()`; `roll.evaluateSync()` only for sync-safe formulas (async option removed) | 12+ |
| `CONST.CHAT_MESSAGE_TYPES`, `ChatMessage#user`, `{type: ROLL}` | `CONST.CHAT_MESSAGE_STYLES`, `ChatMessage#author`, `rolls: [roll]` (types removed in 14) | 12+ |
| `rollMode: CONST.DICE_ROLL_MODES.PUBLIC`, `roll.toMessage(d, {rollMode})`, `game.settings.get("core","rollMode")`, `CONFIG.Dice.rollModes` | **14**: message modes `public`, `gm`, `blind`, `self`, `ic`: `roll.toMessage(d, {messageMode: "gm"})`, `ChatMessage.applyMode`, setting `core.messageMode`, `CONFIG.ChatMessage.modes[mode] = {label, icon}`. `rollMode` still accepted in 14 (mapped, warns) | 14 (v13 uses rollMode) |
| `ActiveEffect#changes`, `change.mode = CONST.ACTIVE_EFFECT_MODES.ADD` | **14**: `effect.system.changes[i] = {key, type: "add", value, phase: "initial" (or "final"), priority}`; `CONST.ACTIVE_EFFECT_CHANGE_TYPES` string keys (`add`, `multiply`, `override`, `upgrade`, `downgrade`, `subtract`, `custom`); `change.value` is JSON-parsed (`"5"` -> `5`); reading `effect.changes` / `change.mode` still shimmed with a warning | 14 only |
| `effect.duration.rounds/turns/seconds`, `duration.startTime/startRound/startTurn` | **14**: `duration: {value, units, expiry}` and `start: {time, combat, round, turn}` (legacy keys shimmed with warning); `ActiveEffect.getInitialDuration` -> `getEffectStart` | 14 only |
| Subclass overrides `_applyAdd/_applyMultiply/_applyOverride/_applyUpgrade/_applyCustom/_applyLegacy`, `ActiveEffect#apply`, `applyField` | **14**: `static _applyChangeAdd/Multiply/Override/Upgrade/Custom/Unguided`, `static applyChange`, `applyChangeField`; new `shouldApplyChange(change, {phase})`. `Actor#applyActiveEffects(phase)` now takes `"initial"` (called after embedded docs, before derived data) or `"final"` (after `prepareDerivedData`); calling it with no argument still works with a warning | 14 only |
| `CONFIG.ActiveEffect.legacyTransferral = true` | removed (14); effects transfer from Items by `transfer` + `allApplicableEffects()` | 14 |
| `effect.label`, `effect.icon`, `flags.core.statusId`, `CONFIG.statusEffects = [{id, label, icon}]` | `effect.name`, `effect.img`, `effect.statuses` (Set), status config `{id, name, img}`. `CONFIG.statusEffects` is a hybrid array/record in 14: use `CONFIG.statusEffects.push(cfg)` (valid in 13 and 14) | 11+ |
| `token.toggleEffect`, `TokenDocument#effects`, `#overlayEffect` | `await actor.toggleStatusEffect(statusId, {active, overlay})`; effects live on the actor | removed 14 |
| `TokenDocument#actorData`, `getActor()` | `TokenDocument#delta` (ActorDelta), `token.actor` | removed 13 |
| `Combat#getCombatantByActor/ByToken` | `getCombatantsByActor/ByToken` (arrays) | removed 15 |
| `fromUuid(uuid, relativeDoc)` | `fromUuid(uuid, {relative: doc})`; `fromUuidSync` same; **14**: `foundry.utils.buildRelativeUuid(from, to)` | 11+ |
| `Document.create(data, {temporary:true})`, operation `action`/`data`, `_onCreateDocuments` statics | `new Doc(data)`, `renderContext`/`renderData`, `_onCreateOperation` (removed 14) | 12+ |
| `flags.core.sourceId` | `_stats.compendiumSource` (removed 14) | 12+ |
| `scene.darkness`, `fogExploration`, `globalLight`, `img`, `shiftX` | `scene.environment.darknessLevel`, `scene.fog.exploration`, `scene.environment.globalLight.enabled`, `scene.background.src`; **14**: backgrounds/foregrounds live in `Level` docs (`scene.levels`); `Scene#background/foreground/backgroundColor/foregroundElevation` shims deprecated | 14 for levels |
| `MeasuredTemplateDocument`, `canvas.templates`, `scene.templates`, `MeasuredTemplate.create` | **14**: Region documents (`RegionDocument` with `shapes`: circle/cone/line/rectangle/ellipse/grid, `behaviors`). `RegionDocument.createTokenEmanation`, `TEMPLATE_CREATE` permission -> `REGION_CREATE` | 14 only |
| `Math.clamped`, `Math.roundDecimals`, `foundry.utils.isObjectEmpty` | `Math.clamp`, `Number#toNearest`/`toFixed`, `foundry.utils.isEmpty` | removed 12-14 |
| `canvas.grid.getCenter/getSnappedPosition/measureDistances/getTopLeft`, `Token#getCenter` | `canvas.grid.getCenterPoint/getSnappedPoint/measurePath/getTopLeftPoint`, `token.getCenterPoint` | removed 14 |
| `game.template`, `System#template`, `System#gridUnits/gridDistance` | `game.model`/`System#documentTypes`, `System#grid.{units,distance}` | removed 14 |
| `token.document.update({x,y}, {animate})` moving + `teleport`/`forced` operation flags | `await tokenDoc.move(waypoints, {action, method, constrainOptions})`, `Scene#moveTokens`, `token.planMovement()` (14); hooks `preMoveToken`/`moveToken`. Operation `teleport`/`forced` -> `waypoints` / movement `action` (deprecated 13, removed 15) | 13+ |

### 1.5 Handlebars, HTML, CSS, localization

| Obsolete | Modern |
|---|---|
| `{{#select value}}<option ...>` | `<select name="x">{{selectOptions choices selected=value localize=true labelAttr="label" valueAttr="id"}}</select>` (`{{#select}}` removed 14; `nameAttr` -> `valueAttr`) |
| `{{filePicker target="img" type="image"}}`, `{{rangePicker}}`, `{{colorPicker}}` | `<file-picker name="img" type="image" value="{{img}}">`, `<range-picker>`, `<color-picker>` (HTML custom elements) or the field-driven `{{formInput fields.img value=img}}` / `{{formGroup fields.name value=name localize=true}}` helpers. `colorPicker` removed 14, others deprecated |
| Manual `<input type="checkbox" {{checked x}}>` still fine | Checkbox visuals are restyled in v13+ (FontAwesome pseudo-elements) - never rely on the native box |
| Plain `<form>` inside an AppV2 `tag:"form"` | Don't nest forms; with `tag: "form"` the part templates must use `<section>`/`<div>` |
| CSS overriding core by specificity | v13+ core styles live in `@layer` (system `layer(system)`, module `layer(modules)`); unlayered CSS always beats layered CSS. Declare `"styles": [{"src": "css/x.css", "layer": "system"}]` to join the layered cascade; scope with your own class, use core CSS variables (`--color-text-primary`, `--color-border-light-1`, ...), support `.theme-light`/`.theme-dark` via `.themed` |
| `game.i18n.localize(key)` + `game.i18n.format(key, {x})` | Both work; v14 merges them (`format` is an alias of `localize`, `{name}` interpolation works in either). v14 adds global `_loc(key, data)` (14 only). Type labels: `TYPES.Actor.<type>`, sub-type hints `TYPES.Actor.hint.<type>` |
| Legacy `DOCUMENT.TypeX` localization keys | `TYPES.<Doc>.<type>` (old keys removed 13) |
| `lang/*.json` listed with only `lang`/`name`/`path` | still valid; manifest `languages[].system/module` restrict loading |

### 1.6 Manifest / packaging

| Obsolete | Modern |
|---|---|
| `name`, `minimumCoreVersion`, `compatibleCoreVersion`, `dependencies`, `author`, `system: "dnd5e"` (module) | `id`, `compatibility: {minimum, verified, maximum}`, `relationships: {requires/recommends/conflicts, systems}`, `authors: [{name,...}]` (hard failures since v11-13) |
| `"styles": ["a.css"]` | v13+ schema is `[{src, layer?}]`; plain strings are auto-migrated |
| `packs: [{name, label, path: "packs/x.db", entity: "Item", private: true}]` | `packs: [{name, label, path: "packs/x", type: "Item", system: "id", ownership: {...}}]` - LevelDB folders (v11+), `type` not `entity`, `ownership` not `private`; Actor/Item/Adventure packs must declare `system` (or the package must have exactly one system relationship) |
| Folders in `packs/` made by hand-editing `.db` | `fvtt package pack/unpack` (see tooling.md) |
| `template.json`, `"gridDistance"`, `"gridUnits"` | `documentTypes`, `grid: {distance, units}` |
| 14: unspecified package kind | `"type": "system"` or `"module"` is part of the schema (defaults to the folder kind) - set it |
| `flags.hotReload: {paths: [...]}` only | needs `extensions: ["css","hbs","json"]` as well; JS is never hot-reloaded (see tooling.md) |

---

## 2. Per-version breaking changes

### 2.1 v12 (stable 2024-05; Node >= 18)
Theme: finish the v9/v10 compatibility shims, grid/canvas rewrites, V2 application framework appears.

Breaking / removed:
- **Everything deprecated in v10 and earlier is gone** (issue #10164): `Document#data` -> `system`; `Actor#token` -> `prototypeToken`; `permission` -> `ownership`; `ChatMessage#roll` -> `rolls`; `Folder#content` -> `contents`; `DocumentData`, `PrototypeTokenData`, `SpecialEffect`, `ObjectHUD`, `SynchronizedTransform`, `NormalizedRectangle`; `CONFIG.fontFamilies` -> `fontDefinitions`; `isObjectEmpty` -> `isEmpty`; color utils -> `Color`; scene/token/tile/light flat fields -> inner objects (`scene.grid.*`, `token.texture.*`, `token.light.*`, `token.sight.*`).
- Node >= 18 (Node 16 dropped).
- `ChatMessage#user` -> `author` (and `MeasuredTemplateDocument#user`); `ActiveEffect#icon` -> `img` (shimmed until 14); `Combat#getCombatantByActor/Token` -> plural.
- `Roll#evaluate` must be async; `Roll#evaluateSync({strict})` added.
- `TokenDocument#effects` / `#overlayEffect` removed: statuses are ActiveEffects on the actor (`actor.toggleStatusEffect`, `CONFIG.statusEffects`).
- **TypeDataModel for more documents**: system data now also for `ActiveEffect`, `Combat`, `Combatant`, `ChatMessage` (`CONFIG.<Doc>.dataModels`, manifest `documentTypes`). `prepareBaseData/prepareDerivedData` on `system` are called automatically when `system` is a `TypeDataModel`.
- **Grid API v2**: `Scene#grid` / `canvas.grid` is a `BaseGrid` (`SquareGrid`, `HexagonalGrid`, `GridlessGrid`) with `getCenterPoint`, `getSnappedPoint`, `measurePath`, `getOffset`...; `canvas.grid` stopped being the GridLayer (that is `canvas.interface.grid`). Hex grids reworked.
- **Primary canvas objects v2**, new `CanvasVisibility`/lighting performance; `GridMesh` instead of PIXI.Graphics grid; `createEffectsCanvasGroup` hook removed; `BaseCanvasMixin` -> `CanvasGroupMixin`.
- **Audio API**: `AudioContainer` merged into `Sound`; `Sound#on/off/emit` -> `addEventListener/removeEventListener/dispatchEvent`; `AudioHelper#getCache` etc. replaced by `AudioHelper#buffers`.
- Manifest: compendium pack names validated like package ids; system manifest grid fields (`gridDistance/gridUnits` -> `grid.{distance,units}`).
- `{{#select}}` helper deprecated (use `selectOptions`); `{{filePicker}}` deprecated for `<file-picker>`; `content-link` class decoupled from click handling (`data-link`).
- `ColorField` values are `Color` instances; `FormDataExtended` includes readonly fields; `Math.clamped` -> `Math.clamp`; `AngleField#base` -> `normalize`.
- `getApplicationEntryContext` hook first argument became the Application (not HTML).
New and adoptable: ApplicationV2 / `DocumentSheetV2` / `ActorSheetV2` / `ItemSheetV2` / `DialogV2` / `HandlebarsApplicationMixin`; `TypedSchemaField`; `foundry.utils` moves; `Token#toggleCombatant`.

### 2.2 v13 (stable 2025-04-27; the big UI generation)
Theme: every core UI is ApplicationV2, jQuery leaves the API, ES-module namespaces, Theme V2 + CSS layers, token drag measurement.

Breaking (most important first):
1. **jQuery -> HTMLElement** in all render/close/context hooks and V2 apps (`renderChatMessage` -> `renderChatMessageHTML`, `chatBubble` -> `chatBubbleHTML`, `ContextMenu` callbacks). `html.find()` no longer works on hook arguments.
2. **Core apps converted to ApplicationV2** (Sidebar, directories, ChatLog, CombatTracker, Hotbar, SceneControls, SceneNavigation, Players, MainMenu, Settings, all Document configs/HUDs, Compendium, FilePicker, journal sheets, `DocumentSheetConfig`...). Code that subclassed/patched the V1 versions or queried their DOM breaks. Hook names changed to `render<ClassName>` with `(app, element, context, options)`; header buttons -> `getHeaderControls<ClassName>(app, controls)`; sidebar tab ids de-duplicated; context menus use fixed positioning; combat tracker config moved (`CombatTrackerConfig`); combats are **unlinked across scenes by default**.
3. **ES-module namespacing**: canvas, containers, layers, shaders, geometry, interaction, helpers all moved into `foundry.*`; old globals redirect with a warning until **v15** (cheat sheet 1.3).
4. **SceneControls** data is `Record<string, SceneControl>` with `tools: Record<string, SceneControlTool>`; hook `getSceneControlButtons` must mutate that shape; `onClick` -> `onChange`; `Hotbar#macros` -> `slots`; `Sidebar#activateTab` -> `changeTab`.
5. **Theme V2 + CSS layers**: core CSS in `@layer`; packages can declare `layer` in `styles`; light/dark themes (`.themed.theme-dark`); native checkboxes restyled. System CSS written against v12 selectors usually breaks visually.
6. **Token drag measurement / movement API**: `TokenDocument#move`, `CONFIG.Token.movement.actions`, hooks `preMoveToken`, `moveToken`, `stopToken`, `pauseToken`; token drag measuring uses `foundry.canvas.placeables.tokens.TokenRuler` (the old `Ruler` is the CTRL-measure tool); operation flags `teleport`/`forced` deprecated for waypoints; `BaseGrid#measurePath` teleport waypoints now measured; region events `TOKEN_PRE_MOVE`/`TOKEN_MOVE` no longer fire (`TOKEN_MOVE_WITHIN`, `BEHAVIOR_STATUS` -> `BEHAVIOR_ACTIVATED/DEACTIVATED/VIEWED/UNVIEWED`); region shape properties moved to `RegionDocument`.
7. **Removal of compat shims from v11 and earlier** (issue #11815): `Package#name/minimumCoreVersion/dependencies/system`, `packs.entity/private`, `Document#data`, `CONFIG.*.systemDataModels` -> `dataModels`, `Document.hasSystemData` -> `hasTypeData`, `SidebarDirectory` -> `DocumentDirectory`, `ActiveEffect#label`, `flags.core.statusId`, `TokenDocument#actorData/getActor`, `fromUuid(uuid, relative)` positional form, `DOCUMENT.TypeX` loc keys, many canvas internals (`Token#updatePosition`, `Tile#testOcclusion`, `FogManager#*`, `CONFIG.Canvas.losBackend`).
8. **Default sheet registrations removed** (13.341): register your own Actor/Item sheets or documents fall back to the generic `BaseSheet`.
9. **Data layer**: `DataField#getInitialValue` redesigned; `mergeObject`/`updateSource` deletion keys must be `{"-=k": null}`; changing a Document's `type` requires `==system` (or `recursive:false`) in the same update; `NumberField#toInput` no range slider if nullable; `Document#uuid`/`parseUuid` return null instead of malformed/throw; `getType` returns "Unknown" for non-plain objects; DialogV2 content is cleaned; Notifications escape by default; `ClientSettings` onChange receives cleaned/initialized values; PlaylistSound `channel` initial "".
10. **Chat roll modes**: `ChatMessage#_preCreate` only applies a roll mode if `options.rollMode` is set; `CONFIG.Dice.rollModes` entries are objects `{label, icon}`; chat input has 4 icon buttons.
11. **CONST/media**: file categories & extensions reorganised (`CONST.FILE_CATEGORIES.MEDIA` -> `MEDIA_MIME_TYPES`), `.webm` audio no longer accepted in audio pickers; `TABLE_RESULT_TYPES.COMPENDIUM` -> `DOCUMENT` (TableResult text/documentId fields reworked: `TableResult#getChatText` -> `getHTML`).
12. **TinyMCE** put on deprecation (removed in 14); default editor is ProseMirror.
13. `DialogV2WaitOptions#rejectClose` default false; DialogV2 callbacks receive the DialogV2 instance; `ClientDocument#collection` for compendium docs is the `CompendiumCollection`.
14. Node version bump (20+ at release; KB now 22).
15. Hooks/behaviour: `ready`-time ordering; `Application.maxZ` moved to `ApplicationV2._maxZ`.

New and adoptable in 13: `HandlebarsApplicationMixin` + `PARTS` + `actions` everywhere; custom elements (`<prose-mirror>`, `<document-tags>`, `<code-mirror>`, `<enriched-content>`, `<secret-block>`, `<multi-select>`, `<string-tags>`); `TypedObjectField`; `JournalEntryCategory` and `CombatantGroup` documents; `Calendar` API (`game.time.calendar`, `CalendarData`); darkness-emitting tokens, light priority; door animations; combat turn markers; `foundry.applications.instances`; sound-reactive lights; `Hooks`: `getHeaderControls*`, `renderChatInput`, `clientSettingChanged`.

### 2.3 v14 (stable 2026-04-01; Node 24)
Theme: Scene Levels, Active Effects v2, Template Regions, pop-out windows, DataModel performance work, TinyMCE gone.

**Removed (v12-era deprecations enforced, issue #13436)** - these now throw/are undefined:
- UI: `ApplicationV2#bringToTop` -> `bringToFront`; Handlebars `colorPicker` and `select` helpers; `selectOptions` `nameAttr` -> `valueAttr`. (`{{filePicker}}` and the V1 `FormApplication` file-picker members were instead extended to v16.)
- Audio: `AudioContainer`, `AudioHelper#getCache/setCache`, `Sound#on/off/emit/node/container`.
- Status effect config `label`/`icon` -> `name`/`img`; `ActiveEffect#label/#icon`; `ChatMessage#user`; `CONST.CHAT_MESSAGE_TYPES`; `CONST.DOCUMENT_TYPES`; `ChatMessage` type migration; `DrawingDocument#z`; `TileDocument#z/roof/overhead`; `TokenDocument#effects/overlayEffect/toggleActiveEffect`; `Scene#fogExploration/fogReset/fogOverlay/globalLight/darkness...`; `System#template/gridUnits/gridDistance`; `Game#template`; `core.sourceId` flag; `Document._on*Documents` statics; operation options `action`/`data`; `temporary`.
- Canvas: `GridLayer#*` and `BaseGrid` v1 aliases (`getCenter`, `measureDistance(s)`, `getSnappedPosition`...), `Token#owner/getCenter/toggleCombat/toggleEffect/toggleVisibility/updateSource`, `Wall#A/B/vertices/orientPoint`, `Canvas#colorManager`, `EffectsCanvasGroup#visibility/globalLightSource`, `PerceptionManager#refresh`, `canvas.perception` flags `refreshTiles`/`identifyInteriorWalls`, many `CanvasVisibility#vision.*` internals, `TilesLayer#roofs`, `WallsLayer#initialize`.
- Bare globals for dice terms, `Sound`/`AudioHelper`, grids, light/vision/sound source classes, `UserConfig`, `PermissionConfig`, `AmbientLightConfig`, `AmbientSoundConfig` (cheat sheet 1.3). `Math.clamped`, `Math.roundDecimals`.
- `CONFIG.ActiveEffect.legacyTransferral` (deprecated since 11).
- `TinyMCE` dependency and `JournalTextTinyMCESheet` (`activateEditorLegacy` hook exists for V1 only, removed with V16).

**Breaking changes new in v14:**
1. **MeasuredTemplate document eliminated** (first Document type ever removed). Templates are Regions (shapes: circle, cone, line, rectangle, ellipse, polygon, ring, emanation, grid, token-shape; behaviors; attach to tokens). `MeasuredTemplate*` classes, `canvas.templates`, `Scene#templates`, `CONST.MEASURED_TEMPLATE_TYPES`, `CONFIG.MeasuredTemplate`, setting `core.gridTemplates`/`core.coneTemplateType`, permission `TEMPLATE_CREATE` all deprecated shims (until 16). `RegionShape` -> `BaseShapeData` subclasses (`RegionDocument#regionShapes` -> `shapes`). Rectangle shapes gained `anchorX/anchorY` and their pivot changed from centre to `(x,y)`.
2. **ActiveEffect v2**: ActiveEffects are **primary documents** (can live in compendiums); `changes` moved to `system.changes` (an `ActiveEffectTypeDataModel`; subtype `base`), change `mode` (number) -> `type` (string), `phase` + `priority` per change, `value` stored as parsed JSON, changes may reference actor data (`@system.x`), `duration` -> `{value, units, expiry}` + `start`, expiry events and automatic expiration, effects can change Token properties via keys prefixed `token.` (e.g. light, vision), `origin` must be a UUID. See cheat sheet 1.4 for override renames (`_applyChange*`).
3. **Scene Levels**: `Scene#levels` (embedded `Level` documents) own backgrounds/foregrounds/fog textures; most placeables have `levels: Set<levelId>`; `elevation` semantics are relative to levels; vision/light/sound sources are bounded vertically; walls/edges managed per Level (`Level#edges`, `WallDocument#initializeEdge`); `Scene#getSurfaces`, `testSurfaceCollision`, `RegionDocument#elevation.base`; `canvas.level`/`game.user.viewedLevel`; `TokenDocument#depth/level/getTestPoints/getVisionOrigin`; `Scene#activate({viewOptions, pullUsers})`. `Scene#background`, `#foreground`, `#backgroundColor`, `#foregroundElevation` deprecated (use Level).
4. **DataModel update pipeline rewritten**: `DataModel.cleanData` unifies clean + migrate + sanitize in one recursive pass (`DataField#clean` also migrates/sanitizes); validation moved into `_updateDiff`; new `_updateDiff`/`_updateCommit`; `updateSource` clones its input and accepts another DataModel; operators `-=`/`==` deprecated for `ForcedDeletion`/`ForcedReplacement`. Custom `DataField` subclasses that override `clean`, `migrateSource` (replaced by `_migrate(value, options, _state)`), `_cleanType` or `initialize` need review; `migrateData` must **return** the data.
5. **Chat visibility modes** replace roll modes (`public gm blind self ic`; `CONFIG.ChatMessage.modes`; setting `core.messageMode`; option `messageMode` on `toMessage`, `ChatMessage.create`, `RollTable#draw`, `Combat#rollInitiative`). `ChatLog.MESSAGE_PATTERNS`/`MULTILINE_COMMANDS` -> `ChatLog.CHAT_COMMANDS` records `{pattern, callback, isMultiline}`.
6. **Token & movement**: `TokenDocument#detectionModes` is a `TypedObjectField` (record keyed by mode id, not array); `TokenDocument#move` resolves when the entire movement finishes; `TokenMovementActionConfig#getAnimationOptions(tokenDocument)`; `findMovementPath` options `ignoreWalls/ignoreCost/history` -> `constrainOptions`; token initial name = synthetic actor name; `actorLink` should be checked instead of `delta` existence; `ActorDelta` may be null; `Actor#getDependentTokens({concreteOnly})` default flips in v15.
7. **UI/app changes**: ApplicationV2 can render in a separate browser window (pop-out; header controls detach/attach; `window.detached`; hooks `openDetachedWindow`/`closeDetachedWindow`); `ApplicationV2` is an `EventEmitter` (`prerender`, `render`, `close`, `position` events via `addEventListener`); `_canRender` receives `isFirstRender`; header controls and context-menu entries unified (`ContextMenuEntry`: `label`, `onClick`, `visible`, `icon` may be a class string); kebab menu uses ContextMenu; `parseHTML` returns `null` (was `undefined`) and lives in `foundry.utils`; `ContextMenu.eventListeners`/`TooltipManager#activateEventListeners`/`ProseMirrorMenu.eventListeners` renamed `activateListeners`; Font Awesome 7.2.
8. **Placeables Palette & Placeables sidebar tab**; `PlaceablesLayer` creation options (`confirmBeforeCreation`, `renderSheetAfterCreation`, `controlObjectAfterCreation`) moved from Canvas Document CONFIG entries to the layer; `CONFIG.<Doc>.layerClass` -> `CONFIG.Canvas.layers.<name>.layerClass`; canvas documents `locked`/`hidden` are getters if no such field.
9. **Package/server**: Node >= 24; manifest `type` field; `template.json` deprecated (V16); `CONFIG.statusEffects` becomes id-keyed record (array API still works through a proxy); `Document.create` uses `this.implementation`; `Document#persisted`; `DocumentStatsField#createdTime/modifiedTime` required; module-caused quickstart recorded under `relationships.required`; user permissions for Assistant GM mirror GM; hot reload "reductions in scope".
10. `Roll`: booleans evaluate as 0/1; `Roll.replaceFormulaData` honours custom `toString`; `Actor#applyActiveEffects(phase)`.
11. Hooks: `ready` fires after scene transitions finish; `canvasTearDown` etc. receive next scene/level; `renderChatInput` options; `CalendarData#onUpdateWorldTime`.

New and adoptable in 14: pop-out windows for free on AppV2; `foundry.documents.modifyBatch` (multi-collection transaction); `Document#persisted`; `TypeDataModel#onEmbed` + `CONFIG[doc].embedHandlers`; `DataModel#getNearestDocument`; `SchemaField#extendFields/removeFields`; `DocumentUUIDField` relative options; `User.queryMany`; `foundry.utils.iterateEntries/iterateKeys/iterateValues` and `isPlainObject`, `equals`; `Autocomplete`, `HTMLAutocompleteTagsElement`, `HTMLFormulaInputElement` + `FormulaEditor`; `CanvasShakeEffect`, `ParticleGenerator`, `foundry.canvas.vfx.*`; KTX2 textures; `Token#planMovement`; `RegionLayer#placeRegion(s)`; `Level` API and `SceneManager` hooks (`_determineInitialLevel`); status-effect registry; compendium item-art mapping; chat `notify: false` and `scroll` options; `TooltipManager`/Tour `highlightElement`.

---

## 3. Supporting v13 and v14 at once

### 3.1 Manifest
```json
"compatibility": { "minimum": "13", "verified": "14" }
```
- `minimum` and `maximum` are **hard-enforced** by core (cannot install, red error, refuses to enable in a World). `verified` is guidance only: green badge if the user's version meets it, neutral if same generation but newer build, yellow warning if another generation; it never blocks. Prefer generation-wide values (`"14"`) over build-specific (`"14.369"`).
- **Leave `maximum` unset** unless you know the package breaks on an upcoming version (systems may set it to the generation they ship for, to stop users migrating worlds forward without a way back). Compatibility metadata updated on the website is "sidegraded" onto installed copies without a new release.
- Official listing: each website package version has a manifest URL, version, release notes, and required/compatible core versions; the in-app installer offers the **latest release whose core range matches the user's generation**, so a v13 line (`maximum: "13"`) and a v14 line (`minimum: "14"`) can coexist. CI can publish releases through the Package Release API (docs-index.md section 2b), whose `release.compatibility` takes the same `{minimum, verified, maximum}`.
- `manifest` (stable URL, always latest) vs `download` (zip of exactly that release) must both be set for update checks and rollbacks to work.

### 3.2 Runtime checks
```js
const GEN = game.release.generation;            // 14 (number); game.release.version "14.369"; game.version same string
const isV14 = GEN >= 14;
foundry.utils.isNewerVersion(game.version, "13.999");   // equivalent, string compare by parts
```
Order of preference: (1) feature-detect (`typeof _loc === "function"`, `"modes" in CONFIG.ChatMessage`, `foundry.data.operators?.ForcedDeletion`), (2) generation check, (3) separate files loaded through dynamic `import()` per generation. Avoid UA-style `game.version.startsWith`.

### 3.3 Dual-version recipes
```js
// Forced deletion / replacement in updates (_del/_replace are v14-only globals; legacy keys work in 13 and warn in 14)
await actor.update(GEN >= 14 ? {"system.old": _del} : {"system.-=old": null});
await actor.update(GEN >= 14 ? {"system.map": _replace(obj)} : {"system.==map": obj});

// Chat visibility
const mode = GEN >= 14 ? {messageMode: "gm"} : {rollMode: CONST.DICE_ROLL_MODES.PRIVATE};
await roll.toMessage({speaker}, mode);

// Active effect changes
const changes = effect.system?.changes ?? effect.changes;                 // 14 : 13
const change = GEN >= 14 ? {key, type: "add", value: 2, phase: "initial"} : {key, mode: CONST.ACTIVE_EFFECT_MODES.ADD, value: "2"};
// duration: 14 {value, units}, 13 {rounds|turns|seconds}
const duration = GEN >= 14 ? {value: 3, units: "rounds"} : {rounds: 3};

// Status effects registry (works in both)
CONFIG.statusEffects.push({id: "blessed", name: "MYSYS.Blessed", img: "icons/svg/aura.svg"});

// Localization (works in both): game.i18n.localize(key) / game.i18n.format(key, {x})
// Namespaced classes that exist in both
const {HandlebarsApplicationMixin, DocumentSheetV2, DialogV2} = foundry.applications.api;
const {ActorSheetV2, ItemSheetV2} = foundry.applications.sheets;      // use V2 names (aliases without suffix exist only in 14)
const TextEditorImpl = foundry.applications.ux.TextEditor.implementation;
const renderTemplate = foundry.applications.handlebars.renderTemplate;
```
- Region vs MeasuredTemplate: branch on `foundry.documents.MeasuredTemplateDocument` use only under `GEN < 14`; for 14 create `RegionDocument`s.
- Scene background: v13 `scene.background.src`; v14 `scene.levels.contents[0].background.src` (initial level `scene.initialLevel`).
- `Hooks.on("getSceneControlButtons", ...)`: same shape in 13 and 14.
- Hook handlers for rendered apps: `(app, element)` same in both 13 and 14.
- TinyMCE: gone in 14 - never reference `tinyMCE`.
- CSS: don't rely on core selectors that changed between versions; use your own classes and CSS variables.
- Data migration: write `static migrateData(source)` on your DataModels (must `return` the data) to upgrade world data; guard destructive migrations with `game.release` or a stored `systemMigrationVersion` flag; run world-level migrations in `ready` for GM only.
- Test both: run the sandbox harness against a v13 and v14 install (`FOUNDRY_APP_PATH`, see testing.md) and watch for warnings with `CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.ERROR`.

### 3.4 Strategy
- Default new work to `minimum: "13"`, `verified: "14"` and write AppV2/DataModel code; only add shims for the handful of divergences above (effects, message modes, operators, regions/levels, `_loc`).
- Drop v12 support: V2 sheets were incomplete there and V1 cores differ; v13 is the practical floor.
- Re-check `grep -rn "logCompatibilityWarning" client common` after every Foundry update; v14 deprecations are removed in v16 and v13 shims (globals) in v15.

---

## 4. Reading deprecation warnings

Every deprecation goes through `foundry.utils.logCompatibilityWarning(message, {since, until, details, stack=true, once=false, mode})` (`common/utils/logging.mjs`). Console output looks like:

```
Error: You are accessing the global "renderTemplate" which is now namespaced under foundry.applications.handlebars.renderTemplate
Deprecated since Version 13
Backwards-compatible support will be removed in Version 15
    at ... (modules/my-module/scripts/main.mjs:42:5)     <- the line that is yours
```
- Line 1: what and the replacement. "Deprecated since Version N" and "removed in Version M" come from `since`/`until`. The **stack lists the calling file**: look for `/systems/<id>/` or `/modules/<id>/` frames; core frames are Foundry's own use (ignore).
- Many are `once: true` (shown once per distinct stack); reload to see them again.
- Severity is global config (read at call time):
```js
CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.WARNING; // 1 default: console.warn with stack
// SILENT 0: nothing   WARNING 1: logger.warn   ERROR 2: logger.error   FAILURE 3: THROWS an Error (breaks the call site - use to hunt calls in tests)
CONFIG.compatibility.includePatterns.push(/\/systems\/my-system\//);   // only warnings whose message OR stack matches (RegExp)
CONFIG.compatibility.excludePatterns.push(/\/modules\/noisy-module\//); // excludes win over includes
```
  Set it in your own `init` hook (or earlier via a top-level module script) while developing; to catch warnings during boot use `mode = FAILURE` plus an include filter on your package path so third-party noise doesn't abort startup. The harness (`fvtt-browser.mjs`) collects these in its `deprecations` array.
- Package/manifest problems are different: they appear in Setup (package warnings icon) and in the server log (`template.json` warning, bad `compatibility`, unknown keys), not through `logCompatibilityWarning`.
- Data-level shims (`migrateData`/`shimData`) also warn (e.g. `You are accessing ActiveEffect#changes ...` style messages through `_addDataFieldShim`); they fire when you read the old property path.
- To enumerate everything the installed Foundry deprecates (messages with since/until): `grep -rn "logCompatibilityWarning" "$APP/client" "$APP/common"` or `node ~/.claude/skills/foundry-vtt-dev/scripts/fvtt-api.mjs deprecations <Name>`; `@deprecated since vN` JSDoc tags exist for items without runtime warnings.
- Typical triage: warning -> grep message text in `client/` to see the replacement -> fix -> reload with `mode = FAILURE` + include filter to prove zero remaining hits from your package.

---

## 5. Appendix: deprecation inventory (v14.369)

Generated by scanning every `logCompatibilityWarning` call (270 sites). Counts: 140 are `since 14 -> until 16`, ~105 are `since 13 -> until 15`, a few older (`since 11/12 -> 16`).

### 5.1 Deprecated in v14, removed in v16 (still work now)
| Area | Old -> new |
|---|---|
| Data operators | `"-=k": null`, `"==k": v` keys -> `_del` / `_replace(v)` (`ForcedDeletion` / `ForcedReplacement`); `mergeObject` option `performDeletions` -> `applyOperators`; `utils.applySpecialKeys` -> `applyDataOperators`; `utils.objectsEqual` -> `equals`; `URL.parseSafe` -> native `URL.parse` |
| DataModel/fields | `DataField#migrateSource` -> `DataField#_migrate(value, options, _state)`; `migrateData` that returns nothing; `cleanData({source})` option; `DataModelValidationFailure#isEmpty/fallback` renamed; `BaseScene#fog.exploration` -> `fog.mode` |
| ActiveEffect | `effect.changes` -> `system.changes`; numeric `change.mode` -> `type`; `duration.seconds/rounds/turns/type/duration` -> `duration.value/units/seconds`; `start` fields; `apply/applyField/_apply*` -> `applyChange*/_applyChange*`; `getInitialDuration` -> `getEffectStart`; `Actor#applyActiveEffects()` without phase; `CONST.ACTIVE_EFFECT_MODES` |
| Chat/roll modes | `rollMode` option (Roll#toMessage, ChatMessage.create, RollTable#draw/drawMany, Combat#rollInitiative) -> `messageMode`; `ChatMessage#applyRollMode` -> `applyMode`; `CONFIG.Dice.rollModes` -> `CONFIG.ChatMessage.modes`; `CONST.DICE_ROLL_MODES`; setting `core.rollMode` -> `core.messageMode`; `ChatLog.MESSAGE_PATTERNS`/`MULTILINE_COMMANDS` -> `CHAT_COMMANDS` |
| Templates -> Regions | `MeasuredTemplate`, `MeasuredTemplateDocument`, `MeasuredTemplateConfig`, `TemplateLayer`, `MeasuredTemplate.get*Shape`, `Scene#templates`, `CONST.MEASURED_TEMPLATE_TYPES`, `CONFIG.MeasuredTemplate.types`, `TEMPLATE_CREATE` permission, settings `core.gridTemplates`/`core.coneTemplateType`, `TeleportTokenRegionBehaviorType#destination` -> `destinations`, `RegionShape` -> `BaseShapeData`, `RegionDocument#regionShapes` -> `shapes`, `TileDocument#occlusion.mode` -> `modes` |
| Scene Levels | `Scene#background`, `#foreground`, `#backgroundColor`, `#foregroundElevation`; `Scene#createThumbnail(img)`; `ImageHelper#createThumbnail` return `.src/.texture` |
| Canvas config | `CONFIG.<Doc>.layerClass` -> `CONFIG.Canvas.layers.<name>.layerClass`; `PlaceablesLayer.CREATION_STATES`; `PlaceablesLayer#getDocuments` -> `viewedDocuments`; `CONST.WALL_SENSE_TYPES/WALL_DIRECTIONS` -> `EDGE_*`; `PointSourcePolygon.WALL_DIRECTION_MODES`; `ClockwiseSweepPolygon` `wallDirectionMode`, `edgeOptions` -> `edgeTypes`, `"universal"` type; `CanvasEdges#inititalize/refresh`; `CanvasOcclusionMask#updateOcclusion` |
| Tokens | `findMovementPath` `ignoreWalls/ignoreCost/history` -> `constrainOptions`; `Token#getMovementAdjustedPoint`; `Tile.createPreview`; `PlaceableObject#clear` |
| Particles/shaders | `ParticleEffect`, `PrimaryParticleEffect` -> `ParticleGenerator`; `ParticleGenerator` `perFrame/maxParticlesPerFrame/alphaRange/scaleRange/rotationSpeed`; shader `fragmentShader/vertexShader` getters -> `_createFragmentShader/_createVertexShader`; `ControlIcon` `refresh/rect/tintColor/borderColor/iconSrc`, null tint |
| UI | `ContextMenuEntry#name/condition/callback` -> `label/visible/onClick`; `ContextMenu.eventListeners`, `TooltipManager#activateEventListeners`, `ProseMirrorMenu.eventListeners` -> `activateListeners`; `ClientKeybindings#moveKeys` -> `game.keyboard.moveKeys`; `foundry.prosemirror.defaultPlugins` -> `ProseMirrorEditor.buildDefaultPlugins()`; `ProseMirrorEditor` constructor signature; `AmbientLightConfig#preview`; `TextureLoader.fetchResource/getCacheBustURL/hasTextExtension`, `foundry.canvas.srcExists` -> `foundry.utils.*`; `ClientDocument#getRelativeUUID` -> `utils.buildRelativeUuid`; `DocumentIndex#_addLeaf`; `Scenes#preload(push)` -> `{broadcast}` |
| Actor/Combat | `Combat#getCombatantByActor/Token` -> plural (until 15); `Actor#getDependentTokens` default `concreteOnly` flips in 15 |

### 5.2 Deprecated in v13, removed in v15
| Area | Old -> new |
|---|---|
| All bare globals listed in 1.3 | `foundry.<path>` |
| Hooks | `renderChatMessage`, `chatBubble`; `ChatBubbles#container` -> `element`; `ChatMessage#getHTML` -> `renderHTML` |
| Apps | `ContextMenu` with jQuery (pass `HTMLElement`; set `jQuery: false`); `_expandUp`, `#menu` -> `expandUp`, `#element`; `SceneControlTool#onClick` -> `onChange`; `SceneControls#activeControl/activeTool/initialize`; `Hotbar#macros/collapse/expand`; `Sidebar#activateTab` -> `changeTab`; `TokenHUD#toggleStatusTray` -> `togglePalette("effects")`; `BasePlaceableHUD#clear` -> `close`; `CombatTracker#initialize`; `SceneNavigation.displayProgressBar` -> `Notifications#notify({progress:true})`; `ImagePopout` needs `options.src` / `window.title`; `DocumentDirectory` private-ish members (`_onClickEntryName` -> `_onClickEntry`, `_toggleFolder` -> `_onToggleFolder`, `canCreateEntry` -> `_canCreateEntry`); `DiceConfig.SETTING`, `ModuleManagement.CONFIG_SETTING`; `FrameViewer` removed; `{{rangePicker}}`; `TooltipManager` `content` option -> `html`; `Game#togglePause(push)` and `Game#scaleFonts` -> `configureUI`; `foundry.applications.parseHTML` -> `foundry.utils.parseHTML`; `foundry.utils.SortingHelpers.performIntegerSort` -> `utils.performIntegerSort` |
| Documents | `ClientDocument.createDialog/deleteDialog` and `Folder.createDialog` signatures; `TableResult#text/documentId/documentCollection/getChatText` (use `name`/`description`/`documentUuid`/`getHTML`); `TokenDocument#hexagonalShape` -> `shape`; `CONST.TOKEN_HEXAGONAL_SHAPES` -> `TOKEN_SHAPES`; `CONST.TABLE_RESULT_TYPES.COMPENDIUM` -> `DOCUMENT`; `CONST.FILE_CATEGORIES.MEDIA`; `Set#isSubset` -> `isSubsetOf` |
| Movement | `DatabaseUpdateOperation#teleport/forced` -> `waypoints`/movement `action`; `movement.segments/teleport/forced` properties; region events `TOKEN_PRE_MOVE`, `TOKEN_MOVE`, `BEHAVIOR_STATUS`; `Region#bottom/top/shapes/polygons/clipperPaths/triangulation/testPoint/segmentizeMovement`, `Token#testInsideRegion/segmentizeRegionMovement/getSize`, `Token#target` (now `targetArrows`/`targetPips`); `EffectsCanvasGroup#testInsideLight/testInsideDarkness/getDarknessLevel` take `ElevatedPoint`; `SoundsLayer#_syncPositions`, `PointSoundSource#getVolumeMultiplier` take `ElevatedPoint`; `Wall#initializeEdge` -> `WallDocument#initializeEdge`; `BaseRuler#clear/update`, `Ruler#color/ruler`; `DetectionMode#BASIC_MODE_ID` static; `CONFIG.Canvas.transcoders` (KTX2 always on); `CanvasVisibilityTest#elevation` |

### 5.3 Older deprecations pushed to v16
AppV1 (`Application`, `FormApplication`, `Dialog`, `DocumentSheet` globals and `foundry.appv1.*`, V1 sheets); `{{filePicker}}` helper and `FormApplication#filepickers`; `AdventureImporter#_prepareImportData/_importContent` (use `Adventure#prepareImport/importContent`); `MeasuredTemplate#borderColor/fillColor/owner`; `CalendarData.formatAgo` `short` option; `PrimaryCanvasGroup#hoverFadeElevation`; manifest `template.json` (server warning).

---

## 6. Appendix: API surface diff v13 -> v14
Computed by diffing the published TypeDoc navigation of `/api/v13/` and `/api/` (v14).

**New classes (selected)**: `documents.Level`/`BaseLevel`; `data.ActiveEffectTypeDataModel`; `data.operators.{DataFieldOperator,ForcedDeletion,ForcedReplacement}`; shapes `data.{ConeShapeData,EmanationShapeData,GridShapeData,LineShapeData,RingShapeData,TokenShapeData}` and `foundry.{Circle,Cone,Ellipse,Polygon,Rectangle}ShapeData`; `data.PolygonTree(Node)`; `data.fields.{DataModelSchemaField,GridOffsetField,GridOffsetsField,SceneLevelsSetField,ShapesField}`; `applications.ux.{Autocomplete,FilterMenu}`; `applications.elements.{HTMLAutocompleteTagsElement,HTMLFormulaInputElement,AdoptableHTMLElement,HTMLGridOffset2DTagsElement}`; `applications.apps.{FormulaEditor,ShapeConfig}`; `applications.sheets.{LevelConfig,PlaceableConfig,palette.*}`, journal `JournalEntryPageHTMLSheet/CodeMirrorSheet`; sidebar tabs `{AmbientLightTab,AmbientSoundTab,DrawingTab,NoteTab,RegionTab,TileTab,TokenTab,WallTab,PlaceableTab}`; `canvas.animation.{CanvasShakeEffect,ParticleGenerator}`; `canvas.vfx.*` (VFXEffect, VFXComponent, ...); `canvas.{KTX2Parser,TransitionContainer}`; `canvas.geometry.ElevatedSurfaceExposureGenerator`; `helpers.ActiveEffectRegistry`; `foundry.PlaceablePalette`.
**New hooks (8)**: `activateEditorLegacy`, `closeDetachedWindow`, `openDetachedWindow`, `getPlaceableContextOptions`, `initializeSoundSources`, `planToken`, `preRenderApplication`, `soundsRefresh`. (v12 -> v13 added 26: `renderApplicationV2`, `closeApplicationV2`, `getHeaderControlsApplicationV2`, `renderChatMessageHTML`, `chatBubbleHTML`, `moveToken`, `preMoveToken`, `stopToken`, `pauseToken`, `recordToken`, `activateCanvasLayer`, `clientSettingChanged`, `renderChatInput`, `chatInput`, `streamReady`, `getDocumentContextOptions`, `applyCompendiumArt`, `configureCanvasEnvironment`, `initializeCanvasEnvironment`, `initializeCombatConfiguration`, `initializeEdges`, `initializePriorityLightSources`, `initializeVisionMode`, plus `renderApplicationV1`/`closeApplicationV1`/`getApplicationV1HeaderButtons`; removed: `renderApplication`, `closeApplication`, `getApplicationHeaderButtons`, `getApplicationEntryContext`, `renderChatMessage`, `chatBubble`, `initializeDarknessSources`.)
**New `foundry.utils`**: `applyDataOperators`, `buildRelativeUuid`, `closestPointToPath`, `equals`, `expandObjectInPlace`, `isElementInstanceOf`, `isPlainObject`, `iterateEntries/Keys/Values`, `objectEntries/Keys/Values`. Renamed: `applySpecialKeys` -> `applyDataOperators`, `objectsEqual` -> `equals`.
**Gone from the docs tree (deprecated shims remain in code)**: `MeasuredTemplate`, `MeasuredTemplateDocument`, `BaseMeasuredTemplate`, `MeasuredTemplateConfig`, `TemplateLayer`, `RegionLegend`, `data.regionShapes.*`, `canvas.containers.ParticleEffect`, `canvas.primary.PrimaryParticleEffect`, `appv1.sheets.JournalTextTinyMCESheet`.
