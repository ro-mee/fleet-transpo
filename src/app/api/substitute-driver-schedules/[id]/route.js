import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

// Substitute driver schedule item routes (migration 032).
//
// DELETE closes a schedule (sets nothing — this table has no interval-close
// semantics; a schedule is removed entirely, unlike the custodial pairing
// history). PATCH edits the substitute driver and/or the date range.

const WRITE_ROLES = ["system_admin", "admin", "fleet_manager"];

const SELECT_SCHEDULE = `
  SELECT s.substitute_id, s.vehicle_id, s.substitute_driver_id,
         s.effective_from, s.effective_until, s.notes, s.created_at, s.updated_at,
         v.plate_number, v.vehicle_name, v.vehicle_status,
         e.first_name, e.last_name, d.driver_status
    FROM substitute_vehicle_schedules s
    LEFT JOIN vehicles v ON v.vehicle_id = s.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = s.substitute_driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
   WHERE s.substitute_id = $1
`;

async function loadSchedule(id) {
  const { rows } = await query(SELECT_SCHEDULE, [id]);
  return rows[0] ?? null;
}

/**
 * PATCH /api/substitute-driver-schedules/[id]
 *   { substitute_driver_id?, effective_from?, effective_until?, notes? }
 */
export async function PATCH(req, { params }) {
  try {
    const session = await requireAuth(req, WRITE_ROLES);
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return err("A valid schedule id is required.", 400);
    }

    const existing = await loadSchedule(scheduleId);
    if (!existing) return err("Substitute schedule not found.", 404);

    const body = await parseBody(req);

    const from = body?.effective_from ?? existing.effective_from;
    const until = body?.effective_until != null ? body.effective_until : existing.effective_until;
    const subDriverId = Number(body?.substitute_driver_id) || existing.substitute_driver_id;

    const fromD = new Date(from);
    if (Number.isNaN(fromD.getTime())) return err("effective_from is not a valid date.", 400);
    if (until) {
      const untilD = new Date(until);
      if (Number.isNaN(untilD.getTime())) return err("effective_until is not a valid date.", 400);
      if (untilD.getTime() < fromD.getTime() - 86400000) return err("effective_until cannot be before effective_from.", 400);
    }

    const { rows: updated } = await query(
      `UPDATE substitute_vehicle_schedules
          SET substitute_driver_id = $2,
              effective_from = $3,
              effective_until = $4,
              notes = COALESCE($5, notes),
              updated_at = NOW(),
              updated_by = $6
        WHERE substitute_id = $1
        RETURNING substitute_id`,
      [scheduleId, subDriverId, from, until, body?.notes ?? null, session.user.employeeId ?? null]
    );
    if (!updated.length) return err("Substitute schedule not found.", 404);

    const schedule = await loadSchedule(scheduleId);

    await writeAudit(req, session, {
      action: "update",
      resource: "substitute_driver_schedules",
      resourceId: scheduleId,
      oldValues: {
        substitute_driver_id: existing.substitute_driver_id,
        effective_from: existing.effective_from,
        effective_until: existing.effective_until,
      },
      newValues: schedule
        ? {
            substitute_driver_id: schedule.substitute_driver_id,
            effective_from: schedule.effective_from,
            effective_until: schedule.effective_until,
          }
        : null,
    });

    return ok({ schedule });
  } catch (e) {
    if (e?.code === "23505") return err("Another open-ended substitute already covers this vehicle.", 409);
    return handleError(e);
  }
}

/**
 * DELETE /api/substitute-driver-schedules/[id]
 * Cancels a substitute schedule entirely (this is reverse-booked standing
 * coverage, not an auditable interval like the custodial pairing).
 */
export async function DELETE(req, { params }) {
  try {
    const session = await requireAuth(req, WRITE_ROLES);
    const { id } = await params;
    const scheduleId = Number(id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      return err("A valid schedule id is required.", 400);
    }

    const existing = await loadSchedule(scheduleId);
    if (!existing) return err("Substitute schedule not found.", 404);

    const { rows } = await query(
      `DELETE FROM substitute_vehicle_schedules
        WHERE substitute_id = $1
        RETURNING substitute_id`,
      [scheduleId]
    );
    if (!rows.length) return err("Substitute schedule not found.", 404);

    await writeAudit(req, session, {
      action: "delete",
      resource: "substitute_driver_schedules",
      resourceId: scheduleId,
      oldValues: {
        vehicle_id: existing.vehicle_id,
        substitute_driver_id: existing.substitute_driver_id,
        effective_from: existing.effective_from,
        effective_until: existing.effective_until,
      },
    });

    return ok({ message: "Substitute schedule removed" });
  } catch (e) {
    return handleError(e);
  }
}