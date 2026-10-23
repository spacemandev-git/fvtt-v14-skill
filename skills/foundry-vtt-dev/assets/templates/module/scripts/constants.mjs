/** The module id: also the namespace for settings, flags, socket events and queries. Keep it in one place. */
export const MODULE_ID = "__ID__";

/** The event name for this module's socket. Foundry only routes it when module.json has `"socket": true`. */
export const SOCKET_EVENT = `module.${MODULE_ID}`;
