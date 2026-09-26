import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";
import { rolesFor } from "@/lib/auth/permissions";

export async function DELETE(req, { params }) {
  try {
    const session = await requirePermission(req, "notifications", "delete");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return err("Invalid notification id", 400);

    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    const canDeleteAny = rolesFor("notifications", "delete_all").includes(session.user?.role);

    // Staff may dismiss any row (broadcast cleanup); everyone else may only
    // dismiss their own. employee_id is int and user_id is uuid, so scope on
    // whichever identity is actually present, mirroring GET /api/notifications.
    // Soft delete (migration 127): the row stays for audit until the daily
    // pg_cron purge hard-deletes rows dismissed more than 90 days ago; the
    // `deleted_at IS NULL` guard makes a repeat dismiss a 404, which mobile
    // treats as "already gone" idempotently.
    const { rowCount } = canDeleteAny
      ? await query(
          `UPDATE notifications SET deleted_at = NOW()
           WHERE notification_id = $1 AND deleted_at IS NULL`,
          [id]
        )
      : await query(
          `UPDATE notifications SET deleted_at = NOW()
           WHERE notification_id = $1 AND deleted_at IS NULL AND ${
             own == null ? "1 = 0" : session.user.employeeId != null ? "employee_id = $2" : "user_id = $2"
           }`,
          own == null ? [id] : [id, own]
        );

    if (!rowCount) return err("Notification not found", 404);
    return ok({ deleted: true });
  } catch (e) { return handleError(e); }
}
