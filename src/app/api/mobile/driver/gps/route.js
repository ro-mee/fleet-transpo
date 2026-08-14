import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, handleError } from "@/lib/api/utils";

/**
 * POST /api/mobile/driver/gps
 *
 * Generic endpoint for drivers to report their live GPS location even when they
 * do not have an active trip. Used for fleet tracking (Online & Waiting).
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const body = await parseBody(req);

    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return err("latitude and longitude are required", 400);
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return err("latitude or longitude is out of range", 400);
    }

    const toNumberOrNull = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };

    // Update driver's last known location
    await query(
      `UPDATE drivers
          SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
        WHERE driver_id = $3`,
      [latitude, longitude, session.user.driverId]
    );

    // If driver is assigned to a vehicle (even if no active trip), update GPS tracking
    const { rows: driverRows } = await query(
      `SELECT assigned_vehicle_id FROM drivers WHERE driver_id = $1 LIMIT 1`,
      [session.user.driverId]
    );
    const vehicleId = driverRows[0]?.assigned_vehicle_id;

    if (vehicleId) {
      await query(
        `INSERT INTO gpstracking
           (vehicle_id, trip_id, latitude, longitude, speed, heading, altitude, accuracy, recorded_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::TIMESTAMPTZ, NOW()))`,
        [
          vehicleId,
          null, // No active trip
          latitude,
          longitude,
          toNumberOrNull(body.speed) ?? 0,
          toNumberOrNull(body.heading) ?? 0,
          toNumberOrNull(body.altitude) ?? 0,
          toNumberOrNull(body.accuracy) ?? 0,
          body.recorded_at ?? null,
        ]
      );
    }

    return ok({ success: true });
  } catch (e) {
    return handleError(e);
  }
}
