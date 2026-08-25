import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// Staff view of all driver-reported incidents (dispatcher, management, ops).
// Read-only. The driver self-service endpoint (/api/driver/incidents) remains
// driver-scoped; this one surfaces every incident with its vehicle/driver.
export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const sp = new URL(req.url).searchParams;

    let sql = `
      SELECT i.incident_id,
             COALESCE(i.vehicle_id, a.vehicle_id) as vehicle_id,
             i.vehicle_id as reported_vehicle_id,
             i.trip_id, i.incident_type, i.incident_date,
             i.description, i.location, i.latitude, i.longitude, i.severity, i.status,
             i.actions_taken, i.created_at, i.assistance_needed, i.expense_amount, i.photo_urls,
             COALESCE(v.plate_number, av.plate_number) as plate_number,
             CASE WHEN d.driver_id IS NULL THEN NULL ELSE
               json_build_object('driver_id', d.driver_id, 'first_name', e.first_name, 'last_name', e.last_name)
             END AS driver
        FROM driverincidents i
        LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        LEFT JOIN drivers d ON d.driver_id = i.driver_id
        LEFT JOIN employees e ON e.employee_id = d.employee_id
        LEFT JOIN driver_vehicle_assignments a ON a.driver_id = i.driver_id AND a.assigned_until IS NULL
        LEFT JOIN vehicles av ON av.vehicle_id = a.vehicle_id
       WHERE i.deleted_at IS NULL`;
    const params = []; let idx = 1;

    const severity = sp.get("severity");
    if (severity) { sql += ` AND i.severity = $${idx++}`; params.push(severity); }
    const status = sp.get("status");
    if (status) { sql += ` AND i.status = $${idx++}`; params.push(status); }
    const type = sp.get("type");
    if (type) { sql += ` AND i.incident_type ILIKE $${idx++}`; params.push(`%${type}%`); }
    const coords = sp.get("coords");
    if (coords === "true") { sql += ` AND i.latitude IS NOT NULL AND i.longitude IS NOT NULL`; }
    const from = sp.get("from");
    if (from) { sql += ` AND i.incident_date >= $${idx++}`; params.push(from); }
    const to = sp.get("to");
    if (to) { sql += ` AND i.incident_date <= $${idx++}`; params.push(to); }

    sql += " ORDER BY i.incident_date DESC, i.created_at DESC";

    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "0", 10) || 0, 0), 500);
    if (limit > 0) { sql += ` LIMIT $${idx++}`; params.push(limit); }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
