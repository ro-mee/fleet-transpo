import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const type = new URL(req.url).searchParams.get("type");
    if (type) {
      const { rows } = await query(`SELECT * FROM ai_recommendations WHERE recommendation_type = $1 ORDER BY created_at DESC LIMIT 20`, [type]);
      return ok(rows || []);
    }
    const { rows } = await query(`SELECT * FROM ai_recommendations ORDER BY created_at DESC LIMIT 20`);
    return ok(rows || []);
  } catch (e) { return handleError(e); }
}
