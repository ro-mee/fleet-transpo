import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";

/**
 * POST /api/driver/incidents/[id]/location
 *
 * Live position refresh while the driver waits for help. Trip GPS only posts
 * during an active trip, so a standby driver's position would otherwise be
 * frozen at report time; the mobile status screen calls this on its poll
 * while the incident is unresolved. Updates drivers.current_* — the
 * incident's own lat/lng stay report-time evidence.
 */
export async function POST(req, props) {
  try {
    const session = await requireDriver(req);
    const params = await props.params;
    const id = params.id;
    if (!id) return err("Incident ID is required", 400);

    const parsedBody = await parseBody(req);
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return errValidation({ coordinates: "Latitude and longitude are required" });
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return errValidation({ coordinates: "Coordinates are out of range" });
    }

    // Ownership: the incident must belong to this driver and still be open —
    // resolved incidents stop tracking position.
    const { rows } = await query(
      `SELECT 1
         FROM driverincidents
        WHERE incident_id = $1 AND driver_id = $2
          AND status = 'Open' AND deleted_at IS NULL`,
      [id, session.user.driverId]
    );
    if (!rows.length) return err("No open incident found for this driver", 404);

    await query(
      `UPDATE drivers
          SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
        WHERE driver_id = $3`,
      [latitude, longitude, session.user.driverId]
    );
    return ok({ updated: true });
  } catch (e) {
    return handleError(e);
  }
}
