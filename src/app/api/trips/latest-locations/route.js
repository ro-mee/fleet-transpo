import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    
    // First, find out which vehicles are on active trips so we can attach their status
    const { rows: activeTrips } = await query(`
      SELECT trip_id, vehicle_id, driver_id, trip_status 
      FROM trips 
      WHERE trip_status IN ('Driver Accepted','Trip Started','At Pickup','Passenger Onboard','En Route','Drop-off','Arrived','In Progress')
    `);
    
    // Then get ALL vehicles from the tracking table that have pinged in the last 24h
    // This allows fleet managers to see idle/available drivers on the map too!
    const { rows: liveVehicles } = await query(`
      SELECT DISTINCT ON (vehicle_id) vehicle_id
      FROM gpstracking
      WHERE recorded_at >= NOW() - INTERVAL '24 hours'
    `);
    
    const ids = liveVehicles.map(v => v.vehicle_id);
    if (!ids.length) return ok([]);
    
    const statusById = new Map(activeTrips.map(t => [t.vehicle_id, t.trip_status]));
    
    try {
      const { rows } = await query(`SELECT * FROM get_latest_vehicle_locations($1::int[])`, [ids]);
      return ok(rows.map(r => ({ ...r, trip_status: statusById.get(r.vehicle_id) ?? null })));
    } catch {
      const { rows: fallback } = await query(`
        SELECT DISTINCT ON (g.vehicle_id) g.*, row_to_json(v.*) as vehicles 
        FROM gpstracking g 
        LEFT JOIN vehicles v ON g.vehicle_id = v.vehicle_id 
        WHERE g.vehicle_id = ANY($1::int[]) 
        ORDER BY g.vehicle_id, g.recorded_at DESC
      `, [ids]);
      return ok(fallback.map(r => ({ ...r, trip_status: statusById.get(r.vehicle_id) ?? null })));
    }
  } catch (e) { return handleError(e); }
}
