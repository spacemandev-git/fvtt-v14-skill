---
name: foundry-vtt-dev
description: Build, port, debug and test Foundry Virtual Tabletop (FVTT) game systems and modules against the current v13/v14 API. Covers system.json/module.json manifests, TypeDataModels, Documents, ApplicationV2/HandlebarsApplicationMixin sheets and dialogs, hooks, settings, sockets, rolls/chat/combat, canvas, compendium packs, localization and publishing. Ships a scaffolder, a version-aware linter that flags obsolete Foundry APIs, a lookup tool over the installed Foundry source, and a harness that runs Foundry headless on Node.js and logs in through a browser (Playwright, or any browser/computer-use tool) to smoke-test sheets and code. Use it whenever the user mentions Foundry, FoundryVTT, FVTT, a VTT game system or module, actor/item sheets, system.json/module.json, or wants to write, upgrade (v9-v12 to v13/v14), fix or test Foundry code, even if they don't name a specific API.
---

# Foundry VTT Development

Foundry's API changed a lot between v9 and v14: `template.json` became DataModels, `Application` became `ApplicationV2`,
jQuery became HTMLElement, and most globals moved into the `foundry.*` namespaces. Most Foundry code on the internet,
and most of what a model remembers, is the old style. That code fails outright on current Foundry or prints
deprecation warnings that become errors in the next version. This skill keeps you on the current API by checking
against the **installed Foundry source** and then testing in a real Foundry server.

## Start every task here

The commands below use `S` for this skill's `scripts/` folder. If the skill is installed somewhere else, use its base
directory instead.
```bash
S=~/.claude/skills/foundry-vtt-dev/scripts
```

1. **Find the installed version and its source:** `node $S/fvtt-api.mjs where`. Foundry ships
   unminified ES modules in `<app>/client` and `<app>/common`. That code is the ground truth for every signature, option
   name and hook. The online API docs at https://foundryvtt.com/api/ track the current release.
2. **Find the target versions.** Read the package manifest's `compatibility` (`minimum`/`verified`). Default new work to
   `minimum: "13"`, `verified: "<installed generation>"`. Supporting several generations is covered in
   `references/version-migration.md`.
3. **Read the reference for the area you're touching** (map below) before writing code. They're distilled from the
   official docs and checked against v14 source. Each has a table of contents, so jump to the section you need.
4. **Write modern code.** Use the cheat sheet below, and follow the scaffold templates' idioms.
5. **Verify** (see Testing): run lint, boot the server, smoke-test it, then check the specific behaviour you built.
   If Foundry is installed, don't report work as done until it boots and the smoke test passes with no errors from
   your package.

When you're unsure whether an API exists or what its options are, don't guess. Look it up:
```bash
node $S/fvtt-api.mjs find ActorSheetV2            # where a class/function/method is defined
node $S/fvtt-api.mjs exports foundry.applications.api
node $S/fvtt-api.mjs hooks render                 # every hook name the client fires, with file:line
node $S/fvtt-api.mjs deprecations ActiveEffect    # what's deprecated, since/until which version
node $S/fvtt-api.mjs grep "registerMenu" client/helpers
```
Then read the file it points to. Core sheets (`client/applications/sheets/`) and their templates (`<app>/templates/`)
are the best examples of idiomatic v14 code. When in doubt, imitate them.

## Reference map

