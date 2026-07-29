import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT * FROM integration_log`;
    const conditions = []; const params = []; let idx = 1;
    for (const key of ["status","direction","source_system","event_type","external_booking_id"]) { const v = sp.get(key); if (v) { conditions.push(`${key} = $${idx++}`); params.push(v); } }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY created_at DESC";
    const limit = sp.get("limit"); if (limit) { sql += ` LIMIT $${idx++}`; params.push(+limit); }
    const { rows } = await query(sql, params);
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const entry = { ...body, status: "pending" };
    const k = Object.keys(entry), v = Object.values(entry);
    const { rows } = await query(`INSERT INTO integration_log (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
