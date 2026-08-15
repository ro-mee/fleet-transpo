import { query, withTransaction } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError, AuthError } from "@/lib/api/utils";
import { assertTripOwnership } from "@/lib/api/ownership";
import { syncVehicleStatus, syncDriverStatus } from "@/services/status.service";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";
import { isExpired, toCalendarDay } from "@/lib/dates";
import { validateOdometerReading } from "@/lib/vehicles/odometer";
import { writeAudit } from "@/lib/audit";
import { computeDepartureWindow } from "@/lib/scheduling/departure-window";
import { tomtomEtaMinutes, etaFromDistanceKm, haversineKm } from "@/lib/scheduling/travel-buffer";
import { mergeDispatchPolicy } from "@/lib/dispatch-policy";
import { driverBlockReason } from "@/lib/scheduling/driver-schedule";
import { loadDriverScheduleContext } from "@/services/driver-schedule.service";

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

    let tripDriverName = "";
    if (trip.driver_id) {
      const { rows: drivers } = await query(
        `SELECT d.license_expiry, d.driver_status, e.first_name, e.last_name FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [trip.driver_id]
      );
      const driver = drivers[0];
      tripDriverName = `${driver?.first_name || ""} ${driver?.last_name || ""}`.trim() || `#${trip.driver_id}`;
      if (isExpired(driver?.license_expiry)) {
        return err(`Driver ${tripDriverName} has an expired license (${toCalendarDay(driver.license_expiry)}). Trip cannot start.`, 400);
      }
      if (["Suspended", "On Leave"].includes(driver?.driver_status)) {
        return err(`Driver ${tripDriverName} cannot start a trip (status: ${driver.driver_status}).`, 400);
      }
    }

    // Pre-trip check gate: the driver must have a Passed inspection for THIS
    // trip. Per-trip by design — the mobile flow routes the driver through the
    // checklist before this endpoint is reachable, and the block is the
    // enforcement that makes the UI hint honest.
    const { rows: pretrips } = await query(
      `SELECT inspection_id FROM vehicleinspection
        WHERE trip_id = $1 AND status = 'Passed'
        ORDER BY created_at DESC LIMIT 1`,
      [id]
    );
    if (!pretrips[0]) {
      return err("Pre-trip inspection is required before starting this trip. Complete the checklist in the app first.", 400);
    }

    // Departure-window gate. The driver may not start before the recommended
    // departure minus the early-start allowance. Fail-open: when the dispatch
    // has no scheduled departure, or no ETA can be computed, the window is null
    // and no time block applies (the pre-trip gate above still holds).
    let window = null;
    const policy = mergeDispatchPolicy(
      (await query(
        `SELECT setting_value FROM system_settings WHERE setting_key = 'dispatch_policy' LIMIT 1`
      )).rows[0]?.setting_value
    );
    const { rows: dispatchRows } = await query(
      `SELECT scheduled_departure FROM dispatchschedules WHERE dispatch_id = $1 AND deleted_at IS NULL`,
      [trip.dispatch_id]
    );
    const pickup = dispatchRows[0]?.scheduled_departure ?? null;

    // Work-schedule / approved-leave gate (migration 049): a driver on leave,
    // rest day, without a schedule row, or outside their shift cannot start a
    // trip at this pickup time. Uses the scheduled departure as the window.
    if (trip.driver_id && pickup) {
      const scheduleCtx = await loadDriverScheduleContext([trip.driver_id]);
      const block = driverBlockReason({
        driverId: trip.driver_id,
        pickup,
        returnAt: null,
        ctx: scheduleCtx,
      });
      if (block?.blocked) {
        return err(`Driver ${tripDriverName} cannot start this trip: ${block.reason}`, 400);
      }
    }

    if (pickup) {
      // ETA = live routing from the driver's current position to the pickup
      // (trip origin). Fallbacks in order: TomTom route → straight-line
      // heuristic → the stored route/request estimate. All fail-open to null.
      let etaMinutes = null;
      const { rows: tripRoutes } = await query(
        `SELECT route_id FROM trips WHERE trip_id = $1 LIMIT 1`,
        [id]
      );
      const { rows: origins } = await query(
        `SELECT ol.latitude, ol.longitude FROM routes r
           LEFT JOIN locations ol ON ol.location_id = r.origin_location_id
          WHERE r.route_id = $1 LIMIT 1`,
        [tripRoutes[0]?.route_id ?? null]
      );
      const dest = origins[0]?.latitude != null
        ? [Number(origins[0].latitude), Number(origins[0].longitude)]
        : null;
      const { rows: pos } = await query(
        `SELECT current_latitude, current_longitude FROM drivers WHERE driver_id = $1 LIMIT 1`,
        [trip.driver_id]
      );
      const src = pos[0]?.current_latitude != null
        ? [Number(pos[0].current_latitude), Number(pos[0].current_longitude)]
        : null;
      if (src && dest) {
        etaMinutes = await tomtomEtaMinutes({ origin: src, destination: dest });
      }
      if (etaMinutes == null && src && dest) {
        etaMinutes = etaFromDistanceKm(haversineKm(src, dest));
      }
      if (etaMinutes == null) {
        const { rows: estimates } = await query(
          `SELECT COALESCE(r.estimated_duration, tr.estimated_duration) AS d
             FROM trips t
             LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
             LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
             LEFT JOIN routes r ON r.route_id = t.route_id
            WHERE t.trip_id = $1 LIMIT 1`,
          [id]
        );
        const d = Number(estimates[0]?.d);
        etaMinutes = Number.isFinite(d) && d > 0 ? d : null;
      }
      window = computeDepartureWindow({
        pickup,
        etaMinutes,
        departureBufferMinutes: policy.departureBufferMinutes,
        earlyStartAllowanceMinutes: policy.earlyStartAllowanceMinutes,
      });
    }
    if (window?.earliest_start && new Date() < window.earliest_start) {
      const t = window.earliest_start;
      const hhmm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
      return err(`Trip cannot start before ${hhmm} (recommended departure ${window.recommended_departure ? new Date(window.recommended_departure).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "n/a"}). You may start when the departure window opens.`, 409);
    }

    // Type-narrowed at the boundary before validation: Number() coerces `true`
    // to 1 and `[]` to 0, either of which would sail through as a reading.
    const rawOdometer =
      typeof body.odometer === "number" || typeof body.odometer === "string" ? body.odometer : null;
    // Odometer is OPTIONAL at start — a driver may begin without a reading, in
    // which case start_odometer stays NULL (same as legacy starts). Only a
    // PRESENT reading is validated, so a bad one is still rejected.
    const hasOdometer = rawOdometer !== null && rawOdometer !== undefined && rawOdometer !== "";
    const odo = hasOdometer
      ? validateOdometerReading({
          reading: rawOdometer,
          currentMileage: vehicleMileage,
        })
      : { ok: true, error: null, flagged: false, reason: null };
    if (!odo.ok) return err(odo.error, 400);

    // The trip row, its vehicle mileage and the dispatch are authoritative —
    // permanent facts that cannot be re-derived later, so they commit (or roll
    // back) together. The derived statuses run after COMMIT, best-effort.
    const { rows } = await withTransaction(async (tx) => {
      const r = await tx.query(`UPDATE trips SET trip_status = 'Trip Started', start_time = NOW(), start_odometer = $1 WHERE trip_id = $2 RETURNING *`, [rawOdometer, id]);
      if (!r.rows[0]) throw new AuthError("Trip not found", 404);
      const txWrites = [];
      // Feed the odometer back into the vehicle. GREATEST is a second guard
      // beyond the validation above: a late-arriving low reading from a retried
      // request must never regress mileage, because that defers every
      // mileage-based service due-date on the vehicle.
      if (trip?.vehicle_id && r.rows[0]?.start_odometer !== null) {
        txWrites.push(tx.query(
          `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
          [r.rows[0].start_odometer, trip.vehicle_id]
        ));
      }
      if (trip?.dispatch_id) {
        txWrites.push(tx.query(`UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`, [trip.dispatch_id]));
      }
      await Promise.all(txWrites);
      return r;
    });
    if (!rows[0]) return err("Trip not found", 404);
    // Audit the start transition itself (follow-up: every transition is audited).
    await writeAudit(req, session, {
      action: "update",
      resource: "trips",
      resourceId: id,
      oldValues: { trip_status: trip.trip_status },
      newValues: { trip_status: "Trip Started" },
    });
    // Derived statuses — recomputed on demand, self-heal on the next sync.
    const p = [];
    if (trip?.vehicle_id) p.push(syncVehicleStatus(trip.vehicle_id));
    if (trip?.driver_id) p.push(syncDriverStatus(trip.driver_id));
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
