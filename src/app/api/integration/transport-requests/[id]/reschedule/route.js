import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_EVENT as E } from "@/lib/constants";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { emitTransportStatus } from "@/services/outbound.service";
import { resolveRequestEstimate } from "@/services/route-resolver.service";
import { isTerminalReservationStatus } from "@/lib/scheduling/reservation-state";
import { writeAudit } from "@/lib/audit";

// RESCHEDULE a transportation request.
//
// Changes pickup_datetime without moving fleet_status — a reschedule is a
// property change, not a lifecycle step, so it stays legal at any non-terminal
// status. The travel estimate is recomputed because a new pickup time can mean
// a different traffic window.
//
// Terminal requests are refused: rescheduling something already Completed or
// Rejected would silently rewrite history.
export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "reservations", "reschedule");
    const { id } = await params;
    const body = await parseBody(req);

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    if (isTerminalReservationStatus(before.fleet_status)) {
      return err(`Request is ${before.fleet_status} and can no longer be rescheduled.`, 409);
    }

    const pickup = body?.pickup_datetime;
    if (!pickup) return err("pickup_datetime is required.", 400);

    const when = new Date(pickup);
    if (!Number.isFinite(when.getTime())) return err("pickup_datetime is not a valid date.", 400);

    const reason = (body?.reason || "").toString().slice(0, 1000) || null;
    const estimate = await resolveRequestEstimate(before, { query }, { persistRoute: true });

    const { rows } = await query(
      `UPDATE transportation_requests
          SET pickup_datetime = $1,
              estimated_distance = $2,
              estimated_duration = $3
        WHERE request_id = $4
      RETURNING *`,
      [when.toISOString(), estimate.distanceKm, estimate.durationMin, id]
    );
    const updated = rows[0];
    if (!updated) return err("Transportation request not found", 404);

    await recordReservationEvent({
      requestId: id,
      eventType: E.RESCHEDULED,
      fromStatus: before.fleet_status,
      toStatus: before.fleet_status,
      session,
      description: reason
        ? `Pickup rescheduled to ${when.toISOString()}: ${reason}`
        : `Pickup rescheduled to ${when.toISOString()}.`,
      metadata: {
        previous_pickup_datetime: before.pickup_datetime,
        new_pickup_datetime: when.toISOString(),
        reason,
      },
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { pickup_datetime: before.pickup_datetime },
      newValues: { pickup_datetime: when.toISOString(), reason },
    });

    // Booking cares about the new time — the mapped external status is
    // unchanged, but the event carries the updated ETA.
    await emitTransportStatus(updated, { eta: when.toISOString() });

    return ok(updated);
  } catch (e) { return handleError(e); }
}
