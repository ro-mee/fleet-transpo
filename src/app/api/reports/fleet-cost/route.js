import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01";
    const to = sp.get("to") || "2100-01-01";
    const { rows } = await query(
      `SELECT v.vehicle_id, v.plate_number, COALESCE(v.vehicle_name,'') AS vehicle_name, COALESCE(v.manufacturer,'') AS manufacturer, COALESCE(v.model,'') AS model,
              COALESCE(SUM(f.amount), 0) AS fuel_cost,
              COALESCE(SUM(m.cost), 0) AS maintenance_cost,
              COALESCE(SUM(t.distance), 0) AS distance
         FROM vehicles v
         LEFT JOIN fuelrecords f ON f.vehicle_id = v.vehicle_id
           AND f.fuel_date >= $1 AND f.fuel_date <= $2
         LEFT JOIN vehiclemaintenance m ON m.vehicle_id = v.vehicle_id
           AND m.maintenance_date >= $1 AND m.maintenance_date <= $2
         LEFT JOIN trips t ON t.vehicle_id = v.vehicle_id
           AND t.start_time >= $1 AND t.start_time <= $2
           AND t.deleted_at IS NULL
        WHERE v.deleted_at IS NULL
        GROUP BY v.vehicle_id, v.plate_number, v.vehicle_name, v.manufacturer, v.model
        ORDER BY v.plate_number`,
      [from, to]
    );
    const details = rows.map((r) => {
      const fuel = Number(r.fuel_cost) || 0;
      const maint = Number(r.maintenance_cost) || 0;
      const dist = Number(r.distance) || 0;
      const totalCost = fuel + maint;
      return {
        vehicle_id: r.vehicle_id,
        plate_number: r.plate_number,
        vehicle: `${r.manufacturer} ${r.model} ${r.vehicle_name}`.trim(),
        fuel_cost: fuel,
        maintenance_cost: maint,
        total_cost: totalCost,
        distance: dist,
        cost_per_km: dist ? totalCost / dist : 0,
      };
    });
    const totals = details.reduce(
      (s, d) => ({
        fuel_cost: s.fuel_cost + d.fuel_cost,
        maintenance_cost: s.maintenance_cost + d.maintenance_cost,
        total_cost: s.total_cost + d.total_cost,
        distance: s.distance + d.distance,
      }),
      { fuel_cost: 0, maintenance_cost: 0, total_cost: 0, distance: 0 }
    );
    return ok({ details, totals: { ...totals, cost_per_km: totals.distance ? totals.total_cost / totals.distance : 0 } });
  } catch (e) { return handleError(e); }
}
