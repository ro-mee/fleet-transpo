import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;

    // ailogs is created by migration 034, not per request.
    let sql = `SELECT * FROM ailogs WHERE 1=1`;
    const params = [];
    let idx = 1;

    const status = sp.get("status");
    if (status && status !== "all") {
      sql += ` AND status ILIKE $${idx++}`;
      params.push(status);
    }

    const feature = sp.get("feature");
    if (feature && feature !== "all") {
      sql += ` AND feature_used ILIKE $${idx++}`;
      params.push(feature);
    }

    const search = sp.get("search");
    if (search) {
      sql += ` AND (feature_used ILIKE $${idx} OR provider_name ILIKE $${idx} OR model_name ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    sql += " ORDER BY log_id DESC LIMIT 200";

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
