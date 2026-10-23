# Documents and Database Operations (Foundry v14)

Ground truth: `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/` (`common/abstract/document.mjs`, `common/abstract/backend.mjs`,
`client/data/client-backend.mjs`, `client/documents/abstract/client-document.mjs`, `client/documents/{actor,item,active-effect,actor-delta,token}.mjs`,
`common/documents/*.mjs`, `common/data/operators.mjs`, `client/hooks.mjs`). Target v14 build 369. **[v13]** marks version differences.
Data models, fields, `prepareData`, and `_preCreate` on models are in `data-models.md`; this file is about Document classes and the database.

## Table of contents
1. Obsolete patterns -> modern
2. Class hierarchy, document list, custom Document classes
3. Collections, compendia, UUIDs
4. CRUD: create / update / delete and operation options
5. Update data: dot notation, arrays, `_del`, `_replace`, diff, recursive
6. Embedded documents (Actor items and effects)
7. Flags
8. Ownership and permissions; who may do what
9. Database hooks and lifecycle order
10. ActiveEffects (v14 rewrite), statuses
11. Tokens vs Actors (linked, unlinked, ActorDelta, prototype token)
12. Migrations
13. Gotcha checklist

---

## 1. Obsolete patterns -> modern

| Obsolete | Modern v14 |
|---|---|
| `actor.data.data.x`, `item.data.flags`, `doc.data.toObject()` | `actor.system.x`, `item.flags`, `doc.toObject()` |
| `game.actors.entities`, `Entity`, `entity.data` | `game.actors.contents` (or iterate the collection), `Document` |
| `actor.getOwnedItem(id)`, `actor.items.entries` | `actor.items.get(id)`, `actor.items.contents` / `[...actor.items]` |
| `actor.data.token`, `token.data.actorData` | `actor.prototypeToken`, `token.delta` / `token.actor` (synthetic) |
| `await actor.update({"data.hp.value": 3})` | `await actor.update({"system.hp.value": 3})` |
| `{"-=key": null}`, `{"==key": obj}` | `{key: _del}`, `{key: _replace(obj)}` (v14; legacy forms still work with deprecation warnings until v16). **[v13]** has no `_del`/`_replace` |
| `mergeObject`, `duplicate`, `getProperty`, `setProperty`, `expandObject`, `isObjectEmpty` as bare globals | `foundry.utils.mergeObject` / `deepClone` / `getProperty` / `setProperty` / `expandObject` / `isEmpty` |
| `fromUuid`, `fromUuidSync` | still global (alias of `foundry.utils.fromUuid`) |
| `CONFIG.Actor.entityClass` | `CONFIG.Actor.documentClass` |
| `effect.label`, `effect.icon`, `effect.flags.core.statusId` | `effect.name`, `effect.img`, `effect.statuses` (Set) |
| `effect.changes[].mode` (number), `CONST.ACTIVE_EFFECT_MODES` | `effect.system.changes[].type` (string), `CONST.ACTIVE_EFFECT_CHANGE_TYPES`. `effect.changes` is an alias getter; `mode` is a deprecated shim |
| `effect.duration.rounds/turns/seconds/startRound/startTime` | `duration.{value,units,expiry,expired}` + `effect.start.{time,combat,round,turn}` |
| `CONFIG.ActiveEffect.legacyTransferral` | removed (not in v14 source); item effects with `transfer: true` always apply to the owning actor |
| `CONFIG.statusEffects` entries with `label`/`icon`/`changes` | `name`/`img`/`system.changes` (old names still migrate) |
| `Hooks.on("preUpdateActor", (actor, data, options, userId))` expecting full data | `data` is the *changes* only; same signature |
| `new Actor(data)` expecting your custom class | `new Actor.implementation(data)` |
| `CONST.DICE_ROLL_MODES` | deprecated in v14: use `CONFIG.ChatMessage.modes` (chat details are in the dice/chat reference) |

---

## 2. Class hierarchy, document list, custom classes

```
foundry.abstract.DataModel
  foundry.abstract.Document                    (common/abstract/document.mjs: CRUD statics, flags, permissions, embedded ops)
    foundry.documents.BaseActor                (common/documents/actor.mjs: schema + metadata + permissions; runs on SERVER too)
      ClientDocumentMixin(BaseActor)           (client/documents/abstract/client-document.mjs: prepareData, sheets, apps, render, hooks forwarding)
        foundry.documents.Actor  (global `Actor`)    <- CONFIG.Actor.documentClass defaults to this
          YourActor extends Actor                    <- set CONFIG.Actor.documentClass = YourActor in `init`
```
Same pattern for every document (`BaseItem` -> `Item`, `BaseActiveEffect` -> `ActiveEffect`, ...). The server only ever loads the `Base*` classes
(not your code and not your DataModels), which is why `documentTypes` manifest declarations exist.

| Document | `collection` key (on parent/world) | Embedded children | `system`? | World accessor |
|---|---|---|---|---|
| Actor | `actors` | Item `items`, ActiveEffect `effects` | yes | `game.actors` |
| Item | `items` | ActiveEffect `effects` | yes | `game.items` |
| ActiveEffect | `effects` | none (embedded in Actor/Item; also standalone in compendia) | yes (always `base`+custom) | via parent |
| Combat | `combats` | Combatant `combatants`, CombatantGroup `groups` | yes | `game.combats` |
| Combatant / CombatantGroup | `combatants` / `groups` | | yes | via combat |
| Cards / Card | `cards` / `cards` | Card `cards` | yes / yes | `game.cards` |
| ChatMessage | `messages` | | yes | `game.messages` |
| JournalEntry / JournalEntryPage / JournalEntryCategory | `journal` / `pages` / `categories` | pages, categories | page: yes | `game.journal` |
| Scene | `scenes` | AmbientLight `lights`, AmbientSound `sounds`, Drawing, Note, Region, Level `levels`, Tile, Token, Wall | no | `game.scenes` |
| Token (TokenDocument) | `tokens` | ActorDelta `delta` | no (uses `delta`) | `scene.tokens` |
| Region / RegionBehavior | `regions` / `behaviors` | behaviors | behavior: yes | `scene.regions` |
| Macro, RollTable (TableResult), Playlist (PlaylistSound), Folder, User, Setting, Adventure, FogExploration | | | no | `game.macros`, `game.tables`, `game.playlists`, `game.folders`, `game.users`, `game.settings.storage`, ... |

