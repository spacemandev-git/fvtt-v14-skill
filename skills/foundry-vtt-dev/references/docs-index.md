# Foundry VTT documentation index (v14 focus)

Verified 2026-10-22 against Foundry v14.369 (stable). Fetch pages with `curl -sL URL | sed 's/<[^>]*>/ /g'` (WebFetch also works). When docs and local source disagree, **source wins**.

Contents: 1 Which source answers what - 2 Knowledge Base - 3 Release notes and breaking-change trackers - 4 API docs (TypeDoc) - 5 Community resources - 6 Reading the local source

## 1. Which source answers what

| Question | Best source |
|---|---|
| Exact `system.json` / `module.json` fields | `common/packages/base-package.mjs`, `base-system.mjs`, `base-module.mjs` (source) > KB system-development / module-development |
| Signature/behaviour of class or method | API docs URL (section 4); then the local `.mjs` file (1 file = 1 class) |
| Which hooks exist, args, when fired | `client/hooks.mjs` (105 JSDoc stub functions, one per hook) or https://foundryvtt.com/api/modules/hookEvents.html; then grep the call site |
| What changed in vN / why a console warning | Release notes (section 3), GitHub "final deprecation" issues, `logCompatibilityWarning` grep (see version-migration.md) |
| Server flags, options.json, Node version | KB `configuration`, `installation`; source `dist/init.mjs`, `dist/core/config.mjs`, `dist/paths.mjs` (see tooling.md) |
| ApplicationV2 / sheet how-to | No KB article. API docs for `foundry.applications.api.*` + community wiki AppV2 pages + dnd5e/crucible source |
| Data model / field types | KB system-data-models + API `foundry.data.fields` + `common/data/fields.mjs` |
| Core CSS / theme variables | `public/css/foundry2.css`, `public/less2/` (LESS source), `templates/` (hbs) |
| Core localization keys | `public/lang/en.json` |

## 2. Knowledge Base (all under `https://foundryvtt.com/article/<slug>/`)

Index page: https://foundryvtt.com/kb/ (categories: Getting Started, Key Concepts and Documents, Game Canvas, Dice and Cards, Configuration Guides, Community Development, Content Creation).

### 2a. Development core (read these first)
| URL | Answers |
|---|---|
| https://foundryvtt.com/article/intro-development/ | Package types (world/system/module), dev environment, git, flags, hooks (+ `CONFIG.debug.hooks`), localization, JS namespacing, Handlebars, CSS namespacing, versioning appendix |
| https://foundryvtt.com/article/system-development/ | Build a system from scratch: folder layout, `system.json` field-by-field (compatibility, packs, languages, documentTypes, grid, initiative, token attributes), data model, custom Document classes, data prep. Parts still show the legacy `template.json` path (deprecated, removal in V16) |
| https://foundryvtt.com/article/system-data-models/ | `TypeDataModel` definition + registration (`CONFIG.Actor.dataModels`), `documentTypes`, `htmlFields`/`filePathFields`, migrations, `prepareBaseData/DerivedData`, token resource attributes |
| https://foundryvtt.com/article/module-development/ | `module.json` layout, `scripts`/`esmodules`/`styles`, module-defined sub-types |
| https://foundryvtt.com/article/module-sub-types/ | Module-registered Document subtypes: manifest `documentTypes`, DataModel + sheet registration, `TYPES.*` localization, system compat, deactivation behaviour |
| https://foundryvtt.com/article/localization/ | `lang/*.json` structure, manifest `languages`, `game.i18n.localize`, `{{localize}}` helper, key naming |
| https://foundryvtt.com/article/frameworks/ | Versions of Handlebars, jQuery, PixiJS, GreenSock that ship with core |
| https://foundryvtt.com/article/asset-management/ | Where assets live (`Data/assets`), uploads, folder permissions, S3, backups |
| https://foundryvtt.com/article/migration/ | Index of per-version migration guides (V10-V12 discussions and the V10-V11 articles below). **No V13/V14 guide**: use release notes + GitHub issues |

