# Dice, chat messages, and combat (Foundry v14)

Verified against v14 build 369 source: `client/dice/roll.mjs`, `dice/terms/*`, `client/documents/chat-message.mjs`,
`common/documents/chat-message.mjs`, `client/documents/combat.mjs`, `combatant.mjs`, `client/applications/sidebar/tabs/chat.mjs`,
`client/config.mjs`, plus the v14-verified SWADE system. **[v13]** marks behaviour that differs.

## Table of contents
1. [Obsolete patterns and their replacements](#1-obsolete-patterns-and-their-replacements)
2. [Roll API](#2-roll-api)
3. [Formula syntax cheat sheet](#3-formula-syntax-cheat-sheet)
4. [Custom Roll classes, dice terms, modifiers, functions](#4-custom-roll-classes-dice-terms-modifiers-functions)
5. [Message modes (the v14 roll-mode replacement)](#5-message-modes)
6. [ChatMessage](#6-chatmessage)
7. [Interactive chat cards](#7-interactive-chat-cards)
8. [Typed chat messages and chat commands](#8-typed-chat-messages-and-chat-commands)
9. [Combat](#9-combat)
10. [Worked example: attack, card, damage](#10-worked-example-attack-card-damage)
11. [Dice So Nice notes](#11-dice-so-nice-notes)
12. [Verify-in-source pointers](#12-verify-in-source-pointers)

---

## 1. Obsolete patterns and their replacements

| Obsolete (do NOT write) | Modern replacement |
|---|---|
| `roll.roll()` expecting a sync result; `new Roll(f).roll({async:false})`; `evaluate({async:false})` | `await roll.evaluate()`; for deterministic formulas only: `roll.evaluateSync()`. The `async` option was removed (passing it logs a warning). `Roll#roll()` still exists but is just an async alias of `evaluate`, so never use it for sync. |
| Reading `roll.total` before evaluating | `roll.total` is `0` until `await roll.evaluate()`. Check `roll._evaluated` only in internals; normally just `await`. |
| `roll.toMessage(data, {rollMode: "gmroll"})`, `CONST.DICE_ROLL_MODES.PRIVATE`, `game.settings.get("core","rollMode")` | `roll.toMessage(data, {messageMode: "gm"})`, `game.settings.get("core","messageMode")`, keys of `CONFIG.ChatMessage.modes`: `public gm blind self ic`. Legacy names still map but log deprecation warnings (until v16). |
| `ChatMessage.create({type: CONST.CHAT_MESSAGE_TYPES.ROLL, roll: ..., user: game.user.id})` | `ChatMessage.create({rolls: [roll], speaker, flavor, content})`. `CONST.CHAT_MESSAGE_TYPES` no longer exists. `type` is now the *document sub-type* (`"base"` default). The old OOC/IC/EMOTE meaning moved to **`style`** (`CONST.CHAT_MESSAGE_STYLES`). `roll` (single) is gone, use the `rolls` array. `user` is now `author` (defaults to `game.user.id`, omit it). |
| `ChatMessage.applyRollMode(data, "gmroll")` / `message.applyRollMode(...)` | `ChatMessage.applyMode(data, "gm")` / `message.applyMode("gm")` |
| `ChatMessage.create(data, {rollMode})` | `ChatMessage.create(data, {messageMode: "gm"})` |
| `combat.rollInitiative(ids, {messageOptions: {rollMode}})` | `combat.rollInitiative(ids, {messageMode})` |
| `CONFIG.Dice.rollModes` / `CONFIG.ChatMessage.rollModes` | `CONFIG.ChatMessage.modes` (objects `{label, icon, handler?}`) |
| `Hooks.on("renderChatMessage", (msg, html) => html.find(...))` | `Hooks.on("renderChatMessageHTML", (msg, html) => html.querySelector(...))` (`html` is an `HTMLElement`) |
| `message.getHTML()` | `await message.renderHTML()` (returns `HTMLElement`) |
| `message.user` / `message.data.content` / `message.roll` | `message.author`, `message.content`, `message.rolls[0]` |
| `roll.evaluate()` called twice | Rolls are immutable once evaluated: second call throws. Use `await roll.reroll()` (returns a *new* evaluated Roll) or `roll.clone()`. |
| `Roll` data lookups with missing keys expecting errors | Missing `@attr` becomes `0` silently in the constructor. Use `Roll.validate()` / `warn:true` via `Roll.replaceFormulaData` to detect typos. |
| `new Roll(...)` when a system registered its own default Roll class | `Roll.create(formula, data, options)` honours `CONFIG.Dice.rolls[0]`; `new Roll()` always makes the base class. |
| `Hooks.on("preCreateChatMessage", ...)` to apply roll mode | Pass `messageMode` in create options; `_preCreate` applies it. |
| Module code using global `ChatMessage`/`Roll` | OK in v14 (both are still globals) but prefer `getDocumentClass("ChatMessage")` / `Roll.create` so system subclasses win. |

Dual-version helper (v13 + v14):

```js
export function modeOptions(key = "public") {          // key in: public | gm | blind | self
  if (game.release.generation >= 14) return { messageMode: key };
  return { rollMode: { public: "publicroll", gm: "gmroll", blind: "blindroll", self: "selfroll" }[key] };
}
export const currentMode = () => game.release.generation >= 14
  ? game.settings.get("core", "messageMode") : game.settings.get("core", "rollMode");
```

---

## 2. Roll API

### 2.1 Construct, evaluate, read

```js
const roll = Roll.create("2d20kh + @prof + @abilities.str.mod", actor.getRollData(), { flavor: "Attack" });
await roll.evaluate();                       // async; may prompt manual-dice dialog if the user configured manual fulfillment
await roll.evaluate({ allowInteractive: false });  // never prompt (e.g. background/automated/GM-hidden rolls)
await roll.evaluate({ minimize: true });     // smallest possible value (also maximize: true); never interactive

roll.total          // number (0 before evaluation)
roll.formula        // normalized formula string "2d20kh + 2 + 4"
roll.result         // "16 + 2 + 4" the arithmetic expression with resolved dice
roll.terms          // RollTerm[]: Die, NumericTerm, OperatorTerm, ParentheticalTerm, FunctionTerm, PoolTerm, StringTerm
roll.dice           // DiceTerm[] flattened (includes dice nested in parentheses/pools/functions)
roll.dice[0].results   // [{result: 17, active: true}, {result: 3, active: false, discarded: true}]
roll.dice[0].values    // active results only [17]
roll.dice[0].total
roll.options        // free-form metadata object, SERIALIZED with the roll (put flags here)
roll.isDeterministic
roll.toJSON(); Roll.fromData(json); Roll.fromJSON(str)
roll.clone();        // unevaluated copy with same formula/data
await roll.reroll(); // new evaluated Roll
roll.alter(multiply, add)  // adjust dice counts, only before evaluation
```

`evaluateSync()` exists but only works when **every term is deterministic** (no dice unless `minimize/maximize`):

```js
new Roll("@a + 3", { a: 2 }).evaluateSync().total;                 // 5
new Roll("1d6").evaluateSync();                                    // throws: not synchronously evaluable
new Roll("1d6 + 2").evaluateSync({ strict: false }).total;         // 2 (random terms ignored!)
new Roll("1d6").evaluateSync({ maximize: true }).total;            // 6
Roll.validate("1d20 + @prof");                                     // true (pure syntax check; @refs replaced by 1)
```

Rules:
- A Roll is **immutable after evaluation**; `evaluate` twice throws.
- `Roll.validate(formula)` for user-entered formulas (settings, item fields). Combine with `Roll.replaceFormulaData(formula, data, {missing: "0", warn: true})` to see missing keys.
- Dice results come from `CONFIG.Dice.randomUniform` (Mersenne Twister) unless the user configured fulfillment methods (`CONFIG.Dice.fulfillment`). `Roll.simulate("2d6", 10000)` logs distribution.
- Roll data is **not serialized** with the roll. After a message reloads, `roll.data` is empty; the formula is already substituted. Put anything you need later in `roll.options` or message flags.

### 2.2 Data substitution (`getRollData`, `@attr`)

`@path.to.value` in a formula is replaced from the data object passed to the constructor (`/@{[-.\w]+}|@[-.\w]+/`):

```js
// Actor: default getRollData() returns `this.system` (the live object!). Never mutate it. Extend by copying:
class MyActor extends Actor {
  getRollData() {
    const data = { ...super.getRollData() };       // shallow copy
    data.prof = this.system.attributes.prof ?? 0;  // @prof
    data.level = this.system.details.level;        // @level
    for (const [k, a] of Object.entries(this.system.abilities)) data[k] = a.mod;   // @str
    return data;
  }
}
// Item.getRollData() usually merges the owner's data: { ...this.actor?.getRollData(), item: this.system }  -> @item.damage
```
Replacement rules (`Roll.replaceFormulaData`): numbers and trimmed strings are inlined, booleans become `1`/`0`, objects with a custom `toString` use it, a **missing key becomes `0`** (constructor passes `missing: "0"`), arrays/plain objects become a JSON placeholder that fails evaluation. A string value containing another `@ref` is only resolved when called with `{recursive: true}` (depth 3), so pre-resolve nested formulas yourself. Keys with spaces are unsupported. Term flavor is `term[Flavor Text]`, unrelated to data syntax.

### 2.3 Rendering and messaging

```js
const html = await roll.render({ flavor: "Attack" });      // dice-roll HTML (CHAT_TEMPLATE), evaluates if needed
const tip  = await roll.getTooltip();                       // per-die breakdown HTML
const msg  = await roll.toMessage(
  { speaker: ChatMessage.getSpeaker({ actor }), flavor: "Attack roll" },   // any ChatMessage data
  { messageMode: "gm" }                                                    // public|gm|blind|self|ic; default = core.messageMode setting
);
const data = await roll.toMessage({ speaker }, { create: false });         // returns plain object, does not create
```
`toMessage` details (source): defaults `author`, `content: String(total)`, `sound: CONFIG.sounds.dice`; sets `rolls = [this]` (**overwrites** any `rolls` you pass, so for multiple rolls call `ChatMessage.create({rolls: [r1, r2]})` yourself); evaluates first if needed (non-interactive when mode is `blind`); applies the mode with `message.applyMode(mode)`; with `create:true` calls `ChatMessage.create(msg)`. If `messageMode` is omitted it uses the user's current chat visibility dropdown (`core.messageMode`).

`message.rolls` are real `Roll` instances (deserialized through `CONFIG.Dice.rolls` by class name); `message.rolls[0].options` returns what you stored.

### 2.4 Inline rolls and enrichers

`[[/r 1d20+5]]{label}` and `[[/roll ...]]` in HTML content become inline roll links via `TextEditor.enrichHTML` (pass `rollData`). In `ChatMessage` content, `[[...]]` rolls are evaluated *at creation* (`_preCreate`) using `message.getRollData()` (the speaker's actor roll data).

---

## 3. Formula syntax cheat sheet

| Syntax | Meaning |
|---|---|
| `2d6`, `d20` | dice (number optional). `1d20[fire]` flavor on a term |
| `d%` | not valid in the v14 grammar, write `d100` |
| `(1d4+1)d6` | dice count / faces can be nested expressions |
| `{1d6,1d8}kh` | pool term with modifier |
| `4d6kh3` `4d6dl1` `2d20kl` | keep highest 3 / drop lowest / keep lowest |
| `d6r1` `d6rr<=2` | reroll once on 1 / reroll recursively while <=2 |
| `d6x` `d6x6` `d10x>=9` `d6xo` `d6x2>=5` | explode on max / on 6 / on >=9 / explode once / explode on >=5 at most 2 times (a number *before* a comparison is the explosion cap) |
| `10d10cs>=8` `cf<=2` | count successes / count failures (total = count, not sum) |
| `df` `sf` `ms` | deduct failures / subtract failures / margin of success: `6d6cs>3df`, `6d6ms>12` |
| `d6min2` `d6max5` | clamp each result |
| `6d6even` `6d6odd` | count even / odd |
| `1d20 + 5`, `*`, `/`, `%`, parentheses | arithmetic; `%` modulo |
| `floor(@x/2)`, `max(1, @mod)`, `abs()`, `ceil`, `round`, `min`, `sqrt`, `pow` | any `Math` function, plus `CONFIG.Dice.functions` |
| `1dc` (coin), `4df` (fate die) | built-in terms: `c` coin, `f` fate (-1/0/+1) |
| `@abilities.str.mod`, `@{abilities.str.mod}` | data reference |

Dice terms found by letter in `CONFIG.Dice.terms` (`d`, `c`, `f` built in). Modifier registry per term class: `Die.MODIFIERS` = `r rr x xo k kh kl d dh dl min max even odd cs cf df sf ms`. Combinations chain left to right: `4d6kh3r1`. Formulas parse via a PEG grammar (`foundry.dice.RollGrammar`, `client/dice/grammar.pegjs`), so malformed input throws at construction: always run user-entered formulas through `Roll.validate()` first. Die faces may be a number, a parenthetical, or a single letter denomination (`1dw`, `1dc`, `4df`).

---

## 4. Custom Roll classes, dice terms, modifiers, functions

Register in `init`.

### 4.1 Roll subclass

```js
export class AttackRoll extends Roll {
  static CHAT_TEMPLATE = "systems/mysys/templates/dice/attack-roll.hbs";   // used by roll.render()
  static TOOLTIP_TEMPLATE = "templates/dice/tooltip.hbs";

  constructor(formula, data, options = {}) {
    options.rollType ??= "attack";           // options is serialized with the message
    super(formula, data, options);
  }

  get isCritical() { return this._evaluated && this.dice[0]?.total >= (this.options.critRange ?? 20); }

  /** Context passed to CHAT_TEMPLATE */
  async _prepareChatRenderContext({ flavor, isPrivate = false, ...options } = {}) {
    const ctx = await super._prepareChatRenderContext({ flavor, isPrivate, ...options });
    return { ...ctx, isCritical: !isPrivate && this.isCritical };
  }
}

Hooks.once("init", () => {
  CONFIG.Dice.rolls.push(AttackRoll);        // MUST be listed or message.rolls cannot deserialize it
  // CONFIG.Dice.rolls.unshift(AttackRoll);  // only if it should become Roll.create()'s default class
});
const roll = await new AttackRoll("1d20 + @atk", actor.getRollData(), { critRange: 19 }).evaluate();
```
Deserialization: `Roll.fromData` looks up `data.class` in `CONFIG.Dice.rolls` by `cls.name`; unknown class throws ("Unable to recreate X instance"), so keep class names stable and keep the registration when removing a feature (or messages break).

### 4.2 Custom die term

```js
export class WildDie extends foundry.dice.terms.Die {
  static DENOMINATION = "w";                              // "1dw6" -> needs CONFIG.Dice.terms.w
  static MODIFIERS = { ...foundry.dice.terms.Die.MODIFIERS };
  get denomination() { return "dw"; }                     // used for fulfillment config / DSN
  getResultCSS(result) { return [...super.getResultCSS(result), "wild"]; }
  getResultLabel(result) { return String(result.result); }  // text shown in the tooltip
}
Hooks.once("init", () => {
  CONFIG.Dice.terms.w = WildDie;
  CONFIG.Dice.types.push(WildDie);                        // lists it in dice UIs/fulfillment config
  CONFIG.Dice.fulfillment.dice.dw = { label: "MYSYS.WildDie", icon: '<i class="fa-solid fa-dice"></i>' };
});
```
Terms deserialize through `CONFIG.Dice.termTypes[class]` then by class name among `CONFIG.Dice.terms` values (falling back to plain `Die`). Override `roll()`/`_roll()`/`mapRandomFace(u)` for non-numeric faces (see `Coin`, `FateDie` in `client/dice/terms/`). `static defaultTermData` + constructor override is the SWADE way to give a term fixed faces/modifiers.

### 4.3 Custom modifier

```js
// Add a "bonus-on-max" modifier "m<n>" to every Die: 4d6m5 -> add +n when any die shows 6
foundry.dice.terms.Die.MODIFIERS.bm = "bonusOnMax";
foundry.dice.terms.Die.prototype.bonusOnMax = function (modifier) {
  const match = modifier.match(/bm([0-9]+)/i);
  if (!match) return false;                       // return false => modifier not recorded
  const bonus = parseInt(match[1]);
  for (const r of this.results) if (r.result === this.faces) { r.count = r.result + bonus; }
};
```
Modifier values are method names or functions; method gets the matched modifier text, may be `async`, mutates `this.results` (`active`, `discarded`, `count`, `success`, `failure`, `rerolled`, `exploded`). Prefer subclassing a term over patching `Die.prototype`.

### 4.4 Custom functions

```js
CONFIG.Dice.functions.cap = (value, max) => Math.min(value, max);        // may return a Promise
new Roll("cap(2d6 + @x, 10)", { x: 3 });
```
Function arguments are themselves rolls (nested dice allowed). Unknown names fall back to `Math[name]`.

### 4.5 Fulfillment, RNG, parser
`CONFIG.Dice.randomUniform = () => myRng()` swaps the RNG; `CONFIG.Dice.fulfillment.methods.mine = {label, interactive, handler(term, options) => number}` adds a player-selectable dice source (e.g. physical dice, bluetooth dice). Rolls with `allowInteractive:false` or `minimize/maximize` skip interactive methods. `CONFIG.Dice.parser` is the parser class if you really must change grammar behaviour.

---

## 5. Message modes

v14 replaced "roll modes" with **message modes** applied to *any* message, not only rolls.

```js
CONFIG.ChatMessage.modes = {
  public: { label: "CHAT.MODES.public", icon: "fa-solid fa-globe" },       // everyone
  gm:     { label: "CHAT.MODES.gm",     icon: "fa-solid fa-user-secret" },  // GMs + author
  blind:  { label: "CHAT.MODES.blind",  icon: "fa-solid fa-eye-slash" },    // GMs only, hidden from author (blind: true)
  self:   { label: "CHAT.MODES.self",   icon: "fa-solid fa-user" },         // author only
  ic:     { label: "CHAT.MODES.ic",     icon: "fa-solid fa-hat-wizard" }    // in-character, public; sets style IC; falls back to public when there is no speaker or the message has rolls
};
```
- Current user choice: `game.settings.get("core", "messageMode")` (client setting, shown in the chat input dropdown; changing it triggers `ui.chat._updateMessageMode()`).
- Apply to data: `ChatMessage.applyMode(chatData, "gm")` (static, mutates and returns data: `public` clears whisper and `blind`; `self` whispers to author; `gm`/`blind` whisper to all GMs unless `whisper` already set; `blind` sets `blind: true`; `ic` sets `style`). Instance: `message.applyMode("gm")` updates source.
- On create: `ChatMessage.create(data, {messageMode: "gm"})`. Unknown mode keys fall back to the user's setting.
- Custom mode: add an entry with a `handler(chatData)` function that edits the data (e.g. whisper to a team): `CONFIG.ChatMessage.modes.team = {label, icon, handler: data => { data.whisper = teamIds; data.blind = false; }}`. It then appears in the dropdown.
- Legacy mapping `Roll._mapLegacyRollMode`: `publicroll->public gmroll->gm blindroll->blind selfroll->self roll->(current setting)`.
- Hand-rolled equivalents: whisper `whisper: [userIds]`, blind `blind: true` (author sees "rolled privately"; GMs see it).

---

## 6. ChatMessage

### 6.1 Data fields (schema: `common/documents/chat-message.mjs`)

| Field | Notes |
|---|---|
| `type` | document sub-type, default `"base"`. Not the old roll/OOC type. |
| `system` | TypeDataModel data for `type` (see section 8) |
| `style` | `CONST.CHAT_MESSAGE_STYLES`: `OTHER 0`, `OOC 1`, `IC 2`, `EMOTE 3`. Affects rendering and alias. |
| `author` | user id, defaults to `game.user.id`. Only GMs may create messages for another author |
| `speaker` | `{scene, actor, token, alias}` ids |
| `content` | HTML string (`HTMLField`). Escape user text. |
| `flavor` | HTML string shown in the header |
| `title` | string |
| `rolls` | array of **evaluated** Rolls (validator throws "Roll objects added to ChatMessage documents must be evaluated") |
| `whisper` | array of user ids, `blind` boolean |
| `sound` | audio path (e.g. `CONFIG.sounds.dice`), played on create |
| `emote` | boolean |
| `flags` | `{ "my-sys": {...} }` use for your card state |
| `timestamp` | set by server |

Getters/methods: `message.isRoll`, `isAuthor`, `visible`, `isContentVisible`, `alias`, `speakerActor`, `getRollData()` (speaker actor's roll data), `message.renderHTML()`, `export()`, `getFlag/setFlag`. Statics: `ChatMessage.getSpeaker()`, `getSpeakerActor(speaker)`, `getWhisperRecipients(name)` (returns **User objects**, map `.id` for `whisper`).

### 6.2 Creating messages

```js
const speaker = ChatMessage.getSpeaker({ actor });          // {scene, actor, token, alias}; with {token} or {actor, alias}
// getSpeaker() with no args: controlled token -> user's character -> bare user alias

await ChatMessage.implementation.create({
  speaker,
  flavor: game.i18n.localize("MYSYS.Rest"),
  content: `<p>${foundry.utils.escapeHTML(actor.name)} takes a rest.</p>`,
  flags: { mysys: { kind: "rest" } }
}, { messageMode: "public" });                              // `ChatMessage.implementation` = CONFIG.ChatMessage.documentClass

// whisper to GMs only (explicit, without modes):
await ChatMessage.create({ content: "...", whisper: ChatMessage.getWhisperRecipients("GM").map(u => u.id) });

// create several at once (one DB call)
await ChatMessage.implementation.create([dataA, dataB]);
```
Create options: `messageMode`, `chatBubble: true` (speech bubble over the token; `ic` mode enables it), `notify` (show chat notification), `rollMode` (deprecated). Players may create messages as themselves; impersonating another author needs GM.

### 6.3 Messages with rolls

```js
const roll = await Roll.create("1d20 + @atk", actor.getRollData()).evaluate();
await roll.toMessage({ speaker, flavor: "Sword attack", flags: { mysys: { itemUuid: item.uuid } } }, { messageMode });
// or manual (several rolls, custom content):
await ChatMessage.implementation.create({ speaker, rolls: [attackRoll, damageRoll], content, sound: CONFIG.sounds.dice },
  { messageMode: game.settings.get("core", "messageMode") });
```
**Content rendering rule** (`ChatMessage#renderHTML`): if `rolls` is non-empty and `content` contains **no HTML elements** (plain text such as the default `"17"`), core replaces it with each roll's rendered `CHAT_TEMPLATE`. If your `content` contains markup, core displays your markup and does **not** add the roll breakdown. So a custom card must embed it itself: `const rollHTML = await roll.render()`, put `{{{rollHTML}}}` in your template. For private rolls the author of a blind roll sees "rolled privately" content, not yours (`isContentVisible` false; override `_getHiddenContent()` on the document class or `system._getHiddenContent()`).

### 6.4 Updating, deleting, permissions

`message.update({content})` requires ownership: the author or a GM. **A player clicking a button on a GM-authored card cannot update it.** Options: store state in `flags` and have the GM client apply it (query/socket), or create a follow-up message. Chat card state is best kept in flags (`message.getFlag("mysys","state")`) and the HTML re-derived in `renderChatMessageHTML`, because the hook runs again after every update.

### 6.5 Hooks recap
`renderChatMessageHTML(message, html, context)`, `createChatMessage(message, options, userId)` (all clients; Dice So Nice and sounds hook here), `updateChatMessage`, `deleteChatMessage`, `chatMessage(chatLog, text, {user, speaker})` (cancel typed text), `getChatMessageContextOptions(chatLog, entries)`.

---

## 7. Interactive chat cards

Pattern: render a template into `content`, tag buttons with a **namespaced** `data-action`, wire listeners in `renderChatMessageHTML`. The hook fires for every (re)render of that message in the log, popout, and notification area, so keep it idempotent and derive visibility from document state.

```handlebars
{{!-- templates/chat/attack-card.hbs --}}
<div class="mysys-card" data-item-uuid="{{itemUuid}}">
  <header><img src="{{item.img}}" width="36" height="36"> <h3>{{item.name}}</h3></header>
  {{{rollHTML}}}
  <footer class="card-buttons">
    <button type="button" data-action="mysys-damage">{{localize "MYSYS.RollDamage"}}</button>
    <button type="button" data-action="mysys-apply" class="gm-only">{{localize "MYSYS.ApplyDamage"}}</button>
  </footer>
</div>
```
```js
Hooks.on("renderChatMessageHTML", (message, html) => {
  const card = html.querySelector(".mysys-card");
  if (!card) return;                                              // not our message
  const actor = message.speakerActor;
  if (!actor?.isOwner && !game.user.isGM) card.querySelector("[data-action='mysys-damage']")?.remove();
  if (!game.user.isGM) card.querySelectorAll(".gm-only").forEach(el => el.remove());

  card.addEventListener("click", async (event) => {              // delegate on the card element
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    event.preventDefault();
    button.disabled = true;
    try {
      if (button.dataset.action === "mysys-damage") await rollDamage(message);
      if (button.dataset.action === "mysys-apply") await requestApply(message);
    } finally { button.disabled = false; }
  });
});
```
Notes:
- Core's `ChatLog` also delegates clicks on any `[data-action]` inside the log and calls `ChatLog#_onClickAction` (empty by default) for unknown actions, which is harmless. **Avoid core action names** (`deleteMessage`, `dismissMessage`, `expandRoll`, `export`, `flush`, `jumpToBottom`, `messageMode`, `close`, `tab`), because those trigger core handlers.
- Alternatively subclass the chat log (`CONFIG.ui.chat = MyChatLog extends foundry.applications.sidebar.tabs.ChatLog`) and add `static DEFAULT_OPTIONS = { actions: { mysysDamage: MyChatLog.#onDamage } }`; the handler receives `(event, target)`, find the message with `target.closest("[data-message-id]")`, `game.messages.get(id)`.
- Use `message.getFlag/setFlag` for state; message updates re-render the card automatically.
- Drag & drop from cards: set `draggable` and `dragstart` data `JSON.stringify({type:"Item", uuid})`.
- Ownership-gated actions (apply damage on someone else's token) go through the GM:

```js
CONFIG.queries["mysys.applyDamage"] = async ({ uuid, amount }, { user }) => {   // runs on GM client
  const actor = await fromUuid(uuid);
  if (!actor) throw new Error("Unknown actor");
  await actor.applyDamage(amount);                                             // your method
  return { hp: actor.system.hp.value };
};
async function requestApply(message) {
  const { uuid, amount } = message.getFlag("mysys", "damage") ?? {};
  if (game.user.isGM) return (await fromUuid(uuid))?.applyDamage(amount);
  const gm = game.users.activeGM;
  if (!gm) return ui.notifications.warn("MYSYS.NoGM", { localize: true });
  return gm.query("mysys.applyDamage", { uuid, amount });
}
```

---

## 8. Typed chat messages and chat commands

### 8.1 ChatMessage sub-types (TypeDataModel)
`ChatMessage` has `type` + `system` like Actor/Item (`hasTypeData: true`). Register:

```js
// system.json (or module.json) documentTypes: { "ChatMessage": { "attack": {} } }   [module types are "my-mod.attack"]
class AttackCardData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const f = foundry.data.fields;
    return { itemUuid: new f.StringField(), targets: new f.SetField(new f.StringField()), applied: new f.BooleanField() };
  }
  static LOCALIZATION_PREFIXES = ["MYSYS.ChatMessage.attack"];
  _getHiddenContent() { return "<p>???</p>"; }           // shown when !isContentVisible (blind/whisper)
  // optional: async renderHTML(options) -> HTMLElement   see note
}
Hooks.once("init", () => { CONFIG.ChatMessage.dataModels.attack = AttackCardData; });
await ChatMessage.implementation.create({ type: "attack", system: { itemUuid }, speaker, rolls: [roll] });
```
`system` data is validated and persisted; this beats ad-hoc flags for card state. Optional `system.renderHTML({canDelete, canClose, ...})`: if the data model defines it, core calls it **instead of** the default template, so it must return the whole `<li class="chat-message" data-message-id="...">` element (`renderChatMessageHTML` still fires with `(message, html)` and no context). Many systems skip it and instead override `renderHTML` on a `ChatMessage` subclass (SWADE) or just fill `content` with HTML.

### 8.2 Custom slash commands (v14)
`ChatLog.CHAT_COMMANDS` is a static record (`rgx`, `fn`, optional `mode`, `isRoll`, `isMultiline`). Add entries in `init` on whichever class is `CONFIG.ui.chat`:

```js
const ChatLog = foundry.applications.sidebar.tabs.ChatLog;
Hooks.once("init", () => {
  ChatLog.CHAT_COMMANDS.mysysRest = {
    rgx: /^(\/rest )([^]*)/i,
    fn(command, match, chatData, createOptions) {         // `this` = ChatLog instance
      const actor = ChatMessage.getSpeakerActor(chatData.speaker) ?? game.user.character;
      if (!actor) { ui.notifications.warn("MYSYS.NoActor", { localize: true }); return false; }  // false => no message
      actor.rest();
      chatData.content = `${actor.name} rests: ${match[2]}`;
      createOptions.messageMode = "public";
    }
  };
});
```
Assigning to `ChatLog.MESSAGE_PATTERNS` (old style) is deprecated. Alternative for cancel/transform: `Hooks.call("chatMessage")` (return false, synchronous).

---

## 9. Combat

### 9.1 Initiative formula
Resolution order in `Combatant#_getInitiativeFormula()`: `CONFIG.Combat.initiative.formula || game.system.initiative` (the `initiative` string in `system.json`). Set one or the other; the CONFIG value wins and can be changed at runtime.

```js
// system.json:  "initiative": "1d20 + @attributes.init.mod"
CONFIG.Combat.initiative = { formula: "1d20 + @attributes.init.mod + @attributes.init.mod / 100", decimals: 2 };  // decimal tiebreaker trick
```
`@` data come from `combatant.actor.getRollData()` (empty for actorless combatants). The score is the roll `total`, stored unrounded as `combatant.initiative`. `decimals` is only the display precision in the Combat Tracker (used when any score has a fractional part), so tiebreaker fractions like `/ 100` stay hidden when all scores are integers.

### 9.2 Rolling
```js
await combat.rollInitiative(["id1","id2"], { formula: null, updateTurn: true, messageMode: undefined, messageOptions: {} });
await combat.rollAll();             // everyone with initiative === null that you own
await combat.rollNPC();             // NPC combatants (no player owner)
await combatant.rollInitiative("2d10");   // single, no chat message
await actor.rollInitiative({ createCombatants: true, rerollInitiative: false, initiativeOptions: { messageMode: "gm" } });
await combat.setInitiative(combatantId, 14);
await combat.resetAll();
```
`Combat#rollInitiative` only processes combatants you own (`combatant.isOwner`), builds each roll with `combatant.getInitiativeRoll(formula)`, posts a chat message flagged `flags["core.initiativeRoll"] = true`, defaults hidden combatants to the `gm` mode, then batch-updates `initiative` with `turnEvents: false`.

### 9.3 Customizing
```js
export class MyCombatant extends Combatant {          // CONFIG.Combatant.documentClass = MyCombatant
  getInitiativeRoll(formula) {
    formula ||= this._getInitiativeFormula();
    const data = this.actor?.getRollData() ?? {};
    return Roll.create(formula, { ...data, tie: Math.random() / 1000 }, { combatantId: this.id });
  }
  /** @override */ _getInitiativeFormula() { return this.actor?.system.initFormula || super._getInitiativeFormula(); }
}
export class MyCombat extends Combat {                // CONFIG.Combat.documentClass = MyCombat
  /** Turn order: descending initiative, then name. */
  _sortCombatants(a, b) {
    const ia = Number.isNumeric(a.initiative) ? a.initiative : -Infinity;
    const ib = Number.isNumeric(b.initiative) ? b.initiative : -Infinity;
    return (ib - ia) || a.name.localeCompare(b.name) || (a.id > b.id ? 1 : -1);
  }
  async _onStartTurn(combatant, context) { /* context {round, turn, skipped} */ }
  async _onEndTurn(combatant, context) { }
  async _onStartRound(context) { }          // context {round, skipped}
  async _onEndRound(context) { }
}
```
- `_onStartTurn/_onEndTurn/_onStartRound/_onEndRound` are **protected workflow methods that run only on the active GM client** after the Combat update (`game.user.isActiveGM`), awaited in order End Turn, End Round, Start Round, Start Turn, and for each *skipped* turn when the tracker jumps (`context.skipped`). Default implementations are empty. They are the right place for per-turn automation (damage over time, effect expiry). Call `super` is not required but harmless. After them core refreshes `ActiveEffect.registry` (`"turnStart" "turnEnd" "roundStart" "roundEnd"` expiry events) and triggers Region events (`tokenTurnStart`...). Override `_clearMovementHistoryOnStartTurn` to keep movement history.
- Combat, Combatant, CombatantGroup are **typed documents** now: `CONFIG.Combat.dataModels = {...}`, `Combatant.dataModels`, `CombatantGroup.dataModels` for `system` data (e.g. SWADE stores action cards).
- `CONFIG.Combat.settings` (tracked resource, skip defeated, turn marker) is configured via the world setting `core.combatTrackerConfig` and hook `initializeCombatConfiguration`.
- Custom tracker UI: `CONFIG.ui.combat = MyCombatTracker` (subclass of `foundry.applications.sidebar.tabs.CombatTracker`).
- `CONFIG.time.turnTime / roundTime` advance world time per turn/round (seconds).

### 9.4 Properties/methods you will use
```js
combat.started; combat.round; combat.turn (index into combat.turns); combat.turns (sorted Combatant[]);
combat.combatant; combat.nextCombatant; combat.combatants (Collection); combat.groups; combat.scene; combat.isActive
await combat.startCombat(); await combat.nextTurn(); await combat.previousTurn(); await combat.nextRound(); await combat.endCombat();
combat.getCombatantsByActor(actor); combat.getCombatantsByToken(tokenDoc);
await combat.createEmbeddedDocuments("Combatant", [{ tokenId, sceneId, actorId, hidden: false }]);
combatant.actor; combatant.token; combatant.initiative; combatant.isDefeated; combatant.hidden; combatant.isNPC; combatant.players
await tokenDocument.toggleCombatant();       // add/remove token from the current encounter
game.combat?.combatant?.actor                  // whose turn it is
```
Defeated state: `combatant.defeated` or the actor having the `CONFIG.specialStatusEffects.DEFEATED` status.

### 9.5 Combat hooks (summary; full signatures in hooks-config-settings.md 5.5)
- Before DB update, initiating client only, data mutable: `combatStart(combat, updateData)`, `combatRound(combat, updateData, updateOptions)`, `combatTurn(combat, updateData, updateOptions)`.
- After update, **all clients**: `combatTurnChange(combat, prior, current)` with `{round, turn, combatantId, tokenId}`; `updateCombat(combat, changed, options, userId)`; `updateCombatant`.
- Guard side effects: `if (!game.user.isActiveGM) return;` or use the `_on*` methods above.

### 9.6 Combatant groups (v13+, data layer only)
`Combat#groups` is an embedded collection of `CombatantGroup` documents (`name`, `img`, `initiative`, `ownership`, typed `system`). A `Combatant` joins via its `group` field (a group id). Each combatant's prepared `initiative` becomes the group's when the group's initiative is finite; `group.members` (Set), `group.hidden`, `group.defeated` are derived. **Core ships no tracker UI for groups**; systems/modules create/drive them:

```js
const [group] = await combat.createEmbeddedDocuments("CombatantGroup", [{ name: "Goblins" }]);
await combat.updateEmbeddedDocuments("Combatant", goblins.map(c => ({ _id: c.id, group: group.id })));
await group.update({ initiative: 12 });
```

---

## 10. Worked example: attack, card, damage

```js
// module/rolls/attack.mjs
export async function rollAttack(item, { messageMode } = {}) {
  const actor = item.actor;
  const targets = [...game.user.targets];                       // Token placeables
  const roll = await Roll.create("1d20 + @atk + @item.bonus", { ...actor.getRollData(), item: item.system },
    { mysys: { kind: "attack", itemUuid: item.uuid } }).evaluate();

  const rollHTML = await roll.render({ flavor: item.name });
  const content = await foundry.applications.handlebars.renderTemplate("systems/mysys/templates/chat/attack-card.hbs", {
    item, rollHTML, itemUuid: item.uuid, targets: targets.map(t => ({ name: t.name, uuid: t.actor?.uuid, hit: roll.total >= (t.actor?.system.ac ?? 10) }))
  });

  return roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    content, flavor: item.name,
    flags: { mysys: { kind: "attack", itemUuid: item.uuid, damage: { uuid: targets[0]?.actor?.uuid, amount: null } } }
  }, { messageMode: messageMode ?? game.settings.get("core", "messageMode") });
}
```
Pair it with the card hook and query in section 7 for damage application.

---

## 11. Dice So Nice notes

Unverified locally (module not installed); based on its public API, check its wiki.
- DSN animates rolls found in `message.rolls` when the message is created (`createChatMessage`), and delays showing the chat card until the animation ends. Rolls that are never attached to a `ChatMessage` (or evaluated with the total only displayed in custom HTML) are not animated: call `await game.dice3d.showForRoll(roll, game.user, true, whisperIds, blind, messageId, speaker)`.
- Respect privacy: pass `whisper` and `blind` that mirror the message; DSN hides blind rolls from non-GMs.
- Hooks: `diceSoNiceInit` (once, register systems), `diceSoNiceReady(dice3d)` (register colorsets/presets: `dice3d.addColorset`, `dice3d.addDicePreset({type:"dw", labels:[...], system:"standard"}, "d6")` for custom denominations), `diceSoNiceRollStart(messageId, context)` (mutate `context.roll` to alter what is shown, e.g. hide discarded dice or add flavor-colored dice). SWADE uses all three.
- Term `options` such as `flavor`, `colorset`, `appearance` are read per term. Give custom dice a stable `denomination` (`dw`) so presets map.
- Expect DSN to call `game.dice3d` only when the module is active: `game.modules.get("dice-so-nice")?.active`.
- Evaluate rolls **before** creating the message; async post-processing that mutates results after `create` will not be reflected in the animation.

---

## 12. Verify-in-source pointers

Paths under `/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/`:

| Question | File |
|---|---|
| Roll evaluation, serialization, toMessage | `client/dice/roll.mjs` |
| Modifiers and terms | `client/dice/terms/die.mjs`, `dice.mjs`, `term.mjs`, `function.mjs`, `pool.mjs` |
| CONFIG.Dice / ChatMessage.modes / Combat | `client/config.mjs` (search `export const Dice`, `ChatMessage`, `Combat`) |
| Chat message render + create flow | `client/documents/chat-message.mjs` |
| Chat message schema, styles | `common/documents/chat-message.mjs`, `common/constants.mjs` (`CHAT_MESSAGE_STYLES`) |
| Chat commands, send pipeline | `client/applications/sidebar/tabs/chat.mjs` (`CHAT_COMMANDS`, `processMessage`) |
| Combat flow and turn events | `client/documents/combat.mjs`, `combatant.mjs`, `combatant-group.mjs` |
| Initiative on Actor | `client/documents/actor.mjs` (`rollInitiative`) |
| Real v14 usage | `~/Library/Application Support/FoundryVTT/Data/systems/swade/swade.js` (`class SwadeRoll`, `class TraitRoll`, `class WildDie`, `class SwadeChatLog`, `class SwadeChatMessage`) |
