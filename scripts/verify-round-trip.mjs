// Stage 1 verification — round trip from ingest to completion.
//
// Drives one transportation request through the whole 9-status lifecycle by
// invoking the REAL API route handlers in-process:
//
//   ingest   POST /api/integration/transport-requests        → Pending
//   review   PUT  /api/integration/transport-requests/:id/review   → Under Review
//   approve  PUT  /api/integration/transport-requests/:id/approve  → Approved
//   dispatch POST /api/dispatch (vehicle + driver)           → Scheduled → Assigned
//   start    PUT  /api/trips/:id/start                       → In Progress
//   complete PUT  /api/trips/:id/complete                    → Completed
//
// The route handlers return plain `Response` objects and never import
// next/server, so they run under plain Node. The ONLY thing swapped out is
// auth() (see scripts/stub-auth.mjs) — requireAuth, the RBAC role lists, the
// state machine, conflict detection, the timeline writer and the outbound
// gateway all execute as shipped, against the live database.
//
// Asserts: each hop lands, the timeline records a contiguous walk with distinct
// timestamps, and Booking is notified once per advanceReservation() call.
//
// WRITES to the live database: one transportation_requests row plus its
// dispatchschedules / trips / reservation_events / integration_log children, and
// the vehicle+driver status churn the routes trigger. The gateway defaults to
// "mock", so no external service is contacted.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-round-trip.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

// Refuse to run against a real Booking endpoint: this script writes, and an
// http gateway would deliver those writes outward.
const gatewayMode = (process.env.BOOKING_GATEWAY || "mock").toLowerCase();
if (gatewayMode !== "mock") {
  console.error(`\nBOOKING_GATEWAY is "${gatewayMode}" — refusing to run.`);
  console.error("The round trip emits status events; only the mock gateway is safe here.\n");
  process.exit(1);
}

// Import app modules by absolute file URL. The "@/..." alias would work too, but
// the trip routes live under a literal "[id]" directory and pathToFileURL
// escapes those brackets correctly.
const appModule = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);

const { query } = await appModule("lib/db.js");
const { RESERVATION_LIFECYCLE: L } = await appModule("lib/constants.js");
const ingestRoute = await appModule("app/api/integration/transport-requests/route.js");
const reviewRoute = await appModule("app/api/integration/transport-requests/[id]/review/route.js");
const approveRoute = await appModule("app/api/integration/transport-requests/[id]/approve/route.js");
const dispatchRoute = await appModule("app/api/dispatch/route.js");
const startRoute = await appModule("app/api/trips/[id]/start/route.js");
const completeRoute = await appModule("app/api/trips/[id]/complete/route.js");

let pass = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label}\n      ${detail}` : label);
  console.log(`  ${condition ? "✓" : "✗"} ${label}`);
}

/** Build a Request the route handlers can consume. */
function makeRequest(url, { method = "GET", body = null } = {}) {
  return new Request(`http://localhost:3000${url}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body != null ? { body: JSON.stringify(body) } : {}),
  });
}

/** Next 16 passes params as a promise; mirror that shape. */
const ctx = (params) => ({ params: Promise.resolve(params) });

