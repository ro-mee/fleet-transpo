import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    const { rows: trips } = await query(`SELECT distance FROM trips WHERE start_time >= $1 AND start_time <= $2`, [from, to]);
    const { rows: fuel } = await query(`SELECT amount, liters FROM fuelrecords WHERE fuel_date >= $1 AND fuel_date <= $2`, [from, to]);
    const { rows: maintenance } = await query(`SELECT cost FROM vehiclemaintenance WHERE maintenance_date >= $1 AND maintenance_date <= $2`, [from, to]);
    const fuelCost = (fuel || []).reduce((s, f) => s + (f.amount || 0), 0);
    const maintCost = (maintenance || []).reduce((s, m) => s + (m.cost || 0), 0);
    const totalDist = (trips || []).reduce((s, t) => s + (t.distance || 0), 0);
    return ok({ fuelCost, maintCost, totalCost: fuelCost + maintCost, totalDistance: totalDist, costPerKm: totalDist ? (fuelCost + maintCost) / totalDist : 0 });
  } catch (e) { return handleError(e); }
}
