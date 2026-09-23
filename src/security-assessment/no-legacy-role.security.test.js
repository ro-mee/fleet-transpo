// SEC-RBAC-004 — the retired role name must never drift back into runtime.
//
// `system_admin` was renamed to `super_admin` (role_id 1, migration 118).
// Allowed to still mention it: historical migrations, project journals,
// documented migration notes, and ONE fail-closed test pinning denial of the
// exact retired name (allowlisted below). Everything else — src runtime,
// active scripts, current RBAC docs — must use the canonical name.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SCAN_DIRS = ["src", "scripts"];
const SCAN_EXTS = new Set([".js", ".jsx", ".mjs"]);
// Files permitted to reference the retired name, and why.
const ALLOWLIST = new Set([
  // This guard (its pattern and allowlist mechanics name the retired role).
  "src/security-assessment/no-legacy-role.security.test.js",
  // Pins fail-closed denial of the exact retired name.
  "src/lib/auth/privilege.test.js",
]);

const RETIRED = /system_admin/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (SCAN_EXTS.has(extname(entry))) {
      out.push(full);
    }
  }
  return out;
}

const toRel = (full) => relative(ROOT, full).split(sep).join("/");

describe("SEC-RBAC-004 — no retired role name in runtime", () => {
  it("src/ and scripts/ contain zero system_admin references outside the allowlist", () => {
    const hits = [];
    for (const sub of SCAN_DIRS) {
      for (const file of walk(join(ROOT, sub))) {
        const rel = toRel(file);
        if (ALLOWLIST.has(rel)) continue;
        if (RETIRED.test(readFileSync(file, "utf8"))) hits.push(rel);
      }
    }
    expect(hits).toEqual([]);
  }, 30000);
});
