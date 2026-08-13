import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { syncVehicleStatus, syncDriverStatus } from "@/services/status.service";

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

    const { rows: dispatches } = await query(
      `SELECT dispatch_id FROM dispatchschedules
        WHERE deleted_at IS NULL AND status IN ('Scheduled', 'In Progress')
          AND request_id = $1`,
      [id]
    );
    for (const d of dispatches) {
      await query(`UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW() WHERE dispatch_id = $1 AND deleted_at IS NULL AND trip_status NOT IN ('Completed', 'Cancelled')`, [d.dispatch_id]);
      const { rows: disp } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1`, [d.dispatch_id]);
      await query(`UPDATE dispatchschedules SET status = 'Cancelled' WHERE dispatch_id = $1`, [d.dispatch_id]);
      if (disp[0]?.vehicle_id) await syncVehicleStatus(disp[0].vehicle_id);
      if (disp[0]?.driver_id) await syncDriverStatus(disp[0].driver_id);
    }

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.CANCELLED,
      session,
      eventType: E.CANCELLED,
      description: reason ? `Request cancelled: ${reason}` : "Request cancelled.",
      metadata: reason ? { reason, cancelled_from: before.fleet_status } : { cancelled_from: before.fleet_status },
      patch: { status_reason: reason, vehicle_id: null, driver_id: null },
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
