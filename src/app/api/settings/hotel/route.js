import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError, errValidation } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

function coordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function clean(value) {
  const result = String(value ?? "").trim();
  return result || null;
}

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    return ok(rows[0]?.setting_value || null);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);
    const body = await parseBody(req);
    const hotelName = clean(body.hotel_name);
    const address = clean(body.address);
    const latitude = coordinate(body.latitude, -90, 90);
    const longitude = coordinate(body.longitude, -180, 180);
    const googleMapsUrl = clean(body.google_maps_url);
    const errors = {};
    if (!hotelName) errors.hotel_name = "Hotel name is required.";
    if (!address) errors.address = "Address is required.";
    if (latitude === null) errors.latitude = "Latitude must be between -90 and 90.";
    if (longitude === null) errors.longitude = "Longitude must be between -180 and 180.";
    if (googleMapsUrl) {
      try { new URL(googleMapsUrl); } catch { errors.google_maps_url = "Google Maps URL is invalid."; }
    }
    if (typeof body.physical_move !== "undefined" && typeof body.physical_move !== "boolean") {
      errors.physical_move = "Physical move must be true or false.";
    }
    if (Object.keys(errors).length) return errValidation(errors);

    const previousResult = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location' LIMIT 1`
    );
    const previous = previousResult.rows[0]?.setting_value || null;
    const physicalMove = body.physical_move === true;

    const settings = await withTransaction(async (tx) => {
      let oldLocation = null;
      if (previous?.location_id) {
        oldLocation = (await tx.query(
          `SELECT * FROM locations WHERE location_id = $1 LIMIT 1`,
          [Number(previous.location_id)]
        )).rows[0] || null;
      }
      if (!oldLocation && previous?.hotel_name) {
        oldLocation = (await tx.query(
          `SELECT * FROM locations
            WHERE lower(regexp_replace(trim(name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim($1), '\\s+', ' ', 'g'))
            ORDER BY location_id LIMIT 1`,
          [previous.hotel_name]
        )).rows[0] || null;
      }

      let location;
      if (oldLocation && !physicalMove) {
        location = (await tx.query(
          `UPDATE locations
              SET name = $1, address = $2, latitude = $3, longitude = $4, is_active = true, retired_at = NULL
            WHERE location_id = $5
          RETURNING *`,
          [hotelName, address, latitude, longitude, oldLocation.location_id]
        )).rows[0];

        // Keep the route text readable while preserving the same FK identity.
        await tx.query(
          `UPDATE routes
              SET origin = CASE WHEN origin_location_id = $1 THEN $2 ELSE origin END,
                  destination = CASE WHEN destination_location_id = $1 THEN $2 ELSE destination END,
                  route_name = replace(route_name, $3, $2),
                  updated_at = NOW()
            WHERE origin_location_id = $1 OR destination_location_id = $1`,
          [oldLocation.location_id, hotelName, oldLocation.name]
        );
      } else {
        location = (await tx.query(
          `INSERT INTO locations (name, address, latitude, longitude, is_active)
           VALUES ($1,$2,$3,$4,true) RETURNING *`,
          [hotelName, address, latitude, longitude]
        )).rows[0];
        if (oldLocation && physicalMove) {
          await tx.query(
            `UPDATE locations SET is_active = false, retired_at = COALESCE(retired_at, NOW()) WHERE location_id = $1`,
            [oldLocation.location_id]
          );
          await tx.query(
            `UPDATE routes
                SET status = 'Inactive', updated_at = NOW()
              WHERE status = 'Active'
                AND (origin_location_id = $1 OR destination_location_id = $1)`,
            [oldLocation.location_id]
          );
        }
      }

      const settingValue = {
        hotel_name: hotelName,
        address,
        latitude,
        longitude,
        google_maps_url: googleMapsUrl || "",
        location_id: Number(location.location_id),
      };
      await tx.query(
        `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES ('hotel_location', $1, NOW(), $2)
         ON CONFLICT (setting_key)
         DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [JSON.stringify(settingValue), session.user?.employeeId ?? null]
      );
      return settingValue;
    });

    await writeAudit(req, session, { action: "update", resource: "hotel_location", newValues: settings });
    return ok({ message: physicalMove ? "New hotel location created; previous location retired." : "Hotel base location updated successfully.", settings });
  } catch (e) {
    return handleError(e);
  }
}
