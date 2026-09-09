// Read-only preflight for the trip start-window notification acceptance run
// (checklist in "Capstone/01 - System/Trip Start Window Notifications
// Implementation Plan.md"). Run with `node scripts/acceptance-preflight.mjs`
// from the repo root; it answers, against the LIVE project DB:
//   1. Has anything hit /api/cron/sync lately? (system_settings cron_sync_last_ok)
//   2. What pg_cron jobs are scheduled right now, and when did they last run?
//   3. Is pg_net available (would let pg_cron call the HTTP endpoint in-DB)?
//   4. Are there any Driver Accepted trips right now (live-test fodder), and
//   5. Do those trips' drivers have a fresh last_location_update? (staleness
//      watch item: the ETA ladder keys off current_latitude/longitude, whose
//      age is only visible via last_location_update.)
// Read-only: SELECTs against system_settings, cron.job, extensions, trips.
import { loadEnvLocal } from "./load-env.mjs";

loadEnvLocal();

const pg = (await import("pg")).default;
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const q = async (label, text) => {
  try {
    const res = await client.query(text);
    console.log(`\n== ${label} ==`);
    console.log(JSON.stringify(res.rows, null, 2));
  } catch (err) {
    console.log(`\n== ${label} == ERROR: ${err.message}`);
  }
};

await q("cron_sync heartbeat (system_settings)", `
  SELECT setting_key, setting_value, updated_at
  FROM system_settings
  WHERE setting_key IN ('cron_sync_last_ok', 'cron_sync_last_payload')
  ORDER BY setting_key`);

await q("pg_cron jobs", `
  SELECT jobid, jobname, schedule, active, command
  FROM cron.job ORDER BY jobid`);

await q("recent pg_cron runs (errors?)", `
  SELECT runid, jobid, status, return_message, start_time, end_time
  FROM cron.job_run_details
  ORDER BY runid DESC LIMIT 10`);

await q("pg_net available?", `
  SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron','pg_net')`);

await q("Driver Accepted trips (live-test fodder)", `
  SELECT t.trip_id, t.trip_status, ds.scheduled_departure,
         d.driver_id, d.current_latitude, d.current_longitude, d.last_location_update
  FROM trips t
  JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
  LEFT JOIN drivers d ON d.driver_id = t.driver_id
  WHERE t.trip_status = 'Driver Accepted' AND t.deleted_at IS NULL
  ORDER BY ds.scheduled_departure
  LIMIT 10`);

await client.end();
