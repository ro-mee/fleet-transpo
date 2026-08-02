import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject, maintenanceDateRule } from "@/lib/validation/helpers";

const maintenanceWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  maintenance_date: { required: true, type: "date", label: "Maintenance date", validate: maintenanceDateRule },
  maintenance_type: { required: true, maxLength: 50, label: "Type" },
  description: { maxLength: 1000, label: "Description" },
  cost: { type: "positiveNumber", label: "Cost" },
  status: { maxLength: 30, label: "Status" },
  mileage_at_service: { type: "positiveNumber", label: "Mileage at service" },
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage" },
  technician_name: { maxLength: 255, label: "Technician name" },
  service_center_name: { maxLength: 255, label: "Service center" },
  assigned_to: { type: "id", label: "Assigned technician" },
  priority: { maxLength: 30, label: "Priority" },
  completed_date: { type: "date", label: "Completed date" },
  completed_by: { type: "id", label: "Completed by" },
  notes: { maxLength: 1000, label: "Notes" },
};

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT vm.*, row_to_json(v.*) as vehicles
               FROM vehiclemaintenance vm
               LEFT JOIN vehicles v ON vm.vehicle_id = v.vehicle_id
               WHERE vm.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const vehicle_id = searchParams.get("vehicle_id");
    if (vehicle_id) { sql += ` AND vm.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const status = searchParams.get("status");
    if (status) { sql += ` AND vm.status = $${idx++}`; params.push(status); }

    const from_date = searchParams.get("from_date");
    if (from_date) { sql += ` AND vm.maintenance_date >= $${idx++}`; params.push(from_date); }

    const to_date = searchParams.get("to_date");
    if (to_date) { sql += ` AND vm.maintenance_date <= $${idx++}`; params.push(to_date); }

    sql += " ORDER BY vm.maintenance_date DESC";

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "driver"]);
    const body = await parseBody(req);

    const errors = validateBody(body, maintenanceWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const keys = Object.keys(body);
    const values = Object.values(body);
    const cols = keys.join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO vehiclemaintenance (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
    }
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
