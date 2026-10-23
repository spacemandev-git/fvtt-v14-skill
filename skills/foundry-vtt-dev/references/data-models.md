# Data Models: DataModel, TypeDataModel, and Data Fields (Foundry v14)

Ground truth for this file: `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/` (`common/abstract/data.mjs`,
`common/abstract/type-data.mjs`, `common/data/fields.mjs`, `common/data/operators.mjs`, `client/documents/abstract/client-document.mjs`).
Target: v14 (build 369). v13 differences are flagged with **[v13]**.

## Table of contents
1. Mental model and obsolete patterns
2. Which documents have `system`, and how to register a model
3. Field classes (catalogue, options, defaults, gotchas)
4. Localization (`LOCALIZATION_PREFIXES`) and `metadata`
5. Data preparation order, persisted vs derived data, ActiveEffect interplay
6. Migration and validation: `migrateData`, `shimData`, `cleanData`, `validateJoint`
7. Database lifecycle hooks on TypeDataModel (`_preCreate` ... `_onDelete`)
8. Working with data: `_source`, `toObject`, `updateSource`, `clone`, `getRollData`
9. Reuse: schema chunks, mixins, inheritance
10. Worked example (system.json + models + document classes + registration)
11. Gotcha checklist
12. Unit-testing models in plain Node (no server)

---

## 1. Mental model and obsolete patterns

* A **DataModel** = static schema (`defineSchema()`) + instance with `_source` (persisted, sealed, validated) and *prepared* properties
  (copies of source, initialised onto the instance, free to mutate in `prepareDerivedData`).
* A **TypeDataModel** is a DataModel for a Document's `system` field (and for module-added subtypes). It adds
  `prepareBaseData`/`prepareDerivedData` and `_preCreate/_onCreate/_preUpdate/_onUpdate/_preDelete/_onDelete` forwarded from the Document.
* `actor.system` IS the TypeDataModel instance. `actor.system.parent === actor`. `actor._source.system` is the raw persisted object
  (same object as `actor.system._source`).

| Obsolete (v9-v11 era, still in training data) | Modern v14 replacement |
|---|---|
| `template.json` with `Actor.types` / `templates` | `system.json` `documentTypes` + `CONFIG.Actor.dataModels` (template.json is **deprecated since v14, removal v16**; do not write one) |
| `actor.data.data.hp`, `item.data.data` | `actor.system.hp` |
| `actor.data.update(...)`, `actor.data.name` | `actor.update(...)`, `actor.name` |
| `getData()` returns `{data: ...}` | sheets use `_prepareContext` and read `this.document.system` (ApplicationV2; see sheets reference) |
| `entity`, `CONFIG.Actor.entityClass` | `CONFIG.Actor.documentClass` |
| `mergeObject(a, b)`, `duplicate(x)`, `getProperty()`, `setProperty()`, `expandObject()`, `isObjectEmpty()` as globals | `foundry.utils.mergeObject`, `.deepClone` (preferred over `duplicate`), `.getProperty`, `.setProperty`, `.expandObject`, `.isEmpty` |
| `prepareData()` override without `super` | override `prepareBaseData/prepareDerivedData` and **call `super`** (Actor.prepareBaseData resets effect state) |
| `actor.update({"data.hp": 1})` | `actor.update({"system.hp": 1})` |
| `{"-=key": null}` / `{"==key": obj}` | `{key: _del}` / `{key: _replace(obj)}` (v14). See documents.md |
| `strictDataCleaning`, template-merge cleaning | schema field options (`required`, `nullable`, `initial`, `choices`) |
| `ActiveEffect.changes[].mode` (number) | `effect.system.changes[].type` (string) |
| `new Actor(data)` expecting your custom subclass | `new Actor.implementation(data)` (or `new CONFIG.Actor.documentClass(data)`); static `Actor.create(...)` already routes to the implementation |

---

## 2. Which documents have `system`, and registration

### v14 documents with sub-type data (`metadata.hasTypeData: true`, `CONFIG.<Doc>.dataModels` exists)
`Actor`, `Item`, `ActiveEffect`, `Card`, `Cards`, `ChatMessage`, `Combat`, `Combatant`, `CombatantGroup` (new in v14), `JournalEntryPage`, `RegionBehavior`.

* `Actor` and `Item` have `baseTypeAllowed: false` (must declare real types). All others allow type `"base"`.
* Core types are reserved: `Cards` (`deck`,`hand`,`pile`), `JournalEntryPage` (`text`,`image`,`pdf`,`video`), `RegionBehavior` (the 12 built-ins). Declaring them in a manifest `documentTypes` throws ("reserved core type").
* `ActiveEffect` always has a `base` model (`foundry.data.ActiveEffectTypeDataModel`, field `changes`). A custom AE subtype model **must extend
  `foundry.data.ActiveEffectTypeDataModel`** and keep `changes` (core verifies at startup). Never replace `CONFIG.ActiveEffect.dataModels`
  wholesale; `Object.assign` into it.
* Tokens, Scenes, Walls, Macros, Users, Folders, Playlists, etc. have NO `system`. Use `flags` there.

### system.json (the `documentTypes` manifest key)
```jsonc
{
  "id": "mysystem",
  "documentTypes": {
    "Actor": {
      "character": { "htmlFields": ["details.biography"], "filePathFields": {"details.crest": ["IMAGE"]} },
      "npc": {}
    },
    "Item": { "weapon": {}, "feature": {"htmlFields": ["description"]} },
    "ActiveEffect": { "modifier": {} },
    "JournalEntryPage": { "quest": {} }
  }
}
```
* This makes the server aware of the subtypes (otherwise documents with those types are discarded as invalid). It is mandatory.
* Per-type extras (paths are relative to `system`): `htmlFields` (server sanitises these), `filePathFields` (`{path: [FILE_CATEGORIES keys]}`;
  server extracts base64), `gmOnlyFields` (only GM may write). **If a model has an `HTMLField` or `FilePathField` and you do not list it
  here, it is not server-sanitised** (real security/XSS gap; swade lists every `HTMLField`).
* Module-provided types in `module.json` use the same key. They are **auto-prefixed with the module id** on the client:
  manifest `"quest"` in module `quest-pages` becomes type `"quest-pages.quest"`. Register as `CONFIG.JournalEntryPage.dataModels["quest-pages.quest"]`.
* Without a registered model, a declared type still works but `system` is an unvalidated plain object with no defaults.

