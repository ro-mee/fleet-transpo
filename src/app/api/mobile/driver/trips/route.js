import { query } from "@/lib/db";
import { requireDriver, ok, err, handleError } from "@/lib/api/utils";

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
        ORDER BY t.start_time ASC NULLS LAST, t.trip_id ASC
        LIMIT $3`,
      [session.user.driverId, statuses, limit]
    );

    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
