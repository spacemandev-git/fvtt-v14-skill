# __TITLE__

A game system for [Foundry Virtual Tabletop](https://foundryvtt.com) (v13+, verified on v14), scaffolded from the
`foundry-vtt-dev` starter. It uses TypeDataModels and ApplicationV2 sheets only: there is no `template.json`,
no Application V1 and no jQuery.

## Try it

1. Put this folder in your Foundry data directory as `Data/systems/__ID__/` (a symlink is fine).
2. Restart or refresh the Setup screen, create a world with the **__TITLE__** system, then add a Character, an NPC and
   some Items. Drag Items from the sidebar onto an Actor sheet to add them.
3. For live reload of `.css`, `.hbs` and `lang/*.json` edits, start Foundry with `--hotReload`
   (`flags.hotReload` in `system.json` already lists the paths to watch). JavaScript changes need a browser refresh.

## Layout

| Path | Purpose |
|---|---|
| `system.json` | Manifest: id, compatibility, `esmodules`, `styles` (with CSS `layer`), `languages`, `documentTypes` |
| `module/__ID__.mjs` | Entry point: `init` hook registers CONFIG, document classes, data models, sheets, templates |
| `module/config.mjs` | Static game config (abilities, categories), exposed as `CONFIG.__PREFIX__` |
| `module/data/` | TypeDataModels: schema, derived data (`prepareDerivedData`), `getRollData` |
| `module/documents/` | Thin `Actor` / `Item` subclasses with roll methods |
| `module/sheets/` | `HandlebarsApplicationMixin(ActorSheetV2 / ItemSheetV2)` sheets with PARTS, TABS and actions |
| `templates/` | Handlebars templates, one per sheet part, using `formInput` / `formGroup` with `systemFields` |
| `lang/en.json` | `TYPES` labels plus `__PREFIX__.*` strings and data model field labels |
| `styles/__ID__.css` | Styles scoped to `.__ID__`, loaded in the `system` CSS layer, theme-variable based |

## Making it yours

- **Add a field**: add it in `defineSchema()` of a model in `module/data/`, add its label under
  `__PREFIX__.<Actor|Item>.<base|type>.FIELDS` in `lang/en.json`, and render it with
  `{{formGroup systemFields.<name> value=source.system.<name> rootId=rootId}}`.
- **Add a sub-type**: add it to `documentTypes` in `system.json` (list HTML fields in `htmlFields` so the server
  sanitizes them), write a model, register it in `CONFIG.<Doc>.dataModels`, add `TYPES.<Doc>.<type>` to the lang file
  and include the type in the sheet registration `types`.
- **HTMLField / FilePathField**: any `HTMLField` must be listed in the manifest `htmlFields` for its sub-type.
- **Distribution**: add `url`, `manifest` and `download` to `system.json`, then build releases from tagged versions.