### Registration (in `init`)
```js
Hooks.once("init", () => {
  CONFIG.Actor.documentClass = MySystemActor;            // optional custom Document class
  CONFIG.Item.documentClass = MySystemItem;
  Object.assign(CONFIG.Actor.dataModels, { character: CharacterData, npc: NpcData });
  Object.assign(CONFIG.Item.dataModels,  { weapon: WeaponData, feature: FeatureData });
  Object.assign(CONFIG.ActiveEffect.dataModels, { modifier: ModifierData }); // keeps "base"

  // Type display data (all optional; defaults are TYPES.Actor.character etc.)
  CONFIG.Actor.typeLabels.character = "MYSYS.Actor.character";          // default key: TYPES.Actor.character
  CONFIG.Actor.typeIcons = {character: "fa-solid fa-user", npc: "fa-solid fa-skull"};
  CONFIG.Actor.trackableAttributes = {                                   // token bars/values
    character: {bar: ["attributes.hp"], value: ["attributes.movement"]},
    npc:       {bar: ["attributes.hp"], value: []}
  };
});
```
* Type labels default to the i18n key `TYPES.<DocumentName>.<type>` (lang file: `{"TYPES": {"Actor": {"character": "Character"}}}`);
  hints from `TYPES.HINTS.<Doc>.<type>`. Used by "Create Actor" dialogs and sheet headers.
* `Hooks.once("init")` is the right place. `game.actors`/`game.items` do not exist yet in `init` (they appear before `setup`); settings are readable from `setup`.
* `trackableAttributes` `bar` paths must point to an object with numeric `value` and `max`; `value` paths to any number (derived props allowed).
  If omitted the core infers from schema (cannot see derived props).
* Sheets: `foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "mysystem", MySheet, {types: ["character"], makeDefault: true})`.

### template.json status
`game.model` is still built server-side and `TypeDataField` still merges a template when no DataModel is registered, but the code path is
marked `@deprecated since v14 until v16`. Release notes: "the legacy system template.json specification has entered its deprecation
period; systems must use either an unspecified schema or a TypeDataModel". Never generate template.json for new work. The online API page for
`BaseActiveEffect` / `Document#migrateSystemData` still says "defined by template.json" (stale text; source wins).

---

## 3. Field classes

Namespace: `foundry.data.fields` (`const {StringField, NumberField, SchemaField} = foundry.data.fields;`). Verify in source: `common/data/fields.mjs`.

### 3.1 Options common to every DataField (`DataFieldOptions`)
| Option | Default (base) | Meaning |
|---|---|---|
| `required` | `false` (see per-class overrides) | `undefined` is invalid when true. Non-required fields may be `undefined` |
| `nullable` | `false` (**NumberField: true**) | `null` allowed |
| `initial` | `undefined` | value, or `(source) => value`. Used when input is `undefined` / for new docs |
| `readonly` | `false` | prepared property on the instance is non-writable/non-configurable (writing it in `prepareDerivedData` throws in strict mode). Source can still change via `updateSource` |
| `persisted` | `true` | `false` = not written to the DB; always initialised from `initial`; still a valid ActiveEffect target (v14; unverified for v13) |
| `gmOnly` | `false` | only GM may modify. For `system` fields it is enforced through the manifest `gmOnlyFields`, not this flag alone |
| `label`, `hint`, `placeholder` | `""` | i18n keys or text for form rendering. Usually filled via `LOCALIZATION_PREFIXES` instead |
| `validate` | none | `(value, options) => boolean \| void`; `false` = invalid, `true` = valid and stop, throw `Error(msg)` for a custom message |
| `validationError` | `"is not a valid value"` | message prefix when `validate` returns `false` |

### 3.2 Class catalogue
| Class (constructor) | Stored as -> prepared as | Class defaults and type-specific options |
|---|---|---|
| `BooleanField(opts)` | boolean | `required: true, initial: false` |
| `NumberField(opts)` | number | **`nullable: true` by default**, `required: false`. Options: `min`, `max`, `step`, `integer`, `positive`, `choices` (array or `{value: label}`; choices makes `nullable` false). `integer+positive` => `min` 1 |
| `StringField(opts)` | string | `required: false`, `blank: true`, `trim: true`, `choices` (array / `{value: labelKey}` / function; forces `blank:false, nullable:false`), `textSearch` |
| `ObjectField(opts)` | plain object (deep-cloned) | `required: true`, initial `{}`. Untyped; use sparingly |
| `SchemaField(fields, opts)` | object | `required: true, nullable: false`; initial is built from children's initials (just nest, no `initial` needed) |
| `ArrayField(element, opts)` | array | `required: true`, initial `[]`, `min`, `max`. Element must be a *fresh* DataField |
| `SetField(element, opts)` | array -> **`Set`** | as ArrayField. `toObject()` returns an array. Order not preserved/guaranteed |
| `TypedObjectField(element, opts)` | record `{key: element}` | `required: true`, `validateKey(key)=>boolean`, `expandKeys` (default true: dotted keys expand). The right tool for id-keyed maps; supports `_del` per key |
| `EmbeddedDataField(Model, opts)` | object -> nested **DataModel instance** | extends SchemaField defaults. Nested model has `.parent`; its `prepareDerivedData` is NOT auto-called |
| `HTMLField(opts)` | string | `required: true, blank: true`; must be listed in manifest `htmlFields` (relative to `system`) |
| `FilePathField({categories})` | string path | `categories` **required** (non-empty subset of `CONST.FILE_CATEGORIES` keys: `IMAGE VIDEO AUDIO TEXT FONT HTML TEXTURE GRAPHICS`) or constructor throws. `nullable: true, initial: null, blank: false`; opts `base64`, `virtual` (`#name`), `wildcard`. Manifest `filePathFields` |
| `ColorField(opts)` | `"#rrggbb"` -> **`Color`** instance | `nullable: true, initial: null`. Use `color.css`; pass `{nullable:false, initial:"#ffffff"}` for non-null |
| `AngleField` / `AlphaField` / `HueField` | number | angle 0-360 normalised / 0-1 default 1 / 0-1 hue |
| `DocumentIdField` | 16-char id | core `_id`; rarely user-defined |
| `ForeignDocumentField(DocClass, {idOnly})` | id string -> **lazy getter returning Document** (`idOnly:true` keeps the string) | `nullable: true`. Resolves from world collection only; returns `null` inside compendia. Stored as ID string |
| `DocumentUUIDField({type, embedded, relative, relativize})` | UUID string | `required: true, nullable: true, initial: null`, `blank:false`. `type` restricts document name, `embedded: true/false` requires/forbids embedded, `relative` allows `.Item.id` style |
| `JSONField(opts)` | JSON **string** -> parsed object | `blank:false`. Stored as string in DB |
| `AnyField({serializable})` | anything | `nullable: true`. `serializable:true` validates JSON round-trip. Initialised **by reference** (mutating the prepared value mutates `_source`) |
| `JavaScriptField({async})` | string | validates syntax (`new Function`) |
| `TypedSchemaField({a: Schema, b: Model, ...})` | discriminated union by `type` | each variant needs a required, non-blank `type` StringField (auto-added for plain schema objects). Type switch only via `_replace` |
| `TypeDataField`, `DocumentTypeField`, `DocumentOwnershipField`, `DocumentFlagsField`, `DocumentStatsField`, `DocumentAuthorField`, `IntegerSortField`, `EmbeddedCollectionField`, `EmbeddedDocumentField`, `GridOffsetField(s)`, `ShapesField`, `SceneLevelsSetField` | core | internal to core Documents, not for system schemas |

