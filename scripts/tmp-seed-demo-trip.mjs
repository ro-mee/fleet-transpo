// TEMPORARY demo seed for PR #4 visual verification — NOT a migration, not
// committed data. Creates ONE live trip (CoCo Star Hotel → NAIA Terminal 3)
// with GPS pings so the Live Operations page has something to show.
//
//   node scripts/tmp-seed-demo-trip.mjs            # create
//   node scripts/tmp-seed-demo-trip.mjs --remove   # delete everything created
//
// Cleanup keys on markers (no side file): reservation_number 'RS-DEMO-PR4',
// trip notes 'DEMO-PR4'. The dispatch INSERT fires the real
// notify_dispatch_created + enqueue_dispatch_push triggers, so the script
// only picks a driver with NO active device token (no phone can buzz) and
// --remove also deletes those notification/outbox rows.
import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

const MARKER_RS = "RS-DEMO-PR4";
const MARKER_NOTES = "DEMO-PR4";
// Real corridor from the locations table. Drop-off uses the CANONICAL name
// ("NAIA Terminal 3 - Arrivals (Bay 9)", id 10) — the gazetteer deliberately
// knows only the specific arrivals/departures variants, not the legacy
// "NAIA Terminal 3", so a legacy name would leave the monitor target null.
const PICKUP = { name: "CoCo Star Hotel", lat: 14.5159034, lng: 120.9953405 };
const DROPOFF = { name: "NAIA Terminal 3 - Arrivals (Bay 9)", lat: 14.5204800, lng: 121.0144500 };

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function remove() {
  const demoDispatches = await client.query(
    `SELECT ds.dispatch_id FROM dispatchschedules ds
       JOIN transportation_requests tr ON ds.request_id = tr.request_id
      WHERE tr.reservation_number = $1`, [MARKER_RS]);
  const dispatchIds = demoDispatches.rows.map((r) => r.dispatch_id);

  const demoTrips = await client.query(
    `SELECT trip_id, driver_id FROM trips WHERE notes = $1`, [MARKER_NOTES]);
  const tripIds = demoTrips.rows.map((r) => r.trip_id);

  const deleted = {};
  deleted.gps = await client.query(
    `DELETE FROM gpstracking WHERE trip_id = ANY($1) RETURNING tracking_id`,
    [tripIds.length ? tripIds : [-1]]);
  deleted.monitorAlerts = await client.query(
    `DELETE FROM trip_monitor_alerts WHERE trip_id = ANY($1) RETURNING alert_id`,
    [tripIds.length ? tripIds : [-1]]);
  deleted.trips = await client.query(
    `DELETE FROM trips WHERE trip_id = ANY($1) RETURNING trip_id`,
    [tripIds.length ? tripIds : [-1]]);
  if (dispatchIds.length) {
    deleted.notifications = await client.query(
      `DELETE FROM notifications WHERE reference_type = 'dispatch' AND reference_id = ANY($1) RETURNING notification_id`,
      [dispatchIds]);
    deleted.push = await client.query(
      `DELETE FROM push_outbox WHERE reference_type = 'dispatch' AND reference_id = ANY($1) RETURNING id`,
      [dispatchIds]);
    deleted.dispatches = await client.query(
      `DELETE FROM dispatchschedules WHERE dispatch_id = ANY($1) RETURNING dispatch_id`,
      [dispatchIds]);
  }
  deleted.requests = await client.query(
    `DELETE FROM transportation_requests WHERE reservation_number = $1 RETURNING request_id`,
    [MARKER_RS]);
  // Reset the demo driver's cached position only if we set it.
  const driverIds = [...new Set(demoTrips.rows.map((r) => r.driver_id).filter(Boolean))];
  if (driverIds.length) {
    await client.query(
      `UPDATE drivers SET current_latitude = NULL, current_longitude = NULL, last_location_update = NULL
        WHERE driver_id = ANY($1)`, [driverIds]);
  }
  for (const [name, res] of Object.entries(deleted)) {
    console.log(`removed ${res?.rowCount ?? 0} × ${name}`);
  }
}

