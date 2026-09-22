/**
 * theme type-scale guard — every `type.<key>` reference in the mobile app must
 * name a step that actually exists in `lib/theme.js`.
 *
 * Why this exists: a style array silently ignores an `undefined` entry. So
 * `style={[type.bodySm, ...]}` where `bodySm` was never defined does not warn,
 * does not crash, does not fail a snapshot, and does not fail lint — the text
 * just renders at the bare React Native default. Sixteen call sites had
 * accumulated against four invented names (`titleMd`, `bodySm`, `labelSm`,
 * `headlineSm`) that read like a deliberate Sm/Md/Lg scale the theme does not
 * have. The scale is the source of truth; this test is what makes a reference
 * to a step outside it fail loudly instead of quietly rendering at 14px.
 *
 * Source-text, not an import: `lib/theme.js` pulls `react-native` transitively
 * via `lib/scaling.js`, and the vitest environment here is `node` with no RN
 * alias (see vitest.config.mjs). Reading the file is also the idiom the
 * coach-mark component tests already use.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const MOBILE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCAN_DIRS = ["app", "lib", "components"];
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  ".expo",
  "android",
  "ios",
  "__mocks__",
]);

// A file is in scope only when `type` really is the theme's scale — either
// imported from lib/theme, or destructured off useTheme().
const THEME_BINDING = [
  /import\s*\{[^}]*\btype\b[^}]*\}\s*from\s*["'][^"']*theme["']/,
  /const\s*\{[^}]*\btype\b[^}]*\}\s*=\s*useTheme\(\)/,
];

// Comment stripping is URL-aware: `https://` has to survive, or every key on a
// line after a URL would go unchecked. A comment that names a key (as the
// history notes in these files do) must not be read as a usage.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP_DIRS.has(entry)) walk(full, out);
    } else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** The keys of the object literal `typeFor` returns (4-space indent, `key: {`). */
function readScaleKeys() {
  const src = readFileSync(join(MOBILE_ROOT, "lib", "theme.js"), "utf8");
  const start = src.indexOf("function typeFor");
  expect(start, "lib/theme.js no longer defines typeFor").toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("\n}", start));
  return new Set([...body.matchAll(/^ {4}([A-Za-z][\w]*):\s*\{/gm)].map((m) => m[1]));
}

const rel = (file) => relative(MOBILE_ROOT, file).split(sep).join("/");

describe("theme type scale", () => {
  const keys = readScaleKeys();
  const files = SCAN_DIRS.flatMap((d) => walk(join(MOBILE_ROOT, d)));

  it("parses the scale out of lib/theme.js", () => {
    // Guards the extraction above: if theme.js is reformatted past recognition
    // this fails with a clear message instead of flagging all 100+ usages.
    expect(keys.size).toBeGreaterThanOrEqual(15);
    expect(keys.has("bodyMd")).toBe(true);
    expect(keys.has("labelLg")).toBe(true);
  });

  it("scans the app, lib and components trees", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("references only real scale steps", () => {
    const offenders = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!THEME_BINDING.some((re) => re.test(src))) continue;
      stripComments(src)
        .split("\n")
        .forEach((line, i) => {
          for (const [, key] of line.matchAll(/\btype\.([A-Za-z_$][\w$]*)/g)) {
            if (!keys.has(key)) offenders.push(`${rel(file)}:${i + 1} → type.${key}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("has retired the four invented names", () => {
    const src = files
      .map((f) => stripComments(readFileSync(f, "utf8")))
      .join("\n");
    for (const dead of ["titleMd", "bodySm", "labelSm", "headlineSm"]) {
      expect(src).not.toMatch(new RegExp(`\\btype\\.${dead}\\b`));
    }
  });
});