Old migration articles (still useful for ancient code): `manifest-migration-guide`, `v10-data-model`, `v10-text-editor`, `v10-journal-pages`, `v10-font-config`, `v11-actor-delta` (Token changes), `v11-document-hierarchy`, `v11-active-effects`, `v11-leveldb-packs` (NeDB `.db` -> LevelDB pack folders; drop `.db` from manifest pack paths). Same base URL pattern.

### 2b. Packaging, versioning, distribution
| URL | Answers |
|---|---|
| https://foundryvtt.com/article/package-management/ | How installs/updates resolve versions, `compatibility` semantics (minimum/verified/maximum), sidegrading, manifest URL install |
| https://foundryvtt.com/article/package-release-api/ | `POST https://foundryvtt.com/_api/packages/release_version/` (token `fvttp_...`, `dry-run`, `release.{version,manifest,notes,compatibility}`; 429 on >1/min) for CI publishing |
| https://foundryvtt.com/article/versioning/ | Release phases (Prototype, API Development, Testing, Stable), when breaking API changes are allowed, update channels, Public vs Private API |
| https://foundryvtt.com/article/packaging-guide/ | Pack a content module (compendiums) step by step; official `my-content-module` template |
| https://foundryvtt.com/article/module-maker/ | In-app Module Maker (no code) for content modules |
| https://foundryvtt.com/article/front-end-package-management/ | Website package edit UI (replaces /admin) |
| https://foundryvtt.com/article/licensing-guide/ | Package-submission content/licensing review criteria |
| https://foundryvtt.com/article/publisher-handbook/, https://foundryvtt.com/article/content-provider-handbook/, https://foundryvtt.com/article/premium-content/ | Selling content, Premium Content System, content keys, provider accounts |
| https://foundryvtt.com/article/content-creation-guide/ | Quality standards: scenes, grid, lighting, walls, journals, compendium organisation |
| https://foundryvtt.com/article/media/ | Asset naming, folder layout, formats (webp, webm) |
| https://foundryvtt.com/article/dynamic-token-rings/ | Dynamic Token Ring asset anatomy (subject/ring/background) and API hooks |

### 2c. Running, hosting, configuring, troubleshooting
| URL | Answers |
|---|---|
| https://foundryvtt.com/article/installation/ | Install/activate; Node.js dedicated-server section (`node main.js --dataPath=...`); Node minimum: 24 for V14, 22 for V13; portable builds; multiple installs |
| https://foundryvtt.com/article/configuration/ | Setup config tab, `options.json` keys, data-path resolution order, CLI flags (`--port --world --dataPath --noupnp --noupdate --adminPassword --logsize --maxlogs --hotReload --noipdiscovery --demo`) |
| https://foundryvtt.com/article/requirements/ , https://foundryvtt.com/article/hosting/ | Client/server specs, Raspberry Pi, self vs cloud vs partner hosting |
| https://foundryvtt.com/article/troubleshooting/ | Hub for: `reset-admin-password` (delete `Config/admin.txt`), `reset-user-passwords`, `launch-safe-configuration`, `user-data-backup` (each at `/article/<slug>/`) |
| https://foundryvtt.com/article/backups/ , https://foundryvtt.com/article/automatic-backups/ | World snapshots/backups UI; safe use of sync services |
| https://foundryvtt.com/article/ssl/ , `port-forwarding`, `nginx`, `apache`, `caddy`, `aws-s3` | TLS, reverse proxies (`proxySSL`, `proxyPort`, `routePrefix`), S3 storage |
| https://foundryvtt.com/article/audio-video/ | A/V integration setup (+ API refs) |
| https://foundryvtt.com/article/faq/ , `modules`, `game-worlds`, `settings`, `users`, `keybinds`, `controls`, `tours` | User-facing behaviour; `settings` has setting scopes + `ClientSettings` API refs; `tours` documents the Tour API |

### 2d. Concept articles that end with "API References" (links to exact API classes)
`actors`, `items`, `active-effects`, `scenes`, `scene-regions`, `combat`, `chat`, `journal`, `roll-tables`, `playlists`, `macros` (script macro built-ins), `tokens`, `walls`, `lighting`, `tiles`, `drawings`, `ambient-sound`, `map-notes`, `measurement`, `users` (roles/permissions), `compendium`, `adventure`, `cards`, `dice`, `dice-advanced`, `dice-modifiers` (roll formula syntax), `canvas-layers`, `glossary` (terminology).

