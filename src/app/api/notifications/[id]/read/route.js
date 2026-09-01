import { query } from "@/lib/db";
import { requirePermission, ok, err, handleError } from "@/lib/api/utils";

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "notifications", "update");
    const id = Number((await params).id);
    if (!Number.isInteger(id)) return err("Invalid notification id", 400);

    // Self-scope: a user may only mark their own notifications read.
    // employee_id is int and user_id is uuid — scope on whichever identity is
    // actually present, mirroring GET /api/notifications and /read-all.
    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    if (own == null) return ok({ read: false });

    const isEmp = session.user?.employeeId != null;
    await query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE notification_id = $1 AND ${isEmp ? "employee_id" : "user_id"} = $2`,
      [id, own]
    );
    return ok({ read: true });
  } catch (e) { return handleError(e); }
}