Rules that are easy to get wrong (all from source):
* **Always give every system field `required: true, nullable: false` and an `initial`** (or let a SchemaField/ArrayField/HTMLField/BooleanField supply
  its own required default). `new StringField({required:true, blank:false})` with no `initial` makes document creation throw "may not be undefined".
  `new NumberField({required:true, initial:0})` is still **nullable**, so `null` is accepted; add `nullable:false` when you do arithmetic.
* **Field instances cannot be shared** between schemas or reused: `field.parent !== undefined` throws "already belongs to some other parent".
  Create fields inside functions (`() => new NumberField()`), never in a module-level `const` reused twice.
* Array/Set *elements* are DataFields too: `new ArrayField(new StringField({required: true, blank: false}))`.
* **Arrays are replaced wholesale on update.** Sending `{"system.tags.0": "x"}` produces a sparse array that replaces everything (verified: `["a","b","c"]` + `{"arr.1": "X"}` -> `[null, "X"]`; `{"arr.0": "Z"}` -> `["Z"]`). Send the whole
  array (`foundry.utils.deepClone(this.system.tags)`, mutate, update). `SetField` likewise. Use `TypedObjectField` when you need per-key updates/deletes.
* `choices` as a function is evaluated lazily at validation time. `defineSchema()` runs once (cached) after `init`; still prefer
  `choices: () => Object.keys(CONFIG.MYSYS.abilities)` if the list is configurable by modules.
* `StringField` with `choices: {key: "I18N.KEY"}`: values are validated against keys; labels used by `toInput`/`toFormGroup`.
* `schema.getField("attributes.hp.value")` and `doc.system.getFieldForProperty("attributes.hp.value")` return the DataField (use for form inputs:
  `field.toFormGroup({}, {value})`, `field.toInput({value})`).
* A getter on your model class with the same name as a schema field silently wins and the field is not initialised onto the instance. Name
  getters differently.
* Sub-objects of a prepared model are *copies* of source (SchemaField/ArrayField/ObjectField clone), so mutating `this.hp.max` in
  `prepareDerivedData` does not change `_source`. Exceptions: `AnyField` (by reference).

Examples:
```js
const {SchemaField, NumberField, StringField, BooleanField, ArrayField, SetField, TypedObjectField,
  EmbeddedDataField, HTMLField, FilePathField, DocumentUUIDField, ForeignDocumentField, ColorField,
  JSONField, AnyField, TypedSchemaField} = foundry.data.fields;

static defineSchema() {
  return {
    level: new NumberField({required: true, nullable: false, integer: true, min: 1, max: 20, initial: 1}),
    rank: new StringField({required: true, choices: ["novice", "veteran"], initial: "novice"}), // choices => nonblank
    alignment: new StringField({required: true, blank: true, initial: ""}),
    inspiration: new BooleanField(),                                  // required, initial false
    notes: new HTMLField(),                                           // list in manifest htmlFields
    portrait: new FilePathField({categories: ["IMAGE"]}),            // null until set
    tint: new ColorField({nullable: false, initial: "#ffffff"}),
    tags: new SetField(new StringField({required: true, blank: false})),
    languages: new ArrayField(new StringField({required: true, blank: false}), {max: 10}),
    skills: new TypedObjectField(new SchemaField({                    // {athletics: {rank, ability}, ...}
      rank: new NumberField({required: true, nullable: false, integer: true, min: 0, max: 5, initial: 0}),
      ability: new StringField({required: true, choices: ["str","dex","con","int","wis","cha"], initial: "str"})
    }), {validateKey: key => /^[a-z]+$/.test(key)}),
    origin: new DocumentUUIDField({type: "Item"}),                   // null or "Item.abc..." / "Compendium...."
    mentor: new ForeignDocumentField(foundry.documents.BaseActor),   // id in source; getter -> Actor|null
    custom: new AnyField({serializable: true, nullable: true, initial: null}),
    hp: new SchemaField({                                             // nested defaults need no `initial`
      value: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 10}),
      max:   new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 10})
    }),
    // fixed-shape union
    attack: new TypedSchemaField({
      melee:  {reach: new NumberField({required: true, nullable: false, initial: 1})},
      ranged: {range: new NumberField({required: true, nullable: false, initial: 30})}
    }),
    // non-persisted, effect-targetable derived slot (v14)
    ac: new NumberField({persisted: false, required: true, nullable: false, integer: true, initial: 10})
  };
}
```
Custom field behaviour (ActiveEffects): override `_applyChangeAdd/_applyChangeMultiply/...(value, delta, model, change)` in a `DataField` subclass; the
`system.*` effect key is resolved to the field via `getFieldForProperty`, so typed application (Set union, array concat, number math) is automatic.

### 3.3 Embedded (nested) DataModels
```js
class ChargesData extends foundry.abstract.DataModel {
  static defineSchema() { return {value: new NumberField({required:true, nullable:false, integer:true, min:0, initial:1}), max: new NumberField({required:true, nullable:false, integer:true, min:0, initial:1})}; }
  get depleted() { return this.value <= 0; }
}
// in a TypeDataModel schema:
charges: new EmbeddedDataField(ChargesData),
rewards: new ArrayField(new EmbeddedDataField(RewardData))
```
* The nested model gets `this.parent` = the enclosing model; `getNearestDocument()` walks up to the Document.
* Core only calls `prepareBaseData/prepareDerivedData` on the `system` TypeDataModel. Call nested ones yourself from the parent's prepare methods.

