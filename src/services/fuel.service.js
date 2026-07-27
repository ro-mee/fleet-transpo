import { createClient } from "@/lib/supabase/client";

export async function getFuelRecords(filters = {}) {
  const supabase = createClient();
  let query = supabase
    .from("fuelrecords")
    .select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employees(first_name, last_name))")
    .is("deleted_at", null);

  if (filters.vehicle_id) query = query.eq("vehicle_id", filters.vehicle_id);
  if (filters.driver_id) query = query.eq("driver_id", filters.driver_id);
  if (filters.fuel_type) query = query.eq("fuel_type", filters.fuel_type);
  if (filters.from_date) query = query.gte("fuel_date", filters.from_date);
  if (filters.to_date) query = query.lte("fuel_date", filters.to_date);

  if (filters.page && filters.pageSize) {
    const from = (filters.page - 1) * filters.pageSize;
    const to = from + filters.pageSize - 1;
    query = query.range(from, to);
  }

  query = query.order("fuel_date", { ascending: false });

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function createFuelRecord(record) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("fuelrecords")
    .insert(record)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getFuelAnalytics() {
  const supabase = createClient();
  const { data: records } = await supabase
    .from("fuelrecords")
    .select("fuel_type, liters, amount, price_per_liter, fuel_date, odometer")
    .is("deleted_at", null)
    .order("fuel_date", { ascending: false });

  if (!records?.length) {
    return { totalCost: 0, totalLiters: 0, avgCostPerLiter: 0, recordsCount: 0, byFuelType: [], monthlyTrend: [] };
  }

  const totalCost = records.reduce((s, r) => s + (r.amount || 0), 0);
  const totalLiters = records.reduce((s, r) => s + (r.liters || 0), 0);
  const avgCostPerLiter = totalLiters ? totalCost / totalLiters : 0;

  const fuelTypeMap = {};
  records.forEach((r) => {
    const t = r.fuel_type || "Unknown";
    if (!fuelTypeMap[t]) fuelTypeMap[t] = { fuel_type: t, liters: 0, cost: 0, count: 0 };
    fuelTypeMap[t].liters += r.liters || 0;
    fuelTypeMap[t].cost += r.amount || 0;
    fuelTypeMap[t].count += 1;
  });

  const monthlyMap = {};
  records.forEach((r) => {
    const month = r.fuel_date?.substring(0, 7) || "Unknown";
    if (!month) return;
    if (!monthlyMap[month]) monthlyMap[month] = { month, cost: 0, liters: 0, count: 0 };
    monthlyMap[month].cost += r.amount || 0;
    monthlyMap[month].liters += r.liters || 0;
    monthlyMap[month].count += 1;
  });

  return {
    totalCost,
    totalLiters,
    avgCostPerLiter,
    recordsCount: records.length,
    byFuelType: Object.values(fuelTypeMap),
    monthlyTrend: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)),
  };
}
