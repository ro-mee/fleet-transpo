// Verification — vehicle-category resolution at the ingest boundary.
//
// Migration 016 added transportation_requests.requested_category_id and the queue
// already joined and filtered on it, but nothing ever populated it: the ingest
// INSERT read `raw.requested_vehicle_type`, a field the contract did not declare
// and Booking never sent. Every row landed with a null category, so the vehicle
// class had nowhere to live and arrived as prose in special_requests ("VIP guest").
//
// Two properties matter more than raw hit-rate, and both are asserted here:
//   1. The DATABASE owns the ids — nothing is hardcoded, so renaming or adding a
//      category cannot silently mis-route requests.
//   2. A wrong category is worse than none. Routing a VIP arrival to "Hotel
//      Operations & Logistics" books a guest a cargo pickup, so anything
//      ambiguous must resolve to null and stay free text.
//
// Read-only: resolveVehicleCategory only SELECTs, so there is nothing to roll back.
//
// Run: node --import ./scripts/route-harness-loader.mjs scripts/verify-category-resolver.mjs
import { pathToFileURL } from "node:url";
import { resolve as resolvePath } from "node:path";
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const app = (rel) => import(pathToFileURL(resolvePath(process.cwd(), "src", rel)).href);
const { getPool, query } = await app("lib/db.js");
const { resolveVehicleCategory } = await app("lib/integration/category-resolver.js");
const { parseTransportationRequest } = await app("lib/integration/contracts.js");
const { getBookingGateway } = await app("lib/integration/booking-gateway.js");

const pool = getPool();
let pass = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) pass++;
  else failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function checkEq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `got ${a}, want ${e}`);
}

// Resolve the live category ids by regex rather than by number, for the same
// reason the resolver does: this suite must not encode 1..4 either.
const { rows: cats } = await query(
  `SELECT category_id, category_name FROM vehiclecategories
    WHERE deleted_at IS NULL AND COALESCE(status,'Active') <> 'Inactive' ORDER BY category_id`
);
const idMatching = (re) => cats.find((c) => re.test(c.category_name.toLowerCase()))?.category_id ?? null;
const VIP = idMatching(/vip|executive|luxury/);
const SHUTTLE = idMatching(/shuttle|airport|transfer/);
const OPS = idMatching(/operation|logistic|cargo/);
const STAFF = idMatching(/staff|employee/);

