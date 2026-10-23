# Canvas, tokens, regions, scene controls (Foundry v14)

Verified against v14 build 369 (`client/canvas/*`, `client/documents/token.mjs`, `region.mjs`, `client/data/region-behaviors/*`,
`client/applications/ui/scene-controls.mjs`, `common/grid/*`) and SWADE. Most systems need only sections 1-5; skim the rest when needed.

## Table of contents
1. [Obsolete patterns and v14 changes](#1-obsolete-patterns-and-v14-changes)
2. [Readiness and global access](#2-readiness-and-global-access)
3. [Document vs placeable vs actor](#3-document-vs-placeable-vs-actor)
4. [Selecting and targeting](#4-selecting-and-targeting)
5. [Moving tokens](#5-moving-tokens)
6. [Measuring distance](#6-measuring-distance)
7. [Regions replace templates](#7-regions-replace-templates)
8. [Custom region behaviors](#8-custom-region-behaviors)
9. [Scene controls](#9-scene-controls)
10. [Custom canvas layers](#10-custom-canvas-layers)
11. [Token HUD, status effects, rulers](#11-token-hud-status-effects-rulers)
12. [Levels and elevation](#12-levels-and-elevation)
13. [Misc APIs and pitfalls](#13-misc-apis-and-pitfalls)

---

## 1. Obsolete patterns and v14 changes

| Obsolete | Modern |
|---|---|
| `Token`, `Wall`, `Canvas`, `Ruler`, `PlaceableObject`, `TokenLayer` as bare globals | `foundry.canvas.placeables.Token`, `foundry.canvas.placeables.Wall`, `foundry.canvas.Canvas`, `foundry.canvas.interaction.Ruler`, `foundry.canvas.placeables.PlaceableObject`, `foundry.canvas.layers.TokenLayer`. Only `canvas` (instance) and document classes (`TokenDocument`, `Scene`...) remain global. |
| `getSceneControlButtons` with an array (`controls.push`, `control.tools.push`, `onClick`) | `controls` is a Record: `controls.tokens.tools.myTool = {name, title, icon, order, button\|toggle, onChange}`. See section 9. |
| `MeasuredTemplate` documents, `canvas.templates`, `MeasuredTemplate.create()`, `new MeasuredTemplate(doc).drawPreview()` | **Deprecated v14.** Use Regions: `canvas.regions.placeRegion(data)`; see section 7. `canvas.templates` still exists only as a preview-only shim; `CONFIG.MeasuredTemplate` is `@deprecated`; settings `core.gridTemplates` and `core.coneTemplateType` are deprecated without replacement. |
| `canvas.grid.measureDistance(a, b)` / `measureDistances` / `Ray` distance math | `canvas.grid.measurePath([a, b]).distance`; see section 6. |
| `token.update({x, y})` assuming a plain property edit | Still works but is routed through the movement system (history, ruler, regions, walls). Prefer `tokenDocument.move(...)`; see section 5. |
| `canvas.tokens.controlled[0].data.x` | Document data has lived on `.document` since v10: `token.document.x`. `.data` does not exist. |
| `canvas.tokens.placeables.filter(...)` for "tokens in this scene" | `placeables` only holds drawn placeables. Scene data: `canvas.scene.tokens` (TokenDocuments, works without a canvas). With Levels, iterate `canvas.tokens.viewedDocuments()`. |
| `layer.getDocuments()` | Deprecated v14, use the `viewedDocuments()` generator (Levels-aware). |
| `CONFIG.Token.layerClass`, `CONFIG.Wall.layerClass`... | Deprecated v14: `CONFIG.Canvas.layers.tokens.layerClass`. |
| `token.toggleEffect(...)`, `TokenDocument#toggleActiveEffect` | `await actor.toggleStatusEffect("prone", {active: true})` (Actor method), `tokenDocument.hasStatusEffect(id)` |
| `Hooks.once("canvasReady", ...)` for per-scene work | `canvasReady` fires on **every** scene view; use `Hooks.on` and re-initialize. Register `once` only for one-time setup. |
| Reading `canvas.scene` / `canvas.tokens` before the canvas is ready | Guard with `canvas.ready`. |

v14 canvas-relevant changes: scene **Levels** (`Level` documents, `canvas.level`, token `level`/`elevation`/`depth`), templates replaced by Regions (new region shapes `cone ring line emanation token grid`, `placeRegion`, region attachment to tokens), `PlaceablesLayer#viewedDocuments`, `canvas.tokens.placeTokens` interactive placement, `RegionLayer.templateMode`, token ruler/movement actions refinements, `CONFIG.Canvas.layers` layer registry.

---

## 2. Readiness and global access

```js
if (!canvas.ready) return;          // canvas.ready is false until canvasReady and while switching scenes
canvas.scene                        // Scene document currently drawn (null if blank)
canvas.level                        // Level document currently viewed (v14)
canvas.dimensions                   // {size, distance, distancePixels, width, height, rect, sceneRect, uiScale, ...}
canvas.grid                         // grid instance: .type (CONST.GRID_TYPES), .size, .distance, .units, measurePath(), getOffset()...
canvas.tokens / canvas.walls / canvas.lighting / canvas.sounds / canvas.notes / canvas.tiles / canvas.drawings / canvas.regions / canvas.controls
canvas.stage, canvas.app            // PIXI
canvas.mousePosition                // last canvas-space pointer position
```
Lifecycle: `canvasInit` (before drawing) -> `canvasDraw` -> layers `draw<LayerName>` -> `canvasReady` (drawn, interactive) -> later `canvasTearDown` (scene switch). Hooks that want placeables must be `canvasReady` or later.

Code that must run without a canvas (no scene, `noCanvas` setting, headless) should use documents (`game.scenes`, `scene.tokens`, `scene.grid`, `scene.dimensions`) rather than `canvas.*`. `scene.grid` (BaseGrid) is available without the canvas; `canvas.grid` is the same object for the viewed scene.

---

## 3. Document vs placeable vs actor

| Thing | Class | How to get it | Use for |
|---|---|---|---|
| `TokenDocument` | `foundry.documents.TokenDocument` | `canvas.scene.tokens.get(id)`, `token.document`, `actor.token`, `actor.getActiveTokens(false, true)` | data, updates, ownership, movement API |
| `Token` (placeable) | `foundry.canvas.placeables.Token` | `canvas.tokens.get(id)`, `canvas.tokens.controlled`, `tokenDocument.object`, `actor.getActiveTokens()` | visuals, vision, animation, HUD, `control()`, `setTarget()`, `planMovement()` |
| `Actor` | `foundry.documents.Actor` | `token.actor` / `tokenDocument.actor` (synthetic for unlinked), `game.actors.get(id)` (world/base actor), `tokenDocument.baseActor` | game rules data |

```js
const token = canvas.tokens.controlled[0];     // Token placeable | undefined
const doc = token.document;                    // TokenDocument; doc.x doc.y doc.elevation doc.name doc.texture.src
const actor = token.actor;                     // same as doc.actor: for UNLINKED tokens this is a synthetic actor holding a delta
doc.isLinked;  actor.isToken;  actor.token;    // actor.token is the TokenDocument (null for world actors)
await actor.update({"system.hp.value": 3});    // on an unlinked token's actor: writes the token's ActorDelta, not the world actor
doc.actor.uuid                                 // "Scene.x.Token.y.Actor.z" for synthetic actors; always pass uuids over sockets
const tokens = actor.getActiveTokens();        // Token[] drawn in the current scene (empty if canvas not ready); (true) linked only; (false, true) => TokenDocument[]
```
Rules:
- Update **documents**, never placeable properties. `token.document.update({...})`, `canvas.scene.updateEmbeddedDocuments("Token", [...])`. Placeable fields are refreshed from the document.
- Unlinked tokens: `actor.update` affects only that token; use `doc.baseActor` for the world actor. `game.actors.get(actor.id)` for a synthetic actor returns the base actor, not the same data.
- Token data lives in embedded documents even when the canvas is empty; placeables exist only for the viewed scene and may be missing (`doc.object` null, `doc.rendered` false) for hidden/other-level tokens.
- Token hooks for data changes: `updateToken(doc, changed, options, userId)`; visuals: `refreshToken(token, flags)`.
- `CONFIG.Token.documentClass`, `objectClass` (placeable), `rulerClass`, `hudClass`, `prototypeSheetClass` are all overridable in `init`.

---

## 4. Selecting and targeting

```js
canvas.tokens.controlled        // Token[] currently selected by this user (the old "controlled" array). Layer must be active for control()
canvas.tokens.controlledObjects // Map<id, Token>
canvas.tokens.ownedTokens       // Token[] this user owns
token.control({releaseOthers: true});  token.release();  canvas.tokens.releaseAll(); canvas.tokens.controlAll()
token.controlled                // boolean
game.user.targets               // UserTargets (Set<Token>): this user's targets (+ .ids)
token.setTarget(true, {releaseOthers: false});   // add/remove a target
canvas.tokens.setTargets(ids, {mode: "replace"}) // set by ids
token.isTargeted
```
- `controlled` only contains tokens on the **currently active layer** that are controlled. Switching to another control layer (Walls, Lighting) releases tokens (`activate/deactivate`).
- Targets are per user and per scene. `Hooks.on("targetToken", (user, token, targeted) => {})` and `controlToken(token, controlled)` fire for all users.
- Fallback chain used by chat for speakers: controlled token -> `game.user.character`. For a rules action, resolve in this order: explicit arg -> `canvas.tokens.controlled` (one) -> `game.user.character`; warn if ambiguous. Always null-check, `controlled[0]` is `undefined` if nothing is selected.
- Owner check: `token.isOwner`, `token.document.isOwner`, `actor.isOwner`. Observers: `token.observer`.
- Pointer-event hooks and drops: `dropCanvasData(canvas, data, event)` (return false to consume the drop; data has `x`, `y`, `type`, `uuid`). Actor drops are converted to tokens by `TokenLayer#_onDropActorData`.

---

## 5. Moving tokens

v13 introduced a movement API; v14 uses it for every position change (drag, keyboard, `update`).

```js
// Simple absolute move with animation; resolves true when the full movement completed
const done = await tokenDoc.move({x: 500, y: 300});            // animated, recorded in movement history, respects walls
await tokenDoc.move([{x: 100, y: 100}, {x: 400, y: 100, action: "swim", checkpoint: true}],
  {autoRotate: true, showRuler: true, constrainOptions: {ignoreWalls: false, ignoreCost: true}});
await tokenDoc.move({x: 800, y: 300}, {animate: false});       // no animation
await tokenDoc.update({x: 800, y: 300});                       // equivalent to move for x/y updates, return value differs
await tokenDoc.resize({width: 2, height: 2});                  // keeps centre
await canvas.scene.moveTokens({[doc.id]: {destination: {x, y}}}, options);   // several tokens
tokenDoc.stopMovement(); tokenDoc.pauseMovement(key); tokenDoc.resumeMovement(movementId, key);
await tokenDoc.revertRecordedMovement();                       // undo recorded moves
tokenDoc.movementHistory; tokenDoc.movement                    // recorded/current movement data
tokenDoc.measureMovementPath(waypoints, {cost, aggregator});   // GridMeasurePathResult incl. terrain cost
token.planMovement({...}) / token.findMovementPath(...)        // placeable-level UI/pathfinding helpers
```
Waypoint fields: `x y elevation width height depth shape level action snapped explicit checkpoint` (`x,y` = top-left pixels, integers). Options: `method` (`"api"` default), `autoRotate`, `showRuler`, `animate`, `animation{duration, movementSpeed, easing}`, `pan`, `planned`, `constrainOptions`, `terrainOptions`, `measureOptions`.

Hooks: `preMoveToken(doc, movement, operation)` (initiator only; return false to block; only `movement.autoRotate/showRuler` writable), `moveToken(doc, movement, operation, user)` (all clients), `pauseToken`, `stopToken`, `planToken`, `recordToken`. Override points on a custom `TokenDocument`: `_preUpdateMovement(movement, operation)`, `_onUpdateMovement`, `_onMovementStopped`, `_onMovementPaused`, `_onMovementRecorded`, `_shouldRecordMovementHistory()`, `_inferMovementAction()`.

Movement actions (`CONFIG.Token.movement.actions`, frozen after `init`): built-ins `walk fly swim burrow crawl climb jump blink displace`. Add/modify in `init`:

```js
foundry.utils.mergeObject(CONFIG.Token.movement.actions, {
  swim: { getCostFunction: (token, options) => (cost, from, to, distance, segment) => cost * 2 },   // SWADE pattern
  sprint: { label: "MYSYS.Move.sprint", icon: "fa-solid fa-person-running", img: null, order: 9,
            teleport: false, measure: true, walls: "move", visualize: true,
            canSelect: (token) => !!token.actor?.system.canSprint,
            getAnimationOptions: () => ({movementSpeed: 12}), deriveTerrainDifficulty: null,
            getCostFunction: () => (cost) => cost }
});
CONFIG.Token.movement.defaultSpeed = 6;                     // grid spaces per second animation
CONFIG.Token.movement.costAggregator = (results, distance, segment) => Math.max(...results.map(r => r.cost));
```
`label` and `icon` are required on every action; `CONFIG.Token.movement.defaultAction` must exist. `CONFIG.Token.movement.TerrainData` customizes terrain data used by the "Modify Movement Cost" region behavior.

Pixel positions: token `x,y` is the top-left; centre = `token.center` (placeable) or `tokenDoc.object.center`; snap to grid with `canvas.grid.getSnappedPoint(point, {mode: CONST.GRID_SNAPPING_MODES.CENTER})`.

---

## 6. Measuring distance

```js
const a = tokenA.center, b = tokenB.center;                      // {x, y} in pixels
const m = canvas.grid.measurePath([a, b]);                       // GridMeasurePathResult (respects grid type, diagonal rules)
m.distance   // in scene distance units (feet/squares...), m.spaces, m.diagonals, m.cost, m.euclidean
m.segments, m.waypoints   // per-segment/waypoint breakdown
const m3 = canvas.grid.measurePath([{...a, elevation: 0}, {...b, elevation: 10}]);   // 3D aware

canvas.grid.units;   canvas.dimensions.distance;   canvas.dimensions.distancePixels   // units, distance per grid space, pixels per distance unit
canvas.grid.type === CONST.GRID_TYPES.GRIDLESS
```
- Diagonal rule is a world setting (`core.gridDiagonals`) interpreted by the square/hex grid classes (`CONST.GRID_DIAGONALS`). Systems that need custom diagonal costs pass `{cost: (from, to, distance, segment) => number}` or override `CONFIG.Token.movement`.
- Token-to-token edge distance (adjacency): measure between occupied offsets, e.g. `tokenDoc.getOccupiedGridSpaceOffsets()`, `canvas.grid.getAdjacentOffsets(offset)`, `canvas.grid.testAdjacency(a, b)`; or measure centre-to-centre minus half sizes in gridless.
- Grid geometry helpers: `grid.getOffset(point)`, `getCenterPoint(offset)`, `getTopLeftPoint`, `getSnappedPoint`, `getShiftedPoint`, `getDirectPath`, `getCircle(center, r)`, `getCone(origin, radius, direction, angle)`, `getRectangle`, `getLine`.
- Wall collision: `CONFIG.Canvas.polygonBackends.move.testCollision(a, b, {type: "move", mode: "any"})`, or `token.checkCollision(destination, {type, mode})`.
- Do not use `Ray` + `canvas.dimensions.size` arithmetic for gameplay distances; it ignores grid rules.

---

## 7. Regions replace templates

AoE templates are now Regions with typed shapes (so tokens inside can be queried and behaviors can react).

```js
// interactive placement (cursor preview, wheel to rotate, click to confirm, right-click to skip a shape)
const region = await canvas.regions.placeRegion({
  name: "Fireball",
  shapes: [{ type: "circle", x: 0, y: 0, radius: 20 * canvas.dimensions.distancePixels, gridBased: true }],   // x,y are overwritten by placement
  color: game.user.color,
  restriction: {enabled: false},
  levels: [canvas.level.id],                                  // core examples always set it; a restricted region must be in exactly one level
  highlightMode: "coverage", displayMeasurements: true,
  visibility: CONST.REGION_VISIBILITY.ALWAYS,
  ownership: {[game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER}
}, { create: true, attachToToken: false });                    // returns RegionDocument or null if cancelled
// Creating a Region needs the REGION_CREATE user permission (players can have it); only GMs can create Regions that
// have Behaviors; non-GM placement is refused while the game is paused (create:true).

// who is inside?
const inside = [...region.tokens];                                                     // TokenDocuments currently in the region (kept up to date by the server/GM)
tokenDoc.testInsideRegion(region);                                                     // test one token
region.testPoint({x: pt.x, y: pt.y, elevation: 0});                                    // point test takes an ElevatedPoint, not a bare {x,y}

// create programmatically (no preview)
await canvas.scene.createEmbeddedDocuments("Region", [{ name: "Cone", shapes: [{type: "cone", x, y, radius: 15 * canvas.dimensions.distancePixels, angle: 90, rotation: 45, curvature: "flat"}], levels: [canvas.level.id] }]);
await region.delete();                                                                  // cleanup
```
Shape types: `rectangle` (x y width height anchorX anchorY rotation), `circle` (x y radius), `ellipse` (radiusX radiusY rotation), `polygon` (points), `cone` (x y radius angle rotation curvature `round|flat|semicircle`), `ring`, `line`, `emanation` (`base` shape + `radius`), `token` (token footprint), `grid`. All take `gridBased` (snap/measure on grid) and `hole`. Distances in `radius` are **pixels**: multiply by `canvas.dimensions.distancePixels` for scene units.

Other helpers: `canvas.regions.placeRegions([data...], opts)` for several, `region.spawnTokens(tokens, opts)`, `region.teleportToken(s)`, `canvas.tokens.placeTokens(data, opts)` (interactive token placement). Region events (`tokenEnter`, `tokenExit`, `tokenMoveIn/Out/Within`, `tokenAnimateIn/Out`, `tokenTurnStart/End`, `tokenRoundStart/End`, `behaviorActivated/...`) are listed in `CONST.REGION_EVENTS`.

Players' "template mode": `canvas.regions.templateMode` (true by default for non-GMs) turns the region tools into measured-template-style placement. Add system presets by extending `controls.regions.tools` in `getSceneControlButtons` (SWADE does this).

---

## 8. Custom region behaviors

A behavior is a `TypeDataModel` registered in `CONFIG.RegionBehavior.dataModels`.

```js
const { RegionBehaviorType } = foundry.data.regionBehaviors;

export class HazardBehavior extends RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["MYSYS.BEHAVIOR.TYPES.hazard", "BEHAVIOR.TYPES.base"];

  static defineSchema() {
    const f = foundry.data.fields;
    return {
      events: this._createEventsField({
        events: [CONST.REGION_EVENTS.TOKEN_ENTER, CONST.REGION_EVENTS.TOKEN_TURN_START],   // which events the UI offers
        initial: [CONST.REGION_EVENTS.TOKEN_ENTER]
      }),
      formula: new f.StringField({required: true, blank: false, initial: "1d6"}),
      once: new f.BooleanField()
    };
  }

  /** Called for each subscribed event. Runs on EVERY client that sees the event, so gate it. */
  async _handleRegionEvent(event) {
    if (!game.user.isActiveGM) return;                         // exactly one client acts
    const token = event.data.token;                            // TokenDocument
    const actor = token?.actor;
    if (!actor) return;
    const roll = await Roll.create(this.formula, actor.getRollData()).evaluate();
    await roll.toMessage({ speaker: ChatMessage.getSpeaker({ token }), flavor: this.region.name });
    await actor.applyDamage?.(roll.total);
    if (this.once) await this.parent.update({ disabled: true });
  }

  // Alternative: static map of handlers, always bound to the behavior instance
  // static events = { [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: async function (event) { ... } };

  /** Optional terrain contribution for pathfinding/cost */
  _getTerrainEffects(token, segment, options) { return []; }
}

Hooks.once("init", () => {
  CONFIG.RegionBehavior.dataModels.hazard = HazardBehavior;          // system: bare key; modules: "my-mod.hazard"
  CONFIG.RegionBehavior.typeIcons.hazard = "fa-solid fa-skull-crossbones";
  CONFIG.RegionBehavior.typeLabels.hazard = "MYSYS.BEHAVIOR.TYPES.hazard.label";   // optional (else TYPES.RegionBehavior.hazard)
});
```
Also register the type in the manifest `documentTypes.RegionBehavior`. Event objects: `{name, data, region, user}` where `user` is who triggered it (for movement events `data = {token, movement}`). Behavior convenience getters: `this.behavior`, `this.region`, `this.scene`. Core examples to copy: `client/data/region-behaviors/pause-game.mjs` (static `events`, `event.user.isSelf` for the mover, `game.user.isActiveGM` for the single actor), `display-scrolling-text.mjs` (per-client visual), `execute-macro.mjs`. Combat events (`tokenTurnStart`...) are triggered by `Combat` turn events on the active GM client but still delivered to all.

---

## 9. Scene controls

`getSceneControlButtons(controls)`: `controls` is `Record<string, SceneControl>`; built-in keys: `tokens regions drawings tiles walls lighting sounds notes` (plus any custom `InteractionLayer` that returns controls). Full example in `hooks-config-settings.md` 5.7. Key facts (`client/applications/ui/scene-controls.mjs`):

```js
Hooks.on("getSceneControlButtons", (controls) => {
  const tools = controls.tokens.tools;
  tools.mysysRoll = { name: "mysysRoll", title: "MYSYS.Roll", icon: "fa-solid fa-dice-d20",
                      order: Object.keys(tools).length, button: true, visible: true,
                      onChange: () => MyRollDialog.show() };
  tools.mysysAura = { name: "mysysAura", title: "MYSYS.Aura", icon: "fa-solid fa-circle-dot",
                      order: Object.keys(tools).length, toggle: true, active: false,
                      onChange: (event, active) => canvas.mysys?.toggleAuras(active) };
});
```
- SceneControlTool props: `name`, `order`, `title`, `icon`, `visible`, `toggle`, `active`, `button`, `interaction`, `control`, `creation`, `createData`, `shapeData`, `onChange(event, active)`, `toolclip`.
- SceneControl props: `name`, `order`, `title`, `icon`, `visible`, `tools`, `activeTool`, `onChange(event, active)`, `onToolChange(event, tool, active)`, `layer` (canvas layer name; enables the placeable palette).
- Changing `button`/`toggle`/`visible` dynamically: `ui.controls.render({reset: true})`. Activate programmatically: `ui.controls.activate({control: "tokens", tool: "select"})`.
- A tool with `button:true` and `toggle:true` is rejected (warning, `button` is cleared). A control with `visible:false` or zero visible tools (when it had tools) is removed.

---

## 10. Custom canvas layers

```js
class AuraLayer extends foundry.canvas.layers.InteractionLayer {
  static get layerOptions() {
    return foundry.utils.mergeObject(super.layerOptions, { name: "mysysAura", zIndex: 250 });  // name MUST equal the CONFIG key
  }
  async _draw(options) {                     // build PIXI display objects
    this.auras = this.addChild(new PIXI.Container());
    for (const token of canvas.tokens.placeables) this.#drawAura(token);
  }
  async _tearDown(options) { this.auras?.destroy({children: true}); this.auras = null; return super._tearDown(options); }
  _activate() { this.auras.visible = true; }
  _deactivate() { }
  toggleAuras(on) { this.auras.visible = on; }
  static prepareSceneControls() {            // optional: adds a control group automatically
    return { name: "mysysAura", order: 30, title: "MYSYS.Aura", icon: "fa-solid fa-circle-dot", tools: {}, onChange: (e, active) => { if (active) canvas.mysysAura.activate(); } };
  }
  #drawAura(token) { /* PIXI.Graphics at token.center */ }
}
Hooks.once("init", () => {
  CONFIG.Canvas.layers.mysysAura = { layerClass: AuraLayer, group: "interface" };   // groups: primary, effects, interface, ...
});
// later: canvas.mysysAura  (also canvas.interface.mysysAura)
```
Hooks for it: `drawAuraLayer`, `tearDownAuraLayer`, `activateAuraLayer`, `deactivateAuraLayer` (hook name = class name `AuraLayer`; override the `hookName` getter to change). Redraw your content on `refreshToken`/`canvasReady`. For purely decorative overlays (no interaction) extend `foundry.canvas.layers.CanvasLayer`. For a placeables layer you also need a Document, object class, and `CONFIG` entries; usually unnecessary: prefer Regions with behaviors or `PIXI` children on a token (`drawToken` hook).

PIXI additions to tokens: hook `drawToken(token)` / `refreshToken(token, flags)` and add children to `token`; remove them in `destroyToken`. Bars/effects: `CONFIG.Token.barConfig`, `token.drawBars()`.

---

## 11. Token HUD, status effects, rulers

**Status effects on tokens**
```js
// init: define (see hooks-config-settings.md for the CONFIG.statusEffects Proxy details)
CONFIG.statusEffects.push({ id: "stunned", name: "MYSYS.Status.stunned", img: "systems/mysys/icons/stunned.svg",
  hud: true,                                // or {actorTypes: ["character"]}; false hides it from the HUD
  statuses: ["stunned"], changes: [...] });  // ActiveEffect data merged into the created effect (v14: system.changes)
await actor.toggleStatusEffect("stunned", {active: true});      // creates/removes the ActiveEffect
actor.statuses.has("stunned");  tokenDoc.hasStatusEffect("stunned");
CONFIG.specialStatusEffects.DEFEATED = "dead";                  // ids with core behaviour (defeated marker in combat, blind, invisible, fly, burrow, hover)
Hooks.on("applyTokenStatusEffect", (token, statusId, active) => {});
```
Effect icons are drawn from the actor's temporary effects and statuses; `Token#_drawEffects`/`drawEffects()` can be overridden in a custom `CONFIG.Token.objectClass`.

**Token HUD** (`foundry.applications.hud.TokenHUD`, `CONFIG.Token.hudClass`): modify with the generic AppV2 hooks: `Hooks.on("renderTokenHUD", (hud, element, context, options) => { element.querySelector(".col.right")?.append(button); })`. The HUD's `hud.object` is the Token; `hud.document` the TokenDocument; status choices from `CONFIG.statusEffects` entries where `hud !== false`. Re-render with `canvas.tokens.hud.render()`.

**Ruler customization**
- Token drag ruler: `CONFIG.Token.rulerClass = MyTokenRuler` where `MyTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler`. Override `_getWaypointLabelContext(waypoint, state)` (returns the Handlebars context for `WAYPOINT_LABEL_TEMPLATE`: `{action, cssClass, secret, units, uiScale, position, distance{total,delta}, cost{total,units,delta}, elevation}`), `_getWaypointStyle(waypoint)` ({radius, shape, color, alpha}), `_getSegmentStyle(waypoint)` ({width, color, alpha}), `_getGridHighlightStyle(waypoint, offset)`, `_preparePath(path)`, `_shouldRenderWaypoint`. Waypoint data: `waypoint.measurement.{distance,cost,spaces}`, `.action`, `.actionConfig`, `.stage` (`passed|pending|planned`), `.unreachable`, `.userId`. SWADE colours segments by speed (`style.color = constants.RULER_COLORS...`).
- Measure tool ruler: `CONFIG.Canvas.rulerClass = MyRuler extends foundry.canvas.interaction.Ruler` with the same `_getWaypointLabelContext/_getWaypointStyle/_getSegmentStyle` hooks; access via `canvas.controls.ruler`.
- Custom label template: set `static WAYPOINT_LABEL_TEMPLATE = "systems/mysys/templates/ruler-label.hbs"` and preload with `loadTemplates`.

---

## 12. Levels and elevation

v14 scenes can have **Levels** (floors): embedded `Level` documents (`name`, `elevation.{bottom,top}`, background/foreground images, visibility) on `scene.levels`; the viewed one is `canvas.level`. Tokens/regions/lights etc. carry `level`/`levels` ids and `elevation`. Implications:
- Placeable lists respect the viewed level: use `layer.viewedDocuments()` and `canvas.tokens.placeables` (drawn only).
- Region data needs `levels: [canvas.level.id]`; tokens created from code: `actor.getTokenDocument({level: canvas.level.id, elevation: 0}, {parent: canvas.scene})`.
- `canvas.inferLevelFromElevation(elevation)`, `scene.levels.get(id)`, `scene.firstLevel`, `level.elevation.{bottom,top}`, `tokenDoc.includedInLevel(level)`.
- Ruler/terrain/movement are 3D aware (elevation, depth). Waypoints and `measurePath` take `elevation`.
- If you support v13, guard `canvas.level` (undefined there) and fall back to `canvas.scene`.

---

## 13. Misc APIs and pitfalls

```js
canvas.pan({x, y, scale}); await canvas.animatePan({x, y, scale, duration: 500});
canvas.ping(point, {style: "pulse"});             // broadcast ping; scene control ping tool
canvas.animatePan({...canvas.tokens.controlled[0]?.center, scale: 1.5});
Hooks.on("canvasPan", (canvas, position) => {});
foundry.canvas.animation.CanvasAnimation.animate([...], {name, duration});    // generic animation helper
ui.notifications.info("MYSYS.Message", {localize: true});
```
Pitfalls:
1. `canvas.ready` is false while the scene redraws; async code that awaits then touches `canvas.tokens` must re-check it.
2. Never mutate `token.x`; update the document. Do not call `token.refresh()` manually; set render flags (`token.renderFlags.set({refreshState: true})`) if needed.
3. Placeables are destroyed and recreated on scene change; cache ids, not objects.
4. Canvas hooks run on every client; guard document writes with `game.user.isActiveGM` or `userId === game.user.id`.
5. Heavy PIXI work belongs in `_draw`/`drawToken`, not in `refreshToken` (fires very often).
6. Vision/lighting: `token.hasSight`, `token.vision`, `canvas.visibility.testVisibility(point, {object})`; light sources via hooks `initializeLightSources`, `initializeVisionSources`.
7. Don't import canvas classes at module top level in code that loads before `foundry` globals exist; use `foundry.canvas.*` lazily inside functions or classes created in `init`. Class declarations that `extends foundry.canvas.layers.InteractionLayer` at top level are fine in ESM entry files because `foundry` is defined before esmodules run.
8. Token/Region/Level IDs are 16-char random ids; use UUIDs (`doc.uuid`) across clients.

Verify in source (under `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/client/`): `canvas/board.mjs` (Canvas), `canvas/layers/regions.mjs` (`placeRegion`), `canvas/layers/tokens.mjs`, `canvas/placeables/token.mjs`, `documents/token.mjs` (`move`, `measureMovementPath`), `documents/region.mjs`, `data/region-behaviors/`, `applications/ui/scene-controls.mjs`, `canvas/placeables/tokens/ruler.mjs`, and `../common/grid/base.mjs` (`measurePath`).
