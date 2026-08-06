import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function PUT(req) {
  try {
    const session = await requireAuth(req);
    const own = session.user?.employeeId ?? session.user?.userId ?? null;
    if (own == null) return ok({ read: false });
    // employee_id is int, user_id is uuid — scope on whichever identity is
    // present, mirroring the self-scoping in GET /api/notifications so one
    // user can never clear another user's read state.
    const isEmp = session.user?.employeeId != null;
    const { rowCount } = await query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE is_read = false AND ${isEmp ? "employee_id" : "user_id"} = $1`,
      [own]
    );
    return ok({ read: true, updated: rowCount });
  } catch (e) { return handleError(e); }
}
