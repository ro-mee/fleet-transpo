// Stage 1 verification — RBAC on the reservation lifecycle.
//
// Two layers, and the suite checks both plus their agreement:
//
//   1. Server boundary — requireAuth(req, [roles]) on the real route handlers.
//      This is the actual enforcement point: RLS is inert in this deployment
//      (see docs/rbac-model.md), so a 401/403 here is what stops a caller.
//   2. UI matrix — can(employee, "reservations", verb) in lib/auth/role-guard.js.
//      Advisory only; it hides buttons. A role denied by can() must also be
//      refused by the API, otherwise the button is merely hidden and the
//      endpoint is still open.
//
// Handlers are invoked in-process with auth() stubbed, so requireAuth, the role
// lists and the route bodies all run as shipped. No writes: every call asserted
// here is expected to be refused BEFORE it reaches any mutation, and the two
// positive-control calls use a non-existent request id so they 404 at lookup.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-rbac.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool } = await app("lib/db.js");
// The matrix lives in the pure module; role-guard.js is "use client" and pulls in
// JSX, so it cannot load here. Same data either way — role-guard re-exports it.
const { can, rolesFor } = await app("lib/auth/permissions.js");

let pass = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
}

// ---------------------------------------------------------------------------
// Routes under test, with the role list each one declares.
// ---------------------------------------------------------------------------
const ACTION_ROLES = rolesFor("reservations", "approve");
const READ_ROLES = rolesFor("reservations", "read");

const ROUTES = [
  // Kept in lockstep with what is actually on disk and with
  // src/services/transport.service.js: review/reject/approve were deleted
  // (0c0820c) — the lifecycle is now flags → recommendation → assign.
  { name: "flags",          mod: "app/api/integration/transport-requests/[id]/flags/route.js",         method: "PATCH", allow: rolesFor("reservations", "manage_flags"), kind: "action" },
  { name: "recommendation", mod: "app/api/integration/transport-requests/[id]/recommendation/route.js", method: "POST", allow: rolesFor("reservations", "recommend"), kind: "action" },
  { name: "assign",      mod: "app/api/integration/transport-requests/[id]/assign/route.js",      method: "PUT",  allow: ACTION_ROLES, kind: "action" },
  { name: "cancel",      mod: "app/api/integration/transport-requests/[id]/cancel/route.js",      method: "PUT",  allow: ACTION_ROLES, kind: "action" },
  { name: "reschedule",  mod: "app/api/integration/transport-requests/[id]/reschedule/route.js",  method: "PUT",  allow: ACTION_ROLES, kind: "action" },
  { name: "timeline",    mod: "app/api/integration/transport-requests/[id]/timeline/route.js",    method: "GET",  allow: READ_ROLES,   kind: "read" },
  { name: "dispatch",    mod: "app/api/dispatch/route.js",                                        method: "POST", allow: ACTION_ROLES, kind: "action" },
];

const ALL_ROLES = [
  "system_admin", "admin", "fleet_manager", "dispatcher",
  "driver", "management",
];

// A request id that cannot exist, so an authorized call stops at the 404 lookup
// instead of mutating anything.
const ABSENT_ID = "99999999";

const mods = {};
for (const r of ROUTES) mods[r.name] = await app(r.mod);

