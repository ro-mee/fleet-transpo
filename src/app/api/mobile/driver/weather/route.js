import { query } from "@/lib/db";
import { requireDriver, ok, handleError } from "@/lib/api/utils";
import { getCurrentConditions } from "@/lib/weather";

/**
 * GET /api/mobile/driver/weather[?latitude=&longitude=]
 *
 * Current weather for the driver's position, feeding the Home header's
 * ambient weather chip. Unlike the GPS POST enrichment (which only exists
 * while a trip is live), this answers for the no-trip case too — an idle
 * driver still gets weather at their location.
 *
 * Position resolution, in order:
 * 1. `latitude`/`longitude` query params — the device's one-shot position,
 *    sent only when the app already holds foreground location permission
 *    (this endpoint never triggers a permission prompt);
 * 2. the driver's last-known position (drivers.current_*) — whatever the
 *    last GPS post/responder post stored;
 * 3. neither → `weather: null` (the chip simply doesn't render).
 *
 * The payload carries current conditions plus a reverse-geocoded placeName
 * (municipality/locality — the chip shows WHERE, the icon shows the weather).
 * Best-effort like every weather path: cached coarse-grid lookups, and any
 * failure resolves to null.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const { searchParams } = new URL(req.url);

    const queryLat = Number(searchParams.get("latitude"));
    const queryLng = Number(searchParams.get("longitude"));
    let latitude = Number.isFinite(queryLat) ? queryLat : null;
    let longitude = Number.isFinite(queryLng) ? queryLng : null;

    if (latitude == null || longitude == null) {
      const { rows } = await query(
        `SELECT current_latitude, current_longitude
           FROM drivers
          WHERE driver_id = $1`,
        [session.user.driverId]
      );
      const d = rows[0];
      latitude = d?.current_latitude ?? null;
      longitude = d?.current_longitude ?? null;
    }

    if (latitude == null || longitude == null) {
      return ok({ weather: null, source: "none" });
    }

    const weather = await getCurrentConditions(latitude, longitude);
    return ok({ weather, source: "position" });
  } catch (e) {
    return handleError(e);
  }
}