**Freshness warning (checked 2026-10-22):** only `scene-regions` (updated 14.369, covers region templates, behaviors, events) and `glossary` (14.367) reflect V14. `measurement`/`canvas-layers` still describe the removed Measured Templates layer, `scenes` has no Scene Levels, `active-effects` has no AE v2 (phases, expiry, `system.changes`), `chat` has no message modes. For V14 features use the release-note highlights (14.349 P1, 14.352 P2, 14.353 P3, 14.359 stable), `version-migration.md`, and the source.

## 3. Release notes and breaking-change trackers

- Index: https://foundryvtt.com/releases/ ; one release: `https://foundryvtt.com/releases/<generation>.<build>`. Each has `## Breaking Changes`, `## New Features`, `## API Improvements`, `## Bug Fixes`; items link to `https://github.com/foundryvtt/foundryvtt/issues/<n>` (public; `curl -sL https://api.github.com/repos/foundryvtt/foundryvtt/issues/<n>` returns JSON with a `body`).
- Phase map: **V14**: 14.349 P1 (2025-09-26), 14.352 P2, 14.353 P3, 14.354 API Dev 1, 14.355 API Dev 2, 14.356-358 Testing 1-3, **14.359 Stable (2026-04-01)**, 14.360-14.369 updates (latest 14.369, 2026-10-08). **V13**: 13.332 P1, 13.333 P2, 13.334-335 API Dev, 13.336-340 Testing, **13.341 Stable (2025-04-27)**, updates to 13.351. **V12**: 12.316 P1, 12.317 P2, 12.318-319 API Dev, 12.320-323 Testing, **12.324 Stable (2024-05-22)**, updates to 12.331/12.343.
- Stable notes (14.359, 13.341, 12.324) carry the "comprehensive highlights"; breaking details are in the prototype/API-dev notes.
- "Final deprecation removal" issues (complete lists of removed API per generation): V12 https://github.com/foundryvtt/foundryvtt/issues/10164 , V13 .../issues/11815 , V14 .../issues/13436 .
- Breaking-change project boards: V14 https://github.com/orgs/foundryvtt/projects/67/views/8 , V12 https://github.com/orgs/foundryvtt/projects/42/views/9 .
- Discussions (V12 deep dives): .../discussions/10175 (Audio), 10184 (Grid), 10176 (Compat removals), 10267 (Primary Canvas Objects V2).
- Distilled per-version breaking changes and the full deprecation inventory: `references/version-migration.md`.

## 4. API documentation (TypeDoc)

Root: https://foundryvtt.com/api/ (= v14). **Per-version roots exist**: `https://foundryvtt.com/api/v13/`, `/api/v12/`, `/api/v11/`, `/api/v10/` (same URL layout, e.g. `https://foundryvtt.com/api/v13/classes/foundry.abstract.DataModel.html`). Use v13 pages to check what a dual-version package may call.

### URL patterns (kind / dotted full name)
| Kind | Pattern | Example |
|---|---|---|
| Class | `/api/classes/<ns>.<Class>.html` | `/api/classes/foundry.abstract.DataModel.html`, `.../foundry.applications.api.ApplicationV2.html`, `.../foundry.documents.Actor.html`, `.../foundry.Game.html` |
| Namespace/module | `/api/modules/<ns>.html` | `/api/modules/foundry.data.fields.html`, `/api/modules/foundry.utils.html` |
| Function | `/api/functions/<ns>.<fn>.html` | `/api/functions/foundry.utils.mergeObject.html`, `/api/functions/foundry.applications.api.HandlebarsApplicationMixin.html` |
| Hook | `/api/functions/hookEvents.<hookName>.html` | `/api/functions/hookEvents.renderChatMessageHTML.html` (list: `/api/modules/hookEvents.html`) |
| Interface / typedef | `/api/interfaces/<ns>.<Name>.html`, `/api/types/<ns>.<Name>.html` | `/api/interfaces/foundry.applications.types.ApplicationConfiguration.html` |
| Constant | `/api/variables/CONST.<NAME>.html` (list `/api/modules/CONST.html`) | `/api/variables/CONST.DOCUMENT_OWNERSHIP_LEVELS.html` |
| CONFIG entry | `/api/variables/CONFIG.<Key>.html` (list `/api/modules/CONFIG.html`) | `/api/variables/CONFIG.Actor.html` |
| Members | `#<memberName>` anchor on a class page | `...ApplicationV2.html#render` |
Other: `/api/hierarchy.html` (class tree), `/api/modules.html`. Intro page explains Public vs Private API: `@public` and `@protected` (override in subclasses) are supported; `@private`, `@internal`, `_underscore` without tag, and `#private` are not.

