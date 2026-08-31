import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();
const { query, getPool } = await import("../src/lib/db.js");
const { resolveRouteForRequest } = await import("../src/services/route-resolver.service.js");

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
}

const { rows: duplicateRows } = await query(
  `SELECT origin_location_id, destination_location_id, COUNT(*)::int AS count
     FROM routes
    WHERE status = 'Active' AND deleted_at IS NULL
      AND origin_location_id IS NOT NULL AND destination_location_id IS NOT NULL
    GROUP BY origin_location_id, destination_location_id
   HAVING COUNT(*) > 1`
);
check(duplicateRows.length === 0, "active routes have unique directional endpoint pairs");

const { rows: referencedRows } = await query(
  `SELECT d.route_id, r.origin_location_id, r.destination_location_id
     FROM dispatchschedules d
     JOIN routes r ON r.route_id = d.route_id
    WHERE d.route_id IS NOT NULL
      AND (r.origin_location_id IS NULL OR r.destination_location_id IS NULL)`
);
check(referencedRows.length === 0, "dispatch routes have both canonical endpoint IDs");

const { rows: tripReferencedRows } = await query(
  `SELECT t.trip_id, t.route_id, r.origin_location_id, r.destination_location_id
     FROM trips t
     JOIN routes r ON r.route_id = t.route_id
    WHERE t.route_id IS NOT NULL
      AND (r.origin_location_id IS NULL OR r.destination_location_id IS NULL)`
);
check(tripReferencedRows.length === 0, "trip routes have both canonical endpoint IDs");

const client = await getPool().connect();
try {
  await client.query("BEGIN");
  const forward = await resolveRouteForRequest(client, {
    pickup_location: "NAIA Terminal 1",
    dropoff_location: "NAIA Terminal 3",
  });
  const reverse = await resolveRouteForRequest(client, {
    pickup_location: "NAIA Terminal 3",
    dropoff_location: "NAIA Terminal 1",
  });
  check(
    Boolean(forward?.route_id && reverse?.route_id && forward.route_id !== reverse.route_id),
    "new opposite legs create distinct directional routes"
  );
  await client.query("ROLLBACK");
} finally {
  client.release();
}

const known = await resolveRouteForRequest(
  { query },
  { pickup_location: "NAIA Terminal 2", dropoff_location: "CoCo Star Hotel" },
  { createMissing: false }
);
check(Boolean(known?.route_id), "known request leg resolves to its active directional route");

const before = Number((await query("SELECT COUNT(*)::int AS count FROM routes")).rows[0].count);
const unknown = await resolveRouteForRequest(
  { query },
  { pickup_location: "Guest-side pickup not in registry", dropoff_location: "Unknown venue" }
);
const after = Number((await query("SELECT COUNT(*)::int AS count FROM routes")).rows[0].count);
check(unknown === null && before === after, "unknown request legs stay ad-hoc and do not create reusable routes");

await getPool().end();
