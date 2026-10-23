#!/usr/bin/env node
/**
 * fvtt-browser.mjs — drive a running Foundry VTT server with Playwright (headless Chromium by default).
 * Logs in through the real /join page, waits for `game.ready`, and captures console errors, page errors
 * and deprecation warnings so you can verify a system or module actually works in the browser.
 *
 * Usage:
 *   node fvtt-browser.mjs smoke      [--shots <dir>] [--keep] [--sheets-only]
 *   node fvtt-browser.mjs eval       --code "<async js>" | --file <script.js>
 *   node fvtt-browser.mjs screenshot [--out <file.png>] [--selector <css>]
 *   node fvtt-browser.mjs enable-modules <id,id,...>
 *
 * Common options:
 *   --port <n>          Server port (default: from the fvtt-server.mjs sandbox state, else 30001)
 *   --sandbox <dir>     Sandbox used by fvtt-server.mjs (to read the port). Default ~/.cache/foundry-vtt-dev/sandbox
 *   --user <name>       User to log in as (default "Gamemaster")      --password <pw>  (default empty)
 *   --headed            Show the browser window (watch it work)       --slowmo <ms>    Slow each action down
 *   --viewport 1600x1000                                              --timeout <ms>   Ready timeout (default 60000)
 *   --no-canvas         Disable the WebGL canvas (faster; use when you only test sheets/apps/data)
 *
 * eval: the code runs inside the page as the body of an async function after the game is ready, so you can use
 * `game`, `CONFIG`, `foundry`, `ui`, `canvas` and `await`. Whatever you `return` is printed as JSON.
 *   node fvtt-browser.mjs eval --code "return game.actors.map(a => a.name)"
 *
 * Output is JSON on stdout. Exit code is 1 when the run found page errors or console errors (smoke/eval).
 *
 * Playwright: resolved from the current project, else installed once into ~/.cache/foundry-vtt-dev
 * (`npm install playwright`, plus `playwright install chromium` if no browser is present).
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CACHE = path.join(os.homedir(), ".cache", "foundry-vtt-dev");
const DEFAULT_SANDBOX = path.join(CACHE, "sandbox");

// ---------------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { _: [] };
  const flags = new Set(["keep", "headed", "no-canvas", "sheets-only"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const [k, inline] = a.slice(2).split(/=(.*)/s);
    const key = k.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (flags.has(k)) out[key] = true;
    else out[key] = inline ?? argv[++i];
  }
  return out;
}

async function loadPlaywright() {
  const tryImport = async (from) => {
    try {
      const req = createRequire(from);
      const p = req.resolve("playwright");
      const mod = await import(pathToFileURL(p).href);
      return { ...(mod.default ?? mod), __entry: p };
    } catch { return null; }
  };
  let pw = await tryImport(path.join(process.cwd(), "noop.js")) ?? await tryImport(path.join(CACHE, "noop.js"));
  if (!pw) {
    console.error(`[fvtt-browser] Playwright not found; installing into ${CACHE} (one-time)...`);
    fs.mkdirSync(CACHE, { recursive: true });
    if (!fs.existsSync(path.join(CACHE, "package.json"))) {
      fs.writeFileSync(path.join(CACHE, "package.json"), JSON.stringify({ name: "foundry-vtt-dev-cache", private: true }));
    }
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--silent", "playwright"], { cwd: CACHE, stdio: "inherit" });
    pw = await tryImport(path.join(CACHE, "noop.js"));
  }
  if (!pw) throw new Error("Unable to load Playwright. Install it with `npm i -D playwright` in your project.");
  return pw;
}

async function launchBrowser(pw, opts) {
  const args = [
    // Foundry's canvas needs WebGL; SwiftShader gives headless Chromium a software GPU.
    "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist",
    "--autoplay-policy=no-user-gesture-required"
  ];
  const launch = () => pw.chromium.launch({ headless: !opts.headed, slowMo: Number(opts.slowmo ?? 0), args });
  try {
    return await launch();
  } catch (err) {
    if (!/Executable doesn't exist|browserType.launch: .*install/i.test(err.message)) throw err;
    console.error("[fvtt-browser] Chromium missing; running `playwright install chromium` (one-time)...");
    // playwright's main entry (index.js) sits at the package root next to cli.js
    const cli = path.join(path.dirname(pw.__entry), "cli.js");
    execFileSync(process.execPath, [cli, "install", "chromium"], { stdio: "inherit" });
    return launch();
  }
}

function resolvePort(opts) {
  if (opts.port) return Number(opts.port);
  try {
    const state = JSON.parse(fs.readFileSync(path.join(path.resolve(opts.sandbox ?? DEFAULT_SANDBOX), "harness.json"), "utf8"));
    if (state.port) return Number(state.port);
  } catch { /* none */ }
  return 30001;
}