| Working on | Read |
|---|---|
| Manifest fields, folder layout, packs (LevelDB, foundryvtt-cli), relationships, publishing | `references/manifest-and-packaging.md` |
| Localization (`lang/*.json`, i18nInit, LOCALIZATION_PREFIXES), CSS layers, themes | `references/localization-and-styles.md` |
| `system` data: TypeDataModel, `defineSchema`, fields, derived data, `migrateData` | `references/data-models.md` |
| Documents: CRUD, embedded docs, flags, ownership, ActiveEffects, tokens vs actors, migrations | `references/documents.md` |
| Sheets, dialogs, any UI: ApplicationV2, PARTS, actions, tabs, forms, drag/drop, Handlebars | `references/applications-v2.md` |
| Init sequence, hooks, CONFIG, `game`, settings, keybindings, sockets/queries, enrichers, libWrapper | `references/hooks-config-settings.md` |
| Rolls, dice terms, chat messages and cards, roll modes, combat and initiative | `references/dice-chat-combat.md` |
| Tokens, layers, scene controls, regions, measuring, templates | `references/canvas.md` |
| Upgrading old code; what changed in v12/v13/v14; supporting several versions | `references/version-migration.md` |
| Build tools, TypeScript types, ESLint, foundryvtt-cli, debugging, server CLI flags | `references/tooling.md` |
| Which official doc/KB page or API URL answers a question; map of the source tree | `references/docs-index.md` |
| Headless server, browser automation, interactive/computer-use testing, troubleshooting | `references/testing.md` |

## Scripts

| Script | Purpose |
|---|---|
| `scripts/scaffold.mjs <system\|module> <id> [--title T] [--dest dir] [--author A]` | Generate a working v13/v14 package from `assets/templates/` (DataModels, V2 sheets, lang, CSS, hot reload). |
| `scripts/fvtt-lint.mjs <pkgDir>` | Static checks: manifest, files, syntax, imports, obsolete and deprecated APIs (read from the installed Foundry), Handlebars compile, lang keys. |
| `scripts/fvtt-api.mjs <where\|find\|exports\|hooks\|deprecations\|grep>` | Query the installed Foundry source. |
| `scripts/fvtt-server.mjs <start\|stop\|status\|logs\|info>` | Sandboxed headless Foundry on Node.js with your package symlinked in and a test world auto-launched. |
| `scripts/fvtt-browser.mjs <smoke\|eval\|screenshot\|enable-modules>` | Playwright: log in as Gamemaster, capture errors and deprecations, render every sheet, run JS in the game. |

## Where packages live

The package folder name must equal the manifest `id`.

| OS | User data `Data/` folder |
|---|---|
| macOS | `~/Library/Application Support/FoundryVTT/Data/{systems,modules,worlds}` |
| Linux | `~/.local/share/FoundryVTT/Data/...` |
| Windows | `%LOCALAPPDATA%\FoundryVTT\Data\...` |

`Config/options.json` → `dataPath` can relocate this. For development, keep the repo anywhere and symlink it
(`ln -s ~/code/my-system "<Data>/systems/my-system"`), or let `fvtt-server.mjs --link` symlink it into the sandbox.
Never let Foundry "update" a symlinked dev package: an update deletes the folder.

## Modern idioms cheat sheet

