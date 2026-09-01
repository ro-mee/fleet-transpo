import { query, withTransaction } from "@/lib/db";
import { requirePermission, ok, err, handleError, parseBody } from "@/lib/api/utils";
import { writeAudit } from "@/lib/audit";

// Custodial driver ↔ vehicle pairings (migration 017).
//
// This records who is *normally* responsible for a car — for fuel, cleanliness,
// and damage accountability. It is deliberately NOT a double-booking guard:
// overlapping-window conflicts are caught by evaluateRequestConflicts and
// enforced at /api/dispatch with a 409. A dispatch that departs from the pairing
// raises a WARNING only, because a driver whose paired car is in maintenance
// must still be able to take another one.
//
// "Active" means assigned_until IS NULL — exactly the predicate on the
// uq_dva_active_driver / uq_dva_active_vehicle partial unique indexes, so
// Postgres itself guarantees at most one active row per driver and per vehicle.

const SELECT_ASSIGNMENT = `
  SELECT a.assignment_id, a.driver_id, a.vehicle_id, a.assigned_from, a.assigned_until,
         a.release_reason, a.notes, a.created_at, a.updated_at,
         v.plate_number, v.vehicle_name, v.vehicle_status,
         e.first_name, e.last_name
    FROM driver_vehicle_assignments a
    LEFT JOIN vehicles v ON v.vehicle_id = a.vehicle_id
    LEFT JOIN drivers d ON d.driver_id = a.driver_id
    LEFT JOIN employees e ON e.employee_id = d.employee_id
`;

/**
 * GET /api/driver-assignments
 *   ?driver_id=  ?vehicle_id=  ?history=1
 *
 * Defaults to active pairings only. `history=1` returns closed intervals too,
 * newest first — that is the point of modelling this as a history rather than a
 * column, so the endpoint has to be able to show it.
 */
export async function GET(req) {
  try {
    await requirePermission(req, "driver_assignments", "read");

    const { searchParams } = new URL(req.url);
    const driverId = searchParams.get("driver_id");
    const vehicleId = searchParams.get("vehicle_id");
    const history = searchParams.get("history") === "1";

    const where = [];
    const params = [];
    if (!history) where.push(`a.assigned_until IS NULL`);
    if (driverId) { params.push(Number(driverId)); where.push(`a.driver_id = $${params.length}`); }
    if (vehicleId) { params.push(Number(vehicleId)); where.push(`a.vehicle_id = $${params.length}`); }

    const { rows } = await query(
      `${SELECT_ASSIGNMENT}
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
       ORDER BY a.assigned_until IS NOT NULL, a.assigned_from DESC, a.assignment_id DESC`,
      params
    );

    return ok({ assignments: rows });
  } catch (e) {
    return handleError(e);
  }
}

/**
 * POST /api/driver-assignments  { driver_id, vehicle_id, notes?, force? }
 *
 * Pairs a driver with a vehicle. Moving a driver to a different car closes their
 * own previous pairing silently — that is an unambiguous intent. Taking a car
 * that ANOTHER driver currently holds is not, so it answers 409 with the
 * displaced pairing in the body until the caller repeats the request with
 * `force: true`.
 *
 * The close-then-open runs in one transaction: the partial unique indexes reject
 * the new row while the old one is still open, so the two statements cannot be
 * allowed to land separately.
 */
export async function POST(req) {
  try {
    const session = await requirePermission(req, "driver_assignments", "create");
    const body = await parseBody(req);

    const driverId = Number(body?.driver_id);
    const vehicleId = Number(body?.vehicle_id);
    if (!Number.isInteger(driverId) || driverId <= 0) return err("A valid driver is required.", 400);
    if (!Number.isInteger(vehicleId) || vehicleId <= 0) return err("A valid vehicle is required.", 400);

    // Both sides must exist and be live. Without this a typo'd id would surface
    // as a raw FK violation from Postgres instead of a readable message.
    const [{ rows: dRows }, { rows: vRows }] = await Promise.all([
      query(
        `SELECT d.driver_id, e.first_name, e.last_name
           FROM drivers d
           LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [driverId]
      ),
      query(
        `SELECT vehicle_id, plate_number, vehicle_status
           FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [vehicleId]
      ),
    ]);
    if (!dRows.length) return err("Driver not found.", 404);
    if (!vRows.length) return err("Vehicle not found.", 404);

    const { rows: current } = await query(
      `${SELECT_ASSIGNMENT}
        WHERE a.assigned_until IS NULL
          AND (a.driver_id = $1 OR a.vehicle_id = $2)`,
      [driverId, vehicleId]
    );

    // Already paired exactly this way — nothing to do. Idempotent rather than a
    // spurious unique-violation 500.
    const identical = current.find((a) => a.driver_id === driverId && a.vehicle_id === vehicleId);
    if (identical) return ok({ assignment: identical, unchanged: true });

    // Someone else currently holds this vehicle. Needs an explicit override.
    const heldByOther = current.find((a) => a.vehicle_id === vehicleId && a.driver_id !== driverId);
    if (heldByOther && body?.force !== true) {
      const who = `${heldByOther.first_name || ""} ${heldByOther.last_name || ""}`.trim()
        || `driver #${heldByOther.driver_id}`;
      return Response.json(
        {
          error: `${vRows[0].plate_number} is currently assigned to ${who}. Reassign anyway?`,
          requires_force: true,
          current_assignment: heldByOther,
        },
        { status: 409 }
      );
    }

    const assignment = await withTransaction(async (tx) => {
      // Close every active pairing that stands in the way — the driver's own car
      // and, when forced, the vehicle's current custodian.
      await tx.query(
        `UPDATE driver_vehicle_assignments
            SET assigned_until = CURRENT_DATE,
                release_reason = COALESCE(release_reason, 'Reassigned'),
                updated_at = NOW(),
                updated_by = $3
          WHERE assigned_until IS NULL
            AND (driver_id = $1 OR vehicle_id = $2)`,
        [driverId, vehicleId, session.user.employeeId ?? null]
      );

      const { rows } = await tx.query(
        `INSERT INTO driver_vehicle_assignments
           (driver_id, vehicle_id, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4)
         RETURNING assignment_id`,
        [driverId, vehicleId, body?.notes || null, session.user.employeeId ?? null]
      );
      return rows[0];
    });

    const { rows: created } = await query(
      `${SELECT_ASSIGNMENT} WHERE a.assignment_id = $1`,
      [assignment.assignment_id]
    );

    await writeAudit(req, session, {
      action: "create",
      resource: "driver_assignments",
      resourceId: assignment.assignment_id,
      newValues: {
        driver_id: driverId,
        vehicle_id: vehicleId,
        replaced: current.map((a) => a.assignment_id),
        forced: body?.force === true,
      },
    });

    return ok({ assignment: created[0], replaced: current.map((a) => a.assignment_id) }, 201);
  } catch (e) {
    // The partial unique indexes are the real guard; if a concurrent request
    // wins the race, surface that as a conflict rather than a 500.
    if (e?.code === "23505") {
      return err("That driver or vehicle was just assigned by someone else. Reload and try again.", 409);
    }
    return handleError(e);
  }
}
