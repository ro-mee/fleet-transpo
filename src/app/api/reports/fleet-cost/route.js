import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01";
    const to = sp.get("to") || "2100-01-01";
    // Three correlated subqueries, not three LEFT JOINs.
    //
    // Joining fuelrecords, vehiclemaintenance and trips onto the same vehicle
    // row multiplies them: a vehicle with F fuel rows, M maintenance rows and T
    // trips produces F×M×T result rows, so SUM(f.amount) came back as the real
    // total times M×T. With the demo data (7 fuel, 3 maintenance, 33 trips per
    // vehicle) fuel_cost read 12,042,038.87 against a true 95,343.32 — a 126×
    // overstatement. Each subquery now aggregates its own table in isolation.
    //
    // `to` is compared as `< (to::date + 1)` rather than `<= to`: start_time is
    // a timestamptz, so `<= '2026-08-10'` means "before midnight on the 10th"
    // and silently drops that whole day. The date columns get the same
    // treatment for consistency, where it is a no-op.
    const { rows } = await query(
      `SELECT v.vehicle_id, v.plate_number, COALESCE(v.vehicle_name,'') AS vehicle_name,
              COALESCE(v.manufacturer,'') AS manufacturer, COALESCE(v.model,'') AS model,
              (SELECT COALESCE(SUM(f.amount), 0) FROM fuelrecords f
                WHERE f.vehicle_id = v.vehicle_id
                  AND f.fuel_date >= $1::date AND f.fuel_date < ($2::date + 1)) AS fuel_cost,
              (SELECT COALESCE(SUM(m.cost), 0) FROM vehiclemaintenance m
                WHERE m.vehicle_id = v.vehicle_id
                  AND m.maintenance_date >= $1::date AND m.maintenance_date < ($2::date + 1)) AS maintenance_cost,
              (SELECT COALESCE(SUM(t.distance), 0) FROM trips t
                WHERE t.vehicle_id = v.vehicle_id AND t.deleted_at IS NULL
                  AND t.start_time >= $1::date AND t.start_time < ($2::date + 1)) AS distance
         FROM vehicles v
        WHERE v.deleted_at IS NULL
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
