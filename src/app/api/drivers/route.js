import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { searchParams } = new URL(req.url);
    let sql = `SELECT d.*, row_to_json(e.*) as employees FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.deleted_at IS NULL`;
    const params = []; let idx = 1;
    const status = searchParams.get("status"); if (status) { sql += ` AND d.driver_status = $${idx++}`; params.push(status); }
    const search = searchParams.get("search"); if (search) { sql += ` AND d.license_number ILIKE $${idx++}`; params.push(`%${search}%`); }
    sql += " ORDER BY d.created_at DESC";
    const page = parseInt(searchParams.get("page")); const ps = parseInt(searchParams.get("pageSize"));
    if (page && ps) { sql += ` LIMIT $${idx++} OFFSET $${idx++}`; params.push(ps, (page-1)*ps); }
    const { rows: data } = await query(sql, params);
    if (!data.length) return ok([]);
    const ids = data.map(d => d.driver_id);
    const { rows: stats } = await query(`SELECT * FROM driver_stats WHERE driver_id = ANY($1::int[])`, [ids]);
    const m = {}; stats.forEach(s => { m[s.driver_id] = s; });
    return ok(data.map(d => ({ ...d, ...m[d.driver_id] || {} })));
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO drivers (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
