import { query } from "@/lib/db";
import { canTransitionReservation, transitionPath } from "@/lib/scheduling/reservation-state";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { emitTransportStatus } from "@/services/outbound.service";
import { recomputeDerivedPriority } from "@/services/priority.service";

// Reservation lifecycle writer — the ONE place fleet_status changes.
//
// Every status change has to do four things in order, and getting the order
// wrong is how these systems drift:
//   1. validate the hop against the state machine,
//   2. persist it,
//   3. append a timeline event (operator-facing narrative),
//   4. notify Booking (best-effort, never rolls back).
//
// Routes used to do this inline, which is why approve/ jumped Pending→Approved
// and skipped Under Review entirely. Funnelling through advanceReservation()
// makes the illegal jump impossible to write by accident.
//
// Columns beyond fleet_status (reviewed_by, approved_at, vehicle_id, ...) are
// passed as `patch` and merged into the same UPDATE so the row and its timeline
// can never disagree about what happened.

/** Whitelist of columns a transition is allowed to set alongside fleet_status. */
const PATCHABLE = new Set([
  "status_reason",
  "reviewed_by",
  "reviewed_at",
  "approved_by",
  "approved_at",
  "vehicle_id",
  "driver_id",
  "reservation_id",
  "pickup_datetime",
  "priority",
  "ai_vehicle_recommendation",
  "ai_driver_recommendation",
  "estimated_distance",
  "estimated_duration",
]);

