import { query, withTransaction } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { canTransitionTrip, isValidTripStatus } from "@/lib/scheduling/trip-state";
import { canTransitionDispatch, isValidDispatchStatus } from "@/lib/scheduling/dispatch-state";
import { syncVehicleStatus, syncDriverStatus, ensureTripForDispatch } from "@/services/status.service";
import { writeAudit } from "@/lib/audit";

// Centralized state-transition layer for trips and dispatches.
//
// Every status change funnels through here so the sequence is identical:
//   1. validate the hop against the state machine,
//   2. persist the row,
//   3. reconcile derived resources (vehicle/driver availability, dispatch trip,
//      booking request) — best-effort, never rolls back,
//   4. write an audit row.
//
// Domain-specific terminal transitions (trip completion with odometer maths,
// cancellation with the booking-request cascade) live in trip-lifecycle.service
// because they carry extra data and side-effects; this module owns the simple,
// mid-lifecycle forward hops and dispatch status moves.

/**
 * Advance a trip through a mid-lifecycle hop (At Pickup / Passenger Onboard /
 * En Route / Drop-off / Arrived). Completion and cancellation are handled by
 * completeTrip / cancelTrip. Validates via canTransitionTrip.
 *
 * @param {object}   params
 * @param {number|string} params.tripId
 * @param {string}   params.to              target trip_status
 * @param {object}   params.session
 * @param {string}   [params.reason]
 * @param {object}   [params.extra]         additional columns to set on the trips row
 * @param {boolean}  [params.busy]          run the In-Progress dispatch/request sync
 * @returns {Promise<object>} updated trip row
 */
export async function setTripStatus({ tripId, to, session, reason = null, extra = {}, busy = false }) {
  if (!isValidTripStatus(to)) {
    throw new AuthError(`"${to}" is not a valid trip status.`, 400);
  }
  const { rows: before } = await query(
    `SELECT trip_id, trip_status, vehicle_id, driver_id, dispatch_id FROM trips WHERE trip_id = $1 LIMIT 1`,
    [tripId]
  );
  if (!before[0]) throw new AuthError("Trip not found", 404);

  const check = canTransitionTrip(before[0].trip_status, to);
  if (!check.ok) throw new AuthError(check.reason, 409);

  const sets = ["trip_status = $1", "updated_at = NOW()"];
  const values = [to];
  const allowedExtra = Object.entries(extra || {});
  for (const [col, val] of allowedExtra) {
    sets.push(`${col} = $${values.length + 1}`);
    values.push(val);
  }
  values.push(tripId);
  const { rows } = await query(
    `UPDATE trips SET ${sets.join(", ")} WHERE trip_id = $${values.length} RETURNING *`,
    values
  );
  if (!rows[0]) throw new AuthError("Trip not found", 404);

  // Reconcile derived resources. The trip row is committed; a failure here is
  // best-effort and self-heals on the next sync.
  const p = [];
  if (before[0]?.vehicle_id) p.push(syncVehicleStatus(before[0].vehicle_id).catch(() => {}));
  if (before[0]?.driver_id) p.push(syncDriverStatus(before[0].driver_id).catch(() => {}));
  if (before[0]?.dispatch_id) {
    if (busy) {
      await withTransaction(async (tx) => {
        await tx.query(
          `UPDATE dispatchschedules SET status = 'In Progress' WHERE dispatch_id = $1`,
          [before[0].dispatch_id]
        );
      }).catch(() => {});
      await advanceRequest(before[0].dispatch_id, session, before[0].trip_id).catch(() => {});
    }
  }
  await Promise.all(p);

  await writeAudit(null, session, {
    action: "update",
    resource: "trips",
    resourceId: tripId,
    oldValues: { trip_status: before[0].trip_status, reason },
    newValues: { trip_status: to },
  });

  return rows[0];
}

