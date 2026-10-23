# Localization and Package Styles (Foundry v14)

Companion to `manifest-and-packaging.md`. Everything here was checked against the v14 (build 369) source in
`client/helpers/localization.mjs`, `common/packages/base-package.mjs`, `dist/server/views/view.mjs`,
`templates/views/layouts/main.hbs` and `public/css/foundry2.css`.

## Contents
1. Localization: registering languages
2. Translation file structure and load order
3. The API: `localize`, `format`, `has`, `_loc`, Handlebars
4. Timing: when translations exist (`init` vs `i18nInit`)
5. Auto-localized data model fields (`LOCALIZATION_PREFIXES`)
6. Document type labels, settings, compendium labels, other places
7. Translation modules, plurals, lists
8. Styles: manifest `styles` and CSS layers
9. Scoping, themes and CSS variables

---------------------------------------------------------------------------------------------------

## 1. Localization: registering languages

Manifest (system, module and world all use the same field):

```json
"languages": [
  { "lang": "en", "name": "English", "path": "lang/en.json" },
  { "lang": "pt-BR", "name": "Português (Brasil)", "path": "lang/pt-BR.json" },
  { "lang": "de", "name": "Deutsch", "path": "lang/de-dnd5e.json", "system": "dnd5e" }
]
```

| Key | Rules |
|---|---|
| `lang` | Required. Must pass `Intl.getCanonicalLocales` (`en`, `pt-BR`, `zh-Hans`). |
| `name` | Optional label shown in the Language setting. Defaults to `lang`. |
| `path` | Required. Relative to the package root. **The file must exist** or the entry is dropped with a Setup warning. |
| `system` | Optional system id. Entry loads only if that system is the active system. (v14 validates it as a package id.) |
| `module` | Optional module id. Entry loads only if that module is active. |
| `flags` | Free-form. |

- Always ship `en`. When the user's language is not `en`, core loads English as a **fallback dictionary**, so any key
  you did not translate still shows English instead of the raw key.
- A language appears in the user's Language setting only if some package declares it (`CONFIG.supportedLanguages`
  is built from the manifests of the active system, active modules, world). Core itself ships only `en`
  (`CONST.CORE_SUPPORTED_LANGUAGES = ["en"]`).
- Module-only field `"coreTranslation": true` marks a module that translates **core Foundry** strings
  (a language pack). Its languages are registered before all others. Server option `language: "en.core"` has the
  form `<lang>.<module-id>`; the named module's translations are loaded even if the module is not enabled.

## 2. Translation file structure and load order

JSON, string leaves. Flat dotted keys and nested objects are equivalent: every file is run through
`foundry.utils.expandObject` on load. Do not define the same path as both a string and an object.

```json
{
  "MYSYS.Title": "My System",
  "MYSYS": {
    "Roll": { "Attack": "Attack Roll", "Damage": "Damage ({type})" },
    "Settings": {
      "HouseRules": { "Name": "House Rules", "Hint": "Enable optional rules from chapter 9." }
    }
  }
}
```

- **Namespace every key** with your package (`MYSYS.`, `MY_MODULE.`). Modules can override core and system keys,
  so unprefixed keys collide. Keys with no dot are not even considered valid string ids by the debug logger.
- **Load/merge order (source wins over the KB wiki)**: core `lang/en.json` -> system -> active modules (in
  `game.modules` order) -> world. Later `mergeObject` overrides earlier. Verify in `Localization#getTranslations`.
- Debug missing keys: set `CONFIG.debug.i18n = true` (logs `Localization | Key "X" is not defined.`).
- Translator-friendly strings: use placeholders (`"Damage ({type})"`), never concatenate fragments (word order and
  gender differ per language). Leave 25-50% extra room in layouts for long languages. Reuse one key only when the
  meaning is identical (a "Save" button vs a "Save" saving throw need separate keys).

## 3. The API

