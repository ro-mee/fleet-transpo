import { query } from "@/lib/db";
import { toCalendarDay } from "@/lib/dates";
import { TRIPS_JOINS, TRIPS_SELECT } from "@/lib/api/trips-query";

export const DEFAULT_REPORT_FROM = "1970-01-01";
export const DEFAULT_REPORT_TO = "2100-01-01";

const number = (value) => Number(value) || 0;
const nullableNumber = (value) => value == null ? null : number(value);
const round = (value, places = 2) => Number(Number(value).toFixed(places));

export function validateReportRange(from, to) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(from || "") || !day.test(to || "")) return "from and to must use YYYY-MM-DD";
  if (from > to) return "from must be on or before to";
  return null;
}

function monthOf(value) {
  const day = toCalendarDay(value);
  return day ? day.slice(0, 7) : "Unknown";
}

function vehicleLabel(row) {
  return `${row.manufacturer || ""} ${row.model || ""} ${row.vehicle_name || ""}`.trim() || row.plate_number || "Unknown";
}

function fullName(row) {
  return `${row.first_name || ""} ${row.last_name || ""}`.trim() || "Unknown";
}

/** Shared server payload for the Maintenance report and its workbook. */
export async function getMaintenanceReport(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const { rows: records } = await query(
    `SELECT m.maintenance_id, m.vehicle_id, m.maintenance_type, m.description,
            m.maintenance_date, m.completed_date, m.cost, m.mileage_at_service,
            m.service_provider, m.service_center, m.next_schedule_date,
            m.next_schedule_mileage, m.status, m.priority, m.is_recurring,
            m.recurring_interval_days, m.recurring_interval_km, m.remarks,
            m.deleted_at, v.plate_number, v.vehicle_name, v.manufacturer, v.model
       FROM vehiclemaintenance m
       LEFT JOIN vehicles v ON v.vehicle_id = m.vehicle_id
      WHERE m.maintenance_date >= $1::date
        AND m.maintenance_date < ($2::date + 1)
        AND m.deleted_at IS NULL
      ORDER BY m.maintenance_date DESC, m.maintenance_id DESC`,
    [from, to]
  );

  const totalCost = (records || []).reduce((sum, row) => sum + number(row.cost), 0);
  const typeMap = new Map();
  const statusMap = new Map();
  const monthMap = new Map();
  for (const row of records || []) {
    const type = row.maintenance_type || "Other";
    const status = row.status || "Unknown";
    const month = monthOf(row.maintenance_date);
    const typeEntry = typeMap.get(type) || { type, cost: 0, count: 0 };
    typeEntry.cost += number(row.cost);
    typeEntry.count += 1;
    typeMap.set(type, typeEntry);
    const statusEntry = statusMap.get(status) || { status, cost: 0, count: 0 };
    statusEntry.cost += number(row.cost);
    statusEntry.count += 1;
    statusMap.set(status, statusEntry);
    if (month !== "Unknown") {
      const monthEntry = monthMap.get(month) || { month, cost: 0, count: 0 };
      monthEntry.cost += number(row.cost);
      monthEntry.count += 1;
      monthMap.set(month, monthEntry);
    }
  }

  return {
    totalCost: round(totalCost),
    totalRecords: (records || []).length,
    byType: [...typeMap.values()].map((row) => ({ ...row, cost: round(row.cost) })).sort((a, b) => b.cost - a.cost),
    byStatus: [...statusMap.values()].map((row) => ({ ...row, cost: round(row.cost) })).sort((a, b) => b.count - a.count),
    monthlyData: [...monthMap.values()].map((row) => ({ ...row, cost: round(row.cost) })).sort((a, b) => a.month.localeCompare(b.month)),
    records: records || [],
    methodology: "Recorded maintenance spend is grouped by maintenance date and includes every non-deleted maintenance record in the selected period. Costs are recorded values; scheduled or cancelled rows are not silently treated as completed service.",
  };
}

