import { requirePermission, requireDriver, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
import { validateBody, isValidObject } from "@/lib/validation/helpers";
import { query } from "@/lib/db";
import { listWorkSchedules, saveWorkSchedule } from "@/services/driver-schedule.service";

// Weekly driver work schedules (migration 049).
//
// GET reads one driver's 7-day schedule. The fleet manager sets schedules via
// PUT; admin observes but does not write (RBAC matrix: admin has read-only
// driver_work_schedules). A driver reads only their own schedule.
export async function GET(req) {
  try {
    const session = await requirePermission(req, "driver_work_schedules", "read");
    const sp = new URL(req.url).searchParams;
    const role = session.user?.role;
    let driverId = sp.get("driver_id");

    if (role === "driver") {
      const own = session.user?.driverId;
      if (own == null) return err("No driver record is linked to this account", 403);
      driverId = own;
    }
    if (!driverId) return err("driver_id is required", 400);

    // The requesting driver may only read their own schedule.
    if (role === "driver" && Number(driverId) !== Number(session.user?.driverId)) {
      return err("A driver may only read their own schedule", 403);
    }

    const { rows } = await query(
      `SELECT d.driver_id FROM drivers d WHERE d.driver_id = $1 AND d.deleted_at IS NULL LIMIT 1`,
      [Number(driverId)]
    );
    if (!rows[0]) return err("Driver not found", 404);

    return ok({ driver_id: Number(driverId), days: await listWorkSchedules(driverId) });
  } catch (e) { return handleError(e); }
}

// PUT replaces the driver's whole weekly schedule. Only the fleet manager (or a
// system_admin) sets schedules — admin deliberately excluded (RBAC matrix).
export async function PUT(req) {
  try {
    const session = await requirePermission(req, "driver_work_schedules", "update");
    const body = await parseBody(req);

    const errors = validateBody(body, {
      driver_id: { required: true, type: "id", label: "Driver" },
      days: { required: true, label: "Schedule days" },
    });
    if (!isValidObject(errors)) return errValidation(errors);

    const driverId = Number(body.driver_id);
    const { rows } = await query(
      `SELECT driver_id FROM drivers WHERE driver_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [driverId]
    );
    if (!rows[0]) return err("Driver not found", 404);

    const days = Array.isArray(body.days) ? body.days : [];
    if (days.length === 0) {
      return err("At least one day is required (set a day's is_rest_day to mark it off).", 400);
    }
    if (days.length > 7) return err("A week has 7 days.", 400);

    const dowSeen = new Set();
    for (const d of days) {
      const dow = Number(d.day_of_week);
      if (!Number.isInteger(dow) || dow < 0 || dow > 6) {
        return err(`day_of_week must be an integer 0–6 (Sunday=0).`, 400);
      }
      if (dowSeen.has(dow)) return err(`Duplicate day_of_week ${dow}.`, 400);
      dowSeen.add(dow);

      const rest = Boolean(d.is_rest_day);
      if (rest) continue;
      if (!d.shift_start || !d.shift_end) {
        return err(`Day ${dow} needs shift_start and shift_end unless it is a rest day.`, 400);
      }
      if (d.shift_start >= d.shift_end) {
        return err(`Day ${dow}: shift_end must be after shift_start.`, 400);
      }
      if ((d.break_start && !d.break_end) || (!d.break_start && d.break_end)) {
        return err(`Day ${dow}: provide both break_start and break_end, or neither.`, 400);
      }
      if (d.break_start && d.break_end && d.break_start >= d.break_end) {
        return err(`Day ${dow}: break_end must be after break_start.`, 400);
      }
    }

    const updated = await saveWorkSchedule(driverId, days, session.user?.employeeId ?? null);
    return ok({ driver_id: driverId, days: updated });
  } catch (e) { return handleError(e); }
}
