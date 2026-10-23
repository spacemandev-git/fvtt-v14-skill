# Testing & Verifying Foundry Packages

How to prove a system or module actually works: static checks, a sandboxed headless Foundry server, automated
browser runs (Playwright), and interactive "computer use" style testing through whatever browser tool you have.

## Contents
1. [The verification ladder](#1-the-verification-ladder)
2. [Static checks: fvtt-lint.mjs](#2-static-checks-fvtt-lintmjs)
3. [Headless server: fvtt-server.mjs](#3-headless-server-fvtt-servermjs)
4. [Automated browser: fvtt-browser.mjs](#4-automated-browser-fvtt-browsermjs)
5. [Interactive testing with a browser tool / computer use](#5-interactive-testing-with-a-browser-tool--computer-use)
6. [Writing package-specific checks with eval](#6-writing-package-specific-checks-with-eval)
7. [Testing modules](#7-testing-modules)
8. [In-Foundry unit tests (Quench)](#8-in-foundry-unit-tests-quench)
9. [Troubleshooting](#9-troubleshooting)

All scripts live in `scripts/` of this skill (`~/.claude/skills/foundry-vtt-dev/scripts/`). They need Node.js only;
the browser script installs Playwright into `~/.cache/foundry-vtt-dev` on first use.

---

## 1. The verification ladder

Run the cheapest check that can catch the bug, then climb:

| Step | Command | Catches | Cost |
|---|---|---|---|
| Lint | `node fvtt-lint.mjs <pkgDir>` | bad manifest, missing files, syntax errors, broken imports, obsolete/deprecated API, template compile errors, missing lang keys | ~1 s |
| Boot | `node fvtt-server.mjs start --link <pkgDir>` | manifest rejected by the server, world fails to launch, data-model/migration errors at launch | ~2-5 s |
| Smoke | `node fvtt-browser.mjs smoke --shots /tmp/shots` | client errors in `init`/`ready`, every Actor/Item subtype can be created and its sheet renders without errors | ~20-40 s |
| Targeted | `node fvtt-browser.mjs eval --file check.js` | the specific behaviour you just built (derived data, rolls, chat cards, hooks) | ~15 s |
| Visual | look at `--shots` PNGs, or drive the UI interactively (§5) | layout/CSS problems, UX flow | minutes |

A change is not "done" until at least lint + boot + smoke pass with **zero page errors and zero console errors**
from your package. Treat new deprecation warnings that come from your code as bugs too: they become hard errors in a
later version.

## 2. Static checks: fvtt-lint.mjs

```bash
node ~/.claude/skills/foundry-vtt-dev/scripts/fvtt-lint.mjs path/to/my-system          # human-readable
node ~/.claude/skills/foundry-vtt-dev/scripts/fvtt-lint.mjs path/to/my-system --json   # machine-readable
```

- The deprecated-globals rule is generated from the **installed** Foundry (`client/client.mjs` backwards-compatibility
  table), so it stays correct as Foundry versions change. Example: `Global "renderTemplate" is deprecated since v13
  (removed in v15). Use foundry.applications.handlebars.renderTemplate.`
- Vendored code (`lib/`, `vendor/`, `dist/`, `*-dist/`, `*.min.js`, files > 400 KB) is skipped; add `--all-files` to
  include it (useful for checking a bundled `system.js` output).
- Exit code 1 means errors. Fix every error; fix warnings in code you own.
- It can't see runtime problems: that's what boot + smoke are for.

## 3. Headless server: fvtt-server.mjs

```bash
S=~/.claude/skills/foundry-vtt-dev/scripts
node $S/fvtt-server.mjs info                                   # detected app path, node, real data path
node $S/fvtt-server.mjs start --link ./my-system               # create + launch world "fvtt-dev-test" on port 30001
node $S/fvtt-server.mjs start --link ./my-module --link-installed dnd5e --system dnd5e   # module test
node $S/fvtt-server.mjs status                                 # JSON incl. /api/status (active world, users)
node $S/fvtt-server.mjs logs --lines 100                       # server stdout (Foundry's server log)
node $S/fvtt-server.mjs logs --errors                          # Foundry's error.<date>.log
node $S/fvtt-server.mjs stop
```

What it does:
- Finds the Foundry app (macOS `.app/Contents/Resources/app`, Linux/Windows install dirs, or the Node.js zip;
  override with `FOUNDRY_APP_PATH`) and a Node.js binary that satisfies `package.json → release.node_version`
  (override with `FOUNDRY_NODE`). It runs `node main.mjs`, so there is **no Electron window**: it's a plain Node server.
- Uses a **sandbox data path** (`~/.cache/foundry-vtt-dev/sandbox` by default, `--sandbox <dir>` to change). The
  user's real worlds are never touched, and it can run alongside the desktop app: Foundry locks the *data path*, so a
  separate sandbox and port (default 30001) avoid conflicts.
- Copies `Config/license.json` from the real data path into the sandbox on first run, so the server skips the
  license/EULA screens. (If there's no license, the server starts at the license page; enter it once in a browser.)
- `--link <dir>` symlinks your package folder into `Data/systems/<id>` or `Data/modules/<id>` based on its manifest:
  edits are live, so just reload the browser page (or rely on `flags.hotReload` for css/hbs/json).
- `--link-installed <id>` symlinks an already-installed package from the user's real Data folder (a system for your
  module, or dependencies such as `lib-wrapper`).
- Creates `Data/worlds/<world>/world.json` if missing and auto-launches it with `--world`. On first launch Foundry
  creates the world databases and a **"Gamemaster" user with no password**. `--fresh-world` deletes the world first
  (clean database); `--no-launch` stops at the setup screen.
- Starts detached with `--noupnp --noupdate --nobackups`, writes `harness.pid`/`harness.json` in the sandbox, waits
  until `GET /api/status` reports `active: true`, and fails fast (with the log tail) if Foundry refuses to launch
  the world.

`/api/status` is a handy unauthenticated health check:
`{"active":true,"version":"14.369","world":"fvtt-dev-test","system":"my-system","systemVersion":"0.1.0","users":1}`.

Server-side errors (manifest validation, data model `migrateData` crashes, compendium problems) appear in
`fvtt-server.mjs logs`; client-side errors appear in the browser (§4).

## 4. Automated browser: fvtt-browser.mjs

```bash
node $S/fvtt-browser.mjs smoke --shots /tmp/fvtt-shots          # full smoke test + screenshots
node $S/fvtt-browser.mjs smoke --no-canvas                      # faster when you don't need the WebGL canvas
node $S/fvtt-browser.mjs eval --code "return game.system.version"
node $S/fvtt-browser.mjs eval --file ./checks/derived-stats.js
node $S/fvtt-browser.mjs screenshot --out /tmp/ui.png [--selector "#chat"]
node $S/fvtt-browser.mjs enable-modules my-module,lib-wrapper   # sets core.moduleConfiguration, reloads
node $S/fvtt-browser.mjs smoke --headed --slowmo 250            # watch it in a real window
```

Every command: launches Chromium (SwiftShader software WebGL), opens `/join`, selects the user (default
`Gamemaster`, `--user`/`--password` to change), clicks **Join**, waits for `game.ready === true`, dismisses the welcome
tour and startup notifications, runs the command, and prints one JSON object:

```jsonc
{
  "ok": true,                 // false if any page error, console error, or failed check
  "pageErrors": [],           // uncaught exceptions (stack included)
  "errors": [],               // console.error output
  "deprecations": [],         // Foundry compatibility warnings: fix the ones from your package
  "warnings": [],             // other console warnings
  "failedRequests": [],       // 4xx/5xx and network failures: missing templates, css, images, lang files
  "ignoredHeadlessWarnings": 3 // "no hardware acceleration" / GL driver noise from software rendering
  // ...command-specific fields
}
```

`smoke` additionally reports `env` (Foundry/system versions, active modules, Actor/Item subtypes, registered sheet
classes) and, for **every Actor and Item subtype**, creates a document, renders its sheet, counts form inputs,
screenshots it (`--shots`), closes and deletes it (`--keep` to keep). Any subtype whose sheet throws, doesn't render,
or logs new errors is listed in `failedChecks`.

Reading results:
- `failedRequests` with a `.hbs` 404: a template path in `PARTS`/`loadTemplates` doesn't match the file on disk
  (paths are `systems/<id>/...`, case-sensitive on Linux).
- `pageErrors` mentioning `is not a constructor` / `Cannot read properties of undefined (reading 'api')`: wrong
  namespace path, check it with `node fvtt-api.mjs find <Name>` / `exports <namespace>`.
- Errors during login (before `ready`): look at `init`/`setup` hook code and data model `defineSchema`.
- `inputs: 0` on a sheet usually means the template rendered but `PARTS` or the context is wrong.

Exit code is 1 when `ok` is false, so these commands can gate CI.

## 5. Interactive testing with a browser tool / computer use

When you want to see and click through the UI yourself (drag-and-drop, context menus, visual polish), start the
server with `fvtt-server.mjs start ...` and point whatever browser control you have at the `joinUrl` it prints
(Claude in Chrome, the computer-use desktop tool, an in-app/preview browser, or `fvtt-browser.mjs --headed` for a
window the user can watch).

Login steps (all tools):
1. Open `http://localhost:<port>/join`.
2. Choose **Gamemaster** in the user `<select name="userId">` (id `join-username`).
3. Leave the password (`input[name=password]`) empty, click **Join Game Session** (`button[name=join]`).
4. Wait for the URL to end in `/game` and for `game.ready === true` (evaluate `globalThis.game?.ready`).
5. Optional: run `foundry.nue.Tour.activeTour?.exit(); ui.notifications.clear();` to clear the welcome tour/toasts.

Tips:
- **One browser session per user.** While a tab is logged in as Gamemaster, that user is disabled on the join page
  and `fvtt-browser.mjs` will report "already logged in". Close your interactive tab before running scripts (or log in
  as a different user: create one with `User.create({name: "Player", role: 1})` via eval).
- The game page is heavy (WebGL canvas, large DOM). Full-page accessibility snapshots can time out; prefer
  evaluating JS (`game.actors.getName("X").sheet.render(true)`), targeted element screenshots (`#ActorSheet-...`
  ids come from `sheet.id`), or `fvtt-browser.mjs screenshot --selector`.
- To open a sheet deterministically: evaluate `await game.actors.getName("Hero").sheet.render({force: true})`, then
  screenshot `#${sheet.id}`.
- After editing JS, reload the page (F5 / `location.reload()`); ES modules aren't hot-reloaded. CSS/HBS/lang files
  listed in `flags.hotReload` update live.
- Computer-use (desktop control) can also drive the user's normal browser. Same steps, same port. Don't use the
  desktop app's own window for tests: it's bound to the user's real data.

## 6. Writing package-specific checks with eval

`eval` code runs as the body of an async function in the page after login. Return plain data; throw to fail.

```js
// checks/derived-stats.js — run: node fvtt-browser.mjs eval --file checks/derived-stats.js
const actor = await Actor.implementation.create({ name: "Test Hero", type: "character",
  system: { abilities: { str: { value: 16 } } } });
try {
  const mod = actor.system.abilities.str.mod;
  if (mod !== 3) throw new Error(`str mod should be 3, got ${mod}`);

  // Updates persist and re-derive
  await actor.update({ "system.abilities.str.value": 8 });
  if (actor.system.abilities.str.mod !== -1) throw new Error("mod did not re-derive after update");

  // Rolls evaluate and post to chat
  const before = game.messages.size;
  const roll = await new Roll("1d20 + @abilities.str.mod", actor.getRollData()).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }) });
  if (game.messages.size !== before + 1) throw new Error("no chat message created");

  // Sheet renders and a data-action button works
  await actor.sheet.render({ force: true });
  actor.sheet.element.querySelector('[data-action="roll"]')?.click();
  await new Promise(r => setTimeout(r, 300));

  return { ok: true, mod, total: roll.total };
} finally {
  await actor.sheet?.close();
  await actor.delete();
}
```

Patterns:
- Wait for async UI: `await new Promise(r => setTimeout(r, 300))` after clicks/renders, or poll for an element.
- Simulate a form edit on a V2 sheet: set the input value, then `input.dispatchEvent(new Event("change", {bubbles: true}))`
  (that's what triggers `submitOnChange`), then wait and assert on `actor.system`.
- Hooks: register a one-off listener and assert it fired:
  `let fired = false; Hooks.once("updateActor", () => fired = true); await actor.update({...});`.
- Use `--fresh-world` for a clean database when a test depends on the absence of documents.
- Keep check files in the package repo (e.g. `tests/e2e/*.js`) so they can be re-run after every change.

## 7. Testing modules

```bash
node $S/fvtt-server.mjs start --link ./my-module --link-installed dnd5e --system dnd5e --world mod-test
node $S/fvtt-browser.mjs enable-modules my-module          # once per world; persists in the world database
node $S/fvtt-browser.mjs smoke                              # also proves the module didn't break core sheets
node $S/fvtt-browser.mjs eval --code "return game.modules.get('my-module').api?.version"
```

- A module needs *some* system. Use `--link-installed <systemId>` for one already installed, or scaffold a throwaway
  system (`node scaffold.mjs system test-sys --dest /tmp/test-sys`) and `--link` it.
- Required modules (`relationships.requires`) must also be present in the sandbox: `--link-installed lib-wrapper`.
- Module activation is stored in the world (`core.moduleConfiguration`) and only applies after a reload, which
  `enable-modules` does for you.

## 8. In-Foundry unit tests (Quench)

For larger packages, the community **Quench** module (`quench`, Mocha + Chai inside Foundry) lets you register test
batches from your package (`Hooks.on("quenchReady", quench => quench.registerBatch("my-system.data", ctx => {...}))`)
and run them in the client. With the harness: `--link-installed quench` (after installing it once in the real app)
or `--link` a checkout, enable it with `enable-modules quench`, then trigger a run via
`eval --code "return await quench.runBatches('**')"` (check Quench's README for the exact API of your version).
The plain `eval` checks in §6 cover most needs without an extra dependency.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `Foundry 14 needs Node.js >= 24` | Install a newer Node (`nvm install 24`) or set `FOUNDRY_NODE=/path/to/node`. |
| `Port 30001 is already in use` | Another server (maybe a previous sandbox) is running: `fvtt-server.mjs stop`, or `--port 30002`. |
| `cannot start in this directory which is already locked` | Another Foundry process owns that data path. Stop it, or use a different `--sandbox`. Never point the sandbox at the real data path while the desktop app runs. |
| `Server failed to launch world` | Foundry rejected the world/system: invalid manifest, `compatibility` excludes this version, system id ≠ folder, or the system named in an existing world.json isn't linked. Run `fvtt-lint.mjs`, check `logs`, or open `http://localhost:<port>/setup` to see package warnings. |
| Starts at license screen | No `license.json` was found to copy. Open the URL once and enter the key; it persists in the sandbox. |
| `User "Gamemaster" is already logged in` | An interactive tab or crashed script still holds the session. Close it; the socket times out within a few seconds of the tab closing. |
| Sheet screenshot blank/black | WebGL/canvas isn't involved in sheets; usually CSS (e.g. the app element has zero height). Try `--headed`. |
| Changes not visible | Reload the page; for `--link`ed packages the files are live. Manifest changes (`system.json`) need a server restart (`stop` + `start`). |
| Need a clean slate | `fvtt-server.mjs stop && rm -rf ~/.cache/foundry-vtt-dev/sandbox` (or `--fresh-world`). |
