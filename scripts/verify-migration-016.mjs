// Stage 1 verification — migration 016 landed correctly.
//
// Read-only probe (SELECT only, no writes). Confirms against the live database:
//   1. chk_transport_fleet_status holds exactly the 9 spec statuses
//   2. no row survives with a retired 015 status
//   3. reservation_number is unique and fully back-filled
//   4. reservation_events exists with its timeline index
//   5. chk_transport_priority holds the 4 values, no 'Normal' rows remain
//   6. every new column from 016 is present with the right type
//   7. fleet_status DEFAULT is 'Pending'
//
// Credentials are never hardcoded — DATABASE_URL is read from .env.local at
// runtime, the same variable src/lib/db.js uses.
//
// Run: node scripts/verify-migration-016.mjs
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";

// Minimal .env.local reader. Next.js loads this file automatically; a plain
// `node` run does not, and the repo has no dotenv dependency.
function loadEnvLocal() {
  let raw;
  try {
    raw = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  } catch {
    throw new Error(".env.local not found — run this from the repo root.");
  }
  for (const line of raw.split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key]) continue;
    // Strip surrounding quotes and any trailing CR from CRLF line endings.
    process.env[key] = value.trim().replace(/\r$/, "").replace(/^["'](.*)["']$/, "$1");
  }
}

let pass = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) pass++;
  else failures.push(detail ? `${label}\n      ${detail}` : label);
}

const EXPECTED_STATUSES = [
  "Pending", "Under Review", "Approved", "Rejected",
  "Scheduled", "Assigned", "In Progress", "Completed", "Cancelled",
];
const RETIRED_STATUSES = ["Waiting for Fleet Review", "Driver Assigned", "Vehicle Assigned"];
const EXPECTED_PRIORITIES = ["Urgent", "High", "Medium", "Low"];

// Columns 016 adds to transportation_requests, with the udt_name pg reports.
const NEW_COLUMNS = {
  reservation_number: "varchar",
  requested_vehicle_type: "varchar",
  requested_category_id: "int4",
  estimated_distance: "numeric",
  estimated_duration: "int4",
  vehicle_id: "int4",
  driver_id: "int4",
  ai_vehicle_recommendation: "jsonb",
  ai_driver_recommendation: "jsonb",
  reviewed_by: "int4",
  reviewed_at: "timestamptz",
  approved_by: "int4",
  approved_at: "timestamptz",
};

const EVENT_COLUMNS = [
  "event_id", "request_id", "event_type", "from_status", "to_status",
  "actor_id", "actor_role", "description", "metadata", "occurred_at",
];

// Pull the literal values out of a CHECK clause: ANY (ARRAY['A'::text, 'B'::text]).
function parseCheckValues(clause) {
  return [...(clause || "").matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

loadEnvLocal();
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set in .env.local");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  // Supabase terminates TLS with a cert this client won't have in its trust
  // store; the app's pool relies on the sslmode in the URL for the same reason.
  ssl: { rejectUnauthorized: false },
});

await client.connect();

