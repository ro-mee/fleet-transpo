import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const sp = new URL(req.url).searchParams;
    const from = sp.get("from") || "1970-01-01";
    const to = sp.get("to") || "2100-01-01";

    const { rows: records } = await query(
      `SELECT fr.fuel_date, fr.amount, fr.liters, fr.fuel_type, fr.vehicle_id,
              v.plate_number, v.vehicle_name, vc.category_name
         FROM fuelrecords fr
         LEFT JOIN vehicles v ON fr.vehicle_id = v.vehicle_id
         LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
        WHERE fr.fuel_date >= $1 AND fr.fuel_date <= $2
        ORDER BY fr.fuel_date ASC`,
      [from, to]
    );

    if (!records?.length) {
      return ok({
        totalLiters: 0,
        totalCost: 0,
        avgCost: 0,
        byVehicle: [],
        byCategory: [],
        monthlyData: [],
      });
    }

    const totalLiters = records.reduce((s, r) => s + (Number(r.liters) || 0), 0);
    const totalCost = records.reduce((s, r) => s + (Number(r.amount) || 0), 0);

    const monthlyMap = {};
    const categoryMap = {};

    records.forEach((r) => {
      const m = (r.fuel_date ? String(r.fuel_date) : "").substring(0, 7);
      if (m) {
        if (!monthlyMap[m]) monthlyMap[m] = { month: m, liters: 0, cost: 0 };
        monthlyMap[m].liters += Number(r.liters) || 0;
        monthlyMap[m].cost += Number(r.amount) || 0;
      }

      const catName = r.category_name || "General Fleet";
      if (!categoryMap[catName]) {
        categoryMap[catName] = { category: catName, liters: 0, cost: 0 };
      }
      categoryMap[catName].liters += Number(r.liters) || 0;
      categoryMap[catName].cost += Number(r.amount) || 0;
    });

    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
    const byCategory = Object.values(categoryMap);

    return ok({
      totalLiters,
      totalCost,
      avgCost: totalLiters ? totalCost / totalLiters : 0,
      byVehicle: [],
      byCategory,
      monthlyData,
    });
  } catch (e) {
    return handleError(e);
  }
}
