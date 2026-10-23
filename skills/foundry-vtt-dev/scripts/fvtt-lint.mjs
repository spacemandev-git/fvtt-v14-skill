#!/usr/bin/env node
/**
 * fvtt-lint.mjs — static checks for a Foundry VTT system or module, tuned to the installed Foundry version.
 *
 * Usage:  node fvtt-lint.mjs <packageDir> [--json] [--all-files]
 *
 * Checks:
 *   manifest   JSON validity, id vs folder name, obsolete keys (name, minimumCoreVersion, author, dependencies...),
 *              compatibility, every referenced file exists (esmodules, scripts, styles, languages, packs), template.json
 *   js         syntax (node --check), relative imports resolve, deprecated/removed globals (read live from the installed
 *              Foundry's backwards-compatibility table in client/client.mjs), and obsolete API patterns that LLMs
 *              commonly emit (Application v1, jQuery, data.data, sync rolls, CHAT_MESSAGE_TYPES, bare mergeObject...)
 *   templates  every .hbs compiles with Handlebars; template paths referenced in code exist
 *   i18n       lang files parse; localization keys used in code/templates under your own prefixes exist
 *
 * Exit code 1 if any errors. Warnings are things that work today but are deprecated or fragile.
 * Vendored files (node_modules, *.min.js, files > 400 KB) are skipped unless --all-files.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findAppPath } from "./fvtt-paths.mjs";

const args = process.argv.slice(2);
const pkgDir = path.resolve(args.find(a => !a.startsWith("--")) ?? ".");
const asJson = args.includes("--json");
const allFiles = args.includes("--all-files");

const findings = [];
const add = (severity, area, message, where = null, fix = null) => findings.push({ severity, area, message, where, fix });
const relp = (p) => path.relative(pkgDir, p) || ".";

let APP = null;
let release = null;
try {
  APP = findAppPath();
  release = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8")).release;
} catch (e) {
  add("info", "env", `Foundry app not found (${e.message.split(".")[0]}); version-specific checks skipped.`);
}

// ---------------------------------------------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------------------------------------------

let manifest = null, manifestFile = null, pkgType = null;
for (const [file, type] of [["system.json", "system"], ["module.json", "module"]]) {
  const p = path.join(pkgDir, file);
  if (!fs.existsSync(p)) continue;
  manifestFile = p; pkgType = type;
  try { manifest = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { add("error", "manifest", `${file} is not valid JSON: ${e.message}`, file); }
  break;
}
if (!manifestFile) {
  add("error", "manifest", "No system.json or module.json found.", relp(pkgDir));
}

if (manifest) {
  const mf = path.basename(manifestFile);
  const id = manifest.id;
  if (!id) add("error", "manifest", "Missing `id`.", mf, manifest.name ? `Rename "name" to "id" (v10+).` : null);
  else {
    if (!/^[a-z0-9-_]+$/i.test(id)) add("warn", "manifest", `id "${id}" should be lowercase letters, digits and hyphens.`, mf);
    if (id !== path.basename(fs.realpathSync(pkgDir)) && id !== path.basename(pkgDir)) {
      add("warn", "manifest", `id "${id}" does not match the folder name "${path.basename(pkgDir)}". Installed packages must live in Data/${pkgType}s/${id}.`, mf);
    }
  }
  for (const k of ["title", "version"]) if (!manifest[k]) add("error", "manifest", `Missing \`${k}\`.`, mf);
  const obsolete = {
    name: "Use `id` (v10+).",
    minimumCoreVersion: "Use `compatibility.minimum`.",
    compatibleCoreVersion: "Use `compatibility.verified`.",
    maximumCoreVersion: "Use `compatibility.maximum`.",
    author: "Use `authors: [{name, url, email, discord}]`.",
    dependencies: "Use `relationships.requires` (and `relationships.recommends`).",
    systems: "Use `relationships.systems: [{id, type: \"system\", compatibility}]`.",
    templateVersion: "Remove; template.json versioning is obsolete.",
    system: pkgType === "module" ? "Use `relationships.systems`." : null
  };
  for (const [k, fix] of Object.entries(obsolete)) {
    if (fix && k in manifest) add("warn", "manifest", `Obsolete manifest key \`${k}\`.`, mf, fix);
  }
  const compat = manifest.compatibility;
  if (!compat?.minimum) add("warn", "manifest", "No `compatibility.minimum`.", mf, `Add "compatibility": {"minimum": "13", "verified": "${release?.generation ?? 14}"}`);
  if (release && compat?.verified && parseInt(compat.verified) < release.generation) {
    add("info", "manifest", `compatibility.verified is ${compat.verified}; installed Foundry is ${release.generation}.`, mf);
  }
  if (release && compat?.minimum && parseInt(compat.minimum) > release.generation) {
    add("error", "manifest", `compatibility.minimum ${compat.minimum} is newer than the installed Foundry ${release.generation}; it will not load.`, mf);
  }
  if (release && compat?.maximum && parseInt(compat.maximum) < release.generation) {
    add("error", "manifest", `compatibility.maximum ${compat.maximum} excludes the installed Foundry ${release.generation}.`, mf);
  }
  const checkFiles = (key, list) => {
    for (const entry of list ?? []) {
      const p = typeof entry === "string" ? entry : entry?.path;
      if (!p) continue;
      if (/^https?:/.test(p)) continue;
      if (!fs.existsSync(path.join(pkgDir, p))) add("error", "manifest", `${key} entry not found: ${p}`, mf);
    }
  };
  checkFiles("esmodules", manifest.esmodules);
  checkFiles("scripts", manifest.scripts);
  checkFiles("styles", manifest.styles);
  checkFiles("languages", manifest.languages);
  if (manifest.scripts?.length && !manifest.esmodules?.length) {
    add("info", "manifest", "Uses `scripts` (classic) only; modern packages use `esmodules`.", mf);
  }
  for (const pack of manifest.packs ?? []) {
    if (pack.entity) add("warn", "manifest", `Pack "${pack.name}" uses obsolete \`entity\`.`, mf, "Use `type`.");
    if (pack.path?.endsWith(".db")) add("warn", "manifest", `Pack "${pack.name}" points to a NeDB .db file.`, mf, "Since v11 packs are LevelDB folders: `\"path\": \"packs/<name>\"` (build with @foundryvtt/foundryvtt-cli).");
    const p = pack.path ?? `packs/${pack.name}`;
    if (!fs.existsSync(path.join(pkgDir, p)) && !fs.existsSync(path.join(pkgDir, p.replace(/\.db$/, "")))) {
      add("warn", "manifest", `Pack "${pack.name}" folder not found at ${p} (fine if it's built at release time).`, mf);
    }
  }
  if (pkgType === "system") {
    const hasTemplate = fs.existsSync(path.join(pkgDir, "template.json"));
    if (hasTemplate) add("warn", "manifest", "template.json is deprecated (removed in v16).", "template.json",
      "Declare `documentTypes` in system.json and register TypeDataModels in CONFIG.<Doc>.dataModels.");
    if (!hasTemplate && !manifest.documentTypes) add("warn", "manifest", "System has neither documentTypes nor template.json; no Actor/Item subtypes will exist.", mf);
  }
  if (manifest.flags?.hotReload === undefined) add("info", "manifest", "No flags.hotReload; add it for live CSS/HBS/lang reloads during development.", mf,
    `"flags": {"hotReload": {"extensions": ["css", "hbs", "json"], "paths": ["styles", "templates", "lang"]}}`);
}

// ---------------------------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------------------------

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "packs") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}
const files = fs.existsSync(pkgDir) ? [...walk(pkgDir)] : [];
const isVendored = (f) => !allFiles && (/\.min\.js$|(^|[\\/])(vendor|vendors|lib|libs|third[-_]?party|dist|build|[\w-]+-dist)[\\/]/.test(relp(f)) || fs.statSync(f).size > 400_000);
const jsFiles = files.filter(f => /\.(m?js)$/.test(f) && !isVendored(f));
// Handlebars templates: .hbs/.handlebars anywhere, plus legacy .html files under a templates/ folder
const hbsFiles = files.filter(f => /\.(hbs|handlebars)$/.test(f) || (/\.html$/.test(f) && /(^|[\\/])templates[\\/]/.test(relp(f))));
const langFiles = files.filter(f => /[\\/]lang[\\/][^\\/]+\.json$/.test(f));

// ---------------------------------------------------------------------------------------------------------------
// JS: syntax, imports, deprecated globals, obsolete patterns
// ---------------------------------------------------------------------------------------------------------------

/** Read the installed Foundry's backwards-compatibility global table, e.g. { renderTemplate: {path, since, until} } */
function loadDeprecatedGlobals() {
  const out = {};
  if (!APP) return out;
  const src = fs.readFileSync(path.join(APP, "client", "client.mjs"), "utf8");
  const re = /addBackwardsCompatibilityReferences\(\{([\s\S]*?)\},\s*\{\s*since:\s*(\d+),\s*until:\s*(\d+)\s*\}\)/g;
  for (const m of src.matchAll(re)) {
    for (const e of m[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*:\s*"([^"]+)"/gm)) {
      out[e[1]] = { path: `foundry.${e[2]}`, since: m[2], until: m[3] };
    }
  }
  // Direct globals marked "@deprecated since vX until vY" in the globalThis assignment
  for (const m of src.matchAll(/@deprecated since v(\d+) until v(\d+) \*\/\s*\n\s*([A-Za-z_$][\w$]*)\s*:\s*([\w.]+)/g)) {
    out[m[3]] = { path: `foundry.${m[4]}`, since: m[1], until: m[2] };
  }
  return out;
}
const deprecatedGlobals = loadDeprecatedGlobals();

