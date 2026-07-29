import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT fr.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers FROM fuelrecords fr LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON fr.driver_id = d.driver_id WHERE fr.deleted_at IS NULL`;
    const params = []; let idx = 1;
    for (const [key, col] of [["vehicle_id","vehicle_id"],["driver_id","driver_id"],["fuel_type","fuel_type"]]) { const v = sp.get(key); if (v) { sql += ` AND fr.${col} = $${idx++}`; params.push(v); } }
    const fd = sp.get("from_date"); if (fd) { sql += ` AND fr.fuel_date >= $${idx++}`; params.push(fd); }
    const td = sp.get("to_date"); if (td) { sql += ` AND fr.fuel_date <= $${idx++}`; params.push(td); }
    sql += " ORDER BY fr.fuel_date DESC";
    const page = parseInt(sp.get("page")), ps = parseInt(sp.get("pageSize"));
    if (page && ps) { sql += ` LIMIT $${idx++} OFFSET $${idx++}`; params.push(ps, (page-1)*ps); }
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO fuelrecords (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
