import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError, errValidation } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);

    const { rows } = await query(
      `SELECT setting_value FROM system_settings WHERE setting_key = 'hotel_location'`
    );

    const defaultHotel = {
      hotel_name: "CoCo Star Hotel",
      address: "CoCo Star Hotel, Manila, Philippines",
      latitude: 14.5159034,
      longitude: 120.9953405,
      google_maps_url: "https://maps.app.goo.gl/jmKkcqiUrSbr1i747",
    };

    if (!rows.length || !rows[0].setting_value) {
      return ok(defaultHotel);
    }

    return ok(rows[0].setting_value);
  } catch (e) {
    return handleError(e);
  }
}

export async function PUT(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin"]);
    const body = await parseBody(req);

    const hotelName = body.hotel_name || "CoCo Star Hotel";
    const address = body.address || "CoCo Star Hotel, Manila, Philippines";
    const latitude = Number(body.latitude) || 14.5159034;
    const longitude = Number(body.longitude) || 120.9953405;
    const googleMapsUrl = body.google_maps_url || "https://maps.app.goo.gl/jmKkcqiUrSbr1i747";

    const settingValue = {
      hotel_name: hotelName,
      address,
      latitude,
      longitude,
      google_maps_url: googleMapsUrl,
    };

    // 1. Update system_settings
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('hotel_location', $1, NOW(), $2)
       ON CONFLICT (setting_key)
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(settingValue), session.userId || null]
    );

    // 2. Sync base hotel record in locations table
    const { rows: existingLoc } = await query(
      `SELECT location_id FROM locations WHERE name = $1`,
      [hotelName]
    );

    if (existingLoc.length > 0) {
      await query(
        `UPDATE locations SET address = $1, latitude = $2, longitude = $3 WHERE location_id = $4`,
        [address, latitude, longitude, existingLoc[0].location_id]
      );
    } else {
      await query(
        `INSERT INTO locations (name, address, latitude, longitude) VALUES ($1, $2, $3, $4)`,
        [hotelName, address, latitude, longitude]
      );
    }

    return ok({ message: "Hotel base location updated successfully", settings: settingValue });
  } catch (e) {
    return handleError(e);
  }
}