---

## 4. Localization and metadata

```js
class WeaponData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["MYSYS.Item.base", "MYSYS.Item.weapon"];   // later prefixes override earlier ones
}
```
```jsonc
// lang/en.json
{
  "TYPES": { "Item": { "weapon": "Weapon", "feature": "Feature" }, "Actor": { "character": "Character", "npc": "NPC" } },
  "MYSYS": { "Item": { "weapon": { "FIELDS": {
      "damage": { "label": "Damage", "formula": { "label": "Formula", "hint": "e.g. 1d8+@str.mod" } }   // container label sits beside child keys
  } } } }
}
```
* Core localises every registered `CONFIG.<Doc>.dataModels` entry once at `i18nInit` (after `init`): it fills each field's `label`/`hint`/`placeholder`
  (only if empty) from `<prefix>.FIELDS.<path>.label|hint|placeholder`. The `system.` prefix is stripped from paths. Register models in `init`, not later.
* For non-document models (e.g. a Setting model) call `foundry.helpers.Localization.localizeDataModel(MyModel)` in an `i18nInit` hook.
* Explicit `label: "MYSYS.Foo"` on a field also works (localised at render time by form helpers).
* `_loc("KEY", {vars})` is a v14 global alias of `game.i18n.localize`/`format`; `game.i18n.localize()` and `game.i18n.format()` still work in all versions.
* **`metadata` is a Document-class static, not a model one**: `Actor.metadata` (frozen) has `name`, `collection`, `embedded`, `hasTypeData`, `baseTypeAllowed`,
  `permissions`, `compendiumIndexFields`, `schemaVersion`, `coreTypes`. TypeDataModel has no `metadata`. Read-only; do not mutate.
  Subclass Documents inherit it; never reassign.

---

## 5. Data preparation

### 5.1 Order (Actor with embedded Items and Effects)
```
construct/_initialize (fields copied from _source -> instance; system model built)      [Document#_initialize -> _safePrepareData]
Actor#prepareData()                                                                       [ClientDocument#prepareData, Actor override]
  1. system.prepareBaseData()           TypeDataModel
  2. actor.prepareBaseData()            Actor: this._clearData() (resets overrides, statuses, effect phase tracker)
  3. actor.prepareEmbeddedDocuments()   each embedded Item/ActiveEffect runs its OWN full prepareData
                                         (Item: system.prepareBaseData -> item.prepareBaseData -> ... -> system.prepareDerivedData -> item.prepareDerivedData)
                                         then Actor#applyActiveEffects("initial")           <-- effects with phase "initial"
  4. system.prepareDerivedData()        TypeDataModel
  5. actor.prepareDerivedData()
  Actor#prepareData after super: applyActiveEffects("final")                                <-- effects with phase "final"
```
Consequences:
* **Items finish preparing (base + derived) before the actor's `prepareDerivedData`.** So an Actor can sum Item-derived values; an Item's derived data cannot
  rely on the actor's derived data (it only sees the actor after step 1-2 of that same pass). Compute item-vs-actor numbers lazily (getters/methods) or in the Actor.
* "initial" effects run after base data + embedded prep and BEFORE derived data: they modify *base* values (ability scores, bonuses), and your derived
  math then sees the modified values. "final" effects run after all derived data: they modify *derived* values (AC, initiative) without being recomputed over.
  Pattern: either compute the derived slot in `prepareBaseData` (so "initial" effects add to it) or declare it `persisted:false` and use "final".
* Packages can register additional phases (`CONFIG.ActiveEffect.phases`) and must call `actor.applyActiveEffects("myPhase")` themselves.
* `prepareData` runs again on every update to the document or any embedded document (parent `reset()` after embedded changes), on `reset()`,
  and when synthetic token actors rebuild. It must be **idempotent**: never `this.x += n` on a non-schema property; assign from scratch each pass.
  `reset()` / `updateSource()` / document (re)initialisation re-copy schema fields from `_source` before preparing; a bare `doc.prepareData()` call does NOT
  (so calling it by hand double-applies `+=` style math: call `doc.reset()` instead). Non-schema properties you added are never cleared (assign them every time).
* Exceptions in `prepareData` are caught and logged ("Failed data preparation for ..."); the document stays half-prepared and sheets may look empty. Check the console.
* **Never call `update`, `setFlag`, `createEmbeddedDocuments`, etc. inside prepare methods** (infinite re-initialisation loop).
* `this.parent` is the Document (Actor/Item); for an embedded Item `this.parent.parent` is the Actor (`item.actor`). Embedded collections of the parent may not yet be prepared in `prepareBaseData`.
* Document-level overrides: `prepareData()` only for cross-cutting ordering needs, and always `super.prepareData()`. `Actor#prepareBaseData` MUST be called via
  `super.prepareBaseData()` or effects/statuses accumulate duplicates on every re-prepare.

### 5.2 Persisted vs derived
```js
prepareBaseData() {
  // seed values that effects will modify, so "add"/"multiply" never hit undefined (-> NaN)
  this.attributes.speedBonus = 0;
}
prepareDerivedData() {
  for (const ab of Object.values(this.abilities)) ab.mod = Math.floor((ab.value - 10) / 2);    // not in schema => not saved
  this.attributes.hp.pct = this.attributes.hp.max ? this.attributes.hp.value / this.attributes.hp.max : 0;
  this.attributes.hp.value = Math.min(this.attributes.hp.value, this.attributes.hp.max);          // display clamp; source unchanged
}
```
* Anything not defined in `defineSchema()` is derived: never saved, lost on `toObject()` (source), recomputed each pass.
* Assigning a schema-field property in prepare changes only the prepared value, not `_source` (what `update` diffs against).
* Effects targeting `system.some.path` use the schema field if one exists; otherwise a heuristic keyed on the property's *current runtime type* — hence seed it in `prepareBaseData`.
* Test/inspect: `actor.system._source` (persisted) vs `actor.system` (prepared) vs `actor.toObject(false)` (schema fields, prepared values).

---

## 6. Migration and validation

