import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { assertDispatchOwnership } from "@/lib/api/ownership";
import { canTransitionDispatch } from "@/lib/scheduling/dispatch-state";
import { writeAudit } from "@/lib/audit";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { syncVehicleStatus, syncDriverStatus, ensureTripForDispatch } from "@/services/status.service";
import { findRequestForDispatch, advanceReservation } from "@/services/reservation-lifecycle.service";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"]);
    const id = (await params).id;
    const body = await parseBody(req);

    const owned = await assertDispatchOwnership(session, id);
    const prev = owned.status;
    const next = body.status;

    const check = canTransitionDispatch(prev, next);
    if (!check.ok) return err(check.reason, 409);

    const p = [];
    if (owned?.vehicle_id) p.push(syncVehicleStatus(owned.vehicle_id));
    if (owned?.driver_id) p.push(syncDriverStatus(owned.driver_id));

    if (next === "Cancelled") {
      await query(
        `UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW()
          WHERE dispatch_id = $1 AND deleted_at IS NULL
            AND trip_status NOT IN ('Completed', 'Cancelled')`,
        [id]
      );
    } else {
      if (next === "Scheduled" || next === "In Progress") p.push(ensureTripForDispatch(id));
    }

    const { rows } = await query(
      `UPDATE dispatchschedules SET status = $1, cancel_reason = $2 WHERE dispatch_id = $3 RETURNING *`,
      [next, next === "Cancelled" ? (body.reason?.trim() || null) : null, id]
    );
    if (!rows[0]) return err("Dispatch not found", 404);

    if (next === "Cancelled") {
      try {
        const request = await findRequestForDispatch(id);
        if (request) {
          await advanceReservation({
            requestId: request.request_id,
            toStatus: L.CANCELLED,
            session,
            eventType: E.CANCELLED,
            description: "Dispatch cancelled.",
            metadata: { dispatch_id: id },
          });
        }
      } catch (e) {
        console.warn("dispatch-cancel -> request Cancelled sync failed:", e?.message || e);
      }
    }

    await Promise.all(p);

    await writeAudit(req, session, {
      action: "update",
      resource: "dispatchschedules",
      resourceId: id,
      oldValues: { status: prev },
      newValues: { status: next },
    });

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
