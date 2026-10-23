# Manifests, Project Structure, Compendium Packs and Publishing (Foundry v14)

Verified against the local v14 build 369 source (`common/packages/*.mjs`, `dist/packages/*.mjs`,
`dist/server/views/view.mjs`, `client/game.mjs`) and by running the real `BaseSystem`/`BaseModule` schemas on
the example manifests below. Where v13 differs it is marked **[v13]**; anything new in v14 is marked **[v14]**.
Localization and CSS are in `localization-and-styles.md`.

## Contents
1. Obsolete patterns and their replacements
2. Where packages live; directory layout; dev loop
3. Complete `system.json` and `module.json` examples
4. Manifest field reference (common / system-only / module-only)
5. `documentTypes`, `htmlFields` and TypeDataModels
6. `relationships` and `compatibility`
7. How Foundry loads and validates a manifest (errors and warnings)
8. Hot reload
9. Compendium packs (LevelDB, CLI, `_key`, Adventures)
10. Publishing: versions, GitHub releases, Release API, submission, AI policy
11. Package best practices

---------------------------------------------------------------------------------------------------

## 1. Obsolete patterns and their replacements

Models trained on pre-v10 code emit these. All are wrong or deprecated in v14.

| Obsolete | Modern (v14) | Notes |
|---|---|---|
| `"name": "my-module"` | `"id": "my-module"` | v14 does **not** migrate `name`. Without `id` the package is not loaded at all. `name` is only tolerated (no warning) when `id` is also present. |
| `"author": "Me"` | `"authors": [{ "name": "Me" }]` | Flagged as an unknown key. |
| `minimumCoreVersion`, `compatibleCoreVersion`, `maximumCoreVersion` | `"compatibility": { "minimum", "verified", "maximum" }` | Not migrated. Silently tolerated only if `compatibility` is also present. |
| `"dependencies": [...]` | `"relationships": { "requires": [{ "id", "type" }] }` | `dependencies` is an unknown key and is ignored (dependency not enforced). |
| `"systems": [...]` / module `"system": ["dnd5e"]` (still shown in the KB module article) | `"relationships": { "systems": [{ "id": "dnd5e", "type": "system" }] }` | Old keys are unknown keys; the restriction is not applied. |
| `template.json` for Actor/Item types | `documentTypes` in the manifest + `TypeDataModel` classes in `CONFIG.<Doc>.dataModels` | **[v14]** `template.json` is deprecated; still read with a Setup warning; **removed in v16**. `game.model` and `strictDataCleaning` are tied to it. |
| `game.system.data`, `game.system.data.version` | `game.system.version`, `game.system.id`, `game.system.title` | `System` is a package model; its fields are top level. Modules: `game.modules.get(id).version`, `.active`. |
| `"styles": ["a.css"]` strings only | `"styles": [{ "src": "a.css", "layer": null }]` (strings still accepted) | **[v13+]** objects with CSS `layer`. Strings are auto-migrated to `{ src }`. |
| NeDB packs: `"path": "./packs/x.db"` | LevelDB directory: `"path": "packs/x"` | The `.db` suffix is stripped from `path`. A sibling `x.db` file found beside the LevelDB folder is migrated once automatically (deleted if server option `deleteNEDB`). Do not ship `.db` files. |
| Packs with `"entity": "Actor"` | `"type": "Actor"` | `entity` was removed long ago. |
| `"private": true` on packs | `"ownership": { "PLAYER": "NONE", "ASSISTANT": "OWNER" }` | |
| `"flags": {}` as custom bucket on top-level keys, e.g. `"myCustomKey": 1` | `"flags": { "my-module": { ... } }` | Unknown top-level keys produce a Setup warning. |
| `scripts: [...]` classic scripts | `esmodules: [...]` | `scripts` still works but shares global scope. |
| `game.i18n.format` required for variables | `game.i18n.localize(key, data)` (v14) | **[v13]**: only `format` took data. `format` still exists as alias in v14. |

---------------------------------------------------------------------------------------------------

## 2. Where packages live; directory layout; dev loop

**User data path** (contains `Config/`, `Data/`, `Logs/`):
- macOS: `~/Library/Application Support/FoundryVTT/`
- Windows: `%localappdata%\FoundryVTT\`
- Linux: `~/.local/share/FoundryVTT/`
- Configured in `Config/options.json` (`dataPath`). The data path must not be inside the app install folder.

```
<user data>/Data/
  systems/<id>/system.json      worlds/<id>/world.json      modules/<id>/module.json
