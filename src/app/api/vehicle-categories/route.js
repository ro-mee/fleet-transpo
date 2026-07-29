import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows } = await query(
      `SELECT * FROM vehiclecategories WHERE status = 'Active' AND deleted_at IS NULL ORDER BY category_name`
    );
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
      `INSERT INTO vehiclecategories (${cols}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