// ---------------------------------------------------------------------------------------------------------------
// Session: log in and collect diagnostics
// ---------------------------------------------------------------------------------------------------------------

class Session {
  constructor(opts) {
    this.opts = opts;
    this.port = resolvePort(opts);
    this.base = `http://localhost:${this.port}`;
    this.log = { errors: [], pageErrors: [], deprecations: [], warnings: [], failedRequests: [] };
  }

  async open() {
    const pw = await loadPlaywright();
    this.browser = await launchBrowser(pw, this.opts);
    const [w, h] = String(this.opts.viewport ?? "1600x1000").split("x").map(Number);
    this.context = await this.browser.newContext({ viewport: { width: w, height: h } });
    this.page = await this.context.newPage();
    // Client-scoped settings live in localStorage as JSON. Mark the core welcome tour as seen so it doesn't
    // auto-start over the UI on a fresh world, and optionally skip WebGL canvas setup entirely.
    await this.page.addInitScript((noCanvas) => {
      const progress = JSON.parse(localStorage.getItem("core.tourProgress") || "{}");
      progress.core = { ...progress.core, welcome: progress.core?.welcome ?? 3 };
      localStorage.setItem("core.tourProgress", JSON.stringify(progress));
      if (noCanvas) localStorage.setItem("core.noCanvas", "true");
    }, !!this.opts.noCanvas);
    this.page.on("console", msg => this.#onConsole(msg));
    this.page.on("pageerror", err => this.log.pageErrors.push(String(err?.stack ?? err).slice(0, 2000)));
    this.page.on("requestfailed", req => {
      const url = req.url();
      if (!/\/socket\.io\//.test(url)) this.log.failedRequests.push(`${req.failure()?.errorText ?? "failed"} ${url}`);
    });
    this.page.on("response", res => {
      if (res.status() >= 400 && !/favicon/.test(res.url())) this.log.failedRequests.push(`${res.status()} ${res.url()}`);
    });
    return this;
  }

  #onConsole(msg) {
    const type = msg.type();
    const text = msg.text();
    if (type !== "error" && type !== "warning") return;
    // Foundry's compatibility warnings ("... is deprecated", "Deprecated since Version ...")
    if (/deprecat/i.test(text)) { this.log.deprecations.push(text.split("\n").slice(0, 3).join(" | ")); return; }
    // Artifacts of software-rendered headless Chromium, not package problems
    if (/hardware acceleration|GL Driver Message|GPU stall/i.test(text)) { this.log.ignored = (this.log.ignored ?? 0) + 1; return; }
    if (type === "error") this.log.errors.push(text.slice(0, 2000));
    else this.log.warnings.push(text.slice(0, 500));
  }

  async login() {
    const { page } = this;
    const user = this.opts.user ?? "Gamemaster";
    const timeout = Number(this.opts.timeout ?? 60_000);
    await page.goto(`${this.base}/join`, { waitUntil: "domcontentloaded" });
    if (page.url().includes("/setup") || page.url().includes("/auth")) {
      throw new Error(`No world is running (redirected to ${page.url()}). Start one with fvtt-server.mjs start --world <id>.`);
    }
    if (page.url().includes("/license")) throw new Error("Server is at the license screen; enter a license key first.");
    await page.waitForSelector("select[name=userId]", { timeout });
    const select = page.locator("select[name=userId]");
    const option = select.locator("option", { hasText: new RegExp(`^\\s*${user.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) });
    if (!(await option.count())) {
      const names = await select.locator("option").allInnerTexts();
      throw new Error(`User "${user}" not found on the join page. Available: ${names.filter(n => n.trim()).join(", ")}`);
    }
    if (await option.first().isDisabled()) {
      throw new Error(`User "${user}" is already logged in from another browser session. Close that session (or wait for its socket to time out).`);
    }
    await select.selectOption({ value: await option.first().getAttribute("value") });
    await page.fill("input[name=password]", this.opts.password ?? "");
    await Promise.all([
      page.waitForURL(/\/game$/, { timeout }),
      page.click("button[name=join]")
    ]);
    await page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout });
    // Let late `ready` hooks and first renders settle, then clear startup noise from the screen
    await page.waitForTimeout(1500);
    await this.tidyUI();
    return this;
  }

  /** Dismiss any running tour and clear notifications so screenshots show the package UI. */
  async tidyUI() {
    await this.page.evaluate(() => {
      foundry.nue?.Tour?.activeTour?.exit();
      ui.notifications?.clear();
    }).catch(() => {});
  }

  async evaluate(code) {
    return this.page.evaluate(async (src) => {
      const fn = new (Object.getPrototypeOf(async function() {}).constructor)(src);
      const safe = (v) => {
        const seen = new WeakSet();
        return JSON.parse(JSON.stringify(v, (k, val) => {
          if (typeof val === "object" && val !== null) {
            if (seen.has(val)) return "[Circular]";
            seen.add(val);
            if (val instanceof foundry.abstract.DataModel) return val.toObject?.() ?? String(val);
            if (val instanceof HTMLElement) return `<${val.tagName.toLowerCase()} id="${val.id}" class="${val.className}">`;
          }
          if (typeof val === "function") return `[Function ${val.name}]`;
          return val;
        }) ?? null);
      };
      return safe(await fn());
    }, code);
  }

  summary(extra = {}) {
    const { errors, pageErrors, deprecations, warnings, failedRequests, ignored = 0 } = this.log;
    return {
      ok: errors.length === 0 && pageErrors.length === 0 && (extra.ok ?? true),
      ...extra,
      pageErrors, errors,
      deprecations: [...new Set(deprecations)],
      warnings: [...new Set(warnings)].slice(0, 30),
      failedRequests: [...new Set(failedRequests)].slice(0, 30),
      ignoredHeadlessWarnings: ignored
    };
  }

  async close() { await this.browser?.close(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------------------------

/** Log in, report environment, then create + render a sheet for every Actor/Item subtype the system defines. */
async function smoke(s) {
  const shots = s.opts.shots ? path.resolve(s.opts.shots) : null;
  if (shots) fs.mkdirSync(shots, { recursive: true });
  await s.tidyUI();
  if (shots) await s.page.screenshot({ path: path.join(shots, "00-ready.png") });

  const env = await s.evaluate(`
    const types = (doc) => Object.keys(CONFIG[doc]?.dataModels ?? {}).length
      ? Object.keys(CONFIG[doc].dataModels)
      : (game.documentTypes?.[doc] ?? []).filter(t => t !== "base");
    return {
      foundry: game.version, system: { id: game.system.id, version: game.system.version },
      world: game.world.id, user: game.user.name, isGM: game.user.isGM,
      activeModules: game.modules.filter(m => m.active).map(m => m.id + "@" + m.version),
      canvas: !!canvas?.ready, actorTypes: types("Actor"), itemTypes: types("Item"),
      sheetClasses: {
        Actor: Object.fromEntries(Object.entries(CONFIG.Actor.sheetClasses ?? {}).map(([t, v]) => [t, Object.keys(v)])),
        Item: Object.fromEntries(Object.entries(CONFIG.Item.sheetClasses ?? {}).map(([t, v]) => [t, Object.keys(v)]))
      }
    };
  `);

  const results = [];
  for (const docName of ["Actor", "Item"]) {
    const typeList = docName === "Actor" ? env.actorTypes : env.itemTypes;
    for (const type of typeList) {
      const r = { document: docName, type, created: false, rendered: false, error: null };
      const before = s.log.errors.length + s.log.pageErrors.length;
      try {
        const out = await s.evaluate(`
          const cls = getDocumentClass(${JSON.stringify(docName)});
          const doc = await cls.create({ name: "Smoke ${docName} ${type}", type: ${JSON.stringify(type)} });
          globalThis.__smokeDoc = doc;
          const sheet = doc.sheet;
          await sheet.render({ force: true });
          await new Promise(r => setTimeout(r, 400));
          const el = sheet.element;
          const html = el instanceof HTMLElement ? el : el?.[0];
          return {
            id: doc.id, uuid: doc.uuid, sheet: sheet.constructor.name, rendered: sheet.rendered,
            appId: html?.id ?? null, systemFields: Object.keys(doc.system ?? {}).length,
            inputs: html ? html.querySelectorAll("input, select, textarea, prose-mirror").length : 0
          };
        `);
        Object.assign(r, out, { created: true });
        if (shots && out.appId) {
          await s.page.locator(`#${out.appId}`).screenshot({ path: path.join(shots, `${docName}-${type}.png`) }).catch(() => {});
        }
        await s.evaluate(`
          const doc = globalThis.__smokeDoc;
          await doc.sheet.close();
          ${s.opts.keep ? "" : "await doc.delete();"}
        `);
      } catch (err) {
        r.error = String(err.message ?? err).split("\n")[0];
      }
      r.newErrors = s.log.errors.length + s.log.pageErrors.length - before;
      results.push(r);
    }
  }
  const failed = results.filter(r => r.error || !r.rendered || r.newErrors > 0);
  return s.summary({ ok: failed.length === 0, env, sheets: results, failedChecks: failed.length, screenshots: shots });
}

async function evalCmd(s) {
  const code = s.opts.file ? fs.readFileSync(path.resolve(s.opts.file), "utf8") : s.opts.code;
  if (!code) throw new Error("eval needs --code \"...\" or --file <path>");
  let result, error = null;
  try { result = await s.evaluate(code); } catch (err) { error = String(err.message ?? err); }
  await s.page.waitForTimeout(300);
  return s.summary({ ok: !error, result, evalError: error });
}

async function screenshot(s) {
  await s.tidyUI();
  const out = path.resolve(s.opts.out ?? "foundry-screenshot.png");
  if (s.opts.selector) await s.page.locator(s.opts.selector).first().screenshot({ path: out });
  else await s.page.screenshot({ path: out });
  return s.summary({ screenshot: out });
}

async function enableModules(s) {
  const ids = (s.opts._[1] ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (!ids.length) throw new Error("Usage: enable-modules <id,id,...>");
  const before = await s.evaluate(`
    const ids = ${JSON.stringify(ids)};
    const missing = ids.filter(id => !game.modules.get(id));
    if (missing.length) throw new Error("Not installed in this sandbox: " + missing.join(", ") + " (use fvtt-server.mjs --link / --link-installed)");
    const config = foundry.utils.deepClone(game.settings.get("core", "moduleConfiguration"));
    for (const id of ids) config[id] = true;
    await game.settings.set("core", "moduleConfiguration", config);
    return ids.map(id => ({ id, wasActive: game.modules.get(id).active }));
  `);
  // Module activation applies on reload
  await s.page.reload({ waitUntil: "domcontentloaded" });
  await s.page.waitForFunction(() => globalThis.game?.ready === true, null, { timeout: Number(s.opts.timeout ?? 60_000) });
  const after = await s.evaluate(`return ${JSON.stringify(ids)}.map(id => ({ id, active: game.modules.get(id)?.active }))`);
  return s.summary({ ok: after.every(m => m.active), before, after });
}

// ---------------------------------------------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));
const commands = { smoke, eval: evalCmd, screenshot, "enable-modules": enableModules };
const cmd = opts._[0];
if (!commands[cmd]) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 32).join("\n").replace(/^ \* ?/gm, ""));
  process.exit(cmd ? 1 : 0);
}

const session = new Session(opts);
let exitCode = 0;
try {
  await session.open();
  await session.login();
  const result = await commands[cmd](session);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) exitCode = 1;
} catch (err) {
  console.log(JSON.stringify(session.summary({ ok: false, fatal: String(err.message ?? err) }), null, 2));
  exitCode = 1;
} finally {
  await session.close();
}
process.exit(exitCode);