const makeRequest = (method) =>
  new Request(`http://localhost:3000/api/harness/${ABSENT_ID}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(method === "GET" ? {} : { body: JSON.stringify({}) }),
  });

// Every call here expects a refusal or a 404 on the absent id, and handleError
// logs each with a full stack trace. Silence it for the duration of the call so
// the assertion output stays legible; production logging is untouched.
async function callAs(route, role) {
  globalThis.__HARNESS_SESSION__ =
    role === null ? null : { user: { employeeId: 8, role, email: `${role}@harness` } };
  const handler = mods[route.name][route.method];
  const restore = console.error;
  console.error = () => {};
  try {
    const res = await handler(makeRequest(route.method), { params: Promise.resolve({ id: ABSENT_ID }) });
    return res.status;
  } finally {
    console.error = restore;
  }
}

console.log("\n=== RBAC: reservation lifecycle ===\n");

// ---------------------------------------------------------------------------
// 1. Unauthenticated callers are refused everywhere.
// ---------------------------------------------------------------------------
console.log("1. No session");
for (const route of ROUTES) {
  const status = await callAs(route, null);
  check(`${route.name}: 401 without a session`, status === 401, `got ${status}`);
}

// ---------------------------------------------------------------------------
// 2. Every role against every route.
//
//    Denied  → exactly 403.
//    Allowed → anything BUT 401/403. These reference a non-existent request, so
//              a 404/400/409 all prove the same thing: authorization passed and
//              the handler proceeded to its own logic.
// ---------------------------------------------------------------------------
console.log("2. Role matrix across the lifecycle routes");
for (const route of ROUTES) {
  for (const role of ALL_ROLES) {
    const status = await callAs(route, role);
    const allowed = route.allow.includes(role);
    if (allowed) {
      check(
        `${route.name}: ${role} is admitted`,
        status !== 401 && status !== 403,
        `got ${status}`
      );
    } else {
      check(`${route.name}: ${role} is refused 403`, status === 403, `got ${status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The plan's named cases, called out explicitly.
// ---------------------------------------------------------------------------
console.log("3. Plan cases: dispatcher acts, management reads only");
const dispatcherStatuses = {};
for (const route of ROUTES) dispatcherStatuses[route.name] = await callAs(route, "dispatcher");
check(
  "dispatcher is admitted to every lifecycle route it may act on",
  Object.entries(dispatcherStatuses).every(
    ([name, s]) => name === "flags" || (s !== 401 && s !== 403)
  ),
  JSON.stringify(dispatcherStatuses)
);
// flags is a fleet-role-only correction endpoint by design.
check("dispatcher is refused 403 on flags", dispatcherStatuses.flags === 403, `got ${dispatcherStatuses.flags}`);

// management is read-only by design — it observes without acting.
const managementStatuses = {};
for (const route of ROUTES) managementStatuses[route.name] = await callAs(route, "management");
check(
  "management gets 403 on every action route",
  ROUTES.filter((r) => r.kind === "action").every((r) => managementStatuses[r.name] === 403),
  JSON.stringify(managementStatuses)
);
check(
  "management can read the timeline",
  managementStatuses.timeline !== 401 && managementStatuses.timeline !== 403
);

// ---------------------------------------------------------------------------
// 4. The can() matrix — what the UI uses to show or hide the card actions.
// ---------------------------------------------------------------------------
console.log("4. can() matrix");
const employee = (role) => ({ roles: { role_name: role } });
const VERBS = ["approve", "assign", "dispatch", "cancel", "reschedule"];

for (const role of ["admin", "fleet_manager", "dispatcher"]) {
  check(
    `can(): ${role} holds all 5 lifecycle verbs`,
    VERBS.every((v) => can(employee(role), "reservations", v) === true)
  );
}
check(
  "can(): system_admin short-circuits to allowed",
  VERBS.every((v) => can(employee("system_admin"), "reservations", v) === true)
);
for (const role of ["management"]) {
  check(
    `can(): ${role} holds none of the 5 verbs`,
    VERBS.every((v) => can(employee(role), "reservations", v) === false)
  );
}
check("can(): management may read", can(employee("management"), "reservations", "read") === true);
check("can(): driver has no reservation read", can(employee("driver"), "reservations", "read") === false);
check("can(): null employee is denied", can(null, "reservations", "approve") === false);
check("can(): unknown role is denied", can(employee("intern"), "reservations", "approve") === false);
check("can(): unknown verb is denied", can(employee("dispatcher"), "reservations", "delete_everything") === false);

// ---------------------------------------------------------------------------
// 5. The two layers agree.
//
//    The failure this guards against: a verb hidden in the UI but still live on
//    the API. For every role, can()==false on the lifecycle verbs must coincide
//    with a 403 from the action routes.
// ---------------------------------------------------------------------------
console.log("5. UI matrix and API boundary agree");
for (const role of ALL_ROLES) {
  const uiAllows = VERBS.some((v) => can(employee(role), "reservations", v));
  // assign stands in as the representative live action route (approve/review/
  // reject are gone; assigning a vehicle+driver IS the approval step now).
  const apiStatus = await callAs(ROUTES.find((r) => r.name === "assign"), role);
  const apiAllows = apiStatus !== 401 && apiStatus !== 403;
  check(
    `${role}: can()=${uiAllows} matches API=${apiAllows}`,
    uiAllows === apiAllows,
    `assign returned ${apiStatus}`
  );
}

// ---------------------------------------------------------------------------
// 6. A refused call must not have written anything.
// ---------------------------------------------------------------------------
console.log("6. Refusals are side-effect free");
const { query } = await app("lib/db.js");
const { rows: before } = await query(
  `SELECT (SELECT COUNT(*)::int FROM reservation_events) AS events,
          (SELECT COUNT(*)::int FROM integration_log) AS logs,
          (SELECT COUNT(*)::int FROM dispatchschedules) AS dispatches`
);
for (const role of ["management", "driver"]) {
  for (const route of ROUTES.filter((r) => r.kind === "action")) await callAs(route, role);
}
const { rows: after } = await query(
  `SELECT (SELECT COUNT(*)::int FROM reservation_events) AS events,
          (SELECT COUNT(*)::int FROM integration_log) AS logs,
          (SELECT COUNT(*)::int FROM dispatchschedules) AS dispatches`
);
check("no timeline rows written by refused calls", before[0].events === after[0].events, `${before[0].events} → ${after[0].events}`);
check("no integration_log rows written", before[0].logs === after[0].logs, `${before[0].logs} → ${after[0].logs}`);
check("no dispatch rows written", before[0].dispatches === after[0].dispatches, `${before[0].dispatches} → ${after[0].dispatches}`);

console.log(`\nrbac: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await getPool().end();
if (failures.length) process.exitCode = 1;
