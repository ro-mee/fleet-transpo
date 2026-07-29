import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows } = await query(
      `SELECT * FROM branches WHERE deleted_at IS NULL ORDER BY branch_name`
    );
    return ok(rows);
  } catch (e) { return handleError(e); }
}
