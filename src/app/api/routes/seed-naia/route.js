import { query, withTransaction } from "@/lib/db";
import { requirePermission, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";
import { NAIA_CANONICAL_LOCATIONS, NAIA_LEGACY_LOCATION_NAMES } from "@/lib/naia-locations";
import { fetchTomTomEstimate } from "@/lib/tomtom";

function validCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max;
}

function cleanTerminal(input) {
  const name = String(input?.name ?? "").trim();
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  if (!name || name.length > 120) return null;
  if (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180)) return null;
  return { name, latitude, longitude };
}

export async function POST(req) {
  try {
    const session = await requirePermission(req, "routes", "seed");
    const body = await parseBody(req).catch(() => ({}));
    // Fully-dynamic: callers may supply their own airport endpoints
    // (managed via /routes/locations). Omitted → seed defaults from
    // `src/lib/naia-locations.js`. Empty array is rejected — syncing zero
    // terminals would orphan every airport route silently.
    let terminals = NAIA_CANONICAL_LOCATIONS;
    if (body && typeof body.terminals !== "undefined") {
      if (!Array.isArray(body.terminals) || body.terminals.length === 0 || body.terminals.length > 50) {
        return err("terminals must be a non-empty array (max 50) of { name, latitude, longitude }.", 400);
      }
      const cleaned = body.terminals.map(cleanTerminal);
      if (cleaned.some((t) => !t)) {
        return err("Each terminal needs a name (≤120 chars) and valid latitude/longitude.", 400);
      }
      const seen = new Set(cleaned.map((t) => t.name.toLowerCase()));
      if (seen.size !== cleaned.length) {
        return err("Terminal names must be unique.", 400);
      }
      terminals = cleaned;
    }
    const { rows: settingRows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    const hotel = settingRows[0]?.setting_value;
    if (!hotel?.hotel_name || !validCoordinate(hotel.latitude, -90, 90) || !validCoordinate(hotel.longitude, -180, 180)) {
      return err("Configure a valid hotel location before syncing airport routes.", 400);
    }

    const result = await withTransaction(async (tx) => {
      const legacyRows = await tx.query(
        `SELECT location_id
           FROM locations
          WHERE is_active = true
            AND LOWER(BTRIM(name)) = ANY($1::text[])`,
        [NAIA_LEGACY_LOCATION_NAMES.map((name) => name.toLowerCase())]
      );
      if (legacyRows.rows.length) {
        await tx.query(
          `UPDATE locations
              SET is_active = false, retired_at = COALESCE(retired_at, NOW())
            WHERE location_id = ANY($1::int[])`,
          [legacyRows.rows.map((row) => Number(row.location_id))]
        );
        await tx.query(
          `UPDATE routes
              SET status = 'Inactive', updated_at = NOW()
            WHERE status = 'Active' AND deleted_at IS NULL
              AND (origin_location_id = ANY($1::int[]) OR destination_location_id = ANY($1::int[]))`,
          [legacyRows.rows.map((row) => Number(row.location_id))]
        );
      }

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
      for (const terminal of terminals) {
        const existing = (await tx.query(
          `SELECT location_id FROM locations
            WHERE is_active = true AND lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
            ORDER BY location_id LIMIT 1`,
          [terminal.name]
        )).rows[0];
        const row = existing || (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active)
           VALUES ($1,$2,$3,$4,true) RETURNING location_id`,
          [terminal.name, null, terminal.latitude, terminal.longitude]
        )).rows[0];
        locations[terminal.name] = Number(row.location_id);
        if (existing) {
          await tx.query(
            `UPDATE locations SET address = $1, latitude = $2, longitude = $3, is_active = true, retired_at = NULL WHERE location_id = $4`,
            [null, terminal.latitude, terminal.longitude, row.location_id]
          );
        }

        const legs = [
          { origin: hotel.hotel_name.trim(), destination: terminal.name, originId: hotelRow.location_id, destinationId: row.location_id, originLocation: hotel, destinationLocation: terminal },
          { origin: terminal.name, destination: hotel.hotel_name.trim(), originId: row.location_id, destinationId: hotelRow.location_id, originLocation: terminal, destinationLocation: hotel },
        ];
        for (const leg of legs) {
          const estimate = await fetchTomTomEstimate(
            [leg.originLocation.latitude, leg.originLocation.longitude],
            [leg.destinationLocation.latitude, leg.destinationLocation.longitude]
          );
          const route = (await tx.query(
            `SELECT route_id, estimate_source FROM routes
              WHERE status = 'Active' AND deleted_at IS NULL
                AND origin_location_id = $1 AND destination_location_id = $2
              ORDER BY route_id LIMIT 1`,
            [leg.originId, leg.destinationId]
          )).rows[0];
          if (route) {
            if (estimate && route.estimate_source !== "Manual") {
              await tx.query(
                `UPDATE routes
                    SET origin = $1, destination = $2, route_name = $3,
                        estimated_distance = $4, estimated_duration = $5,
                        estimate_source = 'TomTom', estimate_updated_at = NOW(), updated_at = NOW()
                  WHERE route_id = $6`,
                [leg.origin, leg.destination, `${leg.origin} → ${leg.destination}`, estimate.distanceKm, estimate.durationMin, route.route_id]
              );
            } else {
              await tx.query(
                `UPDATE routes
                    SET origin = $1, destination = $2, route_name = $3, updated_at = NOW()
                  WHERE route_id = $4`,
                [leg.origin, leg.destination, `${leg.origin} → ${leg.destination}`, route.route_id]
              );
            }
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
                estimate?.distanceKm ?? null,
                estimate?.durationMin ?? null,
                estimate ? "TomTom" : null,
              ]
            );
          }
        }
      }
      return { hotelLocationId: Number(hotelRow.location_id), terminalCount: terminals.length, directionCount: terminals.length * 2 };
    });

    await writeAudit(req, session, { action: "update", resource: "routes", newValues: { ...result, terminals } });
    return ok({ message: "Airport routes synced successfully.", ...result });
  } catch (e) {
    if (e?.code === "23505") return err("A route already exists for one of these directions. Refresh the registry and retry.", 409);
    return handleError(e);
  }
}
