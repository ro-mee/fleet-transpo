import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

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
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body);
    const v = Object.values(body);
    const { rows } = await query(
      `INSERT INTO fuelrecords (${k.join(", ")}) VALUES (${k.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING *`,
      v
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
