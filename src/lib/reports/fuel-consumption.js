import { query } from "@/lib/db";
import { toCalendarDay } from "@/lib/dates";

export const MIN_EFFICIENCY_DISTANCE_KM = 50;
export const ELIGIBLE_FUEL_STATUSES = new Set(["Approved", "Completed"]);

const number = (value) => Number(value) || 0;
const round = (value, places = 2) => Number(Number(value).toFixed(places));

function manilaMonth(value) {
  if (!value) return "Unknown";
  if (!(value instanceof Date)) return String(value).slice(0, 7);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(value);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function efficiency(distance, liters) {
  return distance >= MIN_EFFICIENCY_DISTANCE_KM && liters > 0 ? round(distance / liters) : null;
}

function efficiencyStatus(estimated, baseline) {
  if (estimated == null) return "Insufficient data";
  if (!(baseline > 0)) return "No baseline";
  return estimated < baseline ? "Below baseline" : "Meets or exceeds baseline";
}

export function validateFuelReportRange(from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || "") || !day.test(to || "")) return "from and to must use YYYY-MM-DD";
  if (from > to) return "from must be on or before to";
  return null;
}

export function buildFuelConsumptionReport(rawFuelRecords = [], rawTrips = []) {
  const fuelRecords = rawFuelRecords
    .filter((row) => !row.deleted_at && ELIGIBLE_FUEL_STATUSES.has(row.status))
    .map((row) => ({
      ...row,
      fuel_date: toCalendarDay(row.fuel_date),
      liters: number(row.liters),
      amount: number(row.amount),
      price_per_liter: number(row.price_per_liter) || (number(row.liters) ? round(number(row.amount) / number(row.liters)) : 0),
      odometer: row.odometer == null ? null : number(row.odometer),
    }));
  const trips = rawTrips
    .filter((row) => !row.deleted_at && row.trip_status === "Completed")
    .map((row) => ({
      ...row,
      distance: number(row.distance),
      actual_duration: row.actual_duration == null ? null : number(row.actual_duration),
    }));

  const vehicleMap = new Map();
  const monthMap = new Map();
  const categoryMap = new Map();
  const vehicle = (row) => {
    const id = row.vehicle_id;
    if (!vehicleMap.has(id)) {
      vehicleMap.set(id, {
        vehicle_id: id,
        vehicle: `${row.vehicle_name || ""} ${row.plate_number || "Unknown"}`.trim(),
        plate_number: row.plate_number || "Unknown",
        category: row.category_name || "General Fleet",
        baseline_efficiency: row.baseline_efficiency == null ? null : number(row.baseline_efficiency),
        liters: 0,
        cost: 0,
        trips: 0,
        distance: 0,
      });
    }
    return vehicleMap.get(id);
  };
  const month = (key) => {
    if (!monthMap.has(key)) monthMap.set(key, { month: key, liters: 0, cost: 0, trips: 0, distance: 0 });
    return monthMap.get(key);
  };
  const category = (row) => {
    const key = row.category_name || "General Fleet";
    if (!categoryMap.has(key)) categoryMap.set(key, { category: key, liters: 0, cost: 0, trips: 0, distance: 0 });
    return categoryMap.get(key);
  };

  for (const row of fuelRecords) {
    const v = vehicle(row);
    const m = month(String(row.fuel_date || "Unknown").slice(0, 7));
    const c = category(row);
    v.liters += row.liters;
    v.cost += row.amount;
    m.liters += row.liters;
    m.cost += row.amount;
    c.liters += row.liters;
    c.cost += row.amount;
  }
  for (const row of trips) {
    const v = vehicle(row);
    const m = month(manilaMonth(row.end_time));
    const c = category(row);
    v.trips += 1;
    v.distance += row.distance;
    m.trips += 1;
    m.distance += row.distance;
    c.trips += 1;
    c.distance += row.distance;
  }

  const finalize = (row) => {
    const estimated = efficiency(row.distance, row.liters);
    const baseline = row.baseline_efficiency;
    return {
      ...row,
      liters: round(row.liters),
      cost: round(row.cost),
      distance: round(row.distance),
      estimated_kmpl: estimated,
      variance_percent: estimated != null && baseline > 0 ? round(((estimated - baseline) / baseline) * 100, 1) : null,
      status: efficiencyStatus(estimated, baseline),
    };
  };

  const byVehicle = [...vehicleMap.values()].map(finalize).sort((a, b) => b.cost - a.cost || b.distance - a.distance);
  const monthlyData = [...monthMap.values()]
    .filter((row) => row.month !== "Unknown")
    .map(finalize)
    .sort((a, b) => a.month.localeCompare(b.month));
  const byCategory = [...categoryMap.values()].map(finalize).sort((a, b) => b.liters - a.liters);
  const totalLiters = round(fuelRecords.reduce((sum, row) => sum + row.liters, 0));
  const totalCost = round(fuelRecords.reduce((sum, row) => sum + row.amount, 0));
  const totalDistance = round(trips.reduce((sum, row) => sum + row.distance, 0));
  const estimatedEfficiency = efficiency(totalDistance, totalLiters);

  return {
    totalLiters,
    totalCost,
    avgCost: totalLiters ? round(totalCost / totalLiters) : 0,
    totalDistance,
    estimatedEfficiency,
    fuelTransactionCount: fuelRecords.length,
    completedTrips: trips.length,
    vehicleCount: byVehicle.length,
    insufficientVehicleCount: byVehicle.filter((row) => row.estimated_kmpl == null).length,
    byVehicle,
    byCategory,
    monthlyData,
    fuelRecords,
    trips,
    methodology: `Estimated period fuel efficiency = completed-trip distance divided by eligible actual fuel volume. Eligible fuel is non-deleted Approved transactions plus legacy Completed transactions. Approved fuel requests are allocations only and are excluded. Estimates require at least ${MIN_EFFICIENCY_DISTANCE_KM} km.`,
  };
}

