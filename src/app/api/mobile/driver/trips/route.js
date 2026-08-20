import { query } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";
import { computeDepartureWindow } from "@/lib/scheduling/departure-window";
import { tomtomEtaMinutes, etaFromDistanceKm, haversineKm } from "@/lib/scheduling/travel-buffer";
import { mergeDispatchPolicy } from "@/lib/dispatch-policy";

/**
 * GET /api/mobile/driver/trips
 *
 * The home screen's work list. Always filtered to the token's own driver_id;
 * there is no driver_id parameter to override.
 *
 * ?status=pending|active|completed  (default: pending + active)
 * ?limit=  1..100, default 50
 */

// Mirrors the chk_trip_status constraint in 012_status_constraints.sql.
// "pending" is everything assigned-but-not-yet-acknowledged by the driver.
const STATUS_GROUPS = {
  pending: [
    "Pending",
    "Approved",
    "Assigned",
    "Vehicle Assigned",
    "Driver Assigned",
    "Dispatched",
  ],
  active: ["Driver Accepted", "Trip Started", "At Pickup", "Passenger Onboard", "En Route", "Drop-off", "Arrived", "In Progress"],
  completed: ["Completed", "Cancelled"],
};
STATUS_GROUPS.all = [
  ...STATUS_GROUPS.pending,
  ...STATUS_GROUPS.active,
  ...STATUS_GROUPS.completed,
];

async function preTripStatus(tripId) {
  const { rows } = await query(
    `SELECT i.status FROM vehicleinspection i
       JOIN trips t ON t.trip_id = i.trip_id
      WHERE i.trip_id = $1
        AND i.driver_id = t.driver_id
        AND i.vehicle_id = t.vehicle_id
      ORDER BY i.created_at DESC, i.inspection_id DESC LIMIT 1`,
    [tripId]
  );
  return rows[0]?.status ?? null;
}

export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const sp = req.nextUrl.searchParams;

    const requested = sp.get("status");
    const statuses = requested
      ? STATUS_GROUPS[requested]
      : [...STATUS_GROUPS.pending, ...STATUS_GROUPS.active];
    if (!statuses) {
      return err(`Unknown status group '${requested}'`, 400);
    }

    const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 100);

    const { rows } = await query(
      `SELECT t.trip_id, t.trip_status,
              COALESCE(r.origin, tr.pickup_location) AS origin, 
              COALESCE(r.destination, tr.dropoff_location) AS destination,
              ol.latitude  AS origin_latitude,  ol.longitude  AS origin_longitude,
              dl.latitude  AS destination_latitude, dl.longitude AS destination_longitude,
              t.start_time, t.end_time, 
              COALESCE(r.estimated_distance, tr.estimated_distance) AS estimated_distance, 
              COALESCE(r.estimated_duration, tr.estimated_duration) AS estimated_duration,
              t.dispatch_id, t.notes, t.start_odometer,
              v.vehicle_id, v.plate_number, v.model, v.mileage AS current_mileage,
              r.route_id, r.route_name,
              ds.dispatch_number,
              ds.scheduled_departure AS departure_time,
              tr.guest_name AS passenger_name,
              tr.passenger_count,
              tr.booking_reference,
              tr.special_requests
         FROM trips t
         LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
         LEFT JOIN routes r   ON r.route_id = t.route_id
         LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
         LEFT JOIN locations dl ON dl.location_id = r.destination_location_id
         LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
         LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
        WHERE t.driver_id = $1 AND t.deleted_at IS NULL
          AND t.trip_status = ANY($2)
        ORDER BY ds.scheduled_departure ASC NULLS LAST, t.trip_id ASC
        LIMIT $3`,
      [session.user.driverId, statuses, limit]
    );

    // Pre-trip + departure-window enrichment. Every pre-start trip (not yet
    // STARTED) gets the window fields so the app can show "when can I start".
    // ETA (a TomTom network call) is only computed for the one trip actually
    // awaiting START ROUTE (Driver Accepted), not the whole list.
    const preStart = rows.filter((t) =>
      [...STATUS_GROUPS.pending, "Driver Accepted"].includes(t.trip_status)
    );
    const actionable = preStart.find((t) => t.trip_status === "Driver Accepted");

    // ETA is resolved once (from the driver's current position) and reused.
    let driverPos = null;
    const resolveEta = async (trip) => {
      if (trip.eta_to_pickup_min != null) return trip.eta_to_pickup_min;
      const dest = trip.origin_latitude != null
        ? [Number(trip.origin_latitude), Number(trip.origin_longitude)]
        : null;
      if (!driverPos) {
        const { rows: pos } = await query(
          `SELECT current_latitude, current_longitude FROM drivers WHERE driver_id = $1 LIMIT 1`,
          [session.user.driverId]
        );
        driverPos = pos[0]?.current_latitude != null
          ? [Number(pos[0].current_latitude), Number(pos[0].current_longitude)]
          : null;
      }
      const src = driverPos;
      let eta = null;
      if (src && dest) eta = await tomtomEtaMinutes({ origin: src, destination: dest });
      if (eta == null && src && dest) eta = etaFromDistanceKm(haversineKm(src, dest));
      if (eta == null) {
        const d = Number(trip.estimated_duration);
        eta = Number.isFinite(d) && d > 0 ? d : null;
      }
      trip.eta_to_pickup_min = eta;
      return eta;
    };

    const policy = mergeDispatchPolicy(
      (await query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'dispatch_policy' LIMIT 1`
      )).rows[0]?.setting_value
    );

    for (const t of preStart) {
      t.pre_trip_status = await preTripStatus(t.trip_id);
      
      if (!t.departure_time) continue;
      const etaMinutes = await resolveEta(t);
      const window = computeDepartureWindow({
        pickup: t.departure_time,
        etaMinutes,
        departureBufferMinutes: policy.departureBufferMinutes,
        earlyStartAllowanceMinutes: policy.earlyStartAllowanceMinutes,
      });
      t.recommended_departure = window?.recommended_departure ?? null;
      t.earliest_start = window?.earliest_start ?? null;
      t.latest_start = window?.latest_start ?? null;
      t.eta_to_pickup_min = window?.eta_minutes ?? etaMinutes ?? null;
    }

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
