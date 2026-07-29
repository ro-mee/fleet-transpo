import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows } = await query(`SELECT driver_id, driver_status FROM drivers WHERE deleted_at IS NULL`);
    const total = rows.length;
    const available = rows.filter(d => d.driver_status === "Available").length;
    const onTrip = rows.filter(d => d.driver_status === "On Trip").length;
    const offDuty = rows.filter(d => d.driver_status === "Off Duty").length;
    const onLeave = rows.filter(d => d.driver_status === "On Leave").length;
    const suspended = rows.filter(d => d.driver_status === "Suspended").length;
    return ok({ total, available, onTrip, offDuty, onLeave, suspended });
  } catch (e) { return handleError(e); }
}
