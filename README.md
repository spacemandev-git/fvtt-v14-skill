# fvtt-v14-skill: `foundry-vtt-dev`

An **Agent Skill** for Claude Code, and any agent that reads the `SKILL.md` format. It helps the agent write, port,
debug and **actually test** [Foundry Virtual Tabletop](https://foundryvtt.com) game systems and modules against the
current **v13/v14 API**.

It combines:

- **Distilled API references.** About 6,400 lines, written from the official
  [API docs](https://foundryvtt.com/api/), [System Development guide](https://foundryvtt.com/article/system-development/)
  and [Knowledge Base](https://foundryvtt.com/kb/), and checked against the Foundry v14 source.
- **Tools that read your installed Foundry**: a source lookup tool, and a linter whose deprecation rules come from the
  version you have installed.
- **A headless test harness.** It boots a sandboxed Foundry server on Node.js, logs in through a real browser
  (Playwright), renders every sheet, and reports errors and deprecation warnings. It never touches your real worlds.

> Unofficial community project. Not affiliated with or endorsed by Foundry Gaming LLC. You need your own Foundry VTT
> license to run the test harness.

---

## Why this exists

Foundry's API changed a lot between v9 and v14:

- `template.json` became TypeDataModels.
- `Application` became `ApplicationV2`.
- jQuery became plain `HTMLElement`s.
- Most globals moved into `foundry.*` namespaces.
- v14 alone deprecated roll modes, `-=` update keys, ActiveEffect `changes` and the old context-menu keys.

Most Foundry code online, and most of what an LLM remembers, uses the old API. That code either fails outright on
v14 or logs deprecation warnings that turn into errors in the next release.

This skill keeps the agent on the current API. It teaches the modern idioms, makes the agent check signatures against
the Foundry source on your machine instead of guessing, and has it **prove the result works in a running Foundry**
before calling the job done.

## What's inside

### Reference guides (`skills/foundry-vtt-dev/references/`)

| File | Covers |
|---|---|
| `manifest-and-packaging.md` | `system.json` / `module.json` fields, folder layout, LevelDB compendium packs and `@foundryvtt/foundryvtt-cli`, relationships, publishing and the package release API |
| `localization-and-styles.md` | `lang/*.json`, `i18nInit`, `LOCALIZATION_PREFIXES`, CSS cascade layers, light and dark themes |
| `data-models.md` | `TypeDataModel`, `defineSchema`, every `foundry.data.fields` type, derived data, `migrateData` |
| `documents.md` | CRUD, embedded documents, flags, ownership, v14 ActiveEffects, tokens vs actors, world migrations |
| `applications-v2.md` | `ApplicationV2`, `HandlebarsApplicationMixin`, `ActorSheetV2`/`ItemSheetV2`, `PARTS`, actions, tabs, forms, drag/drop, `DialogV2`, Handlebars helpers |
| `hooks-config-settings.md` | Init sequence, hook signatures, `CONFIG`, `game`, settings, keybindings, sockets and `CONFIG.queries`, enrichers, libWrapper |
| `dice-chat-combat.md` | `Roll` API, custom dice and terms, chat messages and cards, v14 message modes, combat and initiative |
| `canvas.md` | Tokens, layers, scene controls, Regions (which replace templates in v14), measuring |
| `version-migration.md` | Obsolete-to-modern cheat sheet; breaking changes in v12, v13 and v14; supporting several versions at once |
| `tooling.md` | Build setups, TypeScript types, ESLint, foundryvtt-cli, debugging flags, server command-line flags |
| `docs-index.md` | Which official doc, KB or API URL answers which question; a map of the Foundry source tree |
| `testing.md` | The headless harness, browser automation, interactive and computer-use testing, troubleshooting |

### Scripts (`skills/foundry-vtt-dev/scripts/`)

All of them run on plain Node.js. The only dependency is Playwright, which the browser script installs into
`~/.cache/foundry-vtt-dev` the first time you use it.

| Script | What it does |
|---|---|
| `scaffold.mjs` | Generates a working v13/v14 **system** or **module**: DataModels, V2 sheets with tabs and actions, lang, layered CSS, hot reload. |
| `fvtt-lint.mjs` | Static checks: manifest, referenced files, syntax, imports, obsolete APIs, deprecated globals (read from the installed Foundry), Handlebars compile, missing lang keys. |
| `fvtt-api.mjs` | Searches the installed Foundry source: `find`, `exports`, `hooks`, `deprecations`, `grep`. |
| `fvtt-server.mjs` | Starts, stops and checks a **sandboxed headless Foundry server** with your package symlinked in and a test world auto-launched. |
| `fvtt-browser.mjs` | Playwright: logs in as Gamemaster, runs a `smoke` test (creates and renders every Actor/Item subtype's sheet), runs JS in the game (`eval`), takes screenshots, enables modules. |

It also includes starter templates (`assets/templates/system`, `assets/templates/module`) and three eval cases
(`evals/`).

## Requirements

- **Node.js ≥ 24**, the minimum for Foundry v14. The harness reads the requirement from your Foundry install and
  picks a suitable `node`; set `FOUNDRY_NODE` to override.
- **Foundry VTT installed locally**, either the desktop app or the Node.js zip, **with a license**. The harness and
  the source tools look in the standard install locations; set `FOUNDRY_APP_PATH` (the folder containing `main.mjs`)
  if yours is elsewhere. Without Foundry, the references and most lint checks still work.
- A few hundred MB of disk the first time the browser script runs, for Playwright and its Chromium download.

## Install

### Claude Code plugin

```bash
claude plugin marketplace add spacemandev-git/fvtt-v14-skill
claude plugin install foundry-vtt-dev@fvtt-v14-skill
```

Or, inside a Claude Code session, run `/plugin marketplace add spacemandev-git/fvtt-v14-skill` and then
`/plugin install foundry-vtt-dev@fvtt-v14-skill`.

### Manual

```bash
git clone https://github.com/spacemandev-git/fvtt-v14-skill.git
cp -R fvtt-v14-skill/skills/foundry-vtt-dev ~/.claude/skills/
# or symlink it so `git pull` updates it:
# ln -s "$PWD/fvtt-v14-skill/skills/foundry-vtt-dev" ~/.claude/skills/foundry-vtt-dev
```

### Other agents

`skills/foundry-vtt-dev/` is a self-contained skill folder: a `SKILL.md` with YAML front matter, plus `references/`,
`scripts/` and `assets/`. Copy it into whatever skills directory your agent reads.

## Usage

### With Claude

You don't need to invoke anything. The skill triggers whenever you talk about Foundry, FVTT, game systems, modules,
sheets, `system.json` and similar. For example:

- *"Make me a Foundry v14 system for my homebrew game: three attributes, d6 dice pools, character and NPC sheets."*
- *"This is my old 0.7 system; port it to v13/v14 without deprecation warnings and keep the data fields."*
- *"Write a module that adds a 'Request Roll' button to chat and posts a card players can click."*
- *"Why does my actor sheet throw `Cannot read properties of undefined (reading 'value')` on render?"*

In Claude Code you can also call it directly with `/foundry-vtt-dev`.

For each task the agent:

1. Finds your installed Foundry version and its source.
2. Reads the relevant reference.
3. Writes modern code, starting from the scaffold for new packages.
4. Runs **lint, then boot, then smoke test, then a targeted check** in a sandboxed Foundry, and only reports done once
   those pass with zero errors from your package.

### Running the tools yourself

```bash
S=~/.claude/skills/foundry-vtt-dev/scripts      # or wherever the skill is installed

# New package
node $S/scaffold.mjs system my-system --title "My System" --dest ~/code/my-system

# Static checks
node $S/fvtt-lint.mjs ~/code/my-system

# Look things up in the installed Foundry source
node $S/fvtt-api.mjs where
node $S/fvtt-api.mjs find ActorSheetV2
node $S/fvtt-api.mjs hooks chat
node $S/fvtt-api.mjs deprecations ActiveEffect
```

Example lint output for a Foundry 0.7-era system:

```text
fvtt-lint system:?  (Foundry 14.369; 3 js, 4 hbs, 1 lang files)
ERROR [js] Global `mergeObject()` no longer exists.
        at: legacy-war.js:23, modules/faction-sheet.js:3, modules/territory-sheet.js:3
        fix: Use foundry.utils.mergeObject().
ERROR [js] `.data.data` is the pre-v10 data path.
        at: modules/faction-sheet.js:25, modules/faction-sheet.js:28, modules/faction-sheet.js:54
        fix: Use `doc.system` (and `doc._source.system` for raw source).
ERROR [manifest] Missing `id`.
        fix: Rename "name" to "id" (v10+).
WARN  [js] renderChatMessage hook is deprecated (jQuery).
        fix: Use `renderChatMessageHTML` (receives an HTMLElement).
...
```

## Testing in a real (headless) Foundry

```bash
node $S/fvtt-server.mjs start --link ~/code/my-system --fresh-world   # sandboxed server on :30001
node $S/fvtt-browser.mjs smoke --shots /tmp/my-system-shots           # login, render every sheet
node $S/fvtt-browser.mjs eval --code "return game.actors.size"        # run any async JS in the game
node $S/fvtt-server.mjs logs                                          # server log
node $S/fvtt-server.mjs stop
```

**How it stays out of your way**

- Foundry runs as a plain Node.js server (`node main.mjs`) with no Electron window. Its data path is a **sandbox**,
  `~/.cache/foundry-vtt-dev/sandbox`, not your real data folder. Foundry locks its data path, so the sandbox plus a
  separate port (30001) lets it run next to your open desktop app.
- Your signed `license.json` is copied into the sandbox once, which skips the license and EULA screens.
- `--link` **symlinks** your package folder, so edits are live. CSS, HBS and lang files hot-reload, and JS changes
  need a page reload.
- A test world is created and auto-launched. Foundry adds a **Gamemaster** user with no password, which the browser
  script logs in as.
- `--link-installed <id>` borrows an already-installed package, read-only via symlink, such as the system a module
  needs or `lib-wrapper`.

`smoke` prints JSON like this:

```jsonc
{
  "ok": true,
  "env": { "foundry": "14.369", "system": { "id": "my-system" }, "actorTypes": ["character","npc"], "itemTypes": ["item","feature"] },
  "sheets": [ { "document": "Actor", "type": "character", "sheet": "CharacterSheet", "rendered": true, "inputs": 8, "newErrors": 0 }, ... ],
  "pageErrors": [], "errors": [], "deprecations": [], "failedRequests": []
}
```

### Interactive and computer-use testing

After `fvtt-server.mjs start`, open the printed `joinUrl` (`http://localhost:30001/join`) in any browser tool: Claude
in Chrome, the computer-use desktop tool, an in-app preview browser, or `fvtt-browser.mjs smoke --headed` for a window
you can watch. Pick **Gamemaster**, leave the password empty, and click **Join Game Session**.

A user can only be logged in once, so close that tab before running the scripted commands.

### Environment overrides

| Variable | Purpose |
|---|---|
| `FOUNDRY_APP_PATH` | Folder containing Foundry's `main.mjs`, if it's not in a standard location |
| `FOUNDRY_REAL_DATA_PATH` | Your real user-data folder (where `Config/license.json` lives) |
| `FOUNDRY_NODE` | Node.js binary to run the server with |

See [`testing.md`](skills/foundry-vtt-dev/references/testing.md) for the full guide and troubleshooting table.

## Evals

`skills/foundry-vtt-dev/evals/` holds three test cases in the `claude plugin eval` format:

- a dice-pool system built from a rules description
- a port of a Foundry 0.7-era system to v14
- a chat-card roll-request module

Each was run on Sonnet 5.5, with and without the skill, and graded by booting the output in the sandboxed v14 server
and driving it. Graded checks include derived HP, success counting, sheet buttons and DialogV2 confirmations.

| Case | With skill | Without skill |
|---|---|---|
| Dice-pool system | 7/7, 944 s | 7/7, 1514 s |
| Legacy 0.7 → v14 port | 7/7, 919 s | 7/7, 1072 s |
| Chat roll module | 6/6, 679 s | 6/6, 594 s |

Correctness was equal on these tasks. The agent found the Foundry source on the machine either way. The differences:

- With the skill, runs averaged about **20% faster**.
- **Every with-skill run verified its work in a live Foundry.** The baselines could only test against stubs in Node,
  and each said it had not been run in a real Foundry.

To run the cases yourself (these are real, billed model runs), from the repository root:

```bash
claude plugin eval . --eval-dir skills/foundry-vtt-dev/evals --scaffold --allow-tools Write Edit Bash --no-publish
```

`--scaffold` copies the port case's legacy fixture into place, and `--no-publish` keeps the HTML report local.

## Repository layout

```text
.claude-plugin/
  plugin.json            # Claude Code plugin manifest
  marketplace.json       # single-plugin marketplace (enables `plugin marketplace add`)
skills/foundry-vtt-dev/
  SKILL.md               # entry point: workflow, cheat sheet, reference map
  references/            # 12 distilled guides (see above)
  scripts/               # scaffold, lint, api lookup, headless server, browser driver
  assets/templates/      # starter system and module (__ID__ placeholders)
  evals/                 # test cases + fixtures
```

## Compatibility and limitations

- Verified against **Foundry v14 build 369**, macOS, Node 26. v13 differences are documented from the source and
  release notes but haven't been run against a v13 install.
- Linux and Windows install paths are in the search list but untested. On Windows, `--link` uses directory junctions.
- The lint's context-menu and version-gating rules are heuristics. Treat warnings as prompts to look, not verdicts.
- Some KB articles (measurement, scenes, active effects, chat) still describe pre-v14 behaviour. The references follow
  the v14 source and release notes where they disagree.
- When Foundry updates, the source-derived checks (`fvtt-api.mjs`, the lint's deprecated-globals table) follow
  automatically. The prose references need a refresh for major versions.

## Contributing

Issues and PRs are welcome, especially v13 verification, Windows/Linux testing, and new references for areas like
compendium tooling, Regions or Scene Levels. When you change a reference, check claims against the Foundry source
(`node scripts/fvtt-api.mjs find <Name>`) and run the scaffold through the harness:

```bash
node scripts/scaffold.mjs system test-sys --dest /tmp/test-sys
node scripts/fvtt-lint.mjs /tmp/test-sys
node scripts/fvtt-server.mjs start --link /tmp/test-sys --fresh-world
node scripts/fvtt-browser.mjs smoke
node scripts/fvtt-server.mjs stop
```
