import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

// Active rescue missions for the live operations map: every OPEN incident with
// a fleet responder assigned, with both parties' live positions. This is the
// responder's counterpart to /api/trips/latest-locations — a rescue is not a
// trip, so this feed is what puts the rescue unit on the same map the guest
// trips appear on. Read-only: the lazy evaluateResponder hooks on the other
// incident GETs keep response_status/ETA fresh; nothing is computed here.
export async function GET(req) {
  try {
    await requirePermission(req, "incidents", "read");

    const { rows } = await query(
      `SELECT i.incident_id,
              i.incident_type, i.severity, i.location,
              i.response_status, i.response_eta,
              i.responder_assigned_at,
              v.plate_number,
              CASE WHEN rd.driver_id IS NULL THEN NULL ELSE
                json_build_object(
                  'driver_id', rd.driver_id,
                  'name', TRIM(BOTH FROM COALESCE(re.first_name, '') || ' ' || COALESCE(re.last_name, '')),
                  'latitude', rd.current_latitude,
                  'longitude', rd.current_longitude,
                  'last_location_update', rd.last_location_update
                )
              END AS responder,
              CASE WHEN dd.driver_id IS NULL THEN NULL ELSE
                json_build_object(
                  'name', TRIM(BOTH FROM COALESCE(de.first_name, '') || ' ' || COALESCE(de.last_name, '')),
                  'latitude', COALESCE(dd.current_latitude, i.latitude),
                  'longitude', COALESCE(dd.current_longitude, i.longitude),
                  'last_location_update', dd.last_location_update
                )
              END AS driver
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
         LEFT JOIN drivers rd ON rd.driver_id = i.responder_driver_id AND rd.deleted_at IS NULL
         LEFT JOIN employees re ON re.employee_id = rd.employee_id
         LEFT JOIN drivers dd ON dd.driver_id = i.driver_id AND dd.deleted_at IS NULL
         LEFT JOIN employees de ON de.employee_id = dd.employee_id
        WHERE i.status = 'Open'
          AND i.responder_driver_id IS NOT NULL
          AND i.deleted_at IS NULL
        ORDER BY i.responder_assigned_at DESC NULLS LAST, i.incident_id DESC`
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
