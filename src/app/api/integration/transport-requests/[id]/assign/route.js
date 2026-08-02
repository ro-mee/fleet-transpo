import { query } from "@/lib/db";
import { requireAuth, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { detectRequestConflicts } from "@/lib/scheduling/conflicts";
import { writeAudit } from "@/lib/audit";

// ASSIGN a vehicle and/or driver to an approved request.
//
// This is the step where Fleet commits real resources, so unlike the advisory
// conflict chips in the queue, blocking conflicts here are a hard 409. The
// caller can override with { force: true } — a deliberate escape hatch for the
// dispatcher who knows something the data doesn't — and the override is written
// into the timeline metadata so it is never silent.
//
// Assignment walks Approved → Scheduled → Assigned via advanceReservation, so
// each hop is validated and recorded rather than jumping the chain.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;
    const body = await parseBody(req);

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const vehicleId = body?.vehicle_id != null ? Number(body.vehicle_id) : before.vehicle_id;
    const driverId = body?.driver_id != null ? Number(body.driver_id) : before.driver_id;

    if (!vehicleId && !driverId) {
      return err("At least one of vehicle_id or driver_id is required.", 400);
    }

    // A request must clear review before resources can be committed to it.
    if (![L.APPROVED, L.SCHEDULED, L.ASSIGNED].includes(before.fleet_status)) {
      return err(`Cannot assign resources to a request that is ${before.fleet_status}.`, 409);
    }

    const conflicts = await detectRequestConflicts(before, { vehicleId, driverId });
    const blocking = conflicts.filter((c) => c.severity === "blocking");
    const force = body?.force === true;

    if (blocking.length > 0 && !force) {
      return Response.json(
        {
          error: blocking[0].message,
          conflicts: blocking,
          hint: "Resolve the conflicts or resend with { force: true } to override.",
        },
        { status: 409 }
      );
    }

    // Verify the referenced rows exist before writing FKs, so a bad id gives a
    // clear 400 rather than a constraint violation surfacing as a 500.
    const [vehicleRow, driverRow] = await Promise.all([
      vehicleId
        ? query(`SELECT vehicle_id, plate_number FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`, [vehicleId])
            .then((r) => r.rows[0] || null)
        : null,
      driverId
        ? query(
            `SELECT d.driver_id, e.first_name, e.last_name
               FROM drivers d LEFT JOIN employees e ON e.employee_id = d.employee_id
              WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
            [driverId]
          ).then((r) => r.rows[0] || null)
        : null,
    ]);

    if (vehicleId && !vehicleRow) return err(`Vehicle ${vehicleId} not found.`, 400);
    if (driverId && !driverRow) return err(`Driver ${driverId} not found.`, 400);

    const driverLabel = driverRow
      ? `${driverRow.first_name || ""} ${driverRow.last_name || ""}`.trim() || `#${driverRow.driver_id}`
      : null;

    const parts = [];
    if (vehicleRow) parts.push(`vehicle ${vehicleRow.plate_number}`);
    if (driverLabel) parts.push(`driver ${driverLabel}`);

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.ASSIGNED,
      session,
      eventType: vehicleRow && driverRow ? E.VEHICLE_ASSIGNED : vehicleRow ? E.VEHICLE_ASSIGNED : E.DRIVER_ASSIGNED,
      description: `Assigned ${parts.join(" and ")}.`,
      metadata: {
        vehicle_id: vehicleId || null,
        driver_id: driverId || null,
        forced: force && blocking.length > 0,
        overridden_conflicts: force && blocking.length > 0 ? blocking : undefined,
      },
      patch: { vehicle_id: vehicleId || null, driver_id: driverId || null },
      outbound: {
        vehicle: vehicleRow ? { plate_number: vehicleRow.plate_number } : null,
        driver: driverLabel ? { name: driverLabel } : null,
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    // Record the driver half separately when both were assigned at once, so the
    // timeline shows each committed resource rather than one merged line.
    if (vehicleRow && driverRow) {
      await recordReservationEvent({
        requestId: id,
        eventType: E.DRIVER_ASSIGNED,
        fromStatus: L.ASSIGNED,
        toStatus: L.ASSIGNED,
        session,
        description: `Driver ${driverLabel} assigned.`,
        metadata: { driver_id: driverId },
      });
    }

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { vehicle_id: before.vehicle_id, driver_id: before.driver_id, fleet_status: before.fleet_status },
      newValues: { vehicle_id: vehicleId || null, driver_id: driverId || null, fleet_status: L.ASSIGNED },
    });

    return ok({ ...result.request, warnings: force ? blocking : [] });
  } catch (e) { return handleError(e); }
}
