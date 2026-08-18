// Wipe all reservation-related data from the live database so it can be
// re-seeded fresh. This clears the whole transportation_requests chain plus
// every table that hangs off it (dispatches, trips, events, integration log,
// notifications, audit trail scoped to those resources).
//
// It deletes rows, not tables. Vehicles, drivers, routes, categories,
// maintenance and fuel reference data are untouched unless they are FK
// children of the reservation chain being removed.
//
// Run: node scripts/clean-reservation-data.mjs
import { loadEnvLocal } from "./load-env.mjs";
import { Pool } from "pg";

loadEnvLocal();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function count(table) {
  const { rows } = await pool.query(`SELECT count(*)::int n FROM ${table}`);
  return rows[0].n;
}

async function clear(pool, label, sql, params) {
  const { rowCount } = await pool.query(sql, params);
  if (rowCount) console.log(`  ${String(rowCount).padStart(6)}  ${label}`);
}

const client = await pool.connect();
try {
  await client.query("BEGIN");

  // Capture the reservation request ids first so child tables that reference
  // by request_id can be swept in the same pass.
  const { rows } = await client.query(`SELECT request_id FROM transportation_requests`);
  const requestIds = rows.map((r) => r.request_id);

  // Notifications written by triggers against reservation-linked resources.
  await clear(client, "notifications (trip)",
    `DELETE FROM notifications WHERE reference_type = 'trip' AND reference_id = ANY(
       SELECT trip_id FROM trips WHERE dispatch_id = ANY(
         SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])))`,
    [requestIds]);
  await clear(client, "notifications (dispatch)",
    `DELETE FROM notifications WHERE reference_type = 'dispatch' AND reference_id = ANY(
       SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[]))`,
    [requestIds]);
  await clear(client, "notifications (transportation_request)",
    `DELETE FROM notifications WHERE reference_type = 'transportation_request' AND reference_id = ANY($1::int[])`,
    [requestIds]);

  // Children first, deepest last, so no FK blocks a delete.
  const order = [
    ["gpstracking", `DELETE FROM gpstracking WHERE trip_id = ANY(
       SELECT trip_id FROM trips WHERE dispatch_id = ANY(
         SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])))`, requestIds],
    ["fuelrecords", `DELETE FROM fuelrecords WHERE trip_id = ANY(
       SELECT trip_id FROM trips WHERE dispatch_id = ANY(
         SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])))`, requestIds],
    ["driverincidents", `DELETE FROM driverincidents WHERE trip_id = ANY(
       SELECT trip_id FROM trips WHERE dispatch_id = ANY(
         SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])))`, requestIds],
    ["vehicleinspection", `DELETE FROM vehicleinspection WHERE trip_id = ANY(
       SELECT trip_id FROM trips WHERE dispatch_id = ANY(
         SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[])))`, requestIds],
    ["uvvrp_violations", `DELETE FROM uvvrp_violations WHERE dispatch_id = ANY(
       SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[]))`, requestIds],
    ["trips", `DELETE FROM trips WHERE dispatch_id = ANY(
       SELECT dispatch_id FROM dispatchschedules WHERE request_id = ANY($1::int[]))`, requestIds],
    ["dispatchschedules", `DELETE FROM dispatchschedules WHERE request_id = ANY($1::int[])`, requestIds],
    ["reservation_events", `DELETE FROM reservation_events WHERE request_id = ANY($1::int[])`, requestIds],
    ["recommendation_snapshots", `DELETE FROM recommendation_snapshots WHERE request_id = ANY($1::int[])`, requestIds],
    ["ai_recommendations", `DELETE FROM ai_recommendations WHERE reference_type = 'reservation' AND reference_id = ANY($1::int[])`, requestIds],
    ["integration_log", `DELETE FROM integration_log WHERE reference_type = 'transportation_request' AND reference_id = ANY($1::int[])`, requestIds],
    ["transportation_requests", `DELETE FROM transportation_requests WHERE request_id = ANY($1::int[])`, requestIds],
  ];
  for (const [label, sql, params] of order) {
    if (!params.length) continue;
    await clear(client, label, sql, [params]);
  }

  await client.query("COMMIT");

  console.log(`\nReservation chain cleared (${requestIds.length} request(s) removed).`);
} catch (e) {
  try { await client.query("ROLLBACK"); } catch {}
  throw e;
} finally {
  client.release();
}

await pool.end();