import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { resolveDriverScope } from "@/lib/api/ownership";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { writeAudit } from "@/lib/audit";

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

const fuelWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  driver_id: { type: "id", label: "Driver" },
  trip_id: { type: "id", label: "Trip" },
  fuel_date: { required: true, type: "date", label: "Fuel date" },
  fuel_type: { required: true, maxLength: 50, label: "Fuel type" },
  liters: { required: true, type: "positiveNumber", label: "Liters" },
  amount: { required: true, type: "positiveNumber", label: "Total amount" },
  price_per_liter: { type: "positiveNumber", label: "Price per liter" },
  odometer: { type: "positiveNumber", label: "Odometer" },
  station_name: { maxLength: 255, label: "Station name" },
  status: { maxLength: 30, label: "Status" },
  receipt_url: { maxLength: 2000, label: "Receipt image" },
};

export async function GET(req) {
  try {
    const session = await requireAuth(req, ROLES);
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

    const driver_id = resolveDriverScope(session, sp.get("driver_id"));
    if (driver_id !== null) { sql += ` AND fr.driver_id = $${idx++}`; params.push(driver_id); }

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

const WRITABLE_COLUMNS = [
  "vehicle_id",
  "station_name",
  "trip_id",
  "liters",
  "amount",
  "price_per_liter",
  "odometer",
  "fuel_type",
  "fuel_date",
  "receipt_url",
  "status",
];

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "driver"]);
    const body = await parseBody(req);

    const errors = validateBody(body, fuelWriteSchema);
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const columns = [];
    const values = [];
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }

    if (!body.vehicle_id) return err("vehicle_id is required", 400);
    if (body.liters === undefined) return err("liters is required", 400);
    if (body.amount === undefined && body.total_cost === undefined) return err("amount/total_cost is required", 400);
    if (!body.fuel_date) return err("fuel_date is required", 400);

    if (body.odometer !== undefined) {
      const { rows: vehicleRows } = await query(
        `SELECT mileage FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [body.vehicle_id]
      );
      const odo = validateOdometerReading({
        reading: body.odometer,
        currentMileage: vehicleRows[0]?.mileage,
      });
      if (!odo.ok) return err(odo.error, 400);
    }

    columns.push("driver_id");
    values.push(
      session.user.role === "driver"
        ? session.user.driverId
        : body.driver_id ?? null
    );

    columns.push("created_by");
    values.push(session.user.employeeId);

    if (body.status === undefined) {
      columns.push("status");
      values.push("Pending");
    }

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO fuelrecords (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await writeAudit(req, session, { action: "create", resource: "fuelrecords", resourceId: rows[0]?.fuel_record_id, newValues: rows[0] });
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
