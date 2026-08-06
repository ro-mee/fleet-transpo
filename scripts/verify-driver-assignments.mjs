// Does the custodial driver↔vehicle pairing (migration 017) actually hold?
//
// Four questions, in order of how much they'd cost to get wrong:
//
//   1. Is the 1:1 active pairing enforced by POSTGRES, or only by app code?
//      This is the whole reason the partial unique indexes exist. Every other
//      conflict rule in this codebase is app-layer check-then-insert with an
//      acknowledged TOCTOU race; if uq_dva_active_* ever lost its WHERE clause
//      or got dropped, the app checks would still pass and nothing would fail
//      loudly. So these assertions insert straight over the top of the API and
//      demand a 23505 from the database itself.
//
//   2. Does the API behave the way assigned-vehicle-card.jsx assumes? The card
//      branches on 409 + requires_force to show "reassign anyway?", and on
//      unchanged:true to stay quiet. Those are contract, not decoration.
//
//   3. Do the single-request and batch conflict paths agree? They share the pure
//      evaluator but fetch rows separately, so only a test can catch one of them
//      forgetting to pass `assignments`.
//
//   4. Is the new finding really non-blocking? A warning that silently became a
//      gate would refuse dispatches whenever a driver's paired car is in
//      maintenance — the exact case the warning exists to permit.
//
// Runs the REAL handlers in-process against the live DB. Refuses to run if the
// chosen drivers/vehicles already have pairing rows, because cleanup here is a
// hard DELETE and must never eat somebody's real custody record. Audit rows are
// left behind on purpose — they're an append-only log.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-driver-assignments.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const appModule = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);

const { query } = await appModule("lib/db.js");
// The pure matrix module, not role-guard.js — that one is "use client" and pulls
// in JSX, so it cannot load here. Same data; role-guard re-exports it.
const { can } = await appModule("lib/auth/permissions.js");
const { CONFLICT_TYPE, CONFLICT_SEVERITY } = await appModule("lib/scheduling/conflict-types.js");
const {
  evaluateRequestConflicts,
  detectRequestConflicts,
  detectConflictsForRequests,
} = await appModule("lib/scheduling/conflicts.js");
const { syncVehicleStatus, syncDriverStatus } = await appModule("services/status.service.js");
const assignRoute = await appModule("app/api/driver-assignments/route.js");
const assignIdRoute = await appModule("app/api/driver-assignments/[id]/route.js");
const dispatchRoute = await appModule("app/api/dispatch/route.js");

const PAIR = CONFLICT_TYPE.VEHICLE_NOT_ASSIGNED_TO_DRIVER;

let pass = 0;
const failures = [];
function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label} — ${detail}` : label);
  console.log(`  ${condition ? "✓" : "✗"} ${label}${condition ? "" : detail ? ` — ${detail}` : ""}`);
}

// ── request plumbing ────────────────────────────────────────────────────────
const jsonReq = (url, method, body) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const readRes = async (res) => {
  let data;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
};

const postAssign = (body) =>
  assignRoute.POST(jsonReq("http://localhost:3000/api/driver-assignments", "POST", body)).then(readRes);

const getAssign = (qs = "") =>
  assignRoute.GET(jsonReq(`http://localhost:3000/api/driver-assignments${qs}`, "GET")).then(readRes);

const deleteAssign = (id, body) =>
  assignIdRoute
    .DELETE(jsonReq(`http://localhost:3000/api/driver-assignments/${id}`, "DELETE", body), {
      params: Promise.resolve({ id: String(id) }),
    })
    .then(readRes);

const postDispatch = (body) =>
  dispatchRoute.POST(jsonReq("http://localhost:3000/api/dispatch", "POST", body)).then(readRes);

const asRole = (employeeId, role) => {
  globalThis.__HARNESS_SESSION__ = { user: { employeeId, role, email: `harness-${role}@local` } };
};

const HARNESS_TAG = "harness-017-probe";

