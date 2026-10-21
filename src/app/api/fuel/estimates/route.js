import { query } from "@/lib/db";
import { manilaMonthRange } from "@/lib/dates";
import { requirePermission, handleError, err, ok } from "@/lib/api/utils";
import { MIN_EFFICIENCY_DISTANCE_KM, getFuelConsumptionReport } from "@/lib/reports/fuel-consumption";
import { REFERENCE_PRICE_STALE_AFTER_DAYS } from "@/lib/fuel/price-policy";

// Read-only monitoring of per-trip fuel cost estimates locked at completion.
// No new table: reads the estimate columns written once by trip completion,
// joined to the snapshot that priced them and the vehicle that ran them.
//
// The row list is a 500-row page; totals come from their own aggregate query
// over the WHOLE range, and `truncated` tells the UI when the page is not all
// of it. Computing totals from the page diluted averages with unpriced trips
// and silently under-reported any range wider than one page.
//
// `page` walks that same page size for exports (the CSV must cover the whole
// filtered range, not the 500 rows on screen), and `total` is the number of
// trips in the range so a pager knows when to stop.
//
// FE-11: rows carry the reference price's age at pricing time and a stale
// flag at the REFERENCE_PRICE_STALE_AFTER_DAYS horizon — a display label,
// never a repricing. FE-19: verified receipts linked to the trip are summed
// onto the row for estimate-vs-receipt variance. `daily` feeds the cost-per-
// day chart and `measured` is the official measured caliber from the Reports
// service, surfaced read-only.
const ROW_LIMIT = 500;

const isDay = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "") || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

// LIKE metacharacters in user input must match literally, not as wildcards
// (PostgreSQL LIKE treats backslash as the default escape character).
const escapeLike = (v) => String(v).replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

