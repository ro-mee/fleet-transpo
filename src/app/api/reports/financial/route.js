import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    // start_time is a timestamptz, so `<= $2` would compare against midnight on
    // `to` and silently drop the last day. Closed-open range, like fleet-cost.
    const { rows: trips } = await query(`SELECT distance FROM trips WHERE start_time >= $1::date AND start_time < ($2::date + 1)`, [from, to]);
    const { rows: fuel } = await query(`SELECT amount, liters FROM fuelrecords WHERE fuel_date >= $1 AND fuel_date <= $2`, [from, to]);
    const { rows: maintenance } = await query(`SELECT cost FROM vehiclemaintenance WHERE maintenance_date >= $1 AND maintenance_date <= $2`, [from, to]);
    // Number() is load-bearing: pg returns numeric/decimal columns as strings,
    // so `s + f.amount` concatenates instead of adding — the totals came back as
    // "01.001000.00500.00" and costPerKm as NaN. See the same guard in
    // reports/fuel-consumption and reports/fleet-cost.
    const fuelCost = (fuel || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
    const maintCost = (maintenance || []).reduce((s, m) => s + (Number(m.cost) || 0), 0);
    const totalDist = (trips || []).reduce((s, t) => s + (Number(t.distance) || 0), 0);
    return ok({ fuelCost, maintCost, totalCost: fuelCost + maintCost, totalDistance: totalDist, costPerKm: totalDist ? (fuelCost + maintCost) / totalDist : 0 });
  } catch (e) { return handleError(e); }
}
