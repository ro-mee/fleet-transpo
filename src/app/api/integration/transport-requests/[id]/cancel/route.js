import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { writeAudit } from "@/lib/audit";

// CANCEL a transportation request.
//
// Reachable from any non-terminal status (the state machine allows Cancelled as
// an escape hatch everywhere). Distinct from reject: reject is a Fleet review
// decision at intake, cancel is a later abort — often because Booking or the
// guest called it off.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;
    const body = await parseBody(req).catch(() => ({}));

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const reason = (body?.reason || "").toString().slice(0, 1000) || null;

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.CANCELLED,
      session,
      eventType: E.CANCELLED,
      description: reason ? `Request cancelled: ${reason}` : "Request cancelled.",
      metadata: reason ? { reason, cancelled_from: before.fleet_status } : { cancelled_from: before.fleet_status },
      patch: { status_reason: reason },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { fleet_status: before.fleet_status },
      newValues: { fleet_status: L.CANCELLED, reason },
    });

    return ok(result.request);
  } catch (e) { return handleError(e); }
}
