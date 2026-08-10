import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";

export async function DELETE(req, { params }) {
  try {
    const session = await requireAuth(req, [
      "system_admin",
      "admin",
      "fleet_manager",
      "dispatcher",
      "management",
      "driver",
    ]);
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return err("Invalid notification id", 400);

    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    const canDeleteAny = ["system_admin", "admin", "fleet_manager"].includes(session.user?.role);

    // Staff may delete any row (broadcast cleanup); everyone else may only
    // delete their own. employee_id is int and user_id is uuid, so scope on
    // whichever identity is actually present, mirroring GET /api/notifications.
    const { rowCount } = canDeleteAny
      ? await query(`DELETE FROM notifications WHERE notification_id = $1`, [id])
      : await query(
          `DELETE FROM notifications WHERE notification_id = $1 AND ${
            own == null ? "1 = 0" : session.user.employeeId != null ? "employee_id = $2" : "user_id = $2"
          }`,
          own == null ? [id] : [id, own]
        );

    if (!rowCount) return err("Notification not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}