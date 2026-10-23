#!/usr/bin/env node
/**
 * fvtt-api.mjs — query the Foundry VTT source that ships with the installed app (the ground truth for the API).
 *
 * Usage:
 *   node fvtt-api.mjs where                    Print the app/source paths and the installed version
 *   node fvtt-api.mjs find <Name>              Where a class / function / method / constant is defined
 *   node fvtt-api.mjs hooks [filter]           Every hook event the client fires (Hooks.call / Hooks.callAll), with file:line
 *   node fvtt-api.mjs deprecations [filter]    Every logCompatibilityWarning (deprecated API) with since/until versions
 *   node fvtt-api.mjs grep <regex> [subpath]   Regex search over client/ + common/ (or a subdir/file, e.g. client/applications)
 *   node fvtt-api.mjs exports <namespace>      What a namespace exports, e.g. foundry.applications.api or foundry.data.fields
 *
 * Set FOUNDRY_APP_PATH if the app isn't in a standard location (see fvtt-server.mjs for the search list).
 */
import fs from "node:fs";
import path from "node:path";
import { findAppPath } from "./fvtt-paths.mjs";

const APP = findAppPath();
const ROOTS = ["client", "common"].map(d => path.join(APP, d));

function* walk(dir) {
  if (fs.statSync(dir).isFile()) { yield dir; return; }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (/\.(mjs|js)$/.test(entry.name)) yield p;
  }
}

function search(regex, roots = ROOTS, { context = 0 } = {}) {
  const hits = [];
  for (const root of roots) {
    for (const file of walk(root)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        regex.lastIndex = 0;
        if (regex.test(line)) {
          hits.push({ file: path.relative(APP, file), line: i + 1, text: line.trim(), lines, index: i });
        }
      });
    }
  }
  return hits;
}

const rel = (h) => `${h.file}:${h.line}`;
const [cmd, arg, arg2] = process.argv.slice(2);

switch (cmd) {
  case "where": {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
    console.log(`app:     ${APP}\nclient:  ${ROOTS[0]}\ncommon:  ${ROOTS[1]}\nversion: ${pkg.release.generation}.${pkg.release.build} (${pkg.release.channel}), node >= ${pkg.release.node_version}`);
    console.log(`core templates: ${path.join(APP, "templates")}\ncore css:       ${path.join(APP, "public", "css")}\nlang (en):      ${path.join(APP, "public", "lang", "en.json")}`);
    break;
  }
  case "find": {
    if (!arg) throw new Error("find <Name>");
    const n = arg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `(class\\s+${n}\\b|function\\s*\\*?\\s*${n}\\s*\\(|(const|let|var)\\s+${n}\\s*=|^\\s*(static\\s+)?(async\\s+)?(get\\s+|set\\s+)?#?${n}\\s*\\([^)]*\\)\\s*\\{|^\\s*static\\s+${n}\\s*=|export\\s+\\{[^}]*\\b${n}\\b)`
    );
    const hits = search(re);
    if (!hits.length) console.log(`No definition found for "${arg}". Try: node fvtt-api.mjs grep '${arg}'`);
    for (const h of hits.slice(0, 60)) console.log(`${rel(h)}  ${h.text.slice(0, 160)}`);
    if (hits.length > 60) console.log(`... ${hits.length - 60} more`);
    break;
  }
  case "hooks": {
    const re = /Hooks\.(callAll|call)\(\s*(["'`])([^"'`]+)\2?/;
    const filter = arg ? new RegExp(arg, "i") : null;
    const byName = new Map();
    for (const h of search(/Hooks\.(callAll|call)\(/, [ROOTS[0]])) {
      const m = h.text.match(re);
      const name = m ? m[3] : "(dynamic) " + h.text.slice(0, 80);
      if (filter && !filter.test(name)) continue;
      if (!byName.has(name)) byName.set(name, { kind: m?.[1] ?? "?", sites: [] });
      byName.get(name).sites.push(rel(h));
    }
    for (const [name, { kind, sites }] of [...byName].sort()) {
      console.log(`${name.padEnd(42)} ${kind === "call" ? "call   (cancellable: return false)" : "callAll"}  ${sites.slice(0, 3).join(", ")}${sites.length > 3 ? " ..." : ""}`);
    }
    console.log(`\n${byName.size} hook names. Template names like render\${...} expand per class (renderActorSheetV2, renderApplicationV2, ...).`);
    console.log("Document CRUD hooks (preCreateActor, updateItem, ...) are fired generically from client/documents/abstract/client-document.mjs.");
    break;
  }
  case "deprecations": {
    const filter = arg ? new RegExp(arg, "i") : null;
    for (const h of search(/logCompatibilityWarning\(/)) {
      if (h.text.includes("function logCompatibilityWarning")) continue;
      // Collect the call plus a little context (messages are often built on the lines above)
      const ctx = h.lines.slice(Math.max(0, h.index - 3), h.index + 6).join(" ").replace(/\s+/g, " ");
      if (filter && !filter.test(ctx)) continue;
      const ver = ctx.match(/since:\s*(\d+)[^}]*until:\s*(\d+)/);
      const msg = (ctx.match(/[`"]([^`"]{12,})[`"]/) ?? [])[1] ?? ctx.slice(0, 160);
      console.log(`${rel(h)}  [since ${ver?.[1] ?? "?"} until ${ver?.[2] ?? "?"}]  ${msg.slice(0, 220)}`);
    }
    break;
  }
  case "grep": {
    if (!arg) throw new Error("grep <regex> [subdir]");
    const roots = arg2 ? [path.join(APP, arg2)] : ROOTS;
    const hits = search(new RegExp(arg), roots);
    for (const h of hits.slice(0, 120)) console.log(`${rel(h)}  ${h.text.slice(0, 180)}`);
    if (hits.length > 120) console.log(`... ${hits.length - 120} more (narrow the regex or pass a subdir)`);
    break;
  }
  case "exports": {
    if (!arg) throw new Error("exports <namespace>, e.g. foundry.applications.api");
    const parts = arg.replace(/^foundry\.?/, "").split(".").filter(Boolean);
    // Namespaces map onto folders under client/ (preferred) or common/, each with a _module.mjs barrel file
    const candidates = [path.join(APP, "client", ...parts), path.join(APP, "common", ...parts)];
    let shown = false;
    for (const dir of candidates) {
      for (const f of [path.join(dir, "_module.mjs"), `${dir}.mjs`]) {
        if (fs.existsSync(f)) {
          console.log(`# ${path.relative(APP, f)}`);
          console.log(fs.readFileSync(f, "utf8").split("\n").filter(l => /export|import/.test(l)).join("\n"));
          shown = true;
          break;
        }
      }
    }
    if (!shown) console.log(`No barrel file for ${arg}. Try: node fvtt-api.mjs find <ClassName>`);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 14).join("\n").replace(/^ \* ?/gm, ""));
}