```js
game.i18n.localize("MYSYS.Title");                                  // "My System"
game.i18n.localize("MYSYS.Roll.Damage", { type: "fire" });          // "Damage (fire)"  (v14)
game.i18n.format("MYSYS.Roll.Damage", { type: "fire" });            // identical alias
game.i18n.has("MYSYS.Title");                                       // true; has(key, false) ignores en fallback
_loc("MYSYS.Roll.Damage", { type: "fire" });                        // v14 global alias of game.i18n.localize
```

| Behavior | Detail |
|---|---|
| Missing key | Returns the key string itself (never throws). |
| Placeholders | `{name}` tokens replaced from the data object. **No HTML escaping**, escape user text yourself. |
| `format` | **v14**: `format()` was merged into `localize()`; `format` remains a silent alias. In **v13**, `localize` took no data and you had to call `format`. For code that must run on v13 and v14, use `game.i18n.format(...)` (works in both). |
| `_loc` | **v14 only**. Do not use it in packages that still support v13. |
| Handlebars | `{{localize "MYSYS.Title"}}`, `{{localize "MYSYS.Roll.Damage" type=damageType}}` (hash args become the data). |
| Helpers with `localize=true` | `{{selectOptions choices selected=x localize=true}}`, `{{radioBoxes ... localize=true}}`. |

Obsolete: `game.i18n.localize` is NOT deprecated, but hard-coded English strings in templates/JS are the real
anti-pattern. Use keys everywhere (UI text, notifications `ui.notifications.info("MYSYS.Saved", {localize: true})`,
dialog titles, chat flavor).

## 4. Timing: when translations exist

`Game#initialize` order is: `Hooks.callAll("init")` -> settings registered -> `await i18n.initialize()` ->
`i18nInit` hook -> ... -> `setup` -> `ready`.

- During **`init`, translations are NOT loaded.** `game.i18n.localize()` returns the key. `_loc` already exists but is
  empty. Do not pre-localize in `init`.
- Register settings, menus, `CONFIG` labels, sheet labels, keybindings with **keys, not localized strings**; core
  localizes them at render time (settings `name`/`hint` via `_loc`, choice labels via the settings template's
  `localize=true`, pack `label` when `game.packs` is built).
- Use `Hooks.once("i18nInit", ...)` (or `setup`/`ready`) for any code that must produce translated text eagerly:

```js
Hooks.once("init", () => {
  game.settings.register("my-system", "houseRules", {
    name: "MYSYS.Settings.HouseRules.Name",   // key, localized when rendered
    hint: "MYSYS.Settings.HouseRules.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
});

Hooks.once("i18nInit", () => {
  // Translations are available here. Build pre-localized lookup tables now.
  CONFIG.MYSYS.damageLabels = Object.fromEntries(
    Object.entries(CONFIG.MYSYS.damageTypes).map(([k, v]) => [k, game.i18n.localize(v.label)])
  );
});
```

Settings values can only be read from `setup` onward, not `init`.

## 5. Auto-localized data model fields (`LOCALIZATION_PREFIXES`)

Instead of writing `label:`/`hint:` on every field, declare prefixes on the model and put strings in the language
file under `<PREFIX>.FIELDS.<field path>.label|hint|placeholder`.

```js
class CharacterData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["MYSYS.Actor.base", "MYSYS.Actor.character"];  // later prefixes win
  static defineSchema() {
    const { NumberField, SchemaField, StringField } = foundry.data.fields;
    return {
      level: new NumberField({ required: true, integer: true, min: 1, initial: 1 }),
      attributes: new SchemaField({
        str: new SchemaField({ value: new NumberField({ required: true, integer: true, initial: 10 }) })
      }),
      biography: new StringField()
    };
  }
}
```

```json
{
  "MYSYS": { "Actor": { "character": { "FIELDS": {
    "level": { "label": "Level", "hint": "Character level from 1 to 20." },
    "attributes": { "label": "Attributes", "str": { "value": { "label": "Strength" } } },
    "biography": { "label": "Biography", "placeholder": "Who are they?" }
  } } } }
}
```

