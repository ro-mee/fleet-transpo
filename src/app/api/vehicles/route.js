import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);

    let sql = `SELECT v.*, row_to_json(vc.*) as vehiclecategories
               FROM vehicles v
               LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
               WHERE v.deleted_at IS NULL`;
    const params = [];
    let idx = 1;

    const status = searchParams.get("status");
    if (status) { sql += ` AND v.vehicle_status = $${idx++}`; params.push(status); }

    const category_id = searchParams.get("category_id");
    if (category_id) { sql += ` AND v.category_id = $${idx++}`; params.push(+category_id); }

    const branch_id = searchParams.get("branch_id");
    if (branch_id) { sql += ` AND v.branch_id = $${idx++}`; params.push(+branch_id); }

    const search = searchParams.get("search");
    if (search) {
      sql += ` AND (v.plate_number ILIKE $${idx} OR v.vehicle_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += " ORDER BY v.vehicle_id DESC";

    const page = parseInt(searchParams.get("page"));
    const pageSize = parseInt(searchParams.get("pageSize"));
    if (page && pageSize) {
      sql += ` LIMIT $${idx++} OFFSET $${idx++}`;
      params.push(pageSize, (page - 1) * pageSize);
    }

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
      `INSERT INTO vehicles (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
