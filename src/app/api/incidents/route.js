import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { INCIDENT_READ_ROLES } from "@/lib/incidents/resolution";

// Staff view of all driver-reported incidents (dispatcher, management, ops).
// Read-only. The driver self-service endpoint (/api/driver/incidents) remains
// driver-scoped; this one surfaces every incident with its vehicle/driver.
export async function GET(req) {
  try {
    await requireAuth(req, INCIDENT_READ_ROLES);
    const sp = new URL(req.url).searchParams;

    const conditions = ["i.deleted_at IS NULL"];
    const params = [];

    const severity = sp.get("severity");
    if (severity) { params.push(severity); conditions.push(`i.severity = $${params.length}`); }
    const status = sp.get("status");
    if (status) { params.push(status); conditions.push(`i.status = $${params.length}`); }
    const type = sp.get("type");
    if (type) { params.push(`%${type}%`); conditions.push(`i.incident_type ILIKE $${params.length}`); }
    const coords = sp.get("coords");
    if (coords === "true") conditions.push("i.latitude IS NOT NULL AND i.longitude IS NOT NULL");
    const from = sp.get("from");
    if (from) { params.push(from); conditions.push(`i.incident_date >= $${params.length}::date`); }
    const to = sp.get("to");
    if (to) { params.push(to); conditions.push(`i.incident_date < ($${params.length}::date + 1)`); }
    const where = conditions.join(" AND ");

    if (sp.get("summary") === "true") {
      const { rows: summaryRows } = await query(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE i.status = 'Open')::int AS open,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND i.acknowledged_at IS NULL)::int AS unacknowledged,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND i.severity IN ('Major', 'Critical'))::int AS critical_major_open,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND COALESCE(array_length(i.assistance_needed, 1), 0) > 0)::int AS assistance_open,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND i.grounding_status = 'Failed')::int AS grounding_failed,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND (i.requires_vehicle_maintenance AND i.maintenance_id IS NULL))::int AS maintenance_pending,
           COUNT(*) FILTER (WHERE i.status = 'Open' AND (i.acknowledged_at IS NULL OR i.grounding_status IN ('Pending', 'Failed') OR (i.requires_vehicle_maintenance AND i.maintenance_id IS NULL) OR i.maintenance_error IS NOT NULL OR COALESCE(array_length(i.assistance_needed, 1), 0) > 0))::int AS attention
         FROM driverincidents i
        WHERE ${where}`,
        params
      );
      return ok(summaryRows[0] || { total: 0, open: 0, unacknowledged: 0, critical_major_open: 0, assistance_open: 0, grounding_failed: 0, maintenance_pending: 0, attention: 0 });
    }

    let sql = `
      SELECT i.incident_id,
             i.vehicle_id,
             i.trip_id, i.incident_type, i.incident_date,
             i.description, i.location, i.latitude, i.longitude, i.severity, i.status,
             i.actions_taken, i.acknowledged_at, i.acknowledged_by,
             i.resolved_at, i.resolved_by, i.grounding_status, i.grounding_error,
             i.requires_vehicle_maintenance, i.maintenance_id, i.maintenance_error,
             i.created_at, i.assistance_needed, i.expense_amount,
             COALESCE(array_length(i.photo_urls, 1), 0) AS photo_count,
             v.plate_number, m.maintenance_id AS linked_maintenance_id,
             m.status AS maintenance_status, m.maintenance_type,
             CASE WHEN d.driver_id IS NULL THEN NULL ELSE
               json_build_object('driver_id', d.driver_id, 'first_name', e.first_name, 'last_name', e.last_name)
             END AS driver
        FROM driverincidents i
        LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        LEFT JOIN vehiclemaintenance m ON m.source_incident_id = i.incident_id AND m.deleted_at IS NULL
        LEFT JOIN drivers d ON d.driver_id = i.driver_id
        LEFT JOIN employees e ON e.employee_id = d.employee_id
       WHERE ${where}
       ORDER BY
      CASE WHEN i.status = 'Open' THEN 0 ELSE 1 END,
      CASE i.severity WHEN 'Critical' THEN 0 WHEN 'Major' THEN 1 WHEN 'Moderate' THEN 2 ELSE 3 END,
      i.created_at DESC, i.incident_date DESC`;

    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "0", 10) || 0, 0), 500);
    if (limit > 0) { sql += ` LIMIT $${params.length + 1}`; params.push(limit); }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
