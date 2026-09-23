// TEMPORARY restaurant-booking seed for queue badge verification — NOT a
// migration, not committed data. Creates ONE Pending transportation_request
// whose pickup/dropoff match the Restaurant tag heuristic in
// src/components/reservations/reservation-queue-table.jsx (getDerivedTags +
// formatTripMetrics: "resto|restaurant|lumière|lumiere|dining|bistro|cafe|bar").
//
//   node scripts/tmp-seed-restaurant-booking.mjs           # create (today)
//   node scripts/tmp-seed-restaurant-booking.mjs --remove  # delete it
//
// Cleanup keys on markers: external_booking_id + reservation_number
// 'RS-DEMO-RESTO'. fleet_status stays Pending so the row sits in the queue's
// open/today bucket without needing a dispatch or resources.
import { loadEnvLocal } from "./load-env.mjs";
import pg from "pg";

loadEnvLocal();

const MARKER = "RS-DEMO-RESTO";
const EXTERNAL = "DEMO-RESTO-001";
// Both ends hit the heuristic so the badge cannot depend on one side only.
const PICKUP = "Lumière Restaurant, Makati";
const DROPOFF = "CoCo Star Hotel";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

async function remove() {
  const res = await client.query(
    `DELETE FROM transportation_requests
      WHERE reservation_number = $1 OR external_booking_id = $2
      RETURNING request_id`,
    [MARKER, EXTERNAL]
  );
  console.log(`removed ${res.rowCount} × transportation_requests`);
}

async function add() {
  const existing = await client.query(
    `SELECT request_id FROM transportation_requests
      WHERE reservation_number = $1 OR external_booking_id = $2`,
    [MARKER, EXTERNAL]
  );
  if (existing.rows.length) {
    console.log(`Already seeded — request_id ${existing.rows[0].request_id}.`);
    console.log("Remove first with: node scripts/tmp-seed-restaurant-booking.mjs --remove");
    return;
  }

  // Pickup later today so the queue buckets it under Today (Manila calendar
  // day), not Upcoming — matches how a dispatcher would actually triage it.
  const pickup = new Date();
  pickup.setHours(pickup.getHours() + 3);

  const { rows } = await client.query(
    `INSERT INTO transportation_requests
       (external_booking_id, source_system, booking_reference, guest_name,
        pickup_location, dropoff_location, pickup_datetime, passenger_count,
        special_requests, priority, booking_status, fleet_status,
        reservation_number, is_vip, requested_vehicle_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING request_id, fleet_status, pickup_datetime`,
    [
      EXTERNAL,
      "POS", // restaurant POS / F&B side, not the hotel PMS
      "BK-DEMO-RESTO",
      "Restaurant Demo Guest",
      PICKUP,
      DROPOFF,
      pickup,
      4, // >= 4 also trips the Group tag if you want both pills
      "Seeded restaurant transfer for badge verification",
      "Medium",
      "Confirmed",
      "Pending",
      MARKER,
      false,
      "Sedan",
    ]
  );

  console.log("Restaurant booking created:");
  console.log("  request_id:", rows[0].request_id, `(fleet_status: ${rows[0].fleet_status})`);
  console.log("  pickup:", PICKUP, "→", DROPOFF);
  console.log("  pickup_datetime:", rows[0].pickup_datetime, "(~3h from now)");
  console.log("  source_system: POS · passenger_count: 4");
  console.log("\nOpen /reservations/queue — expect the Restaurant pill");
  console.log("(and Group, from passenger_count >= 4). Remove later with:");
  console.log("  node scripts/tmp-seed-restaurant-booking.mjs --remove");
}

try {
  if (process.argv.includes("--remove")) await remove();
  else await add();
} finally {
  await client.end();
}
