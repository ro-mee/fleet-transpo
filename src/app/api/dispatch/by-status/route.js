import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

// Grouped dispatch feed for the board — one query, four buckets.
//
// Joins transportation_requests (guest, priority, reservation number, locations,
// passenger count, service type, distance/duration), vehicles, drivers+employees,
// routes, and the latest trip so the card can render the 17 spec fields and the
// trip progress bar without a follow-up request per row.
export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);

    const { rows } = await query(`
      SELECT
        ds.*,
        row_to_json(v.*)       AS vehicles,
        CASE WHEN d.driver_id IS NULL THEN NULL ELSE
          json_build_object(
            'driver_id',       d.driver_id,
            'driver_status',   d.driver_status,
            'license_number',  d.license_number,
            'license_expiry',  d.license_expiry,
            'first_name',      de.first_name,
            'last_name',       de.last_name
          )
        END                     AS drivers,
        row_to_json(r.*)        AS routes,
        -- The transportation request that originated this dispatch.
        CASE WHEN tr.request_id IS NULL THEN NULL ELSE
          json_build_object(
            'request_id',          tr.request_id,
            'reservation_number',  tr.reservation_number,
            'guest_name',          tr.guest_name,
            'booking_reference',   tr.booking_reference,
            'fleet_status',        tr.fleet_status,
            'pickup_location',     tr.pickup_location,
            'dropoff_location',    tr.dropoff_location,
            'passenger_count',     tr.passenger_count,
            'special_requests',    tr.special_requests,
            'requested_vehicle_type', tr.requested_vehicle_type,
            'estimated_distance',  tr.estimated_distance,
            'estimated_duration',  tr.estimated_duration,
            'service_name',        st.service_name,
            'vehicle_id',          tr.vehicle_id,
            'driver_id',           tr.driver_id
          )
        END                     AS transportation_requests,
        -- Latest trip for this dispatch (for start/stop actions + progress).
        CASE WHEN lat.trip_id IS NULL THEN NULL ELSE
          json_build_object(
            'trip_id',       lat.trip_id,
            'trip_status',   lat.trip_status,
            'start_time',    lat.start_time,
            'end_time',      lat.end_time,
            'distance',      lat.distance,
            'actual_duration', lat.actual_duration,
            'start_odometer', lat.start_odometer,
            'end_odometer',   lat.end_odometer,
            'fuel_consumed',  lat.fuel_consumed,
            'avg_speed',      lat.avg_speed
          )
        END                     AS latest_trip
      FROM dispatchschedules ds
      LEFT JOIN vehicles v
        ON ds.vehicle_id = v.vehicle_id
      LEFT JOIN drivers d
        ON ds.driver_id = d.driver_id
      LEFT JOIN employees de
        ON d.employee_id = de.employee_id
      LEFT JOIN routes r
        ON ds.route_id = r.route_id
      LEFT JOIN transportation_requests tr
        ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
      LEFT JOIN service_types st
        ON tr.service_type_id = st.service_type_id
      LEFT JOIN LATERAL (
        SELECT *
        FROM trips t
        WHERE t.dispatch_id = ds.dispatch_id AND t.deleted_at IS NULL
        ORDER BY t.created_at DESC
        LIMIT 1
      ) lat ON TRUE
      WHERE ds.deleted_at IS NULL
      ORDER BY
        CASE ds.priority
          WHEN 'Urgent' THEN 1
          WHEN 'High'   THEN 2
          WHEN 'Medium' THEN 3
          WHEN 'Low'    THEN 4
          ELSE 5
        END,
        ds.scheduled_departure ASC
    `);

    return ok({
      scheduled:  rows.filter((d) => d.status === "Scheduled"),
      inProgress: rows.filter((d) => d.status === "In Progress"),
      completed:  rows.filter((d) => d.status === "Completed"),
      cancelled:  rows.filter((d) => d.status === "Cancelled"),
    });
  } catch (e) {
    return handleError(e);
  }
}
