import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    const { rows: trips } = await query(`SELECT start_time, end_time, distance, trip_status, vehicle_id, row_to_json(v.*) as vehicles FROM trips LEFT JOIN vehicles v ON trips.vehicle_id = v.vehicle_id WHERE start_time >= $1 AND start_time <= $2 ORDER BY start_time DESC`, [from, to]);
    const { rows: vehicles } = await query(`SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE deleted_at IS NULL`);
    const total = (vehicles || []).length;
    const active = (vehicles || []).filter(v => v.vehicle_status === "In Use").length;
    const byVehicle = (trips || []).reduce((acc, t) => { const p = t.vehicles?.plate_number || "Unknown"; const e = acc.find(a => a.plate === p); if (e) { e.trips++; e.distance += t.distance || 0; } else acc.push({ plate: p, trips: 1, distance: t.distance || 0 }); return acc; }, []);
    return ok({ utilization: total ? Math.round((active/total)*100) : 0, totalTrips: (trips||[]).length, totalDistance: (trips||[]).reduce((s,t)=>s+(t.distance||0),0), byVehicle });
  } catch (e) { return handleError(e); }
}
