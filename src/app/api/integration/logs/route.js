import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

// Client-writable columns for integration_log. Column names are never taken
// from the request body — that would allow SQL injection via crafted keys.
const LOG_WRITABLE = [
  "direction",
  "source_system",
  "event_type",
  "reference_type",
  "reference_id",
  "external_booking_id",
  "payload",
  "error_message",
  "processed_at",
];

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
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);
    const columns = [];
    const values = [];
    for (const key of LOG_WRITABLE) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    columns.push("status");
    values.push("pending");
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(`INSERT INTO integration_log (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`, values);
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