/** Load a request or throw a shaped error the routes can turn into a 404. */
async function loadRequest(requestId) {
  const { rows } = await query(
    `SELECT * FROM transportation_requests WHERE request_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [requestId]
  );
  return rows[0] || null;
}

/**
 * Resolve the transportation request behind a dispatch, if any.
 *
 * Trips reach a request indirectly: trip → dispatch → request. Dispatches
 * created after migration 015 carry `request_id` directly; older ones only have
 * `reservation_id`, so the legacy path is kept as a fallback. Both trip routes
 * need this, so it lives here rather than being copied into each.
 *
 * @param {number|string} dispatchId
 * @returns {Promise<object|null>}
 */
async function findRequestForDispatch(dispatchId) {
  if (!dispatchId) return null;
  const { rows } = await query(
    `SELECT tr.* FROM transportation_requests tr
       JOIN dispatchschedules ds
         ON ds.request_id = tr.request_id
         OR (ds.request_id IS NULL AND ds.reservation_id = tr.reservation_id)
      WHERE ds.dispatch_id = $1 AND tr.deleted_at IS NULL
      LIMIT 1`,
    [dispatchId]
  );
  return rows[0] || null;
}

/**
 * Advance a request to `toStatus`, walking the chain one hop at a time.
 *
 * A dispatcher assigning a vehicle to an Approved request means
 * Approved→Scheduled→Assigned: two legal hops, not one illegal jump. Each hop is
 * validated and gets its own timeline row, so the timeline reads as a true
 * history rather than a single leap.
 *
 * @param {object} params
 * @param {number|string} params.requestId
 * @param {string} params.toStatus            target fleet_status
 * @param {object} [params.session]           auth session (actor for events/audit)
 * @param {string} [params.eventType]         event recorded for the FINAL hop
 * @param {string} [params.description]       human-readable line for the final hop
 * @param {object} [params.metadata]          extra JSON detail for the final hop
 * @param {object} [params.patch]             additional columns to set
 * @param {object} [params.outbound]          extra fields for emitTransportStatus
 * @param {boolean} [params.notifyBooking=true]
 * @returns {Promise<{ ok: boolean, status?: number, error?: string, request?: object, hops?: string[] }>}
 */
export async function advanceReservation({
  requestId,
  toStatus,
  session = null,
  eventType = null,
  description = null,
  metadata = null,
  patch = {},
  outbound = {},
  notifyBooking = true,
}) {
  const before = await loadRequest(requestId);
  if (!before) return { ok: false, status: 404, error: "Transportation request not found" };

  const from = before.fleet_status;

  // Already at the target status. This is the REASSIGNMENT path: a retry or
  // double-click where nothing changed is a harmless no-op, but a genuine swap
  // passes a `patch` (new vehicle_id/driver_id) that MUST still land. Apply the
  // patch if present, otherwise return the unchanged row.
  if (from === toStatus) {
    const patchable = Object.entries(patch).filter(
      ([key, value]) => PATCHABLE.has(key) && value !== undefined
    );
    if (patchable.length === 0) {
      return { ok: true, request: before, hops: [] };
    }

    const columns = [];
    const values = [];
    let idx = 1;
    for (const [key, value] of patchable) {
      columns.push(`${key} = $${idx++}`);
      values.push(value !== null && typeof value === "object" ? JSON.stringify(value) : value);
    }
    values.push(requestId);
    const { rows } = await query(
      `UPDATE transportation_requests SET ${columns.join(", ")} WHERE request_id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Transportation request not found" };

    if (eventType) {
      await recordReservationEvent({
        requestId,
        eventType,
        fromStatus: before.fleet_status,
        toStatus,
        session,
        description: description || `Reassigned resources on ${toStatus} request.`,
        metadata,
      });
    }
    return { ok: true, request: rows[0], hops: [] };
  }

  const path = transitionPath(from, toStatus);
  if (!path) {
    // Fall back to canTransition for the precise, user-facing reason.
    const gate = canTransitionReservation(from, toStatus);
    return {
      ok: false,
      status: 409,
      error: gate.reason || `Cannot move a request from "${from}" to "${toStatus}".`,
    };
  }

  // path includes the current status; the hops are everything after it.
  const hops = path.slice(1);

  // Only the final hop carries the caller's patch/description — intermediate
  // hops are bookkeeping, recorded so the timeline shows the full journey.
  let current = before;
  for (let i = 0; i < hops.length; i++) {
    const next = hops[i];
    const isFinal = i === hops.length - 1;

    const columns = ["fleet_status = $1"];
    const values = [next];
    let idx = 2;

    if (isFinal) {
      for (const [key, value] of Object.entries(patch)) {
        if (!PATCHABLE.has(key) || value === undefined) continue;
        columns.push(`${key} = $${idx++}`);
        values.push(
          value !== null && typeof value === "object" ? JSON.stringify(value) : value
        );
      }
    }

    values.push(requestId);
    const { rows } = await query(
      `UPDATE transportation_requests SET ${columns.join(", ")} WHERE request_id = $${idx} RETURNING *`,
      values
    );
    if (!rows[0]) return { ok: false, status: 404, error: "Transportation request not found" };

    const previous = current;
    current = rows[0];

    await recordReservationEvent({
      requestId,
      eventType: isFinal && eventType ? eventType : eventForStatus(next),
      fromStatus: previous.fleet_status,
      toStatus: next,
      session,
      description: isFinal ? description : `Status moved to ${next}.`,
      metadata: isFinal ? metadata : null,
    });
  }

  // Keep derived_priority in sync with the new status + time (best-effort; a
  // recompute failure must never roll back the transition itself).
  try {
    await recomputeDerivedPriority([current]);
  } catch (e) {
    console.warn("derived_priority recompute failed after transition:", e?.message || e);
  }

  if (notifyBooking) {
    // Best-effort: Booking is told the final state only. A delivery failure is
    // logged in integration_log and never unwinds the transition above.
    await emitTransportStatus(current, outbound);
  }

  return { ok: true, request: current, hops };
}

/** Default timeline event type for a status, used for intermediate hops. */
function eventForStatus(status) {
  switch (status) {
    case L.SCHEDULED:
      return E.DISPATCH_CREATED;
    case L.ASSIGNED:
      return E.VEHICLE_ASSIGNED;
    case L.IN_PROGRESS:
      return E.TRIP_STARTED;
    case L.COMPLETED:
      return E.TRIP_COMPLETED;
    case L.CANCELLED:
      return E.CANCELLED;
    default:
      return E.RESCHEDULED;
  }
}

export { loadRequest, findRequestForDispatch };
