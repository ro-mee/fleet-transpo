import { query } from "@/lib/db";
import { requirePermission, handleError, err, ok } from "@/lib/api/utils";

// Read-only monitoring of per-trip fuel cost estimates locked at completion.
// No new table: reads the estimate columns written once by trip completion,
// joined to the snapshot that priced them and the vehicle that ran them.
function monthBounds() {
  const nowManila = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Manila" }));
  const start = `${nowManila.getFullYear()}-${String(nowManila.getMonth() + 1).padStart(2, "0")}-01`;
  const next = new Date(nowManila.getFullYear(), nowManila.getMonth() + 1, 1);
  return { from: start, to: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-01` };
}

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v ?? "") && !Number.isNaN(Date.parse(v));

// LIKE metacharacters in user input must match literally, not as wildcards
// (PostgreSQL LIKE treats backslash as the default escape character).
const escapeLike = (v) => String(v).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

// The `to` date is inclusive (a UI date input): advance to the next calendar
// day for the exclusive upper bound so the whole day is counted.
function nextDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const defaults = monthBounds();
    const from = params.get("from") ?? defaults.from;
    const to = params.get("to") ?? defaults.to;
    const region = (params.get("region") ?? "").trim();
    const search = (params.get("search") ?? "").trim();
    if (!isDay(from) || !isDay(to) || from > to) return err("Invalid from/to, expected YYYY-MM-DD with from <= to.", 400);

    const values = [`${from}T00:00:00+08:00`, `${nextDay(to)}T00:00:00+08:00`];
    let sql = `
      SELECT t.trip_id, t.end_time, t.actual_distance_km,
        t.estimated_fuel_l, t.estimated_fuel_cost, t.fuel_reference_price,
        t.fuel_region, t.fuel_estimate_reason, t.fuel_estimate_captured_at,
        v.plate_number, v.vehicle_name, v.fuel_type, s.source_url
      FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      LEFT JOIN fuel_price_snapshots s ON s.snapshot_id = t.fuel_price_snapshot_id
      WHERE t.deleted_at IS NULL AND t.trip_status = 'Completed'
        AND t.end_time >= $1 AND t.end_time < $2`;
    if (region) { values.push(region); sql += ` AND t.fuel_region = $${values.length}`; }
    if (search) { values.push(`%${escapeLike(search)}%`); sql += ` AND (v.plate_number ILIKE $${values.length} OR v.vehicle_name ILIKE $${values.length})`; }
    sql += ` ORDER BY t.end_time DESC LIMIT 500`;
    const { rows } = await query(sql, values);

    const totals = rows.reduce((acc, r) => ({
      trips: acc.trips + 1,
      estimated_cost: acc.estimated_cost + (Number(r.estimated_fuel_cost) || 0),
      estimated_liters: acc.estimated_liters + (Number(r.estimated_fuel_l) || 0),
    }), { trips: 0, estimated_cost: 0, estimated_liters: 0 });
    return ok({ rows, totals, from, to });
  } catch (error) { return handleError(error); }
}