* `Document.documentName` ("Actor"), `doc.collectionName`, `Document.metadata` (frozen: `name`, `collection`, `embedded`, `hasTypeData`, `permissions`, `schemaVersion`...),
  `Actor.TYPES` (array of valid types, e.g. `["character","npc"]`), `Document.implementation` (the configured subclass), `Document.hasTypeData`.
* Useful instance props: `id`, `uuid`, `name`, `type`, `system`, `flags`, `parent` (null for world docs), `parentCollection`, `pack` (null for world),
  `isEmbedded`, `inCompendium`, `collection`, `compendium`, `persisted`, `isOwner`, `permission`, `sheet`, `apps`, `_source`, `_stats`
  (`_stats.systemVersion`, `coreVersion`, `compendiumSource`, `duplicateSource` ...).

### Custom Document class
```js
export class MySystemActor extends Actor {
  /** @override */
  prepareBaseData() { super.prepareBaseData(); /* MUST call super: it resets effect/status state */ }
  /** @override */
  prepareDerivedData() { super.prepareDerivedData(); }

  /** Domain helper: keep game rules on the model when possible; Document class handles cross-cutting concerns. */
  get isCharacter() { return this.type === "character"; }

  /** @override */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);   // forwards to system._preCreate too
    if (allowed === false) return false;
    this.updateSource({"prototypeToken.displayName": CONST.TOKEN_DISPLAY_MODES.OWNER});
  }
}
Hooks.once("init", () => { CONFIG.Actor.documentClass = MySystemActor; });
```
* Only **one** class per Document type (`documentClass`); there is no per-subtype Document class. Put subtype behaviour on the TypeDataModels
  (`actor.system.someMethod()`), or branch on `this.type`.
* Always call `super` in `_preCreate/_onCreate/_preUpdate/_onUpdate/_preDelete/_onDelete/prepare*`: the client mixin forwards to `system._preX/_onX` in those.
* Embedded/descendant events bubble up: override `_onCreateDescendantDocuments(parent, collection, documents, data, options, userId)`,
  `_onUpdateDescendantDocuments`, `_onDeleteDescendantDocuments` (and `_pre...`) on the Actor to react to item/effect changes.
* Static batch hooks: `static async _preCreateOperation(documents, operation, user)`, `_onCreateOperation`, `_preUpdateOperation`, `_onUpdateOperation`, `_preDeleteOperation`, `_onDeleteOperation`
  (one call per batch; return `false` from a `_pre...Operation` to cancel the whole batch).
* `Actor.getDefaultArtwork(actorData)` / `DEFAULT_ICON` customise default images. `static defaultName({type, parent, pack})` customises "New Actor" names.
* Do not override `static metadata` on a client class; do not redefine the schema (`defineSchema`) on core documents (server would reject the data). Extend via `system`/`flags`.

---

## 3. Collections, compendia, UUIDs

* World collections: `game.actors`, `game.items`, `game.scenes`, `game.journal`, `game.macros`, `game.tables`, `game.playlists`, `game.cards`, `game.combats`, `game.messages`, `game.folders`, `game.users`.
  `game.collections.get("Actor")` is the generic lookup. They exist only after `init` (documents are built before `setup`). They are `Collection`s (Map subclass):
  `get(id)`, `getName(name)`, `find`, `filter`, `map`, `reduce`, `some`, `contents` (array), `has`, `size`, `first`.
* Embedded collections (`actor.items`, `actor.effects`, `scene.tokens`, ...) are `EmbeddedCollection`s with the same API plus `documentsByType` (`actor.itemTypes.weapon` is `actor.items.documentsByType.weapon`).
* Static lookup: `Actor.get(id)` returns the world doc, or with `{pack: "pkg.pack"}` the **index entry** (not a Document).
* **Compendium** packs: `game.packs.get("mysystem.weapons")` (`CompendiumCollection`, id = `<packageName>.<name>`).
  * `pack.index` is a Collection of lightweight index entries (`_id`, `name`, `img`, `type`, `sort`, `folder`, `uuid`, plus anything in `CONFIG.<Doc>.compendiumIndexFields`). Not full Documents.
  * `await pack.getIndex({fields: ["system.level", "system.damage.type"]})` extends the index (fields are server-indexed; keep to few).
  * `await pack.getDocument(id)`, `await pack.getDocuments({type: "weapon"})` (queries: `type__in`, `_id__in`, `type__ne`), then cached.
  * `pack.locked`, `await pack.configure({locked: false})`, `pack.documentName`, `pack.metadata` (`packageName`, `packageType`, `label`, `type`, `flags`).
  * Create in a pack: `await Item.implementation.create(data, {pack: "world.my-pack"})`; embedded ops inside packs go through the parent (`parent.pack` is inherited).
  * Import to world: `await game.items.importFromCompendium(pack, id, updateData)` or `game.items.fromCompendium(doc)` (returns clean creation data: strips `_id`, sort, ownership,
    sets `_stats.compendiumSource`). `game.actors.importFromCompendium(...)`.
  * Packs are declared in the manifest `packs` array (see the manifest/packaging reference); world packs are created in the UI.
