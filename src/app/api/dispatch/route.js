import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, ensureTripForDispatch } from "@/services/status.service";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { writeAudit } from "@/lib/audit";
import { findDispatchConflicts } from "@/lib/scheduling/conflicts";
import { isExpired, isExpiredOn, toCalendarDay } from "@/lib/dates";
import { enforceCoding } from "@/lib/uvvrp/uvvrp.service";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation } from "@/services/reservation-lifecycle.service";

const JOIN_SELECT = `ds.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers, row_to_json(vr.*) as vehiclereservations, row_to_json(r.*) as routes`;
const JOINS = `FROM dispatchschedules ds LEFT JOIN vehicles v ON ds.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON ds.driver_id = d.driver_id LEFT JOIN vehiclereservations vr ON ds.reservation_id = vr.reservation_id LEFT JOIN routes r ON ds.route_id = r.route_id`;

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management", "driver"]);
    const sp = new URL(req.url).searchParams;
    let sql = `SELECT ${JOIN_SELECT} ${JOINS} WHERE ds.deleted_at IS NULL`;
    const params = []; let idx = 1;
    const status = sp.get("status"); if (status) { sql += ` AND ds.status = $${idx++}`; params.push(status); }
    const date = sp.get("date"); if (date) { sql += ` AND ds.scheduled_departure >= $${idx} AND ds.scheduled_departure <= $${idx+1}`; params.push(`${date}T00:00:00`, `${date}T23:59:59`); idx += 2; }
    const dn = sp.get("dispatch_number"); if (dn) { sql += ` AND ds.dispatch_number ILIKE $${idx++}`; params.push(`%${dn}%`); }
    sql += " ORDER BY ds.scheduled_departure DESC";
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) { return handleError(e); }
}

