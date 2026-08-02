import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation, ensureTripForDispatch } from "@/services/status.service";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { assertDispatchOwnership } from "@/lib/api/ownership";

const JOIN_SELECT = `
  ds.*,
  row_to_json(v.*)  AS vehicles,
  row_to_json(r.*)  AS routes,
  CASE WHEN d.driver_id IS NULL THEN NULL ELSE
    json_build_object(
      'driver_id',      d.driver_id,
      'driver_status',  d.driver_status,
      'license_number', d.license_number,
      'license_expiry', d.license_expiry,
      'phone',          de.phone,
      'first_name',     de.first_name,
      'last_name',      de.last_name
    )
  END AS drivers,
  CASE WHEN tr.request_id IS NULL THEN NULL ELSE
    json_build_object(
      'request_id',             tr.request_id,
      'reservation_number',     tr.reservation_number,
      'guest_name',             tr.guest_name,
      'booking_reference',      tr.booking_reference,
      'fleet_status',           tr.fleet_status,
      'priority',               tr.priority,
      'pickup_location',        tr.pickup_location,
      'dropoff_location',       tr.dropoff_location,
      'pickup_datetime',        tr.pickup_datetime,
      'passenger_count',        tr.passenger_count,
      'special_requests',       tr.special_requests,
      'requested_vehicle_type', tr.requested_vehicle_type,
      'estimated_distance',     tr.estimated_distance,
      'estimated_duration',     tr.estimated_duration,
      'service_name',           st.service_name
    )
  END AS transportation_requests,
  CASE WHEN lat.trip_id IS NULL THEN NULL ELSE
    json_build_object(
      'trip_id',         lat.trip_id,
      'trip_status',     lat.trip_status,
      'start_time',      lat.start_time,
      'end_time',        lat.end_time,
      'distance',        lat.distance,
      'actual_duration', lat.actual_duration,
      'start_odometer',  lat.start_odometer,
      'end_odometer',    lat.end_odometer,
      'fuel_consumed',   lat.fuel_consumed,
      'avg_speed',       lat.avg_speed
    )
  END AS latest_trip`;

const JOINS = `
  FROM dispatchschedules ds
  LEFT JOIN vehicles v   ON ds.vehicle_id = v.vehicle_id
  LEFT JOIN drivers d    ON ds.driver_id = d.driver_id
  LEFT JOIN employees de ON d.employee_id = de.employee_id
  LEFT JOIN routes r     ON ds.route_id = r.route_id
  LEFT JOIN transportation_requests tr
    ON ds.request_id = tr.request_id AND tr.deleted_at IS NULL
  LEFT JOIN service_types st ON tr.service_type_id = st.service_type_id
  LEFT JOIN LATERAL (
    SELECT * FROM trips t
    WHERE t.dispatch_id = ds.dispatch_id AND t.deleted_at IS NULL
    ORDER BY t.created_at DESC
    LIMIT 1
  ) lat ON TRUE`;

const ROLES = ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"];

export async function GET(req, { params }) {
  try {
    const session = await requireAuth(req, ROLES);
    const id = (await params).id;

    // Throws 404 when the dispatch is not the caller's own.
    await assertDispatchOwnership(session, id);

    const { rows } = await query(
      `SELECT ${JOIN_SELECT} ${JOINS} WHERE ds.dispatch_id = $1 AND ds.deleted_at IS NULL LIMIT 1`,
      [id]
    );
    if (!rows[0]) return err("Dispatch not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

const WRITABLE_COLUMNS = [
  "reservation_id",
  "vehicle_id",
  "driver_id",
  "route_id",
  "scheduled_departure",
  "scheduled_arrival",
  "actual_departure",
  "actual_arrival",
  "estimated_distance",
  "estimated_duration",
  "status",
  "priority",
  "notes",
];

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const id = (await params).id;
    const body = await parseBody(req);

    const errors = validateBody(body, {
      vehicle_id: { type: "id", label: "Vehicle" },
      driver_id: { type: "id", label: "Driver" },
      reservation_id: { type: "id", label: "Reservation" },
      route_id: { type: "id", label: "Route" },
      scheduled_departure: { type: "date", label: "Scheduled departure" },
      scheduled_arrival: { type: "date", label: "Scheduled arrival" },
      actual_departure: { type: "date", label: "Actual departure" },
      actual_arrival: { type: "date", label: "Actual arrival" },
      status: { maxLength: 30, label: "Status" },
      dispatch_number: { maxLength: 50, label: "Dispatch number" },
      notes: { maxLength: 1000, label: "Notes" },
    });
    if (!isValidObject(errors)) {
      return errValidation(errors);
    }

    const { rows: before } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`, [id]);

    const columns = [];
    const values = [];
    for (const key of WRITABLE_COLUMNS) {
      if (body[key] !== undefined) {
        columns.push(key);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No updatable fields provided", 400);

    const assignments = columns.map((c, i) => `${c} = $${i + 1}`);
    assignments.push(`updated_at = NOW()`, `updated_by = $${columns.length + 1}`);
    values.push(session.user.employeeId);

    const { rows } = await query(
      `UPDATE dispatchschedules SET ${assignments.join(", ")} WHERE dispatch_id = $${values.length + 1} AND deleted_at IS NULL RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Dispatch not found", 404);
    const vid = body.vehicle_id || before[0]?.vehicle_id, did = body.driver_id || before[0]?.driver_id;
    const p = []; if (vid) p.push(syncVehicleStatus(vid)); if (did) p.push(syncDriverStatus(did)); if (rows[0]?.reservation_id) p.push(syncDispatchReservation(id)); if (rows[0]?.status === "Scheduled" || rows[0]?.status === "In Progress") p.push(ensureTripForDispatch(id)); await Promise.all(p);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