try {
  // --- 1. fleet_status CHECK holds exactly the 9 spec statuses ---------------
  const { rows: statusCheck } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'chk_transport_fleet_status'
        AND conrelid = 'transportation_requests'::regclass`
  );
  check("chk_transport_fleet_status exists", statusCheck.length === 1);

  const statusValues = parseCheckValues(statusCheck[0]?.def).sort();
  check(
    "chk_transport_fleet_status holds exactly the 9 spec statuses",
    statusValues.length === 9 &&
      EXPECTED_STATUSES.every((s) => statusValues.includes(s)),
    `got ${statusValues.length}: ${statusValues.join(", ")}`
  );
  for (const retired of RETIRED_STATUSES) {
    check(`CHECK no longer allows '${retired}'`, !statusValues.includes(retired));
  }

  // --- 2. No row survives with a retired status -----------------------------
  const { rows: staleRows } = await client.query(
    `SELECT fleet_status, COUNT(*)::int AS n
       FROM transportation_requests
      WHERE fleet_status <> ALL($1::text[])
      GROUP BY fleet_status`,
    [EXPECTED_STATUSES]
  );
  check(
    "no row carries a status outside the 9",
    staleRows.length === 0,
    staleRows.map((r) => `${r.fleet_status} × ${r.n}`).join(", ")
  );

  // --- 3. reservation_number unique and fully back-filled --------------------
  const { rows: numbering } = await client.query(
    `SELECT COUNT(*)::int                                    AS total,
            COUNT(*) FILTER (WHERE reservation_number IS NULL)::int AS missing,
            COUNT(DISTINCT reservation_number)::int          AS distinct_numbers
       FROM transportation_requests`
  );
  const { total, missing, distinct_numbers } = numbering[0];
  check("every request has a reservation_number", missing === 0, `${missing} of ${total} null`);
  check(
    "reservation_numbers are distinct",
    distinct_numbers === total - missing,
    `${distinct_numbers} distinct across ${total - missing} populated rows`
  );

  const { rows: malformed } = await client.query(
    `SELECT reservation_number
       FROM transportation_requests
      WHERE reservation_number IS NOT NULL
        AND reservation_number !~ '^RSV-[0-9]{8}-[0-9]{4}$'
      LIMIT 5`
  );
  check(
    "reservation_numbers match RSV-YYYYMMDD-####",
    malformed.length === 0,
    malformed.map((r) => r.reservation_number).join(", ")
  );

  const { rows: uniqIdx } = await client.query(
    `SELECT COUNT(*)::int AS n
       FROM pg_constraint
      WHERE conrelid = 'transportation_requests'::regclass
        AND contype = 'u'
        AND pg_get_constraintdef(oid) ILIKE '%reservation_number%'`
  );
  check("reservation_number carries a UNIQUE constraint", uniqIdx[0].n >= 1);

  // --- 4. reservation_events exists with its index --------------------------
  const { rows: eventCols } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_name = 'reservation_events'`
  );
  const eventColNames = eventCols.map((c) => c.column_name);
  check("reservation_events table exists", eventColNames.length > 0);
  for (const col of EVENT_COLUMNS) {
    check(`reservation_events.${col} exists`, eventColNames.includes(col));
  }

  const { rows: eventIdx } = await client.query(
    `SELECT indexdef FROM pg_indexes
      WHERE tablename = 'reservation_events'
        AND indexname = 'idx_reservation_events_request_timeline'`
  );
  check(
    "reservation_events timeline index exists on (request_id, occurred_at DESC)",
    eventIdx.length === 1 &&
      /request_id/.test(eventIdx[0].indexdef) &&
      /occurred_at DESC/i.test(eventIdx[0].indexdef),
    eventIdx[0]?.indexdef
  );

  const { rows: fkCascade } = await client.query(
    `SELECT confdeltype FROM pg_constraint
      WHERE conrelid = 'reservation_events'::regclass
        AND contype = 'f'
        AND confrelid = 'transportation_requests'::regclass`
  );
  check(
    "reservation_events.request_id cascades on delete",
    fkCascade.length === 1 && fkCascade[0].confdeltype === "c"
  );

  // --- 5. Priority CHECK + back-fill ----------------------------------------
  const { rows: prioCheck } = await client.query(
    `SELECT pg_get_constraintdef(oid) AS def
       FROM pg_constraint
      WHERE conname = 'chk_transport_priority'
        AND conrelid = 'transportation_requests'::regclass`
  );
  check("chk_transport_priority exists", prioCheck.length === 1);

  const prioValues = parseCheckValues(prioCheck[0]?.def).sort();
  check(
    "chk_transport_priority holds exactly Urgent/High/Medium/Low",
    prioValues.length === 4 && EXPECTED_PRIORITIES.every((p) => prioValues.includes(p)),
    `got ${prioValues.length}: ${prioValues.join(", ")}`
  );

  const { rows: stalePrio } = await client.query(
    `SELECT priority, COUNT(*)::int AS n
       FROM transportation_requests
      WHERE priority IS NOT NULL AND priority <> ALL($1::text[])
      GROUP BY priority`,
    [EXPECTED_PRIORITIES]
  );
  check(
    "no row carries a priority outside the 4 (e.g. 'Normal')",
    stalePrio.length === 0,
    stalePrio.map((r) => `${r.priority} × ${r.n}`).join(", ")
  );

  // --- 6. New columns present with the right types --------------------------
  const { rows: reqCols } = await client.query(
    `SELECT column_name, udt_name, column_default
       FROM information_schema.columns
      WHERE table_name = 'transportation_requests'`
  );
  const byName = Object.fromEntries(reqCols.map((c) => [c.column_name, c]));
  for (const [col, udt] of Object.entries(NEW_COLUMNS)) {
    check(
      `transportation_requests.${col} is ${udt}`,
      byName[col]?.udt_name === udt,
      byName[col] ? `got ${byName[col].udt_name}` : "column missing"
    );
  }

  // --- 7. fleet_status defaults to 'Pending' --------------------------------
  check(
    "fleet_status DEFAULT is 'Pending'",
    /'Pending'/.test(byName.fleet_status?.column_default || ""),
    `got ${byName.fleet_status?.column_default ?? "no default"}`
  );

  // Context for the round-trip step that follows.
  const { rows: dist } = await client.query(
    `SELECT fleet_status, COUNT(*)::int AS n
       FROM transportation_requests
      GROUP BY fleet_status ORDER BY n DESC`
  );
  const { rows: evCount } = await client.query(
    `SELECT COUNT(*)::int AS n FROM reservation_events`
  );

  console.log(`\nmigration 016: ${pass} passed, ${failures.length} failed`);
  console.log(
    `\nrequests by status: ${dist.map((d) => `${d.fleet_status}=${d.n}`).join(", ") || "none"}`
  );
  console.log(`timeline events recorded: ${evCount[0].n}`);

  if (failures.length > 0) {
    console.error("\nFAILURES:");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exitCode = 1;
  } else {
    console.log("\n✓ migration 016 verified against the live schema");
  }
} finally {
  await client.end();
}
