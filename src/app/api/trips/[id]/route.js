import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { TRIP_WRITABLE } from "../route";
import { assertCargoCheckpoint, prepareCargoLifecycle } from '@/services/cargo-execution.service';
import { assertStoredVehicleLoadCompatibility } from '@/lib/trips/vehicle-load-compatibility';
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
    const { rows } = await withTransaction(async tx => {
      await prepareCargoLifecycle(tx);
      await assertCargoCheckpoint({ trip_id: id }, { to: body.trip_status ?? 'Reassign', session, patch: body }, tx);
      // Stored-compatibility recheck on the effective pair (same order as the
      // dispatch edit: checkpoint, then compatibility). A vehicle-only edit
      // never reaches the pre-transaction mismatch gate above, so reassignment
      // onto a Cargo vehicle without typed load is refused here with 409.
      const { rows: current } = await tx.query(
        `SELECT driver_id, vehicle_id, dispatch_id FROM trips WHERE trip_id = $1 AND deleted_at IS NULL`,
        [id]
      );
      const effDriverId = body.driver_id !== undefined ? body.driver_id : current[0]?.driver_id;
      const effVehicleId = body.vehicle_id !== undefined ? body.vehicle_id : current[0]?.vehicle_id;
      const effDispatchId = body.dispatch_id !== undefined ? body.dispatch_id : current[0]?.dispatch_id;
      if (effDriverId != null && effVehicleId != null) {
        let requestId = null;
        if (effDispatchId != null) {
          const { rows: dsRows } = await tx.query(
            `SELECT request_id FROM dispatchschedules WHERE dispatch_id = $1 AND deleted_at IS NULL`,
            [effDispatchId]
          );
          requestId = dsRows[0]?.request_id ?? null;
        }
        await assertStoredVehicleLoadCompatibility({ db: tx, driverId: effDriverId, vehicleId: effVehicleId, requestId });
      }
      return write(tx);
    });
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) {
    if (e?.code === 'VEHICLE_LOAD_INCOMPATIBLE') return err(e.message, 409);
    return handleError(e);
  }
}
