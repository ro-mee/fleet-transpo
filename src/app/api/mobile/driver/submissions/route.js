import { query } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";

/**
 * GET /api/mobile/driver/submissions
 * 
 * Fetches the driver's past submissions (Incident Reports and Fuel Logs).
 * Merges them into a unified list sorted by date descending.
 */
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    
    // Resolve driver ID
    const { rows: driverRows } = await query(
      `SELECT d.driver_id
         FROM employees e
         JOIN drivers d ON d.employee_id = e.employee_id AND d.deleted_at IS NULL
        WHERE e.employee_id = $1 AND e.deleted_at IS NULL LIMIT 1`,
      [session.user.employeeId]
    );
    const driverId = driverRows[0]?.driver_id;
    if (!driverId) return err("No driver record is linked to this account", 403);

    // Fetch Incidents
    const { rows: incidents } = await query(
      `SELECT i.incident_id as id, i.incident_type as type, i.incident_date as date,
              i.status, i.severity, i.description, i.actions_taken, i.created_at,
              i.acknowledged_at, i.resolved_at, i.response_status, v.plate_number
         FROM driverincidents i
         LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
        WHERE i.driver_id = $1 AND i.deleted_at IS NULL
        ORDER BY i.incident_date DESC
        LIMIT 50`,
      [driverId]
    );

    // Fetch Fuel Logs
    const { rows: fuelLogs } = await query(
      `SELECT f.fuel_record_id as id, 'Fuel Log' as type, f.fuel_date as date, 
              f.status, f.amount, f.liters, f.station_name, f.created_at, f.rejection_reason, v.plate_number
         FROM fuelrecords f
         LEFT JOIN vehicles v ON v.vehicle_id = f.vehicle_id
        WHERE f.driver_id = $1 AND f.deleted_at IS NULL
        ORDER BY f.fuel_date DESC
        LIMIT 50`,
      [driverId]
    );

    // Merge and map
    const submissions = [
      ...incidents.map(i => ({
        id: `inc_${i.id}`,
        category: "Incident",
        title: i.type,
        date: i.date,
        status: i.status || "Open",
        description: i.description,
        actions_taken: i.actions_taken,
        acknowledged_at: i.acknowledged_at,
        resolved_at: i.resolved_at,
        response_status: i.response_status,
        amount: null,
        plate_number: i.plate_number,
        created_at: i.created_at,
        severity: i.severity
      })),
      ...fuelLogs.map(f => ({
        id: String(f.id),
        category: "Fuel",
        title: f.station_name || "Fuel Purchase",
        date: f.date,
        status: f.status || "Pending",
        description: f.rejection_reason ? `Rejected: ${f.rejection_reason}` : `${f.liters}L at ${f.station_name}`,
        amount: f.amount,
        plate_number: f.plate_number,
        created_at: f.created_at,
        severity: null,
        rejection_reason: f.rejection_reason
      }))
    ];

    // Sort descending by date, then created_at
    submissions.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateB !== dateA) return dateB - dateA;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return ok(submissions);
  } catch (e) {
    return handleError(e);
  }
}
