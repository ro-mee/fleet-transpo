import { query, withTransaction } from "@/lib/db";
import { AuthError } from "@/lib/api/utils";
import { canTransitionTrip, isValidTripStatus } from "@/lib/scheduling/trip-state";
import { canTransitionDispatch, isValidDispatchStatus } from "@/lib/scheduling/dispatch-state";
import { isTerminalReservationStatus } from "@/lib/scheduling/reservation-state";
import { TRIP_STATUS, DISPATCH_STATUS, RESERVATION_LIFECYCLE, RESERVATION_EVENT } from "@/lib/constants";
import { checkPickupProximity, checkDestinationProximity } from "@/services/trip-geofence.service";
import { syncVehicleStatus, syncDriverStatus, ensureTripForDispatch } from "@/services/status.service";
import { writeAudit } from "@/lib/audit";
import { advanceReservation } from "@/services/reservation-lifecycle.service";
import { emitTransportStatus } from "@/services/outbound.service";

const DISPATCH_CANCELLED = DISPATCH_STATUS.CANCELLED;
// A stood-down dispatch RELEASES the request: the pair returns to the pool and
// the request re-enters the queue at Scheduled, exactly as the cancel dialogs
// promise. Cancelling the guest's request is a separate, explicit action.
const RELEASE_TO_STATUS = RESERVATION_LIFECYCLE.SCHEDULED;
const E = RESERVATION_EVENT;

// Arrival gates — a driver cannot claim to be somewhere the server's own GPS
// trail proves they are not. AT_PICKUP / PASSENGER_ONBOARD must sit inside the
// pickup geofence, DROP_OFF inside the destination geofence, evaluated from
// the trip's latest stored ping (never a client-supplied position).
// EN_ROUTE is deliberately ungated: it is the mid-leg consequence of onboard,
// and gating it on the pickup would 409 legitimate retries filed after the
// driver has already left the pickup area.
// Fail-open like the completion gate: `unknown` (no/stale/inaccurate fix,
// unresolvable point) never blocks. `outside` blocks with 409 unless the
// caller sends an explicit override WITH a reason, which is written to audit.
const PICKUP_GATED = new Set([TRIP_STATUS.AT_PICKUP, TRIP_STATUS.PASSENGER_ONBOARD]);