Rules (from `Localization.localizeSchema`):
- Applied once, after translations load (just before `i18nInit`), to every class in `CONFIG.<Document>.dataModels`.
  For those, the path is relative to `system` (write `level`, not `system.level`).
- An explicit `label` on the field wins (`this.label ||= ...`). Models are localized once; changing language needs a reload.
- Works for nested `SchemaField`, `EmbeddedDataField` (inner model's own prefixes take precedence),
  `TypedSchemaField`, `TypedObjectField`. Not applied to embedded collections.
- **Models that are not document sub-type models** (setting models, app config models) are not localized
  automatically. Call it yourself in `i18nInit`:
  `foundry.helpers.Localization.localizeDataModel(MyModel)` (the bare `Localization` global is a deprecated shim).
- `placeholder` support on `DataField` is new in v14. In v13 only `label` and `hint` exist.
- Then forms render labels for free: `{{formGroup fields.level value=system.level localize=true}}`.
  (v14 fixed double-localization when combining `{{formGroup}}` with prefixes; do not pre-localize the label.)

## 6. Document type labels, settings, compendia, other places

```json
{
  "TYPES": {
    "Actor": { "character": "Character", "npc": "NPC" },
    "Item": { "weapon": "Weapon", "spell": "Spell" },
    "JournalEntryPage": { "my-module.quest": "Quest" },
    "HINTS": { "Actor": { "character": "A player-controlled hero." } }
  }
}
```

- Label key is `TYPES.<DocumentName>.<type>`; optional hint is `TYPES.HINTS.<DocumentName>.<type>` (used by the
  create dialog). Core fills `CONFIG.<Doc>.typeLabels[type]` / `typeHints` for you in `Localization#initialize` if
  you have not set them. Override by assigning `CONFIG.Actor.typeLabels.character = "MYSYS.CustomKey"` in `init`.
- **Module-provided sub-types** use the prefixed type: type `quest` from module `my-module` is
  `my-module.quest`, label `TYPES.JournalEntryPage.my-module.quest`. The dotted form works in flat JSON
  (`"TYPES.JournalEntryPage.my-module.quest": "Quest"`) because of `expandObject`.
- `TYPES.Base` labels the `base` type.
- **Settings/menus/keybindings**: `name`, `hint`, `label`, `choices` values are keys (rendered with `_loc`).
- **Compendium pack `label`** in the manifest may be a key: `"label": "MYSYS.Packs.Monsters"`
  (`CompendiumCollection` does `metadata.label = _loc(metadata.label)` when `game.packs` is built, after i18n loads).
  `packFolders[].name` is turned into a folder document server-side; I found no client localization for it, so use
  a plain string there (not verified either way).
- **Manifest `title`/`description`** are NOT localized (Setup screen reads them raw).
- Sheet labels (`DocumentSheetConfig.registerSheet(..., { label: "MYSYS.SheetCharacter" })`, localized by core via
  `_loc`) can be keys. Your own config tables (`CONFIG.MYSYS.damageTypes.fire.label = "MYSYS.Damage.Fire"`) hold keys
  that you localize at display time with `game.i18n.localize(...)` / `{{localize}}`.

## 7. Translation modules, plurals, lists

- A translation module is a normal module with `languages` entries and `relationships.systems`/`requires` pointing at the
  target package, or `module`/`system` filters on each entry. For translating core, set `coreTranslation: true` and
  provide the full core key tree (copy `public/lang/en.json` structure).
- Plurals: no ICU support; use `Intl.PluralRules`:
  `game.i18n.localize(\`MYSYS.Items.${game.i18n.pluralRules.select(n)}\`, { n })` with `Items.one` / `Items.other`
  keys (add `few`, `many` as the language needs).
- `game.i18n.getListFormatter({ style: "long", type: "conjunction" }).format(["a","b","c"])` for "a, b, and c".
- `game.i18n.sortObjects(array, "name")` sorts with locale collation.
- Official-listing note (AI policy, March 2026): for packages submitted to foundryvtt.com, prepared UI text is
  expected to be human-written, and machine translation needs review by a speaker of the target language.
  See `manifest-and-packaging.md` "Publishing".

---------------------------------------------------------------------------------------------------

## 8. Styles: manifest `styles` and CSS layers

```json
"styles": [
  "styles/my-system.css",
  { "src": "styles/sheets.css", "layer": "system.sheets" },
  { "src": "styles/escape-hatch.css", "layer": null }
]
```

- v13+ schema is an array of `{ src, layer }`; plain strings are migrated to `{ src }`
  (`BasePackage._migrateStyles`). Old string arrays still work.
- The **server** emits `@import "<src>" layer(<layer>)` in a `<style>` block (`templates/views/layouts/main.hbs`).
  Default layer: system styles -> `system`, module styles -> `modules`, world styles -> none.
  `layer: null` means **unlayered**.
- Core declares the order up front in `foundry2.css`:
  `reset, variables, elements, blocks, applications, compatibility, layouts, system, modules, exceptions`.
- Cascade rules that matter: unlayered CSS beats all layered CSS; between layers the **later layer wins regardless of
  specificity**; specificity only matters inside one layer. Consequences:
  - Your default-layer system CSS already beats core `applications`/`blocks`/`elements` rules. You rarely need
    `!important` or selectors like `.application.sheet.actor.my-sheet.my-sheet`.
  - Module CSS (`modules`) beats system CSS (`system`) automatically. A module restyling a system sheet needs no hack.
  - Core's `exceptions` layer beats both. Use `layer: null` only as a deliberate escape hatch.
  - Sub-layers (`"layer": "system.sheets"`) are plain CSS sub-layers of `system`.
  - Do not paste `@import` of third-party URLs into your CSS (privacy/offline). Local `@import` inside your CSS is
    allowed and hot-reloads in v14.
- Hot reload: list `css` in `flags.hotReload.extensions` and the folder in `paths` (see manifest doc).

## 9. Scoping, themes and CSS variables

Package etiquette (KB "Introduction to Development" + source):
- Prefix every class/id with the package id (`.my-system`, `.my-system-roll-card`). Never style bare `button`,
  `input`, `h2`, `.window-content`, `.header`, `.app`, `#sidebar` globally.
- Put one root class on your applications (`classes: ["my-system", "character-sheet"]`) and nest under it. Native CSS
  nesting is supported (Foundry itself ships nested CSS), so Sass/Less is optional.
- Namespace custom properties: `--my-system-accent`. Do not redefine core `--color-*` variables globally.
- Do not assume dark mode. Take colors from core variables so light/dark and the UI theme settings work:
  `--color-text-primary`, `--color-text-secondary`, `--color-text-subtle`, `--color-text-emphatic`,
  `--color-border`, `--background`, `--color-form-label`, `--color-form-hint`, `--color-header-background`,
  `--color-warm-1..3`, `--color-cool-3..5`, `--color-light-1..6`, `--color-dark-1..6`, `--font-body`, `--font-primary`.
- Theme hooks in markup: the page `<body>` gets `theme-dark`/`theme-light`; ApplicationV2 windows get
  `themed theme-dark|theme-light` (document sheets get their per-sheet theme from `DocumentSheetConfig`). Variable
  blocks live under `.themed.theme-dark` and `body.theme-light` in `foundry2.css`. If you must hard-code colors, ship
  both `.themed.theme-light .my-system {...}` and `.themed.theme-dark .my-system {...}`.
- Lay out for long translations (see section 2) and avoid fixed pixel widths on labels.
- Avoid `!important`; if you need it, you probably have the wrong layer.
- Images/fonts inside CSS use paths **relative to the CSS file** or absolute `systems/<id>/...` / `modules/<id>/...`
  URLs. Case matters on Linux hosts; no spaces in file names.

Verify in source: `client/helpers/localization.mjs`, `common/packages/base-package.mjs` (`languages`, `styles`),
`dist/server/views/view.mjs` (`_getStaticContent`: layer defaults and script/style load order).
