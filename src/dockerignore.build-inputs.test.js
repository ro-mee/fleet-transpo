import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Pins the Docker build contract: `next build` only reads this required set
// (plus node_modules, which the deps stage installs, plus build-time env).
// Excluding any of them from the image breaks the HostForge build while the
// local build stays green — exactly what happened 2026-09-19 when jsconfig.json
// (the @/* alias definition) was dockerignored and the build failed with 1828
// "Can't resolve '@/...'" errors.
const REQUIRED = [
  "package.json",
  "package-lock.json",
  "next.config.mjs",
  "postcss.config.mjs",
  "jsconfig.json",
  "src",
  "src/app/page.js",
  "public",
];

function dockerignorePatterns() {
  const root = fileURLToPath(new URL("../.dockerignore", import.meta.url));
  return readFileSync(root, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// Minimal matcher for the pattern shapes used in this repo's .dockerignore:
// exact names, `*.ext` globs, `dir/` prefixes and `prefix*` globs.
function matches(pattern, target) {
  const dir = pattern.endsWith("/");
  const base = dir ? pattern.slice(0, -1) : pattern;
  if (!base.includes("*")) {
    return target === base || target.startsWith(`${base}/`);
  }
  const regex = new RegExp(`^${base.split("*").map(escapeRegExp).join(".*")}$`);
  if (regex.test(target)) return true;
  // A `foo*` file glob must not swallow a required directory either.
  return target.split("/").some((segment, i, parts) => {
    if (i === parts.length - 1) return false;
    return regex.test(parts.slice(0, i + 1).join("/"));
  });
}

function escapeRegExp(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

describe("docker build inputs are not dockerignored", () => {
  it.each(REQUIRED)("%s survives .dockerignore", (required) => {
    const hit = dockerignorePatterns().find((pattern) => matches(pattern, required));
    expect(hit, `${required} is excluded by .dockerignore pattern "${hit}"`).toBeUndefined();
  });

  it("keeps excluding secrets even as the file evolves", () => {
    const patterns = dockerignorePatterns();
    expect(patterns.some((p) => matches(p, ".env.local"))).toBe(true);
    expect(patterns.some((p) => matches(p, "mobile/.env"))).toBe(true);
  });
});
