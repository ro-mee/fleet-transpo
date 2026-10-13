import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { TRIP_WRITABLE } from "../route";
import { assertCargoCheckpoint, cargoLifecycleEnabled, prepareCargoLifecycle } from '@/services/cargo-execution.service';
import { tripDriverTypeMismatch } from "@/lib/drivers/trip-type-gate";

export async function GET(req, { params }) {
  try {
    await requirePermission(req, "trips", "read_all");
    const id = (await params).id;
    const { rows } = await query(`SELECT ${TRIPS_SELECT} ${TRIPS_JOINS} WHERE t.trip_id = $1 AND t.deleted_at IS NULL LIMIT 1`, [id]);
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}

export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "trips", "update_all");
    const id = (await params).id;
    const body = await parseBody(req);
    const columns = [];
    const values = [];
    for (const key of TRIP_WRITABLE) {
      if (body[key] !== undefined) {
        columns.push(`${key} = $${columns.length + 1}`);
        values.push(body[key]);
      }
    }
    if (columns.length === 0) return err("No valid fields provided", 400);
    // Static classification gate on the merged pair: changing driver_id or
    // dispatch_id must not assemble a mismatched trip (same rule as POST).
    if (body.driver_id !== undefined || body.dispatch_id !== undefined) {
      const { rows: existing } = await query(
        `SELECT driver_id, dispatch_id FROM trips WHERE trip_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      if (!existing[0]) return err("Trip not found", 404);
      const driverId = body.driver_id !== undefined ? body.driver_id : existing[0].driver_id;
      const dispatchId = body.dispatch_id !== undefined ? body.dispatch_id : existing[0].dispatch_id;
      const mismatch = await tripDriverTypeMismatch({ query }, { driverId, dispatchId });
      if (mismatch) return err(mismatch.message, 409);
    }
    values.push(id);
    const write = db => db.query(`UPDATE trips SET ${columns.join(", ")} WHERE trip_id = $${values.length} RETURNING *`, values);
    const { rows } = cargoLifecycleEnabled() ? await withTransaction(async tx => {
      await prepareCargoLifecycle(tx);
      await assertCargoCheckpoint({ trip_id: id }, { to: body.trip_status ?? 'Reassign', session, patch: body }, tx);
      return write(tx);
    }) : await write({ query });
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