### 6.1 `static migrateData(source, options)`
```js
static migrateData(source, options) {
  // 1. runs on load AND on every update delta (partial!). Guard with `in` / `??`.
  if ("hp" in source && typeof source.hp === "number") source.hp = {value: source.hp, max: source.hp};
  if (source.weapons?.length) source.weapons = source.weapons.map(w => w === "bmr" ? "boomerang" : w);
  // 2. rename: helper on Document; for models do it by hand
  if ("bio" in source && !("biography" in source)) { source.biography = source.bio; delete source.bio; }
  return super.migrateData(source, options);        // MUST return the object (v14 warns when undefined is returned)
}
```
* Runs inside `cleanData` before cleaning (so legacy shapes are fixed before type casting/pruning). Failures are caught and warned (`migrateDataSafe`).
* Migration happens **in memory** at load. The stored DB document keeps the old shape until it is written. Unknown keys are pruned from `_source` on load,
  but pruned keys stay in the database until a replacing write (see documents.md "world migration").
* The server does not run system models (client only), so system migrations are your responsibility on the client.
* Core Documents have their own `migrateData`; `TypeDataField._migrate` calls the model's `migrateDataSafe` with `_state.documentType`.

### 6.2 `static shimData(data, options)`
Backward-compatible aliases (deprecated accessors) applied to already-clean source. Define non-enumerable getters/setters; return `data`.
```js
static shimData(data, options) {
  if (!Object.isSealed(data) && !("oldHp" in data)) {
    Object.defineProperty(data, "oldHp", {get: () => data.hp?.value, configurable: true, enumerable: false});
  }
  return super.shimData(data, options);
}
```
Prefer `migrateData` for permanent changes; shims are only to keep third-party code working, with a deprecation log.

### 6.3 Cleaning and validation
| Hook | Kind | Use |
|---|---|---|
| `static _preCleanData(data, options, _state)` | v14 | adjust cleaning options/state before fields clean (rarely needed) |
| `static _cleanData(data, options, _state)` | v14 | final in-place model-level cleaning after all fields (computed defaults). Mutate `data`, no return |
| `static cleanData(data, options, _state)` | all versions | public entry; overriding still works (call `super.cleanData`) **[v13: the override point]** |
| `static validateJoint(data)` | all | cross-field validation; `throw new Error("max must be >= value")`. Runs on construction and on every `updateSource` |
| field `validate` option | all | single-field custom check |
| `model.validate({changes, strict, fallback, dropInvalidEmbedded})` | instance | `validate({changes: {...}})` dry-runs an update; `strict:false` returns boolean |
| `model.invalid`, `model.validationFailures` | instance | inspect failures of a loaded model |
```js
static validateJoint(data) {
  if (data.hp.value > data.hp.max) throw new Error("hp.value cannot exceed hp.max");
}
```
Validation is strict for user input (creation/update throws and shows a notification) and non-strict (`fallback` to initial, logs) for data loaded from
the database (`fromSource`). A failed update never reaches the server.

---

## 7. Database lifecycle hooks on TypeDataModel

Signatures (from `type-data.mjs`). The Document forwards to the model *after* its own base handling:
```js
async _preCreate(data, options, user) {}      // return false to cancel. initiating client only. `user` = User document
_onCreate(data, options, userId) {}           // ALL clients, after the DB write
async _preUpdate(changes, options, user) {}   // initiating client only. mutate `changes` freely (already expanded + cleaned). return false cancels
_onUpdate(changed, options, userId) {}        // ALL clients
async _preDelete(options, user) {}            // initiating client only
_onDelete(options, userId) {}                 // ALL clients
```
Corresponding Document hooks fire separately: `preCreateActor(doc, data, options, userId)`, `createActor(doc, options, userId)`,
`preUpdateActor(doc, changes, options, userId)`, `updateActor(doc, changed, options, userId)`, `preDeleteActor(doc, options, userId)`, `deleteActor(doc, options, userId)`
(see documents.md). Order for a create on the initiating client: `Document._preCreate` -> `system._preCreate` -> `preCreate<Doc>` hook -> batch `_preCreateOperation` -> server -> `_onCreate` (+ `system._onCreate`) -> `create<Doc>` hook.

```js
class CharacterData extends BaseActorData {
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    // To change the pending document use updateSource, NOT the `data` argument (the doc is already built from `data`).
    if (!foundry.utils.hasProperty(data, "prototypeToken.actorLink")) {
      this.parent.updateSource({prototypeToken: {actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY}});
    }
    if (!data.img) this.parent.updateSource({img: "systems/mysystem/icons/character.svg"});
    this.updateSource({"attributes.hp.value": 12, "attributes.hp.max": 12});   // updateSource on the model itself targets `system`
    // (keys not in the schema are silently pruned by updateSource)
  }

  async _preUpdate(changes, options, user) {
    const allowed = await super._preUpdate(changes, options, user);
    if (allowed === false) return false;
    // `changes` is a nested object by now (dotted keys already expanded)
    const newHp = foundry.utils.getProperty(changes, "system.attributes.hp.value");
    if (newHp !== undefined) {
      foundry.utils.setProperty(changes, "system.attributes.hp.value",
        Math.clamp(newHp, 0, this.attributes.hp.max));
      options.hpDelta = newHp - this.attributes.hp.value;       // custom options travel to _onUpdate/hooks on every client
    }
  }

  _onUpdate(changed, options, userId) {
    super._onUpdate(changed, options, userId);
    if (userId !== game.user.id) return;                          // side effects: only the author runs them
    if (this.attributes.hp.value <= 0 && !this.parent.statuses.has("dead")) {
      this.parent.toggleStatusEffect("dead", {active: true, overlay: true});   // a write => author only
    }
  }

  async _preDelete(options, user) {
    const allowed = await super._preDelete(options, user);
    if (allowed === false) return false;
    if (this.parent.inCombat) { ui.notifications.warn("Remove this actor from combat first."); return false; }
  }
}
```
Rules:
* **Who runs what**: `_pre*` only on the requesting client (and the server then validates permission). `_on*`/`create*/update*/delete*` hooks run on every connected
  client. Any follow-up database write or dialog/chat message must be guarded with `game.user.id === userId` (the author), or `game.user.isActiveGM` for GM-owned work
  (otherwise N clients do it N times).
* Always `await super._preX(...)` and respect `false`. `_preX` may be async; Hooks are **never awaited** (an async `preUpdateActor` hook cannot cancel).
* `_preUpdate` `changes` is only the delta, not full data; `this` still holds the *old* values. `_onUpdate` `changed` is the applied delta; `this` holds the *new* values.
* On unlinked-token synthetic actors, `system._onUpdate`/`updateActor` still fire (with `actor.isToken === true`); the write goes to the token's ActorDelta.

