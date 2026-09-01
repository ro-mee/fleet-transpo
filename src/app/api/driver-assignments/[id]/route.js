import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

/**
 * DELETE /api/driver-assignments/[id]   { release_reason? }
 *
 * Releases a custodial pairing. Rows are never deleted despite the verb — the
 * history is the point of the table, so this closes the interval by setting
 * assigned_until, which is also what drops the row out of the
 * uq_dva_active_* partial indexes and frees both sides for reassignment.
 */
export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "driver_assignments", "delete");
    const { id } = await params;
    const assignmentId = Number(id);
    if (!Number.isInteger(assignmentId) || assignmentId <= 0) {
      return err("A valid assignment id is required.", 400);
    }

    // Body is optional on a DELETE, so a missing/blank one must not 400.
    let body = {};
    try {
      body = (await parseBody(req)) || {};
    } catch {
      body = {};
    }

    const { rows } = await query(
      `SELECT assignment_id, driver_id, vehicle_id, assigned_until
         FROM driver_vehicle_assignments WHERE assignment_id = $1`,
      [assignmentId]
    );
    if (!rows.length) return err("Assignment not found.", 404);
    if (rows[0].assigned_until != null) {
      return err("That assignment has already been released.", 409);
    }

    const { rows: released } = await query(
      `UPDATE driver_vehicle_assignments
          SET assigned_until = CURRENT_DATE,
              release_reason = $2,
              updated_at = NOW(),
              updated_by = $3
        WHERE assignment_id = $1
        RETURNING assignment_id, driver_id, vehicle_id, assigned_from, assigned_until, release_reason`,
      [assignmentId, body?.release_reason || "Released", session.user.employeeId ?? null]
    );

    await writeAudit(req, session, {
      action: "delete",
      resource: "driver_assignments",
      resourceId: assignmentId,
      oldValues: { driver_id: rows[0].driver_id, vehicle_id: rows[0].vehicle_id, assigned_until: null },
      newValues: { assigned_until: released[0].assigned_until, release_reason: released[0].release_reason },
    });

    return ok({ assignment: released[0], message: "Assignment released" });
  } catch (e) {
    return handleError(e);
  }
}