function formatGateDistance(meters) {
  const m = Number(meters);
  if (!Number.isFinite(m)) return "an unknown distance";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

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
 * @param {boolean}  [params.geofenceOverride]  arrival far from the geofenced point
 * @param {string}   [params.geofenceReason]    required when geofenceOverride is true
 * @returns {Promise<object>} updated trip row
 */
export async function setTripStatus({ tripId, to, session, reason = null, extra = {}, busy = false, geofenceOverride = false, geofenceReason = "" }) {
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

  // Arrival-gate enforcement (see PICKUP_GATED above). Runs after adjacency
  // so an illegal hop still reports the state-machine reason, not geofence.
  let auditReason = reason;
  const gatedPickup = PICKUP_GATED.has(to);
  const gatedDropoff = to === TRIP_STATUS.DROP_OFF;
  if (gatedPickup || gatedDropoff) {
    const override = geofenceOverride === true;
    const cleanReason = typeof geofenceReason === "string" ? geofenceReason.trim().slice(0, 500) : "";
    if (override && !cleanReason) {
      throw new AuthError("A reason is required when arriving away from the geofenced point.", 400);
    }
    const proximity = gatedDropoff
      ? await checkDestinationProximity({ query }, tripId)
      : await checkPickupProximity({ query }, tripId);
    if (proximity.state === "outside" && !override) {
      const point = gatedDropoff ? "destination" : "pickup point";
      throw new AuthError(
        `You appear to be ${formatGateDistance(proximity.distanceM)} from ${proximity.label || `the ${point}`}. Return to the ${point}, or resend with { geofence_override: true, geofence_reason } to proceed anyway.`,
        409,
        "GEOFENCE_OUTSIDE"
      );
    }
    if (override) {
      const point = gatedDropoff ? "destination" : "pickup";
      auditReason = `Geofence override (${proximity.state}, ${formatGateDistance(proximity.distanceM)} from ${proximity.label || `the ${point}`})${reason ? ` — ${reason}` : ""}: ${cleanReason}`;
    }
  }

  const sets = ["trip_status = $1", "updated_at = NOW()"];
  const values = [to];
  // Authoritative pickup stamp + override latch, same statement as the flip.
  if (to === TRIP_STATUS.AT_PICKUP) {
    sets.push("at_pickup_at = COALESCE(at_pickup_at, NOW())");
    sets.push(`at_pickup_override = at_pickup_override OR ${geofenceOverride === true ? "TRUE" : "FALSE"}`);
  }
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
    oldValues: { trip_status: before[0].trip_status, reason: auditReason },
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

  // Cancellation is a CHAIN — the dispatch stands down, its open trips stand
  // down, and the originating request is released — so it takes the
  // transactional path below. Everything else is a single flip.
  if (to === "Cancelled") {
    return cancelDispatch({ dispatchId, before: before[0], session, reason });
  }

  const { rows } = await query(
    `UPDATE dispatchschedules SET status = $1, cancel_reason = $2, updated_at = NOW() WHERE dispatch_id = $3 RETURNING *`,
    [to, null, dispatchId]
  );
  if (!rows[0]) throw new AuthError("Dispatch not found", 404);

  const p = [];
  if (rows[0]?.vehicle_id) p.push(syncVehicleStatus(rows[0].vehicle_id).catch(() => {}));
  if (rows[0]?.driver_id) p.push(syncDriverStatus(rows[0].driver_id).catch(() => {}));
  if (to === "Scheduled" || to === "In Progress") p.push(ensureTripForDispatch(dispatchId).catch(() => {}));
  await Promise.all(p);

  await writeAudit(null, session, {
    action: "update",
    resource: "dispatchschedules",
    resourceId: dispatchId,
    oldValues: { status: before[0].status, reason },
    newValues: { status: to },
  });

  return rows[0];
}

/**
 * Stand a dispatch down.
 *
 * Business rule (the one both cancel dialogs already promise): the vehicle and
 * driver return to the pool and the ORIGINATING REQUEST KEEPS ITS CLAIM ON THE
 * GUEST — it is released back to Scheduled and stays re-assignable. Only an
 * explicit request cancellation (PUT /api/integration/transport-requests/[id]/
 * cancel) cancels the request.
 *
 * This used to call `advanceReservation(... Cancelled)` and do it all
 * best-effort, so the dispatch flip could commit while the request transition
 * silently failed, leaving a half-cancelled chain — and every cancellation
 * cancelled a guest's transport whether or not anyone asked for that.
 *
 * Everything durable commits in ONE transaction: the dispatch flip (re-checked
 * under FOR UPDATE, so a status change between the read and the write cannot be
 * cancelled by mistake), the cancellation of its open trips, and the release of
 * the request. A Completed trip is history and stays Completed. Derived
 * resource statuses and the outbound notice to Booking happen AFTER the commit,
 * where a failure can no longer unwind it.
 */
async function cancelDispatch({ dispatchId, before, session, reason }) {
  const cleanReason = typeof reason === "string" && reason.trim() ? reason.trim() : null;

  const { dispatch, request } = await withTransaction(async (tx) => {
    const { rows: locked } = await tx.query(
      `SELECT dispatch_id, dispatch_number, status, vehicle_id, driver_id, request_id
         FROM dispatchschedules WHERE dispatch_id = $1 FOR UPDATE`,
      [dispatchId]
    );
    if (!locked[0]) throw new AuthError("Dispatch not found", 404);
    const recheck = canTransitionDispatch(locked[0].status, DISPATCH_CANCELLED);
    if (!recheck.ok) throw new AuthError(recheck.reason, 409);

    // Open trips stand down; Completed trips are untouched history.
    await tx.query(
      `UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW()
        WHERE dispatch_id = $1 AND deleted_at IS NULL
          AND trip_status NOT IN ('Completed', 'Cancelled')`,
      [dispatchId]
    );

    const { rows } = await tx.query(
      `UPDATE dispatchschedules SET status = $1, cancel_reason = $2, updated_at = NOW()
        WHERE dispatch_id = $3 RETURNING *`,
      [DISPATCH_CANCELLED, cleanReason, dispatchId]
    );
    if (!rows[0]) throw new AuthError("Dispatch not found", 404);

    // Release the request. Read it under the transaction's own connection so the
    // status validated here is the status written.
    const requestId = rows[0].request_id;
    let released = { ok: true, request: null };
    if (requestId) {
      const { rows: reqRows } = await tx.query(
        `SELECT request_id, fleet_status FROM transportation_requests
          WHERE request_id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [requestId]
      );
      // A request that already reached a terminal state has nothing to release:
      // its dispatch outlived the request, and the stand-down is still legal.
      if (reqRows[0] && !isTerminalReservationStatus(reqRows[0].fleet_status)) {
        released = await advanceReservation({
          requestId,
          toStatus: RELEASE_TO_STATUS,
          session,
          eventType: E.DISPATCH_RELEASED,
          description: cleanReason
            ? `Dispatch stood down: ${cleanReason}`
            : "Dispatch stood down; the request is back in the queue for reassignment.",
          metadata: {
            dispatch_id: dispatchId,
            dispatch_number: rows[0].dispatch_number ?? null,
            cancelled_from: locked[0].status,
            request_status_before: reqRows[0].fleet_status,
            reason: cleanReason,
          },
          // The pair returns to the pool, so the request stops advertising it.
          patch: { vehicle_id: null, driver_id: null, status_reason: cleanReason },
          // Outbound runs after COMMIT, below — never while holding a connection.
          notifyBooking: false,
          db: tx,
        });
      }
    }
    if (!released.ok) {
      // Aborts the transaction, so the dispatch flip and the trip stand-down
      // roll back with it: no half-cancelled chain.
      throw new AuthError(
        released.error || "The originating request could not be released.",
        released.status || 409
      );
    }

    return { dispatch: rows[0], request: released.request };
  });

  // Derived statuses are recomputed on demand and self-heal, so these stay
  // best-effort — the cancellation is already committed.
  const p = [];
  if (dispatch?.vehicle_id) p.push(syncVehicleStatus(dispatch.vehicle_id).catch(() => {}));
  if (dispatch?.driver_id) p.push(syncDriverStatus(dispatch.driver_id).catch(() => {}));
  await Promise.all(p);

  if (request) {
    await emitTransportStatus(request, {}).catch((e) =>
      console.warn("dispatch-cancel -> Booking notification failed:", e?.message || e)
    );
  }

  await writeAudit(null, session, {
    action: "update",
    resource: "dispatchschedules",
    resourceId: dispatchId,
    oldValues: { status: before.status, reason: cleanReason },
    newValues: { status: DISPATCH_CANCELLED, request_status: request?.fleet_status ?? null },
  });

  return dispatch;
}

/** Advance the transportation request behind a dispatch to In Progress. */
async function advanceRequest(dispatchId, session, tripId) {
  const { rows } = await query(
    `SELECT request_id FROM dispatchschedules WHERE dispatch_id = $1 LIMIT 1`,
    [dispatchId]
  );
  const requestId = rows[0]?.request_id;
  if (!requestId) return;
  await advanceReservation({
    requestId,
    toStatus: RESERVATION_LIFECYCLE.IN_PROGRESS,
    session,
    eventType: E.TRIP_STARTED,
    description: `Trip #${tripId} started.`,
    metadata: { trip_id: tripId, dispatch_id: dispatchId },
  });
}