### Namespace map (v14; globals in parentheses)
| Namespace | Contains |
|---|---|
| `foundry.abstract` | `DataModel`, `TypeDataModel`, `Document`, `DatabaseBackend`, `EmbeddedCollection(Delta)`, `SingletonEmbeddedCollection` |
| `foundry.data.fields` | `StringField`, `NumberField`, `SchemaField`, `ArrayField`, `SetField`, `ObjectField`, `HTMLField`, `FilePathField`, `ColorField`, `DocumentUUIDField`, `TypedObjectField`, `EmbeddedDataField`, `ForeignDocumentField`, ... |
| `foundry.data`, `foundry.data.operators` | Shape data models, `PrototypeToken`, `TextureData`, `CalendarData`, `ForcedDeletion`/`ForcedReplacement` (`_del`/`_replace`), `foundry.data.regionBehaviors.*` |
| `foundry.documents` | `Actor`, `Item`, `ChatMessage`, `Scene`, `TokenDocument`, `Level`, ... + `Base*` (shared) classes; `.abstract` (`DocumentCollection`, `WorldCollection`, `ClientDocumentMixin`), `.collections` (`Actors`, `Items`, `CompendiumCollection`, ...), `modifyBatch` |
| `foundry.applications.api` | `ApplicationV2`, `DocumentSheetV2`, `DialogV2`, `HandlebarsApplicationMixin`, `CategoryBrowser` |
| `foundry.applications.sheets` | `ActorSheetV2`, `ItemSheetV2`, `*Config` sheets, `journal.*` page sheets, `palette.*` |
| `foundry.applications.apps / ux / elements / fields / handlebars / ui / hud / sidebar / dice / settings` | `DocumentSheetConfig`, `FilePicker`; `TextEditor`, `ContextMenu`, `DragDrop`, `Tabs`, `FormDataExtended`; custom elements (`<file-picker>`, `<range-picker>`, ...); `createFormGroup`/input builders; `renderTemplate`/`loadTemplates`; `Hotbar`, `SceneControls`; HUDs; `ChatLog`, directories, `Compendium`; `RollResolver` |
| `foundry.applications` (root) | `instances` (Map of open ApplicationV2), `parseHTML` (deprecated) |
| `foundry.appv1` | Legacy `Application`, `FormApplication`, `Dialog`, `DocumentSheet`, `sheets.ActorSheet/ItemSheet` (deprecated; removal V16) |
| `foundry.canvas` (+ `.layers .placeables .groups .perception .sources .interaction .geometry .animation .vfx .primary .rendering .containers`) | `Canvas`, `SceneManager`, layers, `Token`/`Tile`/`Wall`..., vision/detection, `Ruler`, `ParticleGenerator`, `CanvasShakeEffect`, VFX |
| `foundry.dice`, `foundry.dice.terms` | `Roll`, `RollParser`, `MersenneTwister`; `Die`, `Coin`, `NumericTerm`, `PoolTerm`, ... |
| `foundry.helpers` (+ `.interaction .media`) | `Hooks`, `Localization`, `ClientSettings`, `GameTime`, `SocketInterface`, `DocumentIndex`, `ImageHelper`, `KeyboardManager`, `TooltipManager` |
| `foundry.utils` | `mergeObject`, `getProperty`, `setProperty`, `expandObject`, `flattenObject`, `deepClone`, `isNewerVersion`, `randomID`, `fromUuid(Sync)`, `parseUuid`, `Collection`, `Color`, `debounce`, `throttle`, `logCompatibilityWarning`, ... |
| `foundry.grid`, `foundry.audio`, `foundry.av`, `foundry.nue`, `foundry.prosemirror`, `foundry.packages`, `foundry.config` | Grids; `Sound`, `AudioHelper`; A/V; Tours; ProseMirror plugins; `System`/`Module`/`World`/`BasePackage`; `ReleaseData`/`ServerSettings` |
| `foundry` (root) | `Game` (`game`), `ClientDocument`, `CanvasDocument`, `PlaceablePalette`, `EventEmitter` |
| `CONST` | Enums/constants (`DOCUMENT_OWNERSHIP_LEVELS`, `USER_ROLES`, `ACTIVE_EFFECT_CHANGE_TYPES`, `COMPATIBILITY_MODES`, ...) - global `CONST` |
| `CONFIG` | Runtime configuration objects (`CONFIG.Actor.documentClass`, `.dataModels`, `.Canvas`, `.debug`, `.compatibility`, `CONFIG.ChatMessage.modes`, ...) - global `CONFIG` |
| `hookEvents` | One function per hook (105 in v14) |
| `primitives` | Extensions of `Array`, `Math`, `Number`, `Set`, `String`, `Date` (`Math.clamp`, `Set#map`, `String#slugify`, ...) |

