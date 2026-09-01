import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { recomputeDerivedPriority } from "@/services/priority.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { RESERVATION_EVENT as E } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";

// PATCH — set a request's VIP / emergency flags.
//
// Flags are explicit inputs to the priority engine, separate from the human-set
// `priority`. Setting one recomputes derived_priority immediately so the queue
// reflects the change on the next read. Only authorized roles may flip them.
export async function PATCH(req, { params }) {
  try {
    const session = await requirePermission(req, "reservations", "manage_flags");
    const { id } = await params;
    const body = await parseBody(req);

    const hasVip = body?.is_vip !== undefined;
    const hasEmergency = body?.is_emergency !== undefined;
    if (!hasVip && !hasEmergency) {
      return err("Provide at least one of is_vip or is_emergency.", 400);
    }

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const patch = [];
    const values = [];
    let idx = 1;
    if (hasVip) {
      patch.push(`is_vip = $${idx++}`);
      values.push(body.is_vip === true);
    }
    if (hasEmergency) {
      patch.push(`is_emergency = $${idx++}`);
      values.push(body.is_emergency === true);
    }
    values.push(id);

    const { rows } = await query(
      `UPDATE transportation_requests SET ${patch.join(", ")}, updated_at = NOW()
        WHERE request_id = $${idx} RETURNING *`,
      values
    );
    const updated = rows[0];
    if (!updated) return err("Transportation request not found", 404);

    await recomputeDerivedPriority([updated]);

    const changed = [];
    if (hasVip && before.is_vip !== updated.is_vip) changed.push("VIP");
    if (hasEmergency && before.is_emergency !== updated.is_emergency) changed.push("emergency");
    if (changed.length) {
      await recordReservationEvent({
        requestId: id,
        eventType: E.RESCHEDULED,
        fromStatus: before.fleet_status,
        toStatus: updated.fleet_status,
        session,
        description: `Marked ${changed.join(" and ")}.`,
        metadata: { is_vip: updated.is_vip, is_emergency: updated.is_emergency },
      });
    }

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { is_vip: before.is_vip, is_emergency: before.is_emergency },
      newValues: { is_vip: updated.is_vip, is_emergency: updated.is_emergency },
    });

    return ok(updated);
  } catch (e) { return handleError(e); }
}
