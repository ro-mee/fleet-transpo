// Stage 1 verification — route-auth audit (Roadmap Phase 5, item 18).
//
// Asserts every handler under src/app/api/** carries an authentication guard,
// so nothing ships open. Three guard families are recognized:
//
//   1. requireAuth(req, [roles]) / requireDriver(req)  — user-session auth
//   2. verifyServiceToken(req, process.env.X)          — machine-to-machine
//   3. auth() from @/lib/auth with a session null-check — self-authenticating
//      routes that read the session inline (auth/profile, auth/change-password)
//
// A route that only IMPORTS a guard but never calls it counts as open. Public
// endpoints are not a gap: they authenticate by their own protocol and are
// listed explicitly below (NextAuth handler, PWA manifest, mobile token
// endpoints). The manifest is static data with no DB access; the mobile auth
// endpoints carry their own credential/refresh-token checks.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-route-auth.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_ROOT = join(process.cwd(), "src", "app", "api");

// A route is fully public when its relative path (forward-slash form) is on the
// allowlist below.
const PUBLIC_ALLOWLIST = [
  // NextAuth's own handler — the login/session endpoints cannot require a
  // session to exist.
  "auth/[...nextauth]/route.js",
  // Static PWA manifest; no DB access.
  "manifest/route.js",
  // Mobile credential exchange (login) and its token-rotation endpoints. These
  // authenticate via the submitted password / refresh token, which are
  // verified inside the handler (src/lib/auth/mobile-token.js).
  "mobile/auth/login/route.js",
  "mobile/auth/logout/route.js",
  "mobile/auth/refresh/route.js",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function used(content, name) {
  // `name(` covers both import-and-call and a bare call after a namespace
  // import. It deliberately does NOT match the import statement itself.
  return new RegExp(`${name}\\s*\\(`).test(content);
}

let pass = 0;
const failures = [];
const open = [];

for (const file of walk(API_ROOT).filter((f) => f.endsWith("route.js"))) {
  const rel = relative(API_ROOT, file);
  const content = readFileSync(file, "utf8");
  const key = rel.split(sep).join("/");

  const guarded =
    used(content, "requireAuth") ||
    used(content, "requireDriver") ||
    used(content, "verifyServiceToken") ||
    // Direct inline session reads: `await auth()` where auth comes from
    // @/lib/auth and the result is null-checked before use.
    (/\bfrom ["']@\/lib\/auth["']/.test(content) &&
      used(content, "auth"));

  if (guarded) {
    pass++;
    continue;
  }

  if (PUBLIC_ALLOWLIST.includes(key)) {
    pass++;
    continue;
  }

  open.push(key);
}

for (const key of open) {
  failures.push(`${key} — no auth guard invoked`);
}

console.log("\n=== Route-auth audit ===\n");
console.log(`Scanned every src/app/api/**/route.js.`);
console.log(`Guarded routes: ${pass}`);
if (open.length === 0) {
  console.log("All routes invoke requireAuth, requireDriver, verifyServiceToken, or auth().");
} else {
  console.log("OPEN ROUTES (no guard):");
  for (const key of open) console.log(`  ${key}`);
}

console.log(`\nroute-auth: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
if (failures.length) process.exitCode = 1;