export async function POST(req) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const body = await parseBody(req);

    // Dispatch may originate from an approved Booking transportation request.
    // request_id is persisted on the dispatch row so trip completion can notify
    // Booking. Coerce/validate it here and gate on the request being Approved.
    const requestId = Number.isInteger(body.request_id) || /^\d+$/.test(String(body.request_id ?? ""))
      ? Number(body.request_id)
      : null;

    let transportRequest = null;
    if (requestId) {
      const { rows: trRows } = await query(
        `SELECT * FROM transportation_requests WHERE request_id = $1 AND deleted_at IS NULL`,
        [requestId]
      );
      transportRequest = trRows[0];
      if (!transportRequest) return err("Transportation request not found", 404);
      // Dispatch requires a request that has cleared review. Scheduled/Assigned
      // are also accepted because the assign endpoint may have already moved it
      // there — dispatching such a request is a re-dispatch, not an error.
      if (![L.APPROVED, L.SCHEDULED, L.ASSIGNED].includes(transportRequest.fleet_status)) {
        return err(
          `This request is '${transportRequest.fleet_status}'. Only Approved requests can be dispatched.`,
          409
        );
      }
    }

    const errors = validateBody(body, {
      vehicle_id: { type: "id", label: "Vehicle" },
      driver_id: { type: "id", label: "Driver" },
      reservation_id: { type: "id", label: "Reservation" },
      route_id: { type: "id", label: "Route" },
      scheduled_departure: { required: true, type: "date", label: "Scheduled departure" },
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

    const allowedKeys = new Set([
      "vehicle_id", "driver_id", "reservation_id", "request_id", "route_id", "scheduled_departure",
      "scheduled_arrival", "actual_departure", "actual_arrival", "status",
      "dispatch_number", "notes", "priority",
    ]);
    for (const key of Object.keys(body)) {
      if (!allowedKeys.has(key)) delete body[key];
    }
    // Normalize request_id to the validated integer (or drop it entirely).
    if (requestId) body.request_id = requestId;
    else delete body.request_id;

    if (body.vehicle_id) {
      const { rows: vehicles } = await query(
        `SELECT vehicle_id, plate_number, registration_expiry, insurance_expiry, vehicle_status FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [body.vehicle_id]
      );
      const vehicle = vehicles[0];
      if (!vehicle) return err("Vehicle not found", 404);
      const vehicleTravelExpired = (expiry) => (body.scheduled_departure ? isExpiredOn(expiry, body.scheduled_departure) : isExpired(expiry));
      if (vehicleTravelExpired(vehicle.registration_expiry)) {
        return err(`Vehicle ${vehicle.plate_number} registration ${isExpired(vehicle.registration_expiry) ? "has expired" : "expires"} (${toCalendarDay(vehicle.registration_expiry)}) before this trip.`, 400);
      }
      if (vehicleTravelExpired(vehicle.insurance_expiry)) {
        return err(`Vehicle ${vehicle.plate_number} insurance ${isExpired(vehicle.insurance_expiry) ? "has expired" : "expires"} (${toCalendarDay(vehicle.insurance_expiry)}) before this trip.`, 400);
      }
      if (["Under Maintenance", "Decommissioned", "Registration Expired"].includes(vehicle.vehicle_status)) {
        return err(`Vehicle ${vehicle.plate_number} cannot be dispatched (status: ${vehicle.vehicle_status}).`, 400);
      }

      // Number coding (UVVRP): block/warn/defer per the active policy.
      if (body.scheduled_departure) {
        const coding = await enforceCoding({
          vehicleId: body.vehicle_id,
          plateNumber: vehicle.plate_number,
          scheduledDeparture: body.scheduled_departure,
          createdBy: session.user?.employeeId ?? null,
        });
        if (!coding.ok) return err(coding.message, coding.status);
      }
    }

    if (body.driver_id) {
      const { rows: drivers } = await query(
        `SELECT d.driver_id, d.license_expiry, d.driver_status, e.first_name, e.last_name FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [body.driver_id]
      );
      const driver = drivers[0];
      if (!driver) return err("Driver not found", 404);
      const driverTravelExpired = (expiry) => (body.scheduled_departure ? isExpiredOn(expiry, body.scheduled_departure) : isExpired(expiry));
      if (driverTravelExpired(driver.license_expiry)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} license ${isExpired(driver.license_expiry) ? "has expired" : "expires"} (${toCalendarDay(driver.license_expiry)}) before this trip.`, 400);
      }
      if (["Suspended", "On Leave", "Off Duty"].includes(driver.driver_status)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} cannot be dispatched (status: ${driver.driver_status}).`, 400);
      }
    }

    const k = Object.keys(body), v = Object.values(body);
    // Block double-booking: reject if this vehicle or driver already has an
    // overlapping active dispatch in the requested departure/arrival window.
    if ((body.vehicle_id || body.driver_id) && body.scheduled_departure) {
      const conflicts = await findDispatchConflicts({
        vehicleId: body.vehicle_id || null,
        driverId: body.driver_id || null,
        departure: body.scheduled_departure,
        arrival: body.scheduled_arrival || null,
      });
      if (conflicts.length > 0) {
        const c = conflicts[0];
        const who = c.vehicle_id && c.vehicle_id === body.vehicle_id ? "vehicle" : "driver";
        return err(`This ${who} is already dispatched (${c.dispatch_number || `#${c.dispatch_id}`}) during that time window.`, 409);
      }
    }
    const { rows } = await query(`INSERT INTO dispatchschedules (${k.join(", ")}) VALUES (${k.map((_,i)=>`$${i+1}`).join(", ")}) RETURNING *`, v);
    const p = []; if (rows[0]?.vehicle_id) p.push(syncVehicleStatus(rows[0].vehicle_id)); if (rows[0]?.driver_id) p.push(syncDriverStatus(rows[0].driver_id)); if (rows[0]?.status === "Scheduled" || rows[0]?.status === "In Progress") p.push(ensureTripForDispatch(rows[0].dispatch_id)); await Promise.all(p);
    await writeAudit(req, session, { action: "create", resource: "dispatchschedules", resourceId: rows[0]?.dispatch_id, newValues: rows[0] });

    // If this dispatch fulfils an approved Booking request, advance it and
    // notify Booking. A dispatch that names both a vehicle and a driver has
    // committed those resources, so the request lands on Assigned; otherwise it
    // rests at Scheduled. advanceReservation walks each hop and writes the
    // timeline. Best-effort — a sync hiccup must not fail the dispatch that
    // already committed.
    if (transportRequest) {
      try {
        const committed = rows[0]?.vehicle_id && rows[0]?.driver_id;
        const target = committed ? L.ASSIGNED : L.SCHEDULED;

        await advanceReservation({
          requestId: transportRequest.request_id,
          toStatus: target,
          session,
          eventType: E.DISPATCH_CREATED,
          description: `Dispatch ${rows[0]?.dispatch_number || `#${rows[0]?.dispatch_id}`} created.`,
          metadata: {
            dispatch_id: rows[0]?.dispatch_id,
            dispatch_number: rows[0]?.dispatch_number,
            vehicle_id: rows[0]?.vehicle_id ?? null,
            driver_id: rows[0]?.driver_id ?? null,
          },
          patch: {
            reservation_id: transportRequest.reservation_id ?? rows[0]?.reservation_id ?? null,
            vehicle_id: rows[0]?.vehicle_id ?? null,
            driver_id: rows[0]?.driver_id ?? null,
          },
        });
      } catch (e) {
        console.warn("dispatch->request sync failed:", e?.message || e);
      }
    }

    return ok(rows[0], 201);
  } catch (e) { return handleError(e); }
}
