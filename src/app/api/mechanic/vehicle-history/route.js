import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { normalizeRoleName } from "@/lib/auth/role-names";

// P1b — read-only vehicle history for the mechanic work-order detail page.
//
// A mechanic opening an assigned job sees what the vehicle has been through:
// previous maintenance, recent incidents, recent inspections, and the last
// PMS. All read-only, all lean projections (plate + names only where a
// vehicle object appears at all — this route returns no vehicle row, and the
// maintenance rows carry NO cost, matching the summary convention that cost
// is staff-side).
//
// Gate (fail-closed): the caller must be a mechanic with >= 1 assigned,
// non-deleted work order on THAT vehicle. This prevents both cross-vehicle
// enumeration (guessing vehicle ids) and leaking other mechanics' work: a
// vehicle the caller has never been assigned reads as 403, exactly like an
// unassigned work order id resolves to not-found on the detail page.
// Non-mechanic staff use the existing register/detail surfaces; a 403 here
// for them is correct, not a gap.
const HISTORY_LIMIT = 5;

const MAINTENANCE_SQL = `
  SELECT vm.maintenance_id, vm.maintenance_type, vm.maintenance_date,
         vm.completed_date, vm.status, vm.priority,
         vm.diagnosis, vm.parts_replaced
    FROM vehiclemaintenance vm
   WHERE vm.vehicle_id = $1 AND vm.deleted_at IS NULL
   ORDER BY vm.maintenance_date DESC, vm.maintenance_id DESC
   LIMIT ${HISTORY_LIMIT}
`;

const INCIDENTS_SQL = `
  SELECT i.incident_id, i.incident_type, i.incident_date, i.severity, i.status
    FROM driverincidents i
   WHERE i.vehicle_id = $1 AND i.deleted_at IS NULL
   ORDER BY i.incident_date DESC, i.incident_id DESC
   LIMIT ${HISTORY_LIMIT}
`;

// vehicleinspection carries no deleted_at column (see schema), so there is no
// soft-delete filter here — only the vehicle scope. Findings travel as a
// 200-char excerpt: enough for context, never the full report body.
const INSPECTIONS_SQL = `
  SELECT i.inspection_id, i.inspection_type, i.inspection_date,
         i.status, i.severity, LEFT(i.findings, 200) AS findings_excerpt
    FROM vehicleinspection i
   WHERE i.vehicle_id = $1
   ORDER BY i.inspection_date DESC, i.inspection_id DESC
   LIMIT ${HISTORY_LIMIT}
`;

const LAST_PMS_SQL = `
  SELECT vm.maintenance_id, vm.maintenance_type, vm.maintenance_date, vm.completed_date
    FROM vehiclemaintenance vm
   WHERE vm.vehicle_id = $1 AND vm.deleted_at IS NULL
     AND vm.status = 'Completed' AND vm.maintenance_type = 'Routine'
   ORDER BY COALESCE(vm.completed_date, vm.maintenance_date) DESC, vm.maintenance_id DESC
   LIMIT 1
`;

function shapeMaintenance(r) {
  return {
    maintenance_id: r.maintenance_id,
    maintenance_type: r.maintenance_type,
    maintenance_date: r.maintenance_date,
    completed_date: r.completed_date ?? null,
    status: r.status,
    priority: r.priority,
    diagnosis: r.diagnosis ?? null,
    parts_replaced: r.parts_replaced ?? null,
  };
}

function shapeIncident(r) {
  return {
    incident_id: r.incident_id,
    incident_type: r.incident_type,
    incident_date: r.incident_date,
    severity: r.severity,
    status: r.status,
  };
}

function shapeInspection(r) {
  return {
    inspection_id: r.inspection_id,
    inspection_type: r.inspection_type,
    inspection_date: r.inspection_date,
    status: r.status,
    severity: r.severity ?? null,
    findings_excerpt: r.findings_excerpt ?? null,
  };
}

export async function GET(req) {
  try {
    const session = await requirePermission(req, "maintenance", "read");
    if (normalizeRoleName(session?.user?.role) !== "mechanic") {
      return err("Mechanic vehicle history only.", 403);
    }
    const { searchParams } = new URL(req.url);
    const vehicleId = Number.parseInt(searchParams.get("vehicle_id"), 10);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) {
      return err("vehicle_id must be a positive integer", 400);
    }

    // Ownership first: no assigned non-deleted WO on this vehicle, no history.
    // Unassigned (NULL assignee) rows match nobody — the same fail-closed rule
    // the register and the [id] route enforce.
    const { rows: owned } = await query(
      `SELECT 1 FROM vehiclemaintenance
        WHERE vehicle_id = $1 AND assigned_mechanic_id = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [vehicleId, session.user.employeeId]
    );
    if (!owned[0]) return err("Forbidden", 403);

    const [maintenanceRes, incidentsRes, inspectionsRes, pmsRes, vehicleRes] = await Promise.all([
      query(MAINTENANCE_SQL, [vehicleId]),
      query(INCIDENTS_SQL, [vehicleId]),
      query(INSPECTIONS_SQL, [vehicleId]),
      query(LAST_PMS_SQL, [vehicleId]),
      query(`SELECT last_service_date FROM vehicles WHERE vehicle_id = $1`, [vehicleId]),
    ]);

    const pmsRow = pmsRes.rows[0] ?? null;
    const vehicleDate = vehicleRes.rows[0]?.last_service_date ?? null;
    // Prefer the latest Completed Routine row; fall back to the vehicle's
    // stamped last_service_date; null when neither exists. The `source` field
    // tells the UI which one it is reading.
    const lastPms = pmsRow
      ? {
          maintenance_id: pmsRow.maintenance_id,
          maintenance_date: pmsRow.maintenance_date,
          completed_date: pmsRow.completed_date ?? null,
          source: "routine-record",
        }
      : vehicleDate
        ? {
            maintenance_id: null,
            maintenance_date: vehicleDate,
            completed_date: null,
            source: "vehicle.last_service_date",
          }
        : null;

    return ok({
      maintenance: maintenanceRes.rows.map(shapeMaintenance),
      incidents: incidentsRes.rows.map(shapeIncident),
      inspections: inspectionsRes.rows.map(shapeInspection),
      lastPms,
    });
  } catch (e) { return handleError(e); }
}