/** Invoke a handler and unwrap its JSON Response. */
async function callRoute(handler, request, params) {
  const res = await handler(request, params ? ctx(params) : undefined);
  let data;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

// Act as a dispatcher: the role that owns this workflow day to day, and the
// tightest role permitted to run every step (see the requireAuth lists).
globalThis.__HARNESS_SESSION__ = {
  user: { employeeId: null, role: "dispatcher", email: "harness@local" },
};

// Actor id must reference a real employee — reviewed_by/approved_by are FKs.
const { rows: dispatchers } = await query(
  `SELECT e.employee_id, e.first_name, e.last_name
     FROM employees e
     LEFT JOIN roles r ON r.role_id = e.role_id
    WHERE e.deleted_at IS NULL AND r.role_name IN ('dispatcher','fleet_manager','admin','system_admin')
    ORDER BY CASE r.role_name WHEN 'dispatcher' THEN 1 ELSE 2 END
    LIMIT 1`
);
if (dispatchers[0]) {
  globalThis.__HARNESS_SESSION__.user.employeeId = dispatchers[0].employee_id;
}

console.log("\n=== Round trip: ingest → Completed ===\n");
console.log(
  `actor: employee ${globalThis.__HARNESS_SESSION__.user.employeeId ?? "(none)"} as dispatcher`
);
console.log(`gateway: ${gatewayMode}\n`);

// Track state so each phase can assert deltas rather than absolutes — the table
// already holds rows from earlier runs.
let requestId = null;
let dispatchId = null;
let tripId = null;

/** Timeline + outbound-log counts for this request. */
async function counts() {
  if (!requestId) return { events: 0, outbound: 0 };
  const { rows } = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM reservation_events WHERE request_id = $1) AS events,
       (SELECT COUNT(*)::int FROM integration_log
          WHERE direction = 'outbound'
            AND reference_type = 'transportation_request'
            AND reference_id = $1) AS outbound`,
    [requestId]
  );
  return rows[0];
}

async function statusOf() {
  const { rows } = await query(
    `SELECT fleet_status, vehicle_id, driver_id, reservation_number FROM transportation_requests WHERE request_id = $1`,
    [requestId]
  );
  return rows[0] || {};
}

// ---------------------------------------------------------------------------
// 1. Ingest — a request arrives from Booking and lands Pending.
// ---------------------------------------------------------------------------
console.log("1. Ingest (POST /api/integration/transport-requests)");
const externalId = `HARNESS-${Date.now()}`;
// Far enough out that it cannot overlap an existing active dispatch — the
// double-booking gate is exercised deliberately in verify-conflicts.mjs, not
// tripped by accident here.
const pickupAt = new Date(Date.now() + 36e5 * 24 * 180).toISOString();

const ingest = await callRoute(
  ingestRoute.POST,
  makeRequest("/api/integration/transport-requests", {
    method: "POST",
    body: {
      external_booking_id: externalId,
      source_system: "PMS",
      booking_reference: `HARNESS-REF-${Date.now()}`,
      guest_name: "Round Trip Harness",
      pickup_location: "Hotel Lobby",
      dropoff_location: "NAIA Terminal 3 - Arrivals (Bay 9)",
      pickup_datetime: pickupAt,
      passenger_count: 2,
      priority: "Normal", // Booking's vocabulary; must normalize to Medium
      booking_status: "Pending",
    },
  })
);

check("ingest returns 201", ingest.status === 201, `got ${ingest.status}: ${JSON.stringify(ingest.data)}`);
requestId = ingest.data?.request_id ?? null;
check("request row created", Number.isInteger(requestId), `request_id=${requestId}`);
if (!requestId) {
  console.error("\nIngest failed — cannot continue.\n");
  process.exit(1);
}
check("lands on Pending", ingest.data?.fleet_status === L.PENDING, `got ${ingest.data?.fleet_status}`);
check(
  "reservation_number issued in RSV-YYYYMMDD-#### form",
  /^RSV-\d{8}-\d{4}$/.test(ingest.data?.reservation_number || ""),
  `got ${ingest.data?.reservation_number}`
);
check(
  "Booking's 'Normal' normalized to 'Medium'",
  ingest.data?.priority === "Medium",
  `got ${ingest.data?.priority}`
);
check("travel estimate cached on ingest", ingest.data?.estimated_distance != null);

const afterIngest = await counts();
check("timeline opens with the created event", afterIngest.events === 1, `got ${afterIngest.events}`);
check("nothing emitted to Booking yet", afterIngest.outbound === 0, `got ${afterIngest.outbound}`);

// Idempotency: replaying the same external id must not duplicate the request.
const replay = await callRoute(
  ingestRoute.POST,
  makeRequest("/api/integration/transport-requests", {
    method: "POST",
    body: {
      external_booking_id: externalId,
      source_system: "PMS",
      pickup_location: "Hotel Lobby",
      pickup_datetime: pickupAt,
    },
  })
);
check("replay is idempotent (200)", replay.status === 200, `got ${replay.status}`);
check("replay returns the same row", replay.data?.request_id === requestId);
check("replay flagged idempotent", replay.data?.idempotent === true);

// ---------------------------------------------------------------------------
// 2. Review — Pending → Under Review.
// ---------------------------------------------------------------------------
console.log("\n2. Start review (PUT .../review)");
const review = await callRoute(
  reviewRoute.PUT,
  makeRequest(`/api/integration/transport-requests/${requestId}/review`, { method: "PUT" }),
  { id: String(requestId) }
);
check("review returns 200", review.status === 200, `got ${review.status}: ${JSON.stringify(review.data)}`);
check("status is Under Review", review.data?.fleet_status === L.UNDER_REVIEW, `got ${review.data?.fleet_status}`);
check("reviewed_by stamped", review.data?.reviewed_by != null);

const afterReview = await counts();
check("one timeline event added", afterReview.events === afterIngest.events + 1, `got ${afterReview.events}`);
check("one outbound emit", afterReview.outbound === afterIngest.outbound + 1, `got ${afterReview.outbound}`);

// ---------------------------------------------------------------------------
// 3. Approve — Under Review → Approved.
// ---------------------------------------------------------------------------
console.log("\n3. Approve (PUT .../approve)");
const approve = await callRoute(
  approveRoute.PUT,
  makeRequest(`/api/integration/transport-requests/${requestId}/approve`, { method: "PUT" }),
  { id: String(requestId) }
);
check("approve returns 200", approve.status === 200, `got ${approve.status}: ${JSON.stringify(approve.data)}`);
check("status is Approved", approve.data?.fleet_status === L.APPROVED, `got ${approve.data?.fleet_status}`);
check("approved_by stamped", approve.data?.approved_by != null);
check("approved_at stamped", approve.data?.approved_at != null);

const afterApprove = await counts();
check("one timeline event added", afterApprove.events === afterReview.events + 1, `got ${afterApprove.events}`);
check("one outbound emit", afterApprove.outbound === afterReview.outbound + 1, `got ${afterApprove.outbound}`);

// ---------------------------------------------------------------------------
// 4. Dispatch with vehicle + driver — Approved → Scheduled → Assigned.
//    Two hops in one call: the walk the plan calls out explicitly.
// ---------------------------------------------------------------------------
console.log("\n4. Dispatch with vehicle + driver (POST /api/dispatch)");
// Match the gate the dispatch route actually applies (route.js): it blocks only
// Under Maintenance / Decommissioned / Registration Expired. 'Reserved' and
// 'In Use' are ordinary working states — a vehicle held by an unrelated dispatch
// is still dispatchable in a non-overlapping window, and findDispatchConflicts
// is what enforces the window.
const { rows: vehicles } = await query(
  `SELECT vehicle_id, plate_number, seating_capacity, vehicle_status
     FROM vehicles
    WHERE deleted_at IS NULL
      AND vehicle_status NOT IN ('Under Maintenance', 'Decommissioned', 'Registration Expired')
      AND (registration_expiry IS NULL OR registration_expiry >= CURRENT_DATE)
      AND COALESCE(seating_capacity, 0) >= 2
    ORDER BY CASE vehicle_status WHEN 'Available' THEN 0 ELSE 1 END, vehicle_id
    LIMIT 1`
);
const { rows: drivers } = await query(
  `SELECT d.driver_id, d.driver_status, e.first_name
     FROM drivers d
     LEFT JOIN employees e ON e.employee_id = d.employee_id
    WHERE d.deleted_at IS NULL
      AND d.driver_status NOT IN ('Suspended', 'On Leave')
      AND (d.license_expiry IS NULL OR d.license_expiry >= CURRENT_DATE)
    ORDER BY CASE d.driver_status WHEN 'Available' THEN 0 ELSE 1 END, d.driver_id
    LIMIT 1`
);

if (!vehicles[0] || !drivers[0]) {
  console.error(
    `\nNeed one dispatchable vehicle (>=2 seats, valid registration) and one driver ` +
      `with a valid license. Found vehicle=${vehicles[0]?.vehicle_id ?? "none"}, driver=${drivers[0]?.driver_id ?? "none"}.\n`
  );
  process.exit(1);
}
const vehicleId = vehicles[0].vehicle_id;
const driverId = drivers[0].driver_id;
// Resource status is shared mutable state — syncVehicleStatus/syncDriverStatus
// move these as the trip progresses. Record the entry values so the run can
// report what it changed.
const vehicleStatusBefore = vehicles[0].vehicle_status;
const driverStatusBefore = drivers[0].driver_status;
console.log(
  `  using vehicle ${vehicles[0].plate_number} (#${vehicleId}, ${vehicleStatusBefore}), ` +
    `driver #${driverId} (${driverStatusBefore})`
);

const dispatchNumber = `DSP-HARNESS-${Date.now()}`;
const dispatch = await callRoute(
  dispatchRoute.POST,
  makeRequest("/api/dispatch", {
    method: "POST",
    body: {
      request_id: requestId,
      vehicle_id: vehicleId,
      driver_id: driverId,
      dispatch_number: dispatchNumber,
      scheduled_departure: pickupAt,
      status: "Scheduled",
    },
  })
);
check("dispatch returns 201", dispatch.status === 201, `got ${dispatch.status}: ${JSON.stringify(dispatch.data)}`);
dispatchId = dispatch.data?.dispatch_id ?? null;
check("dispatch row created", Number.isInteger(dispatchId), `dispatch_id=${dispatchId}`);
check("dispatch carries request_id", dispatch.data?.request_id === requestId);

const assigned = await statusOf();
check("request walked to Assigned", assigned.fleet_status === L.ASSIGNED, `got ${assigned.fleet_status}`);
check("vehicle_id persisted on the request", assigned.vehicle_id === vehicleId);
check("driver_id persisted on the request", assigned.driver_id === driverId);

const afterDispatch = await counts();
check(
  "two timeline events added (Scheduled, Assigned)",
  afterDispatch.events === afterApprove.events + 2,
  `got ${afterDispatch.events} (expected ${afterApprove.events + 2})`
);
// advanceReservation notifies Booking once per call, with the final state only.
check(
  "one outbound emit for the two-hop walk",
  afterDispatch.outbound === afterApprove.outbound + 1,
  `got ${afterDispatch.outbound}`
);

// ---------------------------------------------------------------------------
// 5. Trip start — Assigned → In Progress.
//    ensureTripForDispatch() created the trip when the dispatch landed.
// ---------------------------------------------------------------------------
console.log("\n5. Start the trip (PUT /api/trips/:id/start)");
const { rows: trips } = await query(
  `SELECT trip_id, trip_status FROM trips WHERE dispatch_id = $1 AND deleted_at IS NULL ORDER BY trip_id DESC LIMIT 1`,
  [dispatchId]
);
check("dispatch auto-created a trip", trips.length === 1, `found ${trips.length}`);
tripId = trips[0]?.trip_id ?? null;

const start = await callRoute(
  startRoute.PUT,
  makeRequest(`/api/trips/${tripId}/start`, { method: "PUT", body: { odometer: 10000 } }),
  { id: String(tripId) }
);
check("start returns 200", start.status === 200, `got ${start.status}: ${JSON.stringify(start.data)}`);
check("trip is Trip Started", start.data?.trip_status === "Trip Started", `got ${start.data?.trip_status}`);

const inProgress = await statusOf();
check("request is In Progress", inProgress.fleet_status === L.IN_PROGRESS, `got ${inProgress.fleet_status}`);

const afterStart = await counts();
check("one timeline event added", afterStart.events === afterDispatch.events + 1, `got ${afterStart.events}`);
check("one outbound emit", afterStart.outbound === afterDispatch.outbound + 1, `got ${afterStart.outbound}`);

// ---------------------------------------------------------------------------
// 6. Trip complete — In Progress → Completed.
// ---------------------------------------------------------------------------
console.log("\n6. Complete the trip (PUT /api/trips/:id/complete)");
const complete = await callRoute(
  completeRoute.PUT,
  makeRequest(`/api/trips/${tripId}/complete`, {
    method: "PUT",
    body: { start_odometer: 10000, end_odometer: 10042 },
  }),
  { id: String(tripId) }
);
check("complete returns 200", complete.status === 200, `got ${complete.status}: ${JSON.stringify(complete.data)}`);
check("trip is Completed", complete.data?.trip_status === "Completed", `got ${complete.data?.trip_status}`);
check("distance recorded", Number(complete.data?.distance) === 42, `got ${complete.data?.distance}`);

const completed = await statusOf();
check("request is Completed", completed.fleet_status === L.COMPLETED, `got ${completed.fleet_status}`);

const afterComplete = await counts();
check("one timeline event added", afterComplete.events === afterStart.events + 1, `got ${afterComplete.events}`);
check("one outbound emit", afterComplete.outbound === afterStart.outbound + 1, `got ${afterComplete.outbound}`);

// ---------------------------------------------------------------------------
// 7. The timeline reads as a contiguous, timestamped walk.
// ---------------------------------------------------------------------------
console.log("\n7. Timeline integrity");
const { rows: timeline } = await query(
  `SELECT event_id, event_type, from_status, to_status, actor_id, actor_role, occurred_at
     FROM reservation_events WHERE request_id = $1
    ORDER BY event_id ASC`,
  [requestId]
);
check("seven events recorded", timeline.length === 7, `got ${timeline.length}`);

const walk = timeline.filter((e) => e.from_status && e.to_status);
const contiguous = walk.every((e, i) => i === 0 || walk[i - 1].to_status === e.from_status);
check("each hop starts where the previous ended", contiguous);
check(
  "the walk covers Pending → Completed",
  walk[0]?.from_status === L.PENDING && walk[walk.length - 1]?.to_status === L.COMPLETED,
  `${walk[0]?.from_status} → ${walk[walk.length - 1]?.to_status}`
);
const statuses = [L.UNDER_REVIEW, L.APPROVED, L.SCHEDULED, L.ASSIGNED, L.IN_PROGRESS, L.COMPLETED];
check(
  "every lifecycle status appears in order",
  JSON.stringify(walk.map((e) => e.to_status)) === JSON.stringify(statuses),
  walk.map((e) => e.to_status).join(" → ")
);

// Distinct timestamps are what make the timeline legible as a history: if two
// hops of one walk shared an instant, the UI could not order them.
const times = timeline.map((e) => new Date(e.occurred_at).getTime());
check("timestamps are distinct", new Set(times).size === times.length, `${new Set(times).size} distinct of ${times.length}`);
check("timestamps increase monotonically", times.every((t, i) => i === 0 || t >= times[i - 1]));
check(
  "the dispatcher is recorded as actor on operator actions",
  timeline.some((e) => e.actor_role === "dispatcher")
);

// ---------------------------------------------------------------------------
// 8. Booking was notified — one outbound row per advanceReservation() call.
// ---------------------------------------------------------------------------
console.log("\n8. Outbound delivery to Booking");
const { rows: logs } = await query(
  `SELECT log_id, event_type, status, external_booking_id, payload
     FROM integration_log
    WHERE direction = 'outbound' AND reference_type = 'transportation_request' AND reference_id = $1
    ORDER BY log_id ASC`,
  [requestId]
);
check("five outbound events (one per transition call)", logs.length === 5, `got ${logs.length}`);
check("all delivered to the mock gateway", logs.every((r) => r.status === "processed"), logs.map((r) => r.status).join(", "));
check("every row correlates to the external booking", logs.every((r) => r.external_booking_id === externalId));
check(
  "external vocabulary used on the wire (not Fleet's)",
  logs.every((r) => {
    const s = (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload)?.status;
    return s && !Object.values(L).includes(s);
  }),
  logs.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload)?.status).join(", ")
);

