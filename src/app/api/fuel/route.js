import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { resolveDriverScope } from "@/lib/api/ownership";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { writeAudit } from "@/lib/audit";

export const dynamic = 'force-dynamic';

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

// Lean projection for the audit table (paginated mode). Only the columns the
// fuel review page renders + the join fields it needs, instead of `fr.*` and
// full `row_to_json(v.*)` / `row_to_json(e.*)`.
const FUEL_LIST_SELECT = `
  fr.fuel_record_id, fr.fuel_date, fr.fuel_type, fr.receipt_fuel_type, fr.liters, fr.amount,
  fr.price_per_liter, fr.odometer, fr.station_name, fr.status,
  fr.receipt_url, fr.rejection_reason, fr.created_at,
  fr.receipt_scan_data, fr.flags, fr.receipt_transaction_id,
  CASE WHEN v.vehicle_id IS NULL THEN NULL ELSE
    json_build_object(
      'plate_number', v.plate_number,
      'vehicle_name', v.vehicle_name,
      'fuel_type', v.fuel_type,
      'fuel_level', v.fuel_level,
      'tank_capacity_l', v.tank_capacity_l,
      'mileage', v.mileage
    )
  END AS vehicles,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object('driver_id', d.driver_id, 'license_number', d.license_number,
      'employees', json_build_object('first_name', e.first_name, 'last_name', e.last_name))
  END AS drivers
`;

const FUEL_FROM = `
  FROM fuelrecords fr
  LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id
  LEFT JOIN drivers d ON fr.driver_id = d.driver_id
  LEFT JOIN employees e ON d.employee_id = e.employee_id
`;

// Whitelist of sortable columns for the audit table.
const FUEL_SORTABLE = {
  fuel_record_id: "fr.fuel_record_id",
  fuel_date: "fr.fuel_date",
  fuel_type: "fr.fuel_type",
  liters: "fr.liters",
  amount: "fr.amount",
  station_name: "fr.station_name",
  status: "fr.status",
};

// Stat-card totals, computed server-side so the audit page never needs the whole
// set. "Approved" bucket includes completed; approved_cost = sum of those amounts.
const FUEL_COUNTS_SQL = `
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE LOWER(fr.status) = 'pending') AS pending,
    count(*) FILTER (WHERE LOWER(fr.status) IN ('approved','completed')) AS approved,
    count(*) FILTER (WHERE LOWER(fr.status) = 'rejected') AS rejected,
    COALESCE(SUM(fr.amount) FILTER (WHERE LOWER(fr.status) IN ('approved','completed')), 0) AS approved_cost
  FROM fuelrecords fr WHERE fr.deleted_at IS NULL
`;

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

    let where = " WHERE fr.deleted_at IS NULL";
    const params = [];
    let idx = 1;

    const vehicle_id = sp.get("vehicle_id");
    if (vehicle_id) { where += ` AND fr.vehicle_id = $${idx++}`; params.push(+vehicle_id); }

    const driver_id = resolveDriverScope(session, sp.get("driver_id"));
    if (driver_id !== null) { where += ` AND fr.driver_id = $${idx++}`; params.push(driver_id); }

    const fuel_type = sp.get("fuel_type");
    if (fuel_type) { where += ` AND fr.fuel_type = $${idx++}`; params.push(fuel_type); }

    // Status filter. The audit "Approved" tab also covers Completed claims.
    const status = sp.get("status");
    if (status && status !== "all") {
      if (status.toLowerCase() === "approved") {
        where += ` AND (LOWER(fr.status) = 'approved' OR LOWER(fr.status) = 'completed')`;
      } else {
        where += ` AND LOWER(fr.status) = $${idx++}`;
        params.push(status.toLowerCase());
      }
    }

    const search = sp.get("search");
    if (search) {
      where += ` AND (v.plate_number ILIKE $${idx} OR fr.station_name ILIKE $${idx} OR e.first_name ILIKE $${idx} OR e.last_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const fd = sp.get("from_date");
    if (fd) { where += ` AND fr.fuel_date >= $${idx++}`; params.push(fd); }

    const td = sp.get("to_date");
    if (td) { where += ` AND fr.fuel_date <= $${idx++}`; params.push(td); }

    const page = parseInt(sp.get("page"));
    const ps = parseInt(sp.get("pageSize"));
    if (page && ps) {
      // Paginated mode: lean projection + sort + server totals/counts. Returns
      // `{ rows, total, counts }` so the table + stat cards don't need the set.
      const whereCount = params.length;
      const sort = sp.get("sort");
      const sortDir = (sp.get("sortDir") || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
      const orderBy = sort && FUEL_SORTABLE[sort]
        ? ` ORDER BY ${FUEL_SORTABLE[sort]} ${sortDir}`
        : " ORDER BY fr.fuel_record_id DESC";

      const [rowsRes, totalRes, countsRes] = await Promise.all([
        query(
          `SELECT ${FUEL_LIST_SELECT} ${FUEL_FROM} ${where} ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, ps, (page - 1) * ps]
        ),
        query(`SELECT count(*) AS total ${FUEL_FROM} ${where}`, params.slice(0, whereCount)),
        query(FUEL_COUNTS_SQL),
      ]);

      const c = countsRes.rows[0] || {};
      return ok({
        rows: rowsRes.rows,
        total: Number(totalRes.rows[0]?.total) || 0,
        page,
        pageSize: ps,
        counts: {
          total: Number(c.total) || 0,
          pending: Number(c.pending) || 0,
          approved: Number(c.approved) || 0,
          rejected: Number(c.rejected) || 0,
          approvedCost: Number(c.approved_cost) || 0,
        },
      });
    }

    // Non-paginated: full array (driver page, dropdowns).
    const { rows } = await query(
      `SELECT fr.*,
         row_to_json(v.*) as vehicles,
         json_build_object(
           'driver_id', d.driver_id,
           'license_number', d.license_number,
           'employees', row_to_json(e.*)
         ) as drivers
       ${FUEL_FROM} ${where} ORDER BY fr.fuel_record_id DESC`,
      params
    );
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

    // Fuel records always start as Pending. status is intentionally NOT a
    // writable column here — letting callers set it would let a driver
    // self-approve their own claim. Review happens via PUT /api/fuel/[id].
    columns.push("status");
    values.push("Pending");

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO fuelrecords (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await writeAudit(req, session, { action: "create", resource: "fuelrecords", resourceId: rows[0]?.fuel_record_id, newValues: rows[0] });
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
