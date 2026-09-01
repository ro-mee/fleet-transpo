// Stage 1 verification — route-auth audit (Roadmap Phase 5, item 18).
//
// Route Handlers expose authorization per exported HTTP method. This audit
// parses each route file so a guarded sibling cannot hide an open method.
//
// Guard families recognized:
//   1. requireAuth / requirePermission / requireDriver — user-session auth
//   2. verifyServiceToken — machine-to-machine auth
//
// Run: node scripts/verify-route-auth.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parse } from "espree";

const API_ROOT = join(process.cwd(), "src", "app", "api");
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// Public routes authenticate through their own protocol or contain no data
// access. Keep this list keyed by method + path so adding a new sibling method
// still requires an intentional review.
const PUBLIC_METHOD_ALLOWLIST = new Set([
  "GET auth/[...nextauth]/route.js",
  "POST auth/[...nextauth]/route.js",
  "GET manifest/route.js",
  "POST mobile/auth/login/route.js",
  "POST mobile/auth/logout/route.js",
  "POST mobile/auth/refresh/route.js",
  "POST auth/forgot-password/route.js",
  "GET auth/login-status/route.js",
  // Next.js returns 405 for these unused method slots; they never read data.
  "GET dispatch/[id]/cancel/route.js",
  "GET trips/[id]/cancel/route.js",
]);

// These handlers delegate their guard to a service helper instead of calling a
// recognized guard in the exported function body. Keep the delegation visible.
const DELEGATED_GUARD_ALLOWLIST = new Set([
  "GET cron/sync/route.js",
  "POST cron/sync/route.js",
  "GET cron/reconcile/route.js",
  "POST cron/reconcile/route.js",
  "POST integration/transport-requests/route.js",
  "POST integration/transport-requests/[id]/recommendation/route.js",
  "POST integration/transport-requests/[id]/assign/route.js",
  "PUT integration/transport-requests/[id]/cancel/route.js",
  "PUT integration/transport-requests/[id]/reschedule/route.js",
  "PATCH integration/transport-requests/[id]/flags/route.js",
  "POST integration/inbound/route.js",
  "POST integration/outbound/route.js",
  "POST integration/pull/route.js",
  "POST status/sync/route.js",
]);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

function methodBody(node, content) {
  if (!node) return "";
  if (node.body?.type === "BlockStatement") return content.slice(node.body.start, node.body.end);
  return content.slice(node.start, node.end);
}

function exportedMethods(ast, content) {
  const methods = [];
  for (const statement of ast.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (declaration?.type === "FunctionDeclaration" && HTTP_METHODS.has(declaration.id?.name)) {
      methods.push({ method: declaration.id.name, body: methodBody(declaration, content) });
      continue;
    }
    if (declaration?.type === "VariableDeclaration") {
      for (const declarator of declaration.declarations) {
        if (HTTP_METHODS.has(declarator.id?.name)) {
          methods.push({ method: declarator.id.name, body: methodBody(declarator.init, content) });
        }
      }
    }
  }
  return methods;
}

function key(method, path) {
  return `${method} ${path}`;
}

function hasGuard(body) {
  return /\b(requireAuth|requirePermission|requireDriver|verifyServiceToken)\s*\(/.test(body);
}

let pass = 0;
const failures = [];
const methodsSeen = [];

for (const file of walk(API_ROOT).filter((f) => f.endsWith("route.js"))) {
  const rel = relative(API_ROOT, file);
  const content = readFileSync(file, "utf8");
  const path = rel.split(sep).join("/");
  let ast;
  try {
    ast = parse(content, { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } });
  } catch (error) {
    failures.push(`${path} — parser error: ${error.message}`);
    continue;
  }

  for (const { method, body } of exportedMethods(ast, content)) {
    const routeKey = key(method, path);
    methodsSeen.push(routeKey);
    const mutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
    const bareRequireAuth = /\brequireAuth\s*\(\s*(?:req|request)\s*\)/.test(body);

    if (PUBLIC_METHOD_ALLOWLIST.has(routeKey) || DELEGATED_GUARD_ALLOWLIST.has(routeKey)) {
      pass++;
      continue;
    }
    if (!hasGuard(body)) {
      failures.push(`${routeKey} — no auth guard invoked`);
      continue;
    }
    if (mutation && bareRequireAuth) {
      failures.push(`${routeKey} — mutating handler uses bare requireAuth(req)`);
      continue;
    }
    pass++;
  }
}

console.log("\n=== Route-auth audit ===\n");
console.log(`Scanned ${methodsSeen.length} exported HTTP methods in src/app/api/**/route.js.`);
console.log(`Guarded methods: ${pass}`);
if (failures.length === 0) {
  console.log("Every exported method has an explicit guard or a reviewed protocol exception.");
} else {
  console.log("AUTHORIZATION FAILURES:");
  for (const failure of failures) console.log(`  ${failure}`);
}

console.log(`\nroute-auth: ${pass} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