### Finding a class quickly
1. Guess the dotted name and build the URL: `foundry.` + folder path under `client/` or `common/` + class (e.g. `client/applications/sheets/actor-sheet.mjs` -> `foundry.applications.sheets.ActorSheetV2`). v14 also exports unsuffixed aliases (`api.Application`=`ApplicationV2`, `api.Dialog`=`DialogV2`, `api.DocumentSheet`=`DocumentSheetV2`, `sheets.ActorSheet`=`ActorSheetV2`, `sheets.ItemSheet`=`ItemSheetV2`); the docs use the `V2` names, which are also the only ones that exist in v13 - use `V2`.
2. Not sure of the namespace? The whole nav tree is one file: `curl -sL https://foundryvtt.com/api/assets/navigation.js -o navigation.js` (v14 body: `window.navigationData = "<base64 of zlib-deflated JSON>"`; the v12/v13 files use a `data:application/octet-stream;base64,` prefix and gzip). Decode v14 with `python3 -I -c 'import re,base64,zlib,json,sys; s=open(sys.argv[1]).read(); print(json.dumps(json.loads(zlib.decompress(base64.b64decode(re.search(r"\"([A-Za-z0-9+/=]+)\"",s).group(1))))))' navigation.js` (swap `zlib.decompress` for `gzip.decompress` after stripping the prefix for older versions). Nodes are `{text, path, kind, children}` with `path` like `classes/foundry.abstract.DataModel.html`. Diffing the v13 and v14 trees shows what is new/removed (done in version-migration.md).
3. Or search locally: `grep -rn "^export default class Foo\b" client common` / `find client common -name 'foo-bar.mjs'`.
4. The site search box indexes `assets/search.js`; not scriptable cheaply - prefer 1-3.

## 5. Community and reference code
- Community wiki (maintained, unofficial): https://foundryvtt.wiki/en/development/ ; API primers `/en/development/api/{applicationv2,dialogv2,DataModel,document,hooks,flags,settings,sockets,roll,canvas,localization,game,helpers,time,CompendiumCollection}`; **AppV1->AppV2 migration**: https://foundryvtt.wiki/en/development/guides/applicationV2-conversion-guide ; best-practice checklist `/en/development/guides/package-best-practices`; releases `/en/development/guides/releases-and-history`. Older pages (FormApplication, Dialog) describe V1 - treat as legacy.
- Reference implementations (open source, always on the newest API): https://github.com/foundryvtt/dnd5e (AppV2, DataModels, Rollup+LESS build, `utils/packs.mjs` pack tooling), https://github.com/foundryvtt/crucible (Foundry-authored, tracks new APIs first), https://github.com/foundryvtt/worldbuilding (Simple Worldbuilding system), https://github.com/foundryvtt/pf2e.
- Official CLI: https://github.com/foundryvtt/foundryvtt-cli ; public issue tracker/docs: https://github.com/foundryvtt/foundryvtt ; types: https://github.com/League-of-Foundry-Developers/foundry-vtt-types ; Quench tests: https://github.com/Ethaks/FVTT-Quench (API docs https://ethaks.github.io/FVTT-Quench/).
- Discord `#dev-support` on https://discord.gg/foundryvtt (official help channel).

