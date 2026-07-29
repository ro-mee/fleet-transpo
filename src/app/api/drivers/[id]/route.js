import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function GET(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const { rows } = await query(`SELECT d.*, row_to_json(e.*) as employees FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_id = $1 AND d.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Driver not found", 404);
    const { rows: stats } = await query(`SELECT * FROM driver_stats WHERE driver_id = $1 LIMIT 1`, [id]);
    return ok({ ...rows[0], ...(stats[0] || {}) });
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`UPDATE drivers SET ${k.map((k,i)=>`${k} = $${i+1}`).join(", ")} WHERE driver_id = $${k.length+1} RETURNING *`, [...v, id]);
    if (!rows[0]) return err("Driver not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
