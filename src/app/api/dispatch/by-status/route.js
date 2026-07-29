import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";

export async function GET(req) {
  try {
    await requireAuth(req);
    const { rows: data } = await query(`SELECT ds.*, row_to_json(v.*) as vehicles, row_to_json(d.*) as drivers FROM dispatchschedules ds LEFT JOIN vehicles v ON ds.vehicle_id = v.vehicle_id LEFT JOIN drivers d ON ds.driver_id = d.driver_id WHERE ds.deleted_at IS NULL`);
    return ok({
      pending: data.filter(d => d.status === "Pending"),
      approved: data.filter(d => d.status === "Approved"),
      dispatched: data.filter(d => d.status === "Dispatched"),
      inProgress: data.filter(d => ["In Progress","Driver Accepted","En Route"].includes(d.status)),
      completed: data.filter(d => d.status === "Completed"),
    });
  } catch (e) { return handleError(e); }
}
