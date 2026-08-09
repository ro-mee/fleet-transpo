const { Client } = require("pg");
const fs = require("fs");
(async () => {
  const g = (k) => (fs.readFileSync(".env.local", "utf8").match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1];
  const c = new Client({ connectionString: g("DATABASE_URL") });
  await c.connect();
  try {
    const dd = await c.query(
      `SELECT column_name, column_default, is_nullable FROM information_schema.columns
        WHERE table_schema='public' AND table_name='dispatchschedules' AND column_name='dispatch_number'`
    );
    console.log("dispatch_number default:", JSON.stringify(dd.rows));
    const disp = await c.query(
      `SELECT dispatch_number FROM dispatchschedules ORDER BY dispatch_id DESC LIMIT 3`
    );
    console.log("recent dispatch_numbers:", JSON.stringify(disp.rows));
    await c.query("BEGIN");

    const now = new Date();
    const dep = new Date(now.getTime() + 15 * 60000);
    const arr = new Date(now.getTime() + 135 * 60000);

    // 1) POST /api/dispatch — same columns the API accepts
    const ins = await c.query(
      `INSERT INTO dispatchschedules
         (vehicle_id, driver_id, route_id, status, scheduled_departure, scheduled_arrival, notes, dispatch_number)
       VALUES ($1, $2, $3, 'Scheduled', $4, $5, $6, $7)
       RETURNING *`,
      [37, 21, 1, dep.toISOString(), arr.toISOString(), "TEST: Jack dispatch->mobile flow verification", `TEST-DSP-${Date.now()}`]
    );
    const d = ins.rows[0];
    console.log("1) DISPATCH INSERTED:", JSON.stringify(d));

    // 2) ensureTripForDispatch() — the trip is created only for
    //    Scheduled/In Progress dispatches, with trip_status Assigned
    const trip = await c.query(
      `INSERT INTO trips (vehicle_id, driver_id, dispatch_id, route_id, trip_status)
       VALUES ($1, $2, $3, $4, 'Assigned')
       RETURNING trip_id, trip_status`,
      [37, 21, d.dispatch_id, 1]
    );
    console.log("2) TRIP CREATED:", JSON.stringify(trip.rows[0]));

    await c.query("COMMIT");

    // 3) GET /api/mobile/driver/trips — exact SQL the mobile app runs
    const mobileList = await c.query(
      `SELECT t.trip_id, t.trip_status,
              r.origin, r.destination,
              ol.latitude  AS origin_latitude,  ol.longitude  AS origin_longitude,
              dl.latitude  AS destination_latitude, dl.longitude AS destination_longitude,
              t.start_time, t.end_time, r.estimated_distance, r.estimated_duration,
              t.dispatch_id, t.notes,
              v.vehicle_id, v.plate_number, v.model,
              r.route_id, r.route_name
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
         LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
         LEFT JOIN locations dl ON dl.location_id = r.destination_location_id
        WHERE t.driver_id = 21 AND t.deleted_at IS NULL
          AND t.trip_status = ANY(ARRAY['Pending','Approved','Assigned','Vehicle Assigned','Driver Assigned','Dispatched'])
        ORDER BY t.start_time ASC NULLS LAST, t.trip_id ASC`
    );
    console.log("3) MOBILE PENDING LIST (driver 21):", JSON.stringify(mobileList.rows, null, 2));

    // 4) Driver taps "Start trip" → PUT /api/trips/[id]/status { status: "Trip Started" }
    //    syncBusyTrip() flips dispatchschedules -> In Progress
    await c.query("BEGIN");
    await c.query(`UPDATE trips SET trip_status = 'Trip Started', start_time = NOW(), updated_at = NOW() WHERE trip_id = $1`, [trip.rows[0].trip_id]);
    await c.query(`UPDATE dispatchschedules SET status = 'In Progress', actual_departure = NOW(), updated_at = NOW() WHERE dispatch_id = $1`, [d.dispatch_id]);
    await c.query("COMMIT");
    console.log("4) START TRIP DONE -> trips + dispatch flipped");

    const after = await c.query(
      `SELECT t.trip_id, t.trip_status, t.start_time, ds.dispatch_id, ds.status AS dispatch_status,
              v.plate_number
         FROM trips t
         JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE t.trip_id = $1`,
      [trip.rows[0].trip_id]
    );
    console.log("4b) STATE AFTER START:", JSON.stringify(after.rows, null, 2));

    // 5) Mobile active list — Trip Started is in the active group
    const mobileActive = await c.query(
      `SELECT trip_id, trip_status FROM trips
        WHERE driver_id = 21 AND deleted_at IS NULL
          AND trip_status = ANY(ARRAY['Driver Accepted','Trip Started','En Route','Arrived','In Progress'])`
    );
    console.log("5) MOBILE ACTIVE LIST (driver 21):", JSON.stringify(mobileActive.rows, null, 2));
  } finally {
    await c.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
