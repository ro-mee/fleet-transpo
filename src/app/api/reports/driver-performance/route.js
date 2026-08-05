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
              ROUND(AVG(t.smooth_driving_score)::numeric, 1) AS performance_score
         FROM drivers d
         LEFT JOIN employees e ON d.employee_id = e.employee_id
         LEFT JOIN trips t ON t.driver_id = d.driver_id
          AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
          AND ($1::date IS NULL OR t.end_time >= $1::date)
          AND ($2::date IS NULL OR t.end_time < ($2::date + 1))
        WHERE d.deleted_at IS NULL
        GROUP BY d.driver_id, e.first_name, e.last_name`,
      [from, to]
    );
    if (!drivers?.length) return ok({ totalDrivers: 0, avgScore: 0, topDrivers: [] });
    const scores = drivers.filter(d => (Number(d.performance_score) || 0) > 0).map(d => ({
      name: `${d.first_name} ${d.last_name}`.trim() || "Unknown",
      score: Number(d.performance_score) || 0,
      trips: d.total_trips || 0,
      rating: Number(d.rating) || 0,
    }));
    return ok({
      totalDrivers: drivers.length,
      avgScore: scores.length ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : 0,
      topDrivers: scores.sort((a, b) => b.score - a.score).slice(0, 10),
    });
  } catch (e) { return handleError(e); }
}
