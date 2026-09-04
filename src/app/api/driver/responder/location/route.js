import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { evaluateResponder } from "@/lib/incidents/responder-tracking";

/**
 * POST /api/driver/responder/location
 *
 * The assigned responder's live position. Their app's GPS poster calls this
 * on its 30s tick whenever the driver has an active responder assignment and
 * no active trip (trip GPS already updates drivers.current_* — and the lazy
 * evaluation hooks pick that up from the stranded driver's poll). The strand
 * driver's own position has its own endpoint; this one is for the helper.
 *
 * Updates drivers.current_* and then runs the responder evaluation that may
 * auto-advance Dispatched → En Route → Arrived and refresh the ETA.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);

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

    // Only meaningful while this driver is the assigned responder on an open
    // incident — otherwise a stray poster tick must not touch positions.
    const { rows } = await query(
      `SELECT incident_id
         FROM driverincidents
        WHERE responder_driver_id = $1
          AND status = 'Open'
          AND deleted_at IS NULL
        ORDER BY responder_assigned_at DESC NULLS LAST
        LIMIT 1`,
      [session.user.driverId]
    );
    const incidentId = rows[0]?.incident_id;
    // No open assignment is not an error: the mobile poster keeps ticking for
    // up to a minute after a mission completes (60s refresh cadence), and a
    // 404 there would surface "Location not sent" noise on the tracking chip.
    if (!incidentId) return ok({ updated: false });

    await query(
      `UPDATE drivers
          SET current_latitude = $1, current_longitude = $2, last_location_update = NOW()
        WHERE driver_id = $3`,
      [latitude, longitude, session.user.driverId]
    );

    // The position write already succeeded; evaluation (TomTom call, status
    // advance, notifications) is best-effort on top of it.
    const evaluation = await evaluateResponder(incidentId, { req, session });

    return ok({ updated: true, incident_id: incidentId, response_status: evaluation.responseStatus ?? null });
  } catch (e) {
    return handleError(e);
  }
}
