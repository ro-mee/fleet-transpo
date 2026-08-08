import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows: activeTrips } = await query(`SELECT trip_id, vehicle_id, driver_id, trip_status FROM trips WHERE trip_status IN ('Trip Started','En Route','Arrived')`);
    if (!activeTrips?.length) return ok([]);
    const ids = activeTrips.map(t => t.vehicle_id);
    try {
      const { rows } = await query(`SELECT * FROM get_latest_vehicle_locations($1::int[])`, [ids]);
      const statusById = new Map(activeTrips.map(t => [t.vehicle_id, t.trip_status]));
      return ok(rows.map(r => ({ ...r, trip_status: statusById.get(r.vehicle_id) ?? null })));
    } catch {
      const { rows: fallback } = await query(`SELECT DISTINCT ON (g.vehicle_id) g.*, row_to_json(v.*) as vehicles FROM gpstracking g LEFT JOIN vehicles v ON g.vehicle_id = v.vehicle_id WHERE g.vehicle_id = ANY($1::int[]) ORDER BY g.vehicle_id, g.recorded_at DESC`, [ids]);
      const statusById = new Map(activeTrips.map(t => [t.vehicle_id, t.trip_status]));
      return ok(fallback.map(r => ({ ...r, trip_status: statusById.get(r.vehicle_id) ?? null })));
    }
  } catch (e) { return handleError(e); }
}
