import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

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
    await requireAuth(req);
    const body = await parseBody(req);
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
