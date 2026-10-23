#!/usr/bin/env node
/**
 * Scaffold a Foundry VTT game system or module from the starter templates in ../assets/templates/.
 *
 *   node scaffold.mjs <system|module> <id> [--title "Title"] [--dest <dir>] [--author "name"]
 *
 * The template tree is copied to <dir> (default ./<id>). The placeholders below are replaced both in file contents
 * and in file/directory names:
 *
 *   __ID__      the package id, e.g. "my-system"            (lowercase letters, digits, hyphens)
 *   __TITLE__   the display title, e.g. "My System"
 *   __AUTHOR__  the author name
 *   __PREFIX__  the id upper-cased with underscores, e.g. "MY_SYSTEM", used as the localization namespace and as
 *               the key of the static config object (CONFIG.MY_SYSTEM)
 *
 * No dependencies: Node 18.3+ only.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(SCRIPT_DIR, "..", "assets", "templates");
const TYPES = ["system", "module"];
const IGNORED_NAMES = new Set([".DS_Store", "Thumbs.db"]);

/** Names that Windows reserves for devices; Foundry rejects them as package ids too. "core" is reserved for Foundry itself. */
const RESERVED_IDS = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|core)$/;

const USAGE = `Usage: node scaffold.mjs <system|module> <id> [options]

Creates a new Foundry VTT game system or module from the starter templates.

Arguments:
  system|module     What to create
  id                Package id: lowercase letters, digits and hyphens, starting with a letter (e.g. my-system)

Options:
  --title <text>    Display title (default: derived from the id)
  --dest <dir>      Destination directory (default: ./<id>); must not exist or must be empty
  --author <name>   Author name (default: git user.name, else "Your Name")
  -h, --help        Show this help
`;

/** Print an error and exit. */
function fail(message) {
  console.error(`Error: ${message}\n`);
  console.error("Run with --help for usage.");
  process.exit(1);
}

/**
 * Validate a package id.
 * @param {string|undefined} id
 * @returns {string|null}   An error message, or null if the id is valid
 */
function validateId(id) {
  if ( !id ) return "Missing <id>.";
  if ( !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id) ) {
    return `Invalid id "${id}": use lowercase letters, digits and single hyphens, starting with a letter `
      + "(e.g. my-system).";
  }
  if ( id.length > 64 ) return "The id may be at most 64 characters long.";
  if ( RESERVED_IDS.test(id) ) return `"${id}" is a reserved name and cannot be used as a package id.`;
  return null;
}