export async function getFuelConsumptionReport(from, to) {
  const [{ rows: fuelRecords }, { rows: trips }] = await Promise.all([
    query(
      `SELECT fr.fuel_record_id, fr.vehicle_id, fr.driver_id, fr.trip_id, fr.fuel_request_id,
              fr.fuel_date, fr.liters, fr.amount, fr.price_per_liter, fr.odometer,
              fr.fuel_type, fr.station_name, fr.status, fr.receipt_transaction_id,
              fr.deleted_at, v.plate_number, v.vehicle_name,
              v.fuel_efficiency_kmpl AS baseline_efficiency,
              vc.category_name, CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name
         FROM fuelrecords fr
         LEFT JOIN vehicles v ON v.vehicle_id = fr.vehicle_id
         LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
         LEFT JOIN drivers d ON d.driver_id = fr.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
        WHERE fr.deleted_at IS NULL
          AND fr.status IN ('Approved', 'Completed')
          AND fr.fuel_date >= $1::date AND fr.fuel_date < ($2::date + 1)
        ORDER BY fr.fuel_date, fr.fuel_record_id`,
      [from, to]
    ),
    query(
      `SELECT t.trip_id, t.vehicle_id, t.driver_id, t.start_time, t.end_time,
              t.distance, t.actual_duration, t.trip_status, t.deleted_at,
              v.plate_number, v.vehicle_name,
              v.fuel_efficiency_kmpl AS baseline_efficiency,
              vc.category_name, CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name,
              r.route_name, r.origin, r.destination
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN vehiclecategories vc ON vc.category_id = v.category_id
         LEFT JOIN drivers d ON d.driver_id = t.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN routes r ON r.route_id = t.route_id
        WHERE t.deleted_at IS NULL AND t.trip_status = 'Completed'
          AND t.end_time >= ($1::date::timestamp AT TIME ZONE 'Asia/Manila')
          AND t.end_time < (($2::date + 1)::timestamp AT TIME ZONE 'Asia/Manila')
        ORDER BY t.end_time, t.trip_id`,
      [from, to]
    ),
  ]);
  return buildFuelConsumptionReport(fuelRecords, trips);
}