| Obsolete (don't write) | Current (v13/v14) |
|---|---|
| `template.json` for Actor/Item data | `documentTypes` in system.json + `class X extends foundry.abstract.TypeDataModel` registered in `CONFIG.Actor.dataModels[type]` (template.json is deprecated, removed in v16) |
| `actor.data.data.hp` / `getData()` returning `data` | `actor.system.hp`; derived values in `prepareDerivedData()` of the data model |
| `name`, `minimumCoreVersion`, `author`, `dependencies` in manifest | `id`, `compatibility: {minimum, verified}`, `authors: [...]`, `relationships: {requires: [...]}` |
| `class S extends ActorSheet` + `defaultOptions` + `getData` + `activateListeners(html)` | `class S extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)` + `static DEFAULT_OPTIONS` + `static PARTS` + `_prepareContext()` + `actions` / `_onRender()` |
| `Actors.registerSheet(...)` / `Items.unregisterSheet` | `foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "my-sys", MySheet, {types, makeDefault: true, label})` |
| `new Dialog({buttons})` / `Dialog.confirm` | `foundry.applications.api.DialogV2.wait/confirm/prompt/input` |
| `FormApplication` + `_updateObject` | `ApplicationV2` with `tag: "form"`, `form: {handler, submitOnChange, closeOnSubmit}` |
| `html.find(".x").click(...)` (jQuery) | `this.element.querySelector(".x")`, `data-action="x"` + `static async #onX(event, target)` |
| `Hooks.on("renderChatMessage", (m, html) => html.find(...))` | `Hooks.on("renderChatMessageHTML", (message, html) => html.querySelector(...))` |
| `renderTemplate`, `loadTemplates`, `getTemplate` globals | `foundry.applications.handlebars.renderTemplate/loadTemplates/getTemplate` |
| `mergeObject`, `duplicate`, `getProperty`, `randomID` globals (removed) | `foundry.utils.mergeObject/deepClone/getProperty/randomID` |
| `TextEditor.enrichHTML(html, {async: true})` global | `await foundry.applications.ux.TextEditor.implementation.enrichHTML(html, {secrets: doc.isOwner, rollData, relativeTo: doc})` (always async now) |
| `roll.roll()`, `evaluate({async: false})` | `await roll.evaluate()` (or `roll.evaluateSync()` only for deterministic formulas) |
| `ChatMessage.create({type: CONST.CHAT_MESSAGE_TYPES.ROLL, roll})` | `roll.toMessage({speaker, flavor})`, or `ChatMessage.create({rolls: [roll], ...})` |
| `toMessage(data, {rollMode})`, `CONST.DICE_ROLL_MODES`, `CONFIG.Dice.rollModes` (v14 deprecations) | v14: `toMessage(data, {messageMode: "public"\|"gm"\|"blind"\|"self"\|"ic"})`, keys of `CONFIG.ChatMessage.modes`. Omitting it uses the user's current mode. If you also support v13, omit it or branch on `game.release.generation` |
| `CONFIG.Actor.entityClass`, `game.system.data` | `CONFIG.Actor.documentClass`, `game.system` |
| Global canvas/UI classes (`Token`, `Tile`, `FilePicker`, `ContextMenu`...) | Namespaced: `foundry.canvas.placeables.Token`, `foundry.applications.apps.FilePicker.implementation`, `foundry.applications.ux.ContextMenu.implementation`; check with `fvtt-api.mjs find` |
| `update({"system.-=key": null})`, `{"==key": v}` (deprecated in v14) | v14: `update({"system.key": _del})`, `{key: _replace(v)}` (globals; or `foundry.data.operators.ForcedDeletion/ForcedReplacement`). v13 only knows `-=`, so branch on `game.release.generation` if you support both |
| `effect.changes` with numeric `mode` (v14 rewrite) | v14 ActiveEffect changes live in `effect.system.changes` with string `type` and `phase`; legacy `changes` is migrated. Read `references/documents.md` §ActiveEffects before touching effects |
| Context menu entries `{name, icon, callback, condition}` (deprecated in v14) | v14: `{label, icon, onClick: (event, target) => ..., visible}`; v13 only knows the old keys |
| NeDB `packs/x.db` | LevelDB pack folders built from JSON/YAML sources with `@foundryvtt/foundryvtt-cli` |

`fvtt-lint.mjs` flags all of these automatically, plus every global the installed Foundry has deprecated.

## Workflows

### New system or module
1. `node $S/scaffold.mjs system my-system --title "My System" --dest ~/code/my-system`. The output boots on
   v13/v14 and is meant to be extended, not replaced: it already wires DataModels → documents → V2 sheets → lang → CSS.
2. Model the game's data first (`module/data/*.mjs`), then documents (roll helpers, `getRollData`), then sheets and
   templates, then hooks/settings/chat.
3. After each meaningful step: lint → `fvtt-server.mjs start --link ~/code/my-system --fresh-world` →
   `fvtt-browser.mjs smoke`.

### Porting an old package to v13/v14
1. Run `fvtt-lint.mjs <pkg>`. Its output is the inventory of what must change.
2. Fix it in this order, because each layer depends on the one before:
   1. **Manifest** keys.
   2. **Data**: template.json → `documentTypes` + TypeDataModels. Keep field names identical so existing world data
      still fits, or convert the old shapes in `static migrateData(source)`.
   3. **Document** subclasses.
   4. **Sheets/apps**: V1 → ApplicationV2 (templates usually need restructuring into PARTS).
   5. **Dialogs** → DialogV2.
   6. **Hooks**: jQuery → HTMLElement.
   7. **Rolls/chat**, then namespaced **globals**.
3. Boot an existing world copy only after the data layer is right. For a fresh check use `--fresh-world` and create
   documents through `eval`.
4. See `references/version-migration.md` for per-version breaking changes.

### Debugging a runtime problem
Reproduce it in the sandbox: start the server, then use `fvtt-browser.mjs eval` to run the failing code path and read
`pageErrors`/`errors` (they include stacks). Check `fvtt-server.mjs logs` for server-side validation errors such as
`DataModelValidationError` and migration failures. Then find the code involved with `fvtt-api.mjs find/grep` and read it.

## Core rules that prevent most bugs

- **Data lives in `doc.system`; derived data is never saved.** Compute it in `prepareDerivedData()`. Persist changes
  with `await doc.update({"system.hp.value": 5})`. Don't assign to `doc.system.x` and expect it to save.
- **Every database operation is async.** Await `create/update/delete`, `roll.evaluate()`, `renderTemplate`, and
  `enrichHTML`.
- **Side effects run once, on the client that caused them.** Database hooks and `_onCreate/_onUpdate` fire on
  every connected client. Guard with `if (game.user.id !== userId) return;`, or use `game.user.isActiveGM`
  for work exactly one GM should do.
- **Register in the right hook.** In `init`: CONFIG, document classes, data models, sheets, settings, Handlebars
  helpers/partials, keybindings, enrichers. In `i18nInit`: anything that needs translations. In `ready`:
  anything that reads world data or `game.user`, and migrations.
- **Use full template paths:** `systems/<id>/templates/actor/sheet.hbs` (or `modules/<id>/...`). They're
  case-sensitive on Linux servers.
- **Namespace everything:** flags (`doc.getFlag("my-id", key)`), settings (`game.settings.register("my-id", ...)`),
  CSS (scope rules under your sheet/app classes), socket event names (`system.my-id`/`module.my-id`).
- **Render hooks and V2 apps give you `HTMLElement`, not jQuery.** In V2 apps, `actions` handlers are static
  functions called with `this` bound to the app instance.
- **Localize user-facing strings** (`game.i18n.localize/format`, `{{localize}}`) and add the keys to `lang/en.json`.
  Document type labels use `TYPES.Actor.<type>` / `TYPES.Item.<type>`.

## Testing

Full guide: `references/testing.md`. The short version:

```bash
node $S/fvtt-lint.mjs ./my-system
node $S/fvtt-server.mjs start --link ./my-system --fresh-world   # sandboxed, headless, port 30001
node $S/fvtt-browser.mjs smoke --shots /tmp/fvtt-shots          # login, every sheet renders, zero errors
node $S/fvtt-browser.mjs eval --code "return game.actors.size"  # targeted checks (async JS in the page)
node $S/fvtt-server.mjs stop
```

- The server runs from a sandbox data path (`~/.cache/foundry-vtt-dev/sandbox`) and copies the user's license, so
  it never touches real worlds and can run next to the desktop app. It needs Node.js at or above the version in
  Foundry's `package.json` (`release.node_version`).
- Look at the `--shots` PNGs (Read the image files) to check layout. Smoke-test success means "renders without
  errors", not "looks right".
- **Interactive / computer-use testing:** after `start`, open the printed `joinUrl` in whatever browser control you
  have (Claude in Chrome, the computer-use tool, an in-app browser preview, or `fvtt-browser.mjs --headed`). Select
  **Gamemaster**, leave the password empty, and click **Join Game Session**. Prefer evaluating JS and screenshotting
  elements over full-page snapshots, because the game page is heavy. Close that tab before running the scripted
  commands, since a user can only be logged in once.
- If Foundry isn't installed, say so, still run `fvtt-lint.mjs` (its non-version checks work), and tell the user how
  to run the harness once Foundry is available.