/** Shared server payload for Fleet Activity / Vehicle Utilization. */
export async function getFleetUtilizationReport(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const [{ rows: trips }, { rows: vehicles }] = await Promise.all([
    query(
      `SELECT t.trip_id, t.start_time, t.end_time, t.distance, t.trip_status,
              t.vehicle_id, t.driver_id, t.actual_duration, t.on_time_completion,
              t.customer_rating, t.smooth_driving_score, t.cost_per_km,
              t.total_cost, row_to_json(v.*) AS vehicles,
              CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name,
              r.route_name, r.origin, r.destination
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN drivers d ON d.driver_id = t.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN routes r ON r.route_id = t.route_id
        WHERE t.deleted_at IS NULL
          AND t.start_time >= $1::date
          AND t.start_time < ($2::date + 1)
        ORDER BY t.start_time DESC, t.trip_id DESC`,
      [from, to]
    ),
    query(`SELECT vehicle_id, plate_number, vehicle_name, manufacturer, model, vehicle_status FROM vehicles WHERE deleted_at IS NULL ORDER BY plate_number`, []),
  ]);

  const vehicleMap = new Map();
  const monthMap = new Map();
  const statusMap = new Map();
  for (const trip of trips || []) {
    const plate = trip.vehicles?.plate_number || "Unknown";
    const key = trip.vehicle_id ?? `plate:${plate}`;
    const row = vehicleMap.get(key) || {
      vehicle_id: trip.vehicle_id,
      plate,
      vehicle: trip.vehicles?.vehicle_name || plate,
      vehicle_status: trip.vehicles?.vehicle_status || null,
      trips: 0,
      distance: 0,
    };
    row.trips += 1;
    row.distance += number(trip.distance);
    vehicleMap.set(key, row);
    const status = trip.trip_status || "Unknown";
    const statusEntry = statusMap.get(status) || { status, trips: 0, distance: 0 };
    statusEntry.trips += 1;
    statusEntry.distance += number(trip.distance);
    statusMap.set(status, statusEntry);
    const month = monthOf(trip.start_time);
    if (month !== "Unknown") {
      const monthEntry = monthMap.get(month) || { month, trips: 0, distance: 0 };
      monthEntry.trips += 1;
      monthEntry.distance += number(trip.distance);
      monthMap.set(month, monthEntry);
    }
  }

  const active = (vehicles || []).filter((vehicle) => vehicle.vehicle_status === "In Use").length;
  const totalDistance = (trips || []).reduce((sum, trip) => sum + number(trip.distance), 0);
  return {
    utilization: vehicles?.length ? Math.round((active / vehicles.length) * 100) : 0,
    vehiclesInUse: active,
    fleetSize: (vehicles || []).length,
    totalTrips: (trips || []).length,
    totalDistance: round(totalDistance),
    byVehicle: [...vehicleMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => b.distance - a.distance || b.trips - a.trips),
    vehicleRoster: vehicles || [],
    statusBreakdown: [...statusMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => b.trips - a.trips),
    monthlyData: [...monthMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => a.month.localeCompare(b.month)),
    trips: trips || [],
    methodology: "Current in-use rate = vehicles currently marked In Use divided by the non-deleted vehicle roster. Activity totals use every trip record in the selected start-time window; trip status is shown so users can distinguish completed from in-progress or cancelled activity.",
  };
}

