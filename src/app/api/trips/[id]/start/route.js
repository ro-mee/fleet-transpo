import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";
import { isExpired, toCalendarDay } from "@/lib/dates";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { writeAudit } from "@/lib/audit";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const trip = await assertTripOwnership(session, id);

    const gate = canTransitionTrip(trip.trip_status, "Trip Started");
    if (!gate.ok) return err(gate.reason, 409);

    let vehicleMileage = null;
    if (trip.vehicle_id) {
      const { rows: vehicles } = await query(
        `SELECT plate_number, registration_expiry, vehicle_status, mileage FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [trip.vehicle_id]
      );
      const vehicle = vehicles[0];
      vehicleMileage = vehicle?.mileage ?? null;
      if (isExpired(vehicle?.registration_expiry)) {
        return err(`Vehicle ${vehicle.plate_number} has an expired registration (${toCalendarDay(vehicle.registration_expiry)}). Trip cannot start.`, 400);
      }
      if (["Under Maintenance", "Decommissioned", "Registration Expired"].includes(vehicle?.vehicle_status)) {
        return err(`Vehicle ${vehicle.plate_number} cannot start a trip (status: ${vehicle.vehicle_status}).`, 400);
      }
    }

    if (trip.driver_id) {
      const { rows: drivers } = await query(
        `SELECT d.license_expiry, d.driver_status, e.first_name, e.last_name FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [trip.driver_id]
      );
      const driver = drivers[0];
      if (isExpired(driver?.license_expiry)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} has an expired license (${toCalendarDay(driver.license_expiry)}). Trip cannot start.`, 400);
      }
      if (["Suspended", "On Leave"].includes(driver?.driver_status)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} cannot start a trip (status: ${driver.driver_status}).`, 400);
      }
    }

    // Type-narrowed at the boundary before validation: Number() coerces `true`
    // to 1 and `[]` to 0, either of which would sail through as a reading.
    const rawOdometer =
      typeof body.odometer === "number" || typeof body.odometer === "string" ? body.odometer : null;
    const odo = validateOdometerReading({
      reading: rawOdometer,
      currentMileage: vehicleMileage,
    });
    if (!odo.ok) return err(odo.error, 400);

    const { rows } = await query(`UPDATE trips SET trip_status = 'Trip Started', start_time = NOW(), start_odometer = $1 WHERE trip_id = $2 RETURNING *`, [rawOdometer, id]);
    if (!rows[0]) return err("Trip not found", 404);
    const p = [];
    // Feed the odometer back into the vehicle. GREATEST is a second guard
    // beyond the validation above: a late-arriving low reading from a retried
    // request must never regress mileage, because that defers every
    // mileage-based service due-date on the vehicle.
    if (trip?.vehicle_id && rows[0]?.start_odometer !== null) {
      p.push(query(
        `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
        [rows[0].start_odometer, trip.vehicle_id]
      ));
    }
    if (trip?.vehicle_id) p.push(syncVehicleStatus(trip.vehicle_id));
    if (trip?.driver_id) p.push(syncDriverStatus(trip.driver_id));
    if (trip?.dispatch_id) {
      p.push(query(`UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`, [trip.dispatch_id]));
      p.push(syncDispatchReservation(trip.dispatch_id));
    }
    await Promise.all(p);

    // A flagged reading is accepted — an implausible jump is not proof of an
    // error, and refusing it would strand a driver who cannot start their trip.
    // But it has to leave a record someone can find. A console.warn does not:
    // it lives in a server process nobody reads, and the reading it describes
    // has already been fed into vehicles.mileage, where it shifts every
    // mileage-based service due-date on the vehicle. This writes it to
    // audit_logs against the vehicle, which is the row the anomaly is about.
    // Best-effort by design: writeAudit never throws.
    if (odo.flagged) {
      await writeAudit(req, session, {
        action: "flag",
        resource: "vehicles",
        resourceId: trip?.vehicle_id,
        oldValues: { mileage: vehicleMileage },
        newValues: { start_odometer: rows[0]?.start_odometer ?? null, trip_id: rows[0]?.trip_id ?? id, reason: odo.reason },
      });
    }

    // A started trip means the underlying Booking request is now In Progress.
    // Before this hop existed, nothing advanced a request past Assigned, so
    // In Progress was unreachable. advanceReservation walks Scheduled→Assigned→
    // In Progress if the request is behind, so a trip started from a partially
    // assigned dispatch still lands correctly.
    // Best-effort: the trip has already started regardless of sync outcome.
    if (trip?.dispatch_id) {
      try {
        const request = await findRequestForDispatch(trip.dispatch_id);
        if (request) {
          await advanceReservation({
            requestId: request.request_id,
            toStatus: L.IN_PROGRESS,
            session,
            eventType: E.TRIP_STARTED,
            description: `Trip #${rows[0]?.trip_id} started.`,
            metadata: {
              trip_id: rows[0]?.trip_id,
              dispatch_id: trip.dispatch_id,
              start_odometer: rows[0]?.start_odometer ?? null,
            },
          });
        }
      } catch (e) {
        console.warn("trip-start -> request In Progress sync failed:", e?.message || e);
      }
    }

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
