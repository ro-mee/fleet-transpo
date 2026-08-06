import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);

    const { rows } = await query(
      `SELECT location_id, name, address, latitude, longitude, created_at
         FROM locations
        ORDER BY name ASC`
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
