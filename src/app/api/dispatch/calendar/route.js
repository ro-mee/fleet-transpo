import { query } from "@/lib/db";
import { requirePermission, ok, handleError } from "@/lib/api/utils";

// Phase 16 — everything the calendar needs for one visible window.
//
// The calendar draws dispatches *and* the reasons a resource is unavailable, so
// a dispatch sitting on top of a maintenance window is visible as the mistake it
// is. That means four sources, fetched concurrently for one date range, plus the
// vehicle and driver rosters that form the lanes.
//
// Rosters are returned in full rather than only the resources that happen to be
// busy: an empty lane is information — it is where the next trip can go.
//
// Each probe is independently failure-tolerant. A calendar missing its leave
// overlay is degraded but useful; a calendar that 500s because one table
// hiccuped is not.
export async function GET(req) {
  try {
    await requirePermission(req, "dispatch", "read_all");

    const sp = new URL(req.url).searchParams;
    const from = sp.get("from");
    const to = sp.get("to");
    if (!from || !to) {
      return ok({ dispatches: [], maintenance: [], leave: [], work_schedules: [], vehicles: [], drivers: [] });
    }

    const [dispatches, maintenance, leave, workSchedules, vehicles, drivers] = await Promise.all([
      // Cancelled dispatches are included: the board greys them out rather than
      // hiding them, because "this slot was freed" is worth seeing. They are
      // excluded from overlap detection client-side via holdsResource.
      query(
        `SELECT ds.dispatch_id, ds.dispatch_number, ds.status, ds.priority,
                ds.vehicle_id, ds.driver_id, ds.route_id,
                ds.scheduled_departure, ds.scheduled_arrival,
                ds.actual_departure, ds.actual_arrival,
                CASE WHEN tr.request_id IS NULL THEN NULL ELSE
                  json_build_object(
                    'request_id', tr.request_id,
                    'reservation_number', tr.reservation_number,
                    'guest_name', tr.guest_name,
                    'passenger_count', tr.passenger_count,
                    'priority', tr.priority,
                    'fleet_status', tr.fleet_status,
                    'pickup_location', tr.pickup_location,
                    'dropoff_location', tr.dropoff_location)
                END AS transportation_requests,
                CASE WHEN r.route_id IS NULL THEN NULL ELSE
                  json_build_object('route_id', r.route_id, 'route_name', r.route_name)
                END AS routes
           FROM dispatchschedules ds
           LEFT JOIN transportation_requests tr
             ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
           LEFT JOIN routes r ON ds.route_id = r.route_id
          WHERE ds.deleted_at IS NULL
            AND ds.scheduled_departure < $2::timestamptz
            AND COALESCE(ds.scheduled_arrival, ds.scheduled_departure + INTERVAL '1 hour')
                > $1::timestamptz
          ORDER BY ds.scheduled_departure ASC`,
        [from, to]
      ).then((r) => r.rows).catch(() => []),

      // DATE columns, so the range comparison is calendar-day. An open record
      // with no completed_date covers its own day only — same rule as
      // maintenanceCoversDay() in lib/scheduling/conflicts.js.
      query(
        `SELECT maintenance_id, vehicle_id, maintenance_type, description,
                maintenance_date, completed_date, status, priority
           FROM vehiclemaintenance
          WHERE deleted_at IS NULL
            AND status <> 'Completed'
            AND maintenance_date <= $2::date
            AND COALESCE(completed_date, maintenance_date) >= $1::date
          ORDER BY maintenance_date ASC`,
        [from, to]
      ).then((r) => r.rows).catch(() => []),

      // Approved leave requests (migration 049) expanded into one row per
      // covered calendar day, shaped like the legacy driverattendance rows the
      // calendar's leaveToEvent() consumes. `status` carries the leave type so
      // the board still titles the block.
      query(
        `SELECT lr.leave_request_id AS attendance_id,
                lr.driver_id,
                g.date::date AS date,
                lr.leave_type AS status,
                lr.reason AS remarks
           FROM driver_leave_requests lr
          CROSS JOIN LATERAL generate_series(lr.start_date, lr.end_date, '1 day'::interval) g(date)
          WHERE lr.status = 'Approved'
            AND g.date::date >= $1::date AND g.date::date <= $2::date
          ORDER BY date ASC`,
        [from, to]
      ).then((r) => r.rows).catch(() => []),

      // Standing weekly work schedules (migration 049) — the calendar overlays
      // rest days and shift hours per driver lane.
      query(
        `SELECT schedule_id, driver_id, day_of_week, shift_start, shift_end, break_start, break_end, is_rest_day
           FROM driver_work_schedules
          ORDER BY driver_id ASC, day_of_week ASC`
      ).then((r) => r.rows).catch(() => []),

      query(
        `SELECT vehicle_id, plate_number, model, make, vehicle_status,
                seating_capacity, registration_expiry
           FROM vehicles
          WHERE deleted_at IS NULL AND vehicle_status <> 'Decommissioned'
          ORDER BY plate_number ASC`
      ).then((r) => r.rows).catch(() => []),

      query(
        `SELECT d.driver_id, d.driver_status, d.license_number, d.license_expiry,
                e.first_name, e.last_name
           FROM drivers d
           LEFT JOIN employees e ON d.employee_id = e.employee_id
          WHERE d.deleted_at IS NULL
          ORDER BY e.first_name ASC, e.last_name ASC`
      ).then((r) => r.rows).catch(() => []),
    ]);

    return ok({ dispatches, maintenance, leave, work_schedules: workSchedules, vehicles, drivers });
  } catch (e) {
    return handleError(e);
  }
}
