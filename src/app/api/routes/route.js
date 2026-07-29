import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT r.*, row_to_json(ol.*) as origin_location, row_to_json(dl.*) as destination_location FROM routes r LEFT JOIN locations ol ON r.origin_location_id = ol.location_id LEFT JOIN locations dl ON r.destination_location_id = dl.location_id WHERE r.deleted_at IS NULL AND r.status = 'Active'`;
    const params = []; let idx = 1;
    const search = sp.get("search"); if (search) { sql += ` AND (r.route_name ILIKE $${idx} OR r.origin ILIKE $${idx} OR r.destination ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += " ORDER BY r.route_name";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    await requireAuth(req);
    const body = await parseBody(req);
    const k = Object.keys(body), v = Object.values(body);
    const { rows } = await query(`INSERT INTO routes (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
