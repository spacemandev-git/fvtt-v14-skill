#!/usr/bin/env node
/**
 * fvtt-server.mjs — run a sandboxed, headless Foundry VTT server for testing packages.
 *
 * The server runs on Node.js (no Electron window) against its own data directory, so it never touches
 * the user's real worlds and can run while the desktop app is open (different data path + port).
 * Your package folders are symlinked in, so edits are live (refresh the browser to pick them up).
 *
 * Usage:
 *   node fvtt-server.mjs start  [--link <pkgDir>]... [--link-installed <id>]... [--world <id>]
 *                               [--system <id>] [--port 30001] [--sandbox <dir>] [--fresh-world]
 *   node fvtt-server.mjs stop   [--sandbox <dir>]
 *   node fvtt-server.mjs status [--sandbox <dir>]
 *   node fvtt-server.mjs logs   [--sandbox <dir>] [--lines 80] [--errors]
 *   node fvtt-server.mjs info                       # print detected app path, node runtime, real data path
 *
 * Options:
 *   --link <dir>            Package folder (contains system.json or module.json). Repeatable. Symlinked into the sandbox.
 *   --link-installed <id>   Symlink an already-installed package from the user's real Data dir (dependencies such as
 *                           lib-wrapper, or the system a module needs). Repeatable. Looks in systems/ then modules/.
 *   --world <id>            World to create (if missing) and auto-launch. Default: fvtt-dev-test
 *   --system <id>           System for a newly created world. Default: the single linked system.
 *   --port <n>              Default 30001 (30000 is usually the desktop app).
 *   --sandbox <dir>         Sandbox data path. Default: ~/.cache/foundry-vtt-dev/sandbox
 *   --fresh-world           Delete and recreate the test world before launching (clean database).
 *   --no-launch             Start the server at the setup screen without launching a world.
 *
 * Environment overrides: FOUNDRY_APP_PATH (dir containing main.mjs), FOUNDRY_REAL_DATA_PATH (user data dir
 * holding Config/license.json), FOUNDRY_NODE (node binary to use).
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findAppPath, findRealDataPath } from "./fvtt-paths.mjs";

const HOME = os.homedir();
const DEFAULT_SANDBOX = path.join(HOME, ".cache", "foundry-vtt-dev", "sandbox");

// ---------------------------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [], link: [], linkInstalled: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const next = () => inline ?? argv[++i];
    switch (k) {
      case "link": out.link.push(next()); break;
      case "link-installed": out.linkInstalled.push(next()); break;
      case "fresh-world": out.freshWorld = true; break;
      case "no-launch": out.noLaunch = true; break;
      case "errors": out.errors = true; break;
      default: out[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = next();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Environment discovery
// ---------------------------------------------------------------------------------------------------------------

/** Pick a Node.js binary new enough for this Foundry release. */
function findNode(appPath) {
  const pkg = JSON.parse(fs.readFileSync(path.join(appPath, "package.json"), "utf8"));
  const required = Number(pkg.release?.node_version ?? 20);
  const candidates = [process.env.FOUNDRY_NODE, process.execPath, "node"];
  for (const bin of candidates.filter(Boolean)) {
    try {
      const v = execFileSync(bin, ["-p", "process.versions.node"], { encoding: "utf8" }).trim();
      if (Number(v.split(".")[0]) >= required) return { bin, version: v, required, release: pkg.release };
    } catch { /* try next */ }
  }
  throw new Error(`Foundry ${pkg.release?.generation} needs Node.js >= ${required}. Install it (e.g. \`nvm install ${required}\`) `
    + "and re-run, or point FOUNDRY_NODE at a suitable binary.");
}

// ---------------------------------------------------------------------------------------------------------------
// Sandbox management
// ---------------------------------------------------------------------------------------------------------------

function sandboxPaths(root) {
  return {
    root,
    config: path.join(root, "Config"),
    data: path.join(root, "Data"),
    logs: path.join(root, "Logs"),
    pidFile: path.join(root, "harness.pid"),
    stateFile: path.join(root, "harness.json"),
    serverLog: path.join(root, "Logs", "harness-server.log")
  };
}

function readManifest(dir) {
  for (const [file, type] of [["system.json", "system"], ["module.json", "module"]]) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) {
      const m = JSON.parse(fs.readFileSync(p, "utf8"));
      return { ...m, id: m.id ?? m.name, packageType: type };
    }
  }
  throw new Error(`No system.json or module.json in ${dir}`);
}

