import { query } from "@/lib/db";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";
import { NON_DISPATCHABLE_VEHICLE_STATUSES } from "@/lib/ai/pair-scoring";
import { estimateEfficiency } from "@/lib/ai/rule-engine";
import { predictVehicle } from "@/lib/ai/predictive-maintenance";
import { estimateFuel } from "@/lib/geo/distance";
import { estimateForRequest, resolveRequestEstimate } from "@/services/route-resolver.service";
import { serviceEnd } from "@/services/dispatch-radar.service";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";
import { derivePriority } from '@/lib/scheduling/priority';
import { getDispatchPolicy } from '@/services/dispatch-settings.service';
import { manilaDate } from '@/lib/dispatch/plan-window';

export async function loadServiceDateWorkload(driverIds, pickupAt) {
  if (!driverIds.length || !pickupAt || !Number.isFinite(+new Date(pickupAt))) return new Map();
  const serviceDate = manilaDate(pickupAt);
  const { rows } = await query(`WITH work AS (
    SELECT t.driver_id, 'completed' AS kind, EXTRACT(EPOCH FROM (t.end_time-t.start_time))/60 AS minutes
      FROM trips t WHERE t.deleted_at IS NULL AND t.trip_status='Completed'
      AND t.driver_id=ANY($1::int[]) AND (t.start_time AT TIME ZONE 'Asia/Manila')::date=$2::date
    UNION ALL
    SELECT ds.driver_id, CASE WHEN ds.status='In Progress' THEN 'active' ELSE 'scheduled' END,
      EXTRACT(EPOCH FROM (ds.scheduled_arrival-ds.scheduled_departure))/60
      FROM dispatchschedules ds WHERE ds.deleted_at IS NULL AND ds.status IN ('Scheduled','In Progress')
      AND ds.driver_id=ANY($1::int[]) AND (ds.scheduled_departure AT TIME ZONE 'Asia/Manila')::date=$2::date
      AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.dispatch_id=ds.dispatch_id AND t.deleted_at IS NULL AND t.trip_status='Completed')
    ) SELECT driver_id, COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE kind='completed')::int AS completed,
      COUNT(*) FILTER (WHERE kind='active')::int AS active,
      COUNT(*) FILTER (WHERE kind='scheduled')::int AS scheduled,
      CASE WHEN COUNT(*) FILTER (WHERE minutes IS NULL OR minutes<0)=0 THEN SUM(minutes) END AS minutes
      FROM work GROUP BY driver_id`, [driverIds, serviceDate]);
  return new Map(driverIds.map(id => {
    const row = rows.find(r => Number(r.driver_id) === Number(id));
    return [Number(id), { serviceDate, complete:true, source:'recorded trips and fixed dispatches',
      totalTrips:Number(row?.total ?? 0), completedTrips:Number(row?.completed ?? 0),
      activeTrips:Number(row?.active ?? 0), scheduledTrips:Number(row?.scheduled ?? 0),
      serviceMinutes: !row ? 0 : row.minutes == null ? null : Number(row.minutes) }];
  }));
}

/**
 * Reason a vehicle never reached the pair engine, in the engine's own words.
 *
 * The SQL pre-filter drops these rows before scoring, so without this the
 * Copilot (and the "Why options were excluded" panel) cannot explain them —
 * e.g. XYZ 5678 sat in the request's category but was Under Maintenance and
 * simply never appeared. Order mirrors buildFleetPairRecommendations: the
 * seats check runs first, so a too-small vehicle reports capacity even when
 * its status would also disqualify it.
 */
export function prefilterReason(vehicle, passengers) {
  const seats = Number(vehicle?.seating_capacity) || 0;
  if (seats > 0 && seats < passengers) {
    return `Seats ${seats} — too small for ${passengers} passenger(s).`;
  }
  if (vehicle?.vehicle_status) {
    return `Vehicle status is ${vehicle.vehicle_status}.`;
  }
  return "Excluded before evaluation.";
}