---

## 8. Working with data

| Need | API |
|---|---|
| Persisted data, plain copy (safe to modify and send to `create`/`update`) | `doc.toObject()` / `model.toObject()` (default `source=true`) |
| Prepared data snapshot (includes derived; NOT for persistence) | `doc.toObject(false)` / `model.toObject(false)` |
| Live persisted object (sealed: no key add/remove; do not mutate) | `doc._source`, `model._source` |
| Change pending, un-saved doc or local preview | `doc.updateSource(changes, {dryRun, fallback, recursive})` returns the diff, re-initialises/prepares; no hooks, no DB, no re-render |
| Validate a change without applying | `model.validate({changes, strict:false})` |
| Copy | `doc.clone(data, {save, keepId, addSource})`; `model.clone(data)` (sync, unsaved) |
| Reset prepared state from source | `doc.reset()`, `model.reset()` |
| Build a standalone model | `new MyModel(data, {strict: false})` or `MyModel.fromSource(data)` (non-strict) |
| Schema introspection | `MyModel.schema` (class), `doc.system.schema`, `schema.fields`, `schema.getField("a.b")`, `schema.keys()/entries()` |
| Nearest document | `model.getNearestDocument()` |

`getRollData` lives on the **Document**, not on TypeDataModel. Default returns `this.system` (the model itself, not a copy; never mutate).
```js
class BaseActorData extends foundry.abstract.TypeDataModel {
  getRollData() {
    const data = {...this};                    // own enumerable props = prepared schema fields + derived props (shallow)
    for (const [k, ab] of Object.entries(this.abilities)) data[k] = ab;   // @str.mod
    data.lvl = this.level;                     // getters on the prototype are NOT copied; add them explicitly
    return data;
  }
}
class MySystemActor extends Actor {
  getRollData() { return this.system.getRollData?.() ?? {...this.system}; }
}
```
`@lvl`, `@str.mod`, `@attributes.hp.value` then work in `new Roll("1d20 + @str.mod", actor.getRollData())` and in ActiveEffect string values.
For an Item, `item.getRollData()` is also `this.system`; merge actor data explicitly: `{...this.actor?.getRollData(), item: this.system}`.

`actor.system.toObject()` vs `actor.toObject().system` are equal. Never `JSON.stringify(actor.system)`: use `toObject()`.

---

## 9. Reuse: schema chunks, mixins, inheritance

This replaces template.json `templates`.

**(a) Inheritance** (best default): base model + per-type subclasses; always spread `super.defineSchema()`.
```js
class BaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() { return {description: new HTMLField(), ...}; }
}
class WeaponData extends BaseItemData {
  static defineSchema() { return {...super.defineSchema(), damage: new SchemaField({...})}; }
}
```
**(b) Schema chunk functions** (swade pattern; fresh fields on every call):
```js
export const quantity = () => ({quantity: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 1}),
                                weight:   new NumberField({required: true, nullable: false, min: 0, initial: 0})});
class GearData extends BaseItemData { static defineSchema() { return {...super.defineSchema(), ...quantity()}; } }
```
**(c) Class mixins** (shared behaviour + schema):
```js
const PhysicalMixin = Base => class extends Base {
  static defineSchema() { return {...super.defineSchema(), ...quantity()}; }
  get totalWeight() { return this.quantity * this.weight; }
};
class WeaponData extends PhysicalMixin(BaseItemData) {}
```
Pitfalls: `instanceof` checks against mixin-created classes need `Symbol.hasInstance` or a marker getter (`get isPhysical() { return true; }`);
`LOCALIZATION_PREFIXES` is a static per class (spread `super.LOCALIZATION_PREFIXES`); do not hoist field instances.

---

## 10. Worked example

`system.json` (relevant parts):
```json
{
  "id": "mysystem", "title": "My System", "version": "0.1.0",
  "compatibility": {"minimum": "14", "verified": "14"},
  "esmodules": ["module/mysystem.mjs"], "styles": ["styles/mysystem.css"],
  "languages": [{"lang": "en", "name": "English", "path": "lang/en.json"}],
  "documentTypes": {
    "Actor": {"character": {"htmlFields": ["details.biography"]}, "npc": {"htmlFields": ["details.biography"]}},
    "Item":  {"weapon": {"htmlFields": ["description"]}, "feature": {"htmlFields": ["description"]}}
  },
  "primaryTokenAttribute": "attributes.hp"
}
```

`module/data/chunks.mjs` (schema chunks + constants):
```js
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
const {NumberField, SchemaField, HTMLField, StringField, BooleanField} = foundry.data.fields;

export const resource = (initial = 10) => new SchemaField({
  value: new NumberField({required: true, nullable: false, integer: true, min: 0, initial}),
  max:   new NumberField({required: true, nullable: false, integer: true, min: 0, initial})
});
export const abilitySchema = () => new SchemaField(Object.fromEntries(ABILITIES.map(k => [k, new SchemaField({
  value: new NumberField({required: true, nullable: false, integer: true, min: 1, max: 30, initial: 10})
})])));
export const description = () => ({description: new HTMLField()});
export const physical = () => ({
  quantity: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 1}),
  weight:   new NumberField({required: true, nullable: false, min: 0, initial: 0})
});
```

