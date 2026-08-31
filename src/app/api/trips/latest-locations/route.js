import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { LIVE_TRIP_STATUSES } from "@/lib/constants";
import { getGpsHealth, speedKmhFromMps } from "@/lib/gps";

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);

    // Return one row per active trip, including a null GPS fix when the trip
    // has never reported. That lets the UI distinguish "No signal" from a
    // different vehicle's last position without inventing coordinates.
    const { rows } = await query(`
      SELECT ${TRIPS_SELECT},
             g.tracking_id AS gps_tracking_id,
             g.latitude AS gps_latitude,
             g.longitude AS gps_longitude,
             g.speed AS gps_speed_mps,
             g.heading AS gps_heading,
             g.altitude AS gps_altitude,
             g.accuracy AS gps_accuracy,
             g.recorded_at AS gps_recorded_at
        ${TRIPS_JOINS}
        LEFT JOIN LATERAL (
          SELECT tracking_id, latitude, longitude, speed, heading, altitude, accuracy, recorded_at
            FROM gpstracking
           WHERE trip_id = t.trip_id
           ORDER BY recorded_at DESC NULLS LAST, tracking_id DESC
           LIMIT 1
        ) g ON TRUE
       WHERE t.trip_status = ANY($1)
         AND t.deleted_at IS NULL
       ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC
    `, [LIVE_TRIP_STATUSES]);

    const numberOrNull = (value) => {
      if (value == null || String(value).trim() === "") return null;
      const number = Number(value);
      return Number.isFinite(number) ? number : null;
    };

    return ok(rows.map((row) => ({
      ...row,
      latitude: numberOrNull(row.gps_latitude),
      longitude: numberOrNull(row.gps_longitude),
      speed: numberOrNull(row.gps_speed_mps),
      speed_kmh: speedKmhFromMps(row.gps_speed_mps),
      heading: numberOrNull(row.gps_heading),
      altitude: numberOrNull(row.gps_altitude),
      accuracy: numberOrNull(row.gps_accuracy),
      recorded_at: row.gps_recorded_at ?? null,
      gps_status: getGpsHealth(row.gps_recorded_at).key,
    })));
  } catch (e) { return handleError(e); }
}
