/**
 * __TITLE__
 * Entry point, loaded through "esmodules" in module.json.
 *
 * Timeline to keep in mind:
 *   init   - settings, CONFIG and hooks are registered here. Translations are NOT loaded yet, so only pass
 *            localization keys around (name: "KEY"), never call game.i18n.localize() during init.
 *   ready  - the world is loaded: game.user, game.actors, game.settings values and ui.* are all available.
 */
import { MODULE_ID, SOCKET_EVENT } from "./constants.mjs";
import SettingsMenu from "./settings-menu.mjs";

const { BooleanField, StringField } = foundry.data.fields;

Hooks.once("init", () => {
  console.log(`${MODULE_ID} | Initializing`);
  registerSettings();

  // Queries are request/response messages to one specific user. Names must be prefixed with the package id.
  CONFIG.queries[`${MODULE_ID}.ping`] = onPingQuery;

  // A public API for macros and other packages: game.modules.get("__ID__").api.broadcastGreeting()
  game.modules.get(MODULE_ID).api = { broadcastGreeting, pingGM };
});

Hooks.once("ready", () => {
  console.log(`${MODULE_ID} | Ready, greeting: "${getGreeting()}"`);

  // Sockets: receive messages other clients sent with game.socket.emit(SOCKET_EVENT, ...).
  game.socket.on(SOCKET_EVENT, onSocketMessage);
});

/**
 * Example of reacting to a core event. In v13+ this hook receives a plain HTMLElement, not a jQuery object.
 * The hook runs every time a chat message is (re-)rendered, so keep it idempotent and cheap.
 */
Hooks.on("renderChatMessageHTML", (message, html) => {
  if ( !message.isRoll || !game.settings.get(MODULE_ID, "showRollBadge") ) return;
  const badge = document.createElement("i");
  badge.className = `fa-solid fa-dice-d20 ${MODULE_ID}-badge`;
  badge.dataset.tooltip = "__PREFIX__.Chat.RollBadge";
  html.querySelector(".message-sender")?.prepend(badge);
});

/* -------------------------------------------- */
/*  Settings                                    */
/* -------------------------------------------- */

function registerSettings() {

  // A client setting: stored in this browser, so every player chooses for themselves.
  // `config: true` lists it in Game Settings > Configure Settings under this module's heading.
  game.settings.register(MODULE_ID, "showRollBadge", {
    name: "__PREFIX__.Settings.ShowRollBadge.Name",
    hint: "__PREFIX__.Settings.ShowRollBadge.Hint",
    scope: "client",
    config: true,
    type: new BooleanField({ initial: true }),
    default: true
  });

  // A world setting: stored in the world database and shared by everyone. Only a GM can change it.
  // `config: false` hides it from the standard list because the settings menu below edits it.
  game.settings.register(MODULE_ID, "greeting", {
    name: "__PREFIX__.Menu.Greeting.Name",
    scope: "world",
    config: false,
    type: new StringField({ blank: true }),
    default: ""
  });

  // A button in the settings list that opens an ApplicationV2. `type` is the class, not an instance.
  game.settings.registerMenu(MODULE_ID, "settingsMenu", {
    name: "__PREFIX__.Menu.Name",
    label: "__PREFIX__.Menu.Label",
    hint: "__PREFIX__.Menu.Hint",
    icon: "fa-solid fa-gear",
    type: SettingsMenu,
    restricted: true   // GM only
  });
}

/**
 * The configured greeting, falling back to a localized default (translations exist by the time this runs).
 * @returns {string}
 */
function getGreeting() {
  return game.settings.get(MODULE_ID, "greeting") || game.i18n.localize("__PREFIX__.Greeting.Default");
}

/* -------------------------------------------- */
/*  Sockets                                     */
/* -------------------------------------------- */

/**
 * Show the greeting to everyone currently connected (and to this user).
 * Sockets are fire-and-forget broadcasts. They are not authenticated, so a handler must never trust the payload for
 * anything privileged: do the privileged work through Document operations, which the server permission-checks.
 */
function broadcastGreeting() {
  const message = getGreeting();
  game.socket.emit(SOCKET_EVENT, { type: "greeting", message });
  ui.notifications.info(message);
}

/**
 * Handle a socket message from another client.
 * @param {{type: string, message?: string}} data
 */
function onSocketMessage(data) {
  if ( data?.type === "greeting" && (typeof data.message === "string") ) ui.notifications.info(data.message);
}

/* -------------------------------------------- */
/*  Queries                                     */
/* -------------------------------------------- */

/**
 * Ask the active GM client a question and wait for the answer. Unlike a socket broadcast, a query targets one user
 * and resolves with the handler's return value (or rejects if the handler throws or the user is unreachable).
 * @param {string} text
 * @returns {Promise<object|null>}  The reply, or null if no GM is connected
 */
async function pingGM(text = "ping") {
  const gm = game.users.activeGM;
  if ( !gm ) {
    ui.notifications.warn("__PREFIX__.Query.NoGM", { localize: true });
    return null;
  }
  const data = { text };
  return gm.isSelf ? onPingQuery(data, { user: game.user }) : gm.query(`${MODULE_ID}.ping`, data);
}

/**
 * Runs on the client that was queried.
 * @param {{text: string}} data         The payload passed to User#query (must be JSON-serializable)
 * @param {{user: User}} context        `user` is the asking user
 * @returns {{echo: string, from: string, to: string}}
 */
function onPingQuery({ text }, { user }) {
  return { echo: text, from: game.user.name, to: user.name };
}
