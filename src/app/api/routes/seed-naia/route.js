import { query, withTransaction } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

const TERMINALS = [
  { name: "NAIA Terminal 1", address: "NAIA Terminal 1 (International Arrivals & Departures), Pasay/Parañaque", latitude: 14.5097, longitude: 121.0006, distance: 5.2, duration: 15 },
  { name: "NAIA Terminal 2", address: "NAIA Terminal 2 (Centennial Terminal), NAIA Road, Pasay", latitude: 14.5106, longitude: 121.0064, distance: 4.8, duration: 12 },
  { name: "NAIA Terminal 3", address: "NAIA Terminal 3 (Main International & Domestic), Andrews Ave, Pasay", latitude: 14.5205, longitude: 121.0152, distance: 6.1, duration: 18 },
  { name: "NAIA Terminal 4", address: "NAIA Terminal 4 (Manila Domestic Passenger Terminal), Domestic Road, Pasay", latitude: 14.5245, longitude: 121.0007, distance: 3.9, duration: 10 },
];

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);
    const { rows: settingRows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    const hotel = settingRows[0]?.setting_value;
    if (!hotel?.hotel_name || !validCoordinate(hotel.latitude, -90, 90) || !validCoordinate(hotel.longitude, -180, 180)) {
      return err("Configure a valid hotel location before syncing airport routes.", 400);
    }

    const result = await withTransaction(async (tx) => {
      let hotelRow;
      if (hotel.location_id) {
        hotelRow = (await tx.query(
          `SELECT location_id FROM locations WHERE location_id = $1 AND is_active = true LIMIT 1`,
          [Number(hotel.location_id)]
        )).rows[0];
      }
      if (!hotelRow) {
        hotelRow = (await tx.query(
          `SELECT location_id FROM locations
            WHERE is_active = true AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
            ORDER BY location_id LIMIT 1`,
          [hotel.hotel_name]
        )).rows[0];
      }
      if (!hotelRow) {
        hotelRow = (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active)
           VALUES ($1,$2,$3,$4,true) RETURNING location_id`,
          [hotel.hotel_name.trim(), hotel.address?.trim() || null, Number(hotel.latitude), Number(hotel.longitude)]
        )).rows[0];
      } else {
        await tx.query(
          `UPDATE locations
              SET name = $1, address = $2, latitude = $3, longitude = $4, is_active = true, retired_at = NULL
            WHERE location_id = $5`,
          [hotel.hotel_name.trim(), hotel.address?.trim() || null, Number(hotel.latitude), Number(hotel.longitude), hotelRow.location_id]
        );
      }

      const locations = { [hotel.hotel_name.trim()]: Number(hotelRow.location_id) };
      for (const terminal of TERMINALS) {
        const existing = (await tx.query(
          `SELECT location_id FROM locations
            WHERE is_active = true AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
            ORDER BY location_id LIMIT 1`,
          [terminal.name]
        )).rows[0];
        const row = existing || (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active)
           VALUES ($1,$2,$3,$4,true) RETURNING location_id`,
          [terminal.name, terminal.address, terminal.latitude, terminal.longitude]
        )).rows[0];
        locations[terminal.name] = Number(row.location_id);
        if (existing) {
          await tx.query(
            `UPDATE locations SET address = $1, latitude = $2, longitude = $3, is_active = true, retired_at = NULL WHERE location_id = $4`,
            [terminal.address, terminal.latitude, terminal.longitude, row.location_id]
          );
        }

        const legs = [
          { origin: hotel.hotel_name.trim(), destination: terminal.name, originId: hotelRow.location_id, destinationId: row.location_id, distance: terminal.distance, duration: terminal.duration },
          { origin: terminal.name, destination: hotel.hotel_name.trim(), originId: row.location_id, destinationId: hotelRow.location_id, distance: null, duration: null },
        ];
        for (const leg of legs) {
          const route = (await tx.query(
            `SELECT route_id FROM routes
              WHERE status = 'Active' AND deleted_at IS NULL
                AND origin_location_id = $1 AND destination_location_id = $2
              ORDER BY route_id LIMIT 1`,
            [leg.originId, leg.destinationId]
          )).rows[0];
          if (route) {
            await tx.query(
              `UPDATE routes
                  SET origin = $1, destination = $2, route_name = $3, updated_at = NOW()
                WHERE route_id = $4`,
              [leg.origin, leg.destination, `${leg.origin} → ${leg.destination}`, route.route_id]
            );
          } else {
            await tx.query(
              `INSERT INTO routes
                 (route_name, origin, destination, origin_location_id, destination_location_id,
                  estimated_distance, estimated_duration, estimate_source, estimate_updated_at, status)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::varchar IS NULL THEN NULL ELSE NOW() END,'Active')`,
              [
                `${leg.origin} → ${leg.destination}`,
                leg.origin,
                leg.destination,
                leg.originId,
                leg.destinationId,
                leg.distance,
                leg.duration,
                leg.distance || leg.duration ? "Legacy / Unknown" : null,
              ]
            );
          }
        }
      }
      return { hotelLocationId: Number(hotelRow.location_id), terminalCount: TERMINALS.length, directionCount: TERMINALS.length * 2 };
    });

    await writeAudit(req, session, { action: "update", resource: "routes", newValues: result });
    return ok({ message: "NAIA terminal routes synced successfully.", ...result });
  } catch (e) {
    if (e?.code === "23505") return err("A route already exists for one of these directions. Refresh the registry and retry.", 409);
    return handleError(e);
  }
}
