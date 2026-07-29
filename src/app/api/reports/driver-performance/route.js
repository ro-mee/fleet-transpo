import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows: drivers } = await query(`SELECT d.driver_id, row_to_json(e.*) as employees FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.deleted_at IS NULL`);
    if (!drivers?.length) return ok({ totalDrivers: 0, avgScore: 0, topDrivers: [] });
    const ids = drivers.map(d => d.driver_id);
    const { rows: stats } = await query(`SELECT * FROM driver_stats WHERE driver_id = ANY($1::int[])`, [ids]);
    const m = {}; stats.forEach(s => { m[s.driver_id] = s; });
    const scores = drivers.filter(d => (m[d.driver_id]?.performance_score || 0) > 0).map(d => { const s = m[d.driver_id] || {}; return { name: d.employees ? `${d.employees.first_name} ${d.employees.last_name}` : "Unknown", score: s.performance_score || 0, trips: s.total_trips || 0, rating: s.rating || 0 }; });
    return ok({ totalDrivers: drivers.length, avgScore: scores.length ? Math.round(scores.reduce((s,d)=>s+d.score,0)/scores.length) : 0, topDrivers: scores.sort((a,b)=>b.score-a.score).slice(0,10) });
  } catch (e) { return handleError(e); }
}