/** "my-cool-system" -> "My Cool System". */
function titleFromId(id) {
  return id.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

/** "my-cool-system" -> "MY_COOL_SYSTEM". */
function prefixFromId(id) {
  return id.toUpperCase().replaceAll("-", "_");
}

/** The git user name, if available. */
function gitUserName() {
  try {
    return execFileSync("git", ["config", "user.name"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** Escape a value for use inside a double-quoted JSON or JavaScript string literal. */
const escapeJsonString = value => JSON.stringify(value).slice(1, -1);

/**
 * Build the replacement function for a file, escaping values for the file type.
 * @param {Record<string, string>} values   Token -> raw value
 * @param {string} filename
 * @returns {(text: string) => string}
 */
function replacerFor(values, filename) {
  const ext = path.extname(filename).toLowerCase();
  const escape = [".json", ".mjs", ".js"].includes(ext) ? escapeJsonString : value => value;
  return text => text.replace(/__(ID|TITLE|AUTHOR|PREFIX)__/g, (_match, key) => escape(values[key]));
}

/** Replace the tokens that are safe to appear in a file name. */
function replaceInName(name, values) {
  return name.replaceAll("__ID__", values.ID).replaceAll("__PREFIX__", values.PREFIX);
}

/**
 * Recursively copy a template directory, replacing placeholders in names and text contents.
 * @param {string} srcDir
 * @param {string} destDir
 * @param {Record<string, string>} values
 * @param {string[]} created   Collects the relative paths of created files
 * @param {string} [rel=""]
 */
function copyTemplate(srcDir, destDir, values, created, rel = "") {
  fs.mkdirSync(destDir, { recursive: true });
  for ( const entry of fs.readdirSync(srcDir, { withFileTypes: true }) ) {
    if ( IGNORED_NAMES.has(entry.name) ) continue;
    const src = path.join(srcDir, entry.name);
    const outName = replaceInName(entry.name, values);
    const dest = path.join(destDir, outName);
    const outRel = path.posix.join(rel, outName);
    if ( entry.isDirectory() ) {
      copyTemplate(src, dest, values, created, outRel);
    }
    else if ( entry.isFile() ) {
      const data = fs.readFileSync(src);
      if ( data.subarray(0, 8000).includes(0) ) fs.writeFileSync(dest, data);   // binary: copy untouched
      else fs.writeFileSync(dest, replacerFor(values, entry.name)(data.toString("utf8")));
      created.push(outRel);
    }
  }
}

/** Is the directory missing or empty? Throws a readable error if the path is unusable. */
function assertDestinationAvailable(dest) {
  if ( !fs.existsSync(dest) ) return;
  const stat = fs.statSync(dest);
  if ( !stat.isDirectory() ) fail(`Destination exists and is not a directory: ${dest}`);
  if ( fs.readdirSync(dest).length ) fail(`Destination is not empty, refusing to overwrite: ${dest}`);
}

/** The default Foundry Data directory for each platform (users may have configured a different one). */
function dataDirs() {
  const home = os.homedir();
  return {
    darwin: path.join(home, "Library", "Application Support", "FoundryVTT", "Data"),
    linux: path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "FoundryVTT", "Data"),
    win32: path.win32.join(process.env.LOCALAPPDATA || path.win32.join(home, "AppData", "Local"), "FoundryVTT", "Data")
  };
}

/** Print what to do next, with link commands for the current platform. */
function printNextSteps(type, id, dest) {
  const folder = type === "system" ? "systems" : "modules";
  const dirs = dataDirs();
  const platform = process.platform in dirs ? process.platform : "linux";
  const pathApi = platform === "win32" ? path.win32 : path;
  const target = pathApi.join(dirs[platform], folder, id);

  console.log("\nNext steps");
  console.log("----------");
  console.log(`1. Make Foundry see the ${type}. Link (or copy) the folder into your Foundry Data directory:`);
  console.log("");
  if ( platform === "win32" ) {
    console.log(`     mklink /J "${target}" "${dest}"`);
  }
  else {
    console.log(`     mkdir -p "${path.dirname(target)}"`);
    console.log(`     ln -s "${dest}" "${target}"`);
  }
  console.log("");
  console.log("   Default Data directories (yours may differ; see Foundry's Configuration screen):");
  console.log(`     macOS    ~/Library/Application Support/FoundryVTT/Data/${folder}/${id}`);
  console.log(`     Linux    ~/.local/share/FoundryVTT/Data/${folder}/${id}`);
  console.log(`     Windows  %LOCALAPPDATA%\\FoundryVTT\\Data\\${folder}\\${id}`);
  console.log("");
  if ( type === "system" ) {
    console.log("2. Start (or restart) Foundry, create a new World, and choose this system in the System dropdown.");
  }
  else {
    console.log("2. Start (or restart) Foundry, open a World, then Game Settings > Manage Modules and enable the module.");
  }
  console.log("3. Edit files and reload. Start Foundry with --hotReload for live .css/.hbs/lang updates;");
  console.log("   JavaScript changes need a browser refresh (F5).");
  console.log(`4. Read ${path.join(dest, "README.md")} for the file layout.`);
  console.log("");
  const q = (p) => (p.includes(" ") ? `"${p}"` : p);
  console.log("Or test it in an isolated, headless Foundry (doesn't touch your real worlds):");
  console.log(`     node ${q(path.join(SCRIPT_DIR, "fvtt-lint.mjs"))} ${q(dest)}`);
  if ( type === "system" ) {
    console.log(`     node ${q(path.join(SCRIPT_DIR, "fvtt-server.mjs"))} start --link ${q(dest)} --fresh-world`);
  }
  else {
    console.log(`     node ${q(path.join(SCRIPT_DIR, "fvtt-server.mjs"))} start --link ${q(dest)} --link-installed <systemId> --system <systemId>`);
    console.log(`     node ${q(path.join(SCRIPT_DIR, "fvtt-browser.mjs"))} enable-modules ${id}`);
  }
  console.log(`     node ${q(path.join(SCRIPT_DIR, "fvtt-browser.mjs"))} smoke --shots /tmp/${id}-shots`);
}

function main() {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        title: { type: "string" },
        dest: { type: "string" },
        author: { type: "string" },
        help: { type: "boolean", short: "h" }
      }
    });
  }
  catch(err) {
    fail(err.message);
  }
  const { values: options, positionals } = parsed;
  if ( options.help ) {
    console.log(USAGE);
    return;
  }

  const [type, id, ...extra] = positionals;
  if ( !TYPES.includes(type) ) fail(`The first argument must be one of: ${TYPES.join(", ")}.`);
  const idError = validateId(id);
  if ( idError ) fail(idError);
  if ( extra.length ) fail(`Unexpected extra arguments: ${extra.join(" ")}`);

  const title = (options.title ?? titleFromId(id)).replace(/\s+/g, " ").trim();
  if ( !title ) fail("The title may not be empty.");
  if ( title.includes("*/") ) fail('The title may not contain "*/".');
  const author = (options.author ?? gitUserName() ?? "").replace(/\s+/g, " ").trim() || "Your Name";

  const templateDir = path.join(TEMPLATE_ROOT, type);
  if ( !fs.existsSync(templateDir) ) fail(`Template directory not found: ${templateDir}`);

  const dest = path.resolve(options.dest ?? id);
  assertDestinationAvailable(dest);

  const values = { ID: id, TITLE: title, AUTHOR: author, PREFIX: prefixFromId(id) };
  const created = [];
  copyTemplate(templateDir, dest, values, created);

  console.log(`Created ${type} "${title}" (${id}) in ${dest}`);
  console.log(`  ${created.length} files, localization prefix ${values.PREFIX}, author "${author}"`);
  for ( const file of created.sort() ) console.log(`  ${file}`);
  printNextSteps(type, id, dest);
}

main();