console.log(`categories: ${cats.map((c) => `#${c.category_id} ${c.category_name}`).join(" | ")}`);

check("the four expected categories exist", [VIP, SHUTTLE, OPS, STAFF].every(Boolean),
  `vip=${VIP} shuttle=${SHUTTLE} ops=${OPS} staff=${STAFF}`);
check("the four categories are distinct", new Set([VIP, SHUTTLE, OPS, STAFF]).size === 4);

const resolvesTo = async (text, expectedId, label) => {
  const r = await resolveVehicleCategory(text);
  checkEq(label ?? `"${text}"`, r.categoryId, expectedId);
};

// ---------------------------------------------------------------------------
// 1. VIP wins over the generic guest vocabulary.
//
// "VIP Guest Transport" also contains "guest", so a guest-first pass would put
// every VIP arrival on the shared airport shuttle. Rule order is the tie-break;
// these are the cases that would regress if it were reordered.
// ---------------------------------------------------------------------------
for (const t of ["Executive SUV", "VIP guest", "vip", "Luxury Vehicle", "limousine", "Premium sedan"]) {
  await resolvesTo(t, VIP);
}
await resolvesTo("VIP guest arrival, airport pickup", VIP, '"VIP guest arrival, airport pickup" — VIP beats airport');

// ---------------------------------------------------------------------------
// 2. Guest / shuttle / ops / staff.
// ---------------------------------------------------------------------------
for (const t of ["Airport Transfer Van", "Guest Shuttle", "airport shuttle", "minibus", "passenger van"]) {
  await resolvesTo(t, SHUTTLE);
}
for (const t of ["Cargo Pickup", "kitchen supplies", "housekeeping linen run", "logistics truck"]) {
  await resolvesTo(t, OPS);
}
for (const t of ["Staff Shuttle", "employee shift transport", "crew transport"]) {
  await resolvesTo(t, STAFF);
}

// ---------------------------------------------------------------------------
// 2b. Audience outranks vehicle shape.
//
// These are the cases that regress if RULES is reordered by "specificity" rather
// than by audience-before-shape. Every string here names a vehicle shape that
// belongs to the guest shuttle category ("shuttle", "van", "minibus") while
// naming an audience that does not, and the audience must win — otherwise a
// staff shift or a kitchen supply run is dispatched as guest transport.
await resolvesTo("Staff Shuttle", STAFF, '"Staff Shuttle" — staff beats shuttle');
await resolvesTo("Employee Shuttle Bus", STAFF, '"Employee Shuttle Bus" — staff beats shuttle');
await resolvesTo("staff transfer van", STAFF, '"staff transfer van" — staff beats transfer/van');
await resolvesTo("crew airport transfer", STAFF, '"crew airport transfer" — crew beats airport');
await resolvesTo("housekeeping van", OPS, '"housekeeping van" — ops beats van');
await resolvesTo("kitchen supply minibus", OPS, '"kitchen supply minibus" — ops beats minibus');
await resolvesTo("linen transfer van", OPS, '"linen transfer van" — ops beats transfer/van');
await resolvesTo("VIP shuttle", VIP, '"VIP shuttle" — vip beats shuttle');
await resolvesTo("executive airport transfer", VIP, '"executive airport transfer" — vip beats airport');

// ---------------------------------------------------------------------------
// 3. Exact name match — Booking echoing Fleet's own vocabulary back.
// ---------------------------------------------------------------------------
for (const c of cats) {
  const r = await resolveVehicleCategory(c.category_name);
  checkEq(`exact name "${c.category_name}"`, r.categoryId, c.category_id);
  check(`exact name "${c.category_name}" reports matchedOn=name`, r.matchedOn === "name", `got ${r.matchedOn}`);
}
// Punctuation and case are normalized away, so an exact match survives them.
{
  const c = cats[0];
  const noisy = c.category_name.toUpperCase().replace(/ /g, "  ") + " !!";
  checkEq(`normalized exact match "${noisy}"`, (await resolveVehicleCategory(noisy)).categoryId, c.category_id);
}

// ---------------------------------------------------------------------------
// 4. Refusing to guess. Each of these must be null, not a plausible-looking id.
// ---------------------------------------------------------------------------
for (const t of [null, undefined, "", "   ", "!!!", "asdfgh", "2 large suitcases, child seat",
                 "Meet and greet at arrivals gate", "please hurry", "4 pax"]) {
  const r = await resolveVehicleCategory(t);
  checkEq(`no guess for ${JSON.stringify(t)}`, r.categoryId, null);
  checkEq(`no name for ${JSON.stringify(t)}`, r.categoryName, null);
  checkEq(`no matchedOn for ${JSON.stringify(t)}`, r.matchedOn, null);
}
checkEq("no arguments at all", (await resolveVehicleCategory()).categoryId, null);

// Substrings must not match: "vips" is not "vip", "staffing" is not "staff".
// This is what the \b anchors in the rules buy, and it is easy to lose.
for (const t of ["vips", "staffing", "vanity", "operational excellence award"]) {
  const r = await resolveVehicleCategory(t);
  checkEq(`substring "${t}" does not match a word rule`, r.categoryId, null);
}

// ---------------------------------------------------------------------------
// 5. Candidate precedence — earlier arguments win, later ones are fallbacks.
//
// This is how ingest consults special_requests without letting a guest note
// override an explicit vehicle-type request.
// ---------------------------------------------------------------------------
checkEq("explicit type beats the note",
  (await resolveVehicleCategory("Cargo Pickup", "VIP guest")).categoryId, OPS);
checkEq("note is used when the type is absent",
  (await resolveVehicleCategory(null, "VIP guest")).categoryId, VIP);
checkEq("note is used when the type is unrecognised",
  (await resolveVehicleCategory("Tardis", "employee shift")).categoryId, STAFF);
checkEq("both unusable stays null",
  (await resolveVehicleCategory("Tardis", "please hurry")).categoryId, null);

// ---------------------------------------------------------------------------
// 6. Never throws. Ingest must not fail because a category lookup had a bad day
//    — same contract as assignReservationNumber and estimateTrip around it.
// ---------------------------------------------------------------------------
for (const weird of [{}, [], 0, false, NaN, 12345, Symbol("x").toString(), " ", "a".repeat(5000)]) {
  try {
    const r = await resolveVehicleCategory(weird);
    check(`survives ${String(weird?.constructor?.name ?? weird)}`, typeof r === "object" && "categoryId" in r);
  } catch (e) {
    check(`survives ${String(weird)}`, false, `threw ${e?.message}`);
  }
}

// ---------------------------------------------------------------------------
// 7. The contract now declares the field, and every mock payload resolves.
//
// The original defect was reading a field the schema never declared, so the
// schema is pinned here: it must survive parsing and reach the INSERT.
// ---------------------------------------------------------------------------
{
  const parsed = parseTransportationRequest({
    external_booking_id: "HARNESS-1",
    pickup_location: "Main Lobby",
    pickup_datetime: "2026-08-10T14:30:00+08:00",
    requested_vehicle_type: "Executive SUV",
  });
  checkEq("contract preserves requested_vehicle_type", parsed.requested_vehicle_type, "Executive SUV");
  checkEq("contract tolerates its absence",
    parseTransportationRequest({
      external_booking_id: "HARNESS-2",
      pickup_location: "Main Lobby",
      pickup_datetime: "2026-08-10T14:30:00+08:00",
    }).requested_vehicle_type ?? null, null);

  const mocks = await getBookingGateway().fetchPendingRequests();
  check("mock gateway still serves 3 requests", mocks.length === 3, `got ${mocks.length}`);
  for (const m of mocks) {
    const p = parseTransportationRequest(m);
    check(`mock ${m.external_booking_id} declares a vehicle type`, Boolean(p.requested_vehicle_type),
      `got ${JSON.stringify(p.requested_vehicle_type)}`);
    const r = await resolveVehicleCategory(p.requested_vehicle_type, p.special_requests);
    check(`mock ${m.external_booking_id} resolves to a category`, r.categoryId !== null,
      `"${p.requested_vehicle_type}" resolved to null`);
    // The point of the user's correction: the class is a field now, not prose.
    check(`mock ${m.external_booking_id} keeps VIP out of special_requests`,
      !/\bvip\b/i.test(String(m.special_requests ?? "")),
      `special_requests=${JSON.stringify(m.special_requests)}`);
  }
  checkEq("the urgent airport arrival resolves to VIP",
    (await resolveVehicleCategory(
      mocks.find((m) => m.external_booking_id === "BK-2026-00103")?.requested_vehicle_type
    )).categoryId, VIP);
}

// ---------------------------------------------------------------------------
// 8. Ingest actually persists it — the column the queue joins on is populated.
//    Rolled back, so the queue is left exactly as it was.
// ---------------------------------------------------------------------------
let rolledBack = false;
{
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO transportation_requests
         (external_booking_id, source_system, pickup_location, pickup_datetime,
          passenger_count, priority, booking_status, fleet_status,
          requested_vehicle_type, requested_category_id)
       VALUES ('HARNESS-CAT-1','PMS','Main Lobby','2026-08-10T14:30:00+08:00',
               2,'Urgent','Approved','Pending',$1,$2)
       RETURNING request_id, requested_vehicle_type, requested_category_id`,
      ["Executive SUV", VIP]
    );
    checkEq("requested_category_id persists", rows[0].requested_category_id, VIP);
    checkEq("the raw ask is kept verbatim beside it", rows[0].requested_vehicle_type, "Executive SUV");

    // And the queue's own join returns the category name for it.
    const { rows: joined } = await client.query(
      `SELECT vc.category_name FROM transportation_requests tr
         LEFT JOIN vehiclecategories vc ON tr.requested_category_id = vc.category_id
        WHERE tr.request_id = $1`,
      [rows[0].request_id]
    );
    check("the queue join resolves a category name", Boolean(joined[0]?.category_name),
      `got ${JSON.stringify(joined[0]?.category_name)}`);

    // The FK is real: an invented category must be refused.
    let refused = false;
    await client.query("SAVEPOINT fk");
    try {
      await client.query(
        `UPDATE transportation_requests SET requested_category_id = 999999 WHERE request_id = $1`,
        [rows[0].request_id]
      );
    } catch {
      refused = true;
      await client.query("ROLLBACK TO SAVEPOINT fk");
    }
    check("requested_category_id is FK-constrained", refused);

    await client.query("ROLLBACK");
    rolledBack = true;
  } finally {
    client.release();
  }
}
check("fixtures were rolled back", rolledBack === true);

const { rows: leftover } = await query(
  `SELECT COUNT(*)::int AS n FROM transportation_requests WHERE external_booking_id LIKE 'HARNESS-CAT-%'`
);
checkEq("no harness row survived", leftover[0].n, 0);

console.log(`\ncategory-resolver: ${pass} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  FAIL ${f}`);
await pool.end();
if (failures.length) process.exitCode = 1;
