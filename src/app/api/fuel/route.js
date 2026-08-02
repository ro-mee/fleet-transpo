import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";

const fuelWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  driver_id: { type: "id", label: "Driver" },
  fuel_date: { required: true, type: "date", label: "Fuel date" },
  fuel_type: { required: true, maxLength: 50, label: "Fuel type" },
  liters: { required: true, type: "positiveNumber", label: "Liters" },
  cost_per_liter: { type: "positiveNumber", label: "Cost per liter" },
  total_cost: { required: true, type: "positiveNumber", label: "Total cost" },
  odometer_reading: { type: "positiveNumber", label: "Odometer reading" },
  station_name: { maxLength: 255, label: "Station name" },
  status: { maxLength: 30, label: "Status" },
  notes: { maxLength: 500, label: "Notes" },
  receipt_image_url: { maxLength: 2000, label: "Receipt image" },
  reimbursement_status: { maxLength: 30, label: "Reimbursement status" },
  paid_by: { maxLength: 100, label: "Paid by" },
  payment_method: { maxLength: 50, label: "Payment method" },
  submitted_at: { type: "date", label: "Submitted at" },
  approved_by: { type: "id", label: "Approved by" },
  rejected_reason: { maxLength: 500, label: "Rejection reason" },
};

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;

    let sql = `
      SELECT 
        fr.*,
        row_to_json(v.*) as vehicles,
        json_build_object(
          'driver_id', d.driver_id,
          'license_number', d.license_number,
          'employees', row_to_json(e.*)
        ) as drivers
      FROM fuelrecords fr
      LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id
      LEFT JOIN drivers d ON fr.driver_id = d.driver_id
      LEFT JOIN employees e ON d.employee_id = e.employee_id
      WHERE fr.deleted_at IS NULL
    `;
    const params = [];
    let idx = 1;

    const vehicle_id = sp.get("vehicle_id");
    if (vehicle_id) { sql += ` AND fr.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const driver_id = sp.get("driver_id");
    if (driver_id) { sql += ` AND fr.driver_id = $${idx++}`; params.push(+driver_id); }

    const fuel_type = sp.get("fuel_type");
    if (fuel_type) { sql += ` AND fr.fuel_type = $${idx++}`; params.push(fuel_type); }

    const status = sp.get("status");
    if (status && status !== "all") {
      sql += ` AND fr.status ILIKE $${idx++}`;
      params.push(status);
    }

    const search = sp.get("search");
    if (search) {
      sql += ` AND (v.plate_number ILIKE $${idx} OR fr.station_name ILIKE $${idx} OR e.first_name ILIKE $${idx} OR e.last_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const fd = sp.get("from_date");
    if (fd) { sql += ` AND fr.fuel_date >= $${idx++}`; params.push(fd); }

    const td = sp.get("to_date");
    if (td) { sql += ` AND fr.fuel_date <= $${idx++}`; params.push(td); }

    sql += " ORDER BY fr.fuel_record_id DESC";

    const page = parseInt(sp.get("page"));
    const ps = parseInt(sp.get("pageSize"));
    if (page && ps) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(ps, (page - 1) * ps);
    }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "driver"]);
    const body = await parseBody(req);

    const errors = validateBody(body, fuelWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const k = Object.keys(body);
    const v = Object.values(body);
    const { rows } = await query(
      `INSERT INTO fuelrecords (${k.join(", ")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      v
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