/** Shared server payload for Driver Performance. */
export async function getDriverPerformanceReport(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const [{ rows: drivers }, { rows: tripRows }, { rows: incidentRows }] = await Promise.all([
    query(
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
                  AND di.deleted_at IS NULL
                  AND di.incident_date >= $1::date
                  AND di.incident_date < ($2::date + 1)) AS incidents,
              d.driver_status
         FROM drivers d
         LEFT JOIN employees e ON d.employee_id = e.employee_id
         LEFT JOIN trips t ON t.driver_id = d.driver_id
           AND t.trip_status = 'Completed'
           AND t.deleted_at IS NULL
           AND t.end_time >= $1::date
           AND t.end_time < ($2::date + 1)
        WHERE d.deleted_at IS NULL
        GROUP BY d.driver_id, e.first_name, e.last_name, d.driver_status`,
      [from, to]
    ),
    query(
      `SELECT t.trip_id, t.driver_id, t.vehicle_id, t.start_time, t.end_time,
              t.distance, t.actual_duration, t.trip_status, t.on_time_completion,
              t.customer_rating, t.smooth_driving_score, t.cost_per_km,
              CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name,
              v.plate_number
         FROM trips t
         LEFT JOIN drivers d ON d.driver_id = t.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE t.trip_status = 'Completed'
          AND t.deleted_at IS NULL
          AND t.end_time >= $1::date
          AND t.end_time < ($2::date + 1)
        ORDER BY t.end_time, t.trip_id`,
      [from, to]
    ),
    query(
      `SELECT di.incident_id, di.driver_id, di.vehicle_id, di.trip_id,
              di.incident_type, di.incident_date, di.severity, di.status,
              di.expense_amount, di.description,
              CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name,
              v.plate_number
         FROM driverincidents di
         LEFT JOIN drivers d ON d.driver_id = di.driver_id
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN vehicles v ON v.vehicle_id = di.vehicle_id
        WHERE di.deleted_at IS NULL
          AND di.incident_date >= $1::date
          AND di.incident_date < ($2::date + 1)
        ORDER BY di.incident_date, di.incident_id`,
      [from, to]
    ),
  ]);

  const details = (drivers || []).map((row) => ({
    driver_id: row.driver_id,
    name: fullName(row),
    total_trips: Number(row.total_trips) || 0,
    rating: nullableNumber(row.rating),
    performance_score: nullableNumber(row.performance_score),
    total_distance: nullableNumber(row.total_distance),
    on_time_rate: nullableNumber(row.on_time_rate),
    incidents: Number(row.incidents) || 0,
    cost_per_km: nullableNumber(row.cost_per_km),
    driver_status: row.driver_status,
  })).sort((a, b) => b.performance_score - a.performance_score || b.total_trips - a.total_trips || a.name.localeCompare(b.name));
  const scored = details.filter((row) => row.performance_score > 0);
  const monthMap = new Map();
  for (const trip of tripRows || []) {
    const month = monthOf(trip.end_time);
    if (month === "Unknown") continue;
    const row = monthMap.get(month) || { month, trips: 0, distance: 0 };
    row.trips += 1;
    row.distance += number(trip.distance);
    monthMap.set(month, row);
  }
  const totalTrips = details.reduce((sum, row) => sum + row.total_trips, 0);
  return {
    totalDrivers: (drivers || []).length,
    totalTrips,
    totalDistance: round((tripRows || []).reduce((sum, row) => sum + number(row.distance), 0)),
    avgScore: scored.length ? Math.round(scored.reduce((sum, row) => sum + row.performance_score, 0) / scored.length) : 0,
    topDrivers: scored.slice(0, 10).map((row) => ({ name: row.name, score: row.performance_score, trips: row.total_trips, rating: row.rating })),
    details,
    monthlyData: [...monthMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => a.month.localeCompare(b.month)),
    trips: tripRows || [],
    incidents: incidentRows || [],
    methodology: "Driver score is the average smooth-driving score on completed, non-deleted trips ending in the selected period. On-time rate follows the existing report rule (true = 1, all other values = 0). Drivers without completed measurements remain unscored; the workbook leaves rate, score, rating, distance, and cost/km blank for them.",
  };
}

/** Shared server payload for Fleet Cost. Component filters mirror the current page. */
export async function getFleetCostReport(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const [{ rows }, { rows: fuelRecords }, { rows: maintenanceRecords }, { rows: tripRecords }] = await Promise.all([
    query(
      `SELECT v.vehicle_id, v.plate_number, COALESCE(v.vehicle_name,'') AS vehicle_name,
              COALESCE(v.manufacturer,'') AS manufacturer, COALESCE(v.model,'') AS model,
              (SELECT COALESCE(SUM(f.amount), 0) FROM fuelrecords f
                WHERE f.vehicle_id = v.vehicle_id
                  AND f.deleted_at IS NULL
                  AND f.fuel_date >= $1::date AND f.fuel_date < ($2::date + 1)) AS fuel_cost,
              (SELECT COALESCE(SUM(m.cost), 0) FROM vehiclemaintenance m
                WHERE m.vehicle_id = v.vehicle_id
                  AND m.deleted_at IS NULL
                  AND m.maintenance_date >= $1::date AND m.maintenance_date < ($2::date + 1)) AS maintenance_cost,
              (SELECT COALESCE(SUM(t.distance), 0) FROM trips t
                WHERE t.vehicle_id = v.vehicle_id AND t.deleted_at IS NULL
                  AND t.start_time >= $1::date AND t.start_time < ($2::date + 1)) AS distance
         FROM vehicles v
        WHERE v.deleted_at IS NULL
        ORDER BY v.plate_number`,
      [from, to]
    ),
    query(
      `SELECT f.fuel_record_id, f.vehicle_id, f.fuel_date, f.liters, f.amount,
              f.status, f.fuel_type, f.station_name, v.plate_number
         FROM fuelrecords f LEFT JOIN vehicles v ON v.vehicle_id = f.vehicle_id
        WHERE f.deleted_at IS NULL
          AND f.fuel_date >= $1::date AND f.fuel_date < ($2::date + 1)
        ORDER BY f.fuel_date, f.fuel_record_id`,
      [from, to]
    ),
    query(
      `SELECT m.maintenance_id, m.vehicle_id, m.maintenance_date, m.maintenance_type,
              m.cost, m.status, v.plate_number
         FROM vehiclemaintenance m LEFT JOIN vehicles v ON v.vehicle_id = m.vehicle_id
        WHERE m.deleted_at IS NULL
          AND m.maintenance_date >= $1::date AND m.maintenance_date < ($2::date + 1)
        ORDER BY m.maintenance_date, m.maintenance_id`,
      [from, to]
    ),
    query(
      `SELECT t.trip_id, t.vehicle_id, t.start_time, t.end_time, t.distance,
              t.trip_status, t.total_cost, v.plate_number
         FROM trips t LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
        WHERE t.deleted_at IS NULL
          AND t.start_time >= $1::date AND t.start_time < ($2::date + 1)
        ORDER BY t.start_time, t.trip_id`,
      [from, to]
    ),
  ]);
  const details = (rows || []).map((row) => {
    const fuel = number(row.fuel_cost);
    const maintenance = number(row.maintenance_cost);
    const distance = number(row.distance);
    const total = fuel + maintenance;
    return {
      vehicle_id: row.vehicle_id,
      plate_number: row.plate_number,
      vehicle: vehicleLabel(row),
      fuel_cost: fuel,
      maintenance_cost: maintenance,
      total_cost: total,
      distance,
      cost_per_km: distance ? total / distance : 0,
    };
  });
  const totals = details.reduce((sum, row) => ({
    fuel_cost: sum.fuel_cost + row.fuel_cost,
    maintenance_cost: sum.maintenance_cost + row.maintenance_cost,
    total_cost: sum.total_cost + row.total_cost,
    distance: sum.distance + row.distance,
  }), { fuel_cost: 0, maintenance_cost: 0, total_cost: 0, distance: 0 });
  return {
    details,
    totals: { ...totals, cost_per_km: totals.distance ? totals.total_cost / totals.distance : 0 },
    fuelRecords: fuelRecords || [],
    maintenanceRecords: maintenanceRecords || [],
    trips: tripRecords || [],
    methodology: "Fleet cost totals use the same component scope as the on-screen Fleet Cost page: recorded fuel amount and maintenance cost in the period, plus non-deleted trip distance. Cost per km is blank when no distance is recorded.",
  };
}

/** Shared server payload for the Financial Summary report. */
export async function getFinancialSummary(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const [{ rows: tripRecords }, { rows: fuelRecords }, { rows: maintenanceRecords }] = await Promise.all([
    query(
      `SELECT trip_id, start_time, end_time, distance, total_cost, trip_status
         FROM trips
        WHERE deleted_at IS NULL
          AND start_time >= $1::date AND start_time < ($2::date + 1)
        ORDER BY start_time, trip_id`,
      [from, to]
    ),
    query(
      `SELECT fuel_record_id, vehicle_id, fuel_date, amount, liters, status
         FROM fuelrecords
        WHERE deleted_at IS NULL
          AND fuel_date >= $1::date AND fuel_date < ($2::date + 1)
        ORDER BY fuel_date, fuel_record_id`,
      [from, to]
    ),
    query(
      `SELECT maintenance_id, vehicle_id, maintenance_date, cost, maintenance_type, status
         FROM vehiclemaintenance
        WHERE deleted_at IS NULL
          AND maintenance_date >= $1::date AND maintenance_date < ($2::date + 1)
        ORDER BY maintenance_date, maintenance_id`,
      [from, to]
    ),
  ]);
  const fuelCost = (fuelRecords || []).reduce((sum, row) => sum + number(row.amount), 0);
  const maintCost = (maintenanceRecords || []).reduce((sum, row) => sum + number(row.cost), 0);
  const totalDistance = (tripRecords || []).reduce((sum, row) => sum + number(row.distance), 0);
  const monthlyMap = new Map();
  const addMonth = (date, key, value) => {
    const month = monthOf(date);
    if (month === "Unknown") return;
    const row = monthlyMap.get(month) || { month, fuelCost: 0, maintenanceCost: 0, distance: 0 };
    row[key] += value;
    monthlyMap.set(month, row);
  };
  for (const row of fuelRecords || []) addMonth(row.fuel_date, "fuelCost", number(row.amount));
  for (const row of maintenanceRecords || []) addMonth(row.maintenance_date, "maintenanceCost", number(row.cost));
  for (const row of tripRecords || []) addMonth(row.start_time, "distance", number(row.distance));
  return {
    fuelCost: round(fuelCost),
    maintCost: round(maintCost),
    totalCost: round(fuelCost + maintCost),
    totalDistance: round(totalDistance),
    costPerKm: totalDistance ? (fuelCost + maintCost) / totalDistance : 0,
    tripCost: 0,
    monthlyData: [...monthlyMap.values()].map((row) => ({ ...row, fuelCost: round(row.fuelCost), maintenanceCost: round(row.maintenanceCost), distance: round(row.distance) })).sort((a, b) => a.month.localeCompare(b.month)),
    tripRecords: tripRecords || [],
    fuelRecords: fuelRecords || [],
    maintenanceRecords: maintenanceRecords || [],
    methodology: "Financial summary follows the existing page scope: fuel amounts, maintenance costs, and trip distance in the selected period. Fuel and maintenance totals are recorded costs; cost per km is derived only when distance is available.",
  };
}

/** Workbook-only Trip Performance/Register payload for the existing Trips export. */
export async function getTripPerformanceReport(from, to) {
  const hasRange = from && to;
  const rangeSql = hasRange ? " AND t.start_time >= $1::date AND t.start_time < ($2::date + 1)" : "";
  const params = hasRange ? [from, to] : [];
  const { rows } = await query(`SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.deleted_at IS NULL${rangeSql} ORDER BY t.start_time DESC NULLS LAST, t.trip_id DESC`, params);
  const trips = rows || [];
  const statusMap = new Map();
  const monthMap = new Map();
  for (const trip of trips) {
    const status = trip.trip_status || "Unknown";
    const row = statusMap.get(status) || { status, trips: 0, distance: 0 };
    row.trips += 1;
    row.distance += number(trip.distance);
    statusMap.set(status, row);
    const month = monthOf(trip.start_time);
    if (month !== "Unknown") {
      const monthly = monthMap.get(month) || { month, trips: 0, distance: 0 };
      monthly.trips += 1;
      monthly.distance += number(trip.distance);
      monthMap.set(month, monthly);
    }
  }
  const completed = trips.filter((trip) => trip.trip_status === "Completed");
  const distance = trips.reduce((sum, trip) => sum + number(trip.distance), 0);
  return {
    totalTrips: trips.length,
    completedTrips: completed.length,
    activeTrips: trips.filter((trip) => !["Completed", "Cancelled"].includes(trip.trip_status)).length,
    cancelledTrips: trips.filter((trip) => trip.trip_status === "Cancelled").length,
    totalDistance: round(distance),
    completionRate: trips.length ? completed.length / trips.length : null,
    averageDistance: trips.length ? distance / trips.length : null,
    statusBreakdown: [...statusMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => b.trips - a.trips),
    monthlyData: [...monthMap.values()].map((row) => ({ ...row, distance: round(row.distance) })).sort((a, b) => a.month.localeCompare(b.month)),
    trips,
    methodology: "Trip register rows are non-deleted trips. Summary rates and averages are derived from those same rows; no trip is counted as completed unless its stored status is Completed.",
  };
}

/** Workbook-only Incident Registry payload for the existing Incidents page. */
export async function getIncidentReport(from, to) {
  const conditions = ["i.deleted_at IS NULL"];
  const params = [];
  if (from) { params.push(from); conditions.push(`i.incident_date >= $${params.length}::date`); }
  if (to) { params.push(to); conditions.push(`i.incident_date < ($${params.length}::date + 1)`); }
  const { rows } = await query(
    `SELECT i.incident_id, i.driver_id, COALESCE(i.vehicle_id, a.vehicle_id) AS vehicle_id,
            i.trip_id, i.incident_type, i.incident_date, i.description, i.location,
            i.latitude, i.longitude, i.severity, i.status, i.actions_taken,
            i.assistance_needed, i.expense_amount, i.photo_urls,
            COALESCE(v.plate_number, av.plate_number) AS plate_number,
            CONCAT_WS(' ', e.first_name, e.last_name) AS driver_name
       FROM driverincidents i
       LEFT JOIN vehicles v ON v.vehicle_id = i.vehicle_id
       LEFT JOIN drivers d ON d.driver_id = i.driver_id
       LEFT JOIN employees e ON e.employee_id = d.employee_id
       LEFT JOIN driver_vehicle_assignments a ON a.driver_id = i.driver_id AND a.assigned_until IS NULL
       LEFT JOIN vehicles av ON av.vehicle_id = a.vehicle_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY i.incident_date DESC, i.created_at DESC
      LIMIT 200`,
    params
  );
  const incidents = rows || [];
  const by = (field) => {
    const map = new Map();
    for (const row of incidents) {
      const value = row[field] || "Unknown";
      map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()].map(([value, count]) => ({ [field]: value, count })).sort((a, b) => b.count - a.count || String(a[field]).localeCompare(String(b[field])));
  };
  const monthMap = new Map();
  for (const row of incidents) {
    const month = monthOf(row.incident_date);
    if (month === "Unknown") continue;
    monthMap.set(month, (monthMap.get(month) || 0) + 1);
  }
  return {
    totalIncidents: incidents.length,
    openIncidents: incidents.filter((row) => String(row.status).toLowerCase() === "open").length,
    criticalMajor: incidents.filter((row) => ["critical", "major"].includes(String(row.severity).toLowerCase())).length,
    breakdowns: incidents.filter((row) => /breakdown|mechanical|engine/i.test(row.incident_type || "")).length,
    bySeverity: by("severity"),
    byStatus: by("status"),
    byType: by("incident_type"),
    monthlyData: [...monthMap.entries()].map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    incidents,
    methodology: "Incident counts use non-deleted driver reports from the selected incident-date window. Open, severity, type, and breakdown indicators are direct classifications of stored incident fields.",
  };
}