* **UUIDs** (`doc.uuid`):
  * World: `Actor.<id>`; embedded: `Actor.<id>.Item.<id>`; scene children: `Scene.<id>.Token.<id>`; unlinked token actor: `Scene.<id>.Token.<id>.Actor.<id>`.
  * Compendium: `Compendium.<package>.<pack>.<DocName>.<id>` (and `...Item.<id>.ActiveEffect.<id>` for embedded). Relative UUIDs start with `.` (`.Item.<id>` resolved against a document).
  * `await fromUuid(uuid, {relative, invalid})` returns the full Document (loads from compendia, async). `fromUuidSync(uuid, {strict})` returns the Document, or the **index entry** for
    compendium docs (no `system` data unless indexed), and **throws** for embedded docs inside compendia unless `strict: false`.
  * `foundry.utils.parseUuid(uuid)`, `foundry.utils.buildUuid({id, documentName, parent, pack})`, `doc.getRelativeUUID(relativeTo)`.
  * `@UUID[uuid]{Label}` in HTML content creates enriched links; `doc.link` builds one.
* Prefer UUIDs to ids when storing cross-document references in `system` (`DocumentUUIDField`), because ids do not identify the pack/parent.

---

## 4. CRUD

```js
// CREATE (static, async). Use the configured class: Actor.implementation or just Actor (both route to implementation)
const actor = await Actor.implementation.create({name: "Ada", type: "character", system: {level: 2}});
const [a, b] = await Actor.implementation.createDocuments([{...}, {...}]);           // batch: one request, hooks per doc
const item = await Item.implementation.create({name: "Sword", type: "weapon"}, {parent: actor});   // embedded (same as actor.createEmbeddedDocuments)
await Item.implementation.create(data, {pack: "world.my-pack"});                     // into a compendium
const clone = await actor.clone({name: "Ada (copy)"}, {save: true});                 // clone: sync unless save:true

// UPDATE
await actor.update({"system.attributes.hp.value": 5, name: "Ada II"});               // single doc; returns doc, or undefined if nothing changed
await Actor.updateDocuments([{_id: a.id, name: "A"}, {_id: b.id, name: "B"}]);       // batch
await item.update({system: {quantity: 3}});                                           // nested form is equivalent to dotted

// DELETE
await item.delete();                                                                  // returns deleted doc
await Actor.deleteDocuments([a.id, b.id]);
await Item.deleteDocuments([], {pack: "world.my-pack", deleteAll: true});             // delete everything in a collection (ids must be empty)
```

### Operation options (second argument)
Create (`DatabaseCreateOperation`): `parent`, `pack`, `keepId` (false), `keepEmbeddedIds` (true), `renderSheet` (false; `Actor.create(data, {renderSheet: true})` opens the sheet),
`render` (true), `noHook` (false), `dryRun`. Update (`DatabaseUpdateOperation`): `parent`, `pack`, `diff` (true), `recursive` (true), `render` (true), `noHook`, `dryRun`.
Delete (`DatabaseDeleteOperation`): `parent`, `pack`, `deleteAll` (false), `render` (true), `noHook`, `dryRun`, `replacements`.
* `noHook: true` only skips the `preCreate/preUpdate/preDelete<Doc>` **Hooks**; the document's `_preX` methods and all post hooks (`createActor`, ...) still run.
* `render: false` skips re-rendering open sheets (`_onUpdate` still fires). Handy for batch internals; not a substitute for `noHook`.
* `diff: true` (default): the update is compared with current data and no-op changes are dropped; if the whole update is empty nothing is sent, no `update<Doc>` hook fires,
  and `doc.update()` resolves to `undefined`. `diff: false` forces a write.
* `recursive: false`: root-level keys of the update are treated as **replacements** (each wrapped as `_replace(value)`), so `actor.update({system: {...}}, {recursive: false})`
  replaces `system` entirely instead of merging.
* `dryRun: true`: runs the client-side pre-workflow (including `_preX` and pre hooks) and validation, returns `[]` / the ids without writing.
* `keepId: true` retains the `_id` from the data (must be a valid 16-char id and unused). Without it new ids are generated even if `data._id` is present.
* **Any other keys you pass travel in `options`** to `_preX`, `_onX`, and every client's hooks, on all clients. Namespace them: `actor.update(changes, {mysystem: {levelUp: true}})`
  then `if (options.mysystem?.levelUp)` in `updateActor`. This is the supported way to say "why" an update happened.
* Returns: `create` -> document (or `undefined` if cancelled by `_preCreate`/pre hook), `createDocuments` -> array, `update` -> document|undefined, `delete` -> document|undefined.
* Cancel a workflow: return `false` from `_preX` or from a `preX` hook (synchronously: hooks are not awaited).
* Validation errors in an update show a UI notification and skip that document; the Promise resolves without it (check the console/`ui.notifications`).

Permissions summary for the workflow: see section 8. The client calls `_preX` -> `preX` hook -> `_preXOperation`, sends to server (which re-validates permissions and schema), then every
connected client runs `_onX` -> `X` hook -> `_onXOperation`.

---

## 5. Update data

* **Dotted keys and nested objects are equivalent** and can be mixed at different branches: `{"system.hp.value": 3}` == `{system: {hp: {value: 3}}}`. Dotted keys are expanded during cleaning (`expand: true`).
  Do not give the same branch both ways in one update.
* Objects (SchemaField/ObjectField) merge recursively; scalars replace. **Arrays and Sets are replaced wholesale**:
  ```js
  const tags = new Set(actor.system.tags); tags.add("x");
  await actor.update({"system.tags": Array.from(tags)});           // send the full array
  ```
  `{"system.list.0.name": "x"}` becomes a sparse array and wipes the rest. Use `TypedObjectField`/embedded Items for per-element updates.
* **Deleting keys** (only meaningful for `ObjectField`/`TypedObjectField` entries and flags; fixed `SchemaField` members cannot be removed):
  ```js
  await actor.update({"system.conditions.burning": _del});                          // v14
  await actor.update({flags: {mymod: {oldKey: _del}}});
  await actor.update({"system.notes": _replace({a: 1})});                          // replace an object entirely (no merge)
  // equivalents: foundry.data.operators.ForcedDeletion / ForcedReplacement.create(value)
  ```
  Legacy `"-=key": null` / `"==key": value` are converted with a deprecation warning (`since 14 until 16`). **[v13]** only has the legacy forms. Cross-version helper:
  ```js
  const unset = key => game.release.generation >= 14 ? {[key]: _del} : {[`-=${key}`]: null};
  ```
  Serialization: operators survive sockets as `{"__$OPERATOR$__": "ForcedDeletion"}`. `foundry.utils.mergeObject(a, b, {applyOperators: true})` applies them locally;
  `foundry.utils.diffObject` emits `ForcedDeletion` for missing keys when `bidirectional`. `applyDataOperators(obj)` strips them.