// Raw insert that deliberately bypasses the API, so a rejection can only have
// come from the database.
const rawInsert = async (driverId, vehicleId, { from = null, until = null } = {}) => {
  try {
    const { rows } = await query(
      `INSERT INTO driver_vehicle_assignments (driver_id, vehicle_id, assigned_from, assigned_until, notes)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4::date, $5)
       RETURNING assignment_id`,
      [driverId, vehicleId, from, until, HARNESS_TAG]
    );
    return { ok: true, id: rows[0].assignment_id };
  } catch (e) {
    return { ok: false, code: e?.code, constraint: e?.constraint, message: e?.message };
  }
};

// ── fixtures ────────────────────────────────────────────────────────────────
async function pickFixtures() {
  // Prefer dispatchable rows so section 4 can actually reach the conflict gate
  // rather than tripping an earlier 400 on licence/registration/status.
  const { rows: drivers } = await query(
    `SELECT d.driver_id, e.first_name, e.last_name,
            (d.driver_status NOT IN ('Suspended','On Leave')
             AND (d.license_expiry IS NULL OR d.license_expiry >= CURRENT_DATE)) AS dispatchable
       FROM drivers d
       LEFT JOIN employees e ON e.employee_id = d.employee_id
      WHERE d.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM driver_vehicle_assignments a WHERE a.driver_id = d.driver_id
        )
      ORDER BY dispatchable DESC, d.driver_id
      LIMIT 2`
  );
  const { rows: admin } = await query(
    `SELECT e.employee_id FROM employees e
       LEFT JOIN roles r ON r.role_id = e.role_id
      WHERE e.deleted_at IS NULL AND r.role_name IN ('system_admin','admin')
      LIMIT 1`
  );
  return { drivers, adminId: admin[0]?.employee_id ?? null };
}

// Vehicles the harness OWNS, rather than borrowing two real ones.
//
// Borrowing was the original approach and it deadlocked: this deployment has
// only two vehicles, and they are also the ones staff pair drivers to in the UI.
// The moment a genuine custodial row existed on either, the safety guard below
// (correctly) refused to run, and there was no third vehicle to fall back to.
// Owning the fixtures removes the collision permanently — cleanup can hard-delete
// them without ever going near fleet data, and both are Available with a distant
// registration_expiry so section 4 reliably clears the pre-conflict dispatch
// gates instead of skipping.
const HARNESS_PLATES = ["HARNESS-017-A", "HARNESS-017-B"];

// A previous crashed run may have left these behind. They are unambiguously ours
// (nobody types that plate), so reaping them is safe — but anything referencing
// them has to go first or the DELETE trips a foreign key.
async function reapHarnessVehicles() {
  const { rows } = await query(`SELECT vehicle_id FROM vehicles WHERE plate_number = ANY($1)`, [
    HARNESS_PLATES,
  ]);
  const ids = rows.map((r) => r.vehicle_id);
  if (!ids.length) return 0;

  const { rows: ds } = await query(
    `SELECT dispatch_id FROM dispatchschedules WHERE vehicle_id = ANY($1)`,
    [ids]
  );
  const dispatchIds = ds.map((r) => r.dispatch_id);
  if (dispatchIds.length) {
    await query(`DELETE FROM trips WHERE dispatch_id = ANY($1)`, [dispatchIds]);
    await query(`DELETE FROM dispatchschedules WHERE dispatch_id = ANY($1)`, [dispatchIds]);
  }
  await query(`DELETE FROM driver_vehicle_assignments WHERE vehicle_id = ANY($1)`, [ids]);
  await query(`DELETE FROM vehicles WHERE vehicle_id = ANY($1)`, [ids]);
  return ids.length;
}

async function provisionVehicles() {
  const reaped = await reapHarnessVehicles();
  if (reaped) console.log(`  (reaped ${reaped} leftover harness vehicle(s) from an earlier run)`);

  const made = [];
  for (const plate of HARNESS_PLATES) {
    const { rows } = await query(
      `INSERT INTO vehicles (plate_number, vehicle_name, seating_capacity, vehicle_status,
                             registration_expiry, fuel_type)
       VALUES ($1, $2, 8, 'Available', DATE '2035-12-31', 'Gasoline')
       RETURNING vehicle_id, plate_number, seating_capacity, true AS dispatchable`,
      [plate, `Harness Probe ${plate.slice(-1)}`]
    );
    made.push(rows[0]);
  }
  return made;
}

const { drivers, adminId } = await pickFixtures();

