import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    const session = await requireAuth(req);
    const includeInactive = new URL(req.url).searchParams.get("include_inactive") === "true";
    const canSeeInactive = ["system_admin", "admin"].includes(session.user.role);

    const { rows } = await query(
      `SELECT location_id, name, address, latitude, longitude, created_at
         FROM locations
        ${includeInactive && canSeeInactive ? "" : "WHERE is_active = true"}
        ORDER BY name ASC`
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
