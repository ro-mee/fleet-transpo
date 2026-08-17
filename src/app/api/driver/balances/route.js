import { query } from "@/lib/db";
import { requireDriver, ok, handleError } from "@/lib/api/utils";

// Driver self-service balances
export async function GET(req) {
  try {
    const session = await requireDriver(req);
    const { rows } = await query(
      `SELECT balance_id, leave_type, allocated_days, used_days FROM driver_leave_balances WHERE driver_id = $1`,
      [session.user.driverId]
    );
    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
