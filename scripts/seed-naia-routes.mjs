import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();

import { query } from "../src/lib/db.js";

async function main() {
  console.log("🚀 Starting NAIA Terminal Routes & Hotel Base Location Seeding...");

  // 1. Ensure system_settings table exists
  await query(`
    CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      updated_by INT
    );
  `);

  // 2. Upsert Hotel Location setting
  const hotelLocation = {
    hotel_name: "CoCo Star Hotel",
    address: "CoCo Star Hotel, Manila, Philippines",
    latitude: 14.5159034,
    longitude: 120.9953405,
    google_maps_url: "https://maps.app.goo.gl/jmKkcqiUrSbr1i747",
  };

  await query(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES ('hotel_location', $1, NOW())
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
    [JSON.stringify(hotelLocation)]
  );
  console.log("✅ System Setting 'hotel_location' configured to CoCo Star Hotel.");

  // 3. Upsert locations
  const locationsData = [
    {
      name: "CoCo Star Hotel",
      address: "CoCo Star Hotel, Manila, Philippines",
      latitude: 14.5159034,
      longitude: 120.9953405,
    },
    {
      name: "NAIA Terminal 1",
      address: "NAIA Terminal 1 (International Arrivals & Departures), Pasay/Parañaque",
      latitude: 14.5097,
      longitude: 121.0006,
    },
    {
      name: "NAIA Terminal 2",
      address: "NAIA Terminal 2 (Centennial Terminal), NAIA Road, Pasay",
      latitude: 14.5106,
      longitude: 121.0064,
    },
    {
      name: "NAIA Terminal 3",
      address: "NAIA Terminal 3 (Main International & Domestic), Andrews Ave, Pasay",
      latitude: 14.5205,
      longitude: 121.0152,
    },
    {
      name: "NAIA Terminal 4",
      address: "NAIA Terminal 4 (Manila Domestic Passenger Terminal), Domestic Road, Pasay",
      latitude: 14.5245,
      longitude: 121.0007,
    },
  ];

  const locIdMap = {};
  for (const loc of locationsData) {
    const { rows } = await query(
      `SELECT location_id FROM locations WHERE name = $1`,
      [loc.name]
    );
    if (rows.length > 0) {
      locIdMap[loc.name] = rows[0].location_id;
      await query(
        `UPDATE locations SET address = $1, latitude = $2, longitude = $3 WHERE location_id = $4`,
        [loc.address, loc.latitude, loc.longitude, rows[0].location_id]
      );
    } else {
      const { rows: inserted } = await query(
        `INSERT INTO locations (name, address, latitude, longitude) VALUES ($1, $2, $3, $4) RETURNING location_id`,
        [loc.name, loc.address, loc.latitude, loc.longitude]
      );
      locIdMap[loc.name] = inserted[0].location_id;
    }
  }
  console.log("✅ Locations Upserted:", locIdMap);

  // 4. Upsert NAIA Terminal Routes
  const routesData = [
    {
      route_name: "CoCo Star Hotel → NAIA Terminal 1",
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 1",
      origin_location_id: locIdMap["CoCo Star Hotel"],
      destination_location_id: locIdMap["NAIA Terminal 1"],
      distance_km: 5.2,
      estimated_duration_minutes: 15,
      status: "Active",
    },
    {
      route_name: "CoCo Star Hotel → NAIA Terminal 2",
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 2",
      origin_location_id: locIdMap["CoCo Star Hotel"],
      destination_location_id: locIdMap["NAIA Terminal 2"],
      distance_km: 4.8,
      estimated_duration_minutes: 12,
      status: "Active",
    },
    {
      route_name: "CoCo Star Hotel → NAIA Terminal 3",
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 3",
      origin_location_id: locIdMap["CoCo Star Hotel"],
      destination_location_id: locIdMap["NAIA Terminal 3"],
      distance_km: 6.1,
      estimated_duration_minutes: 18,
      status: "Active",
    },
    {
      route_name: "CoCo Star Hotel → NAIA Terminal 4",
      origin: "CoCo Star Hotel",
      destination: "NAIA Terminal 4",
      origin_location_id: locIdMap["CoCo Star Hotel"],
      destination_location_id: locIdMap["NAIA Terminal 4"],
      distance_km: 3.9,
      estimated_duration_minutes: 10,
      status: "Active",
    },
  ];

  for (const r of routesData) {
    const { rows } = await query(
      `SELECT route_id FROM routes WHERE route_name = $1 AND deleted_at IS NULL`,
      [r.route_name]
    );

    if (rows.length > 0) {
      await query(
        `UPDATE routes
            SET origin = $1, destination = $2, origin_location_id = $3, destination_location_id = $4,
                estimated_distance = $5, estimated_duration = $6, status = $7
          WHERE route_id = $8`,
        [
          r.origin,
          r.destination,
          r.origin_location_id,
          r.destination_location_id,
          r.distance_km,
          r.estimated_duration_minutes,
          r.status,
          rows[0].route_id,
        ]
      );
      console.log(`✅ Updated route: ${r.route_name}`);
    } else {
      await query(
        `INSERT INTO routes (route_name, origin, destination, origin_location_id, destination_location_id, estimated_distance, estimated_duration, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          r.route_name,
          r.origin,
          r.destination,
          r.origin_location_id,
          r.destination_location_id,
          r.distance_km,
          r.estimated_duration_minutes,
          r.status,
        ]
      );
      console.log(`✅ Created route: ${r.route_name}`);
    }
  }

  console.log("🎉 NAIA Terminal Routes Seeding Complete!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error seeding NAIA routes:", err);
  process.exit(1);
});
