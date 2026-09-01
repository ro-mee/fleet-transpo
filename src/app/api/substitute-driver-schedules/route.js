import { query, withTransaction } from "@/lib/db";
import { requirePermission, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

// Substitute driver schedules (migration 032).
//
// A vehicle's designated custodian can be suspended or otherwise unavailable,
// in which case the vehicle must not be recommended/dispatched to anyone until
// a substitute driver is explicitly scheduled to cover it for that date (or an
// open-ended period). This endpoint manages those substitute schedules.
//
// "Active" means the schedule currently covers dates — either open-ended
// (effective_until IS NULL) or a bounded range that has not yet passed.

const SELECT_SCHEDULE = `
  SELECT s.substitute_id, s.vehicle_id, s.substitute_driver_id,
         s.effective_from, s.effective_until, s.notes, s.created_at, s.updated_at,
         v.plate_number, v.vehicle_name, v.vehicle_status,
         e.first_name, e.last_name, d.driver_status
    FROM substitute_vehicle_schedules s
    LEFT JOIN vehicles v ON v.vehicle_id = s.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = s.substitute_driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
`;

/**
 * GET /api/substitute-driver-schedules
 *   ?vehicle_id=  ?driver_id=  ?date=YYYY-MM-DD
 *
 * Defaults to all schedules. `?date=` filters to schedules covering that date
 * (open-ended OR the range contains it). Order: open-ended first, then by
 * effective_from desc.
 */
export async function GET(req) {
  try {
    await requirePermission(req, "substitute_driver_schedules", "read");

    const { searchParams } = new URL(req.url);
    const vehicleId = searchParams.get("vehicle_id");
    const driverId = searchParams.get("driver_id");
    const date = searchParams.get("date");

    const where = [];
    const params = [];
    if (vehicleId) { params.push(Number(vehicleId)); where.push(`s.vehicle_id = $${params.length}`); }
    if (driverId) { params.push(Number(driverId)); where.push(`s.substitute_driver_id = $${params.length}`); }
    if (date) {
      params.push(date);
      where.push(
        `( s.effective_until IS NULL
           OR (s.effective_from <= $${params.length}::date AND s.effective_until >= $${params.length}::date) )`
      );
    }

    const { rows } = await query(
      `${SELECT_SCHEDULE}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY s.effective_until IS NOT NULL, s.effective_from DESC, s.substitute_id DESC`,
      params
    );

    return ok({ schedules: rows });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST /api/substitute-driver-schedules
 *   { vehicle_id, substitute_driver_id, effective_from?, effective_until?, notes? }
 *
 * Schedules a substitute driver to cover a vehicle. effective_from defaults to
 * today; effective_until omitted means open-ended.
 */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "substitute_driver_schedules", "create");
    const body = await parseBody(req);

    const vehicleId = Number(body?.vehicle_id);
    const subDriverId = Number(body?.substitute_driver_id);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return err("A valid vehicle is required.", 400);
    if (!Number.isInteger(subDriverId) || subDriverId <= 0) return err("A valid substitute driver is required.", 400);

    // Validate dates.
    const from = body?.effective_from || new Date().toISOString().slice(0, 10);
    const until = body?.effective_until || null;
    const fromD = new Date(from);
    if (Number.isNaN(fromD.getTime())) return err("effective_from is not a valid date.", 400);
    if (until) {
      const untilD = new Date(until);
      if (Number.isNaN(untilD.getTime())) return err("effective_until is not a valid date.", 400);
      if (untilD.getTime() < fromD.getTime() - 86400000) return err("effective_until cannot be before effective_from.", 400);
    }

    // Both sides must exist and be live.
    const [{ rows: vRows }, { rows: dRows }] = await Promise.all([
      query(`SELECT vehicle_id, plate_number FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`, [vehicleId]),
      query(`SELECT d.driver_id, e.first_name, e.last_name
               FROM drivers d
               LEFT JOIN employees e ON e.employee_id = d.employee_id
              WHERE d.driver_id = $1 AND d.deleted_at IS NULL`, [subDriverId]),
    ]);
    if (!vRows.length) return err("Vehicle not found.", 404);
    if (!dRows.length) return err("Substitute driver not found.", 404);

    // App-layer overlap guard: a vehicle should not have two schedules that both
    // cover the same date (the DB enforces the open-ended special case via the
    // partial unique index; this covers the bounded-vs-bounded and
    // bounded-vs-open collisions). Failure-tolerant: a query miss is not fatal.
    const { rows: existing } = await query(
      `SELECT substitute_id, effective_from, effective_until
         FROM substitute_vehicle_schedules
        WHERE vehicle_id = $1`,
      [vehicleId]
    );
    const newFrom = fromD.getTime(), newUntil = until ? new Date(until).getTime() : null;
    const overlap = existing.find((s) => {
      const sFrom = new Date(s.effective_from).getTime();
      const sUntil = s.effective_until != null ? new Date(s.effective_until).getTime() : null;
      // Intervals overlap when each starts on or before the other ends.
      const coversFrom = newUntil == null || sFrom <= newUntil;
      const coversNew = newUntil == null || sUntil == null || sUntil >= newFrom;
      return coversFrom && coversNew;
    });
    if (overlap) {
      return err(
        `This vehicle already has a substitute scheduled (${overlap.effective_from}${overlap.effective_until ? ` to ${overlap.effective_until}` : " onward"}). Release or adjust it first.`,
        409
      );
    }

    const { rows: inserted } = await withTransaction(async (tx) => {
      return tx.query(
        `INSERT INTO substitute_vehicle_schedules
           (vehicle_id, substitute_driver_id, effective_from, effective_until, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING substitute_id`,
        [vehicleId, subDriverId, from, until, body?.notes || null, session.user.employeeId ?? null]
      );
    });

    const { rows: created } = await query(
      `${SELECT_SCHEDULE} WHERE s.substitute_id = $1`,
      [inserted.rows[0].substitute_id]
    );

    await writeAudit(req, session, {
      action: "create",
      resource: "substitute_driver_schedules",
      resourceId: created[0].substitute_id,
      newValues: {
        vehicle_id: vehicleId,
        substitute_driver_id: subDriverId,
        effective_from: from,
        effective_until: until,
      },
    });

    return ok({ schedule: created[0] }, 201);
  } catch (e) {
    if (e?.code === "23505") {
      return err("That vehicle already has an open-ended substitute scheduled. Release it first.", 409);
    }
    return handleError(e);
  }
}