const { rows: inbound } = await query(
  `SELECT COUNT(*)::int AS n FROM integration_log
    WHERE direction = 'inbound' AND reference_type = 'transportation_request' AND reference_id = $1`,
  [requestId]
);
check("the arrival was logged inbound", inbound[0].n === 1, `got ${inbound[0].n}`);

// ---------------------------------------------------------------------------
console.log(`\nround trip: ${pass} passed, ${failures.length} failed`);
console.log(`\nrequest #${requestId} (${completed.reservation_number}) — dispatch #${dispatchId}, trip #${tripId}`);
console.log("\ntimeline:");
for (const e of timeline) {
  const at = new Date(e.occurred_at).toISOString().slice(11, 23);
  const hop = e.from_status ? `${e.from_status} → ${e.to_status}` : `→ ${e.to_status}`;
  console.log(`  ${at}  ${String(e.event_type).padEnd(16)} ${hop}`);
}
console.log("\noutbound:");
for (const r of logs) {
  const payload = typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload;
  console.log(`  ${String(r.event_type).padEnd(24)} status=${payload?.status} (${r.status})`);
}

// Vehicle and driver rows are shared state, not owned by this request. Report
// where the lifecycle left them so the change is visible rather than implied.
const { rows: after } = await query(
  `SELECT (SELECT vehicle_status FROM vehicles WHERE vehicle_id = $1) AS vehicle_status,
          (SELECT driver_status  FROM drivers  WHERE driver_id  = $2) AS driver_status`,
  [vehicleId, driverId]
);
console.log("\nresource status (shared rows this run moved):");
console.log(`  vehicle #${vehicleId}: ${vehicleStatusBefore} → ${after[0].vehicle_status}`);
console.log(`  driver  #${driverId}: ${driverStatusBefore} → ${after[0].driver_status}`);

if (failures.length > 0) {
  console.error("\nFAILURES:");
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("\n✓ round trip verified end to end");
}

// Leave the row in place: it is a legitimate completed request, and the plan's
// conflict/RBAC steps can reuse the vehicle and driver it exercised.
await (await appModule("lib/db.js")).getPool().end();
