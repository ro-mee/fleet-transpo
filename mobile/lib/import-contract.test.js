// Metro resolves a named import that the module does not export to `undefined`
// instead of failing the bundle, so
//   `import { INSPECTION_TYPES } from "../../lib/inspection-checklist"`
// was silently `undefined` and only threw on device — at the first property
// access (`INSPECTION_TYPES[screenMode]`), which reads "Cannot convert
// undefined value to object" and names the screen, not the import.
//
// Nothing in this suite renders a screen (these are source-text assertions),
// so no test could see it. This walks every screen/component import of a local
// lib module and checks the name is actually exported there.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative } from "node:path";

const MOBILE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const LIB_ROOT = join(MOBILE_ROOT, "lib");

const SCAN_DIRS = ["app", "components"];
const SOURCE_EXT = [".js", ".jsx"];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(full);
    return SOURCE_EXT.some((ext) => entry.name.endsWith(ext)) ? [full] : [];
  });
}

// `[\s\S]` so a braced import that spans lines (as the inspection screen's
// does) is still matched as one statement.
const NAMED_IMPORT = /import\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;

// Every spelling of a named export this repo uses. Anything the checker does
// not understand must fail loudly rather than fall through as "not exported".
const EXPORT_PATTERNS = [
  /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g,
];
const EXPORT_LIST = /export\s*\{([^}]*)\}/g;

function exportedNames(source) {
  const names = new Set();
  for (const pattern of EXPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  for (const match of source.matchAll(EXPORT_LIST)) {
    for (const part of match[1].split(",")) {
      const [local, exported] = part.split(/\s+as\s+/);
      if (exported) names.add(exported.trim());
      else if (local.trim()) names.add(local.trim());
    }
  }
  return names;
}

function resolveLocal(specifier, fromFile) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [base, ...SOURCE_EXT.map((e) => base + e)]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  for (const ext of SOURCE_EXT) {
    const indexed = join(base, "index" + ext);
    if (existsSync(indexed)) return indexed;
  }
  return null;
}

describe("local import contract", () => {
  const files = SCAN_DIRS.flatMap((d) => walk(join(MOBILE_ROOT, d)));

  it("scans the app and component trees", () => {
    // A walker that silently finds nothing would make every assertion below
    // vacuously true — the same false confidence as reading an empty result as
    // "nothing exposed".
    expect(files.length).toBeGreaterThan(20);
  });

  it("resolves every name imported from a module under lib/", () => {
    const problems = [];
    let checked = 0;

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const [, clause, specifier] of source.matchAll(NAMED_IMPORT)) {
        const target = resolveLocal(specifier, file);
        // Only local modules we own; a package specifier is not our contract.
        if (!target || !target.startsWith(LIB_ROOT)) continue;

        const available = exportedNames(readFileSync(target, "utf8"));
        const where = `${relative(MOBILE_ROOT, file)} → ${specifier}`;

        for (const raw of clause.split(",")) {
          const name = raw.trim().split(/\s+as\s+/)[0].trim();
          if (!name) continue;
          checked += 1;
          if (!available.has(name)) {
            problems.push(`${where}: "${name}" is not exported (has: ${[...available].join(", ")})`);
          }
        }
      }
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(10);
  });
});
