import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    const { rows: records } = await query(`SELECT fuel_date, amount, liters, fuel_type, vehicle_id, row_to_json(v.*) as vehicles FROM fuelrecords LEFT JOIN vehicles v ON fuelrecords.vehicle_id = v.vehicle_id WHERE fuel_date >= $1 AND fuel_date <= $2 ORDER BY fuel_date DESC`, [from, to]);
    if (!records?.length) return ok({ totalLiters: 0, totalCost: 0, avgCost: 0, byVehicle: [], monthlyData: [] });
    const totalLiters = records.reduce((s, r) => s + (r.liters || 0), 0);
    const totalCost = records.reduce((s, r) => s + (r.amount || 0), 0);
    const monthlyMap = {};
    records.forEach(r => { const m = (r.fuel_date || "").substring(0, 7); if (!m) return; if (!monthlyMap[m]) monthlyMap[m] = { month: m, liters: 0, cost: 0 }; monthlyMap[m].liters += r.liters || 0; monthlyMap[m].cost += r.amount || 0; });
    return ok({ totalLiters, totalCost, avgCost: totalLiters ? totalCost / totalLiters : 0, byVehicle: [], monthlyData: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)) });
  } catch (e) { return handleError(e); }
}