* Changing a Document's `type` requires `{type: "npc", system: _replace({...})}` together; otherwise update throws.
* Because `_preUpdate`/`preUpdate` receive the **cleaned, expanded** changes, mutate them with `foundry.utils.setProperty(changes, "system.x", 1)` or `changes.system.x = 1` (check existence first).
* Prefer one update per logical change; batch with `updateEmbeddedDocuments`/`updateDocuments` (one socket round-trip, one prepare pass).
* `doc.updateSource(changes)` only modifies the local instance (use in `_preCreate`, previews). `doc.toObject()` (source) is the right base for copy-and-modify.
* Never mutate `doc.system.*` / `doc._source` expecting persistence; assignment affects the prepared copy only and is lost on next prepare.

---

## 6. Embedded documents

```js
// create
const [sword] = await actor.createEmbeddedDocuments("Item", [{name: "Sword", type: "weapon", system: {damage: {formula: "1d8"}}}]);
const items = await actor.createEmbeddedDocuments("Item", [compendiumItem.toObject()]);      // id regenerated (keepId false)
const data = game.items.fromCompendium(compendiumItem);                                      // keeps _stats.compendiumSource; strips ownership/sort/folder
await actor.createEmbeddedDocuments("Item", [data]);

// update (each entry needs _id; dotted keys fine)
await actor.updateEmbeddedDocuments("Item", [{_id: sword.id, "system.equipped": true}, {_id: other.id, "system.quantity": 0}]);
await sword.update({"system.equipped": false});                                              // same effect, one doc

// delete
await actor.deleteEmbeddedDocuments("Item", [sword.id]);
await sword.delete();

// read
actor.items.get(id); actor.items.getName("Sword"); actor.itemTypes.weapon; actor.items.filter(i => i.system.equipped);
sword.parent === actor; sword.actor === actor; sword.isEmbedded; sword.uuid; // "Actor.<id>.Item.<id>"
```
* `createEmbeddedDocuments(embeddedName, data, operation)` == `Item.implementation.createDocuments(data, {...operation, parent: actor})`. Valid names come from `Actor.metadata.embedded`.
  Drop-in effects: `item.createEmbeddedDocuments("ActiveEffect", [...])`, `ActiveEffect.create(data, {parent: actor})`.
* Embedded updates re-prepare the **parent** (`parent.reset()`), so the whole Actor's `prepareData` runs again; batch to avoid N passes.
* Embedded Items inherit ownership from the Actor; they ignore their own `ownership` field.
* Stack/merge items: find an existing one first, then update quantity, otherwise create.
* `Actor#itemTypes` is cached/lazily recomputed; do not mutate the arrays.
* Large batches (hundreds of documents) are fine; avoid `await`-ing a separate create/update per item inside a loop.

---

## 7. Flags

