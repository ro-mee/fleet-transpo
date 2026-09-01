import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    const session = await requireAuth(req, "*");
    const { rows } = await query(
      `SELECT enabled_at, setup_expires_at
         FROM employee_mfa
        WHERE employee_id = $1
        LIMIT 1`,
      [session.user.employeeId]
    );
    const row = rows[0];
    return ok({
      enabled: Boolean(row?.enabled_at),
      setupPending: Boolean(row?.setup_expires_at && new Date(row.setup_expires_at) > new Date()),
    });
  } catch (error) {
    return handleError(error);
  }
}
