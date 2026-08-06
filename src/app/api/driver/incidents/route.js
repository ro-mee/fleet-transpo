import { query } from "@/lib/db";
import { requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { getAdminClient } from "@/lib/db";

// A breakdown-type incident triggers automation (see POST): the vehicle is set
// to Under Maintenance and dispatchers are notified, so it stops receiving
// future assignments.
const BREAKDOWN_RE = /breakdown|mechanical|engine|flat tire|battery|electrical|overheat/i;

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
                 severity, status, created_at, vehicle_id`,
      [driverId, body.vehicle_id || null, body.trip_id || null, body.incident_type,
       incidentDate, body.description, body.location || null, severity]
    );

    // Breakdown automation: a breakdown report takes the vehicle out of service
    // and alerts dispatchers. Best-effort — a sync hiccup must not fail the
    // report that was just recorded.
    if (rows[0]?.vehicle_id && BREAKDOWN_RE.test(String(body.incident_type || ""))) {
      try {
        const supabase = getAdminClient();
        await supabase
          .from("vehicles")
          .update({ vehicle_status: "Under Maintenance" })
          .eq("vehicle_id", rows[0].vehicle_id)
          .is("deleted_at", null);

        const { data: dispatchers } = await supabase
          .from("employees")
          .select("employee_id")
          .in("role_id", [1, 2, 3, 7, 9]) // system_admin, fleet_manager, dispatcher, management, admin
          .is("deleted_at", null);
        const { data: vehicle } = await supabase
          .from("vehicles")
          .select("plate_number")
          .eq("vehicle_id", rows[0].vehicle_id)
          .maybeSingle();

        const rows2 = (dispatchers || []).map((emp) => ({
          employee_id: emp.employee_id,
          title: "Vehicle Breakdown Reported",
          message: `Vehicle ${vehicle?.plate_number || `#${rows[0].vehicle_id}`} reported breakdown and set to Under Maintenance (incident #${rows[0].incident_id}).`,
          type: "Alert",
          reference_type: "incident",
          reference_id: rows[0].incident_id,
        }));
        if (rows2.length) await supabase.from("notifications").insert(rows2);
      } catch (e) {
        console.warn("breakdown automation failed:", e?.message || e);
      }
    }

    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
