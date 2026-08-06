import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

async function resolveDriverId(employeeId) {
  const { rows } = await query(
    `SELECT d.driver_id FROM employees e
       JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
      WHERE e.employee_id = $1 AND e.deleted_at IS NULL LIMIT 1`,
    [employeeId]
  );
  return rows[0]?.driver_id || null;
}

/**
 * GET /api/driver/incidents
 * List the authenticated driver's own incident reports, newest first.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const driverId = await resolveDriverId(session.user.employeeId);
    if (!driverId) return err("No driver record is linked to this account", 403);

    const { rows } = await query(
      `SELECT i.incident_id, i.vehicle_id, i.trip_id, i.incident_type, i.incident_date,
              i.description, i.location, i.severity, i.status, i.actions_taken,
              i.created_at, v.plate_number
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.driver_id = $1
        ORDER BY i.incident_date DESC, i.created_at DESC
        LIMIT 50`,
      [driverId]
    );
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}

/**
 * POST /api/driver/incidents
 * Report an incident. Always scoped to the authenticated driver; a driver can
 * only ever create incidents for themselves.
 */
export async function POST(req) {
  try {
    const session = await requireDriver(req);
    const driverId = await resolveDriverId(session.user.employeeId);
    if (!driverId) return err("No driver record is linked to this account", 403);

    const body = await parseBody(req);
    const errors = validateBody(body, {
      incident_type: { required: true, maxLength: 100, label: "Incident type" },
      description: { required: true, maxLength: 2000, label: "Description" },
      location: { maxLength: 300, label: "Location" },
      severity: { maxLength: 20, label: "Severity" },
      incident_date: { label: "Incident date" },
      vehicle_id: { type: "id", label: "Vehicle" },
      trip_id: { type: "id", label: "Trip" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const severity = ["Minor", "Moderate", "Major", "Critical"].includes(body.severity)
      ? body.severity
      : "Minor";
    const incidentDate = body.incident_date ? new Date(body.incident_date) : new Date();

    const { rows } = await query(
      `INSERT INTO driverincidents
         (driver_id, vehicle_id, trip_id, incident_type, incident_date,
          description, location, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING incident_id, incident_type, incident_date, description, location,
                 severity, status, created_at`,
      [driverId, body.vehicle_id || null, body.trip_id || null, body.incident_type,
       incidentDate, body.description, body.location || null, severity]
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
