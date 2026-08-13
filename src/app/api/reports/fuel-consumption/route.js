import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// pg returns DATE columns as JS Date objects (local time), not strings — a bare
// `.substring(0, 7)` on one yields "Fri Jul". Build the YYYY-MM key from local
// components, same as fuel/analytics.
const monthKey = (d) => {
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  return String(d ?? "").slice(0, 7) || "Unknown";
};

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
    const vehicleMap = {};

    records.forEach((r) => {
      const m = monthKey(r.fuel_date);
      if (m && m !== "Unknown") {
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

      const plate = r.plate_number || "Unknown";
      if (!vehicleMap[plate]) {
        vehicleMap[plate] = {
          vehicle: `${r.vehicle_name || ""} ${plate}`.trim() || plate,
          plate_number: plate,
          liters: 0,
          cost: 0,
        };
      }
      vehicleMap[plate].liters += Number(r.liters) || 0;
      vehicleMap[plate].cost += Number(r.amount) || 0;
    });

    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month));
    const byCategory = Object.values(categoryMap);
    const byVehicle = Object.values(vehicleMap);

    return ok({
      totalLiters,
      totalCost,
      avgCost: totalLiters ? totalCost / totalLiters : 0,
      byVehicle,
      byCategory,
      monthlyData,
    });
  } catch (e) {
    return handleError(e);
  }
}
