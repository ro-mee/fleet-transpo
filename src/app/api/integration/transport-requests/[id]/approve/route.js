import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { writeAudit } from "@/lib/audit";

// Fleet review — APPROVE a transportation request.
//
// Approval is the gate dispatch checks: a request cannot be dispatched until it
// is Approved. A request sitting at Pending is walked through Under Review on
// the way (advanceReservation handles the intermediate hop), so approving
// straight from the queue stays one click while the timeline still records the
// review step.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const actorId = session?.user?.employeeId ?? null;
    const now = new Date().toISOString();

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.APPROVED,
      session,
      eventType: E.APPROVED,
      description: "Request approved — ready for dispatch.",
      patch: {
        reviewed_by: before.reviewed_by ?? actorId,
        reviewed_at: before.reviewed_at ?? now,
        approved_by: actorId,
        approved_at: now,
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { fleet_status: before.fleet_status },
      newValues: { fleet_status: L.APPROVED },
    });

    return ok(result.request);
  } catch (e) { return handleError(e); }
}
