/**
 * Shared path discovery for the foundry-vtt-dev scripts: where the Foundry app (and its source) lives,
 * and where the user's real data directory (with Config/license.json) is.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOME = os.homedir();

/** Locate the Foundry application directory: the folder that contains main.mjs and package.json. */
export function findAppPath() {
  const candidates = [
    process.env.FOUNDRY_APP_PATH,
    // macOS desktop app
    "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app",
    path.join(HOME, "Applications/Foundry Virtual Tabletop.app/Contents/Resources/app"),
    // Linux / Node.js zip installs
    path.join(HOME, "foundryvtt/resources/app"),
    path.join(HOME, "foundryvtt"),
    "/opt/foundryvtt/resources/app",
    "/opt/foundryvtt",
    // Windows
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Foundry Virtual Tabletop/resources/app"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs/Foundry Virtual Tabletop/resources/app")
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "main.mjs")) && fs.existsSync(path.join(c, "package.json"))) return c;
  }
  throw new Error("Could not find the Foundry VTT application. Set FOUNDRY_APP_PATH to the folder containing main.mjs "
    + "(macOS: <App>.app/Contents/Resources/app; Node.js zip: the extracted folder or its resources/app).");
}

/** Locate the user's real Foundry data path (holds Config/license.json). */
export function findRealDataPath() {
  if (process.env.FOUNDRY_REAL_DATA_PATH) return process.env.FOUNDRY_REAL_DATA_PATH;
  let base;
  if (process.platform === "darwin") base = path.join(HOME, "Library/Application Support/FoundryVTT");
  else if (process.platform === "win32") base = path.join(process.env.LOCALAPPDATA || path.join(HOME, "AppData/Local"), "FoundryVTT");
  else base = path.join(process.env.XDG_DATA_HOME || path.join(HOME, ".local/share"), "FoundryVTT");
  // options.json may redirect the data path elsewhere
  try {
    const opts = JSON.parse(fs.readFileSync(path.join(base, "Config/options.json"), "utf8"));
    if (opts.dataPath && fs.existsSync(opts.dataPath)) return opts.dataPath;
  } catch { /* fall through */ }
  return base;
}
