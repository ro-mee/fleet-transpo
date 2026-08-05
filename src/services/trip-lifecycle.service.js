import { query } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { syncVehicleStatus, syncDriverStatus, syncDispatchReservation } from "@/services/status.service";
import { writeAudit } from "@/lib/audit";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, findRequestForDispatch } from "@/services/reservation-lifecycle.service";
import { validateOdometerReading } from "@/lib/vehicles/odometer";

const TERMINAL = new Set(["Completed", "Cancelled"]);

/**
 * Complete a trip.
 *
 * Extracted verbatim from PUT /api/trips/[id]/complete. The route hands us the
 * already-parsed, boundary-narrowed inputs (endOdometer, distance) plus the
 * authenticated session; the service owns the odometer validation, the single
 * UPDATE, the odometer/driver/dispatch cascade and the request completion.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @param {object}        [params]
 * @param {number|string} [params.endOdometer]
 * @param {number|string} [params.distance]
 * @returns {Promise<object>} the updated trip row
 */
export async function completeTrip(tripId, session, { endOdometer, distance } = {}) {
  const { rows: before } = await query(
    `SELECT t.vehicle_id, t.driver_id, t.dispatch_id, t.trip_status, v.mileage AS vehicle_mileage
       FROM trips t
       LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id AND v.deleted_at IS NULL
      WHERE t.trip_id = $1
      LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);
  if (TERMINAL.has(before[0].trip_status)) {
    throw new AuthError(`Trip is already ${before[0].trip_status} and cannot be completed.`, 409);
  }
  // Validate before writing. A reading below current mileage would walk the
  // odometer backwards and silently defer every due-date on this vehicle.
  // Narrowed at the boundary first: Number() coerces `true` to 1 and `[]` to
  // 0, so an untyped body could otherwise pass as a plausible reading.
  const rawEndOdometer =
    typeof endOdometer === "number" || typeof endOdometer === "string" ? endOdometer : null;
  const odo = validateOdometerReading({
    reading: rawEndOdometer,
    currentMileage: before[0].vehicle_mileage,
  });
  if (!odo.ok) throw new AuthError(odo.error, 400);

  // Distance comes from the caller. The route derives it from a start reading
  // when one exists and otherwise falls back to the supplied distance; the
  // service receives the already-resolved value. A NULL/NaN distance must not
  // clear a figure someone already recorded, so COALESCE keeps the existing
  // value below.
  const suppliedDistance = Number(distance);
  const dist = Number.isFinite(suppliedDistance) ? suppliedDistance : null;
  // COALESCE keeps whatever distance the trip already had: an unusable
  // reading must not clear a figure someone already recorded.
  //
  // actual_duration is derived in the same statement rather than a follow-up
  // query, so it can never drift from end_time — NOW() is one value per
  // statement. The CASE leaves trips that never started untouched: a duration
  // measured from a NULL start_time is a number with nothing behind it, and a
  // dimension with no data should stay absent rather than read as zero.
  // GREATEST(0, ...) absorbs clock skew between the two timestamps.
  const { rows } = await query(
    `UPDATE trips
        SET trip_status = 'Completed',
            end_time = NOW(),
            end_odometer = $1,
            distance = COALESCE($2, distance),
            actual_duration = CASE
              WHEN start_time IS NOT NULL
                THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (NOW() - start_time)) / 60))::int
              ELSE actual_duration
            END
      WHERE trip_id = $3
      RETURNING *`,
    [rawEndOdometer, dist, tripId]
  );
  if (!rows[0]) throw new AuthError("Trip not found", 404);
  const p = [];
  // Feed the odometer back into the vehicle. GREATEST is a second guard
  // beyond the validation above: a late-arriving low reading from a retried
  // request must never regress mileage, because that defers every
  // mileage-based service due-date on the vehicle.
  if (before[0]?.vehicle_id && rows[0]?.end_odometer !== null) {
    p.push(query(
      `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
      [rows[0].end_odometer, before[0].vehicle_id]
    ));
  }
  if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
  if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
  if (before[0]?.dispatch_id) {
    p.push(query(`UPDATE dispatchschedules SET status = 'Completed' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
    p.push(syncDispatchReservation(before[0].dispatch_id));
  }
  await Promise.all(p);
  await writeAudit(null, session, { action: "update", resource: "trips", resourceId: tripId, oldValues: { trip_status: before[0].trip_status }, newValues: { trip_status: "Completed" } });

  // A flagged reading is accepted — an implausible jump is not proof of an
  // error, and refusing it would strand a driver who cannot close their trip.
  // But it has to leave a record someone can find. A console.warn does not:
  // it lives in a server process nobody reads, and the reading it describes
  // has already been fed into vehicles.mileage, where it shifts every
  // mileage-based due-date on the vehicle. This writes it to audit_logs
  // against the vehicle, which is the row the anomaly is about and the one a
  // reviewer would be looking at. Best-effort by design: writeAudit never
  // throws, so a failed audit cannot block trip completion.
  if (odo.flagged) {
    await writeAudit(null, session, {
      action: "flag",
      resource: "vehicles",
      resourceId: before[0].vehicle_id,
      oldValues: { mileage: before[0].vehicle_mileage },
      newValues: { end_odometer: rows[0]?.end_odometer ?? null, trip_id: rows[0]?.trip_id ?? tripId, reason: odo.reason },
    });
  }

  // A completed trip closes the Booking request. advanceReservation walks
  // In Progress→Completed, writing the timeline and notifying Booking.
  // Best-effort: the trip is already completed regardless of sync outcome.
  if (before[0]?.dispatch_id) {
    try {
      const request = await findRequestForDispatch(before[0].dispatch_id);
      if (request) {
        await advanceReservation({
          requestId: request.request_id,
          toStatus: L.COMPLETED,
          session,
          eventType: E.TRIP_COMPLETED,
          description: `Trip completed.`,
          metadata: {
            trip_id: rows[0]?.trip_id,
            dispatch_id: before[0].dispatch_id,
            end_odometer: rows[0]?.end_odometer ?? null,
            distance: rows[0]?.distance ?? null,
          },
        });
      }
    } catch (e) {
      console.warn("trip-complete -> request Completed sync failed:", e?.message || e);
    }
  }

  return rows[0];
}

/**
 * Cancel a trip.
 *
 * Terminal trips are locked. Non-terminal trips flip to Cancelled, then the
 * dispatch, vehicle, driver and request are reconciled best-effort — a failed
 * sync must never block the cancellation itself.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @param {object}        [params]
 * @param {string|null}   [params.reason]
 * @returns {Promise<object>} the updated trip row
 */
export async function cancelTrip(tripId, session, { reason = null } = {}) {
  const { rows: before } = await query(
    `SELECT vehicle_id, driver_id, dispatch_id, trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);
  if (TERMINAL.has(before[0].trip_status)) {
    throw new AuthError(`Trip is already ${before[0].trip_status} and cannot be cancelled.`, 409);
  }

  const { rows } = await query(
    `UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW() WHERE trip_id = $1 RETURNING *`,
    [tripId]
  );
  if (!rows[0]) throw new AuthError("Trip not found", 404);

  // Best-effort cascade: the trip row is already written, so a failure here
  // is logged and swallowed rather than rolled back — cancellation stands.
  try {
    const p = [];
    if (before[0]?.dispatch_id) {
      p.push(query(`UPDATE dispatchschedules SET status = 'Cancelled' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
    }
    if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
    if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
    if (before[0]?.dispatch_id) p.push(syncDispatchReservation(before[0].dispatch_id));
    await Promise.all(p);
  } catch (e) {
    console.warn("trip-cancel -> status sync failed:", e?.message || e);
  }

  // A cancelled trip cancels the underlying Booking request. Best-effort:
  // the trip is already cancelled regardless of sync outcome.
  if (before[0]?.dispatch_id) {
    try {
      const request = await findRequestForDispatch(before[0].dispatch_id);
      if (request) {
        await advanceReservation({
          requestId: request.request_id,
          toStatus: L.CANCELLED,
          session,
          eventType: E.CANCELLED,
          description: reason || "Trip cancelled.",
          metadata: { trip_id: rows[0]?.trip_id, dispatch_id: before[0].dispatch_id, reason },
          patch: { status_reason: reason },
        });
      }
    } catch (e) {
      console.warn("trip-cancel -> request Cancelled sync failed:", e?.message || e);
    }
  }

  await writeAudit(null, session, {
    action: "update",
    resource: "trips",
    resourceId: tripId,
    oldValues: { trip_status: before[0].trip_status },
    newValues: { trip_status: "Cancelled" },
  });

  return rows[0];
}

/**
 * Sync the resources behind a trip that is now busy (Trip Started / En Route /
 * Arrived / In Progress). Mirrors the tail of PUT /api/trips/[id]/start: the
 * dispatch moves to In Progress and the vehicle, driver and request are
 * reconciled. The trip row itself is written by the caller — this only keeps
 * everything downstream consistent.
 *
 * @param {number|string} tripId
 * @param {object}        session
 * @returns {Promise<object>} the trip row
 */
export async function syncBusyTrip(tripId, session) {
  const { rows: before } = await query(
    `SELECT trip_id, vehicle_id, driver_id, dispatch_id, start_odometer FROM trips WHERE trip_id = $1 LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);

  const p = [];
  if (before[0]?.dispatch_id) {
    p.push(query(`UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`, [before[0].dispatch_id]));
  }
  if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id));
  if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id));
  if (before[0]?.dispatch_id) p.push(syncDispatchReservation(before[0].dispatch_id));
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
          description: `Trip #${before[0].trip_id} started.`,
          metadata: {
            trip_id: before[0].trip_id,
            dispatch_id: before[0].dispatch_id,
            start_odometer: before[0].start_odometer ?? null,
          },
        });
      }
    } catch (e) {
      console.warn("trip-busy -> request In Progress sync failed:", e?.message || e);
    }
  }

  return before[0];
}