if (drivers.length < 2) {
  console.log(
    `\nNeed 2 live drivers with no existing custodial pairing; found ${drivers.length}. ` +
      `Release a pairing or seed another driver, then re-run.`
  );
  process.exit(1);
}

const vehicles = await provisionVehicles();

const [D1, D2] = drivers;
const [V1, V2] = vehicles;
const DRIVER_IDS = [D1.driver_id, D2.driver_id];
const VEHICLE_IDS = [V1.vehicle_id, V2.vehicle_id];
const nameOf = (d) => `${d.first_name || ""} ${d.last_name || ""}`.trim() || `#${d.driver_id}`;

// Hard delete, but only ever for the four ids under test — and only after the
// pre-check below proved they had no rows to begin with.
const cleanupAssignments = () =>
  query(
    `DELETE FROM driver_vehicle_assignments
      WHERE driver_id = ANY($1) OR vehicle_id = ANY($2)`,
    [DRIVER_IDS, VEHICLE_IDS]
  );

const createdDispatchIds = [];
// Matched on the tag as well as the collected ids: if a POST inserted but its
// response body wasn't shaped as expected, the id would be missing here and the
// row would survive. The tag is written to notes on every dispatch this harness
// creates, so it catches those too.
async function cleanupDispatches() {
  const { rows: tagged } = await query(
    `SELECT dispatch_id FROM dispatchschedules WHERE notes = $1`, [HARNESS_TAG]
  );
  const ids = [...new Set([...createdDispatchIds, ...tagged.map((r) => r.dispatch_id)])];
  if (!ids.length) return;

  // trips.dispatch_id references dispatchschedules, so trips go first.
  await query(`DELETE FROM trips WHERE dispatch_id = ANY($1)`, [ids]);
  await query(`DELETE FROM dispatchschedules WHERE dispatch_id = ANY($1)`, [ids]);
  // Vehicle/driver status is fully derived from dispatch+trip rows, so
  // re-deriving after the delete recomputes exactly what was there before.
  for (const id of VEHICLE_IDS) await syncVehicleStatus(id).catch(() => {});
  for (const id of DRIVER_IDS) await syncDriverStatus(id).catch(() => {});
  createdDispatchIds.length = 0;
}

// ── guard: never trample real custody data ──────────────────────────────────
const { rows: preexisting } = await query(
  `SELECT assignment_id, driver_id, vehicle_id FROM driver_vehicle_assignments
    WHERE driver_id = ANY($1) OR vehicle_id = ANY($2)`,
  [DRIVER_IDS, VEHICLE_IDS]
);
if (preexisting.length) {
  console.log(
    `\nRefusing to run: drivers ${DRIVER_IDS.join(",")} / vehicles ${VEHICLE_IDS.join(",")} already have ` +
      `${preexisting.length} pairing row(s). Cleanup here is a hard DELETE and would destroy real data. ` +
      `Release and remove those rows manually, or point this harness at different ids.`
  );
  process.exit(1);
}

const sortFindings = (f) =>
  [...f].sort((a, b) => `${a.type}|${a.message}`.localeCompare(`${b.type}|${b.message}`));
const pairFindings = (f) => f.filter((c) => c.type === PAIR);

console.log(`\nFixtures: drivers ${DRIVER_IDS.join(", ")} · vehicles ${VEHICLE_IDS.join(", ")} · admin ${adminId ?? "(none)"}`);
console.log(`  D1=${nameOf(D1)} D2=${nameOf(D2)} V1=${V1.plate_number} V2=${V2.plate_number}\n`);

