import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || null;
    const to = sp.get("to") || null;
    const { rows: drivers } = await query(
      `SELECT d.driver_id,
              COALESCE(e.first_name, '') AS first_name,
              COALESCE(e.last_name, '') AS last_name,
              COUNT(t.trip_id)::int AS total_trips,
              ROUND(AVG(t.customer_rating)::numeric, 1) AS rating,
              ROUND(AVG(t.smooth_driving_score)::numeric, 1) AS performance_score,
              ROUND(SUM(t.distance)::numeric, 1) AS total_distance,
              ROUND(AVG(CASE WHEN t.on_time_completion THEN 1 ELSE 0 END)::numeric, 2) AS on_time_rate,
              ROUND(AVG(t.cost_per_km)::numeric, 2) AS cost_per_km,
              (SELECT COUNT(*)::int FROM driverincidents di
                WHERE di.driver_id = d.driver_id
                  AND di.incident_date >= $1::date AND di.incident_date < ($2::date + 1)) AS incidents,
              d.driver_status
         FROM drivers d
         LEFT JOIN employees e ON d.employee_id = e.employee_id
         LEFT JOIN trips t ON t.driver_id = d.driver_id
           AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
           AND ($1::date IS NULL OR t.end_time >= $1::date)
           AND ($2::date IS NULL OR t.end_time < ($2::date + 1))
         WHERE d.deleted_at IS NULL
         GROUP BY d.driver_id, e.first_name, e.last_name, d.driver_status`,
      [from, to]
    );
    if (!drivers?.length) return ok({ totalDrivers: 0, avgScore: 0, topDrivers: [], details: [] });
    const scores = drivers
      .filter((d) => (Number(d.performance_score) || 0) > 0)
      .map((d) => ({
        name: `${d.first_name} ${d.last_name}`.trim() || "Unknown",
        score: Number(d.performance_score) || 0,
        trips: d.total_trips || 0,
        rating: Number(d.rating) || 0,
      }));
    const details = drivers.map((d) => ({
      driver_id: d.driver_id,
      name: `${d.first_name} ${d.last_name}`.trim() || "Unknown",
      total_trips: d.total_trips || 0,
      rating: Number(d.rating) || 0,
      performance_score: Number(d.performance_score) || 0,
      total_distance: Number(d.total_distance) || 0,
      on_time_rate: Number(d.on_time_rate) || 0,
      incidents: Number(d.incidents) || 0,
      cost_per_km: Number(d.cost_per_km) || 0,
      driver_status: d.driver_status,
    })).sort((a, b) => b.performance_score - a.performance_score);
    return ok({
      totalDrivers: drivers.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : 0,
      topDrivers: scores.sort((a, b) => b.score - a.score).slice(0, 10),
      details,
    });
  } catch (e) { return handleError(e); }
}
