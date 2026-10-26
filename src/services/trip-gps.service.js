import { z } from "zod";
import { AuthError } from "@/lib/api/utils";
import { getGpsHealth, isValidCoordinate } from "@/lib/gps";
import { MAX_CLOCK_SKEW_MS } from "@/lib/dispatch/location-relevance";
import { buildPingAdvisories } from "@/services/ping-advisories.service";

const captureTimeSchema = z.string().datetime({ offset: true });
const toNumberOrNull = (value) => {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

// Routes retain their own authorization, ownership and live-trip checks.
export async function recordTripGps(trip, body, query) {
  if (!isValidCoordinate(body.latitude, body.longitude)) {
    throw new AuthError("latitude and longitude are required", 400);
  }
  let recordedAt = null;
  if (body.recorded_at != null) {
    if (!captureTimeSchema.safeParse(body.recorded_at).success ||
        new Date(body.recorded_at).getTime() > Date.now() + MAX_CLOCK_SKEW_MS) {
      throw new AuthError("recorded_at must be a valid timestamp with a timezone, at most 30 seconds ahead", 400);
    }
    recordedAt = new Date(body.recorded_at).toISOString();
  }
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = toNumberOrNull(body.accuracy);
  const { rows } = await query(
    `INSERT INTO gpstracking
       (vehicle_id, trip_id, latitude, longitude, speed, heading, altitude, accuracy, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::TIMESTAMPTZ, NOW()))
     RETURNING *`,
    [trip.vehicle_id, trip.trip_id, latitude, longitude, toNumberOrNull(body.speed),
      toNumberOrNull(body.heading), toNumberOrNull(body.altitude), accuracy, recordedAt]
  );
  const ping = rows[0];
  // Preserve late breadcrumbs, but compare capture times atomically so an
  // older concurrent upload cannot replace a newer current position.
  const updated = await query(
    `UPDATE drivers
        SET current_latitude = $1, current_longitude = $2, last_location_update = $4::TIMESTAMPTZ
      WHERE driver_id = $3
        AND (last_location_update IS NULL OR last_location_update < $4::TIMESTAMPTZ)
      RETURNING driver_id`,
    [latitude, longitude, trip.driver_id, ping.recorded_at]
  );
  const advisories = updated.rows.length > 0 && getGpsHealth(ping.recorded_at).key === "fresh"
    ? await buildPingAdvisories(trip, { latitude, longitude, accuracy }, query)
    : { geofence: null, monitor: null, weather: null };
  return { ...ping, ...advisories };
}
