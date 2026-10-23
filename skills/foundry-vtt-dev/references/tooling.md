# Developer tooling and workflow

Verified 2026-10-22 against Foundry 14.369 source, `@foundryvtt/foundryvtt-cli` 3.0.5 (read from the npm tarball), `fvtt-types` 14.366 beta (npm tarball), Quench 0.10.0. Items I could not run end-to-end are marked *(unverified)*.

## Contents
1. [Recommended setup at a glance](#1-recommended-setup-at-a-glance)
2. [foundryvtt-cli: packs, config, launch](#2-foundryvtt-cli)
3. [Project layouts](#3-project-layouts): [no build](#31-plain-esm-no-build-default) - [bundlers](#32-bundlers-rollup-vite-esbuild) - [CSS](#33-css-lessscss-and-layers) - [releases/CI](#34-git-releases-and-ci)
4. [TypeScript and IntelliSense](#4-typescript-and-intellisense): [fvtt-types](#41-fvtt-types) - [shipped typings + JSDoc](#42-no-typescript-use-the-typings-foundry-ships) - [ESLint](#43-eslint)
5. [Debugging](#5-debugging): [CONFIG.debug](#51-configdebug-flags) - [compatibility mode](#52-configcompatibility) - [console one-liners](#53-console-one-liners) - [logs, hot reload, safe mode](#54-logs-hot-reload-safe-mode)
6. [Running Foundry as a Node.js server](#6-running-foundry-as-a-nodejs-server): [flags](#62-command-line-flags-verified-from-source) - [options.json](#63-optionsjson-keys) - [data path, license, admin password](#64-data-path-license-admin-password)
7. [Automated testing](#7-automated-testing)

---

## 1. Recommended setup at a glance

| Need | Default choice |
|---|---|
| Language/build | Plain ESM `.mjs` files loaded directly via `esmodules` (no build). Add Rollup/Vite/esbuild only if you need npm dependencies or TypeScript |
| CSS | Plain CSS with your own scoped classes and `@layer` (or LESS/SCSS compiled to one `.css` file) |
| Compendium sources | YAML/JSON under `packs/_source/` in git, compiled with `@foundryvtt/foundryvtt-cli` (`fvtt package pack`) |
| Editor intelligence | JS + JSDoc using the typings shipped in the Foundry app folder (4.2), or TypeScript + `fvtt-types@beta` for v14 (4.1) |
| Lint | ESLint flat config with a Foundry `globals` block (4.3) |
| Dev loop | Symlink the repo into `<UserData>/Data/{systems,modules}/<id>`, run Foundry, reload the browser tab. CSS/HBS/JSON can hot reload (5.4); JS needs F5 |
| Verification | Skill harness: `fvtt-lint.mjs` -> `fvtt-server.mjs start` -> `fvtt-browser.mjs smoke` (see testing.md) |

---

## 2. foundryvtt-cli

Package `@foundryvtt/foundryvtt-cli` (MIT, repo https://github.com/foundryvtt/foundryvtt-cli, v3.0.5, engines `node >17`). Installs the `fvtt` binary: `npm i -g @foundryvtt/foundryvtt-cli` or as a devDependency (`npx fvtt ...`). dnd5e and crucible both use it as a devDependency and wrap `compilePack/extractPack` in their own `utils/packs.mjs` / `build.mjs`.

### 2.1 Configuration (`fvtt configure`)
Stored in YAML at `~/Library/Preferences/.fvttrc.yml` (macOS), `%APPDATA%\.fvttrc.yml` (Windows), `$XDG_DATA_HOME or ~/.local/share/.fvttrc.yml` (Linux). Keys:
| Key | Meaning |
|---|---|
| `dataPath` | The **User Data root** - the folder that contains `Data/`, `Config/`, `Logs/` (macOS default `~/Library/Application Support/FoundryVTT`). The CLI appends `/Data/<type>s/<id>/packs/<name>` itself. (`config.example.yml` shows a path ending in `\Data`; the code in 3.0.5 appends `Data`, so use the root.) |
| `installPath` | Foundry install dir; only needed by `fvtt launch` (Node build: folder with `main.js`; Electron layout: `<install>/resources/app/main.js`; on macOS use `.../Foundry Virtual Tabletop.app/Contents/Resources/app`) |
| `currentPackageId`, `currentPackageType` | Set by `fvtt package workon` (type `Module`, `System` or `World`) |
```bash
fvtt configure                       # reports whether installPath/dataPath are set
fvtt configure set dataPath "$HOME/Library/Application Support/FoundryVTT"
fvtt configure set installPath "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"
fvtt configure view | get <key> | path
fvtt --config ./.fvttrc.yml package pack ...   # global --config: merge a per-project YAML file over the global one
```

### 2.2 `fvtt package` (compendium packs)
```bash
fvtt package workon my-system --type System    # type auto-detected by scanning <dataPath>/Data/*/ manifests if omitted
fvtt package                                   # prints current working package
fvtt package clear
fvtt package unpack monsters                   # LevelDB pack -> one file per document
fvtt package pack monsters                     # files -> LevelDB pack
fvtt package pack -n monsters --in packs/_source/monsters --out packs
```
Flags (verified in `commands/package.mjs`): `--id`, `--type Module|System|World`, `-n/--compendiumName`, `-t/--compendiumType` (NeDB only), `--in/--inputDirectory`, `--out/--outputDirectory`, `--yaml`, `-v/--verbose`, `--nedb` (legacy `.db` packs instead of LevelDB), `-r/--recursive` (pack: walk subdirectories), `-c/--clean` (unpack: delete destination first), `--folders` (unpack: mirror compendium Folders as directories, folder docs written as `_Folder.json|yml`), `--expandAdventures` (unpack: write documents embedded in Adventures to their own files; with `--folders` the Adventure acts as a folder and `--recursive` is required when packing), `--omitVolatile` (unpack: skip rewriting a file when only `_stats.{createdTime,modifiedTime,lastModifiedBy,systemVersion,coreVersion}` differ - keeps git diffs clean).
Defaults when `--in/--out` are omitted: pack dir = `<dataPath>/Data/<types>/<id>/packs/<name>`, source dir = `<pack dir>/_source`. Packs may live in subfolders (`"path": "packs/items/pf2e"` -> `-n items/pf2e`).
Rules and gotchas:
- **Close Foundry first** (or at least ensure the world/package isn't loaded): a running server holds the LevelDB `LOCK` file and the CLI refuses ("pack is currently in use").
- Each source file is a plain document JSON/YAML with a `_key` like `!actors!<id>`, `!actors.items!<actorId>.<itemId>`, `!folders!<id>` (LevelDB key). Don't delete `_key`. Filenames are `Name_<id>.json`.
- Source of truth in git = `_source`; the compiled `packs/<name>/` LevelDB folder is a build artifact (often git-ignored and rebuilt in `postinstall`/CI; it must ship in the release zip).
- Manifest pack `path` has no `.db` suffix; Actor/Item/Adventure packs need `system` (see version-migration.md 1.6).
- 3.0.x supports ActiveEffect primary documents and Levels (v14 data).

### 2.3 JS API (for build scripts)
```js
import { compilePack, extractPack } from "@foundryvtt/foundryvtt-cli";
await compilePack("packs/_source/monsters", "packs/monsters", { recursive: true, yaml: true, log: true,
  transformEntry: entry => { delete entry._stats?.modifiedTime; } });   // return false to drop an entry
await extractPack("packs/monsters", "packs/_source/monsters", { yaml: true, folders: true, omitVolatile: true,
  transformName: async (entry, ctx) => `${slug(entry.name)}.yml`,       // must include the extension
  transformEntry: async (entry, ctx) => { /* clean fields */ } });
```
`compilePack(src, dest, {nedb, yaml, log, recursive, transformEntry})`, `extractPack(src, dest, {nedb, yaml, yamlOptions, log, folders, documentType (NeDB), transformEntry, transformName, transformFolderName, transformSerialized, expandAdventures, omitVolatile, jsonOptions:{replacer,space}})`. `transformEntry` may be async and returning `false` discards the entry. Typical npm scripts: `"build:db": "node utils/packs.mjs package pack"`, `"build:json": "... unpack"` (dnd5e).

### 2.4 `fvtt launch`
`fvtt launch [--demo] [--port 30000] [--world id] [--noupnp] [--noupdate] [--adminKey ...]` spawns `node <installPath>/main.js --dataPath=<configured dataPath> --port=... ` using the `node` on PATH. It does not expose `--nobackups`, `--hotReload`, etc.; for those call `node main.js` yourself (section 6).

---

## 3. Project layouts

### 3.1 Plain ESM, no build (default)
```
my-system/                      <- folder name MUST equal manifest "id"
  system.json                   (or module.json)
  my-system.mjs                 <- esmodules entry; import siblings with relative paths + ".mjs"
  module/ {data/, documents/, sheets/, helpers/}
  templates/*.hbs
  styles/my-system.css
  lang/en.json
  packs/_source/**              <- YAML sources;  packs/<name>/ compiled LevelDB
  assets/
```
- `"esmodules": ["my-system.mjs"]` loads as `<script type="module">`; `"scripts"` loads classic scripts (avoid). Imports must be **relative with explicit extension** (`import {X} from "./module/x.mjs"`); bare specifiers (`import _ from "lodash"`) do not resolve in the browser - bundle those (3.2). Top-level `await` is allowed. Use `foundry.*` namespaces, not imports, for core classes.
- Develop in place: `ln -s "$PWD" "<UserData>/Data/systems/my-system"` (macOS/Linux; the skill's harness depends on symlinks working). Windows: directory junction `mklink /J` *(unverified)*. Or `git clone` straight into `Data/systems/` as the KB suggests.
- Reload: manifest changes need a server restart; JS needs a browser reload; CSS/HBS/JSON can hot reload (5.4). Template paths are absolute from the Foundry root: `systems/my-system/templates/x.hbs`, case-sensitive on Linux hosts.
- Why this default: zero tooling, readable stack traces, nothing to keep in sync, and core samples (dnd5e ships `dnd5e.mjs`; it only rolls up for release) are written this way.

### 3.2 Bundlers: Rollup, Vite, esbuild
Use when you need npm packages, TypeScript, Svelte/Vue/React, or minification. Rules that apply to all:
- Output **ES modules** to a build folder, point the manifest at it (`"esmodules": ["dist/main.mjs"]`), list the css it emits in `styles`. Do not bundle Foundry itself (it is a global at runtime). Keep `module.json`, `lang/`, `templates/`, `assets/`, compiled `packs/` outside the bundle but inside the zip.
- Symlink the **repo root** into `Data/modules/<id>` (not `dist/`): the manifest, `lang/`, `templates/` and `dist/` must all be reachable under the package folder. Run the bundler in watch mode; reload the browser after each rebuild.
- Emit sourcemaps (`sourcemap: true`) so DevTools shows your original files.
```js
// rollup.config.mjs  (dnd5e uses: rollup dnd5e.mjs -f es -o dnd5e-compiled.mjs -p node-resolve -m)
import resolve from "@rollup/plugin-node-resolve";
export default { input: "src/main.mjs", output: { file: "dist/main.mjs", format: "es", sourcemap: true }, plugins: [resolve()] };
```
```js
// vite.config.mjs  (library mode: Vite is only the bundler; Foundry serves the files)
import { defineConfig } from "vite";
export default defineConfig({
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true, minify: false,
    lib: { entry: "src/main.mjs", formats: ["es"], fileName: () => "main.mjs", cssFileName: "style" } }
});
// manifest: "esmodules": ["dist/main.mjs"], "styles": [{"src": "dist/style.css"}]   (npx vite build --watch). Tested: Vite 7 emits dist/main.mjs + dist/style.css; Rollup config above also tested.
```
```bash
npx esbuild src/main.mjs --bundle --format=esm --sourcemap --outfile=dist/main.mjs --watch=forever   # fastest; tested with esbuild 0.28 (plain --watch exits when stdin closes). CSS imports emit dist/main.css next to main.mjs
```
TypeScript: esbuild/Vite strip types but don't check; run `tsc --noEmit` (or `tsgo`) separately. Never use the Vite *dev server* as the host - Foundry must serve the package.

### 3.3 CSS, LESS/SCSS, and layers
- Core CSS is in `@layer`s (v13+); unlayered package CSS always wins over core. Either scope tightly (`.my-system.sheet ...`) or opt into layers with the manifest `styles` object form: `{"src": "styles/x.css", "layer": "system"}` (core template emits `@import "<src>" layer(<layer>)`; unlayered entries are plain `<link>` tags for core, `@import` for packages).
- Core theming uses CSS variables and `.themed.theme-light|theme-dark` classes; reuse `--color-*` variables rather than hard-coding colors. Core sources for reference: `$APP/public/less2/` (variables, themes, elements) compiled into `public/css/foundry2.css`.
- LESS/SCSS: compile to a single CSS file and register that file only. `lessc less/my-system.less my-system.css --source-map` (dnd5e's `build:css`; `less-watch-compiler` for watch). `sass --watch scss/main.scss styles/main.css`. Commit or build the CSS in CI - the zip must contain it.
- Keep `.hbs`/`.css`/`.json` paths listed in `flags.hotReload` (5.4) for live updates.

### 3.4 Git, releases, and CI
- Branch model: `main` with the manifest `manifest` URL pointing to the latest release asset; GitHub release assets `module.json` + `module.zip`:
  - `"manifest": "https://github.com/<owner>/<repo>/releases/latest/download/module.json"`
  - `"download": "https://github.com/<owner>/<repo>/releases/download/<tag>/module.zip"` (a CI step rewrites `version` and `download` per tag).
- The zip root must be the package contents (`module.json`/`system.json` at the zip root, no wrapping folder). Include compiled `packs/*`, `dist/`, `lang/`, `templates/`, `styles/`, `assets/`; exclude `node_modules/`, `packs/_source/`, tooling.
- Publish metadata with the Package Release API (docs-index.md 2b): `POST https://foundryvtt.com/_api/packages/release_version/`, header `Authorization: fvttp_...` (store as CI secret), body `{id, "dry-run": true, release: {version, manifest, notes, compatibility: {minimum, verified, maximum}}}`; rate limit 1/min per package. Test with `dry-run` first. Community actions (FVTT Autopublish / Foundry Publish) wrap this.
- `.gitignore`: `node_modules/`, `dist/` (if built in CI), `packs/*/` compiled DBs *unless* you ship them from git, `*.log`. Keep `packs/_source/` committed.
- CI skeleton: checkout -> `npm ci` -> `npm run build` (bundle + css + `fvtt package pack`) -> `node <skill>/scripts/fvtt-lint.mjs .` -> zip -> upload release assets -> release API call.

---

## 4. TypeScript and IntelliSense

### 4.1 fvtt-types
Community types from League of Foundry Developers (unofficial): https://github.com/League-of-Foundry-Developers/foundry-vtt-types, npm `fvtt-types`.
- **Status (npm dist-tags, checked 2026-10-22)**: `latest` = `13.346.0-beta.20250812...` (v13), `beta` = `14.366.0-beta.20261009...` (v14), `prerelease` = `14.366.0-beta.20260816...`. All are betas: expect rough edges and large type-check times. The repo README still describes installing from `#main` and says v13 work is "underway"; the npm tags are the better signal.
- Install for v14: `npm i -D fvtt-types@beta typescript@^5.9` (peer deps: `typescript >=5.9`, `@typescript/native-preview`, i.e. `tsgo`, which the project itself type-checks with). For v13: `npm i -D fvtt-types@latest`. Pin the exact beta in package.json.
- `tsconfig.json` (from the package README/tsconfig.base.json):
```json
{ "compilerOptions": { "types": ["fvtt-types"], "target": "esnext", "module": "esnext", "moduleResolution": "bundler",
  "strict": true, "noEmit": true, "skipLibCheck": true, "allowJs": true, "checkJs": false },
  "include": ["src", "*.d.mts"] }
```
  `types: ["fvtt-types"]` is what makes the globals (`game`, `CONFIG`, ...) appear. Entry points: `fvtt-types` (default), `fvtt-types/lenient` (same, but assumes the `ready` hook has run so `game` isn't `undefined | Game`), `fvtt-types/configuration` (declaration merging), `fvtt-types/utils`.
- Tell the types about your package by declaration merging (this must match what you do at runtime in `init`):
```ts
declare module "fvtt-types/configuration" {
  interface DocumentClassConfig { Actor: typeof MyActor }
  interface DataModelConfig { Actor: { character: typeof CharacterData } }
  interface FlagConfig { Actor: { "my-system": { lastRoll?: number } } }
  interface SettingConfig { "my-system.theme": foundry.data.fields.StringField<{initial: "dark"}> }
  interface AssumeHookRan { ready: never }          // or use fvtt-types/lenient
}
```
- Caveats: types lag the API (check `node_modules/fvtt-types/src/foundry/client/...` when a call fails to type), you still must read the real source for behavior, and type errors do not mean runtime errors. Use `// @ts-expect-error` sparingly with a comment.

### 4.2 No TypeScript: use the typings Foundry ships
The app folder includes `tsconfig.json`, `client/tsconfig.json`, `common/tsconfig.json`, `client/global.d.mts` and `common/global.d.mts` (declares `game`, `canvas`, `ui`, `CONFIG`, `CONST`, `foundry`, `Handlebars`, `PIXI`, `ProseMirror`, `io`, `_loc`, `_del`, `_replace`, `getDocumentClass`, plus `Array/Set/Math/String` extensions). I tested a project `jsconfig.json` that includes them (TypeScript 5.6.3): completion and checking work for `game.*`, `foundry.*`, `CONFIG`, `CONST`. Setup:
```bash
ln -s "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app" ./foundry   # git-ignore this symlink
```
```jsonc
// jsconfig.json  (or tsconfig.json with allowJs)
{ "compilerOptions": {
    "target": "ESNext", "module": "NodeNext", "moduleResolution": "nodenext",
    "checkJs": false,                       // true would also type-check Foundry's own files and print ~16k errors
    "allowJs": true, "noEmit": true, "skipLibCheck": true,
    "lib": ["ES2023", "ESNext.Array", "ESNext.Collection", "ESNext.Iterator", "ESNext.Object", "ESNext.Promise", "DOM", "DOM.Iterable", "DOM.AsyncIterable"],
    "paths": { "@client/*": ["./foundry/client/*"], "@common/*": ["./foundry/common/*"] } },
  "include": ["*.mjs", "module/**/*.mjs", "*.d.mts", "foundry/client/global.d.mts", "foundry/common/global.d.mts"] }
```
- Opt files into checking with `// @ts-check` on the first line (global `checkJs:true` floods you with errors from Foundry's own files because they are pulled in via imports).
- Gaps found when testing: the shipped `global.d.mts` does **not** declare `Hooks`, `Roll`, `fromUuid`, `Actor`, `Item`, `ChatMessage`, ... (they exist at runtime) and `canvas.tokens`/layer shortcuts are untyped. Add your own `foundry-globals.d.mts`:
```ts
export {};
declare global {
  const Hooks: typeof foundry.helpers.Hooks;
  const Roll: typeof foundry.dice.Roll;
  const fromUuid: typeof foundry.utils.fromUuid;
  const fromUuidSync: typeof foundry.utils.fromUuidSync;
  const Actor: typeof foundry.documents.Actor;  type Actor = foundry.documents.Actor;
  const Item: typeof foundry.documents.Item;    type Item = foundry.documents.Item;
  const ChatMessage: typeof foundry.documents.ChatMessage;  type ChatMessage = foundry.documents.ChatMessage;
}
```
  (or write `const {Hooks} = foundry.helpers;` locally). `Math.clamped` still appears in the d.mts but was removed at runtime in v14.
- Annotate with JSDoc: `/** @type {foundry.documents.Actor} */`, `@param {foundry.applications.types.ApplicationRenderContext} context`, `@import {Actor} from ...` (see how Foundry's own files do it).

### 4.3 ESLint
Foundry no longer ships an ESLint config (v10 did). dnd5e and crucible use ESLint 10 flat config + `eslint-plugin-jsdoc` (+ `@stylistic`). Minimal `eslint.config.mjs`:
```js
import js from "@eslint/js";
import globals from "globals";
const foundryGlobals = Object.fromEntries([
  "foundry","game","canvas","ui","CONFIG","CONST","Hooks","Roll","fromUuid","fromUuidSync","getDocumentClass",
  "Color","Collection","Handlebars","PIXI","ProseMirror","io","$","jQuery","logger","vtt","animejs","_loc","_del","_replace",
  "Actor","ActorDelta","ActiveEffect","Adventure","AmbientLightDocument","AmbientSoundDocument","Card","Cards","ChatMessage",
  "Combat","Combatant","CombatantGroup","DrawingDocument","FogExploration","Folder","Item","JournalEntry","JournalEntryCategory",
  "JournalEntryPage","Level","Macro","NoteDocument","Playlist","PlaylistSound","RegionBehavior","RegionDocument","RollTable",
  "Scene","Setting","TableResult","TileDocument","TokenDocument","User","WallDocument"
].map(n => [n, "readonly"]));
export default [
  js.configs.recommended,
  { files: ["**/*.mjs"], languageOptions: { ecmaVersion: "latest", sourceType: "module",
      globals: { ...globals.browser, ...foundryGlobals } },
    rules: { "no-undef": "error", "no-unused-vars": ["warn", { args: "none" }], eqeqeq: ["warn", "smart"], "no-var": "warn" } }
];
```
Trick: **deliberately omit deprecated globals** (`renderTemplate`, `loadTemplates`, `FilePicker`, `Application`, `FormApplication`, `Dialog`, `ActorSheet`, `mergeObject`, `TextEditor`, `Die`, `Token`...) so `no-undef` flags legacy usage as an error. Add `no-restricted-syntax`/`no-restricted-properties` for `html.find(`, `.data.data`, `game.template`. The skill's `fvtt-lint.mjs` already reads deprecated globals from the installed Foundry.

---

## 5. Debugging

### 5.1 `CONFIG.debug` flags
Set at runtime (console or your `init` hook); all default `false`. Verified usages in v14 source:
| Flag | Effect |
|---|---|
| `CONFIG.debug.hooks` | Logs every `Hooks.on/off` registration and every `Hooks.call/callAll` with its arguments (very noisy). Find hook names/args fast |
| `CONFIG.debug.applications` | Debug text on ApplicationV2 lifecycle (`_doEvent` before/after render etc.) |
| `CONFIG.debug.documents` | Logs every client-side Document create/update/delete operation (`client-backend`), ActorDelta materialization |
| `CONFIG.debug.dice` / `.rollParsing` | Logs roll evaluation / parser steps |
| `CONFIG.debug.combat` | Combat enter/exit/round/turn transitions |
| `CONFIG.debug.i18n` | `console.error` when `localize` finds no key (only for ids matching the string-id pattern, i.e. `PREFIX.Key`) |
| `CONFIG.debug.queries` | User-query traffic (`User.query`) |
| `CONFIG.debug.time` | Server-time sync and world-time changes |
| `CONFIG.debug.keybindings`, `.gamepad`, `.mouseInteraction` | Input pipeline traces |
| `CONFIG.debug.polygons` | Draws debug geometry for `PointSourcePolygon` computations |
| `CONFIG.debug.fog.{manager,extractor}`, `.canvas.primary.bounds`, `.loader.{load,cache,eviction,memory}`, `.audio`, `.av`, `.avclient` | Canvas/texture-loader/audio/AV debugging |
Use `CONFIG.debug.hooks = true` in the console, trigger the action, filter the console by the hook name.

### 5.2 `CONFIG.compatibility`
Controls deprecation noise (full semantics in version-migration.md section 4):
```js
CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.FAILURE; // 0 SILENT, 1 WARNING (default), 2 ERROR, 3 FAILURE (throws)
CONFIG.compatibility.includePatterns.push(/\/systems\/my-system\//);   // regexes tested on message + stack
CONFIG.compatibility.excludePatterns.push(/\/modules\/other\//);       // excludes win
```
Make deprecation warnings **throw** while developing: `mode = FAILURE` plus an include pattern for your package path, set as early as possible (top of your esmodule or an `init` hook).

### 5.3 Console one-liners
```js
game.actors.getName("Hero")                       // Collection#getName; also game.items, game.scenes, game.users
canvas.tokens.controlled[0]?.actor                // first controlled token's actor
_token                                            // debug global: last Token whose rendering was initialised
await fromUuid("Actor.<id>.Item.<id>"); fromUuidSync("Compendium.sys.pack.Item.<id>")
foundry.utils.getProperty(actor, "system.attributes.hp.value"); foundry.utils.setProperty(obj, "a.b", 1)
foundry.utils.flattenObject(actor.system); foundry.utils.diffObject(a, b); foundry.utils.mergeObject(a, b, {inplace:false})
game.release                                      // {generation, build, channel, version}; game.version, game.system.id/version
game.modules.get("my-module")?.active; [...game.modules].filter(m => m.active).map(m => m.id)
game.data                                         // raw startup payload from the server (Object.keys(game.data) to explore)
game.settings.get("core", "rollMode"); game.settings.settings.keys()
game.user.isGM; game.users.activeGM; game.paused; game.combat?.round
CONFIG.Actor.dataModels; CONFIG.Actor.documentClass; Object.keys(CONFIG)
Hooks.events.updateActor?.length                  // registered listeners for a hook (Hooks.events is the registry)
[...foundry.applications.instances.keys()]        // open ApplicationV2 ids, e.g. "ActorSheetV2-Actor-<id>"; DocumentSheetV2 ids are `${className}-${uuid with dots -> dashes}`
foundry.applications.instances.get("MySheet-Actor-AbC").render({force: true})
actor.sheet; actor.toObject(); actor._source; item.getRollData(); actor.system.constructor.schema.fields  // data model schema
actor.constructor.metadata; foundry.documents.BaseActor.defineSchema()   // document schema fields
await Actor.create({name: "T", type: "character"}); await game.actors.getName("T").delete()
ui.notifications.info("x")
$0                                                // Chrome: selected element; use e.closest(".application") then foundry.applications.instances.get(el.id)
```
Tips: the browser console runs in the page realm, so `foundry`, `game`, etc. are directly available; `Object.getOwnPropertyDescriptor`/`console.table(game.actors.contents.map(a => a.toObject()))` help. Set breakpoints in your own modules (Sources panel); core code is in the bundle `scripts/foundry.mjs`, so read core in `client/` and use "Pause on exceptions" for core throws.

### 5.4 Logs, hot reload, safe mode
- Server logs (winston): `<UserData>/Logs/debug.<date>.log` and `error.<date>.log` (JSON lines); console mirror when running via Node. Rotation `--logsize` (default `10m`) and `--maxlogs` (default 5). Client errors only exist in the browser console (or the harness JSON).
- **Hot reload**: start with `--hotReload` (or `"hotReload": true` in options.json) and declare in your manifest:
```json
"flags": { "hotReload": { "extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"] } }
```
  `extensions` is required (the server says "Hot Reload disabled for X because it has no extensions defined" otherwise; the KB example omits it); `paths` are package-relative (default: whole package). The server watches with chokidar and emits a socket event; the client handles only **css** (cache-busts the `<link>`/`@import`), **html/hbs** (recompiles the template, re-registers partials, re-renders every open app) and **json** (only a language file of the *current* language: merges translations, re-renders open apps); `.js/.mjs` is never hot-reloaded - reload the tab. Hook `hotReload(data)` fires first; return `false` to take over handling (data has `packageType, packageId, path, extension, content`). Only the active system and *active* modules are watched. v14 reduced the scope of hot reload relative to v12.
- **Safe configuration**: Setup -> world menu -> "Launch in safe configuration" disables all modules for that launch (KB `launch-safe-configuration`); also automatic when a major generation upgrade first loads a world.
- Package diagnostics: Setup shows package warnings (bad `compatibility`, `template.json`, missing relationships); `Logs/diagnostics.json` is written by the support report.

---

## 6. Running Foundry as a Node.js server

### 6.1 Requirements and launch
- Node.js: **v14 requires >= 24** (`package.json`: `release.node_version: 24`, `engines >=24.13.1 <25`; `main.mjs` itself only checks the major >= 24). KB: Node 22 for v13 and older, odd-numbered Node majors are not LTS. A newer major than the engines range (e.g. Node 26) passes the runtime check.
- Download the "Node.js" build from the website (v13+ has a separate Node zip; older used the Linux build and `node resources/app/main.js`). Unzip; the folder contains `main.js`, `main.mjs`, `client/`, `common/`, `dist/`, `public/`, `templates/`, `node_modules/`. Electron desktop builds contain the same tree under `resources/app/` (`node main.js` works there too, which is how the macOS app on this machine can be run by Node).
```bash
mkdir -p ~/foundrydata                       # parent must exist; must NOT be inside the app folder
node main.js --dataPath="$HOME/foundrydata" --port=30000 --world=my-world --noupnp --noupdate
# open http://localhost:30000 ; first run: license screen -> setup screen
```
There is **no `--headless` flag**: running via Node *is* headless (no Electron window). Stop with SIGINT/SIGTERM/SIGHUP (all exit cleanly and remove UPnP mappings). Keep it alive with systemd (recommended for one instance) or PM2; behind nginx/Caddy set `proxySSL`/`proxyPort`/`routePrefix` (KB nginx, apache, caddy, ssl).

### 6.2 Command-line flags (verified from source)
Parsing (`dist/init.mjs: parseArgs`): any argv element starting with `--` becomes `args[name] = value` (text after the first `=`, split on `=`, so a value containing `=` is truncated) or `true` when no `=`. Flags override `options.json`. Mapped flags (`dist/core/config.mjs`, `dist/paths.mjs`, `dist/logging.mjs`):
| Flag | Effect |
|---|---|
| `--dataPath=<dir>` | User Data root (contains `Data/`, `Config/`, `Logs/`). **Must use `=` form** (`paths.mjs` reads `argv.find(startsWith("--dataPath")).split("=")[1]`). Parent directory must exist; path may not be inside the app directory |
| `--port=<n>` | Listen port (allowed: 80, 443, or 1024-65535); overrides options.json (default 30000) |
| `--world=<id>` | Auto-launch this world id at startup. Skipped with a warning if the world can't auto-launch (system missing/incompatible) and skipped entirely while the license still `needsSignature` |
| `--noupnp` | Disable UPnP port mapping (`upnp: false`) |
| `--noupdate` | Don't check for core software updates |
| `--noipdiscovery` | Don't call the external-IP discovery service (`FOUNDRY_IP_SERVICE` env overrides its URL) |
| `--nobackups` | Disable automatic world/package backups (`noBackups`) |
| `--hotReload` | Enable the hot-reload file watcher (section 5.4) |
| `--fullscreen` | Electron only |
| `--tempDir=<dir>` | Directory for downloaded package zips (small-quota hosts) |
| `--adminPassword=<pw>` | Sets the admin access key **only if none is set yet** (ignored otherwise); stored hashed in `Config/admin.txt`. Old `--adminKey` still maps to it with a log warning. Passwords containing `=` are truncated |
| `--demo` / `--demo=<file.json>` | Demo mode (world auto-reset). File: `{worldName, sourceZip, resetSeconds}`; or `demo` key in options.json |
| `--serviceKey=<key>` | Hosting-provider mode; requires `serviceConfig` in options.json |
| `--logsize=<size>` | Rotate logs at this size (`1024k`, `64m`, `1g`; default `10m`) |
| `--maxlogs=<n>` | Keep this many rotated logs (default 5) |
| `--debug` | Only effective when a `server/` source dir exists next to `dist/` (Foundry staff builds); ignore |
Environment variables: `FOUNDRY_VTT_DATA_PATH` (data path, below), `FOUNDRY_IP_SERVICE`, `FOUNDRY_PACKAGE_INDEX_URL`, `FOUNDRY_PACKAGE_DETAILS_URL`, `FOUNDRY_PACKAGE_OWNED_URL`, `FOUNDRY_ACME_DIRECTORY` (certificate manager), plus standard `NODE_ENV`. There is no env var for the license key or admin password.

### 6.3 `options.json` keys
Lives at `<UserData>/Config/options.json`; schema = `ServerSettings` in `common/config.mjs` (unknown keys are dropped on save; malformed JSON prevents startup; flags override these):
| Key | Type / default | Notes |
|---|---|---|
| `port` | int, 30000 | 80, 443 or 1024-65535 |
| `unixSocket` | string/null | absolute path; alternative to port |
| `hostname`, `localHostname` | string/null | public / LAN hostname shown in invitation links |
| `routePrefix` | string/null | serve under `/prefix/` |
| `protocol` | 4 or 6/null | IP version |
| `proxySSL`, `proxyPort` | bool / int | behind a TLS-terminating reverse proxy |
| `sslCert`, `sslKey` | path/null | both set -> HTTPS directly (relative to `Config/`) |
| `upnp`, `upnpLeaseDuration` | bool true / number | |
| `dataPath` | string | rewritten to the actual user data path; flag/env take precedence |
| `world` | string/null | auto-launch world id |
| `language` | `"en.core"` | default UI language |
| `cssTheme` | `dark` (default), `fantasy`, `scifi` | login/setup theme (`CONST.CSS_THEMES`); old value `foundry` migrates to `dark` |
| `compressStatic`, `compressSocket` | bool true | |
| `updateChannel` | `stable` (`prototype`/`development`/`testing`) | |
| `hotReload`, `fullscreen`, `noBackups` | bool | CLI equivalents |
| `awsConfig` | path/null | S3 credentials JSON (`accessKeyId`, `secretAccessKey`, `region`) |
| `tempDir`, `deleteNEDB`, `telemetry`, `passwordSalt` | misc | `passwordSalt` salts `admin.txt`; do not edit |
| `adminUsername`, `externalAdminAuth` | v14 | external admin authentication (needs admin user+password and a Unix socket or TLS cert/key) |
| `demo`, `serviceConfig` | object / path | demo mode, provider mode |
`adminPassword` is never written to options.json.

### 6.4 Data path, license, admin password
- **User Data path resolution** (`dist/paths.mjs`, first valid wins): `--dataPath` flag -> env `FOUNDRY_VTT_DATA_PATH` -> `dataPath` in the default OS location's `Config/options.json` -> default OS location (macOS `~/Library/Application Support/FoundryVTT`, Windows `%LOCALAPPDATA%\FoundryVTT`, Linux `${XDG_DATA_HOME:-~/.local/share}/FoundryVTT`; portable Windows builds use the sibling folder). Layout created on first run: `Config/` (options.json, license.json, admin.txt, package-index.json, `options.json.lock`), `Data/{systems,modules,worlds,assets}` (+README.txt in each), `Logs/`, `Backups/`.
- **Lock**: `Config/options.json` is locked by a running server (`proper-lockfile`, stale 10 s). A second server on the same data path fails with "cannot start in this directory which is already locked by another process" -> use a separate `--dataPath` (and port) per instance.
- **License**: `Config/license.json` = `{host, license, version, time, signature}`. `license` is the 24-character key (dashes ignored); `signature` is issued by foundryvtt.com (outbound HTTPS needed once) and is bound to `host`, which is the machine hostname - copying license.json to another machine works only if the hostname matches (set a fixed hostname in containers); the EULA version (`11.293`) must also be current. On first launch with no valid license the server serves `/license` (enter key, accept EULA) and does **not** auto-launch `--world`. Never print or commit license.json.
- **Admin password**: set in Setup (Configuration) or via `--adminPassword` on first start; hash stored in `Config/admin.txt`. Forgot it: stop the server and delete `Config/admin.txt` (KB `reset-admin-password`). Per-world user passwords are separate (KB `reset-user-passwords`).
- **Health check**: unauthenticated `GET /api/status` -> `{"active":false,"version":"14.369"}` before a world launches, plus `world, system, systemVersion, users, uptime` after. Other routes: `/setup`, `/join`, `/game`, `/license`, `/auth`, `/players`, `/stream`, `/update`.
- For the sandboxed, auto-launching harness used by this skill see testing.md (`fvtt-server.mjs start --link ...`; it passes `--noupnp --noupdate --nobackups --hotReload`, a sandbox `--dataPath`, and a non-default port).

---

## 7. Automated testing

Layers (cheapest first): lint (`fvtt-lint.mjs`) -> server boot -> browser smoke -> targeted `eval` checks (all in testing.md) -> in-Foundry unit tests (Quench) -> your own Playwright suites.

### 7.1 Pure-logic unit tests (Node, no Foundry)
Keep rules code (dice math, derived stats) in plain functions/modules that take data and return data; test with Vitest/Jest/`node:test` under Node with no Foundry globals. Classes extending `TypeDataModel`/`Document` need Foundry's runtime, so test those in-browser (7.2/7.3). Don't mock `foundry.*` extensively - the mock drifts from the real API.

### 7.2 Quench (in-Foundry Mocha + Chai)
Community module `quench` (https://github.com/Ethaks/FVTT-Quench, API docs https://ethaks.github.io/FVTT-Quench/). Latest release 0.10.0 (2025-04-30): `compatibility {minimum: "13.341", verified: "13"}`, so it is **not verified on v14** (installs with a warning; test it). Mocha + Chai + fast-check; ApplicationV2 results UI; adds a sidebar button.
```js
Hooks.on("quenchReady", quench => {
  quench.registerBatch("my-system.data", ctx => {
    const { describe, it, assert, expect, before, after } = ctx;
    describe("Character derived data", () => {
      let actor;
      before(async () => { actor = await Actor.create({ name: "Q", type: "character", system: { abilities: { str: { value: 16 } } } }); });
      after(async () => { await actor.delete(); });
      it("computes modifiers", () => assert.equal(actor.system.abilities.str.mod, 3));
    });
  }, { displayName: "My System: data", preSelected: true });
});
// run from console / CI:  await quench.runBatches("**");  or  quench.runBatches(["my-system.data"], {json: true})
Hooks.on("quenchReports", ({ json }) => { /* JSON report string (Mocha format) */ });
```
`quench` global exists after `init`; `quenchReady` fires in `setup`; `runBatches({json:true})` uploads `Data/quench-report.json`; snapshots under `Data/__snapshots__/<package>/` (alpha). Types: `npm i -D @ethaks/fvtt-quench` and add to `tsconfig` `types`. Quench batches live in your package (guard with `if (game.modules.get("quench")?.active)`), so ship them in a `tests/` module file loaded only in dev.

### 7.3 Playwright / Puppeteer end-to-end against a running server
No community standard exists (a 1-star `scooper4711/foundry-test-kit` is the only dedicated project I found); the skill's `fvtt-browser.mjs` already does this. If you write your own:
1. Start Foundry: `node main.js --dataPath=<tmp> --port=30001 --world=<id> --noupnp --noupdate --nobackups` (license pre-copied; poll `GET /api/status` until `active:true`).
2. Launch Chromium **with software WebGL** or the canvas fails: args `--use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist --autoplay-policy=no-user-gesture-required`.
3. Log in (selectors verified in `templates/setup/parts/join-form.hbs`):
```js
await page.goto("http://localhost:30001/join");
await page.selectOption('form[name="join"] select[name="userId"]', { label: "Gamemaster" });
// password: input[name="password"] (empty for a fresh world GM); submit: button[name="join"]
await page.click('form[name="join"] button[name="join"]');
await page.waitForURL(/\/game$/);
await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: 120_000 });
await page.evaluate(() => { foundry.nue.Tour.activeTour?.exit(); ui.notifications.clear(); });
const result = await page.evaluate(async () => { /* run package code, return plain data */ });
```
4. Collect `page.on("pageerror")` and `console` errors; treat Foundry deprecation warnings as failures in CI (`CONFIG.compatibility.mode = CONST.COMPATIBILITY_MODES.ERROR` via `page.evaluate`).
5. One session per user: a second login as the same user fails until the first socket closes.
6. For sheets use `foundry.applications.instances`/`sheet.render({force:true})` and element screenshots rather than full-page snapshots (the canvas page is heavy).
Run against both a v13 and a v14 install if you support both (set the app path per job).