## 6. Reading the local source

Root (macOS Electron install): `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/` (Windows: `<install>\resources\app`; Node build: the unzipped folder itself). Referred to as `$APP` below.

| Path | Contents |
|---|---|
| `$APP/client/` | Browser-side code, **1 file = 1 class**, kebab-case names. Entry `client.mjs` (assigns globals + deprecated global shims), `_module.mjs` (builds the `foundry` namespace), `config.mjs` (**all `CONFIG.*` defaults**), `game.mjs` (`Game`: init sequence, settings, socket, hot reload), `hooks.mjs` (**canonical hook stubs**), `ui.mjs` (`ui.*`), `global.d.mts` (global type decls) |
| `client/applications/` | AppV2 framework and all core UI. `api/` ApplicationV2, DocumentSheetV2, DialogV2, HandlebarsApplicationMixin; `sheets/` document sheets/configs (+`journal/`, `token/`, `palette/`); `sidebar/` (`tabs/`, `apps/`); `ui/` (hotbar, scene controls, nav, notifications, players); `hud/`; `apps/` (FilePicker, DocumentSheetConfig, GridConfig...); `ux/` (TextEditor, ContextMenu, DragDrop, Tabs, FormDataExtended, ProseMirrorEditor); `elements/` custom HTML elements; `settings/`; `dice/` (RollResolver); `detached/` (pop-out windows); `forms/fields.mjs`; `handlebars.mjs` (helpers: `checked selectOptions formInput formGroup localize numberFormat ...`) |
| `client/appv1/` | Legacy Application/FormApplication/Dialog/DocumentSheet + V1 sheets (deprecated, V16 removal) |
| `client/documents/` | Client Document classes (`actor.mjs`, `token.mjs`, `scene.mjs`, `level.mjs`, ...); `abstract/` (ClientDocumentMixin, CanvasDocumentMixin, DocumentCollection, WorldCollection); `collections/` (Actors, Items, CompendiumCollection, ...) |
| `client/data/` | `client-backend.mjs` (CRUD plumbing; calls pre/create/update/delete hooks), `fields.mjs` (client-only fields), shape data (`shapes.mjs`), `region-behaviors/`, `region-shapes/`, `calendar.mjs`, `combat-config.mjs` |
| `client/canvas/` | PIXI canvas: `board.mjs` (`Canvas`), `layers/`, `groups/`, `placeables/` (Token, Wall, ...; `tokens/` ring/movement), `perception/` (fog, vision/detection modes), `sources/` (light/vision/sound), `geometry/` (sweep polygons, edges), `interaction/` (mouse manager, ruler, pings), `animation/` (CanvasAnimation, ParticleGenerator, shake), `vfx/`, `primary/`, `rendering/` (shaders, filters), `containers/`, `loader.mjs` (TextureLoader) |
| `client/helpers/` | `hooks.mjs` (`Hooks` class), `localization.mjs`, `client-settings.mjs`, `time.mjs`, `socket-interface.mjs`, `document-index.mjs`, `interaction/` (keybindings, keyboard, tooltip), `media/` |
| `client/dice/` | `roll.mjs`, `parser.mjs` + `grammar.pegjs`, `terms/` |
| `client/audio/`, `client/av/`, `client/nue/`, `client/packages/`, `client/utils/` | Sound API; A/V; tours; client package classes (`System`, `Module`, `World`); client util helpers |
| `$APP/common/` | Shared client+server: `abstract/` (`data.mjs`=DataModel, `document.mjs`, `type-data.mjs`, `backend.mjs`, embedded collections), `data/` (`fields.mjs` all DataField types, `operators.mjs`, `validators.mjs`), `documents/` (`Base*` schema definitions: **source of truth for each Document's fields**), `packages/` (**manifest schemas**), `constants.mjs` (**CONST**), `config.mjs` (`ServerSettings` = options.json schema, `ReleaseData`), `utils/` (`helpers.mjs` mergeObject etc., `logging.mjs`, `color.mjs`, `collection.mjs`), `grid/`, `primitives/`, `prosemirror/` |
| `$APP/dist/` | Minified Node server: `init.mjs` (argv + startup), `paths.mjs` (data path), `core/` (config, license, update, game), `server/` (express, sockets, views), `database/`, `packages/` (installer, hot-reload), `files/`. Not API; read for flags/behaviour only |
| `$APP/public/` | Served assets: `scripts/foundry.mjs` (bundle of client+common - **grep it when `client/` lacks something, e.g. setup/join screens**), `css/foundry2.css`, `less2/` (LESS sources: themes, variables), `lang/en.json`, `icons/`, `fonts/` |
| `$APP/templates/` | Core `.hbs` templates (`sheets/`, `sidebar/`, `ui/`, `setup/`, `generic/form-fields.hbs`...) |
| `$APP/package.json` | `release` object: generation, build, `node_version`; `engines.node` |
| `$APP/main.mjs`, `main.js` | Entry points (`node main.js`); Node major check |
Not shipped in the app: eslint config, setup code as separate files, tests. `tsconfig.json` + `client/global.d.mts` + `common/global.d.mts` are shipped (usable for IntelliSense; see tooling.md).

### Grep recipes (run from `$APP`)
```bash
APP="/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"; cd "$APP"
# Where is a hook fired? (static names)
grep -rn 'callAll("renderChatMessageHTML"' client/          # -> client/documents/chat-message.mjs
grep -rn '"getSceneControlButtons"' client/ | grep -v 'hooks.mjs'   # -> client/applications/ui/scene-controls.mjs
# Dynamic hook names are built with template strings:
grep -rn 'Hooks.call\(All\)\?(`' client/ | cut -c1-170     # preCreate${type} (data/client-backend.mjs), control${embeddedName}, draw${hookName}, ...
# ApplicationV2 render/close/getHeaderControls hooks: client/applications/api/application.mjs  #callHooks (fires for every class in the inheritance chain)
# Hook docs (args) for a name:
grep -n -B12 'export function renderChatMessageHTML' client/hooks.mjs
# Find a class / file:
grep -rn "^export default class ActorSheetV2" client/ ; find client common -name 'token*.mjs'
# Who overrides/calls a method?
grep -rn "_prepareContext\b" client/applications | head
# Default CONFIG value:
grep -n "CONFIG.Actor\|^export const Actor" client/config.mjs | head
# Document schema (fields): 
sed -n '/static defineSchema/,/^  }/p' common/documents/actor.mjs
# Deprecations (message + since/until) - see version-migration.md:
grep -rn "logCompatibilityWarning" client common | wc -l
grep -rn "@deprecated since v14" client common | cut -c1-150
# CLI flags / env vars used by the server:
grep -o 'function parseArgs.\{0,260\}' dist/init.mjs                       # any --key[=value] becomes args[key]
grep -o 'initialize(e){const t={};.\{0,520\}' dist/core/config.mjs         # which args map to options (nobackups,noupnp,hotReload,fullscreen,port,world,tempDir,...)
grep -rhoE 'process\.env\.[A-Za-z_]+' dist | sort -u
# Template or CSS used by a core UI element:
grep -rn "join-form\|scene-controls" templates client public/less2 | head
# String lookup / localization key:
grep -n '"DOCUMENT.Create"' public/lang/en.json
# Something only in the bundle (setup/join screens):
grep -n "class JoinGameForm" public/scripts/foundry.mjs
```
Gotchas: zsh needs quotes around globs (`--include='*.mjs'`); `dist/*.mjs` is minified (single-line) so grep with `-o` and a bounded regex.
