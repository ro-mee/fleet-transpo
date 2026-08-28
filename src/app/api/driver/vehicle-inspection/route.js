import { query } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";

/**
 * GET /api/driver/vehicle-inspection
 *
 * A driver's own vehicle-condition snapshot: the latest inspection row for the
 * vehicle currently assigned to the authenticated driver (driver-scoped, no
 * cross-driver data).
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);

    const { rows: driverRows } = await query(
      `SELECT d.driver_id FROM employees e
         JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL LIMIT 1`,
      [session.user.employeeId]
    );
    const driverId = driverRows[0]?.driver_id;
    if (!driverId) return err("No driver record is linked to this account", 403);

    const { rows } = await query(
      `SELECT i.inspection_id, i.inspection_type, i.inspection_date, i.checklist,
              i.findings, i.severity, i.status, v.plate_number, v.vehicle_status, v.image_url
         FROM vehicleinspection i
         JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.vehicle_id IN (
          SELECT va.vehicle_id FROM driver_vehicle_assignments va
           WHERE va.driver_id = $1
             AND (va.assigned_until IS NULL OR va.assigned_until >= CURRENT_DATE)
        )
        ORDER BY i.inspection_date DESC NULLS LAST, i.created_at DESC
        LIMIT 1`,
      [driverId]
    );

    return ok(rows[0] || null);
  } catch (e) { return handleError(e); }
}