// Globals that no longer exist at all (ReferenceError at runtime)
const REMOVED_UTILS = ["mergeObject", "duplicate", "getProperty", "setProperty", "hasProperty", "expandObject",
  "flattenObject", "randomID", "isNewerVersion", "diffObject", "deepClone", "filterObject", "invertObject",
  "getType", "isObjectEmpty", "isEmpty", "debounce", "setDifference", "getRoute", "srcExists", "rgbToHex", "hexToRGB"];

const PATTERNS = [
  { sev: "error", re: /\bCONST\.CHAT_MESSAGE_TYPES\b/, msg: "CONST.CHAT_MESSAGE_TYPES was removed.", fix: "Use CONST.CHAT_MESSAGE_STYLES for `style`; attach rolls via `rolls: [roll]`; use ChatMessage subtypes (TypeDataModel) for custom kinds." },
  { sev: "error", re: /\.data\.data\b/, msg: "`.data.data` is the pre-v10 data path.", fix: "Use `doc.system` (and `doc._source.system` for raw source)." },
  { sev: "error", re: /evaluate\(\s*\{\s*async\s*:\s*false/, msg: "Synchronous roll evaluation via {async:false} was removed.", fix: "`await roll.evaluate()`, or `roll.evaluateSync()` for deterministic formulas only." },
  { sev: "error", re: /\bentityClass\b|CONFIG\.\w+\.entity\b|\bgame\.system\.data\b/, msg: "Pre-v10 API (entity/entityClass/game.system.data).", fix: "Use CONFIG.<Doc>.documentClass and game.system directly." },
  { sev: "warn", re: /\bextends\s+(?:foundry\.appv1\.[\w.]+|(?:ActorSheet|ItemSheet|FormApplication|DocumentSheet|Application|Dialog|JournalSheet)\b(?!V2))/, msg: "Extends an Application v1 class (deprecated since v13, removed in v16).", fix: "Use foundry.applications.api.ApplicationV2 / HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) etc." },
  { sev: "warn", re: /\bnew\s+Dialog\s*\(/, msg: "`new Dialog(...)` is Application v1.", fix: "Use foundry.applications.api.DialogV2.wait/confirm/prompt/input." },
  { sev: "warn", re: /static\s+get\s+defaultOptions\s*\(/, msg: "`static get defaultOptions()` is the Application v1 pattern.", fix: "Use `static DEFAULT_OPTIONS = {...}` and `static PARTS` in ApplicationV2." },
  { sev: "warn", re: /\bactivateListeners\s*\(\s*html\b/, msg: "`activateListeners(html)` is Application v1 (jQuery).", fix: "Use `actions` in DEFAULT_OPTIONS with data-action attributes, and `_onRender(context, options)` for other listeners." },
  { sev: "warn", re: /^\s*(async\s+)?getData\s*\(/, msg: "`getData()` is Application v1.", fix: "Use `async _prepareContext(options)` (and `_preparePartContext`)." },
  { sev: "warn", re: /\b_updateObject\s*\(/, msg: "`_updateObject` is FormApplication v1.", fix: "Use `form: {handler, submitOnChange}` in DEFAULT_OPTIONS, or rely on DocumentSheetV2's built-in submit." },
  { sev: "warn", re: /\bhtml\.find\(|(?<![\w$.])\$\(\s*(html|this|event|ev|e)\b/, msg: "jQuery usage; V2 apps and v13+ render hooks pass HTMLElement.", fix: "Use element.querySelector/querySelectorAll and addEventListener." },
  { sev: "warn", re: /Hooks\.(on|once)\(\s*["']renderChatMessage["']/, msg: "renderChatMessage hook is deprecated (jQuery).", fix: "Use `renderChatMessageHTML` (receives an HTMLElement)." },
  { sev: "warn", re: /\.roll\(\s*\{\s*async\s*:/, msg: "`roll({async})` is obsolete.", fix: "`await roll.evaluate()`." },
  { sev: "warn", re: /["'`][\w.]*\.?-=[\w]+["'`]\s*:|["'`]==[\w]+["'`]\s*:/, minGen: 14,
    msg: "Legacy -=key / ==key update operators are deprecated in v14 (removed in v16).",
    fix: "v14: {key: _del} / {key: _replace(value)} (or foundry.data.operators.ForcedDeletion / ForcedReplacement.create). v13 only understands -=, so branch on game.release.generation when supporting both." },
  { sev: "warn", re: /\bCONST\.DICE_ROLL_MODES\b|\bCONFIG\.Dice\.rollModes\b|toMessage\([^)]*\{\s*rollMode\b|get\(\s*["']core["']\s*,\s*["']rollMode["']/, minGen: 14,
    msg: "Roll modes are deprecated in v14 (removed in v16) in favor of chat message modes.",
    fix: "v14: toMessage(data, {messageMode}) with keys of CONFIG.ChatMessage.modes (public/gm/blind/self/ic) and the core.messageMode setting; for v13+v14 support omit the option or branch on game.release.generation." },
  { sev: "warn", re: /\bCONFIG\.\w+\.sheetClass(es)?\s*=/, msg: "Assigning sheet classes directly.", fix: "Register via foundry.applications.apps.DocumentSheetConfig.registerSheet(DocClass, scope, SheetClass, {types, makeDefault})." },
  { sev: "warn", re: /game\.settings\.register\([^)]*\{[^}]*config\s*:\s*true(?![^}]*scope)/, msg: "Setting registered without an explicit scope.", fix: "Add scope: \"world\" | \"client\" | \"user\"." },
  { sev: "info", re: /\bsetTimeout\s*\(\s*\(\)\s*=>\s*this\.render/, msg: "Deferred re-render via setTimeout; usually a sign of fighting the render cycle.", fix: "Let document updates trigger renders, or call render() once after awaiting the update." }
];

/**
 * Blank out comments (and optionally string/template-literal text) while preserving line numbers, so regex rules
 * only see real code. Template-literal ${expressions} are kept. Regex literals are not special-cased.
 */
function blank(src, { strings = false } = {}) {
  let out = "", i = 0;
  const stack = []; // "`" for template text, "{" for code inside ${...}
  const keep = (c) => (c === "\n" ? "\n" : " ");
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    const inTemplate = stack.at(-1) === "`";
    if (inTemplate) {
      if (c === "\\") { out += strings ? "  " : c + (n ?? ""); i += 2; continue; }
      if (c === "`") { stack.pop(); out += c; i++; continue; }
      if (c === "$" && n === "{") { stack.push("{"); out += "${"; i += 2; continue; }
      out += strings ? keep(c) : c; i++; continue;
    }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") { out += " "; i++; } continue; }
    if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2), stop = end < 0 ? src.length : end + 2;
      for (; i < stop; i++) out += keep(src[i]);
      continue;
    }
    if (c === "'" || c === '"') {
      out += c; i++;
      while (i < src.length && src[i] !== c && src[i] !== "\n") {
        if (src[i] === "\\") { out += strings ? "  " : src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += strings ? " " : src[i]; i++;
      }
      if (i < src.length) { out += src[i]; i++; }
      continue;
    }
    if (c === "`") { stack.push("`"); out += c; i++; continue; }
    if (c === "{" && stack.length) stack.push("{");
    if (c === "}" && stack.at(-1) === "{") { stack.pop(); out += c; i++; continue; }
    out += c; i++;
  }
  return out;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fvtt-lint-"));
for (const file of jsFiles) {
  const raw = fs.readFileSync(file, "utf8");
  const where = relp(file);

  // Syntax: check as an ES module regardless of extension
  try {
    const tmp = path.join(tmpDir, "check.mjs");
    fs.writeFileSync(tmp, raw);
    execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" });
  } catch (e) {
    const msg = String(e.stderr ?? e.message).split("\n").filter(Boolean);
    const line = msg[0]?.match(/:(\d+)$/)?.[1];
    add("error", "js", `Syntax error: ${msg.find(l => /Error/.test(l)) ?? msg[0]}`, line ? `${where}:${line}` : where);
    continue;
  }

  // Relative imports resolve
  for (const m of raw.matchAll(/(?:import|export)\s[^'"]*?from\s*["'](\.{1,2}\/[^"']+)["']|import\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)|import\s*["'](\.{1,2}\/[^"']+)["']/g)) {
    const spec = m[1] ?? m[2] ?? m[3];
    const target = path.resolve(path.dirname(file), spec);
    if (!fs.existsSync(target)) {
      const line = raw.slice(0, m.index).split("\n").length;
      add("error", "js", `Import not found: "${spec}"`, `${where}:${line}`);
    }
  }

  const code = blank(raw);                          // comments removed, strings kept (some rules match string args)
  const bare = blank(raw, { strings: true });       // comments and string text removed (identifier rules)
  const lines = code.split("\n");
  const bareLines = bare.split("\n");
  const declared = (name) => new RegExp(`(?:const|let|var|class|function)\\s+${name}\\b|import[^;]*\\b${name}\\b[^;]*from|\\{[^}]*\\b${name}\\b[^}]*\\}\\s*=`).test(bare);

  lines.forEach((line, i) => {
    const at = `${where}:${i + 1}`;
    for (const p of PATTERNS) {
      if (p.minGen && release && release.generation < p.minGen) continue;
      if (!p.re.test(line)) continue;
      // Version-gated legacy branches (e.g. `if (game.release.generation >= 14) ... else {rollMode}`) are intentional
      const ctx = lines.slice(Math.max(0, i - 4), i + 1).join("\n");
      if (p.minGen && /release\.generation|game\.version|isNewerVersion/.test(ctx)) {
        add("info", "js", `${p.msg} (version-gated here, fine if this is the older-generation branch)`, at);
        continue;
      }
      add(p.sev, "js", p.msg, at, p.fix);
    }
    for (const name of REMOVED_UTILS) {
      const isMethodDef = new RegExp(`^\\s*(static\\s+)?(async\\s+)?${name}\\s*\\([^)]*\\)\\s*\\{`).test(bareLines[i]);
      if (!isMethodDef && new RegExp(`(?<![\\w$.#])${name}\\s*\\(`).test(bareLines[i]) && !declared(name)) {
        add("error", "js", `Global \`${name}()\` no longer exists.`, at, `Use foundry.utils.${name}().`);
      }
    }
  });

  // Context menu entries using pre-v14 keys: an object literal with both `icon:` and `callback:` (heuristic)
  if (!release || release.generation >= 14) {
    for (const m of bare.matchAll(/\{[^{}]*\}/g)) {
      const obj = m[0];
      // Old entry: icon + callback + (name or condition). DialogV2 buttons ({action, label, icon, callback}) are fine.
      if (!/\bicon\s*:/.test(obj) || !/\bcallback\s*:/.test(obj) || !/\b(name|condition)\s*:/.test(obj) || /\baction\s*:/.test(obj)) continue;
      const line = bare.slice(0, m.index + m[0].indexOf("callback")).split("\n").length;
      add("warn", "js", "Context menu entry uses pre-v14 keys (name/callback/condition), deprecated in v14 (removed in v16).", `${where}:${line}`,
        "v14: {label, icon, onClick: (event, target) => {...}, visible}. Supporting v13 too: branch on game.release.generation.");
    }
  }

  // Deprecated globals (one finding per name per file, at first use)
  for (const [name, info] of Object.entries(deprecatedGlobals)) {
    const re = new RegExp(`(?<![\\w$.#'"\`])${name.replace(/\$/g, "\\$")}\\b(?!\\s*:)`);
    const idx = bareLines.findIndex(l => re.test(l) && !/^\s*import\b/.test(l));
    if (idx >= 0 && !declared(name)) {
      const fix = info.path.includes(".appv1.")
        ? `Migrate to ApplicationV2 (foundry.applications.api / foundry.applications.sheets); the v1 class is only reachable as ${info.path} until v${info.until}.`
        : `Use ${info.path}.`;
      add("warn", "js", `Global \`${name}\` is deprecated since v${info.since} (removed in v${info.until}).`, `${where}:${idx + 1}`, fix);
    }
  }
}
fs.rmSync(tmpDir, { recursive: true, force: true });

// ---------------------------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------------------------

let Handlebars = null;
if (APP) {
  try { Handlebars = createRequire(path.join(APP, "package.json"))("handlebars"); } catch { /* optional */ }
}
for (const file of hbsFiles) {
  if (!Handlebars) break;
  try { Handlebars.precompile(fs.readFileSync(file, "utf8")); }
  catch (e) { add("error", "templates", `Handlebars compile error: ${e.message.split("\n")[0]}`, relp(file)); }
}
if (manifest?.id) {
  const prefix = `${pkgType}s/${manifest.id}/`;
  const srcFiles = [...jsFiles, ...hbsFiles];
  for (const file of srcFiles) {
    const raw = fs.readFileSync(file, "utf8");
    for (const m of raw.matchAll(/["'`]((?:systems|modules)\/[\w-]+\/[^"'`$]+?\.(?:hbs|html|handlebars))["'`]/g)) {
      if (!m[1].startsWith(prefix)) continue;
      const local = path.join(pkgDir, m[1].slice(prefix.length));
      if (!fs.existsSync(local)) {
        const line = raw.slice(0, m.index).split("\n").length;
        add("error", "templates", `Template not found: ${m[1]}`, `${relp(file)}:${line}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// i18n
// ---------------------------------------------------------------------------------------------------------------

function flatten(obj, prefix = "", out = new Set()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out.add(key);
  }
  return out;
}
const langKeys = new Set();
const ownPrefixes = new Set();
for (const file of langFiles) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (/en\.json$/.test(file) || langFiles.length === 1) {
      for (const k of flatten(data)) langKeys.add(k);
      for (const k of Object.keys(data)) if (k !== "TYPES" && /^[A-Z][A-Z0-9_-]+$/.test(k.split(".")[0])) ownPrefixes.add(k.split(".")[0]);
    }
  } catch (e) { add("error", "i18n", `Invalid JSON: ${e.message}`, relp(file)); }
}
let coreKeys = new Set();
if (APP) {
  try { coreKeys = flatten(JSON.parse(fs.readFileSync(path.join(APP, "public", "lang", "en.json"), "utf8"))); } catch { /* optional */ }
}
if (langKeys.size && ownPrefixes.size) {
  const missing = new Map();
  const usage = /(?:localize|format)\s*\(\s*["']([A-Z][\w.-]+)["']|\{\{\s*localize\s+["']([A-Z][\w.-]+)["']|\(localize\s+["']([A-Z][\w.-]+)["']|(?:label|hint|title|name|placeholder)\s*[:=]\s*["']([A-Z][A-Z0-9_-]+\.[\w.-]+)["']/g;
  for (const file of [...jsFiles, ...hbsFiles]) {
    const raw = fs.readFileSync(file, "utf8");
    for (const m of raw.matchAll(usage)) {
      const key = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (!ownPrefixes.has(key.split(".")[0])) continue;
      if (key.endsWith(".") || /^\s*\+/.test(raw.slice(m.index + m[0].length))) continue; // dynamically built key
      if (langKeys.has(key) || coreKeys.has(key)) continue;
      if (!missing.has(key)) missing.set(key, `${relp(file)}:${raw.slice(0, m.index).split("\n").length}`);
    }
  }
  for (const [key, where] of missing) add("warn", "i18n", `Localization key not found in lang files: ${key}`, where);
}
if (manifest && !manifest.languages?.length && langFiles.length) {
  add("warn", "i18n", "lang/*.json exists but the manifest declares no `languages`.", path.basename(manifestFile),
    `"languages": [{"lang": "en", "name": "English", "path": "lang/en.json"}]`);
}

// ---------------------------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------------------------

const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.area.localeCompare(b.area));
const counts = { error: 0, warn: 0, info: 0 };
for (const f of findings) counts[f.severity]++;

if (asJson) {
  console.log(JSON.stringify({ package: manifest?.id ?? null, type: pkgType, foundry: release ? `${release.generation}.${release.build}` : null,
    counts, files: { js: jsFiles.length, hbs: hbsFiles.length, lang: langFiles.length }, findings }, null, 2));
} else {
  console.log(`fvtt-lint ${pkgType ?? "?"}:${manifest?.id ?? "?"}  (Foundry ${release ? `${release.generation}.${release.build}` : "?"}; `
    + `${jsFiles.length} js, ${hbsFiles.length} hbs, ${langFiles.length} lang files)`);
  // Group identical findings so a pattern repeated across many files prints once with its locations
  const groups = new Map();
  for (const f of findings) {
    const key = `${f.severity}|${f.area}|${f.message}|${f.fix ?? ""}`;
    if (!groups.has(key)) groups.set(key, { ...f, wheres: [] });
    if (f.where) groups.get(key).wheres.push(f.where);
  }
  for (const g of groups.values()) {
    const locs = g.wheres.length > 6 ? `${g.wheres.slice(0, 6).join(", ")} (+${g.wheres.length - 6} more)` : g.wheres.join(", ");
    console.log(`${g.severity.toUpperCase().padEnd(5)} [${g.area}] ${g.message}${locs ? `\n        at: ${locs}` : ""}${g.fix ? `\n        fix: ${g.fix}` : ""}`);
  }
  console.log(`\n${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} info`);
}
process.exit(counts.error ? 1 : 0);
