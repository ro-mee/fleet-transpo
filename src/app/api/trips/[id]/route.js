import { query, withTransaction } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { TRIPS_SELECT, TRIPS_JOINS } from "@/lib/api/trips-query";
import { TRIP_WRITABLE } from "../route";
import { withQualificationWrite } from '@/services/driver-qualification-boundaries.service';
import { qualificationRollout } from '@/lib/drivers/qualification-rollout';
import { assertCargoCheckpoint, cargoLifecycleEnabled, prepareCargoLifecycle } from '@/services/cargo-execution.service';
import { guardDriverQualification } from '@/services/driver-qualification-boundaries.service';

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
    values.push(id);
    const write = db => db.query(`UPDATE trips SET ${columns.join(", ")} WHERE trip_id = $${values.length} RETURNING *`, values);
    let identity = null;
    if (qualificationRollout().mode !== 'OFF' && (body.driver_id !== undefined || body.dispatch_id !== undefined
      || (body.trip_status !== undefined && !['Completed', 'Cancelled'].includes(body.trip_status)))) {
      const { rows: current } = await query('SELECT driver_id, dispatch_id FROM trips WHERE trip_id=$1 AND deleted_at IS NULL', [id]);
      if (!current[0]) return err('Trip not found', 404);
      identity = { driverId: body.driver_id ?? current[0].driver_id, expectedDriverId: current[0].driver_id,
        tripId: id, dispatchId: body.dispatch_id ?? current[0].dispatch_id, expectedDispatchId: current[0].dispatch_id };
    }
    const { rows } = cargoLifecycleEnabled() ? await withTransaction(async tx => {
      await prepareCargoLifecycle(tx);
      await assertCargoCheckpoint({ trip_id: id }, { to: body.trip_status ?? 'Reassign', session, patch: body }, tx);
      if (identity) await guardDriverQualification(identity, tx);
      return write(tx);
    }) : identity ? await withQualificationWrite(identity, write) : await write({ query });
    if (!rows[0]) return err("Trip not found", 404);
    return ok(rows[0]);
  } catch (e) { return handleError(e); }
}
