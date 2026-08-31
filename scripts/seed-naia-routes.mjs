import { loadEnvLocal } from "./load-env.mjs";
loadEnvLocal();

import { getPool, withTransaction } from "../src/lib/db.js";
import { NAIA_CANONICAL_LOCATIONS, NAIA_LEGACY_LOCATION_NAMES } from "../src/lib/naia-locations.js";
import { fetchTomTomEstimate } from "../src/lib/tomtom.js";

const HOTEL_LOCATION = {
  hotel_name: "CoCo Star Hotel",
  address: "CoCo Star Hotel, Manila, Philippines",
  latitude: 14.5159034,
  longitude: 120.9953405,
  google_maps_url: "https://maps.app.goo.gl/jmKkcqiUrSbr1i747",
};

const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

async function main() {
  const result = await withTransaction(async (tx) => {
    await tx.query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at)
       VALUES ('hotel_location', $1, NOW())
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW()`,
      [JSON.stringify(HOTEL_LOCATION)]
    );

    const legacyRows = await tx.query(
      `SELECT location_id
         FROM locations
        WHERE is_active = true
          AND LOWER(BTRIM(name)) = ANY($1::text[])`,
      [NAIA_LEGACY_LOCATION_NAMES.map(normalize)]
    );
    const legacyIds = legacyRows.rows.map((row) => Number(row.location_id));
    if (legacyIds.length) {
      await tx.query(
        `UPDATE locations
            SET is_active = false, retired_at = COALESCE(retired_at, NOW())
          WHERE location_id = ANY($1::int[])`,
        [legacyIds]
      );
      await tx.query(
        `UPDATE routes
            SET status = 'Inactive', updated_at = NOW()
          WHERE status = 'Active' AND deleted_at IS NULL
            AND (origin_location_id = ANY($1::int[]) OR destination_location_id = ANY($1::int[]))`,
        [legacyIds]
      );
    }

    let hotelRow = (await tx.query(
      `SELECT location_id FROM locations
        WHERE is_active = true
          AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = $1
        ORDER BY location_id LIMIT 1`,
      [normalize(HOTEL_LOCATION.hotel_name)]
    )).rows[0];
    if (!hotelRow) {
      hotelRow = (await tx.query(
        `INSERT INTO locations (name, address, latitude, longitude, is_active)
         VALUES ($1,$2,$3,$4,true) RETURNING location_id`,
        [HOTEL_LOCATION.hotel_name, HOTEL_LOCATION.address, HOTEL_LOCATION.latitude, HOTEL_LOCATION.longitude]
      )).rows[0];
    } else {
      await tx.query(
        `UPDATE locations
            SET name = $1, address = $2, latitude = $3, longitude = $4, is_active = true, retired_at = NULL
          WHERE location_id = $5`,
        [HOTEL_LOCATION.hotel_name, HOTEL_LOCATION.address, HOTEL_LOCATION.latitude, HOTEL_LOCATION.longitude, hotelRow.location_id]
      );
    }

    const locationIds = { [HOTEL_LOCATION.hotel_name]: Number(hotelRow.location_id) };
    for (const location of NAIA_CANONICAL_LOCATIONS) {
      let row = (await tx.query(
        `SELECT location_id FROM locations
          WHERE is_active = true
            AND LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g')) = $1
          ORDER BY location_id LIMIT 1`,
        [normalize(location.name)]
      )).rows[0];
      if (!row) {
        row = (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active)
           VALUES ($1, NULL, $2, $3, true) RETURNING location_id`,
          [location.name, location.latitude, location.longitude]
        )).rows[0];
      } else {
        await tx.query(
          `UPDATE locations
              SET name = $1, address = NULL, latitude = $2, longitude = $3, is_active = true, retired_at = NULL
            WHERE location_id = $4`,
          [location.name, location.latitude, location.longitude, row.location_id]
        );
      }
      locationIds[location.name] = Number(row.location_id);
    }

    for (const location of NAIA_CANONICAL_LOCATIONS) {
      for (const leg of [
        { origin: HOTEL_LOCATION.hotel_name, destination: location.name, originId: locationIds[HOTEL_LOCATION.hotel_name], destinationId: locationIds[location.name], originLocation: HOTEL_LOCATION, destinationLocation: location },
        { origin: location.name, destination: HOTEL_LOCATION.hotel_name, originId: locationIds[location.name], destinationId: locationIds[HOTEL_LOCATION.hotel_name], originLocation: location, destinationLocation: HOTEL_LOCATION },
      ]) {
        const estimate = await fetchTomTomEstimate(
          [leg.originLocation.latitude, leg.originLocation.longitude],
          [leg.destinationLocation.latitude, leg.destinationLocation.longitude]
        );
        const existing = (await tx.query(
          `SELECT route_id, estimate_source FROM routes
            WHERE status = 'Active' AND deleted_at IS NULL
              AND origin_location_id = $1 AND destination_location_id = $2
            ORDER BY route_id LIMIT 1`,
          [leg.originId, leg.destinationId]
        )).rows[0];
        if (existing) {
          if (estimate && existing.estimate_source !== "Manual") {
            await tx.query(
              `UPDATE routes
                  SET route_name = $1, origin = $2, destination = $3,
                      estimated_distance = $4, estimated_duration = $5,
                      estimate_source = 'TomTom', estimate_updated_at = NOW(), updated_at = NOW()
                WHERE route_id = $6`,
              [`${leg.origin} → ${leg.destination}`, leg.origin, leg.destination, estimate.distanceKm, estimate.durationMin, existing.route_id]
            );
          } else {
            await tx.query(
              `UPDATE routes
                  SET route_name = $1, origin = $2, destination = $3, updated_at = NOW()
                WHERE route_id = $4`,
              [`${leg.origin} → ${leg.destination}`, leg.origin, leg.destination, existing.route_id]
            );
          }
        } else {
          await tx.query(
            `INSERT INTO routes
               (route_name, origin, destination, origin_location_id, destination_location_id,
                estimated_distance, estimated_duration, estimate_source, estimate_updated_at, status)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8::varchar IS NULL THEN NULL ELSE NOW() END,'Active')`,
            [`${leg.origin} → ${leg.destination}`, leg.origin, leg.destination, leg.originId, leg.destinationId, estimate?.distanceKm ?? null, estimate?.durationMin ?? null, estimate ? "TomTom" : null]
          );
        }
      }
    }

    return {
      hotelLocationId: Number(hotelRow.location_id),
      terminalCount: NAIA_CANONICAL_LOCATIONS.length,
      directionCount: NAIA_CANONICAL_LOCATIONS.length * 2,
      retiredLegacyLocations: legacyIds.length,
    };
  });

  console.log(JSON.stringify(result, null, 2));
  await getPool().end();
}

main().catch(async (error) => {
  console.error("NAIA sync failed:", error);
  try { await getPool().end(); } catch {}
  process.exitCode = 1;
});
