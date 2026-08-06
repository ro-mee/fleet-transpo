import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin"]);

    // Fetch current hotel settings
    const { rows: settingRows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location'`
    );

    const hotel = settingRows[0]?.setting_value || {
      hotel_name: "CoCo Star Hotel",
      address: "CoCo Star Hotel, Manila, Philippines",
      latitude: 14.5159034,
      longitude: 120.9953405,
    };

    // Upsert locations
    const locationsData = [
      {
        name: hotel.hotel_name || "CoCo Star Hotel",
        address: hotel.address || "CoCo Star Hotel, Manila, Philippines",
        latitude: Number(hotel.latitude) || 14.5159034,
        longitude: Number(hotel.longitude) || 120.9953405,
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

    // Upsert routes
    const hotelName = hotel.hotel_name || "CoCo Star Hotel";
    const routesData = [
      {
        route_name: `${hotelName} ↔ NAIA Terminal 1`,
        origin: hotelName,
        destination: "NAIA Terminal 1",
        origin_location_id: locIdMap[hotelName],
        destination_location_id: locIdMap["NAIA Terminal 1"],
        distance_km: 5.2,
        estimated_duration_minutes: 15,
      },
      {
        route_name: `${hotelName} ↔ NAIA Terminal 2`,
        origin: hotelName,
        destination: "NAIA Terminal 2",
        origin_location_id: locIdMap[hotelName],
        destination_location_id: locIdMap["NAIA Terminal 2"],
        distance_km: 4.8,
        estimated_duration_minutes: 12,
      },
      {
        route_name: `${hotelName} ↔ NAIA Terminal 3`,
        origin: hotelName,
        destination: "NAIA Terminal 3",
        origin_location_id: locIdMap[hotelName],
        destination_location_id: locIdMap["NAIA Terminal 3"],
        distance_km: 6.1,
        estimated_duration_minutes: 18,
      },
      {
        route_name: `${hotelName} ↔ NAIA Terminal 4`,
        origin: hotelName,
        destination: "NAIA Terminal 4",
        origin_location_id: locIdMap[hotelName],
        destination_location_id: locIdMap["NAIA Terminal 4"],
        distance_km: 3.9,
        estimated_duration_minutes: 10,
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
                  estimated_distance = $5, estimated_duration = $6, status = 'Active'
            WHERE route_id = $7`,
          [
            r.origin,
            r.destination,
            r.origin_location_id,
            r.destination_location_id,
            r.distance_km,
            r.estimated_duration_minutes,
            rows[0].route_id,
          ]
        );
      } else {
        await query(
          `INSERT INTO routes (route_name, origin, destination, origin_location_id, destination_location_id, estimated_distance, estimated_duration, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active')`,
          [
            r.origin,
            r.destination,
            r.origin_location_id,
            r.destination_location_id,
            r.distance_km,
            r.estimated_duration_minutes,
          ]
        );
      }
    }

    return ok({ message: "NAIA Terminal routes synced successfully!" });
  } catch (e) {
    return handleError(e);
  }
}
