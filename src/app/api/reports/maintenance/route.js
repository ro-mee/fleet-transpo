import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    const { rows: records } = await query(`SELECT maintenance_date, cost, maintenance_type, description, vehicle_id, row_to_json(v.*) as vehicles FROM vehiclemaintenance LEFT JOIN vehicles v ON vehiclemaintenance.vehicle_id = v.vehicle_id WHERE maintenance_date >= $1 AND maintenance_date <= $2 ORDER BY maintenance_date DESC`, [from, to]);
    if (!records?.length) return ok({ totalCost: 0, totalRecords: 0, byType: [], monthlyData: [] });
    const totalCost = records.reduce((s, r) => s + (r.cost || 0), 0);
    const typeMap = {};
    records.forEach(r => { const t = r.maintenance_type || "Other"; if (!typeMap[t]) typeMap[t] = { type: t, cost: 0, count: 0 }; typeMap[t].cost += r.cost || 0; typeMap[t].count += 1; });
    return ok({ totalCost, totalRecords: records.length, byType: Object.values(typeMap), monthlyData: [] });
  } catch (e) { return handleError(e); }
}
