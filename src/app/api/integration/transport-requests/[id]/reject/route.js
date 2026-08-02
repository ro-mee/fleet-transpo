import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { writeAudit } from "@/lib/audit";

// Fleet review — REJECT a transportation request.
//
// Terminal for Fleet: the request will not be fulfilled. A reason is recorded
// and Booking is notified so the guest can be re-routed on the Booking side.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;
    const body = await parseBody(req).catch(() => ({}));

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const reason = (body?.reason || "").toString().slice(0, 1000) || null;
    const actorId = session?.user?.employeeId ?? null;
    const now = new Date().toISOString();

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.REJECTED,
      session,
      eventType: E.REJECTED,
      description: reason ? `Request rejected: ${reason}` : "Request rejected.",
      metadata: reason ? { reason } : null,
      patch: {
        status_reason: reason,
        reviewed_by: before.reviewed_by ?? actorId,
        reviewed_at: before.reviewed_at ?? now,
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { fleet_status: before.fleet_status },
      newValues: { fleet_status: L.REJECTED, reason },
    });

    return ok(result.request);
  } catch (e) { return handleError(e); }
}
