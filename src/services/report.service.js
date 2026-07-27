import { createClient } from "@/lib/supabase/client";

export async function getFleetUtilizationReport(from, to) {
  const supabase = createClient();
  const { data: trips } = await supabase
    .from("trips")
    .select("start_time, end_time, distance, trip_status, vehicle_id, vehicles(plate_number, vehicle_name)")
    .gte("start_time", from || "1970-01-01")
    .lte("start_time", to || "2100-01-01")
    .order("start_time", { ascending: false });

  const { data: vehicles } = await supabase
    .from("vehicles")
    .select("vehicle_id, plate_number, vehicle_status")
    .is("deleted_at", null);

  if (!trips && !vehicles) return { utilization: 0, totalTrips: 0, totalDistance: 0, byVehicle: [] };

  const total = (vehicles || []).length;
  const active = (vehicles || []).filter((v) => v.vehicle_status === "In Use").length;
  const tripCount = (trips || []).length;
  const totalDist = (trips || []).reduce((s, t) => s + (t.distance || 0), 0);

  return {
    utilization: total ? Math.round((active / total) * 100) : 0,
    totalTrips: tripCount,
    totalDistance: totalDist,
    byVehicle: (trips || []).reduce((acc, t) => {
      const plate = t.vehicles?.plate_number || "Unknown";
      const existing = acc.find((a) => a.plate === plate);
      if (existing) { existing.trips++; existing.distance += t.distance || 0; }
      else acc.push({ plate, trips: 1, distance: t.distance || 0 });
      return acc;
    }, []),
  };
}

export async function getFuelConsumptionReport(from, to) {
  const supabase = createClient();
  const { data: records } = await supabase
    .from("fuelrecords")
    .select("fuel_date, amount, liters, fuel_type, vehicle_id, vehicles(plate_number)")
    .gte("fuel_date", from || "1970-01-01")
    .lte("fuel_date", to || "2100-01-01")
    .order("fuel_date", { ascending: false });

  if (!records?.length) return { totalLiters: 0, totalCost: 0, avgCost: 0, byVehicle: [], monthlyData: [] };

  const totalLiters = records.reduce((s, r) => s + (r.liters || 0), 0);
  const totalCost = records.reduce((s, r) => s + (r.amount || 0), 0);

  const monthlyMap = {};
  records.forEach((r) => {
    const month = (r.fuel_date || "").substring(0, 7);
    if (!month) return;
    if (!monthlyMap[month]) monthlyMap[month] = { month, liters: 0, cost: 0 };
    monthlyMap[month].liters += r.liters || 0;
    monthlyMap[month].cost += r.amount || 0;
  });

  return {
    totalLiters,
    totalCost,
    avgCost: totalLiters ? totalCost / totalLiters : 0,
    byVehicle: [],
    monthlyData: Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export async function getMaintenanceReport(from, to) {
  const supabase = createClient();
  const { data: records } = await supabase
    .from("vehiclemaintenance")
    .select("maintenance_date, cost, maintenance_type, description, vehicle_id, vehicles(plate_number)")
    .gte("maintenance_date", from || "1970-01-01")
    .lte("maintenance_date", to || "2100-01-01")
    .order("maintenance_date", { ascending: false });

  if (!records?.length) return { totalCost: 0, totalRecords: 0, byType: [], monthlyData: [] };

  const totalCost = records.reduce((s, r) => s + (r.cost || 0), 0);

  const typeMap = {};
  records.forEach((r) => {
    const t = r.maintenance_type || "Other";
    if (!typeMap[t]) typeMap[t] = { type: t, cost: 0, count: 0 };
    typeMap[t].cost += r.cost || 0;
    typeMap[t].count += 1;
  });

  return {
    totalCost,
    totalRecords: records.length,
    byType: Object.values(typeMap),
    monthlyData: [],
  };
}

export async function getDriverPerformanceReport(from, to) {
  const supabase = createClient();

  const { data: drivers } = await supabase
    .from("drivers")
    .select("driver_id, employees(first_name, last_name)")
    .is("deleted_at", null);

  if (!drivers?.length) return { totalDrivers: 0, avgScore: 0, topDrivers: [] };

  const driverIds = drivers.map((d) => d.driver_id);

  const { data: stats } = await supabase
    .from("driver_stats")
    .select("*")
    .in("driver_id", driverIds);

  const statsMap = {};
  (stats || []).forEach((s) => { statsMap[s.driver_id] = s; });

  const scores = drivers
    .filter((d) => (statsMap[d.driver_id]?.performance_score || 0) > 0)
    .map((d) => {
      const s = statsMap[d.driver_id] || {};
      return {
        name: d.employees ? `${d.employees.first_name} ${d.employees.last_name}` : "Unknown",
        score: s.performance_score || 0,
        trips: s.total_trips || 0,
        rating: s.rating || 0,
      };
    });

  return {
    totalDrivers: drivers.length,
    avgScore: scores.length ? Math.round(scores.reduce((s, d) => s + d.score, 0) / scores.length) : 0,
    topDrivers: scores.sort((a, b) => b.score - a.score).slice(0, 10),
  };
}

export async function getFinancialSummary(from, to) {
  const supabase = createClient();

  const { data: trips } = await supabase
    .from("trips")
    .select("distance")
    .gte("start_time", from || "1970-01-01")
    .lte("start_time", to || "2100-01-01");

  const { data: fuel } = await supabase
    .from("fuelrecords")
    .select("amount, liters")
    .gte("fuel_date", from || "1970-01-01")
    .lte("fuel_date", to || "2100-01-01");

  const { data: maintenance } = await supabase
    .from("vehiclemaintenance")
    .select("cost")
    .gte("maintenance_date", from || "1970-01-01")
    .lte("maintenance_date", to || "2100-01-01");

  const fuelCost = (fuel || []).reduce((s, f) => s + (f.amount || 0), 0);
  const maintCost = (maintenance || []).reduce((s, m) => s + (m.cost || 0), 0);
  const totalDist = (trips || []).reduce((s, t) => s + (t.distance || 0), 0);

  return {
    fuelCost,
    maintCost,
    totalCost: fuelCost + maintCost,
    totalDistance: totalDist,
    costPerKm: totalDist ? (fuelCost + maintCost) / totalDist : 0,
  };
}