```

**The `id` in the manifest MUST equal the folder name.** Mismatch logs `Invalid module "x" detected in directory "y"`
and the package is not loaded. Same-named system and module are separate namespaces (`systems/foo` vs `modules/foo`).
The manifest file name is fixed: `system.json`, `module.json`, `world.json`, at the package root.

### System layout (recommended)
```
systems/my-system/
  system.json                 # required, root level
  LICENSE  README.md
  my-system.mjs               # esmodules entry (or dist/my-system.mjs if bundled)
  module/                     # JS source: data-models/, documents/, applications/
  templates/                  # *.hbs
  styles/my-system.css
  lang/en.json
  assets/                     # icons, art (lower-case kebab names, no spaces)
  packs/
    monsters/                 # GENERATED LevelDB pack (CURRENT, LOCK, LOG, MANIFEST-*, *.ldb)
    _source/monsters/*.yml    # git-tracked source (JSON or YAML), see section 9
  tools/packs.mjs  package.json  .github/workflows/release.yml
```

### Module layout
```
modules/my-module/
  module.json
  dist/main.mjs  (or scripts/main.mjs)   styles/  templates/  lang/en.json  assets/  packs/
```
The Setup screen also has a built-in **Module Maker** (Add-on Modules -> Create Module, since v11) that writes a
skeleton `module.json` and lets you add packs/authors/requirements without hand editing.

### Facts about the package folder
- The server's package scan (`LocalStorage#isDirectory`) follows **symlinks/junctions to directories**, so you can keep
  the repo elsewhere (see dev loop). A symlink to a single file does not work.
- **Installing or updating a package deletes the whole `Data/<type>s/<id>` folder and re-extracts the zip**
  (`PackageInstaller`), except `storage/` when `"persistentStorage": true`. Never keep user data or your working repo
  in a folder that Foundry may update. Never press "Update" on your own dev package.
- A file named `<id>.lock` inside the package folder (created by the Setup lock toggle) blocks UI updates/uninstall.
- Path rules: every file referenced by the manifest must exist, paths are case-sensitive on Linux hosts, use `/`,
  no spaces. Reference files relative to the package root (`styles/a.css`, `./a.css` also works) or by absolute URL.
  In runtime code and templates use `systems/<id>/...` / `modules/<id>/...` without a leading slash
  (`foundry.utils.getRoute()` adds a route prefix for servers behind a proxy).

### Dev loop
1. Create the repo anywhere, then link it into Data (folder name must equal `id`):
   - macOS/Linux: `ln -s "$PWD" "$HOME/Library/Application Support/FoundryVTT/Data/systems/my-system"`
   - Windows (no admin needed): `mklink /J "%localappdata%\FoundryVTT\Data\systems\my-system" C:\dev\my-system`
2. Enable hot reload: set `"hotReload": true` in `Config/options.json` (works for the desktop app; restart it), or
   start a Node/CLI server with `--hotReload`.
3. Create a world using the system (or enable the module) and launch it.
4. Edit loop: CSS, `.hbs` and `lang/*.json` hot-reload (section 8). **JavaScript needs a browser refresh (F5).**
   Manifest edits, new files listed in the manifest, new `packs`, new `documentTypes` are read once at server start:
   **restart the server** (the package cache is only reset on install/uninstall).
5. Compendium work: unlock the pack (context menu "Toggle Edit Lock"), edit in the UI, return to Setup, then run
   `unpack` (section 9) and commit the source.
6. Debug aids: `CONFIG.debug.hooks = true`, `CONFIG.debug.i18n = true`, Setup screen package warning badges, server
   console output.

---------------------------------------------------------------------------------------------------

## 3. Complete examples (both validated against the v14 `BaseSystem` / `BaseModule` schema)

### system.json
```json
{
  "id": "my-system",
  "title": "My System",
  "description": "<p>A small example game system.</p>",
  "version": "1.0.0",
  "compatibility": { "minimum": "14", "verified": "14.369" },
  "authors": [{ "name": "Your Name", "url": "https://example.com", "discord": "yourhandle" }],
  "url": "https://github.com/you/my-system",
  "manifest": "https://github.com/you/my-system/releases/latest/download/system.json",
  "download": "https://github.com/you/my-system/releases/download/v1.0.0/system.zip",
  "bugs": "https://github.com/you/my-system/issues",
  "changelog": "https://github.com/you/my-system/releases",
  "readme": "https://github.com/you/my-system#readme",
  "license": "LICENSE",
  "esmodules": ["dist/my-system.mjs"],
  "styles": ["styles/my-system.css"],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "documentTypes": {
    "Actor": {
      "character": { "htmlFields": ["biography"] },
      "npc": { "htmlFields": ["biography"] }
    },
    "Item": {
      "weapon": { "htmlFields": ["description"] },
      "spell": { "htmlFields": ["description"], "filePathFields": { "icon": ["IMAGE"] } }
    }
  },
  "packs": [
    { "name": "monsters", "label": "MYSYS.Packs.Monsters", "type": "Actor", "path": "packs/monsters" },
    { "name": "items", "label": "Items", "type": "Item", "path": "packs/items" },
    { "name": "rules", "label": "Rules Reference", "type": "JournalEntry", "path": "packs/rules",
      "ownership": { "PLAYER": "OBSERVER", "ASSISTANT": "OWNER" } }
  ],
  "packFolders": [
    { "name": "My System", "sorting": "a", "color": "#3b5998", "packs": ["monsters", "items", "rules"] }
  ],
  "relationships": {
    "requires": [],
    "recommends": [{ "id": "dice-so-nice", "type": "module", "reason": "3D dice animation." }]
  },
  "socket": true,
  "initiative": "1d20",
  "grid": { "type": 1, "distance": 5, "units": "ft", "diagonals": 0 },
  "primaryTokenAttribute": "resources.hp",
  "secondaryTokenAttribute": "resources.mana",
  "background": "systems/my-system/assets/background.webp",
  "media": [
    { "type": "setup", "url": "systems/my-system/assets/cover.webp", "thumbnail": "systems/my-system/assets/cover-thumb.webp" }
  ],
  "flags": {
    "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"] }
  }
}
```
Pack `system` is filled in automatically (= this system's `id`) for system packs, so it can be omitted.

### module.json
```json
{
  "id": "my-module",
  "title": "My Module",
  "description": "<p>Adds quest pages and a compendium of adventures.</p>",
  "version": "1.0.0",
  "compatibility": { "minimum": "13", "verified": "14" },
  "authors": [{ "name": "Your Name", "discord": "yourhandle" }],
  "url": "https://github.com/you/my-module",
  "manifest": "https://github.com/you/my-module/releases/latest/download/module.json",
  "download": "https://github.com/you/my-module/releases/download/v1.0.0/module.zip",
  "bugs": "https://github.com/you/my-module/issues",
  "changelog": "https://github.com/you/my-module/releases",
  "readme": "README.md",
  "license": "LICENSE",
  "esmodules": ["dist/main.mjs"],
  "styles": ["styles/main.css", { "src": "styles/overrides.css", "layer": null }],
  "languages": [{ "lang": "en", "name": "English", "path": "lang/en.json" }],
  "relationships": {
    "systems": [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5.0.0", "verified": "5.3" } }],
    "requires": [
      { "id": "lib-wrapper", "type": "module",
        "manifest": "https://github.com/ruipin/fvtt-lib-wrapper/releases/latest/download/module.json",
        "reason": "Safe method patching." }
    ],
    "recommends": [{ "id": "dice-so-nice", "type": "module" }],
    "conflicts": [{ "id": "some-clashing-module", "type": "module", "reason": "Patches the same method." }]
  },
  "documentTypes": {
    "JournalEntryPage": { "quest": { "htmlFields": ["description.long"], "filePathFields": { "img": ["IMAGE"] } } }
  },
  "packs": [
    { "name": "adventures", "label": "Adventures", "type": "Adventure", "system": "dnd5e", "path": "packs/adventures" },
    { "name": "journals", "label": "Handouts", "type": "JournalEntry", "path": "packs/journals" }
  ],
  "packFolders": [{ "name": "My Module", "sorting": "a", "packs": ["adventures", "journals"] }],
  "socket": true,
  "flags": {
    "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"] },
    "my-module": { "anything": "custom data lives under flags" }
  }
}
```
Hard minimum for either package type: `id` and `title` (everything else defaults). Practical minimum: `id`, `title`,
`description`, `version`, `compatibility` (omitting `compatibility` yields an "unknown compatibility" red badge). A
system additionally needs `documentTypes` plus registered DataModels if it defines Actor/Item types.

---------------------------------------------------------------------------------------------------

## 4. Manifest field reference

Scope: **B** = system and module (and world), **S** = system only, **M** = module only.
Source of truth: `common/packages/base-package.mjs` (B), `base-system.mjs` (S), `base-module.mjs` (M).

| Field | Scope | Type / default | Rules and notes |
|---|---|---|---|
| `id` | B | string, **required** | `/^[A-Za-z0-9-_]+$/`; not a Windows reserved name (`con`, `prn`, `aux`, `nul`, `com1-9`, `lpt1-9`). Use lower-case kebab-case. Must equal folder name. |
| `type` | B | `"system"` / `"module"` | **[v14]** explicit field, optional (defaults). Guards against installing a module as a system. On **[v13]** it is an unknown key (warning only), so omit it for v13-compatible packages. |
| `title` | B | string, **required** | Missing/blank -> construction error, package not loaded. Plain text (not localized by core). |
| `description` | B | HTML string, default `""` | Omitting it validates (defaults to `""`) but always provide one. HTML is sanitized. Shown in Setup and Module Management. |
| `version` | B | string, default `"0"` | Illegal chars `' " < > &` (invalid value silently falls back to `"0"`). Numbers are cast to strings. No leading `v`. Compared with `isNewerVersion`. |
| `compatibility` | B | `{minimum, verified, maximum}` all optional strings | See section 6. Integers (`14`) mean "generation"; `"14.369"` is build-specific. |
| `authors` | B | `[{name (req), email, url, discord, flags}]` | NOT `author`. Other keys (e.g. `website`) are silently dropped. |
| `url` `license` `readme` `bugs` `changelog` | B | string | URL or (`license`, `readme`) a relative file path. |
| `manifest` | B | string | **Stable** "latest" manifest URL; the update source. |
| `download` | B | string | URL of the zip for **this** version. |
| `scripts` | B | `string[]` | Classic scripts. URL or package-relative path. |
| `esmodules` | B | `string[]` | ES modules (preferred). Entry file(s) loaded as `<script type="module">`. |
| `styles` | B | `[{src, layer}]` | `layer`: omitted -> `system` (systems) / `modules` (modules); `null` -> unlayered; string -> named layer. Strings accepted. |
| `languages` | B | `[{lang, name, path, system, module, flags}]` | See `localization-and-styles.md`. |
| `packs` | B | `[{name, label, type, path, system, banner, ownership, flags}]` | See section 9. |
| `packFolders` | B | `[{name, sorting, color, packs[], folders[]}]` | Sidebar folders; nesting up to 3 deep; same-named folders from different packages merge. |
| `relationships` | B | `{systems, requires, recommends, conflicts, flags}` | See section 6. |
| `documentTypes` | S, M | `{ DocumentName: { type: config } }` | See section 5. |
| `socket` | B | boolean | `true` -> server relays events named `system.<id>` / `module.<id>` to all other clients. |
| `media` | B | `[{type, url, caption, loop, thumbnail, flags}]` | `type: "setup"` = Setup-screen art. |
| `flags` | B | object | Free-form. Core reads `hotReload`, `canUpload`, `compendiumArtMappings`, `tokenRingSubjectMappings` (below). |
| `protected` `exclusive` | B | boolean | Set by Foundry's premium/exclusive content system. Do not set by hand. |
| `persistentStorage` | B | boolean | Keep `<package>/storage/` across updates. Installer creates it. |
| `background` | S | string path/URL | Default world background image for worlds using this system. |
| `initiative` | S | string formula | Default initiative formula; used as `CONFIG.Combat.initiative.formula || game.system.initiative`. |
| `grid` | S | `{type, distance, units, diagonals}` | Defaults for new Scenes. `type`: 0 gridless, 1 square (default), 2-5 hex (`CONST.GRID_TYPES`). `distance` > 0 (default 1). `units` string. `diagonals`: 0 equidistant (default), 1 exact, 2 approximate, 3 rectilinear, 4/5 alternating, 6 illegal (`CONST.GRID_DIAGONALS`). |
| `primaryTokenAttribute` `secondaryTokenAttribute` | S | string path | e.g. `"resources.hp"` (an object with `value` and `max`). Default bars of prototype tokens. Omit for none. |
| `library` | M | boolean | Marks a dependency-only module. Its scripts/esmodules load **before** system and normal module code. Hidden from some lists. |
| `coreTranslation` | M | boolean | Module translates core Foundry itself. |
| `quickstart` | M | object | **[v14]** Quick-Start adventure: `{ adventures: { "<systemId>": { uuid } }, postImport, world: { background, cover, description } }`. Shown on the World Creation screen. |

Flags read by core (`flags.*`):
- `hotReload: { extensions: string[], paths: string[] }` (section 8). May be `false`.
- `canUpload: true`: lets the FilePicker upload into this package's folder (normally blocked).
- `compendiumArtMappings: { "<systemId>": { mapping: "modules/x/art.json", credit: "..." } }`.
- `tokenRingSubjectMappings: { "<subject path>": "<image>" }` (dynamic token ring subject images).

Nested `flags` objects exist on `authors`, `media`, `languages`, `packs`, `relationships` **[v14]**: put deliberate
extra data there instead of inventing new top-level keys that would raise "unknown key" warnings.

Script/style load order (from `View._getStaticContent`): core -> **library modules** (scripts, then esmodules) ->
system scripts -> system esmodules -> module scripts -> module esmodules -> world scripts -> world esmodules. Within
each group, array order. Modules affect only the game view, not Setup/Join screens.

---------------------------------------------------------------------------------------------------

## 5. `documentTypes`, `htmlFields` and TypeDataModels

`documentTypes` tells the **server** which sub-types your package adds so documents of those types are not discarded
as invalid, and which fields need server-side sanitization. The matching **client** behavior comes from DataModel
classes you register in `init`. You need both.

```json
"documentTypes": {
  "Actor": {
    "character": { "htmlFields": ["biography", "notes.public"], "filePathFields": { "portrait": ["IMAGE"] }, "gmOnlyFields": ["notes.gm"] }
  }
}
```
```js
Hooks.once("init", () => {
  CONFIG.Actor.dataModels.character = CharacterData;                 // system: key is the bare type
  CONFIG.JournalEntryPage.dataModels["my-module.quest"] = QuestData; // module: key is "<moduleId>.<type>"
});
```

- Allowed document names are those with `hasTypeData`: `Actor`, `Item`, `JournalEntryPage`, `Cards`, `Card`,
  `ActiveEffect`, `ChatMessage`, `Combat`, `Combatant`, `CombatantGroup`, `RegionBehavior`. Anything else (e.g. `Scene`)
  makes the **entire `documentTypes` field invalid and dropped** (verified).
- Type names must not be core types (`base`; Cards `deck`/`hand`/`pile`; pages `text`/`image`/`pdf`/`video`;
  RegionBehavior core behaviors) and must not contain `.`.
- **Systems** store the bare type (`"character"`). **Modules** store it prefixed: `"my-module.quest"`. Localization
  key is `TYPES.<Doc>.<storedType>` (see `localization-and-styles.md`).
- Per-type config (all optional, paths are relative to `system`):
  - `htmlFields: string[]` - every `HTMLField` that can hold user HTML. The server **only** sanitizes the paths listed
    here for package-defined types. Forgetting one stores raw, unsanitized HTML (XSS risk), even if the DataModel
    uses `HTMLField`.
  - `filePathFields: { path: ["IMAGE", ...] }` - categories from `CONST.FILE_CATEGORIES`. The server extracts embedded
    base64 data into real files.
  - `gmOnlyFields: string[]` - only a GM can update these.
- A type listed without a registered DataModel is valid but `system` becomes an unvalidated open object. Do not
  rely on that.
- **[v14]** `template.json` types are merged into `documentTypes` internally with a deprecation warning. Delete
  `template.json`; port `types`, `templates` and defaults into `TypeDataModel.defineSchema()`.
- Deactivating a module that provides sub-types makes those documents invalid/hidden until re-enabled. Prefer flags or a
  sheet override if a sub-type is not essential. For module-provided Actor/Item types restrict the module with
  `relationships.systems` to a single system.
- Server caches `documentTypes`; **[v14.369]** fixed a stale-cache bug after updates, but still restart after edits.
- `game.system.documentTypes`, `game.documentTypes`, `Actor.TYPES` list what is registered.

---------------------------------------------------------------------------------------------------

## 6. `relationships` and `compatibility`

```json
"relationships": {
  "systems":    [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5.0.0", "verified": "5" } }],
  "requires":   [{ "id": "lib-wrapper", "type": "module", "manifest": "https://.../module.json", "reason": "why" }],
  "recommends": [{ "id": "tagger" }],
  "conflicts":  [{ "id": "other-module", "reason": "same hook" }],
  "flags": {}
}
```
Entry fields (`RelatedPackage`): `id` (req), `type` (`module` default; `system` or `world` allowed; `systems` entries
are always `system`), `manifest` (explicit install URL; otherwise resolved from the foundryvtt.com index),
`compatibility` {minimum, verified, maximum} (compared against the **dependency's version**, not core), `reason`.
A single non-array value is accepted and wrapped into an array.

| Key | Effect in v14 |
|---|---|
| `systems` | Module can only be enabled when one listed system is installed and compatible. If exactly one is listed, pack `system` defaults to it. **[v14]** `verified` may be generation-wide (`"5"`). |
| `requires` | Cannot enable without it; the dependency dialog offers to enable/install. List **every** direct dependency yourself. |
| `recommends` | Suggested in dependency dialogs only. |
| `conflicts` | Parsed and stored; I found no client-side enforcement in v14 source. Treat as advisory metadata. |

`compatibility` (core versions; `common/utils` `isNewerVersion`):
- `minimum`: hard floor. If core is older, the package is unavailable and cannot be installed/enabled.
- `maximum`: hard ceiling. If core is newer, unavailable. Leave empty unless you know it breaks. Systems may set it to
  the current generation to stop users migrating worlds before the system is verified.
- `verified`: advisory. Green badge if core <= verified; neutral if same generation but newer build; yellow warning if
  a newer generation. Never blocks use.
- Write strings (`"14"`, `"14.369"`); integers also work (cast). An integer value compares by generation only.
- Available core generation tests in code: `game.release.generation`, `game.version`,
  `foundry.utils.isNewerVersion(a, b)`.
- Multi-version support: one codebase with `"minimum": "13", "verified": "14"`, or separate release lines
  (13.x and 14.x versions each with its own `compatibility`), see section 10 on how update checks pick the version.

---------------------------------------------------------------------------------------------------

## 7. How Foundry loads and validates a manifest

Verified by running the real schema (`strict: true, fallback: true, installed: true`, same as the server):

| Situation | Result |
|---|---|
| Invalid JSON (e.g. trailing comma) | `Error loading module ...`; package absent. Run `jq . module.json` before committing. |
| Missing `id`, or `id` != folder name | Package not loaded. |
| Missing `title` | Construction error (`Metadata validation failed`); package not loaded. |
| Missing `version` / `description` | Default `"0"` / `""` (no error). |
| Unknown top-level key | Setup warning `manifest contained the following unknown keys`; still loads. Legacy keys (`name`, `author`, `minimumCoreVersion`...) are only silent if the replacement is present. |
| Unknown key inside `authors[]` etc. | Silently dropped. |
| Invalid field value (bad `version`, bad `lang`, bad pack `type`) | Dropped/defaulted + warning. |
| `documentTypes` with a non-typed Document or reserved type | Whole `documentTypes` dropped + warning. |
| Actor/Item/ActiveEffect pack without `system` (and no single `relationships.systems`) | That pack entry is dropped with a warning; others stay. |
| Duplicate pack `name` or `path` | Validation error: `Duplicate Compendium name/path`. |
| Referenced file missing (`esmodules`, `scripts`, `styles[].src`, `languages[].path`) | Warning `The file "..." included by ... does not exist`; the entry is dropped. (`packs[].path` is not required to exist.) |
| `pack.name` with spaces/dots | Rejected (same regex as `id`). |
| `compatibility` absent | `availability = UNKNOWN`: red "unknown" badge, still usable. |
| `compatibility.minimum` > core, or `maximum` < core | Unavailable; cannot be enabled (hard). |
| Protected package without valid `signature.json` | Refused. |

Warnings appear on the package in Setup and in the server console. After fixing, restart the server.

---------------------------------------------------------------------------------------------------

## 8. Hot reload

Needs **both**: server started with `--hotReload` (or `"hotReload": true` in `Config/options.json`), and
`flags.hotReload` on the package (the active system, or an **enabled** module).

```json
"flags": { "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"] } }
```
- `extensions` (required; if empty the server logs `Hot Reload disabled for "<id>" because it has no extensions defined`).
  Leading dot optional. `paths` (optional): files or folders relative to the package root; if omitted the whole package
  folder is watched. Paths escaping the package folder are skipped. Watcher is chokidar.
- On change the server pushes `{ packageType, packageId, content, path, extension }` over the socket; the client
  fires the **`hotReload` hook** (return `false` to take over) and then handles:
  - `css`: re-requests the matching `<link>` or `@import` (**[v14]** also `@import`ed CSS not listed in the manifest).
  - `html`/`hbs`: recompiles the template, re-registers it as a partial if it was loaded as one, re-renders all open
    ApplicationV1/V2 windows (`renderContext: "hotReload"`, `renderData` in render options).
  - `json`: only if the path is one of the package's registered `languages[].path` for the current language; merged into
    `game.i18n.translations` and apps re-render.
- **JavaScript is not hot reloaded in v14.** The KB article lists `.js/.mjs`, but `Game#handleHotReload` has no JS
  case. The server may emit the event, nothing consumes it. Refresh the page. **[v14]** notes mention "reductions in scope".
- `flags.hotReload: false` is valid and means off.

---------------------------------------------------------------------------------------------------

## 9. Compendium packs

### Format and manifest entry
- Since v11 a pack is a **LevelDB directory** (not a `.db` file), default `path` = `packs/<name>`. Contents
  (`CURRENT`, `LOCK`, `LOG`, `MANIFEST-*`, `*.ldb`/`*.log`) are binary: never hand-edit, never commit as the source of truth.
- Pack id = `<packageId>.<name>` (e.g. `my-system.monsters`). Document UUID = `Compendium.my-system.monsters.Item.<id>`.

| Pack field | Rules |
|---|---|
| `name` | required, id-safe (`A-Za-z0-9-_`), unique within the package |
| `label` | required; **may be a localization key** (localized when `game.packs` is built) |
| `type` | required; one of `ActiveEffect` **[v14]**, `Actor`, `Adventure`, `Cards`, `Item`, `JournalEntry`, `Macro`, `Playlist`, `RollTable`, `Scene` |
| `path` | optional; defaults to `packs/<name>`. Unique. Subfolders allowed (`packs/items/dnd5e`) |
| `system` | **required for `Actor`, `Item`, `ActiveEffect`** (auto-set for systems and for modules with exactly one `relationships.systems`). Also set it for `Adventure` packs that contain Actors/Items (the builder warns otherwise). Use one pack entry per system if content differs |
| `ownership` | `{ ROLE: LEVEL }`. Roles `NONE PLAYER TRUSTED ASSISTANT GAMEMASTER`; levels `INHERIT NONE LIMITED OBSERVER OWNER`. Default `{ PLAYER: "OBSERVER", ASSISTANT: "OWNER" }`. A bare string `"OBSERVER"` becomes `{ PLAYER: "OBSERVER" }` |
| `banner` | optional image path, 290x70 |
| `flags` | free-form |

Packs from systems/modules are **locked by default** in the UI; right-click -> Toggle Edit Lock to edit. Users' edits
to package packs are lost on update. `packFolders` entries reference packs by `name`; `sorting: "a"|"m"` (alphabetical/manual).

### Source in git: `@foundryvtt/foundryvtt-cli` (v3.0.5, Node > 17)
Keep human-readable source (JSON or YAML, one file per document) in git and compile it to LevelDB.

```bash
npm i -g @foundryvtt/foundryvtt-cli          # or devDependency + npx fvtt
fvtt configure set dataPath "$HOME/Library/Application Support/FoundryVTT"   # the folder that CONTAINS Data/
fvtt package workon my-system --type System  # optional "current package"; then -n is enough
fvtt package unpack monsters  --yaml --folders --omitVolatile      # packs/monsters (LevelDB) -> packs/monsters/_source
fvtt package pack   monsters  --yaml --recursive                   # reverse
```
Defaults put the source inside the pack folder (`packs/monsters/_source`). Prefer explicit directories:
```bash
fvtt package unpack monsters --in packs --out packs/_source/monsters --yaml --folders --omitVolatile --clean
fvtt package pack   monsters --in packs/_source/monsters --out packs --yaml --recursive
#  pack:   --in = source dir, --out = parent dir of the LevelDB folder ("monsters" is appended)
#  unpack: --in = parent dir of the pack,         --out = source dir
```
Flags: `--yaml`, `--folders` (mirror pack Folder tree as directories, `_Folder.yml`), `--expandAdventures`
(Adventure contents to separate files, combine with `--folders`; then pack with `--recursive`), `--omitVolatile` (skip
rewriting a file when only `_stats.modifiedTime/createdTime/lastModifiedBy/systemVersion/coreVersion` changed),
`--clean` (delete destination before unpack), `--nedb` (legacy), `--verbose`.

**JS API (preferred for a repo build script)**, `tools/packs.mjs`:
```js
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
import { mkdir } from "node:fs/promises";

const PACKS = ["monsters", "items", "rules"];            // = packs[].name = folder names
const action = process.argv[2];                          // "build" | "extract"

for (const name of PACKS) {
  const sourceDir = `packs/_source/${name}`;   // git-tracked YAML/JSON
  const packDir = `packs/${name}`;             // generated LevelDB folder
  if (action === "build") {                    // compilePack(sourceDir, packDir, options)
    await mkdir(packDir, { recursive: true });
    await compilePack(sourceDir, packDir, { yaml: true, recursive: true, log: true });
  } else if (action === "extract") {           // extractPack(packDir, sourceDir, options)
    await extractPack(packDir, sourceDir, { yaml: true, folders: true, omitVolatile: true, log: true });
  }
}
```
```json
{ "scripts": { "packs:build": "node tools/packs.mjs build", "packs:extract": "node tools/packs.mjs extract" },
  "devDependencies": { "@foundryvtt/foundryvtt-cli": "^3.0.5" } }
```
Other API options: `transformEntry(entry, ctx)` (return `false` to skip), `transformName`, `transformFolderName`,
`transformSerialized`, `jsonOptions`, `yamlOptions`.

### Source file requirements
```json
{
  "_id": "aB3dE5gH7jK9mN1p",
  "_key": "!items!aB3dE5gH7jK9mN1p",
  "name": "Longsword",
  "type": "weapon",
  "img": "systems/my-system/assets/icons/longsword.svg",
  "system": { "description": "<p>A classic blade.</p>", "damage": 8 },
  "effects": [],
  "folder": null,
  "flags": {}
}
```
- `_id`: exactly 16 chars `[A-Za-z0-9]`. **Keep IDs stable** forever: UUID links and Adventure re-imports depend on them.
  Generate once (`foundry.utils.randomID()` in-app, or `crypto.randomBytes` in Node), never regenerate on build.
- `_key` = `!<collection>!<_id>`. Collections: `actors items journal macros playlists tables scenes cards adventures effects`
  (`ActiveEffect` -> `effects`, `JournalEntry` -> `journal`, `RollTable` -> `tables`). Folders: `!folders!<id>`.
  Embedded docs are written inline as arrays (`items`, `effects`, `pages`, `results`...); the CLI flattens them into
  sublevels such as `!actors.items!<actorId>.<itemId>`.
- **A file without `_key` is silently skipped** by `compilePack`. Duplicate keys throw.
- Compile is a full sync: entries in the existing LevelDB that are not in the source are **deleted**.
- Extracted `system` data is whatever the world had. Run your own migration or schema validation in CI if needed.

### Locks, ordering and when the world must be closed
- Foundry holds LevelDB `LOCK` files for the packs it has opened (those of a running world). `fvtt package pack/unpack`
  pre-checks the `LOCK` file and aborts with "currently in use by Foundry VTT", but that pre-check only detects the lock
  on Windows (`EBUSY`); on macOS/Linux you instead get a `classic-level` lock error, or a corrupted run if you force it.
  **Return to Setup (shut down the world), and if in doubt quit Foundry**, run the CLI, then relaunch. Same for the
  `compilePack`/`extractPack` API.
- Reload order: edit source -> `packs:build` (Foundry closed) -> start Foundry. Reverse: edit in UI -> shut down world ->
  `packs:extract` -> commit.
- Git: commit `packs/_source/**`; ignore compiled packs in git (`packs/*` + `!packs/_source`) and build them in CI before
  zipping the release. A fresh `git clone` into `Data/` needs `npm run packs:build` once.
- Never open the same pack folder from two processes. Build into a temp dir and move if you automate while Foundry runs.

### Adventure documents
- `type: "Adventure"` pack; each Adventure document embeds arrays of `actors combats items journal scenes tables macros
  cards playlists folders` (plus `name`, `img`, `caption`, `description`). Asset files are NOT embedded: they must ship
  in the package. Create/rebuild in-app: Compendium sidebar -> Create Adventure (drag documents from the world),
  "Rebuild Adventure" later. Importing into a world uses the Adventure importer (overwrite prompt if content exists).
- Asset paths inside the content must point into the package (`modules/my-module/assets/...`), so build the adventure
  from a clean world whose assets were staged in the module folder first.
- Source control: use `--expandAdventures --folders` so each document is its own file; repack with `--recursive`.
- **[v14]** `module.json` `quickstart` makes a module's adventure selectable when creating a new world:
  `"quickstart": { "adventures": { "dnd5e": { "uuid": "Compendium.my-module.adventures.Adventure.<id>" } } }`.

---------------------------------------------------------------------------------------------------

## 10. Publishing

### Versioning rules (`foundry.utils.isNewerVersion`)
- `version` is a dotted string; more parts or higher numbers win; letters compare alphabetically. Plain `1.2.3` is safest.
  Do not use semver pre-release/build suffixes (`-beta.1`, `+sha`); do not prefix `v` in the manifest (tags may have `v`).
- Every published change, even manifest-only, needs a new version. Never reuse a version number.
- The version **inside the zip's manifest must equal the released version**, or the installed copy keeps offering the update.

### The two URLs
- `manifest`: **stable** pointer to the *latest* manifest. GitHub: `https://github.com/<o>/<r>/releases/latest/download/module.json`
  (raw JSON, never the HTML `/blob/` page, never a local path).
- `download`: zip for **this exact version**: `https://github.com/<o>/<r>/releases/download/<tag>/module.zip`.
  Never point it at a "latest" or branch archive.
- Zip layout: `module.json` (or `system.json`) at the zip root, then the files. The installer also tolerates a single
  top-level folder. Exclude `.git`, `node_modules`, tests, `packs/_source` (optional). Include **built** packs and
  built JS/CSS.
- Release assets: upload both the stamped `module.json` and `module.zip` to the GitHub release.
  The asset `module.json` under `/releases/download/<tag>/` is the *versioned manifest* for that release.

### GitHub Actions: stamp, zip, upload, notify Foundry
`.github/workflows/release.yml` (create a GitHub Release with tag `v1.2.3` to trigger; replace `module`/`system`):
```yaml
name: Release
on:
  release:
    types: [published]
permissions:
  contents: write
jobs:
  release:
    runs-on: ubuntu-latest
    env:
      TAG: ${{ github.event.release.tag_name }}
      REPO: ${{ github.repository }}
      PKG_ID: my-module
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci && npm run build && npm run packs:build    # adjust to your own scripts
      - name: Stamp manifest with version and URLs
        run: |
          VERSION="${TAG#v}"
          jq --arg v "$VERSION" \
             --arg manifest "https://github.com/$REPO/releases/latest/download/module.json" \
             --arg download "https://github.com/$REPO/releases/download/$TAG/module.zip" \
             '.version=$v | .manifest=$manifest | .download=$download' module.json > module.tmp
          mv module.tmp module.json
      - name: Zip
        run: zip -r module.zip module.json LICENSE README.md dist styles lang templates assets packs -x "packs/_source/*"
      - name: Upload release assets
        env: { GH_TOKEN: "${{ github.token }}" }
        run: gh release upload "$TAG" module.json module.zip --clobber
      - name: Tell foundryvtt.com about the release
        env: { FOUNDRY_RELEASE_TOKEN: "${{ secrets.FOUNDRY_RELEASE_TOKEN }}" }
        run: |
          VERSION="${TAG#v}"
          jq -n --arg id "$PKG_ID" --arg v "$VERSION" \
            --arg manifest "https://github.com/$REPO/releases/download/$TAG/module.json" \
            --arg notes "https://github.com/$REPO/releases/tag/$TAG" \
            '{id:$id, release:{version:$v, manifest:$manifest, notes:$notes,
              compatibility:{minimum:"13", verified:"14"}}}' > body.json
          curl -sS --fail-with-body -X POST "https://foundryvtt.com/_api/packages/release_version/" \
            -H "Content-Type: application/json" -H "Authorization: $FOUNDRY_RELEASE_TOKEN" --data @body.json
```
Notes: `latest/download` only resolves to non-draft, non-prerelease releases, and only after assets exist (brief window
after publishing). `FOUNDRY_RELEASE_TOKEN` is stored as a repo secret.

### Package Release API
`POST https://foundryvtt.com/_api/packages/release_version/`, JSON body, header `Authorization: fvttp_...` (the raw
token, no `Bearer`). Token: the "Package Release Token" field on your package's page on foundryvtt.com (has a
Refresh button; treat as a secret).
```js
const res = await fetch("https://foundryvtt.com/_api/packages/release_version/", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: process.env.FOUNDRY_RELEASE_TOKEN },
  body: JSON.stringify({
    id: "my-module",
    "dry-run": true,                               // validate only; remove to save
    release: {
      version: "1.2.3",
      manifest: "https://github.com/you/my-module/releases/download/v1.2.3/module.json", // VERSIONED, not "latest"
      notes: "https://github.com/you/my-module/releases/tag/v1.2.3",                    // optional
      compatibility: { minimum: "13", verified: "14", maximum: "" }                      // min+verified required
    }
  })
});
console.log(res.status, await res.json());
```
Responses: `200 {"status":"success","page":"https://foundryvtt.com/packages/<id>/edit/"}` (dry run adds a `message`);
`400 {"status":"error","errors":{field:[{message,code}]}}` (e.g. duplicate version -> `__all__`/`unique_together`);
`429` with `Retry-After` when you submit too many releases for one package within 60 s. `maximum` is optional; avoid setting it unless you
know of a break.

### How installs and updates choose versions
- Install from the package browser: Foundry fetches the manifest of the latest listed version compatible with the user's
  core, then its `download`. Install from a pasted manifest URL: fetch manifest -> `download`.
- **[v14.366]** Update checks use the foundryvtt.com package index (it knows each release's core range) rather than only
  the installed `manifest` URL, so a v14 user gets the newest *v14-compatible* release even if a v15-only release exists.
  Keep each release's `compatibility` accurate on the site.
- If neither a new version exists nor changes in `compatibility`, Foundry may **sidegrade**: update metadata
  (title, authors, url, license, readme, bugs, changelog, manifest, download, compatibility) without reinstalling.
- KB: deleting the newest version on the site stops new installs from the browser but not updates via the manifest URL
  (behavior may differ since the 14.366 index-based update checks).

### Submission to the official listing
Submit once at foundryvtt.com -> Systems and Modules -> submit a package (requires a Foundry account; behind login, not
verifiable here). You provide the package id (must equal the manifest `id`), title, type, manifest URL, description,
categories and links. After staff approval, add versions on the package admin page or through the Release API.
Review includes the content/license rules and the AI policy below.

### AI content policy for the official listing (revised March 2026, foundryvtt.com/article/ai-policy)
Applies only to packages submitted to foundryvtt.com/packages or the marketplace; self-hosted/self-published
packages are unrestricted by it. Key points that affect an AI coding assistant:
- Software code may be AI-assisted, but the human author must understand, explain and maintain every part and attests to
  that on submission. "Vibe-coded" blocks are prohibited. Write code with explanations the author can follow.
- Prepared user-facing text (UI labels, localization strings, rules text, journal/item descriptions) and the package
  **description on the website** must be human-written; AI only for proofreading/formatting. AI translations need review
  by a speaker of the language. Images/audio must be human-made.
- Runtime content generated at the table in response to user prompts is allowed; runtime-generated code needs an
  explicit user confirmation step.
When helping a user publish to the official listing, produce code and manifests but tell them the strings,
descriptions and art must come from them.

---------------------------------------------------------------------------------------------------

## 11. Package best practices

Distilled from the KB (Introduction to Development, Package Management) and the community checklist
(foundryvtt.wiki "Package Development Best Practices"), cross-checked with source.

**Identity and namespaces**
- One identifier everywhere: `id` = folder = settings namespace = flag scope = socket suffix = CSS prefix = i18n prefix.
  Lower-case kebab-case, no spaces/underscores in module ids.
- Flags: `doc.getFlag("my-module", "key")`. Valid scopes are `core`, `world`, the system id, and **active** module ids;
  an inactive/misspelled scope throws.
- Settings: `game.settings.register("my-module", "key", ...)`. Keybindings: `game.keybindings.register("my-module", ...)`.
  Use the APIs instead of `localStorage`/raw listeners.
- Sockets: set `"socket": true`, emit/listen on `module.my-module` (or `system.my-system`).
- Custom hooks: namespace names (`myModule.afterRoll`). Expose a public API at `game.modules.get("my-module").api`
  (modules) or `game.system.api` (systems) and document it.
- CSS: prefix every class/id, nest under a root class, no bare element selectors, layers (see `localization-and-styles.md`).
- Do not leak globals. Use ES modules (`esmodules`), never import another package's files. If you need something,
  ask that author to expose it via an API.

**Files and hosting**
- Lower-case kebab-case, no spaces, case-exact references (Linux hosts are case-sensitive, Windows/macOS are not).
- Never hard-code a leading `/` URL; servers may sit behind a route prefix (`foundry.utils.getRoute()`).
- Keep generated output (`dist/`, built packs) out of git, but inside the release zip.
- Do not write user data into the package folder (update wipes it). Use settings, flags, world files via FilePicker with
  `flags.canUpload`, or `persistentStorage` + `storage/`.

**Dependencies and compatibility**
- List every direct dependency in `relationships.requires`. The community wiki says transitive dependency trees deeper
  than one level were not handled during install/activation (unverified for v14).
- Use libWrapper (a module dependency) to patch core methods; fall back to core behavior if your override throws.
- Set `compatibility` honestly: `minimum` = oldest version you actually test, `verified` = generation (`"14"`), leave
  `maximum` empty unless a break is known (systems: consider the current generation).
- Declare module-provided document sub-types sparingly; deactivation hides those documents.

**Releases**
- `manifest` = stable latest URL, `download` = versioned zip, version strictly increasing, manifest inside zip matches.
- Provide `url`, `bugs`, `changelog`, `readme`, `license` in the manifest; the Setup screen links them.
- Test the packaged zip (not just the symlinked dev folder): install via manifest URL into a clean data folder.
- Localize from day one (keys, not literals); ship `lang/en.json`.
- Remove `template.json`, NeDB `.db` files and legacy manifest keys before releasing.

Verify in source: `common/packages/base-package.mjs` (schema and cleaning), `dist/packages/package.mjs` (file existence,
unknown keys, install/update, package index), `dist/packages/installer.mjs` (zip layout, folder replacement),
`dist/packages/hot-reload.mjs` and `client/game.mjs#handleHotReload`, `dist/server/views/view.mjs` (load order, layers).
Online: https://foundryvtt.com/api/v14/classes/foundry.packages.BasePackage.html and
https://foundryvtt.com/article/package-release-api/ , /article/packaging-guide/ , /article/package-management/ ,
/article/system-data-models/ , /article/module-sub-types/ , /article/versioning/ .