Free-form namespaced JSON on every Document (`doc.flags`), for modules and for system data you do not want to model.
```js
await doc.setFlag("my-module", "config.mode", "fast");     // key may be a dotted path -> flags["my-module"].config.mode
doc.getFlag("my-module", "config.mode");                   // "fast" (undefined if absent)
await doc.unsetFlag("my-module", "config.mode");           // v14: uses {[key]: _del}
doc.flags["my-module"]?.config?.mode;                       // direct read never throws
await doc.update({"flags.my-module.config": _replace({mode: "slow"})});   // replace a flag object instead of merging
```
* **Scope** must be a valid *active* package: `core`, `world`, the active system id, or an **active** module id. `getFlag/setFlag/unsetFlag` **throw**
  `Flag scope "x" is not valid or not currently active` otherwise (e.g. reading another module's flag when that module is disabled): read `doc.flags?.other?.key` instead.
  Scope keys must also match `/^[A-Za-z0-9-_]+$/` (the `flags` field silently drops invalid keys).
* `setFlag` is an ordinary `update` (so it merges objects, replaces arrays, triggers hooks/`_onUpdate`, re-renders, requires update permission). `setFlag(scope, key, null)` stores `null`
  (does not delete): use `unsetFlag`.
* Object-valued flags merge on `setFlag`; stale sub-keys survive. Replace with `_replace` as above.
* Flags are not typed or migrated. If structure matters, use `system` data models. Namespace everything under your package id; core uses `flags.core.*` (`sheetClass`, `overlay`; the old `flags.core.sourceId` became `_stats.compendiumSource`).
* An unlinked token's synthetic actor sees the base actor's flags merged with the delta's flags.

---

## 8. Ownership and permissions

```js
const L = CONST.DOCUMENT_OWNERSHIP_LEVELS;    // INHERIT -1, NONE 0, LIMITED 1, OBSERVER 2, OWNER 3
actor.ownership;                               // {default: 0, "<userId>": 3}
actor.getUserLevel(user);                      // explicit level only (GM may still read NONE)
actor.testUserPermission(game.user, "OBSERVER");     // >= level; GMs always pass; banned users never. {exact: true} for ==
actor.isOwner; actor.permission; actor.hasPlayerOwner; actor.limited; actor.visible;
actor.canUserModify(game.user, "update", changes);  // generic check using metadata.permissions
Actor.implementation.canUserCreate(game.user);
await actor.update({ownership: {default: L.OBSERVER, [userId]: L.OWNER}});     // GM / owner only
await actor.update({ownership: {[userId]: _del}});                              // drop an explicit entry
```
* Default `metadata.permissions` (per Document, overridable by subclasses of Base*): `view: LIMITED`, `create: ASSISTANT`, `update: OWNER`, `delete: ASSISTANT`.
  Overrides: Actor `create` = user permission `ACTOR_CREATE` (default Trusted+), `update` = OWNER (+ token wildcard image rules); **Actor `delete` stays ASSISTANT, so players cannot delete
  actors they own** (GM must). Item `create` = `ITEM_CREATE` (embedded: parent OWNER), `delete` = OWNER. ActiveEffect `create`/`delete` = parent OWNER (standalone: GM). Token `create/delete` = `TOKEN_CREATE`/`TOKEN_DELETE`
  user permissions; update needs OWNER of the token's actor. Scene/Folder/Macro etc. mostly ASSISTANT/GM. JournalEntry `create` = `JOURNAL_CREATE`.
* Embedded Documents defer to their parent for ownership (Items always; ActiveEffects and other children that have no `ownership` field or use `INHERIT`). Compendium content ignores `ownership` and uses pack role settings (`pack.getUserLevel`).
* **User roles**: `NONE 0, PLAYER 1, TRUSTED 2, ASSISTANT 3, GAMEMASTER 4`. `user.isGM` is ASSISTANT or above; `user.hasRole("TRUSTED")`; `user.hasPermission("FILES_BROWSE")`; `game.user.isActiveGM` /
  `game.users.activeGM` designate one active GM client (highest role, non-assistant preferred; deterministic across clients), for "exactly one client does it" work;
  `game.users.getDesignatedUser(user => user.active && user.can("TOKEN_CREATE"))` generalises it.
* A player can: create actors/items if permitted; update/create/delete embedded Items+Effects on actors they OWN; update system data of owned actors; create chat messages; update their own User and
  user-scope settings. A player cannot: delete world Actors, touch Scenes/world settings, modify documents at OBSERVER or lower, or write to locked compendia.
* **Run side effects once**: `_onCreate/_onUpdate/_onDelete` and `create*/update*/delete*` hooks fire on every client. Guard follow-up writes:
  ```js
  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (game.user.id !== userId) return;                 // only the author continues (they hold the permissions of the operation they just ran; check others yourself)
    // or: if (!game.user.isActiveGM) return;            // GM-only automation, exactly once
  }
  ```
* Players needing a GM-only action: use a socket (`"socket": true` in the manifest, `game.socket.emit("system.mysystem", payload)`) handled by `game.user.isActiveGM`, or a pattern that
  grants the player OWNER temporarily. Validate payloads on the GM side.

---

## 9. Database hooks and lifecycle order

| When | Method (on Document, forwarded to `system` for TypeDataModels) | Hook (name uses the document name) | Runs on |
|---|---|---|---|
| before create | `_preCreate(data, options, user)` | `preCreate<Doc>(doc, data, options, userId)` | requester only |
| after create | `_onCreate(data, options, userId)` | `create<Doc>(doc, options, userId)` | all clients |
| before update | `_preUpdate(changes, options, user)` | `preUpdate<Doc>(doc, changes, options, userId)` | requester only |
| after update | `_onUpdate(changed, options, userId)` | `update<Doc>(doc, changed, options, userId)` | all clients |
| before delete | `_preDelete(options, user)` | `preDelete<Doc>(doc, options, userId)` | requester only |
| after delete | `_onDelete(options, userId)` | `delete<Doc>(doc, options, userId)` | all clients |
| batch before/after | `static _pre{Create,Update,Delete}Operation(documents, operation, user)` / `_on...Operation` | n/a | requester / all |
| descendant | `_pre/_on{Create,Update,Delete}DescendantDocuments(parent, collection, ...)` on all ancestors | n/a | requester / all |

Hook names: `preCreateActor`, `createActor`, `preUpdateItem`, `updateItem`, `deleteActiveEffect`, `createToken`, `updateCombat`, `createChatMessage` ... (embedded docs use their own name: creating an Item on an actor fires `createItem`).
```js
Hooks.on("preCreateActor", (actor, data, options, userId) => {
  if (!data.img) actor.updateSource({img: "systems/mysystem/icons/blank.svg"});    // pending doc: updateSource, not `data.img =`
});
Hooks.on("preUpdateActor", (actor, changes, options, userId) => {
  if (foundry.utils.hasProperty(changes, "system.attributes.hp.value") && actor.system.isDead) return false;   // cancel (sync!)
});
Hooks.on("updateActor", (actor, changed, options, userId) => {
  if (game.user.id !== userId) return;
  if (options.mysystem?.noSideEffects) return;
});
Hooks.on("createItem", (item, options, userId) => { if (item.actor && game.user.id === userId) { /* ... */ } });
```
* Pre-hooks: return `false` to cancel; async functions return a Promise (truthy) so they **cannot** cancel. `Hooks.call` stops at the first `false`; `Hooks.callAll` ignores returns.
* Pre events fire only on the requesting client and see pre-write state; post events fire everywhere with the document already updated and prepared.
* Order on the requester (create): Document `_preCreate` (and system) -> `preCreate<Doc>` hook -> `_preCreateOperation` -> server -> `_onCreate` -> `create<Doc>` hook -> `_onCreateOperation`.
  For updates the document's `_preUpdate` receives changes; the client then does a dry-run `updateSource` to compute the true diff, drops no-ops, and sends only the diff.
* In `updateX`, `changed` is the diff (nested). Use `foundry.utils.hasProperty(changed, "system.hp.value")`. The doc already holds new values; the old value is not provided
  (capture it in `preUpdate` via `options`: `options.mysystem = {oldHp}` then read it in `update`).
* `Hooks.once("ready")` etc. documented elsewhere. `Hooks.on` returns an id for `Hooks.off`. Don't register per-document hooks in a loop.
* Cascades: embedded create/update/delete re-prepares and re-renders the parent. To avoid recursion, don't update the parent from a handler without a guard condition (`if (!hasProperty(changed, ...)) return`).

---

## 10. ActiveEffects (v14 rewrite)

### 10.1 Data shape (BaseActiveEffect schema, v14)
```js
{
  name, img, type: "base",              // effects now have subtypes; `system` is a TypeDataModel (core "base" => {changes: []})
  system: { changes: [ {key, type, value, phase, priority} ] },   // moved from top-level `changes` ([v13]: changes[].mode)
  disabled: false,
  start: {time, combat, combatant, initiative, round, turn} | null,  // set automatically when added to an Actor (getEffectStart)
  duration: {value: number|null, units: "seconds|minutes|hours|days|months|years|rounds|turns", expiry: "turnStart|turnEnd|roundStart|roundEnd|combatStart|combatEnd|<custom>"|null, expired: false},
  description: "<html>", origin: "<uuid>|null", tint: "#ffffff", showIcon: 0|1|2 (CONST.ACTIVE_EFFECT_SHOW_ICON NEVER/CONDITIONAL/ALWAYS),
  transfer: true,                       // item-owned effects: apply to the owning actor (forced false when created directly on an Actor)
  statuses: Set<string>,                // status ids this effect represents
  folder, sort, flags, _stats
}
```
* **Change `type`** (string; `CONST.ACTIVE_EFFECT_CHANGE_TYPES` default priorities): `custom 0`, `multiply 10`, `add 20`, `subtract 20` (new), `downgrade 30`, `upgrade 40`, `override 50`.
  Custom types can be registered: `CONFIG.ActiveEffect.changeTypes.percent = {label, defaultPriority, handler(targetDoc, change, {field, replacementData, modifyTarget}) {...}}`
  (handler mutates `targetDoc` directly). Format check: alphanumeric dot segments or `custom.<n>`.
* **`phase`**: `"initial"` (default) or `"final"` (`CONST.ACTIVE_EFFECT_CHANGE_PHASES`); add phases with `CONFIG.ActiveEffect.phases = {myPhase: {label, hint}}` and call `actor.applyActiveEffects("myPhase")` yourself.
  Changes are applied by phase, then ascending `priority` (null priority = the type's default).
* **`value`** is any JSON (number, boolean, string, array, object; `AnyField` serializable; legacy string values that parse as JSON are converted on migration, e.g. `"5"` -> `5`); strings may contain `@path` expressions resolved against `actor.getRollData()` (NumberField targets
  evaluate them as formulas: `"@level * 2"`). `effect.getReplacementData(rollData)` customises that data.
* **`key`** is a property path on the target document: `system.abilities.str.value`, `system.attributes.ac`, `name`. Prefix `token.` targets the TokenDocument (`token.light.dim`, `token.sight.visionMode`;
  limited set of keys). Schema-backed keys are applied by the field class (typed Set union, array concat, number math, string append); unknown keys use a runtime-type heuristic
  (seed such values in `prepareBaseData`).
* Application timing (Actor): phase `initial` runs inside `prepareEmbeddedDocuments` (after `prepareBaseData`, **before** `prepareDerivedData`); phase `final` runs at the end of `prepareData`
  (after `prepareDerivedData`). See data-models.md section 5.1. Applied values land on the prepared document; originals stay in `_source`. `actor.overrides` records what changed
  (nested object) so sheets can mark overridden fields.
* Which effects apply: `Actor#allApplicableEffects()` = actor effects + item effects with `transfer: true`. `effect.active = !disabled && !isSuppressed`;
  `isSuppressed` = `system.isSuppressed ?? duration.expired` (implement `get isSuppressed()` on your effect TypeDataModel, e.g. "item not equipped"); override
  `ActiveEffect#shouldApplyChange(change, {phase, replacementData})` for conditional changes. `actor.appliedEffects`, `actor.temporaryEffects`, `effect.target`, `effect.actor`, `effect.item`, `effect.sourceName`.

```js
// Create a temporary effect on an actor
await actor.createEmbeddedDocuments("ActiveEffect", [{
  name: "Blessed", img: "icons/svg/aura.svg", origin: item.uuid,
  duration: {value: 3, units: "rounds", expiry: "turnEnd"},
  statuses: ["blessed"],
  system: {changes: [
    {key: "system.abilities.str.value", type: "add", value: 2, phase: "initial"},
    {key: "system.attributes.ac", type: "add", value: "@abilities.dex.mod", phase: "final"}
  ]}
}]);

// Item that grants a permanent bonus while owned (transfer)
await item.createEmbeddedDocuments("ActiveEffect", [{
  name: "Ring of Strength", transfer: true,
  system: {changes: [{key: "system.abilities.str.value", type: "upgrade", value: 19}]}
}]);

// Custom effect subtype (documentTypes: {"ActiveEffect": {"modifier": {}}})
class ModifierData extends foundry.data.ActiveEffectTypeDataModel {       // must keep `changes`
  static defineSchema() { return {...super.defineSchema(), cost: new foundry.data.fields.NumberField({initial: 1})}; }
  get isSuppressed() {                                   // this.parent = the ActiveEffect; effect.parent = its Item (or Actor)
    const item = this.parent.parent;
    return (item instanceof Item) && !item.system.equipped;
  }
}
Object.assign(CONFIG.ActiveEffect.dataModels, {modifier: ModifierData});     // keep `base`
```
* Duration: `effect.duration` is prepared (adds `remaining`, `label`, `seconds`, `secondsRemaining`, `expired`). `CONFIG.ActiveEffect.expiryAction` = `"update"` (marks `expired`) | `"delete"` | `null`.
  `ActiveEffect.registry` tracks temporary effects; call `ActiveEffect.registry.refresh("myEvent", context)` for custom `CONFIG.ActiveEffect.expiryEvents`. Core refreshes on world time and combat events.
* Hook `applyActiveEffect(actor, change, current, delta, changes)` fires for `custom`-type changes (assign the desired value onto `actor` via `setProperty`).
* Subclass static hooks: `ActiveEffect.applyChange(targetDoc, change, options)` (entry), `applyChangeField` (schema-guided), `_applyChangeUnguided` and `_applyChangeAdd/Subtract/Multiply/Override/Upgrade/Custom(targetDoc, change, current, delta, changes)`.
  **[v13]** these were instance methods `_applyAdd` etc. (old names remain as deprecated shims).
* Caution: `Actor#applyActiveEffects(phase)` requires a string phase and may run each phase only once per prepare cycle (a second call logs an error); call it manually only for your own custom phases.

### 10.2 Statuses
```js
CONFIG.statusEffects.push({id: "stunned", name: "MYSYS.Status.Stunned", img: "systems/mysystem/icons/stunned.svg",
  _id: "stunned000000000",                 // optional static 16-char id: enables a single deterministic effect + multi-status effects
  system: {changes: [{key: "system.attributes.initiativeBonus", type: "add", value: -2}]}});
await actor.toggleStatusEffect("stunned");                          // toggle; returns ActiveEffect | true | false | undefined
await actor.toggleStatusEffect("stunned", {active: true, overlay: true});
actor.statuses.has("stunned");                                      // Set rebuilt every prepare (from active effects' `statuses`)
token.document.hasStatusEffect("stunned");
CONFIG.specialStatusEffects.DEFEATED;                               // "dead", INVISIBLE, BLIND, BURROW, HOVER, FLY (core integrations)
```
* `CONFIG.statusEffects` is an array that is also keyed by `id` (assigning/pushing maintains both). Entries are ActiveEffect data plus `id` and `hud` (`false` or `{actorTypes: [...]}`).
  Localise `name` with an i18n key. A status with several `statuses` requires `_id`.
* Statuses are stored as ordinary ActiveEffects with `statuses: [id]`, so they are also deletable via `actor.deleteEmbeddedDocuments("ActiveEffect", ids)`.

---

## 11. Tokens vs Actors

* `TokenDocument` (embedded in `Scene`, `scene.tokens`) fields: `actorId`, `actorLink` (bool), `delta` (ActorDelta), plus position/texture/vision/bars. The Actor's `prototypeToken` (a `PrototypeToken` DataModel on the Actor: `name`, `texture`, `width`,
  `height`, `actorLink`, `disposition`, `bar1/2`, `sight`, `light`, `detectionModes`, `randomImg`) seeds new tokens.
* **Linked** (`actorLink: true`, usual for PCs): `token.actor === game.actors.get(token.actorId)`; updates go to the world Actor; all tokens share state.
* **Unlinked** (default for NPCs/monsters): `token.actor` is a **synthetic Actor** built by `ActorDelta.apply()` = base Actor data + the token's stored delta (`token.delta`). `actor.isToken === true`, `actor.token === tokenDocument`,
  `actor.parent === tokenDocument`, `actor.uuid` = `Scene.<id>.Token.<id>.Actor.<id>`, `token.baseActor` = the world actor. `actor.update()`, `actor.createEmbeddedDocuments("Item")`, effects etc.
  are redirected to the ActorDelta (only the differences are stored; embedded Items use tombstones for deletions). The synthetic actor is `mergeObject(baseActor.toObject(), delta.toObject())`:
  objects merge, but **arrays/Sets in the delta replace the base's wholesale**, and the synthetic actor shares the base actor's `_id`. Base-actor updates propagate to unlinked tokens' synthetic actors (re-prepared).
  In v14 the delta is **lazily materialized** (`token.isLazyDelta`): the synthetic actor exists after documents are ready (do not touch `token.actor` in `init`).
  `delta.restore()` resets a token to its base actor.
* Rules of thumb:
  * Read and write per-instance state through `token.actor` (never `game.actors.get(token.actorId)` for unlinked tokens).
  * Hooks for synthetic-actor changes: `updateActor`/`createItem`/... still fire with `actor.isToken` true (embedded events fire with the synthetic actor as the parent); `actor.isToken` lets you branch.
  * Flags and system data on the base actor are seen by unlinked tokens until overridden in the delta.
  * `actor.getActiveTokens(linked = false, document = false)` returns Token placeables (or TokenDocuments if `document: true`) on the current scene; `actor.getDependentTokens({scenes, linked, concreteOnly})`
    returns TokenDocuments across scenes.
  * Create a token from an actor: `const td = await actor.getTokenDocument({x, y}); await canvas.scene.createEmbeddedDocuments("Token", [td.toObject()]);` (applies wildcard art, name numbering/prefix for unlinked).
  * Token bars/resources come from `CONFIG.Actor.trackableAttributes` and `system.json` `primaryTokenAttribute`; `actor.modifyTokenAttribute(attribute, value, isDelta, isBar)` applies bar edits (override to add system rules; hook `modifyTokenAttribute`).
  * Effects with `token.` keys and status visuals apply to TokenDocument overrides (`token.overrides`).

---

## 12. Migrations

Layers: (1) `migrateData` on models/documents (in-memory, every load/update delta; see data-models.md 6.1), (2) one-time **world migration** to persist cleaned shapes and perform structural changes
(creating/deleting documents, converting flags to system, etc.). Core schema migrations (field renames in core documents) are done by Foundry itself.

```js
// settings (init)
game.settings.register("mysystem", "systemMigrationVersion", {
  name: "System Migration Version", scope: "world", config: false, type: new foundry.data.fields.StringField({required: true, blank: true, initial: ""}), default: ""
});

const NEEDS_MIGRATION_VERSION = "1.2.0";          // first system version whose data needs the migration below

Hooks.once("ready", async () => {
  if (!game.user.isActiveGM) return;               // exactly one GM client does it
  const stored = game.settings.get("mysystem", "systemMigrationVersion");
  const total = game.actors.size + game.items.size + game.scenes.size;
  if (!stored && total === 0) return game.settings.set("mysystem", "systemMigrationVersion", game.system.version);   // brand-new world
  if (stored && !foundry.utils.isNewerVersion(NEEDS_MIGRATION_VERSION, stored)) return;                              // already migrated  (isNewerVersion(v1, v0): v1 > v0)
  ui.notifications.info(`Migrating to ${game.system.version}. Do not close the game.`, {permanent: true});
  await migrateWorld();
  await game.settings.set("mysystem", "systemMigrationVersion", game.system.version);
  ui.notifications.info("Migration complete.", {permanent: true});
});

/** Persist the (already model-migrated, pruned) system data; add custom fixes in `extra`. */
// Fresh options per call: the database layer mutates the operation object (adds parent/pack/updates), so never share one.
const persist = (extra = {}) => ({diff: false, recursive: false, render: false, mysystem: {migration: true}, ...extra});   // recursive:false => `system` fully replaced
async function migrateActor(actor) {
  const updates = {system: actor.system.toObject()};          // _source after migrateData + pruning of unknown keys
  const itemUpdates = actor.items.map(i => ({_id: i.id, system: i.system.toObject()}));
  await actor.update(updates, persist());
  if (itemUpdates.length) await actor.updateEmbeddedDocuments("Item", itemUpdates, persist());
}

async function migrateWorld() {
  for (const actor of game.actors) { try { await migrateActor(actor); } catch (err) { console.error(`Migration failed for ${actor.uuid}`, err); } }
  const itemUpdates = game.items.map(i => ({_id: i.id, system: i.system.toObject()}));
  if (itemUpdates.length) await Item.updateDocuments(itemUpdates, persist());

  // Unlinked token actors store only a delta. Do NOT replace it with the synthetic actor (it would copy the base actor in).
  for (const scene of game.scenes) {
    for (const token of scene.tokens) {
      const deltaSystem = token._source.delta?.system;          // read _source: touching `token.delta` would materialize the lazy delta
      if (token.actorLink || !deltaSystem || !Object.keys(deltaSystem).length) continue;
      // migrate only keys present in the delta, e.g. rename in a plain object, then:
      // await token.delta.update({system: cleanedPartial}, {diff: false})
    }
  }

  // Compendia (unlock, migrate, relock)
  for (const pack of game.packs) {
    if (pack.metadata.packageType !== "world" || !["Actor", "Item"].includes(pack.documentName)) continue;
    const wasLocked = pack.locked;
    if (wasLocked) await pack.configure({locked: false});
    const docs = await pack.getDocuments();
    const cls = pack.documentClass;
    await cls.updateDocuments(docs.map(d => ({_id: d.id, system: d.system.toObject()})), persist({pack: pack.collection}));
    if (wasLocked) await pack.configure({locked: true});
  }
}
```
Notes:
* Per-document version targeting: `doc._stats.systemVersion` is the system version that last wrote the document (server-managed). `foundry.utils.isNewerVersion("1.2.0", doc._stats.systemVersion)` selects only older documents.
  Imported/compendium documents from older exports also need `migrateData` to handle them at load time; `ClientDocument.fromImport(source)` applies core migrations only.
* `foundry.utils.isNewerVersion(a, b)` -> `a > b` (numeric part-wise; accepts numbers/strings; `null`/`undefined` b => true). `game.system.version`, `game.release.version`, `game.release.generation` (14).
* Prefer `migrateData` for rename/convert (works for world, compendium, imports, drag-drop) and use the world pass only to *persist* and to do structural work (e.g. replace removed Items, rewrite flags, delete orphans).
* Deleting obsolete keys from the DB: `recursive:false` + full `system` object (shown above), or `{ "system.oldKey": _del }` for `ObjectField`/`TypedObjectField` members.
* Only an owner GM can run it (players lack permission). Tell the GM to back up the world before a destructive migration. Run it from `ready` (collections are fully prepared there), not `init`/`setup`.
* Compendium pack `pack.migrate()` triggers server-side *core* schema migration only (it cannot run your client models).

---

## 13. Gotcha checklist
1. `getFlag/setFlag` on an inactive scope throws; read `doc.flags?.scope?.key` for foreign modules.
2. `update()` resolves `undefined` when nothing changed or when validation failed; do not assume a returned document.
3. Arrays/Sets are replaced in whole; objects merge. Use `_del`/`_replace` (v14) to delete/replace.
4. Hooks are not awaited: async `preX` hooks cannot cancel. `_preX` methods can be async.
5. Post-hooks and `_onX` run on all clients: guard writes with `userId === game.user.id` or `isActiveGM`.
6. `noHook: true` skips only `preX` hooks.
7. Overriding `Actor#prepareBaseData` without `super` breaks effects/statuses. Never write to the DB in prepare methods.
8. Unlinked tokens: use `token.actor`; `game.actors.get()` returns the base actor, not the instance state.
9. Players cannot delete world Actors (delete = ASSISTANT); embedded Item/Effect create/update/delete need OWNER of the parent.
10. `fromUuidSync` returns index entries for compendium docs and throws for embedded compendium docs; use `await fromUuid`.
11. `Actor.create` with `keepId` needs a valid 16-char unused id. IDs in `data._id` are otherwise ignored.
12. Effect changes use string `type` and `phase`; `effect.system.changes` is the source; `mode`/top-level `changes` are shims; no `legacyTransferral`.
13. Embedded updates re-run the whole parent's `prepareData`; batch them.
14. Document class is singular per type: put subtype logic on TypeDataModels.
15. Do not mutate `_source`, `toObject(false)` output, or `doc.system` fields and expect persistence.

### Verify in source
* Document statics/CRUD/flags/permissions: `common/abstract/document.mjs`. Operation defaults: `common/abstract/backend.mjs`. Client workflow + hooks: `client/data/client-backend.mjs`.
* Operators and `_del/_replace`: `common/data/operators.mjs`, `client/client.mjs`, `common/utils/helpers.mjs` (`mergeObject`, `diffObject`, `_migrateDeletionKey`).
* ActiveEffect: `common/documents/active-effect.mjs`, `common/data/active-effect.mjs`, `client/documents/active-effect.mjs`, `client/documents/actor.mjs` (`applyActiveEffects`), `client/config.mjs` (`CONFIG.ActiveEffect`, `statusEffects`).
* Tokens: `client/documents/token.mjs`, `client/documents/actor-delta.mjs`, `common/documents/actor-delta.mjs`.
* Hook docs: `client/hooks.mjs` (`preCreateDocument` etc.). Online: https://foundryvtt.com/api/v14/ , https://foundryvtt.com/article/active-effects/ , https://foundryvtt.com/article/system-data-models/
