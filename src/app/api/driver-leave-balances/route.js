import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { query } from "@/lib/db";

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const sp = new URL(req.url).searchParams;
    const driverId = sp.get("driver_id");
    
    let sql = `SELECT balance_id, driver_id, leave_type, allocated_days, used_days FROM driver_leave_balances`;
    const params = [];
    if (driverId) {
      sql += ` WHERE driver_id = $1`;
      params.push(Number(driverId));
    }
    
    const { rows } = await query(sql, params);
    return ok(rows);
  } catch (e) {
    return handleError(e);
  }
}
