import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.vehicle_status = 'Available' AND v.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const category_id = searchParams.get("category_id");
    if (category_id) { sql += ` AND v.category_id = $${idx++}`; params.push(+category_id); }

    const min_capacity = searchParams.get("min_capacity");
    if (min_capacity) { sql += ` AND v.seating_capacity >= $${idx++}`; params.push(+min_capacity); }

    const fuel_type = searchParams.get("fuel_type");
    if (fuel_type) { sql += ` AND v.fuel_type = $${idx++}`; params.push(fuel_type); }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