export async function fetchCandidates(request, trip = estimateForRequest(request)) {
  const passengers = Number(request?.passenger_count) || 1;
  const requestedCategoryId = request?.requested_category_id ?? null;

  // Same trip estimate the advisor uses, so fuel burn and schedule windows agree.
  const windowStart = request?.pickup_datetime ? new Date(request.pickup_datetime).toISOString() : null;
  const windowEnd = windowStart
    ? serviceEnd(request, trip)?.toISOString() ?? null
    : null;

  // Two deliberate widenings of the candidate pools, both so the pair engine can
  // apply the real rule instead of inheriting a wrong verdict from a status column:
  //
  // Vehicles — only statuses that actually ground the vehicle are excluded.
  // `Reserved` is not one of them: it is written whenever the vehicle has a
  // booking on the current day, so filtering on `= 'Available'` dropped cars that
  // are genuinely free at the requested time. `schedule_load` below already
  // answers the time-specific question by overlap, and the engine treats a
  // non-zero load as disqualifying — so overlap, not the label, decides.
  //
  // Drivers — the whole roster, not just `Available` ones. The engine must be
  // able to SEE that a vehicle's custodian is On Leave; if that row is missing it
  // reads the car as having no custodian and reports the wrong reason. Nothing is
  // loosened by this: `isDriverUnavailableFor` re-checks status, licence and
  // window load, and only a designated driver or an explicitly assigned
  // substitute is ever offered.
  const [vehicles, drivers, prefilteredRows] = await Promise.all([
    query(
      `WITH usage AS (
           SELECT vehicle_id,
                  SUM(distance)                   AS km_90d,
                  COUNT(*)                        AS trip_count,
                  COUNT(DISTINCT DATE(end_time))  AS active_days
             FROM trips
            WHERE trip_status = 'Completed' AND deleted_at IS NULL
              AND end_time > NOW() - INTERVAL '90 days'
            GROUP BY vehicle_id
       ),
       history AS (
           SELECT vehicle_id,
                  COUNT(*) FILTER (WHERE maintenance_type IS DISTINCT FROM 'Routine') AS corrective_count,
                  COUNT(*)                                                             AS total_count
             FROM vehiclemaintenance
            WHERE deleted_at IS NULL AND status = 'Completed'
              AND maintenance_date > NOW() - INTERVAL '365 days'
            GROUP BY vehicle_id
       )
       SELECT v.*, row_to_json(vc.*) AS vehiclecategories,
              u.km_90d, u.trip_count, u.active_days,
              h.corrective_count, h.total_count,
              COALESCE((
                SELECT COUNT(*)
                  FROM dispatchschedules ds
                 WHERE ds.vehicle_id = v.vehicle_id
                   AND ds.deleted_at IS NULL
                   AND ds.status IN ('Scheduled', 'In Progress')
                   AND ($3::timestamptz IS NULL OR ds.scheduled_departure < $3)
                   AND ($2::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $2)
              ), 0)::int AS schedule_load
         FROM vehicles v
         LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
         LEFT JOIN usage   u ON u.vehicle_id = v.vehicle_id
         LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
        WHERE v.deleted_at IS NULL
          AND v.vehicle_status <> ALL($5::text[])
          AND (v.seating_capacity IS NULL OR v.seating_capacity >= $1::int)
          AND ($4::int IS NULL OR v.category_id = $4::int)`,
      [
        passengers,
        windowStart,
        windowEnd,
        request?.requested_category_id ?? null,
        NON_DISPATCHABLE_VEHICLE_STATUSES,
      ]
    ).then((r) =>
      r.rows.map((v) => {
        v._est_fuel_liters = estimateFuel(trip.distanceKm, estimateEfficiency(v), v.tank_capacity ?? null).liters;
        v._schedule_load = Number(v.schedule_load) || 0;
        v._maintenance = predictVehicle(v);
        return v;
      })
    ),

    query(
      `SELECT d.driver_id,d.driver_status,d.license_expiry,d.years_of_experience,
              e.first_name,
              e.last_name,
              ROUND(AVG(t.customer_rating)::numeric, 2)      AS avg_guest_rating,
              ROUND(AVG(t.smooth_driving_score)::numeric, 2) AS avg_driving_score,
              COUNT(t.trip_id)::int                          AS total_completed_trips,
              COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days')  AS trips_7d,
              COUNT(t.trip_id) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days') AS trips_30d,
              COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS km_7d,
              COALESCE(SUM(t.distance) FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS km_30d,
              COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                         FILTER (WHERE t.end_time >= NOW() - INTERVAL '7 days'), 0)  AS hours_7d,
              COALESCE(SUM(EXTRACT(EPOCH FROM (t.end_time - t.start_time)) / 3600)
                         FILTER (WHERE t.end_time >= NOW() - INTERVAL '30 days'), 0) AS hours_30d,
              COALESCE((
                SELECT COUNT(*)
                  FROM dispatchschedules ds
                 WHERE ds.driver_id = d.driver_id
                   AND ds.deleted_at IS NULL
                   AND ds.status IN ('Scheduled', 'In Progress')
                   AND ($2::timestamptz IS NULL OR ds.scheduled_departure < $2)
                   AND ($1::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1)
              ), 0)::int AS schedule_load
         FROM drivers d
         LEFT JOIN employees e ON e.employee_id = d.employee_id
         LEFT JOIN trips t
                ON t.driver_id = d.driver_id
               AND t.trip_status = 'Completed'
               AND t.deleted_at IS NULL
        WHERE d.deleted_at IS NULL
        GROUP BY d.driver_id, e.first_name, e.last_name`,
      [windowStart, windowEnd]
    ).then((r) =>
      r.rows.map((d) => {
        d._proximity_relevant = false;
        d._schedule_load = Number(d.schedule_load) || 0;
        // Rolling workload signals (AI Fair Workload Distribution). Coerce pg's
        // numeric returns so the pure scorer sees plain numbers.
        d._workload_trips_7d = Number(d.trips_7d) || 0;
        d._workload_trips_30d = Number(d.trips_30d) || 0;
        d._workload_km_7d = Number(d.km_7d) || 0;
        d._workload_km_30d = Number(d.km_30d) || 0;
        d._workload_hours_7d = Number(d.hours_7d) || 0;
        d._workload_hours_30d = Number(d.hours_30d) || 0;
        return d;
      })
    ),

    // Vehicles the main query filtered out before scoring, fetched cheaply
    // (no usage/history joins) so their absence can be explained instead of
    // silently shrinking `considered`. Same category scope as the main query;
    // soft-deleted rows stay hidden — a gone vehicle is not an explanation.
    query(
      `SELECT v.vehicle_id, v.plate_number, v.vehicle_status, v.seating_capacity
         FROM vehicles v
        WHERE v.deleted_at IS NULL
          AND ($2::int IS NULL OR v.category_id = $2::int)
          AND (v.vehicle_status = ANY($3::text[])
            OR (v.seating_capacity IS NOT NULL AND v.seating_capacity < $1::int))`,
      [passengers, requestedCategoryId, NON_DISPATCHABLE_VEHICLE_STATUSES]
    ).then((r) =>
      r.rows.map((v) => ({
        vehicle_id: v.vehicle_id,
        plate: v.plate_number,
        reason: prefilterReason(v, passengers),
        prefiltered: true,
      }))
    ),
  ]);

  return { vehicles, drivers, windowStart, windowEnd, prefiltered: prefilteredRows };
}
export async function loadActivePairs() {
  const { rows } = await query(
    `SELECT driver_id, vehicle_id
       FROM driver_vehicle_assignments
      WHERE assigned_until IS NULL`
  );
  return rows;
}
export async function loadActiveSubstitutes() {
  const { rows } = await query(
    `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
       FROM substitute_vehicle_schedules`
  );
  return rows;
}
export async function withResolvedEstimate(request, { persistRoute = false } = {}) {
  const estimate = await resolveRequestEstimate(request, { query }, { persistRoute });
  return {
    estimate,
    request: {
      ...request,
      estimated_distance: request?.estimated_distance ?? estimate.distanceKm,
      estimated_duration: request?.estimated_duration ?? estimate.durationMin,
      estimate_source: request?.estimate_source ?? estimate.source,
    },
  };
}
export async function prepareDispatchRecommendation(request, { persistRoute = false, now = new Date() } = {}) {
  const resolved = await withResolvedEstimate(request, { persistRoute });
  const { vehicles, drivers, windowEnd, prefiltered } = await fetchCandidates(resolved.request, resolved.estimate);
  const [activePairs, activeSubstitutes, scheduleContext] = await Promise.all([
  loadActivePairs(), loadActiveSubstitutes(), loadDriverScheduleContext(drivers.map(d => d.driver_id))]);
  const recommendation = buildDispatchRecommendation({request: resolved.request, vehicles, drivers, now,
  activePairs, activeSubstitutes, returnAt: windowEnd ? new Date(windowEnd) : null, scheduleContext, prefiltered});
  // Missing workload is neutral; it must never look like an empty workday.
  const workloads = await loadServiceDateWorkload(drivers.map(d => d.driver_id), request.pickup_datetime).catch(() => new Map());
  for (const pair of recommendation.pair?.candidates ?? []) pair.workloadEvidence = workloads.get(Number(pair.driver_id)) ?? null;
 const thresholds = await getDispatchPolicy();
 recommendation.priorityEvidence = { level:derivePriority({pickupDatetime:request.pickup_datetime ?? undefined,fleetStatus:request.fleet_status,
   isVip:request.is_vip===true,isEmergency:request.is_emergency===true,now,thresholds,timeZone:'Asia/Manila'}),
   pickupAt:request.pickup_datetime,isVip:request.is_vip===true,isEmergency:request.is_emergency===true };
 return {...resolved, drivers, recommendation};
}