`module/data/actor.mjs`:
```js
import {ABILITIES, resource, abilitySchema} from "./chunks.mjs";
const {SchemaField, NumberField, HTMLField, StringField, TypedObjectField} = foundry.data.fields;

export class BaseActorData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["MYSYS.Actor.base"];

  static defineSchema() {
    return {
      abilities: abilitySchema(),
      attributes: new SchemaField({
        hp: resource(10),
        movement: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 30}),
        ac: new NumberField({persisted: false, required: true, nullable: false, integer: true, initial: 10})
      }),
      details: new SchemaField({biography: new HTMLField()}),
      conditions: new TypedObjectField(new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 1}))
    };
  }

  static validateJoint(data) {
    if (data.attributes.hp.value > data.attributes.hp.max * 2) throw new Error("hp.value is implausibly large");
  }

  /** Runs on load and on partial update deltas: only touch the legacy shape. */
  static migrateData(source, options) {
    if (typeof source.hp === "number") {                          // v0 stored a bare number at system.hp
      foundry.utils.setProperty(source, "attributes.hp", {value: source.hp, max: source.hp});
      delete source.hp;
    }
    return super.migrateData(source, options);
  }

  /* ---- Preparation ---- */
  prepareBaseData() {
    super.prepareBaseData();
    this.attributes.initiativeBonus = 0;                         // seed a slot effects may add to
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    for (const ab of Object.values(this.abilities)) ab.mod = Math.floor((ab.value - 10) / 2);
    this.attributes.ac += this.abilities.dex.mod;                 // ac is a persisted:false slot starting at 10
    this.attributes.initiative = this.abilities.dex.mod + this.attributes.initiativeBonus;
    // Items finished preparing before this runs, so their derived values/getters are safe to read here
    this.encumbrance = this.parent.items.reduce((s, i) => s + (i.system.totalWeight ?? 0), 0);
  }

  get isDead() { return this.attributes.hp.value <= 0; }

  getRollData() {
    const data = {...this};
    for (const k of ABILITIES) data[k] = this.abilities[k];
    return data;
  }
}

export class CharacterData extends BaseActorData {
  static LOCALIZATION_PREFIXES = ["MYSYS.Actor.base", "MYSYS.Actor.character"];
  static defineSchema() {
    return {
      ...super.defineSchema(),
      level: new NumberField({required: true, nullable: false, integer: true, min: 1, max: 20, initial: 1}),
      xp: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 0})
    };
  }
  prepareDerivedData() {
    this.proficiency = 2 + Math.floor((this.level - 1) / 4);     // set before super if super uses it
    super.prepareDerivedData();
  }
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (!foundry.utils.hasProperty(data, "prototypeToken.actorLink")) {
      this.parent.updateSource({prototypeToken: {actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY}});
    }
  }
}

export class NpcData extends BaseActorData {
  static LOCALIZATION_PREFIXES = ["MYSYS.Actor.base", "MYSYS.Actor.npc"];
  static defineSchema() {
    return {...super.defineSchema(), cr: new NumberField({required: true, nullable: false, min: 0, step: 0.125, initial: 1})};
  }
  prepareDerivedData() {
    super.prepareDerivedData();
    this.xp = Math.round(this.cr * 200);                         // derived, not stored
    this.proficiency = 2 + Math.floor(Math.max(this.cr - 1, 0) / 4);
  }
}
```

`module/data/item.mjs`:
```js
import {ABILITIES, description, physical} from "./chunks.mjs";
const {SchemaField, NumberField, StringField, BooleanField} = foundry.data.fields;

export class BaseItemData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["MYSYS.Item.base"];
  static defineSchema() { return {...description()}; }
  get actor() { return this.parent.actor; }            // Item#actor
}

export class WeaponData extends BaseItemData {
  static LOCALIZATION_PREFIXES = ["MYSYS.Item.base", "MYSYS.Item.weapon"];
  static defineSchema() {
    return {
      ...super.defineSchema(), ...physical(),
      equipped: new BooleanField(),
      ability: new StringField({required: true, choices: ABILITIES, initial: "str"}),
      damage: new SchemaField({
        formula: new StringField({required: true, blank: false, initial: "1d6"}),
        type: new StringField({required: true, choices: ["slashing", "piercing", "bludgeoning"], initial: "slashing"})
      }),
      range: new SchemaField({
        value: new NumberField({required: true, nullable: true, min: 0, initial: null}),
        long:  new NumberField({required: true, nullable: true, min: 0, initial: null})
      })
    };
  }

  // Lazy getters: items prepare BEFORE their actor's prepareDerivedData, so actor-derived numbers (abilities.*.mod)
  // are not available during the item's own prepare pass. A getter is evaluated when read (sheet render, roll).
  get totalWeight() { return this.quantity * this.weight; }
  get attackBonus() { return this.actor?.system.abilities[this.ability]?.mod ?? 0; }

  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (!data.img) this.parent.updateSource({img: "systems/mysystem/icons/weapon.svg"});
  }

  async roll() {
    const rollData = this.actor?.getRollData() ?? {};
    const roll = await new Roll(`1d20 + @item.attackBonus + @prof`, {...rollData, item: this, prof: rollData.proficiency ?? 0}).evaluate();
    return roll.toMessage({speaker: ChatMessage.getSpeaker({actor: this.actor}), flavor: this.parent.name});
  }
}

export class FeatureData extends BaseItemData {
  static LOCALIZATION_PREFIXES = ["MYSYS.Item.base", "MYSYS.Item.feature"];
  static defineSchema() {
    return {...super.defineSchema(), uses: new SchemaField({
      value: new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 0}),
      max:   new NumberField({required: true, nullable: false, integer: true, min: 0, initial: 0}),
      per:   new StringField({required: true, choices: ["", "short", "long", "day"], blank: true, initial: ""})
    })};
  }
}
```
Design note: `WeaponData` uses getters (`totalWeight`, `attackBonus`) rather than assigning in `prepareDerivedData`, because the actor's `abilities.*.mod` is
computed in the actor's `prepareDerivedData`, which runs after its items prepared. Anything an Item needs from actor-derived data must be read lazily.

`module/documents.mjs`:
```js
export class MySystemActor extends Actor {
  prepareBaseData() { super.prepareBaseData(); /* required: calls _clearData() */ }
  prepareDerivedData() { super.prepareDerivedData(); }
  getRollData() { return this.system.getRollData?.() ?? {...this.system}; }

  /** Domain helper: apply damage as a single update */
  async applyDamage(amount) {
    const hp = this.system.attributes.hp;
    return this.update({"system.attributes.hp.value": Math.max(hp.value - amount, 0)});
  }
}
export class MySystemItem extends Item {
  getRollData() { return {...this.actor?.getRollData(), item: this.system}; }
}
```

`module/mysystem.mjs`:
```js
import {MySystemActor, MySystemItem} from "./documents.mjs";
import {CharacterData, NpcData} from "./data/actor.mjs";
import {WeaponData, FeatureData} from "./data/item.mjs";

Hooks.once("init", () => {
  CONFIG.Actor.documentClass = MySystemActor;
  CONFIG.Item.documentClass = MySystemItem;
  Object.assign(CONFIG.Actor.dataModels, {character: CharacterData, npc: NpcData});
  Object.assign(CONFIG.Item.dataModels, {weapon: WeaponData, feature: FeatureData});
  CONFIG.Actor.trackableAttributes = {character: {bar: ["attributes.hp"], value: []}, npc: {bar: ["attributes.hp"], value: []}};
});
```
`lang/en.json`: `{"TYPES": {"Actor": {"character": "Character", "npc": "NPC"}, "Item": {"weapon": "Weapon", "feature": "Feature"}}, "MYSYS": {"Actor": {"base": {"FIELDS": {"attributes": {"hp": {"label": "Hit Points", "value": {"label": "Current"}, "max": {"label": "Maximum"}}}}}}}}`