try {
  // ══ 1. Postgres, not app code, enforces one active pairing per side ════════
  console.log("1. The partial unique indexes do the enforcing");

  const first = await rawInsert(D1.driver_id, V1.vehicle_id);
  check("baseline pairing inserts", first.ok, first.message);

  const sameVehicle = await rawInsert(D2.driver_id, V1.vehicle_id);
  check("second active pairing for the SAME VEHICLE is rejected", sameVehicle.ok === false,
    sameVehicle.ok ? "the insert succeeded — one car now has two custodians" : "");
  check("...rejected by a unique violation (23505), not app logic",
    sameVehicle.code === "23505", `code was ${sameVehicle.code}`);
  check("...by uq_dva_active_vehicle specifically",
    sameVehicle.constraint === "uq_dva_active_vehicle", `constraint was ${sameVehicle.constraint}`);

  const sameDriver = await rawInsert(D1.driver_id, V2.vehicle_id);
  check("second active pairing for the SAME DRIVER is rejected", sameDriver.ok === false,
    sameDriver.ok ? "the insert succeeded — one driver now holds two cars" : "");
  check("...by uq_dva_active_driver specifically",
    sameDriver.code === "23505" && sameDriver.constraint === "uq_dva_active_driver",
    `code ${sameDriver.code}, constraint ${sameDriver.constraint}`);

  // The predicate is the whole design: history rows must NOT be constrained.
  const closedPair = await rawInsert(D2.driver_id, V2.vehicle_id, {
    from: "2020-01-01", until: "2020-06-01",
  });
  check("a CLOSED pairing is exempt from the unique indexes", closedPair.ok, closedPair.message);
  const secondClosed = await rawInsert(D2.driver_id, V2.vehicle_id, {
    from: "2020-07-01", until: "2020-12-01",
  });
  check("...and many closed pairings may stack up (history accumulates)",
    secondClosed.ok, secondClosed.message);

  const badInterval = await rawInsert(D2.driver_id, V2.vehicle_id, {
    from: "2020-01-01", until: "2019-12-31",
  });
  check("assigned_until before assigned_from is refused by chk_dva_interval",
    badInterval.code === "23514" && badInterval.constraint === "chk_dva_interval",
    `code ${badInterval.code}, constraint ${badInterval.constraint}`);

  // ── close-then-repair ──
  await query(
    `UPDATE driver_vehicle_assignments SET assigned_until = CURRENT_DATE WHERE assignment_id = $1`,
    [first.id]
  );
  const afterRelease = await rawInsert(D2.driver_id, V1.vehicle_id);
  check("once released, the vehicle can be re-paired to another driver",
    afterRelease.ok, afterRelease.message);

  const { rows: hist } = await query(
    `SELECT assignment_id, assigned_until FROM driver_vehicle_assignments
      WHERE vehicle_id = $1 ORDER BY assignment_id`,
    [V1.vehicle_id]
  );
  check("both the closed and the current pairing remain queryable", hist.length === 2,
    `found ${hist.length} row(s) for ${V1.plate_number}`);
  check("exactly one of them is active",
    hist.filter((r) => r.assigned_until == null).length === 1,
    `${hist.filter((r) => r.assigned_until == null).length} active`);

  await cleanupAssignments();

  // ══ 2. API contract the card depends on ═══════════════════════════════════
  console.log("\n2. /api/driver-assignments behaves as the UI assumes");

  globalThis.__HARNESS_SESSION__ = null;
  const anon = await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id });
  check("unauthenticated POST is refused", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

  asRole(adminId, "dispatcher");
  const dispatcherWrite = await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id });
  check("dispatcher POST is refused with 403 (read-only in the matrix)",
    dispatcherWrite.status === 403, `got ${dispatcherWrite.status}`);
  const dispatcherRead = await getAssign("");
  check("dispatcher GET is allowed — they must SEE the pairing to read the chip",
    dispatcherRead.status === 200, `got ${dispatcherRead.status}`);

  const { rows: leaked } = await query(
    `SELECT assignment_id FROM driver_vehicle_assignments WHERE driver_id = ANY($1)`, [DRIVER_IDS]
  );
  check("no pairing was written by the refused calls", leaked.length === 0, `found ${leaked.length}`);

  asRole(adminId, "system_admin");
  const badDriver = await postAssign({ driver_id: 0, vehicle_id: V1.vehicle_id });
  check("missing/invalid driver_id is a 400", badDriver.status === 400, `got ${badDriver.status}`);
  const ghostDriver = await postAssign({ driver_id: 999999, vehicle_id: V1.vehicle_id });
  check("nonexistent driver is a 404, not an FK 500", ghostDriver.status === 404, `got ${ghostDriver.status}`);
  const ghostVehicle = await postAssign({ driver_id: D1.driver_id, vehicle_id: 999999 });
  check("nonexistent vehicle is a 404", ghostVehicle.status === 404, `got ${ghostVehicle.status}`);

  const created = await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id, notes: HARNESS_TAG });
  check("valid pairing returns 201", created.status === 201, `got ${created.status} ${JSON.stringify(created.data)}`);
  const assignmentId = created.data?.assignment?.assignment_id;
  check("response carries the joined row the card renders",
    Number.isInteger(assignmentId) && created.data?.assignment?.plate_number === V1.plate_number,
    JSON.stringify(created.data?.assignment));

  const repeat = await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id });
  check("re-posting the identical pairing is idempotent (unchanged:true, not a 500)",
    repeat.status === 200 && repeat.data?.unchanged === true,
    `got ${repeat.status} ${JSON.stringify(repeat.data)}`);

  // The path the card's second ConfirmDialog exists for.
  const contested = await postAssign({ driver_id: D2.driver_id, vehicle_id: V1.vehicle_id });
  check("taking a car held by ANOTHER driver answers 409", contested.status === 409, `got ${contested.status}`);
  check("...with requires_force so the card can prompt", contested.data?.requires_force === true,
    JSON.stringify(contested.data));
  check("...and names who would be displaced",
    contested.data?.current_assignment?.driver_id === D1.driver_id,
    JSON.stringify(contested.data?.current_assignment));

  const { rows: unchangedRow } = await query(
    `SELECT driver_id FROM driver_vehicle_assignments
      WHERE vehicle_id = $1 AND assigned_until IS NULL`, [V1.vehicle_id]
  );
  check("the refused 409 changed nothing", unchangedRow.length === 1 && unchangedRow[0].driver_id === D1.driver_id,
    JSON.stringify(unchangedRow));

  const forced = await postAssign({ driver_id: D2.driver_id, vehicle_id: V1.vehicle_id, force: true });
  check("force:true completes the reassignment (201)", forced.status === 201,
    `got ${forced.status} ${JSON.stringify(forced.data)}`);
  const { rows: afterForce } = await query(
    `SELECT driver_id, assigned_until, release_reason FROM driver_vehicle_assignments
      WHERE vehicle_id = $1 ORDER BY assignment_id`, [V1.vehicle_id]
  );
  check("the displaced pairing was CLOSED, not deleted",
    afterForce.length === 2 &&
      afterForce.filter((r) => r.assigned_until != null).length === 1 &&
      afterForce.filter((r) => r.assigned_until == null).length === 1,
    JSON.stringify(afterForce));
  check("...and still exactly one active row survives the transaction",
    afterForce.filter((r) => r.assigned_until == null)[0]?.driver_id === D2.driver_id,
    JSON.stringify(afterForce));

  const forcedId = forced.data?.assignment?.assignment_id;
  const history = await getAssign(`?vehicle_id=${V1.vehicle_id}&history=1`);
  check("history=1 returns the closed interval too",
    history.status === 200 && (history.data?.assignments?.length ?? 0) === 2,
    `got ${history.data?.assignments?.length} row(s)`);
  const activeOnly = await getAssign(`?vehicle_id=${V1.vehicle_id}`);
  check("without history=1 only the active pairing comes back",
    (activeOnly.data?.assignments?.length ?? 0) === 1,
    `got ${activeOnly.data?.assignments?.length} row(s)`);

  asRole(adminId, "dispatcher");
  const dispatcherRelease = await deleteAssign(forcedId, { release_reason: "harness" });
  check("dispatcher DELETE is refused with 403", dispatcherRelease.status === 403,
    `got ${dispatcherRelease.status}`);

  asRole(adminId, "system_admin");
  const released = await deleteAssign(forcedId, { release_reason: "harness release" });
  check("DELETE releases the pairing (200)", released.status === 200, `got ${released.status}`);
  const { rows: relRow } = await query(
    `SELECT assigned_until, release_reason FROM driver_vehicle_assignments WHERE assignment_id = $1`,
    [forcedId]
  );
  check("the row still EXISTS — release closes, never deletes", relRow.length === 1, `found ${relRow.length}`);
  check("assigned_until was set", relRow[0]?.assigned_until != null, JSON.stringify(relRow[0]));
  check("release_reason was recorded", relRow[0]?.release_reason === "harness release", relRow[0]?.release_reason);

  const doubleRelease = await deleteAssign(forcedId);
  check("releasing an already-released pairing is a 409", doubleRelease.status === 409,
    `got ${doubleRelease.status}`);
  const ghostRelease = await deleteAssign(999999);
  check("releasing a nonexistent pairing is a 404", ghostRelease.status === 404,
    `got ${ghostRelease.status}`);

  await cleanupAssignments();

  // ══ 2b. can() and the API guards agree for the new resource ═══════════════
  //
  // verify-rbac.mjs asserts this property for the reservation lifecycle, but its
  // ROUTES table is built around [id] lifecycle verbs and a blanket "dispatcher
  // is admitted everywhere" assertion that a write-restricted resource would
  // break. So driver_assignments proves it here instead. The failure being
  // guarded against is the same one: a control merely HIDDEN in the UI while its
  // endpoint stays open.
  console.log("\n2b. The can() matrix and the route guards say the same thing");

  const employee = (role) => ({ roles: { role_name: role } });
  const ALL_ROLES = [
    "system_admin", "admin", "fleet_manager", "dispatcher",
    "driver", "reception_staff", "restaurant_staff", "concierge", "management",
  ];

  for (const role of ALL_ROLES) {
    asRole(adminId, role);

    const uiWrite = can(employee(role), "driver_assignments", "create");
    // A valid payload: the point is where it stops, not whether it succeeds.
    const apiWrite = await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id });
    const apiAllowsWrite = apiWrite.status !== 401 && apiWrite.status !== 403;
    check(`${role}: can(create)=${uiWrite} matches API=${apiAllowsWrite}`,
      uiWrite === apiAllowsWrite, `POST returned ${apiWrite.status}`);
    // Undo anything an authorized role just created so the next role starts clean.
    if (apiAllowsWrite) await cleanupAssignments();

    const uiRead = can(employee(role), "driver_assignments", "read");
    const apiRead = await getAssign("");
    const apiAllowsRead = apiRead.status !== 401 && apiRead.status !== 403;
    check(`${role}: can(read)=${uiRead} matches API=${apiAllowsRead}`,
      uiRead === apiAllowsRead, `GET returned ${apiRead.status}`);
  }

  asRole(adminId, "system_admin");
  await cleanupAssignments();

  // ══ 3. The conflict rule, and single/batch parity ══════════════════════════
  console.log("\n3. The pairing raises a WARNING, and both fetch paths agree");

  await postAssign({ driver_id: D1.driver_id, vehicle_id: V1.vehicle_id, notes: HARNESS_TAG });

  // Far-future window so no real dispatch or maintenance row can overlap and
  // add findings that would muddy the counts below.
  const mkRequest = (vehicleId, driverId) => ({
    request_id: 990017,
    vehicle_id: vehicleId,
    driver_id: driverId,
    pickup_datetime: "2031-03-04T09:00:00.000Z",
    scheduled_arrival: "2031-03-04T12:00:00.000Z",
    passenger_count: 1,
  });

  const matched = await detectRequestConflicts(mkRequest(V1.vehicle_id, D1.driver_id));
  check("driver in their OWN car raises no pairing finding", pairFindings(matched).length === 0,
    JSON.stringify(pairFindings(matched)));

  const mismatched = await detectRequestConflicts(mkRequest(V2.vehicle_id, D1.driver_id));
  const mm = pairFindings(mismatched);
  check("driver in a DIFFERENT car raises exactly one pairing finding", mm.length === 1,
    `got ${mm.length}: ${JSON.stringify(mm)}`);
  check("...at warning severity, never blocking",
    mm[0]?.severity === CONFLICT_SEVERITY.WARNING, `severity was ${mm[0]?.severity}`);
  check("...naming the car they're normally responsible for",
    typeof mm[0]?.message === "string" && mm[0].message.includes(V1.plate_number),
    mm[0]?.message);
  check("...with the paired vehicle id in detail, for the UI to link",
    mm[0]?.detail?.assigned_vehicle_id === V1.vehicle_id, JSON.stringify(mm[0]?.detail));

  const takenByOther = await detectRequestConflicts(mkRequest(V1.vehicle_id, D2.driver_id));
  const tb = pairFindings(takenByOther);
  check("another driver taking V1 is flagged from the VEHICLE side", tb.length === 1,
    `got ${tb.length}: ${JSON.stringify(tb)}`);
  check("...identifying the car's usual driver",
    tb[0]?.detail?.assigned_driver_id === D1.driver_id, JSON.stringify(tb[0]?.detail));

  // Both sides at once: D2 holds V2, D1 holds V1 — send D2 out in V1 and the
  // dispatcher should learn both that D2 left their own car and that V1's
  // custodian changed.
  await postAssign({ driver_id: D2.driver_id, vehicle_id: V2.vehicle_id, notes: HARNESS_TAG });
  const swap = await detectRequestConflicts(mkRequest(V1.vehicle_id, D2.driver_id));
  const sw = pairFindings(swap);
  check("a swap between two paired drivers reports BOTH sides", sw.length === 2,
    `got ${sw.length}: ${JSON.stringify(sw.map((c) => c.message))}`);
  check("...both still only warnings",
    sw.every((c) => c.severity === CONFLICT_SEVERITY.WARNING),
    JSON.stringify(sw.map((c) => c.severity)));

  // The drift guard: the queue batches, the assign endpoint doesn't. If either
  // forgot to load `assignments`, the same input would yield different answers.
  const req = mkRequest(V1.vehicle_id, D2.driver_id);
  const batch = await detectConflictsForRequests([req]);
  const batchFindings = batch.get(req.request_id) ?? [];
  check("batch path returns the same finding count as the single path",
    batchFindings.length === swap.length,
    `single ${swap.length}, batch ${batchFindings.length}`);
  check("batch and single findings are byte-identical",
    JSON.stringify(sortFindings(batchFindings)) === JSON.stringify(sortFindings(swap)),
    `single ${JSON.stringify(sortFindings(swap))} vs batch ${JSON.stringify(sortFindings(batchFindings))}`);

  // The pure evaluator with no assignments must stay silent — proves the finding
  // is driven by the fetched rows and not synthesised from the request alone.
  const noAssignments = evaluateRequestConflicts(req, {
    vehicle: { vehicle_id: V1.vehicle_id, plate_number: V1.plate_number, seating_capacity: 8 },
    driver: { driver_id: D2.driver_id, first_name: D2.first_name, last_name: D2.last_name },
    assignments: [],
  });
  check("with no pairings loaded the rule emits nothing", pairFindings(noAssignments).length === 0,
    JSON.stringify(pairFindings(noAssignments)));

  // ══ 4. A warning must never become a gate ═════════════════════════════════
  console.log("\n4. /api/dispatch still allows a mismatched pair, still blocks a double-booking");

  // The dispatched pair must clear the licence/registration/status gates that run
  // BEFORE the conflict check, or a refusal here would prove nothing about the
  // pairing. Both harness vehicles are provisioned Available with a 2035
  // registration precisely so those gates cannot be what stops us — the only
  // thing left that could refuse this dispatch is the conflict layer, which is
  // what we are actually measuring. The driver is paired to one car and sent out
  // in the other: the everyday case this warning exists to permit.
  const goDriver = [D1, D2].find((d) => d.dispatchable);
  const goVehicle = [V1, V2].find((v) => v.dispatchable);
  const pairedElsewhere = [V1, V2].find((v) => v.vehicle_id !== goVehicle?.vehicle_id);

  if (!goDriver || !goVehicle || !pairedElsewhere) {
    console.log(
      `  ⚠ skipped — need one dispatchable driver and one dispatchable vehicle plus a second vehicle to pair ` +
        `against; got driver:${!!goDriver} vehicle:${!!goVehicle} other:${!!pairedElsewhere}.`
    );
  } else {
    await cleanupAssignments();
    await postAssign({ driver_id: goDriver.driver_id, vehicle_id: pairedElsewhere.vehicle_id, notes: HARNESS_TAG });
    console.log(
      `  (${nameOf(goDriver)} is paired to ${pairedElsewhere.plate_number}, dispatched in ${goVehicle.plate_number})`
    );

    const departure = "2031-03-04T09:00:00.000Z";
    const arrival = "2031-03-04T12:00:00.000Z";
    // dispatch_number is UNIQUE NOT NULL with no default, so it must be supplied
    // — and must DIFFER between the two posts below, or the second would fail on
    // the unique constraint and its 409 would prove nothing about double-booking.
    const dispatchNo = (n) => `HARNESS-017-${n}`;

    // Guard against a vacuous pass: confirm there IS a warning for this pair
    // before asserting that dispatch went ahead in spite of it.
    const wouldWarn = pairFindings(
      await detectRequestConflicts({
        request_id: 990018,
        vehicle_id: goVehicle.vehicle_id,
        driver_id: goDriver.driver_id,
        pickup_datetime: departure,
        scheduled_arrival: arrival,
        passenger_count: 1,
      })
    );
    check("this exact pair does raise a pairing warning", wouldWarn.length >= 1,
      "no warning to ignore, so the 201 below would prove nothing");
    check("...and nothing about it is blocking",
      wouldWarn.every((c) => c.severity === CONFLICT_SEVERITY.WARNING),
      JSON.stringify(wouldWarn.map((c) => c.severity)));

    const mismatchDispatch = await postDispatch({
      vehicle_id: goVehicle.vehicle_id,
      driver_id: goDriver.driver_id,
      scheduled_departure: departure,
      scheduled_arrival: arrival,
      status: "Scheduled",
      dispatch_number: dispatchNo("A"),
      notes: HARNESS_TAG,
    });
    if (mismatchDispatch.data?.dispatch_id) createdDispatchIds.push(mismatchDispatch.data.dispatch_id);
    check("dispatching a driver in a car that is not theirs returns 201",
      mismatchDispatch.status === 201,
      `got ${mismatchDispatch.status} ${JSON.stringify(mismatchDispatch.data)} — the warning became a gate`);

    // Same resources, same window: this one SHOULD be refused, which also proves
    // the gate is still wired at all and the 201 above wasn't a dead check.
    const doubleBooked = await postDispatch({
      vehicle_id: goVehicle.vehicle_id,
      driver_id: goDriver.driver_id,
      scheduled_departure: departure,
      scheduled_arrival: arrival,
      status: "Scheduled",
      dispatch_number: dispatchNo("B"),
      notes: HARNESS_TAG,
    });
    if (doubleBooked.data?.dispatch_id) createdDispatchIds.push(doubleBooked.data.dispatch_id);
    check("a genuine overlapping double-booking is still refused with 409",
      doubleBooked.status === 409, `got ${doubleBooked.status} ${JSON.stringify(doubleBooked.data)}`);
    check("...and the 409 is about being already dispatched, not about the pairing",
      typeof doubleBooked.data?.error === "string" &&
        doubleBooked.data.error.toLowerCase().includes("already dispatched"),
      doubleBooked.data?.error);
  }
} finally {
  await cleanupDispatches().catch((e) => console.log(`  cleanup(dispatch) failed: ${e.message}`));
  await cleanupAssignments().catch((e) => console.log(`  cleanup(assignments) failed: ${e.message}`));
  // Drops the two provisioned vehicles and anything still pointing at them. Runs
  // last because the two cleanups above are scoped by vehicle_id and would find
  // nothing once the vehicles are gone.
  await reapHarnessVehicles().catch((e) => console.log(`  cleanup(vehicles) failed: ${e.message}`));

  const { rows: leftoverA } = await query(
    `SELECT assignment_id FROM driver_vehicle_assignments
      WHERE driver_id = ANY($1) OR vehicle_id = ANY($2)`,
    [DRIVER_IDS, VEHICLE_IDS]
  );
  const { rows: leftoverD } = await query(
    `SELECT dispatch_id FROM dispatchschedules WHERE notes = $1`, [HARNESS_TAG]
  );
  const { rows: leftoverV } = await query(
    `SELECT vehicle_id FROM vehicles WHERE plate_number = ANY($1)`, [HARNESS_PLATES]
  );
  console.log(
    `\nCleanup: ${leftoverA.length === 0 ? "no pairing rows left" : `WARNING ${leftoverA.length} pairing row(s) left!`}` +
      ` · ${leftoverD.length === 0 ? "no dispatch rows left" : `WARNING ${leftoverD.length} dispatch row(s) left!`}` +
      ` · ${leftoverV.length === 0 ? "no harness vehicles left" : `WARNING ${leftoverV.length} harness vehicle(s) left!`}`
  );
}

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failures.length ? 1 : 0);
