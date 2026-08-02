import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { writeAudit } from "@/lib/audit";

// Fleet review — START REVIEW on a transportation request.
//
// Moves a freshly-arrived request from Pending to Under Review and stamps who
// picked it up. This is what makes "who is looking at this?" answerable when
// several dispatchers share the queue.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.UNDER_REVIEW,
      session,
      eventType: E.REVIEWED,
      description: "Fleet review started.",
      patch: {
        reviewed_by: session?.user?.employeeId ?? null,
        reviewed_at: new Date().toISOString(),
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { fleet_status: before.fleet_status },
      newValues: { fleet_status: L.UNDER_REVIEW },
    });

    return ok(result.request);
  } catch (e) { return handleError(e); }
}
