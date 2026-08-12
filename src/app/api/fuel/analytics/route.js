import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// pg returns DATE columns as JS Date objects (local time), not strings — the
// previous `r.fuel_date?.substring(0, 7)` crashed with a TypeError the moment
// any Approved record existed. Build the YYYY-MM key from local components so
// the month grouping is timezone-safe, and fall back to "Unknown" for a null.
const monthKey = (d) => {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(d ?? "").slice(0, 7) || "Unknown";
};

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows: records } = await query(`SELECT fuel_type, liters, amount, price_per_liter, fuel_date, odometer FROM fuelrecords WHERE deleted_at IS NULL AND status = 'Approved' ORDER BY fuel_date DESC`);
    if (!records?.length) return ok({ totalCost: 0, totalLiters: 0, avgCostPerLiter: 0, recordsCount: 0, byFuelType: [], monthlyTrend: [] });
    // Number() is load-bearing for the same reason monthKey exists above: pg
    // hands back `liters`/`amount` (numeric) as strings, so a bare + concatenates
    // rather than adds, and avgCostPerLiter falls out as NaN.
    const totalCost = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalLiters = records.reduce((s, r) => s + (Number(r.liters) || 0), 0);
    const avgCostPerLiter = totalLiters ? totalCost / totalLiters : 0;
    const fuelTypeMap = {};
    records.forEach(r => { const t = r.fuel_type || "Unknown"; if (!fuelTypeMap[t]) fuelTypeMap[t] = { fuel_type: t, liters: 0, cost: 0, count: 0 }; fuelTypeMap[t].liters += Number(r.liters) || 0; fuelTypeMap[t].cost += Number(r.amount) || 0; fuelTypeMap[t].count += 1; });
    const monthlyMap = {};
    records.forEach(r => { const m = monthKey(r.fuel_date); if (!monthlyMap[m]) monthlyMap[m] = { month: m, cost: 0, liters: 0, count: 0 }; monthlyMap[m].cost += Number(r.amount) || 0; monthlyMap[m].liters += Number(r.liters) || 0; monthlyMap[m].count += 1; });
    return ok({ totalCost, totalLiters, avgCostPerLiter, recordsCount: records.length, byFuelType: Object.values(fuelTypeMap), monthlyTrend: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)) });
  } catch (e) { return handleError(e); }
}