function symlinkPackage(src, dest) {
  const real = fs.realpathSync(src);
  try {
    const st = fs.lstatSync(dest);
    if (st.isSymbolicLink()) {
      if (fs.realpathSync(dest) === real) return "unchanged";
      fs.unlinkSync(dest);
    } else {
      throw new Error(`${dest} exists and is not a symlink; refusing to replace it.`);
    }
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.symlinkSync(real, dest, process.platform === "win32" ? "junction" : "dir");
  return "linked";
}

function prepareSandbox(opts, appInfo) {
  const sb = sandboxPaths(path.resolve(opts.sandbox ?? DEFAULT_SANDBOX));
  for (const d of [sb.config, sb.logs, path.join(sb.data, "systems"), path.join(sb.data, "modules"), path.join(sb.data, "worlds")]) {
    fs.mkdirSync(d, { recursive: true });
  }

  // License: copy the signed license from the real install so the sandbox skips the license/EULA screens.
  const realData = findRealDataPath();
  const realLicense = path.join(realData, "Config", "license.json");
  const sbLicense = path.join(sb.config, "license.json");
  if (!fs.existsSync(sbLicense)) {
    if (fs.existsSync(realLicense)) fs.copyFileSync(realLicense, sbLicense);
    else console.warn(`! No license found at ${realLicense}. The server will start at the license screen; `
      + `open http://localhost:${opts.port}/ and enter a key once, it will persist in the sandbox.`);
  }

  // Link packages under development
  const linked = [];
  for (const dir of opts.link) {
    const abs = path.resolve(dir);
    const m = readManifest(abs);
    const dest = path.join(sb.data, `${m.packageType}s`, m.id);
    const r = symlinkPackage(abs, dest);
    linked.push({ id: m.id, type: m.packageType, src: abs, result: r });
  }
  // Link already-installed packages (dependencies) from the real Data directory
  for (const id of opts.linkInstalled) {
    let found = false;
    for (const type of ["system", "module"]) {
      const src = path.join(realData, "Data", `${type}s`, id);
      if (fs.existsSync(src)) {
        const r = symlinkPackage(src, path.join(sb.data, `${type}s`, id));
        linked.push({ id, type, src, result: r });
        found = true;
        break;
      }
    }
    if (!found) throw new Error(`--link-installed ${id}: not found in ${path.join(realData, "Data")}/{systems,modules}`);
  }
  return { sb, linked, realData };
}

function ensureWorld(sb, opts, linked, appInfo) {
  const worldId = opts.world ?? "fvtt-dev-test";
  const worldDir = path.join(sb.data, "worlds", worldId);
  if (opts.freshWorld && fs.existsSync(worldDir)) fs.rmSync(worldDir, { recursive: true, force: true });
  const manifestPath = path.join(worldDir, "world.json");
  if (fs.existsSync(manifestPath)) {
    const w = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (opts.system && w.system !== opts.system) {
      throw new Error(`World ${worldId} uses system "${w.system}", not "${opts.system}". Use --fresh-world or another --world.`);
    }
    return { worldId, system: w.system, created: false };
  }
  const systems = linked.filter(l => l.type === "system").map(l => l.id);
  const installedSystems = fs.readdirSync(path.join(sb.data, "systems")).filter(d => !d.startsWith("."));
  const system = opts.system ?? (systems.length === 1 ? systems[0] : installedSystems.length === 1 ? installedSystems[0] : null);
  if (!system) {
    throw new Error("Cannot pick a system for the new world: pass --system <id> (and --link or --link-installed it). "
      + `Systems in sandbox: ${installedSystems.join(", ") || "(none)"}`);
  }
  const { generation, build } = appInfo.release;
  fs.mkdirSync(worldDir, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    id: worldId,
    title: `Dev Test World (${system})`,
    description: "<p>Created by foundry-vtt-dev fvtt-server.mjs for automated testing.</p>",
    system,
    coreVersion: `${generation}.${build}`,
    compatibility: { minimum: String(generation), verified: String(generation) },
    version: "1.0.0"
  }, null, 2));
  return { worldId, system, created: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------------------------------------------

function readPid(sb) {
  try { return Number(fs.readFileSync(sb.pidFile, "utf8").trim()) || null; } catch { return null; }
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function fetchStatus(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return { reachable: true, httpStatus: res.status };
    return { reachable: true, ...(await res.json()) };
  } catch {
    return { reachable: false };
  }
}

async function waitFor(pred, timeoutMs, intervalMs = 500) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = await pred();
    if (v) return v;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return null;
}

function tail(file, lines) {
  try {
    const content = fs.readFileSync(file, "utf8").split("\n");
    return content.slice(-lines).join("\n");
  } catch { return "(no log)"; }
}