async function add() {
  const now = new Date();
  const departAt = new Date(now.getTime() - 10 * 60 * 1000);   // picked up 10 min ago
  const arriveAt = new Date(now.getTime() + 30 * 60 * 1000);   // due in 30 min

  // Driver: available, no active push device (no phone can buzz), and free of
  // an active dispatch overlapping [departAt, arriveAt] (the DB overlap guard
  // would reject the insert otherwise).
  const { rows: drivers } = await client.query(
    `SELECT d.driver_id, d.employee_id, d.driver_status,
            e.first_name || ' ' || e.last_name AS name
       FROM drivers d
       JOIN employees e ON d.employee_id = e.employee_id
      WHERE d.deleted_at IS NULL
        AND d.driver_status = 'Available'
        AND NOT EXISTS (
          SELECT 1 FROM device_tokens dt
           WHERE dt.employee_id = d.employee_id AND dt.active
        )
        AND NOT EXISTS (
          SELECT 1 FROM dispatchschedules ds
           WHERE ds.deleted_at IS NULL
             AND ds.driver_id = d.driver_id
             AND ds.status IN ('Scheduled', 'In Progress')
             AND ds.scheduled_departure < $2
             AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1
        )
      ORDER BY d.driver_id
      LIMIT 1`, [departAt, arriveAt]);
  const driver = drivers[0];
  if (!driver) throw new Error("No free driver without a device token — aborting.");

  // Vehicle: free in the same window (prefer the well-known demo van).
  const { rows: vehicles } = await client.query(
    `SELECT v.vehicle_id, v.plate_number, v.vehicle_name
       FROM vehicles v
      WHERE v.deleted_at IS NULL
        AND v.vehicle_id NOT IN (
          SELECT vehicle_id FROM dispatchschedules
           WHERE deleted_at IS NULL
             AND status IN ('Scheduled', 'In Progress')
             AND vehicle_id IS NOT NULL
             AND scheduled_departure < $2
             AND COALESCE(scheduled_arrival, scheduled_departure) > $1
        )
      ORDER BY (v.vehicle_id = 37) DESC, v.vehicle_id
      LIMIT 1`, [departAt, arriveAt]);
  const vehicle = vehicles[0];
  if (!vehicle) throw new Error("No free vehicle in the window — aborting.");

  // Pick a fleet_status that actually exists in the live vocabulary.
  const { rows: statuses } = await client.query(
    `SELECT DISTINCT fleet_status FROM transportation_requests
      WHERE deleted_at IS NULL AND fleet_status IS NOT NULL`);
  const vocab = statuses.map((r) => r.fleet_status);
  const fleetStatus = vocab.includes("In Progress") ? "In Progress"
    : vocab.includes("Dispatched") ? "Dispatched"
    : vocab[0];

  await client.query("BEGIN");
  try {
    const request = await client.query(
      `INSERT INTO transportation_requests
         (pickup_location, dropoff_location, pickup_datetime, passenger_count,
          guest_name, reservation_number, fleet_status, booking_status, priority, source_system)
       VALUES ($1, $2, $3, 1, 'Demo Guest (PR4)', $4, $5, 'Confirmed', 'Medium', 'PMS')
       RETURNING request_id`,
      [PICKUP.name, DROPOFF.name, departAt, MARKER_RS, fleetStatus]);

    const dispatch = await client.query(
      `INSERT INTO dispatchschedules
         (request_id, vehicle_id, driver_id, dispatch_number, status,
          scheduled_departure, scheduled_arrival, notes)
       VALUES ($1, $2, $3, NULL, 'In Progress', $4, $5, $6)
       RETURNING dispatch_id, dispatch_number`,
      [request.rows[0].request_id, vehicle.vehicle_id, driver.driver_id,
       departAt, arriveAt, "Demo dispatch for PR #4 verification"]);

    const trip = await client.query(
      `INSERT INTO trips
         (vehicle_id, driver_id, dispatch_id, trip_status, start_time, notes)
       VALUES ($1, $2, $3, 'En Route', $4, $5)
       RETURNING trip_id`,
      [vehicle.vehicle_id, driver.driver_id, dispatch.rows[0].dispatch_id,
       departAt, MARKER_NOTES]);

    // Four pings along the corridor, the newest ~25 s ago (reads "fresh",
    // threshold is 90 s), accuracy 15 m (well inside the 150 m validity limit).
    const at = (f) => [
      +(PICKUP.lat + (DROPOFF.lat - PICKUP.lat) * f).toFixed(7),
      +(PICKUP.lng + (DROPOFF.lng - PICKUP.lng) * f).toFixed(7),
    ];
    const pings = [
      { f: 0.3, agoS: 105 },
      { f: 0.55, agoS: 75 },
      { f: 0.75, agoS: 45 },
      { f: 0.92, agoS: 25 },
    ];
    for (const p of pings) {
      const [lat, lng] = at(p.f);
      await client.query(
        `INSERT INTO gpstracking
           (vehicle_id, trip_id, latitude, longitude, speed, heading, altitude, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, 8.5, 75, 10, 15, $5)`,
        [vehicle.vehicle_id, trip.rows[0].trip_id, lat, lng,
         new Date(now.getTime() - p.agoS * 1000)]);
    }

    // The GPS POST route also refreshes the driver's cached position — mirror
    // that so every surface (incl. the mobile app) sees one consistent spot.
    const last = at(0.92);
    await client.query(
      `UPDATE drivers SET current_latitude = $2, current_longitude = $3,
              last_location_update = now()
        WHERE driver_id = $1`,
      [driver.driver_id, last[0], last[1]]);

    await client.query("COMMIT");
    console.log("Demo trip created:");
    console.log("  trip_id:", trip.rows[0].trip_id, "(status En Route)");
    console.log("  dispatch:", dispatch.rows[0].dispatch_number,
      `(id ${dispatch.rows[0].dispatch_id}, In Progress)`);
    console.log("  request:", request.rows[0].request_id,
      `${PICKUP.name} → ${DROPOFF.name} (fleet_status: ${fleetStatus})`);
    console.log("  vehicle:", vehicle.plate_number, `(id ${vehicle.vehicle_id})`);
    console.log("  driver:", driver.name, `(driver_id ${driver.driver_id}, no push device)`);
    console.log("  gps: 4 pings along the corridor, newest 25 s ago");
    console.log("  schedule: departed 10 min ago, due to arrive in 30 min");
    console.log("\nOpen /tracking/live-map. Remove later with:");
    console.log("  node scripts/tmp-seed-demo-trip.mjs --remove");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
}

try {
  if (process.argv.includes("--remove")) await remove();
  else await add();
} finally {
  await client.end();
}
