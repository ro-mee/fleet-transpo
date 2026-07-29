import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT * FROM notifications`;
    const params = []; let idx = 1;
    const conditions = [];
    const type = sp.get("type"); if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
    const is_read = sp.get("is_read"); if (is_read !== null && is_read !== undefined) { conditions.push(`is_read = $${idx++}`); params.push(is_read === "true"); }
    if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
    sql += " ORDER BY sent_at DESC LIMIT 50";
    const { rows } = await query(sql, params);
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO notifications (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
