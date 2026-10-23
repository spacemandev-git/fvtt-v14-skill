# __TITLE__

A module for [Foundry Virtual Tabletop](https://foundryvtt.com) (v13+, verified on v14), scaffolded from the
`foundry-vtt-dev` starter. It is a working example of the usual module building blocks.

## Try it

1. Put this folder in your Foundry data directory as `Data/modules/__ID__/` (a symlink is fine).
2. Launch a world, open **Game Settings > Manage Modules**, enable **__TITLE__**, and save.
3. Under **Configure Settings** you will find the "Show Roll Badge" toggle and a **Configure** button that opens the
   settings menu. Make a roll in chat to see the d20 badge.
4. From the browser console (F12) or a macro:

```js
const api = game.modules.get("__ID__").api;
api.broadcastGreeting();   // socket: notify every connected client
await api.pingGM("hi");    // query: ask the active GM client and await the reply
```

For live reload of `.css`, `.hbs` and `lang/*.json` edits start Foundry with `--hotReload`. JavaScript changes need a
browser refresh.

## What is where

| File | Shows |
|---|---|
| `module.json` | id, compatibility, `esmodules`, `styles` with a CSS `layer`, `languages`, `relationships`, `socket: true` |
| `scripts/main.mjs` | `init` / `ready` hooks, client + world settings, a settings menu, `renderChatMessageHTML`, a socket, a `CONFIG.queries` handler, `game.modules.get(id).api` |
| `scripts/settings-menu.mjs` | An `ApplicationV2` with `HandlebarsApplicationMixin`, PARTS, and a form handler |
| `scripts/constants.mjs` | The module id and socket event name |
| `templates/settings-menu.hbs` | The menu's form body (the footer reuses core `templates/generic/form-footer.hbs`) |
| `lang/en.json` | Every user-facing string, namespaced under `__PREFIX__` |
| `styles/__ID__.css` | Styles in the `modules` CSS layer using theme variables |

## Declaring relationships

Relationships in `module.json` control load order and what the Setup screen warns about:

```json
"relationships": {
  "systems": [{ "id": "dnd5e", "type": "system", "compatibility": { "minimum": "5.0.0" } }],
  "requires": [{ "id": "some-library", "type": "module", "manifest": "https://example.com/module.json" }],
  "recommends": [],
  "conflicts": []
}
```

Leave `systems` empty for a system-agnostic module. Adding `documentTypes` to `module.json` lets a module provide
Document sub-types (named `<module-id>.<type>`); see `foundry.abstract.TypeDataModel`.

## Distribution

Add `url`, `manifest` and `download` to `module.json`, then publish a release zip whose manifest matches its version.