/**
 * Change a dispatch's status. Validates via canTransitionDispatch.
 *
 * `Pending Reassignment` → `Scheduled` when reassigning, or `Cancelled` when a
 * dispatch is stood down. Completion is driven by trip completion and handled
 * elsewhere.
 *
 * @param {object}   params
 * @param {number|string} params.dispatchId
 * @param {string}   params.to
 * @param {object}   params.session
 * @param {string}   [params.reason]
 * @returns {Promise<object>} updated dispatch row
 */
export async function setDispatchStatus({ dispatchId, to, session, reason = null }) {
  if (!isValidDispatchStatus(to)) {
    throw new AuthError(`"${to}" is not a valid dispatch status.`, 400);
  }
  const { rows: before } = await query(
    `SELECT dispatch_id, status, vehicle_id, driver_id, request_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`,
    [dispatchId]
  );
  if (!before[0]) throw new AuthError("Dispatch not found", 404);

  const check = canTransitionDispatch(before[0].status, to);
  if (!check.ok) throw new AuthError(check.reason, 409);

  const { rows } = await query(
    `UPDATE dispatchschedules SET status = $1, cancel_reason = $2, updated_at = NOW() WHERE dispatch_id = $3 RETURNING *`,
    [to, to === "Cancelled" ? (reason?.trim() || null) : null, dispatchId]
  );
  if (!rows[0]) throw new AuthError("Dispatch not found", 404);

  const p = [];
  if (rows[0]?.vehicle_id) p.push(syncVehicleStatus(rows[0].vehicle_id).catch(() => {}));
  if (rows[0]?.driver_id) p.push(syncDriverStatus(rows[0].driver_id).catch(() => {}));
  if (to === "Scheduled" || to === "In Progress") p.push(ensureTripForDispatch(dispatchId).catch(() => {}));
  await Promise.all(p);

  // Cancelling a dispatch stands down its open trips and cancels the underlying
  // transportation request. Best-effort — the dispatch flip is already committed.
  if (to === "Cancelled") {
    await query(
      `UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW()
        WHERE dispatch_id = $1 AND deleted_at IS NULL
          AND trip_status NOT IN ('Completed', 'Cancelled')`,
      [dispatchId]
    ).catch(() => {});
    await cancelRequestForDispatch(dispatchId, session, reason).catch((e) =>
      console.warn("dispatch-cancel -> request Cancelled sync failed:", e?.message || e)
    );
  }

  await writeAudit(null, session, {
    action: "update",
    resource: "dispatchschedules",
    resourceId: dispatchId,
    oldValues: { status: before[0].status, reason },
    newValues: { status: to },
  });

  return rows[0];
}

/** Advance the transportation request behind a dispatch to Cancelled. */
async function cancelRequestForDispatch(dispatchId, session, reason) {
  const { rows } = await query(
    `SELECT request_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`,
    [dispatchId]
  );
  const requestId = rows[0]?.request_id;
  if (!requestId) return;
  const { advanceReservation } = await import("@/services/reservation-lifecycle.service");
  const constants = await import("@/lib/constants");
  const L = constants.RESERVATION_LIFECYCLE;
  const E = constants.RESERVATION_EVENT;
  await advanceReservation({
    requestId,
    toStatus: L.CANCELLED,
    session,
    eventType: E.CANCELLED,
    description: reason || "Dispatch cancelled.",
    metadata: { dispatch_id: dispatchId },
    patch: { status_reason: reason },
  });
}

/** Advance the transportation request behind a dispatch to In Progress. */
async function advanceRequest(dispatchId, session, tripId) {
  const { rows } = await query(
    `SELECT request_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`,
    [dispatchId]
  );
  const requestId = rows[0]?.request_id;
  if (!requestId) return;
  const { advanceReservation } = await import("@/services/reservation-lifecycle.service");
  const constants = await import("@/lib/constants");
  const L = constants.RESERVATION_LIFECYCLE;
  const E = constants.RESERVATION_EVENT;
  await advanceReservation({
    requestId,
    toStatus: L.IN_PROGRESS,
    session,
    eventType: E.TRIP_STARTED,
    description: `Trip #${tripId} started.`,
    metadata: { trip_id: tripId, dispatch_id: dispatchId },
  });
}

