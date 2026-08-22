import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    // start_time is a timestamptz, so `<= $2` truncates `to` to midnight and
    // drops the last day. Closed-open range, like fleet-cost.
    const { rows: trips } = await query(`SELECT trips.start_time, trips.end_time, trips.distance, trips.trip_status, trips.vehicle_id, row_to_json(v.*) as vehicles FROM trips LEFT JOIN vehicles v ON trips.vehicle_id = v.vehicle_id WHERE trips.start_time >= $1::date AND trips.start_time < ($2::date + 1) ORDER BY trips.start_time DESC`, [from, to]);
    const { rows: vehicles } = await query(`SELECT vehicle_id, plate_number, vehicle_status FROM vehicles WHERE deleted_at IS NULL`);
    const total = (vehicles || []).length;
    const active = (vehicles || []).filter(v => v.vehicle_status === "In Use").length;
    // Number(): pg returns `distance` (numeric) as a string. Without this the
    // per-vehicle distance concatenated ("05.204.80") and totalDistance with it.
    const byVehicle = (trips || []).reduce((acc, t) => { const p = t.vehicles?.plate_number || "Unknown"; const d = Number(t.distance) || 0; const e = acc.find(a => a.plate === p); if (e) { e.trips++; e.distance += d; } else acc.push({ plate: p, trips: 1, distance: d }); return acc; }, []);
    return ok({ utilization: total ? Math.round((active / total) * 100) : 0, totalTrips: (trips || []).length, totalDistance: (trips || []).reduce((s, t) => s + (Number(t.distance) || 0), 0), byVehicle });
  } catch (e) { return handleError(e); }
}
