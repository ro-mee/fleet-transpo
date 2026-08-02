import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";
import { isExpired, toCalendarDay } from "@/lib/dates";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const { rows: before } = await query(`SELECT vehicle_id, driver_id, dispatch_id, trip_status FROM trips WHERE trip_id = $1 LIMIT 1`, [id]);
    if (!before[0]) return err("Trip not found", 404);

    const gate = canTransitionTrip(before[0].trip_status, "Trip Started");
    if (!gate.ok) return err(gate.reason, 409);

    if (before[0].vehicle_id) {
      const { rows: vehicles } = await query(
        `SELECT plate_number, registration_expiry, vehicle_status FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [before[0].vehicle_id]
      );
      const vehicle = vehicles[0];
      if (isExpired(vehicle?.registration_expiry)) {
        return err(`Vehicle ${vehicle.plate_number} has an expired registration (${toCalendarDay(vehicle.registration_expiry)}). Trip cannot start.`, 400);
      }
      if (["Under Maintenance", "Decommissioned", "Registration Expired"].includes(vehicle?.vehicle_status)) {
        return err(`Vehicle ${vehicle.plate_number} cannot start a trip (status: ${vehicle.vehicle_status}).`, 400);
      }
    }

    if (before[0].driver_id) {
      const { rows: drivers } = await query(
        `SELECT d.license_expiry, d.driver_status, e.first_name, e.last_name FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [before[0].driver_id]
      );
      const driver = drivers[0];
      if (isExpired(driver?.license_expiry)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} has an expired license (${toCalendarDay(driver.license_expiry)}). Trip cannot start.`, 400);
      }
      if (["Suspended", "On Leave"].includes(driver?.driver_status)) {
        return err(`Driver ${driver.first_name || ""} ${driver.last_name || ""} cannot start a trip (status: ${driver.driver_status}).`, 400);
      }
    }

    const { rows } = await query(`UPDATE trips SET trip_status = 'Trip Started', start_time = NOW(), start_odometer = $1 WHERE trip_id = $2 RETURNING *`, [body.odometer, id]);
    if (!rows[0]) return err("Trip not found", 404);
    const p = [];
    if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
    if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
    if (before[0]?.dispatch_id) {
      p.push(query(`UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
      p.push(syncDispatchReservation(before[0].dispatch_id));
    }
    await Promise.all(p);

    // A started trip means the underlying Booking request is now In Progress.
    // Before this hop existed, nothing advanced a request past Assigned, so
    // In Progress was unreachable. advanceReservation walks Scheduled→Assigned→
    // In Progress if the request is behind, so a trip started from a partially
    // assigned dispatch still lands correctly.
    // Best-effort: the trip has already started regardless of sync outcome.
    if (before[0]?.dispatch_id) {
      try {
        const request = await findRequestForDispatch(before[0].dispatch_id);
        if (request) {
          await advanceReservation({
            requestId: request.request_id,
            toStatus: L.IN_PROGRESS,
            session,
            eventType: E.TRIP_STARTED,
            description: `Trip #${rows[0]?.trip_id} started.`,
            metadata: {
              trip_id: rows[0]?.trip_id,
              dispatch_id: before[0].dispatch_id,
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
