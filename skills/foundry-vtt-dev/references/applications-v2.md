# ApplicationV2, Sheets, Dialogs, Templates (Foundry v14)

Target: Foundry VTT v14 (checked against the local build 14.369 source, `client/applications/` under
`/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/`). Differences from v13 are marked **[v13]**,
v14-only features **[v14]**. If this file and the source disagree, the source wins.

## Contents

1. [Golden rules](#1-golden-rules)
2. [Obsolete V1 patterns -> V2](#2-obsolete-v1-patterns---v2)
3. [ApplicationV2 anatomy](#3-applicationv2-anatomy)
4. [Actions and forms](#4-actions-and-forms)
5. [Tabs](#5-tabs)
6. [DocumentSheetV2, ActorSheetV2, ItemSheetV2](#6-documentsheetv2-actorsheetv2-itemsheetv2)
7. [Registering sheets](#7-registering-sheets)
8. [Form fields, editors, images, enrichment](#8-form-fields-editors-images-enrichment)
9. [Handlebars: loading, helpers, partials](#9-handlebars-loading-helpers-partials)
10. [Drag and drop](#10-drag-and-drop)
11. [ContextMenu](#11-contextmenu)
12. [DialogV2](#12-dialogv2)
13. [Hooks and injecting UI into core apps](#13-hooks-and-injecting-ui-into-core-apps)
14. [Non-document apps](#14-non-document-apps)
15. [Pop-out windows [v14]](#15-pop-out-windows-v14)
16. [Styling applications](#16-styling-applications)
17. [Pitfalls](#17-pitfalls)
18. [Complete example](#18-complete-example)
19. [Verify-in-source index](#19-verify-in-source-index)

---------------------------------------------------------------------------------------------------

## 1. Golden rules

1. Windows extend `foundry.applications.api.ApplicationV2`, rendered via `HandlebarsApplicationMixin(...)`. Sheets
   extend `foundry.applications.sheets.ActorSheetV2` / `ItemSheetV2` (or `api.DocumentSheetV2`), **also wrapped in the
   mixin**.
2. Configuration is static: `static DEFAULT_OPTIONS`, `static PARTS`, `static TABS`. DEFAULT_OPTIONS merge up the class
   chain automatically. No `defaultOptions` getter, no `mergeObject(super.defaultOptions, ...)`.
3. Template data comes from `async _prepareContext(options)` / `_preparePartContext`. Never `getData()`.
4. Clicks are `data-action="name"` + static handlers in `DEFAULT_OPTIONS.actions`, signature `(event, target)`, `this` =
   app instance. Other events (change, input, dragstart, contextmenu) are wired in `_onRender` with plain DOM
   (`this.element.querySelectorAll`). **No jQuery.**
5. Forms: `tag: "form"` + `form.handler(event, form, formData)`; `formData.object` is the flat `{"a.b.c": value}` map.
   Document sheets already have a handler; `submitOnChange` is **false by default**, set it to autosave.
6. Every `<button>` inside a form needs `type="button"` unless it should submit.
7. Every part template renders exactly one root element (unless the part is `root: true`).
8. Open with `render({force: true})`; plain `render()` only refreshes an already-open window.
9. Use namespaced APIs: `foundry.applications.handlebars.renderTemplate`,
   `foundry.applications.ux.TextEditor.implementation.enrichHTML`, `foundry.documents.collections.Actors.registerSheet`.
10. Put localization keys in titles, labels, tooltips; `_loc(key, data)` **[v14]** or `game.i18n.localize` at runtime.
11. Inputs that must not be saved to the sheet's document (embedded-item fields, UI toggles) get no `name=""`.
12. Debug: `CONFIG.debug.applications = true` logs the lifecycle; `foundry.applications.instances` is the
    `Map<id, ApplicationV2>` of open apps.

---------------------------------------------------------------------------------------------------

## 2. Obsolete V1 patterns -> V2

| Obsolete (V1 / old tutorials) | V2 replacement |
|---|---|
| `extends Application` / `FormApplication` / `DocumentSheet` | `extends HandlebarsApplicationMixin(ApplicationV2)` / `...(DocumentSheetV2)` |
| `extends ActorSheet` / `ItemSheet` (globals) | `HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2)` / `...ItemSheetV2` |
| `new Dialog({title, content, buttons: {a: {label, callback}}, default})` | `DialogV2.confirm/prompt/input/wait` (buttons are an **array**), section 12 |
| `static get defaultOptions() { return mergeObject(super.defaultOptions, {...}) }` | `static DEFAULT_OPTIONS = {...}` |
| `template: "..."` | `static PARTS = {name: {template: "..."}}` |
| `popOut`, `minimizable`, `resizable`, `title`, `width`, `height`, `classes`, `id` | `window: {frame, minimizable, resizable, title, icon}`, `position: {width, height, top, left}`, `classes`, `id` |
| `tabs: [{navSelector, contentSelector, initial}]` + `Tabs` | `static TABS` + `data-action="tab"` nav + `changeTab` / `tabGroups` |
| `getData()` | `async _prepareContext(options)` (+ `_preparePartContext(partId, context, options)`) |
| `activateListeners(html)`, `html.find(".x").click(fn)`, `html.on(...)` | `data-action` + `actions`; other events in `_onRender(context, options)` on `this.element` (HTMLElement) |
| `this.element[0]`, `$(this.element)` | `this.element`; `this.form` (HTMLFormElement or null) |
| `_updateObject(event, formData)` | `form.handler(event, form, formData)`; sheets override `_processFormData` / `_prepareSubmitData` / `_processSubmitData` |
| `expandObject(formData)` | `foundry.utils.expandObject(formData.object)` |
| `this.object` | `this.document` (`this.actor` / `this.item`) |
| `_getHeaderButtons()` `{label, class, icon, onclick}` | `window.controls` `{icon, label, action, visible, ownership}`, `_getHeaderControls()`, hook `getHeaderControls{ClassName}` |
| `_onChangeInput`, `_onSubmit` | `_onChangeForm(formConfig, event)`, `_onSubmitForm(formConfig, event)` |
| `this.render(true)` | `this.render({force: true})` (boolean still accepted) |
| `Actors.registerSheet("sys", Cls, o)` (global) | `foundry.documents.collections.Actors.registerSheet(...)` or `foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, "sys", Cls, o)` |
| `Actors.unregisterSheet("core", ActorSheet)` | still callable but a no-op: v14 core registers **no** default Actor/Item sheet (section 7) |
| `Hooks.on("renderActorSheet", (app, html, data) => html.find(...))` | `Hooks.on("renderActorSheetV2", (app, element, context, options) => element.querySelector(...))` |
| `getActorSheetHeaderButtons`, `getApplicationHeaderButtons` | `getHeaderControls{ClassName}(app, controls)` |
| global `renderTemplate`, `loadTemplates`, `getTemplate` | `foundry.applications.handlebars.*` |
| `TextEditor.enrichHTML(x, {async: true})` | `await foundry.applications.ux.TextEditor.implementation.enrichHTML(x, opts)` (always async) |
| `{{editor}}` helper | `{{formInput htmlField value=... enriched=... toggled=true}}` -> `<prose-mirror>` (section 8) |
| `{{filePicker}}`, `{{rangePicker}}` | `<file-picker>`, `<range-picker>` or `{{formInput field}}` |
| `<img data-edit="img">` auto-bound | `<img data-edit="img" data-action="editImage">` (DocumentSheetV2 action) |
| `new ContextMenu(html, sel, [{name, callback(jq), condition}])` | `this._createContextMenu(handler, sel)` with `{label, onClick(event, target), visible}` (section 11) |
| `new DragDrop(...).bind(html)` | `foundry.applications.ux.DragDrop.implementation`; ActorSheetV2/ItemSheetV2 bind it for you |
| globals `FilePicker`, `FormDataExtended`, `SearchFilter`, `ImagePopout` | `foundry.applications.apps.FilePicker.implementation`, `foundry.applications.ux.FormDataExtended` / `SearchFilter`, `foundry.applications.apps.ImagePopout` |
| `Hooks.on("renderChatMessage", (msg, $html))` | `Hooks.on("renderChatMessageHTML", (message, html, context))`, `html` is an HTMLElement |
| `game.i18n.format("K", data)` | `_loc("K", data)` **[v14]** (`format` is a silent alias; on v13 `localize` takes no data) |
| bare `mergeObject`, `duplicate`, `getProperty`, `expandObject` | `foundry.utils.mergeObject`, `.deepClone`, `.getProperty`, `.expandObject` |

Status in v14 (verified in `client/client.mjs`, `client/appv1/`):
- V1 `Application`, `FormApplication`, `Dialog`, `DocumentSheet` still exist (`foundry.appv1.api.*`, plus globals tagged
  "deprecated since v13 until v16"). Constructing any V1 app logs once: *"The V1 Application framework is deprecated, and
  will be removed in a later core software version..."*. Pop-out windows **[v14]** target ApplicationV2.
- The globals `ActorSheet`, `ItemSheet`, `JournalSheet`... are compat getters logging *"You are accessing the global
  "ActorSheet" which is now namespaced under foundry.appv1.sheets.ActorSheet"* (since 13, until 15). The same mechanism
  covers `renderTemplate`, `loadTemplates`, `FilePicker`, `ContextMenu`, `DragDrop`, `TextEditor`, `Actors`, `Items`,
  `Tabs`, `DocumentSheetConfig`... They work in v14 but warn and **disappear in v15**.
- Real globals: `foundry`, `CONFIG`, `CONST`, `game`, `ui`, `Hooks`, `Roll`, `fromUuid`, `fromUuidSync`, `getDocumentClass`,
  `Color`, `Collection`, `ProseMirror`, `_loc`, document classes (`Actor`, `Item`...), `Handlebars`, `$`.

---------------------------------------------------------------------------------------------------

## 3. ApplicationV2 anatomy

### 3.1 Skeleton

```js
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export default class Dashboard extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mysys-dashboard",              // omit for per-instance ids ("app-{id}")
    classes: ["mysys", "dashboard"],    // arrays CONCATENATE with parents'
    tag: "div",                         // "form" for form apps (sheets default to "form")
    window: { title: "MYSYS.Dashboard.Title", icon: "fa-solid fa-gauge", resizable: true },   // title: key or literal
    position: { width: 520, height: "auto" },
    actions: { refresh: Dashboard.#onRefresh }
  };

  static PARTS = {
    main: { template: "systems/mysys/templates/dashboard.hbs", scrollable: [""] }
  };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.actors = game.actors.filter(a => a.type === "character");
    return context;
  }

  static #onRefresh(event, target) { this.render(); }
}

new Dashboard().render({ force: true });
```

### 3.2 DEFAULT_OPTIONS

Core defaults (`ApplicationV2.DEFAULT_OPTIONS`): `id: "app-{id}"`, `classes: []`, `tag: "div"`,
`window: {frame: true, positioned: true, title: "", icon: "", controls: [detach/attach], minimizable: true,
resizable: false, contentTag: "section", contentClasses: []}`, `actions: {detach, attach}`,
`form: {handler: undefined, submitOnChange: false, closeOnSubmit: false}`, `position: {width: "auto", height: "auto"}`.

- `{id}` is replaced by a counter (DocumentSheetV2: `ClassName-<uuid with dots as dashes>`). A fixed `id` = one DOM element.
- `"application"` is auto-added to `classes` for framed apps; DocumentSheetV2 adds `"sheet"` (+ `themed theme-x` when the
  user configured a sheet theme).
- `window.frame: false` = no chrome (HUDs); `positioned: false` = position by CSS only. `contentTag: "form"` makes the content
  element (not the frame) the form. `contentClasses: ["standard-form"]` enables core form styling.
- `actions`: `name: fn` or `name: {handler, buttons: [0, 2]}` (mouse buttons).

Merge semantics (`_initializeApplicationOptions`): walks the chain down from `BASE_APPLICATION`; a class contributes only if it
**owns** a `DEFAULT_OPTIONS`. **Arrays concatenate** (`classes`, `window.controls`), **plain objects merge recursively**
(`actions`, `window`, `position`, `form`), everything else replaces. Constructor options merge last:
`new App({position: {width: 700}, myOption: 1})` and `this.options.myOption` works. `this.options` is shallow-frozen (use
`this.position` / `setPosition()` for geometry). `static PARTS` and `static TABS` are **not** merged: extend with
`static PARTS = {...Parent.PARTS, extra: {...}}`.

### 3.3 PARTS

```js
static PARTS = {
  header: { template: "systems/mysys/templates/header.hbs" },
  tabs:   { template: "templates/generic/tab-navigation.hbs" },        // core partial, iterates context.tabs
  body:   {
    template: "systems/mysys/templates/body.hbs",
    templates: ["systems/mysys/templates/partials/row.hbs"],          // partial files this part includes
    scrollable: ["", ".item-list"],                                    // restore scroll after re-render ("" = part root)
    id: "body", classes: ["body-part"]                                 // id (prefixed with app id) / classes on part root
  },
  footer: { template: "templates/generic/form-footer.hbs" }           // expects context.buttons
};
```
Other options: `forms: {"selector": {handler, submitOnChange, closeOnSubmit}}` (extra forms inside a part) and
**`root: true`** **[v13+]** (children replace the children of `.window-content`; no wrapper; multiple top-level nodes
allowed; must be the first part; used by `BaseSheet`, `DiceConfig`).

Rules: a non-root part must render **exactly one root element** or render fails with `Template part "x" must render a single
HTML element`. Each part root gets `data-application-part="<partId>"` (`this.parts.body` also maps ids to elements). Parts
render in key order, appended inside `.window-content`.

Choose parts per render by overriding `_configureRenderOptions` (call `super` first; it fills `options.parts`):
```js
_configureRenderOptions(options) {
  super._configureRenderOptions(options);
  if ( this.document.limited ) options.parts = ["limited"];                  // reduced view for LIMITED users
  else options.parts = options.parts.filter(p => p !== "limited");
}
```
Partial refresh: `this.render({parts: ["header"]})` (rendering a `root` part re-renders all). Fully dynamic parts: override
`_configureRenderParts(options)`.

### 3.4 Render lifecycle (v14, `application.mjs#render`)

Renders are serialized by a semaphore. `render(options)`:

1. `isFirstRender = state <= NONE`; first render without `force` returns.
2. `_canRender(options)` (return `false` or throw to veto; a thrown message becomes a warning).
3. `_configureRenderOptions(options)` (Handlebars: `_configureRenderParts`, sets `options.parts`; applies `options.tab`).
4. `await _prepareContext(options)`.
5. First render: `_preFirstRender(context, options)`.
6. `_preRender(context, options)` + hook `preRender{Class}(app, context, options)` (Handlebars loads all templates here).
7. First render: `_renderFrame` builds the window, `_attachFrameListeners` (click -> action dispatch, form submit/change).
8. `_renderHTML`: per part `_preparePartContext(partId, context, options)` + `renderTemplate`; `_replaceHTML`: per part
   `_preSyncPartState` (captures focus, scroll, `<details data-sync>` open state), swap DOM, `_syncPartState` (restores),
   `_attachPartListeners(partId, el, options)`. **On first render the element is not in `document` yet.**
9. First render: `_insertElement` (appends to `document.body`), `_updateFrame`.
10. state = RENDERED; first render: `await _onFirstRender(context, options)`.
11. `await _onRender(context, options)` + hook `render{Class}(app, element, context, options)` + `"render"` event.
12. `_postRender` (focuses `[autofocus]` on first render), then `setPosition(options.position)`.

Close: `close(options)` -> `_preClose` -> animation -> `_tearDown` (element removed, `this.element` becomes `null`) ->
`_onClose(options)` + hook `close{Class}(app)` + `"close"` event. `options.submitted` is true when closed by `closeOnSubmit`.

| Need | Use |
|---|---|
| One-time DOM setup (context menus, listeners on the frame, `Hooks.on`) | `_onFirstRender` (always `await super._onFirstRender(...)`: DocumentSheetV2 registers itself in `document.apps` there) |
| Per-render wiring (listeners on elements inside parts, DragDrop bind) | `_onRender(context, options)` or `_attachPartListeners(partId, el, options)` |
| Cleanup (hooks, timers) | `_onClose(options)` |
| Veto / change what renders | `_canRender`, `_configureRenderOptions` |
| React from outside | `app.addEventListener("render" \| "close" \| "position", fn)` |

`this.element` is the outer frame (`null` before first render and after close). The frame persists across re-renders; elements
inside parts are **replaced**, so listeners on them must be re-attached each render, while listeners on `this.element` persist.
Also: `this.window.content`, `this.form`, `this.parts`, `this.rendered`, `this.state`, `this.id`, `this.minimized`,
`this.position` (proxy), `setPosition({})`, `bringToFront()`, `close()`, `submit()`, `static instances()`.
`render()` options: `{force, parts, position: {left, top, width, height}, window: {title, icon}, tab}` (`tab: "items"` or
`{primary: "items"}` activates a tab first).

### 3.5 Context

```js
async _prepareContext(options) {
  const context = await super._prepareContext(options);        // always call super: adds `tabs` (one tab group) + document data
  context.config = CONFIG.MYSYS;
  return context;
}
async _preparePartContext(partId, context, options) {
  context = await super._preparePartContext(partId, context, options);      // sets context.partId
  if ( partId in (context.tabs ?? {}) ) context.tab = context.tabs[partId];
  if ( partId === "footer" ) context.buttons = [{type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save"}];
  return context;
}
```
The context object is shared and mutated across parts (core recommends it). Templates see only what you put in it; class
instances (Documents, DataModels) keep prototype getters, so `{{actor.name}}` works. Give `{{#each}}` plain arrays, not
Maps/Collections.

### 3.6 Header controls

```js
static DEFAULT_OPTIONS = {
  actions: { toggleMode: MySheet.#onToggleMode },
  window: { controls: [{
    icon: "fa-solid fa-pen-to-square", label: "MYSYS.ToggleEditMode", action: "toggleMode",
    visible: function() { return this.isEditable; },       // this = app (use `function`)
    ownership: "OWNER"                                      // DocumentSheetV2 only: hide below this permission
  }] }
};
_getHeaderControls() {                                      // runtime customization
  const controls = super._getHeaderControls();              // copy of options.window.controls
  controls.findSplice(c => c.action === "configureSheet");  // drop an inherited entry (arrays concatenate, so do it here)
  return controls;
}
```
Entries show in the kebab (three-dot) menu, itself a `ContextMenu`. An entry needs an `action` present in `actions`, **or** an
`onClick(event, target)`. `_getFrameButtons()` adds real header buttons (rare). Modules extend any app with hook
`getHeaderControls{ClassName}(app, controls)`.

---------------------------------------------------------------------------------------------------

## 4. Actions and forms

### 4.1 Actions

```hbs
<button type="button" data-action="rollAbility" data-ability="str">Roll</button>
```
```js
static DEFAULT_OPTIONS = { actions: {
  rollAbility: MySheet.#onRollAbility,                              // left click
  openItem: { handler: MySheet.#onOpenItem, buttons: [0, 2] }       // left + right (1 = middle)
} };
/** @this {MySheet} @param {PointerEvent} event @param {HTMLElement} target element carrying data-action */
static async #onRollAbility(event, target) { const key = target.dataset.ability; /* this = sheet */ }
```
- One delegated `click`/`auxclick` listener on the frame: `event.target.closest("[data-action]")` then `handler.call(app, event, target)`.
  `target` is the element **with** the data-action, not the clicked child.
- Handlers: `static` methods (`static #private` is fine), never arrow functions. Click events only; `change`, `input`,
  `dragstart`, `contextmenu`, `dblclick`, `keydown` need `_onRender` listeners.
- Reserved names: `close`, `tab`, `toggleControls`, `detach`, `attach`; DocumentSheetV2 adds `configureSheet`, `configureOwnership`,
  `copyUuid`, `editImage`, `importDocument`; ActorSheetV2 adds `configureToken`, `configurePrototypeToken`,
  `showPortraitArtwork`, `showTokenArtwork`. Unknown actions fall to `_onClickAction(event, target)`.

### 4.2 Forms (non-document apps)

```js
static DEFAULT_OPTIONS = {
  tag: "form",
  window: { contentClasses: ["standard-form"] },
  form: { handler: MyForm.#onSubmit, submitOnChange: false, closeOnSubmit: true }
};
/** @this {MyForm} @param {SubmitEvent|Event} event @param {HTMLFormElement} form @param {FormDataExtended} formData */
static async #onSubmit(event, form, formData) {
  await game.settings.set("mysys", "config", foundry.utils.expandObject(formData.object));   // {"a.b": 1} -> {a: {b: 1}}
}
```
- Throwing from the handler shows an error toast and prevents `closeOnSubmit`. `app.submit(opts)` calls the handler (opts = 4th arg).
- `FormDataExtended` rules: `number`/`range` -> Number (`""` -> `null`); checkbox -> boolean (a checkbox with a `value` attribute
  yields that value or `null` unless `data-dtype="Boolean"`); `select[multiple]` -> array; radio -> checked value; repeated `name`
  -> array; `<img data-edit>` -> `src`; other `[data-edit]` -> `innerHTML`; disabled fields and buttons skipped;
  `data-dtype="Number|Boolean|String|JSON"` forces a cast; form-associated custom elements (`prose-mirror`, `multi-select`,
  `file-picker`...) participate.
- Submit footer: part `footer: {template: "templates/generic/form-footer.hbs"}` with part context
  `buttons: [{type: "submit", icon, label, name, action, cssClass, disabled, tooltip}]`.
- `_onChangeForm(formConfig, event)` runs on every `change` in the form; override (call super) for live previews.

---------------------------------------------------------------------------------------------------

## 5. Tabs

Declarative config, one entry **per tab group** (`ApplicationTabsConfiguration`):

```js
static TABS = {
  primary: {                                            // group id
    tabs: [
      { id: "stats", icon: "fa-solid fa-dice-d20" },    // optional: label, tooltip, cssClass
      { id: "items", icon: "fa-solid fa-suitcase", label: "MYSYS.Backpack" }
    ],
    initial: "stats",
    labelPrefix: "MYSYS.TABS"                           // label defaults to `${labelPrefix}.${id}`
  }
};
```
- `this.tabGroups` (`{primary: "stats"}`) holds the active tab per group; initialized from `initial`, updated by `changeTab`,
  **persists for the instance's life** (a cached `document.sheet` remembers its tab after close). Override the field
  `tabGroups = {primary: "items"}` to start elsewhere.
- Base `_prepareContext` adds `context.tabs` **only with exactly one group**. With several groups build it yourself:
  `context.tabs = {...this._prepareTabs("primary"), ...this._prepareTabs("secondary")}` (entries: `{group, id, active, cssClass,
  label, icon, tooltip}` keyed by id).
- Nav: the core part `templates/generic/tab-navigation.hbs` (iterates `tabs`; optional `tabClasses`, `verticalTabs`) or
  `<nav class="tabs"><a data-action="tab" data-group="primary" data-tab="stats">`.
- Content (one part per tab; set `context.tab` in `_preparePartContext`):
  `<section class="tab stats {{tab.cssClass}}" data-group="{{tab.group}}" data-tab="{{tab.id}}">`. Core CSS hides
  `.tab[data-tab]:not(.active)`; `cssClass` includes `active` so re-renders keep the right tab visible.
- `changeTab(tab, group, {event, navElement, force, updatePosition})`; programmatic: `app.changeTab("items", "primary")` or
  `app.render({tab: "items"})`.
- `height: "auto"` windows resize when tabs differ in height: set a fixed `position.height` and `resizable: true`.
- Do **not** copy swade's/Sidebar's flat `TABS = {tabId: {id, group, label}}`: those apps override `_prepareContext`; with core's
  base implementation a flat map with exactly one key throws (`tabs` undefined).

---------------------------------------------------------------------------------------------------

## 6. DocumentSheetV2, ActorSheetV2, ItemSheetV2

```js
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2, ItemSheetV2 } = foundry.applications.sheets;
class MyActorSheet extends HandlebarsApplicationMixin(ActorSheetV2) {}
class MyItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {}
```

### 6.1 What you get

`DocumentSheetV2.DEFAULT_OPTIONS`: `tag: "form"`, `id: "{id}"`, `classes: ["sheet"]`, `document: null`, `viewPermission: LIMITED`,
`editPermission: OWNER`, `canCreate: false`, `canImport: true`, `sheetConfig: true`, `ownershipConfig: true`,
`form: {handler, submitOnChange: false, closeOnSubmit: false}`. ActorSheetV2 adds width 600 + token/artwork header controls;
ItemSheetV2 width 480.

| Member | Notes |
|---|---|
| `this.document` / `this.actor` / `this.item` | `ItemSheetV2#actor` = owning actor or `null`; `ActorSheetV2#token` for unlinked tokens |
| `this.isEditable` | compendium not locked **and** user has `editPermission`. When false, `_onRender` disables every control |
| `this.isVisible` | `viewPermission`; `_canRender` warns users below it |
| `get title()` | `"<Type label>: <name>"`; override for custom titles |
| context from `super._prepareContext` | `document`, `model` (same), `source` (`document._source`, raw stored data), `fields` (`document.schema.fields`), `editable`, `user`, `rootId`, `tabs` (single group) |
| auto re-render | `document.apps[id]`; any update of the document or its embedded docs calls `app.render(false, {renderContext: "updateItem" ..., renderData})`. Pass `{render: false}` in document operations to suppress |
| submit pipeline | `_processFormData` -> `expandObject(formData.object)`; `_prepareSubmitData` (merges `updateData`, runs `document.validate`); `_processSubmitData` -> `document.update(submitData, options)`. Override these, not the handler |

`await this.submit({updateData: {"system.hp.value": 0}})` merges extra data into the form submit; other option keys go to
`document.update` as operation options.

### 6.2 Context conventions

```js
async _prepareContext(options) {
  const context = await super._prepareContext(options);
  const system = this.document.system;
  Object.assign(context, {
    actor: this.document,
    system,                                 // prepared (derived) data: DISPLAY
    systemFields: system.schema.fields,     // DataFields: INPUTS (name="system.x.y", labels, constraints)
    items: this.actor.items.contents.sort((a, b) => a.sort - b.sort)    // plain, sorted array (needed for drag-sort)
  });
  return context;                           // context.source.system.x = raw stored value: EDIT this
}
```
Bind inputs to `source.system.*` (raw) and show `system.*` (derived); otherwise a derived value (e.g. effect-boosted max) is
written back to the database on any change.

### 6.3 Edit mode vs play mode

Per-instance UI state, not data (full version in section 18):
```js
#editMode = false;                                                       // in _prepareContext: context.editMode = this.#editMode && this.isEditable
static #onToggleMode() { this.#editMode = !this.#editMode; this.render(); }   // action wired to a header control
```
```hbs
{{formInput systemFields.hp.fields.max value=source.system.hp.max type="number" disabled=(not editMode)}}
```
`disabled` controls are skipped by `FormDataExtended`, so locked fields cannot change. Alternative: toggle a CSS class on the
frame in `_onRender` and let CSS show inputs vs text.

### 6.4 Embedded documents (item lists, effects)

- Create: `Item.implementation.create({name, type}, {parent: actor, renderSheet: true})` or the core dialog
  `Item.implementation.createDialog({}, {parent: actor}, {types: ["weapon"]})`; default names via
  `Item.implementation.defaultName({type, parent: actor})`.
- Edit `item.sheet.render({force: true})`; delete `item.deleteDialog()` (DialogV2 confirm) or `item.delete()`; update
  `item.update({"system.quantity": n})`; batch `actor.updateEmbeddedDocuments("Item", [{_id, ...}])`.
- Group by type: `actor.itemTypes.weapon`. Effects: `actor.effects` or `[...actor.allApplicableEffects()]` (includes item effects).
- Row markup `data-item-id="{{item.id}}"` (+ `data-effect-id`, plus the parent item's `data-item-id` for item effects); resolve in
  actions with `this.actor.items.get(target.closest("[data-item-id]").dataset.itemId)`.
- Inline-edit an embedded item field: `<input data-item-field="system.quantity">` **without `name`** and a `change` listener in
  `_onRender` that calls `event.stopPropagation()` then `item.update(...)` (else the change bubbles into `submitOnChange`).
- Actor sheets re-render for every embedded create/update/delete; keep `_prepareContext` cheap and batch updates.

### 6.5 Item sheet (minimal)

```js
export default class MyItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = { classes: ["mysys", "item"], position: {width: 480, height: 420},
    window: {resizable: true}, form: {submitOnChange: true} };
  static PARTS = { body: { template: "systems/mysys/templates/item/item-sheet.hbs", scrollable: [""] } };
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.systemFields = this.item.system.schema.fields;
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.description, {secrets: this.item.isOwner, relativeTo: this.item, rollData: this.item.getRollData()});
    return context;
  }
}
```
```hbs
<div class="item-sheet">
  <header class="sheet-header">
    <img src="{{source.img}}" data-edit="img" data-action="editImage" alt="{{source.name}}">
    {{formInput fields.name value=source.name}}
  </header>
  {{formGroup systemFields.quantity value=source.system.quantity rootId=rootId}}
  {{formInput systemFields.description value=source.system.description enriched=descriptionHTML toggled=true}}
</div>
```

---------------------------------------------------------------------------------------------------

## 7. Registering sheets

In the `init` hook (calls before `game.ready` are queued and applied by `DocumentSheetConfig.initializeSheets()`):

```js
Hooks.once("init", () => {
  const { Actors, Items } = foundry.documents.collections;
  Actors.registerSheet("mysys", CharacterSheet, {
    types: ["character"],            // omit = all sub-types of the document class
    makeDefault: true,               // default for those types (a user's/world's Configure Sheet choice still wins)
    label: "MYSYS.Sheet.Character"   // key (localized) or a function returning a string
  });
  Items.registerSheet("mysys", MyItemSheet, { types: ["weapon", "armor"], makeDefault: true, label: "MYSYS.Sheet.Item" });
  // Any document class (JournalEntryPage, TokenDocument, ActiveEffect...):
  foundry.applications.apps.DocumentSheetConfig.registerSheet(JournalEntryPage, "mysys", MyPageSheet,
    { types: ["mysys.note"], makeDefault: true, label: "MYSYS.Sheet.Note" });
});
```
`DocumentSheetConfig.registerSheet(documentClass, scope, sheetClass, {label, types, themes, makeDefault=false,
canBeDefault=true, canConfigure=true})`; `Actors.registerSheet(scope, sheetClass, options)` is a shortcut.

- Sheet id = `` `${scope}.${sheetClass.name}` ``. Duplicate class names in one scope collide; minifiers that mangle class names
  break users' saved sheet choices and `render{ClassName}` hooks (esbuild: `keepNames: true`).
- `sheetClass` must extend `DocumentSheetV2` (or V1 `Application`), else it throws. `themes: null` = sheet does not support
  light/dark themes. `canBeDefault: false` / `canConfigure: false` hide it from pickers. `types` must exist in
  `game.documentTypes` (declared in `system.json` `documentTypes`) or you get "Unable to register sheet ... unknown sub-type".
- The last registration with `makeDefault` wins per type.
- **[v14]** Core registers **no** default Actor/Item sheet (`_registerDefaultSheets` covers Folder, JournalEntry, Macro, Playlist,
  RollTable, Scene, User and embedded-document config sheets). Types with no sheet fall back to the minimal
  `foundry.applications.sheets.BaseSheet`. So nothing needs unregistering for Actors/Items; to hide a core sheet elsewhere:
  `DocumentSheetConfig.unregisterSheet(CONFIG.Token.documentClass, "core", foundry.applications.sheets.TokenConfig, {types})`.
- `doc.sheet.render({force: true})` opens it (`sheet` builds `new SheetClass({document: doc})`). Unregistered helper sheets are fine:
  `new MyHelperSheet({document: doc}).render({force: true})`; the options **must** include `document`.

---------------------------------------------------------------------------------------------------

## 8. Form fields, editors, images, enrichment

### 8.1 `formInput` / `formGroup`

```hbs
{{!-- context: systemFields = this.document.system.schema.fields ; rootId from DocumentSheetV2 --}}
{{formGroup systemFields.hp.fields.value value=source.system.hp.value rootId=rootId}}
{{formGroup systemFields.hp.fields.max value=source.system.hp.max rootId=rootId label="MYSYS.MaxHP" localize=true hint="MYSYS.MaxHPHint"}}
{{formInput systemFields.hp.fields.value value=source.system.hp.value type="number" classes="hp-input"}}
{{formGroup systemFields.status value=source.system.status choices=statusChoices localize=true}}   {{!-- StringField w/ choices -> <select> --}}
```
- `{{formInput field ...hash}}` = `field.toInput(hash)` (`<input>`, `<select>`, `<prose-mirror>`, `<multi-select>`, `<file-picker>`,
  `<color-picker>`...). `{{formGroup}}` (alias `{{formField}}`) wraps it: `<div class="form-group"><label/><div class="form-fields">...</div><p class="hint"/></div>`.
- `name` defaults to `field.fieldPath` (`system.hp.value` for system model fields since `TypeDataModel.schema.name = "system"`);
  override with `name=`. **Always pass `value=`**: without it the input shows the field's *initial* value.
- Input hash: `value, name, id, classes ("a b"), placeholder, required, disabled, readonly, autofocus, localize, dataset=(object k=v),
  aria=(object label="x"), choices, type, min, max, step, elementType ("input"|"textarea"|"prose-mirror"|"code-mirror"|"file-picker")`.
  Group hash adds `label, hint, stacked, units, hidden, classes, rootId, widget`. Labels/hints default to the field's own
  (auto-localized through `LOCALIZATION_PREFIXES`, see `localization-and-styles.md`).
- **A NumberField with `min`, `max` and `step`/`integer` renders a `<range-picker>` slider.** Pass `type="number"` for a number box.
- Mapping: BooleanField -> checkbox, StringField{choices} -> select, Set/ArrayField of strings -> `multi-select`/`string-tags`,
  FilePathField -> `file-picker`, ColorField -> `color-picker`, HTMLField -> `prose-mirror`; SchemaField/ObjectField have no
  input (render children). A field class without form support throws `does not implement the _toInput method`.
- Non-schema values: `{{selectOptions}}`, `{{numberInput}}`, `{{checked}}`, plain `<input name>`. `templates/generic/form-fields.hbs`
  renders a `fields` list of `{field, value}` / `{fieldset, legend, fields}` nodes.

### 8.2 Rich text (HTMLField)

```js
context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
  this.document.system.biography,
  { secrets: this.document.isOwner, rollData: this.document.getRollData(), relativeTo: this.document });
```
```hbs
{{formInput systemFields.biography value=source.system.biography enriched=biographyHTML toggled=true}}   {{!-- editable --}}
<div class="biography">{{{biographyHTML}}}</div>                                                           {{!-- read-only --}}
```
- `enrichHTML` options: `secrets` (keep unrevealed `section.secret`; use `isOwner`), `documents`, `links`, `rolls`, `embeds`, `custom`
  (default true), `rollData` (object or function), `relativeTo` (document for relative UUIDs). Insert with `{{{ }}}`. Async: call in
  `_prepareContext`.
- Element: `<prose-mirror name="system.biography" [toggled] [collaborate]>` (`HTMLProseMirrorElement`). `toggled` = view mode with a
  pencil button (needs `enriched`), otherwise always editing. Config also takes `height` (px), `documentUUID`. It is
  form-associated and fires `change`, so `submitOnChange` saves it.
- **Do not use `{{editor}}` in ApplicationV2.** In v14 it only emits V1 markup (`<div class="editor"><div class="editor-content"
  data-edit>`) because `CONFIG.TextEditor.engines` is empty, and nothing in ApplicationV2 activates that div. Use `formInput` on an
  HTMLField or write `<prose-mirror name="system.notes" value="{{system.notes}}" toggled>{{{enrichedNotes}}}</prose-mirror>`.
- HTML fields stored in documents must be declared for server-side sanitizing in `system.json`:
  `"documentTypes": {"Actor": {"character": {"htmlFields": ["biography"]}}}`.
- Inline rolls, content links and secrets in enriched HTML are activated by global listeners; no per-sheet wiring.

### 8.3 Images

```hbs
<img class="profile" src="{{source.img}}" alt="{{source.name}}" data-edit="img" data-action="editImage">
```
`editImage` (DocumentSheetV2) opens a FilePicker for the path in `data-edit` (read from `document._source`), sets `img.src` and submits
if `submitOnChange`; `FormDataExtended` reads `img[data-edit]` `src` as the value. Any path works: `data-edit="system.portrait"`,
`data-edit="prototypeToken.texture.src"`. For schema fields `{{formInput fields.img value=source.img}}` renders a `<file-picker>`.
Enlarge art: `new foundry.applications.apps.ImagePopout({src, uuid, window: {title}}).render({force: true})`.

---------------------------------------------------------------------------------------------------

## 9. Handlebars: loading, helpers, partials

```js
const { loadTemplates, renderTemplate, getTemplate } = foundry.applications.handlebars;
await loadTemplates(["systems/mysys/templates/partials/stat-row.hbs"]);      // {{> "systems/mysys/templates/partials/stat-row.hbs"}}
await loadTemplates({ statRow: "systems/mysys/templates/partials/stat-row.hbs" });   // {{> statRow}}
const html = await renderTemplate("systems/mysys/templates/chat/card.hbs", { actor });   // string
const compiled = await getTemplate(path);                                   // compiled delegate (cached)
```
- Paths are relative to the Foundry URL root (`systems/<id>/...`, `modules/<id>/...`, core `templates/...`). Extension is free.
- The mixin preloads each part's `template` + `templates` on every `_preRender` (cached). Preload in `init` only for partials used
  outside application parts (chat cards, dialogs).
- Partials: `{{> "path/file.hbs"}}` (quote paths); pass a context `{{> "path" item}}` or hash `{{> "path" tab=tabs.summary}}` (extends the
  current context). Inline: `Handlebars.registerPartial("name", "<b>{{x}}</b>")`.
- Custom helpers: `Handlebars.registerHelper("mysysAdd", (a, b) => a + b)` in `init`; they are global, so prefix them; return
  `new Handlebars.SafeString(html)` for markup.
- Inside `{{#each}}` use `@root.x` or `../x`; `{{@index}} {{@key}} {{@first}} {{@last}}`. `{{{ }}}` = raw HTML (enriched text only); `{{ }}`
  escapes. `{{!-- --}}` renders nothing.

Helpers registered in v14 (`handlebars.mjs#initialize`):

| Helper | Usage |
|---|---|
| `localize` | `{{localize "KEY"}}`, `{{localize "KEY" name=x}}` (hash = format data) |
| `formInput`, `formGroup` (`formField`) | section 8.1 |
| `selectOptions` | `<select name="x">{{selectOptions choices selected=value localize=true blank="" sort=true valueAttr="id" labelAttr="name" inverted=false groups=g}}</select>`; choices: `{key: label}`, array of `{value,label,group,disabled}`, or array of strings (value = index) |
| `radioBoxes` | `{{radioBoxes "name" choices checked=value localize=true}}` |
| `numberInput` | `{{numberInput value name="x" step=1 min=0 max=10}}` |
| `numberFormat` | `{{numberFormat n decimals=2 sign=true}}` -> `+5.50` (warns on NaN; null -> NaN) |
| `checked`, `disabled` | `<input type="checkbox" name="x" {{checked flag}}>`, `<button {{disabled cond}}>` |
| `concat` | `{{concat "a." key ".b"}}`, `{{concat a b join=","}}` |
| `ifThen` | `{{ifThen cond "yes" "no"}}` |
| `object` | `(object label="X" id=1)` builds a hash (for `aria=`, `dataset=`) |
| `eq ne lt gt lte gte not and or` | `(eq a b)`, `(gt a 3)`, `(not x)`, `(and a b c)`, `(or a b)` (variadic and/or) |
| `timeSince` | relative time for timestamps |
| `editor` | V1-style markup, do not use in V2 (8.2) |
| `filePicker`, `rangePicker` | deprecated (v12 / v13): use `<file-picker>` / `<range-picker>` |
| Intl | `formatNumber`, `formatDate`, `formatTime`, `formatRelative`, `formatMessage`, `formatHTMLMessage`, `intl`, `intlGet` |

Handlebars built-ins (`if`, `unless`, `each`, `with`, `lookup`, `log`) also work. There is no `{{times}}`, `{{sum}}`, `{{json}}`:
compute in `_prepareContext`.

---------------------------------------------------------------------------------------------------

## 10. Drag and drop

### 10.1 ActorSheetV2 / ItemSheetV2 built-ins (verified in `actor-sheet.mjs`, `item-sheet.mjs`)

- A `DragDrop` (`this._dragDrop`) with `dragSelector: ".draggable"`, no `dropSelector` (the whole app is the drop target), bound in
  `_onRender`. **Draggable rows need the CSS class `draggable`** (the API docs only mention the data attribute; the binding uses the
  class) **and** `data-item-id` (or `data-effect-id`, plus the parent item's `data-item-id` for item-owned effects). `bind` sets
  `draggable="true"` for you.
  ```hbs
  <li class="item draggable" data-item-id="{{item.id}}">...</li>
  <li class="effect draggable" data-effect-id="{{effect.id}}" data-item-id="{{effect.parent.id}}">...</li>
  ```
- Overridable: `_canDragStart(selector)` (true), `_canDragDrop(selector)` (`isEditable`), `_onDragStart(event)` (writes `document.toDragData()`
  JSON to `text/plain`; skips targets with `data-link`), `_onDragOver(event)`, `_onDrop(event)`.
- `_onDrop` parses `TextEditor.implementation.getDragEventData(event)`, fires `Hooks.call("dropActorSheetData", actor, sheet, data)`
  (`false` cancels; `dropItemSheetData` on items), resolves `documentClass.fromDropData(data)`, and calls `_onDropDocument(event, doc)`:
  `_onDropActiveEffect` (creates it on the actor), `_onDropActor` (**does nothing** by default), `_onDropItem` (same actor -> `_onSortItem`;
  else creates a copy, using `game.items.fromCompendium` for compendium items), `_onDropFolder` (**does nothing**), and `_onSortItem`
  (sibling `[data-item-id]` elements + `foundry.utils.performIntegerSort`: sort context arrays by `sort` and keep rows as siblings).
  ItemSheetV2 only handles ActiveEffect drops.

```js
async _onDropItem(event, item) {                      // restrict what an actor accepts
  if ( !["weapon", "armor", "gear"].includes(item.type) ) {
    ui.notifications.warn("MYSYS.CannotCarry", {localize: true});
    return null;
  }
  return super._onDropItem(event, item);
}
async _onDragStart(event) {                           // custom payload (e.g. an ability for a hotbar macro)
  const el = event.currentTarget;
  if ( !el.dataset.ability ) return super._onDragStart(event);
  event.dataTransfer.setData("text/plain",
    JSON.stringify({type: "mysys.ability", uuid: this.actor.uuid, ability: el.dataset.ability}));
}
```

### 10.2 Plain ApplicationV2 apps

No built-in DnD; `DEFAULT_OPTIONS.dragDrop` seen in some packages (swade, the community wiki) is their own convention, not core API.

```js
#dragDrop = new foundry.applications.ux.DragDrop.implementation({
  dragSelector: "[data-drag]", dropSelector: ".drop-zone",
  permissions: { dragstart: () => true, drop: () => true },
  callbacks: { dragstart: this._onDragStart.bind(this), drop: this._onDrop.bind(this) }
});
async _onRender(context, options) { await super._onRender(context, options); this.#dragDrop.bind(this.element); }   // every render
async _onDrop(event) {
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);   // parsed JSON
  const doc = await fromUuid(data.uuid);
}
```
Drag source: `event.dataTransfer.setData("text/plain", JSON.stringify(doc.toDragData()))`. Re-bind in `_onRender` (elements are replaced).

---------------------------------------------------------------------------------------------------

## 11. ContextMenu

```js
async _onFirstRender(context, options) {
  await super._onFirstRender(context, options);
  // handler runs with this = app; menu is bound to this.element and delegated by selector, so create it ONCE
  this._createContextMenu(this._getItemContextOptions, ".item[data-item-id]", { fixed: true });
}
_getItemContextOptions() {
  return [{
    label: "MYSYS.Edit", icon: "fa-solid fa-pen", group: "primary",
    visible: target => this.isEditable,                         // boolean or fn(target: HTMLElement)
    onClick: (event, target) => this.actor.items.get(target.dataset.itemId)?.sheet.render({force: true})
  }];
}
```
- `_createContextMenu(handler, selector, {container = this.element, hookName = "get{}ContextOptions", parentClassHooks, ...menuOptions})`
  passes `jQuery: false` for you and fires `get{ClassName}ContextOptions(app, menuItems)` so modules can extend it; returns `null` for an
  empty list. Menu options: `eventName` ("contextmenu"), `fixed` (viewport-positioned; use inside scrolling windows), `relative`
  ("cursor"|"target"), `onOpen(target)`, `onClose(target)`, `classes`, `closeOnSelect`.
- Direct: `new foundry.applications.ux.ContextMenu.implementation(container, selector, items, {jQuery: false, fixed: true})`.
  **Always pass `jQuery: false`**: omitted = jQuery callback args plus a deprecation warning in this build.
- **[v14]** entry keys: `name` -> `label`, `callback(target, event)` -> `onClick(event, target)`, `condition` -> `visible`. Old keys still work
  with a warning (since 14, until 16). For packages that must also run on v13, supply both spellings (wrap one function for
  `callback`/`onClick`; the argument order differs).

---------------------------------------------------------------------------------------------------

## 12. DialogV2

`foundry.applications.api.DialogV2`: an ApplicationV2 rendering a `<dialog>` that contains a `<form>`.

```js
const { DialogV2 } = foundry.applications.api;
const { FormDataExtended } = foundry.applications.ux;

// Yes/No -> true | false | null (dismissed). "No" is the default (autofocus) button.
const proceed = await DialogV2.confirm({
  window: { title: "MYSYS.Reset.Title", icon: "fa-solid fa-triangle-exclamation" },
  content: `<p>${_loc("MYSYS.Reset.Prompt")}</p>`,
  yes: { label: "MYSYS.Reset", callback: () => true },        // merged over the default yes/no buttons
  rejectClose: false, modal: true                              // modal blocks the rest of the UI
});

// One OK button -> button action ("ok") or callback return; null if dismissed
await DialogV2.prompt({ window: {title: "X"}, content: "<p>Done.</p>", ok: { label: "MYSYS.Continue" } });

// Form input -> FormDataExtended.object of the dialog form (flat keys); null if dismissed
const data = await DialogV2.input({
  window: { title: "MYSYS.Damage" },
  content: `<div class="form-group"><label>${_loc("MYSYS.Amount")}</label>
            <div class="form-fields"><input type="number" name="amount" value="1" min="0" autofocus></div></div>`,
  ok: { label: "MYSYS.Apply", icon: "fa-solid fa-heart-crack" }
});

// Custom: any buttons, per-button callbacks, listeners in `render`
const choice = await DialogV2.wait({
  window: { title: "MYSYS.Roll.Title" }, position: { width: 420 },
  content: await foundry.applications.handlebars.renderTemplate("systems/mysys/templates/dialog/roll.hbs", { abilities }),
  buttons: [
    { action: "roll", label: "MYSYS.Roll", icon: "fa-solid fa-dice-d20", default: true,
      callback: (event, button, dialog) => new FormDataExtended(button.form).object },
    { action: "cancel", label: "COMMON.Cancel", type: "button" }
  ],
  render: (event, dialog) => dialog.element.querySelector("select")?.focus(),   // sync; on every render
  close: (event, dialog) => {},                                                  // sync; on any close
  rejectClose: false
});
if ( choice === null || choice === "cancel" ) return;
```
- Button: `{action (required, unique), label, icon, class, style, type ("submit" default | "button"), disabled, tooltip, default,
  callback(event, button, dialog)}` (callback may be async). Result = callback return (unless `null`/`undefined`), else the `action` string.
- `button.form` is the dialog's `<form>` (`new FormDataExtended(button.form).object`); `dialog.element` is the `<dialog>`.
- `content`: a **string** goes through `foundry.utils.cleanHTML` (strips `<script>`, `on*` attributes, unknown tags; keeps form controls, the
  custom elements `prose-mirror`/`file-picker`/`multi-select`..., `data-*`, `class`, `style`). An **attribute-less `HTMLDivElement`** skips
  cleaning (for trusted generated markup). Attach listeners in `render`, never inline.
- Dismissal (X, Escape) resolves `null`; with `rejectClose: true` it rejects with `Error("Dialog was dismissed without pressing a button.")`.
  In `confirm`, `false` is the No button, `null` is dismissal.
- Every button click submits and closes the dialog (`form.closeOnSubmit` defaults true); pass `form: {closeOnSubmit: false}` to keep it open.
- Class form: `new DialogV2({window, content, buttons, submit: (result, dialog) => {}}).render({force: true})`.
  `DialogV2.query(user, "confirm"|"prompt"|"input"|"wait", config)` asks another connected user (no callbacks over the wire).
- **`render` / `close` / `rejectClose` are `wait()` options, not constructor options.** `new DialogV2({render, close})` silently
  ignores them. With the class form, use `dialog.addEventListener("render", ...)` / `dialog.addEventListener("close", ...)`
  (verify: `DialogV2.wait` in `client/applications/api/dialog.mjs`).
- V1 mapping: `title` -> `window.title`; `buttons` object -> array with `action`; `default: "key"` -> `default: true` on the button; `render(html)` ->
  `render(event, dialog)`; `close` -> `close` option / `rejectClose`. `Document#deleteDialog()` / `createDialog()` already use DialogV2.

---------------------------------------------------------------------------------------------------

## 13. Hooks and injecting UI into core apps

Render-style hooks fire once per class in the inheritance chain (up to `BASE_APPLICATION`), with the class name substituted:

| Hook | Arguments |
|---|---|
| `renderApplicationV2`, `render{ClassName}` | `(app, element: HTMLElement, context, options)` |
| `preRender{ClassName}` | `(app, context, options)` |
| `close{ClassName}` | `(app)` |
| `getHeaderControls{ClassName}` | `(app, controls)` push/splice entries |
| `get{ClassName}ContextOptions` | `(app, menuItems)` (from `_createContextMenu`) |
| `dropActorSheetData` / `dropItemSheetData` | `(document, sheet, data)`; `false` cancels |
| `openDetachedWindow` / `closeDetachedWindow` | `(id, win)` **[v14]** |
| `renderChatMessageHTML` | `(message, html: HTMLElement, context)` (jQuery `renderChatMessage` still fires, deprecated, until v15) |

`html` is **never jQuery** for V2. `renderActorSheet` / `renderItemSheet` (no `V2`) fire only for V1 sheets. `renderActorSheetV2` fires for
every system's actor sheets: filter on `app.document.type` or `app instanceof MySheet`. Hook names come from `class.name`; anonymous or
minified classes are skipped.

```js
// Add a button to the Actor directory header
Hooks.on("renderActorDirectory", (app, element, context, options) => {
  if ( !options.parts?.includes("header") ) return;                  // header part not re-rendered => button is still there
  const actions = element.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".mysys-button") ) return;  // idempotent
  const button = document.createElement("button");
  button.type = "button";
  button.className = "mysys-button";
  button.innerHTML = `<i class="fa-solid fa-dice" inert></i><span>${_loc("MYSYS.Generate")}</span>`;
  button.addEventListener("click", () => new GeneratorApp().render({force: true}));
  actions.append(button);
});

// Add an entry to every actor sheet's header menu
Hooks.on("getHeaderControlsActorSheetV2", (app, controls) => {
  controls.push({ icon: "fa-solid fa-star", label: "MYMOD.Favorite", action: "myModFavorite",
    onClick: () => app.document.setFlag("my-module", "favorite", true) });   // no registered action => needs onClick
});

// Extend a core context menu (directory hook name = get<Document>ContextOptions)
Hooks.on("getActorContextOptions", (app, menuItems) => {
  menuItems.push({ label: "MYMOD.Duplicate", icon: "fa-solid fa-copy", visible: li => game.user.isGM,
    onClick: (event, li) => game.actors.get(li.dataset.entryId)?.clone({}, {save: true}) });
});

// Scene control tool that toggles an app (controls is an object keyed by control name) [v13+]
Hooks.on("getSceneControlButtons", controls => {
  controls.tokens.tools.myTool = { name: "myTool", title: "MYSYS.Tool", icon: "fa-solid fa-wrench",
    order: Object.keys(controls.tokens.tools).length, button: true, visible: game.user.isGM,
    onChange: () => { const app = foundry.applications.instances.get("mysys-tool"); app ? app.close() : new MyTool().render({force: true}); } };
});
```
Core sidebar tabs are ApplicationV2 classes: `ActorDirectory`, `ItemDirectory`, `JournalDirectory`, `ChatLog`, `CombatTracker`, `Settings`,
`CompendiumDirectory`, `Sidebar`; also `Hotbar`, `Players`, `SceneControls`, `SceneNavigation`. Directory parts are `header`, `directory`,
`footer`; `options.parts` says which were just rendered. Because parts re-render independently, injected DOM must be idempotent.
Prefer a hook + element query to replacing a core class; if you must replace, use the CONFIG registries (`CONFIG.ui.*`,
`CONFIG.Token.hudClass`, `CONFIG.ux.*`) and subclass the core class.

---------------------------------------------------------------------------------------------------

## 14. Non-document apps

### 14.1 Settings menu (form app)

```js
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class HouseRulesMenu extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "mysys-house-rules", tag: "form",
    window: { title: "MYSYS.HouseRules.Title", icon: "fa-solid fa-gavel", contentClasses: ["standard-form"] },
    position: { width: 480 },
    form: { handler: HouseRulesMenu.#onSubmit, closeOnSubmit: true }
  };
  static PARTS = {
    body:   { template: "systems/mysys/templates/apps/house-rules.hbs", root: true },     // root part must be first
    footer: { template: "templates/generic/form-footer.hbs" }
  };
  async _prepareContext(options) {
    return { rules: game.settings.get("mysys", "houseRules"),
      buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "SETTINGS.Save" }] };
  }
  static async #onSubmit(event, form, formData) {
    await game.settings.set("mysys", "houseRules", foundry.utils.expandObject(formData.object));
  }
}

Hooks.once("init", () => {
  game.settings.register("mysys", "houseRules", { scope: "world", config: false, type: Object, default: {} });
  game.settings.registerMenu("mysys", "houseRulesMenu", {
    name: "MYSYS.HouseRules.Name", label: "MYSYS.HouseRules.Label", hint: "MYSYS.HouseRules.Hint",
    icon: "fa-solid fa-gavel", type: HouseRulesMenu, restricted: true                      // restricted = GM only
  });
});
```
```hbs
<div class="form-group">
  <label for="mysys-crit">{{localize "MYSYS.HouseRules.Crit"}}</label>
  <div class="form-fields"><input id="mysys-crit" type="checkbox" name="critOnMax" {{checked rules.critOnMax}}></div>
</div>
```
`type` must be an ApplicationV2 (or V1 FormApplication) **class**; core does `new menu.type()` then `render(true)`, so the constructor must work
without arguments. Dotted names (`name="a.b"`) become nested objects through `expandObject`.

### 14.2 Singleton with live refresh

```js
class Tracker extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { id: "mysys-tracker", window: { title: "MYSYS.Tracker" }, position: { width: 320 } };
  static PARTS = { main: { template: "systems/mysys/templates/tracker.hbs", root: true } };

  static show() {                                                       // reuse the instance for this id
    const app = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id) ?? new this();
    return app.render({ force: true });
  }
  #hooks = [];
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    for ( const name of ["updateActor", "createChatMessage"] ) this.#hooks.push([name, Hooks.on(name, () => this.render())]);
  }
  _onClose(options) {
    super._onClose(options);
    for ( const [name, id] of this.#hooks ) Hooks.off(name, id);        // always unregister or you leak
    this.#hooks = [];
  }
}
```
A second `new Tracker().render({force: true})` would replace the DOM element with the same id (registry is last-wins), so look the instance up
first. `render()` without force on a closed app is a no-op.

### 14.3 Frameless / HUD-style apps

```js
class Banner extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = { id: "mysys-banner", tag: "aside", classes: ["mysys-banner"],
    window: { frame: false, positioned: false } };                      // no chrome; place with CSS (position: fixed)
  static PARTS = { main: { template: "systems/mysys/templates/banner.hbs", root: true } };
  _insertElement(element) {                                             // default appends to <body>; core UI lives in #interface
    const existing = document.getElementById(element.id);
    if ( existing ) existing.replaceWith(element); else document.getElementById("interface").append(element);
  }
}
```
Read: `ui/game-pause.mjs` (custom `_renderHTML`/`_replaceHTML`, no Handlebars), `ui/players.mjs` (frameless root part), `ui/main-menu.mjs` (`tag: "dialog"`),
`hud/placeable-hud.mjs` (`frame: false, positioned: true` plus `_updatePosition` override tracking a canvas object; replace via
`CONFIG.Token.hudClass`). Frameless apps need their own close button (`data-action="close"` is built in).
Without Handlebars: implement `_renderHTML(context, options)` and `_replaceHTML(result, content, options)`; both must be overridden or `render` throws.

---------------------------------------------------------------------------------------------------

## 15. Pop-out windows [v14]

Framed ApplicationV2 apps get "Detach"/"Re-attach" header controls (`foundry.applications.detached`). For package code:

- Use `this.element.ownerDocument` / `.defaultView`, not the global `document`/`window`, for anything location-dependent (creating nodes,
  `getSelection`, window listeners, `requestAnimationFrame`, measuring). Listeners registered on the main `document` do not see pop-out events.
- Stylesheets (`<link rel=stylesheet>`, `<style>`) present at open time are copied; custom elements are re-registered; `body.detached` is set.
- Overridable: `_canDetach()`, `_canAttach()`, `_onDetach(from, to)`, `_onAttach(from, to)`; API: `app.detachWindow()`, `app.attachWindow()`,
  `render({window: {detached: true}})`.
- `parent.renderChild(childApp, options)` renders a child in the parent's window and closes it with the parent (DocumentSheetV2 uses it for
  Configure Sheet / Ownership). Use it for helper dialogs that belong to a sheet.
- Cross-window DOM lookup: `foundry.applications.detached.querySelector(All)(selector)`. Hooks: `openDetachedWindow`, `closeDetachedWindow`.

---------------------------------------------------------------------------------------------------

## 16. Styling applications

Layers, scoping, themes, CSS variables, manifest `styles` and fonts are covered in `localization-and-styles.md` sections 8-9. ApplicationV2 specifics:

- Core layer order: `reset, variables, elements, blocks, applications, compatibility, layouts, system, modules, exceptions`. Default-layer system CSS
  already beats core `applications` rules without `!important`; unlayered CSS (`layer: null`) beats every layer.
- DOM: `<form|div id class="application sheet <your classes> [themed theme-dark]">` -> `<header class="window-header">` +
  `<section class="window-content <contentClasses>">` holding your parts. Scope with `classes: ["mysys", "character"]`.
- `.window-content` is `display:flex; flex-flow:column nowrap; overflow:hidden; padding: var(--spacer-16)`. Parts are flex children, so **a tall part
  needs its own scroll container** (`flex: 1; min-height: 0; overflow-y: auto`, or core `.scrollable`) and an entry in the part's `scrollable`.
- `window.contentClasses: ["standard-form"]` enables core form layout (`.form-group`, `.form-fields`, `.hint`, `fieldset`, `.form-footer`,
  `img[data-edit]`, `.tab`). Core CSS hides `.tab[data-tab]:not(.active)`; never set `display` on `.tab` without `.active`.
- Utilities: `.flexrow`, `.flexcol`, `.scrollable`, `.hidden`, `.inline-control` (combine with `class="inline-control icon fa-solid fa-trash"` on a
  `<button>`), `nav.tabs` (`.vertical`, `.top-tabs`), `.form-footer` (inside `.standard-form`), `.notification`. There is no generic `.sheet-header` style: write your own.
- Variables: `--spacer-2/4/8/12/16`, `--font-size-10..80`, `--color-text-primary/secondary/emphatic/subtle`, `--color-border`, `--background`,
  `--color-form-label`, `--color-form-hint`, `--input-height`, `--button-*`. Body gets `theme-dark|theme-light`; elements opt in with
  `themed theme-x`. Theme override: `body.theme-dark .mysys, .mysys.themed.theme-dark { ... }`.
- Icons are Font Awesome (`fa-solid`, `fa-regular`, `fa-duotone`, `fa-brands`). **[v14]** ships Font Awesome 7 Pro (v13: 6): re-check glyph names.
  Put `inert` on `<i>` inside buttons/links.
- `data-tooltip="KEY.OR.TEXT"` is localized by the tooltip manager when the string is a known key; `data-tooltip-direction` = `UP|DOWN|LEFT|RIGHT|CENTER`;
  add `aria-label` to icon-only buttons.
- Fonts: `@font-face` in your stylesheet (paths relative to the CSS file or absolute `systems/<id>/...`) and set `font-family` on your app class.
- Native CSS nesting works. Prefix classes and custom properties with the package id.

---------------------------------------------------------------------------------------------------

## 17. Pitfalls

| Symptom | Cause / fix |
|---|---|
| Opening the sheet does nothing | `render()` without `force` on a closed app. Use `render({force: true})`. |
| `Template part "x" must render a single HTML element` | Zero or 2+ top-level elements. Wrap, or make the first part `root: true`. |
| `Failed to load template` | Wrong path: relative to the Foundry URL root (`systems/<id>/templates/x.hbs`), case-sensitive on Linux. |
| `The partial ... could not be found` | Add it to the part's `templates: []` (or `loadTemplates` it); quote the path in `{{> "..."}}`. |
| Clicking a button submits the form | `<button>` defaults to `type="submit"`. Use `type="button"`. |
| `this` wrong/undefined in an action | Arrow function or detached method. Use `static` methods in `actions`. |
| Action never fires | Typo in `data-action`; handler missing from the instantiated class's `actions`; event is not a click (use `_onRender`); right-click needs `{handler, buttons: [2]}`. |
| Sheet doesn't save on change | `form.submitOnChange` defaults to `false`. Set it, or add a submit footer. |
| Sheet doesn't refresh when the document changes | Overrode `_onFirstRender` without `await super._onFirstRender(...)`, or the update used `{render: false}`. |
| All inputs show default values | `formInput`/`formGroup` without `value=`. |
| Slider instead of a number box | NumberField with `min`+`max`+`step`/`integer`; add `type="number"`. |
| Derived numbers written to the database | Inputs bound to `system.x` (prepared) instead of `source.system.x` (raw). |
| Focus lost after typing / blur | Re-render after `submitOnChange`. Focus restores by element `id` or `name`: give every input one (custom widgets may set `data-focus`). |
| Infinite re-render loop | Updating the document or calling `render()` from `_prepareContext`/`_onRender`, or a hook that re-renders on `updateActor` while `_onRender` writes to the actor. Diff first; use `{render: false}`. |
| `this.element` is `undefined`/`null` | Constructor, before first render, or after close. Use `_onFirstRender`/`_onRender`; guard with `this.element?.`. |
| `document.querySelector` finds nothing in `_attachPartListeners` | On first render the part is not in the document yet; query inside `htmlElement`. |
| Update silently does nothing / error toast | Empty number input -> `null` on a non-nullable field fails validation. Make it `nullable` or give a default; text inputs holding numbers need `data-dtype="Number"`. |
| Checkbox saves `null`/string | It has a `value=` attribute. Remove it or add `data-dtype="Boolean"`. |
| Array field loses entries | Arrays are replaced wholesale: submit every element and sub-field (`system.list.0.name`, `system.list.0.qty`; numeric keys are cast to an array by `ArrayField._cast`), use `multi-select`/`string-tags` for string arrays, or edit through explicit actions. |
| Embedded item input updates the actor | It has `name="..."`. Remove `name`, use `data-item-field` plus your own `change` listener with `stopPropagation()`. |
| Tab content invisible after re-render | Part lacks `{{tab.cssClass}}`/`data-group`/`data-tab`, or `context.tab` isn't set in `_preparePartContext`. |
| Window changes size between tabs | `height: "auto"` with unequal tabs. Fix `position.height`, `resizable: true`. |
| Part clipped / not scrolling | `.window-content` is `overflow:hidden`; give the part `overflow-y:auto; min-height:0` and list it in `scrollable`. |
| Header control missing | `action` not in `actions` and no `onClick`; `visible` false; `ownership` level not met; sheet not editable. |
| Hook never fires | V1 name (`renderActorSheet`), anonymous/minified class, or registered after the first render. |
| Dialog lost inline handlers | `cleanHTML` strips `on*`/`<script>`. Attach in the `render` callback or pass a `<div>` element. |
| `DialogV2.confirm` returns `null` | Dismissed, not "No" (`false`). Treat `null` as cancel. |
| Works in main window, broken in pop-out | Global `document`/`window` use; see section 15. |
| `ContextMenu is changing to no longer transact jQuery objects` | `ContextMenu` built without `jQuery: false`; use `_createContextMenu`. |
| `_loc` at module top level returns keys | Translations load at `i18nInit`. Call at runtime, or pass keys and let core localize. |

---------------------------------------------------------------------------------------------------

## 18. Complete example

Character sheet with header (portrait, name, HP), three tabs (stats / items / biography), edit-mode toggle in the header menu, item
create/edit/delete actions, inline quantity editing, drag-sort, an item context menu and an ability roll. System id `mysys`.
(JS syntax-checked as an ES module; all four templates compile with the bundled Handlebars.)

```
systems/mysys/  system.json  mysys.mjs  module/data.mjs  module/sheets/character-sheet.mjs
                templates/actor/{header,stats,items,biography}.hbs  styles/mysys.css  lang/en.json
```

### 18.1 Registration and data model

```js
// mysys.mjs
import CharacterSheet from "./module/sheets/character-sheet.mjs";
import { CharacterData } from "./module/data.mjs";
Hooks.once("init", () => {
  CONFIG.Actor.dataModels.character = CharacterData;
  foundry.documents.collections.Actors.registerSheet("mysys", CharacterSheet, {
    types: ["character"], makeDefault: true, label: "MYSYS.Sheet.Character"
  });
});
```
```js
// module/data.mjs: the minimum the sheet assumes (item types use system.quantity)
const { SchemaField, NumberField, HTMLField } = foundry.data.fields;
export class CharacterData extends foundry.abstract.TypeDataModel {
  static LOCALIZATION_PREFIXES = ["MYSYS.Actor.character"];       // field labels: MYSYS.Actor.character.hp.value.label ...
  static defineSchema() {
    const ability = () => new SchemaField({ value: new NumberField({ required: true, integer: true, min: 1, max: 20, initial: 10 }) });
    return {
      hp: new SchemaField({ value: new NumberField({ required: true, integer: true, min: 0, initial: 10 }),
                            max: new NumberField({ required: true, integer: true, min: 1, initial: 10 }) }),
      abilities: new SchemaField({ str: ability(), dex: ability(), wit: ability() }),
      biography: new HTMLField()
    };
  }
  prepareDerivedData() { for ( const ab of Object.values(this.abilities) ) ab.mod = Math.floor((ab.value - 10) / 2); }
}
```

### 18.2 `module/sheets/character-sheet.mjs`

```js
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TextEditor = foundry.applications.ux.TextEditor.implementation;

export default class CharacterSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  /** @inheritDoc */
  static DEFAULT_OPTIONS = {
    classes: ["mysys", "character"],
    position: { width: 640, height: 720 },
    window: {
      resizable: true,
      controls: [{
        icon: "fa-solid fa-pen-to-square", label: "MYSYS.ToggleEditMode", action: "toggleMode",
        visible: function() { return this.isEditable; }      // `this` is the app; not an arrow function
      }]
    },
    form: { submitOnChange: true },
    actions: {
      rollAbility: CharacterSheet.#onRollAbility,
      createItem: CharacterSheet.#onCreateItem,
      editItem: CharacterSheet.#onEditItem,
      deleteItem: CharacterSheet.#onDeleteItem,
      toggleMode: CharacterSheet.#onToggleMode
    }
  };

  /** @override */
  static PARTS = {
    header: { template: "systems/mysys/templates/actor/header.hbs" },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    stats: { template: "systems/mysys/templates/actor/stats.hbs", scrollable: [""] },
    items: { template: "systems/mysys/templates/actor/items.hbs", scrollable: [""] },
    biography: { template: "systems/mysys/templates/actor/biography.hbs", scrollable: [""] }
  };

  /** @override */
  static TABS = {
    primary: {
      tabs: [
        { id: "stats", icon: "fa-solid fa-dice-d20" },
        { id: "items", icon: "fa-solid fa-suitcase" },
        { id: "biography", icon: "fa-solid fa-book" }
      ],
      initial: "stats",
      labelPrefix: "MYSYS.TABS"          // labels: MYSYS.TABS.stats ...
    }
  };

  /** Fields are locked in play mode. Per-instance UI state, not saved on the Actor. */
  #editMode = false;

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);   // document, source, fields, editable, rootId, tabs
    const actor = this.actor;
    const systemFields = actor.system.schema.fields;
    return Object.assign(context, {
      actor,
      system: actor.system,                   // prepared (derived) data: display
      systemFields,                           // DataFields: inputs + labels
      editMode: this.#editMode && this.isEditable,
      abilities: Object.entries(actor.system.abilities).map(([key, ab]) => ({
        key, mod: ab.mod, value: ab.value, field: systemFields.abilities.fields[key].fields.value
      })),
      itemGroups: game.documentTypes.Item.filter(t => t !== CONST.BASE_DOCUMENT_TYPE).map(type => ({
        type, label: CONFIG.Item.typeLabels?.[type] ?? type,
        items: [...(actor.itemTypes[type] ?? [])].sort((a, b) => a.sort - b.sort)
      })),
      biographyHTML: await TextEditor.enrichHTML(actor.system.biography, {
        secrets: actor.isOwner, rollData: actor.getRollData(), relativeTo: actor
      })
    });
  }

  /** @override */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if ( partId in context.tabs ) context.tab = context.tabs[partId];   // tab parts: id/group/cssClass
    return context;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);    // DocumentSheetV2 registers itself in document.apps here
    // One-time and delegated: the frame survives re-renders, the matching rows are replaced.
    this._createContextMenu(this.#getItemContextOptions, ".item[data-item-id]", { fixed: true });
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);        // ActorSheetV2 binds drag/drop here
    // Embedded-item inputs carry no name="" (it would be submitted as Actor data) and don't reach submitOnChange.
    for ( const input of this.element.querySelectorAll("input[data-item-field]") ) {
      input.addEventListener("change", event => {
        event.stopPropagation();
        const value = input.type === "number" ? input.valueAsNumber : input.value;
        this.#getItem(input)?.update({ [input.dataset.itemField]: value });
      });
    }
  }

  #getItemContextOptions() {
    return [{
      label: "MYSYS.Edit", icon: "fa-solid fa-pen-to-square", visible: () => this.isEditable,
      onClick: (event, target) => this.#getItem(target)?.sheet.render({ force: true })
    }, {
      label: "MYSYS.Delete", icon: "fa-solid fa-trash", visible: () => this.isEditable,
      onClick: (event, target) => this.#getItem(target)?.deleteDialog()
    }];
  }

  #getItem(element) {
    return this.actor.items.get(element.closest("[data-item-id]")?.dataset.itemId);
  }

  /* Actions: this === the sheet instance */

  static async #onRollAbility(event, target) {
    const key = target.dataset.ability;
    const roll = await new Roll(`1d20 + @abilities.${key}.mod`, this.actor.getRollData()).evaluate();
    await roll.toMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      flavor: _loc("MYSYS.AbilityCheck", { ability: _loc(`MYSYS.Ability.${key}`) })
    });
  }

  static async #onCreateItem(event, target) {
    const type = target.dataset.type;
    await Item.implementation.create({ name: Item.implementation.defaultName({ type, parent: this.actor }), type },
      { parent: this.actor, renderSheet: true });
  }

  static #onEditItem(event, target) {
    this.#getItem(target)?.sheet.render({ force: true });
  }

  static async #onDeleteItem(event, target) {
    const item = this.#getItem(target);
    if ( event.shiftKey ) await item?.delete();          // shift-click skips the confirmation
    else await item?.deleteDialog();
  }

  static #onToggleMode() {
    this.#editMode = !this.#editMode;
    this.render();
  }
}
```

### 18.3 Templates (`templates/actor/`)

`header.hbs`
```hbs
<header class="sheet-header">
    <img class="profile" src="{{source.img}}" alt="{{source.name}}" data-edit="img" data-action="editImage">
    <div class="header-fields">
        <h1>{{formInput fields.name value=source.name placeholder=(localize "MYSYS.Name")}}</h1>
        <div class="resource">
            <span class="label">{{localize "MYSYS.HP"}}</span>
            {{formInput systemFields.hp.fields.value value=source.system.hp.value type="number"}}
            <span>/</span>
            {{formInput systemFields.hp.fields.max value=source.system.hp.max type="number" disabled=(not editMode)}}
        </div>
    </div>
</header>
```
`stats.hbs`
```hbs
<section class="tab stats {{tab.cssClass}}" data-group="{{tab.group}}" data-tab="{{tab.id}}">
    <ul class="abilities">
        {{#each abilities as |ab|}}
        <li class="ability">
            <a class="roll" data-action="rollAbility" data-ability="{{ab.key}}" data-tooltip="MYSYS.Roll">
                <i class="fa-solid fa-dice-d20" inert></i> {{localize (concat "MYSYS.Ability." ab.key)}}
            </a>
            {{formInput ab.field value=ab.value type="number" disabled=(not @root.editMode)}}
            <span class="mod">{{numberFormat ab.mod sign=true}}</span>
        </li>
        {{/each}}
    </ul>
</section>
```
`items.hbs`
```hbs
<section class="tab items {{tab.cssClass}}" data-group="{{tab.group}}" data-tab="{{tab.id}}">
    {{#each itemGroups as |group|}}
    <fieldset class="item-group">
        <legend>{{localize group.label}}</legend>
        <ol class="item-list">
            {{#each group.items as |item|}}
            <li class="item draggable" data-item-id="{{item.id}}">
                <img src="{{item.img}}" alt="" width="24" height="24">
                <a class="name" data-action="editItem">{{item.name}}</a>
                <input type="number" class="qty" value="{{item.system.quantity}}" data-item-field="system.quantity" min="0">
                <button type="button" class="inline-control icon fa-solid fa-trash" data-action="deleteItem"
                        data-tooltip="MYSYS.Delete" aria-label="{{localize "MYSYS.Delete"}}"></button>
            </li>
            {{/each}}
        </ol>
        <button type="button" data-action="createItem" data-type="{{group.type}}">
            <i class="fa-solid fa-plus" inert></i> {{localize "MYSYS.Create"}}
        </button>
    </fieldset>
    {{/each}}
</section>
```
`biography.hbs`
```hbs
<section class="tab biography {{tab.cssClass}}" data-group="{{tab.group}}" data-tab="{{tab.id}}">
    {{formInput systemFields.biography value=source.system.biography enriched=biographyHTML toggled=true}}
</section>
```

### 18.4 CSS and language keys

```css
/* styles/mysys.css: default `system` layer */
.mysys.character {
  .sheet-header { display: flex; gap: var(--spacer-12); align-items: center; flex: none; }
  .sheet-header img.profile { width: 72px; height: 72px; object-fit: cover; border-radius: 4px; cursor: pointer; }
  .resource { display: flex; align-items: center; gap: var(--spacer-4); input { width: 4rem; text-align: center; } }
  nav.tabs { flex: none; }
  .tab { flex: 1; min-height: 0; overflow-y: auto; padding-block: var(--spacer-8); }   /* .window-content is overflow:hidden */
  .abilities { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--spacer-8); list-style: none; margin: 0; padding: 0; }
  .item-list { list-style: none; margin: 0; padding: 0; }
  .item { display: flex; align-items: center; gap: var(--spacer-8); }
  .item .name { flex: 1; }
  .item .qty { width: 3.5rem; }
}
```
`lang/en.json` needs `MYSYS.Sheet.Character`, `MYSYS.TABS.{stats,items,biography}`, `MYSYS.ToggleEditMode`, `MYSYS.{Name,HP,Roll,Create,Edit,Delete}`,
`MYSYS.AbilityCheck` (`"{ability} check"`), `MYSYS.Ability.{str,dex,wit}`, plus the data-model labels under `MYSYS.Actor.character`.

What it demonstrates: one tab group so `super._prepareContext` supplies `tabs`; core `tab-navigation.hbs` as a part; per-part `context.tab` drives `.active`;
inputs bound to `source.*` with `type="number"` (no range sliders); `.draggable` + `data-item-id` give drag, drop and sort from `ActorSheetV2`;
nameless item inputs never leak into the Actor submit; context menu created once in `_onFirstRender`.

---------------------------------------------------------------------------------------------------

## 19. Verify-in-source index

Under `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/`:

| Topic | File |
|---|---|
| Options, lifecycle, actions, tabs, header controls, `_createContextMenu`, detach/`renderChild` | `client/applications/api/application.mjs` |
| `ApplicationConfiguration`, `ApplicationTabsConfiguration`, render options | `client/applications/_types.mjs` |
| PARTS, `root`, `scrollable`, `_preSyncPartState`, `_attachPartListeners` | `client/applications/api/handlebars-application.mjs` |
| DocumentSheetV2 (`_prepareSubmitData`, `_processSubmitData`, `editImage`, `isEditable`) | `client/applications/api/document-sheet.mjs` |
| ActorSheetV2 / ItemSheetV2 (drag/drop, header controls) | `client/applications/sheets/actor-sheet.mjs`, `item-sheet.mjs` |
| BaseSheet fallback | `client/applications/sheets/base-sheet.mjs`, `templates/sheets/base-sheet.hbs` |
| Reference form app (tabs + parts + footer) | `client/applications/sheets/active-effect-config.mjs`, `templates/sheets/active-effect/*.hbs` |
| DialogV2 | `client/applications/api/dialog.mjs` |
| Sheet registration | `client/applications/apps/document-sheet-config.mjs`, `client/documents/abstract/world-collection.mjs`, `client/applications/sheets/_module.mjs` |
| Handlebars helpers, template loading | `client/applications/handlebars.mjs` |
| Input builders / DataField forms | `client/applications/forms/fields.mjs`, `common/data/fields.mjs` (`toInput`, `toFormGroup`, `_toInput`) |
| Custom elements | `client/applications/elements/` |
| `FormDataExtended` casting | `client/applications/ux/form-data-extended.mjs` |
| `TextEditor.enrichHTML` | `client/applications/ux/text-editor.mjs` |
| DragDrop / ContextMenu / SearchFilter | `client/applications/ux/drag-drop.mjs`, `context-menu.mjs`, `search-filter.mjs` |
| Pop-out windows | `client/applications/detached/window-manager.mjs` |
| Hook signatures | `client/hooks.mjs` |
| Compat globals, V1 status | `client/client.mjs` (`addBackwardsCompatibilityReferences`), `client/appv1/api/application-v1.mjs` |
| Document re-render plumbing | `client/documents/abstract/client-document.mjs` |
| Settings menus | `client/helpers/client-settings.mjs#registerMenu`, `client/applications/settings/config.mjs`, `settings/menus/dice-config.mjs` |
| Frameless/HUD examples | `client/applications/ui/game-pause.mjs`, `ui/players.mjs`, `ui/main-menu.mjs`, `hud/placeable-hud.mjs` |
| CSS | `public/css/foundry2.css` |
| Real v14 system | `~/Library/Application Support/FoundryVTT/Data/systems/swade/swade.js` (+ `templates/`) |
