import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01", to = sp.get("to") || "2100-01-01";
    const { rows: records } = await query(`SELECT vehiclemaintenance.maintenance_date, vehiclemaintenance.cost, vehiclemaintenance.maintenance_type, vehiclemaintenance.description, vehiclemaintenance.vehicle_id, row_to_json(v.*) as vehicles FROM vehiclemaintenance LEFT JOIN vehicles v ON vehiclemaintenance.vehicle_id = v.vehicle_id WHERE vehiclemaintenance.maintenance_date >= $1 AND vehiclemaintenance.maintenance_date <= $2 ORDER BY vehiclemaintenance.maintenance_date DESC`, [from, to]);
    if (!records?.length) return ok({ totalCost: 0, totalRecords: 0, byType: [], monthlyData: [] });
    // Number(): pg returns `cost` (numeric) as a string, so a bare + concatenates.
    const totalCost = records.reduce((s, r) => s + (Number(r.cost) || 0), 0);
    const typeMap = {};
    records.forEach(r => { const t = r.maintenance_type || "Other"; if (!typeMap[t]) typeMap[t] = { type: t, cost: 0, count: 0 }; typeMap[t].cost += Number(r.cost) || 0; typeMap[t].count += 1; });
    // pg hands back DATE as a JS Date; build the YYYY-MM key from local parts.
    const monthMap = {};
    records.forEach((r) => {
      const d = r.maintenance_date;
      const m = d instanceof Date
        ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
        : String(d ?? "").slice(0, 7);
      if (!m || m === "Unknown") return;
      if (!monthMap[m]) monthMap[m] = { month: m, cost: 0, count: 0 };
      monthMap[m].cost += Number(r.cost) || 0;
      monthMap[m].count += 1;
    });
    return ok({ totalCost, totalRecords: records.length, byType: Object.values(typeMap), monthlyData: Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month)) });
  } catch (e) { return handleError(e); }
}
