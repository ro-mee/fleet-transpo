import { query } from "@/lib/db";
import { requireDriver, ok, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";

// A driver's own trips, always scoped to the authenticated driver_id. This is a
// dedicated endpoint rather than a filter on /api/trips because that list route
// applies no ownership scope — a driver hitting it would read the whole fleet's
// trip history. Reuses the same SELECT/JOIN pair as the staff views so a trip
// row reads identically everywhere.
export async function GET(req) {
  try {
    const session = await requireDriver(req);

    const sp = new URL(req.url).searchParams;
    let sql = `${TRIPS_SELECT} ${TRIPS_JOINS}
      WHERE t.driver_id = $1 AND t.deleted_at IS NULL`;
    const params = [session.user.driverId];
    let idx = 2;

    const status = sp.get("status") || sp.get("trip_status");
    if (status) { sql += ` AND t.trip_status = $${idx++}`; params.push(status); }

    sql += " ORDER BY t.created_at DESC";
    const limit = Math.min(Math.max(parseInt(sp.get("limit") || "0", 10) || 0, 0), 500);
    if (limit > 0) { sql += ` LIMIT $${idx++}`; params.push(limit); }

    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}
