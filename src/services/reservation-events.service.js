import { query } from "@/lib/db";

// Reservation timeline (reservation_events, migration 016).
//
// Append-only audit of everything that happens to a transportation request:
// status transitions, assignments, approvals, AI recommendations, cancellations.
// This powers the Phase 15 timeline UI and gives dispatchers a "why is this
// request in this state" answer without digging through audit_log.
//
// This is DISTINCT from writeAudit(): audit_log is the security/compliance
// record (who changed what row, keyed by actor), while reservation_events is
// the operational narrative for one request, rendered to operators in the UI.
// Both are written on transitions; they serve different readers.
//
// Best-effort, exactly like outbound delivery: a timeline write must NEVER
// break the operation that triggered it. A missing timeline row is a cosmetic
// gap; a rolled-back dispatch is an outage.

/**
 * Append one event to a request's timeline.
 *
 * @param {object} params
 * @param {number|string} params.requestId    transportation_requests.request_id
 * @param {string} params.eventType           a RESERVATION_EVENT value
 * @param {string} [params.fromStatus]        fleet_status before the change
 * @param {string} [params.toStatus]          fleet_status after the change
 * @param {object} [params.session]           auth session — supplies actor id/role
 * @param {string} [params.description]       human-readable line for the UI
 * @param {object} [params.metadata]          arbitrary JSON detail (ids, scores, reasons)
 * @returns {Promise<{ recorded: boolean, eventId?: number }>}
 */
export async function recordReservationEvent({
  requestId,
  eventType,
  fromStatus = null,
  toStatus = null,
  session = null,
  description = null,
  metadata = null,
}) {
  if (!requestId || !eventType) return { recorded: false };

  try {
    const { rows } = await query(
      `INSERT INTO reservation_events
         (request_id, event_type, from_status, to_status, actor_id, actor_role, description, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING event_id`,
      [
        requestId,
        eventType,
        fromStatus,
        toStatus,
        // Session shape matches writeAudit(): actor lives on session.user.
        session?.user?.employeeId ?? null,
        session?.user?.role ?? null,
        description,
        metadata ? JSON.stringify(metadata) : null,
      ]
    );
    return { recorded: true, eventId: rows[0]?.event_id };
  } catch (e) {
    // Never surface — the caller's operation already succeeded.
    console.warn("recordReservationEvent: failed to write timeline:", e?.message || e);
    return { recorded: false };
  }
}

/**
 * Read a request's timeline, newest first.
 *
 * Joins employees so the UI can show "Approved by Maria Santos" rather than an
 * opaque id. LEFT JOIN because system-generated events have no actor.
 *
 * @param {number|string} requestId
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @returns {Promise<object[]>}
 */
export async function listReservationEvents(requestId, { limit = 100 } = {}) {
  const { rows } = await query(
    `SELECT
       e.event_id,
       e.request_id,
       e.event_type,
       e.from_status,
       e.to_status,
       e.actor_id,
       e.actor_role,
       e.description,
       e.metadata,
       e.occurred_at,
       emp.first_name AS actor_first_name,
       emp.last_name  AS actor_last_name
     FROM reservation_events e
     LEFT JOIN employees emp ON emp.employee_id = e.actor_id
     WHERE e.request_id = $1
     ORDER BY e.occurred_at DESC, e.event_id DESC
     LIMIT $2`,
    [requestId, limit]
  );

  return rows.map((r) => ({
    ...r,
    actor_name:
      r.actor_first_name || r.actor_last_name
        ? `${r.actor_first_name || ""} ${r.actor_last_name || ""}`.trim()
        : null,
  }));
}