async function start(opts) {
  const appPath = findAppPath();
  const node = findNode(appPath);
  opts.port = Number(opts.port ?? 30001);
  const { sb, linked } = prepareSandbox(opts, node);

  const existing = readPid(sb);
  if (isAlive(existing)) {
    console.log(`Server already running (pid ${existing}). Stop it first: node fvtt-server.mjs stop`);
    process.exitCode = 1;
    return;
  }

  const portStatus = await fetchStatus(opts.port);
  if (portStatus.reachable) throw new Error(`Port ${opts.port} is already in use. Pick another with --port.`);

  let world = null;
  if (!opts.noLaunch) world = ensureWorld(sb, opts, linked, node);

  const args = [
    path.join(appPath, "main.mjs"),
    `--dataPath=${sb.root}`,
    `--port=${opts.port}`,
    "--noupnp",
    "--noupdate",
    "--nobackups",
    "--hotReload" // server half of hot reload; packages opt in with flags.hotReload (css/hbs/json, not JS)
  ];
  if (world) args.push(`--world=${world.worldId}`);

  fs.mkdirSync(sb.logs, { recursive: true });
  const out = fs.openSync(sb.serverLog, "a");
  fs.writeSync(out, `\n===== ${new Date().toISOString()} ${node.bin} ${args.join(" ")}\n`);
  const child = spawn(node.bin, args, { cwd: appPath, detached: true, stdio: ["ignore", out, out] });
  child.unref();
  fs.writeFileSync(sb.pidFile, String(child.pid));
  fs.writeFileSync(sb.stateFile, JSON.stringify({ pid: child.pid, port: opts.port, world: world?.worldId ?? null,
    system: world?.system ?? null, linked, appPath, node: node.bin, startedAt: new Date().toISOString() }, null, 2));

  const logStart = fs.statSync(sb.serverLog).size;
  const ok = await waitFor(async () => {
    if (!isAlive(child.pid)) return "died";
    // Fail fast when Foundry reports the world can't launch (missing/invalid system, compatibility, data errors)
    const fresh = fs.readFileSync(sb.serverLog, "utf8").slice(logStart);
    if (/not available to auto-launch|could not be auto-launched|cannot start in this directory/i.test(fresh)) return "refused";
    const s = await fetchStatus(opts.port);
    if (!s.reachable) return null;
    if (world && !s.active) return null; // still launching the world
    return s;
  }, 90_000);

  if (!ok || ok === "died" || ok === "refused") {
    const reason = { died: "stay up", refused: `launch world "${world?.worldId}"` }[ok] ?? "become ready within 90s";
    console.error(`Server failed to ${reason}. Last log lines:\n`);
    console.error(tail(sb.serverLog, 40));
    if (ok === "refused") console.error("\nCheck the package's manifest (id matches folder, compatibility, valid JSON) and the "
      + "warnings above. `node fvtt-lint.mjs <pkgDir>` catches most causes.");
    if (ok !== "died") console.error(`\n(Server process still running as pid ${child.pid}; stop with: node fvtt-server.mjs stop)`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({
    status: "running",
    pid: child.pid,
    url: `http://localhost:${opts.port}`,
    joinUrl: `http://localhost:${opts.port}/join`,
    world: world?.worldId ?? null,
    worldCreated: world?.created ?? false,
    system: world?.system ?? null,
    foundry: `${node.release.generation}.${node.release.build}`,
    node: node.version,
    sandbox: sb.root,
    serverLog: sb.serverLog,
    linked: linked.map(l => `${l.type}:${l.id} -> ${l.src} (${l.result})`),
    login: "Join as user \"Gamemaster\" with an empty password (fvtt-browser.mjs does this automatically)."
  }, null, 2));
}

async function stop(opts) {
  const sb = sandboxPaths(path.resolve(opts.sandbox ?? DEFAULT_SANDBOX));
  const pid = readPid(sb);
  if (!isAlive(pid)) {
    console.log("No running server for this sandbox.");
    fs.rmSync(sb.pidFile, { force: true });
    return;
  }
  // Negative pid kills the detached process group (server + any children)
  try { process.kill(-pid, "SIGTERM"); } catch { process.kill(pid, "SIGTERM"); }
  const gone = await waitFor(() => !isAlive(pid), 15_000);
  if (!gone) { try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ } }
  fs.rmSync(sb.pidFile, { force: true });
  console.log(`Stopped server (pid ${pid}).`);
}

async function status(opts) {
  const sb = sandboxPaths(path.resolve(opts.sandbox ?? DEFAULT_SANDBOX));
  const pid = readPid(sb);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(sb.stateFile, "utf8")); } catch { /* none */ }
  const port = Number(opts.port ?? state.port ?? 30001);
  const s = await fetchStatus(port);
  console.log(JSON.stringify({ running: isAlive(pid), pid, port, api: s, ...state }, null, 2));
}

function logs(opts) {
  const sb = sandboxPaths(path.resolve(opts.sandbox ?? DEFAULT_SANDBOX));
  const n = Number(opts.lines ?? 80);
  if (opts.errors) {
    const errFiles = fs.existsSync(sb.logs) ? fs.readdirSync(sb.logs).filter(f => f.startsWith("error")).sort() : [];
    const last = errFiles.at(-1);
    console.log(last ? tail(path.join(sb.logs, last), n) : "(no error log)");
    return;
  }
  console.log(tail(sb.serverLog, n));
}

function info() {
  const appPath = findAppPath();
  const node = findNode(appPath);
  console.log(JSON.stringify({
    appPath, sourceDirs: { client: path.join(appPath, "client"), common: path.join(appPath, "common") },
    foundry: node.release, node: { bin: node.bin, version: node.version, required: `>=${node.required}` },
    realDataPath: findRealDataPath(), defaultSandbox: DEFAULT_SANDBOX
  }, null, 2));
}

// ---------------------------------------------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const cmd = opts._[0];
const commands = { start, stop, status, logs, info };
if (!commands[cmd]) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 30).join("\n").replace(/^ \* ?/gm, ""));
  process.exit(cmd ? 1 : 0);
}
try {
  await commands[cmd](opts);
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