// The `to` date is inclusive (a UI date input): advance to the next calendar
// day for the exclusive upper bound so the whole day is counted.
function nextDay(day) {
  const dt = new Date(`${day}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

export async function GET(req) {
  try {
    await requirePermission(req, "reports", "read");
    const params = new URL(req.url).searchParams;
    const defaults = manilaMonthRange(0);
    const from = params.get("from") ?? defaults.from;
    const to = params.get("to") ?? defaults.to;
    const region = (params.get("region") ?? "").trim();
    const search = (params.get("search") ?? "").trim();
    if (!isDay(from) || !isDay(to) || from > to) return err("Invalid from/to, expected YYYY-MM-DD with from <= to.", 400);
    const requestedPage = Number(params.get("page") ?? 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 1000) : 1;
    const offset = (page - 1) * ROW_LIMIT;

    const values = [`${from}T00:00:00+08:00`, `${nextDay(to)}T00:00:00+08:00`];
    let where = `t.deleted_at IS NULL AND t.trip_status = 'Completed'
        AND t.end_time >= $1 AND t.end_time < $2`;
    // Case-insensitive: the region list is fed from UPPER(btrim(...)) values,
    // and a manager typing "ncr" must match trips stored as "NCR".
    if (region) { values.push(region); where += ` AND UPPER(t.fuel_region) = UPPER($${values.length})`; }
    if (search) { values.push(`%${escapeLike(search)}%`); where += ` AND (v.plate_number ILIKE $${values.length} OR v.vehicle_name ILIKE $${values.length})`; }

    const { rows } = await query(`
      SELECT t.trip_id, t.end_time, t.actual_distance_km,
        t.estimated_fuel_l, t.estimated_fuel_cost, t.fuel_reference_price,
        t.fuel_region, t.fuel_estimate_reason, t.fuel_estimate_captured_at,
        t.planned_distance_km, t.planned_estimated_fuel_l, t.planned_estimated_fuel_cost,
        t.distance_provenance, t.fuel_efficiency_snapshot_kmpl,
        v.plate_number, v.vehicle_name, v.fuel_type,
        s.source_url, s.effective_at, s.verification_method,
        FLOOR(EXTRACT(EPOCH FROM (t.fuel_estimate_captured_at - s.effective_at)) / 86400)::int AS price_age_days,
        (t.fuel_estimate_captured_at - s.effective_at) > interval '${REFERENCE_PRICE_STALE_AFTER_DAYS} days' AS price_stale,
        receipts.actual_fuel_l, receipts.actual_cost, receipts.actual_receipt_count
      FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      LEFT JOIN fuel_price_snapshots s ON s.snapshot_id = t.fuel_price_snapshot_id
      LEFT JOIN LATERAL (
        SELECT SUM(fr.liters) AS actual_fuel_l, SUM(fr.amount) AS actual_cost,
               COUNT(*)::int AS actual_receipt_count
          FROM fuelrecords fr
         WHERE fr.trip_id = t.trip_id AND fr.deleted_at IS NULL
           AND fr.status IN ('Approved', 'Completed')
      ) receipts ON TRUE
      WHERE ${where}
      ORDER BY t.end_time DESC, t.trip_id DESC LIMIT ${ROW_LIMIT} OFFSET ${offset}`, values);

    // Filter options for the region select: every region completed trips have
    // ever carried (not just the selected range, so switching ranges cannot
    // empty the select), upper-cased so one region cannot appear twice.
    const { rows: regionRows } = await query(`
      SELECT DISTINCT UPPER(btrim(fuel_region)) AS fuel_region
        FROM trips
       WHERE deleted_at IS NULL AND trip_status = 'Completed'
         AND fuel_region IS NOT NULL AND btrim(fuel_region) <> ''
       ORDER BY fuel_region`);
    const regions = regionRows.map((row) => row.fuel_region).filter(Boolean);

    // Aggregates over the whole range, independent of the row page above. The
    // ratio parts are filtered to rows carrying BOTH a value and a positive
    // distance, so cost/km and L/100km never divide by a distance that has no
    // matching numerator (or the other way round).
    const { rows: totalRows } = await query(`
      SELECT COUNT(*)::int AS trips,
        COUNT(t.estimated_fuel_cost)::int AS priced_trips,
        COUNT(t.estimated_fuel_l)::int AS litered_trips,
        COALESCE(SUM(t.estimated_fuel_cost), 0) AS estimated_cost,
        COALESCE(SUM(t.estimated_fuel_l), 0) AS estimated_liters,
        COALESCE(SUM(t.actual_distance_km) FILTER (
          WHERE t.estimated_fuel_l IS NOT NULL AND t.actual_distance_km > 0), 0) AS liters_distance_km,
        COALESCE(SUM(t.estimated_fuel_l) FILTER (
          WHERE t.estimated_fuel_l IS NOT NULL AND t.actual_distance_km > 0), 0) AS liters_with_distance,
        COALESCE(SUM(t.actual_distance_km) FILTER (
          WHERE t.estimated_fuel_cost IS NOT NULL AND t.actual_distance_km > 0), 0) AS priced_distance_km,
        COALESCE(SUM(t.estimated_fuel_cost) FILTER (
          WHERE t.estimated_fuel_cost IS NOT NULL AND t.actual_distance_km > 0), 0) AS priced_cost_with_distance,
        (COUNT(*) FILTER (WHERE t.fuel_estimate_captured_at IS NOT NULL AND s.effective_at IS NOT NULL
          AND t.fuel_estimate_captured_at - s.effective_at > interval '${REFERENCE_PRICE_STALE_AFTER_DAYS} days'))::int AS stale_priced_trips
      FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      LEFT JOIN fuel_price_snapshots s ON s.snapshot_id = t.fuel_price_snapshot_id
      WHERE ${where}`, values);
    const raw = totalRows[0] ?? {};
    const totals = {
      trips: Number(raw.trips) || 0,
      priced_trips: Number(raw.priced_trips) || 0,
      litered_trips: Number(raw.litered_trips) || 0,
      estimated_cost: Number(raw.estimated_cost) || 0,
      estimated_liters: Number(raw.estimated_liters) || 0,
      liters_distance_km: Number(raw.liters_distance_km) || 0,
      liters_with_distance: Number(raw.liters_with_distance) || 0,
      priced_distance_km: Number(raw.priced_distance_km) || 0,
      priced_cost_with_distance: Number(raw.priced_cost_with_distance) || 0,
      stale_priced_trips: Number(raw.stale_priced_trips) || 0,
    };

    // Chart series: the same filtered trips grouped by their Manila completion
    // day, so the viewer's zone cannot shift a bar to the wrong date.
    const { rows: dailyRows } = await query(`
      SELECT TO_CHAR((t.end_time AT TIME ZONE 'Asia/Manila')::date, 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS trips,
        COUNT(t.estimated_fuel_cost)::int AS priced_trips,
        SUM(t.estimated_fuel_cost) AS estimated_cost,
        SUM(t.estimated_fuel_l) AS estimated_liters
      FROM trips t JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      WHERE ${where}
      GROUP BY 1 ORDER BY 1`, values);
    const daily = dailyRows.map((row) => ({
      day: row.day,
      trips: Number(row.trips) || 0,
      priced_trips: Number(row.priced_trips) || 0,
      estimated_cost: row.estimated_cost == null ? null : Number(row.estimated_cost),
      estimated_liters: row.estimated_liters == null ? null : Number(row.estimated_liters),
    }));

    // Level 3 read-out (read-only): the official measured caliber — eligible
    // receipts over completed-trip distance, min 50 km — surfaced so the
    // estimates above can be sanity-checked, never to replace them.
    const report = await getFuelConsumptionReport(from, to);
    const measured = {
      efficiency_kmpl: report.estimatedEfficiency ?? null,
      liters: Number(report.totalLiters) || 0,
      distance_km: Number(report.totalDistance) || 0,
      min_distance_km: MIN_EFFICIENCY_DISTANCE_KM,
    };

    return ok({
      rows, totals, daily, measured,
      truncated: offset + rows.length < totals.trips,
      page, total: totals.trips,
      from, to, regions,
    });
  } catch (error) { return handleError(error); }
}
