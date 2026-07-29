import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";

export async function PUT(req, { params }) {
  try {
    await requireAuth(req);
    const id = (await params).id;
    const body = await parseBody(req);
    const keys = Object.keys(body);
    const values = Object.values(body);
    const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
    const { rows } = await query(
      `UPDATE vehiclemaintenance SET ${setClause} WHERE maintenance_id = $${keys.length + 1} RETURNING *`,
      [...values, id]
    );
    if (!rows[0]) return err("Maintenance record not found", 404);
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
    }
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