Usage:
```js
const hero = await Actor.implementation.create({name: "Ada", type: "character", system: {level: 3, abilities: {str: {value: 16}}}});
hero.system.abilities.str.mod;                 // 3 (derived)
await hero.createEmbeddedDocuments("Item", [{name: "Sword", type: "weapon", system: {damage: {formula: "1d8"}}}]);
await hero.update({"system.attributes.hp.value": 4});     // dotted path OK
```

---

## 11. Gotcha checklist
1. Missing `documentTypes` in system.json: documents of that type are dropped by the server.
2. No `initial` on a required, non-nullable field: creating a document throws.
3. `NumberField` is nullable by default; HTML/file fields not listed in manifest are unsanitised.
4. Reusing one field instance in two schemas throws. Build fields inside functions.
5. Arrays/Sets are replaced as a whole by updates; use `TypedObjectField` for keyed collections.
6. `FilePathField` without `categories` throws at definition time.
7. `migrateData` runs on partial update deltas; guard keys and always `return` the source.
8. Overriding `prepareBaseData` on an Actor subclass without `super` breaks effect/status reset.
9. Item derived data cannot see actor derived data (items prepare first). Use lazy getters.
10. Never write to the database from prepare methods; guard `_on*` side-effects with `userId === game.user.id` / `isActiveGM`.
11. `data` in `_preCreate` is read-only in effect; use `this.updateSource`/`this.parent.updateSource`. In `_preUpdate`, mutate `changes`.
12. `readonly:true` fields throw when assigned in prepare; getters named like fields shadow the field.
13. `hooks` never await async handlers; a returned Promise does not cancel.
14. `template.json`, `data.data`, `-=key`, numeric effect `mode`, `entity`, globals `mergeObject/duplicate` are obsolete (see section 1).
15. **[v13]** `_del`/`_replace`, `_cleanData`, `persisted`, `system.changes`, change `type`/`phase`, `CombatantGroup`, `Level` are v14 additions; branch on `game.release.generation >= 14` for cross-version packages.

---

## 12. Unit-testing models in plain Node (no server, no ports)

`<app>/common/server.mjs` is importable from plain Node (>= 24). It exposes `foundry.abstract/data/documents/utils/CONST` including `BaseActor`, `BaseItem`,
`BaseActiveEffect` and all field classes, so schemas, defaults, `migrateData`, `validateJoint`, `updateSource`, `_del`/`_replace` and the *base data* half of
`prepareBaseData/prepareDerivedData` can be tested in milliseconds. Verified against build 369 while writing this reference (all snippets above that make
claims about defaults/updates/validation were run this way).

```js
// test/boot.mjs
import path from "node:path";
import {pathToFileURL} from "node:url";
const APP = process.env.FOUNDRY_APP_PATH ?? "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app";
// Stubs MUST exist before the import (core reads CONFIG.Token.* at load time)
globalThis.CONFIG = new Proxy({}, {get: (t, k) => (k in t) ? t[k] : (typeof k === "string" ? (t[k] = {}) : undefined)});
globalThis.game = {};
globalThis.logger = console;
const ns = await import(pathToFileURL(path.join(APP, "common/server.mjs")).href);
globalThis.foundry = ns;                 // your model files use the global `foundry.data.fields`
globalThis.CONST = ns.CONST;
globalThis._del = new ns.data.operators.ForcedDeletion();             // client-only globals
globalThis._replace = ns.data.operators.ForcedReplacement.create;
export default ns;
```
```js
// test/models.test.mjs   (run: node --test)
import test from "node:test";
import assert from "node:assert/strict";
import ns from "./boot.mjs";
// Import YOUR model modules dynamically AFTER boot (static sibling imports can evaluate before the top-level await finishes)
const {CharacterData} = await import("../module/data/actor.mjs");

CONFIG.Actor.dataModels = {character: CharacterData};
game.model = {Actor: {character: {}}};                                   // legal types for BaseActor.TYPES
game.system = {id: "mysystem", documentTypes: {Actor: {character: {}}}};
game.release = {version: "14.369"};

test("defaults and derived data", () => {
  const actor = new ns.documents.BaseActor({name: "T", type: "character", system: {abilities: {str: {value: 16}}}});
  actor.system.prepareBaseData();        // the client calls these in prepareData; do it by hand here
  actor.system.prepareDerivedData();
  assert.equal(actor.system.abilities.str.mod, 3);
  assert.equal(actor.system.attributes.hp.value, 10);
});
test("joint validation rejects", () => {
  const actor = new ns.documents.BaseActor({name: "T", type: "character"});
  assert.throws(() => actor.updateSource({"system.attributes.hp.value": 9999}), /implausibly large/);
});
test("migration", () => {
  const actor = new ns.documents.BaseActor({name: "T", type: "character", system: {hp: 7}});   // legacy shape: bare number
  assert.equal(actor.system.attributes.hp.value, 7);
});
```
Limits: client-only members do not exist here (`Item#actor`, `Actor#statuses`, `prepareData` orchestration, `applyActiveEffects`, sheets, `Hooks`, `game.actors`,
`Roll`). Call the model's prepare methods by hand, or test those parts in the real headless server (see testing.md). Use `item.parent?.parent` instead of
`item.actor` in code you want to test this way. Stub `game.i18n` only if your schema reads it at definition time.

### Verify in source (cheat map)
* Fields and defaults: `common/data/fields.mjs` (`static get _defaults`).
* DataModel API (cleanData, updateSource, clone, validate, shimData): `common/abstract/data.mjs`.
* TypeDataModel hooks: `common/abstract/type-data.mjs`; forwarding: `client/documents/abstract/client-document.mjs`.
* Prep order and effect phases: `client/documents/actor.mjs` (`prepareData`, `applyActiveEffects`).
* Manifest sanitisation fields: `common/packages/_types.mjs` (`ServerSanitizationFields`), `common/packages/sub-types.mjs`.
* Config registries: `client/config.mjs` (`dataModels`, `typeLabels`, `trackableAttributes`).
* Online: https://foundryvtt.com/article/system-data-models/ , https://foundryvtt.com/article/module-sub-types/ , https://foundryvtt.com/api/v14/
