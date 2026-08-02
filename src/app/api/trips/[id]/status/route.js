import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { canTransitionTrip } from "@/lib/scheduling/trip-state";
import { writeAudit } from "@/lib/audit";

export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "driver"]);
    const id = (await params).id;
    const body = await parseBody(req);
    const next = body.status;
    if (!next) return err("A status is required.", 400);

    const { rows: before } = await query(
      `SELECT trip_status FROM trips WHERE trip_id = $1 LIMIT 1`,
      [id]
    );
    if (!before[0]) return err("Trip not found", 404);

    const check = canTransitionTrip(before[0].trip_status, next);
    if (!check.ok) return err(check.reason, 409);

    const { rows } = await query(
      `UPDATE trips SET trip_status = $1 WHERE trip_id = $2 RETURNING *`,
      [next, id]
    );
    if (!rows[0]) return err("Trip not found", 404);

    await writeAudit(req, session, {
      action: "update",
      resource: "trips",
      resourceId: id,
      oldValues: { trip_status: before[0].trip_status },
      newValues: { trip_status: next },
    });

    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
