import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { detectRequestConflicts } from "@/lib/scheduling/conflicts";
import { hasCompleteAssignment } from "@/lib/scheduling/reservation-state";
import { tomtomEtaMinutes } from "@/lib/scheduling/travel-buffer";
import { validatePairAvailability, getActiveRecommendation, markRecommendationConsumed } from "@/services/recommendation.service";
import { createDispatchForRequest, syncDispatchSideEffects } from "@/services/dispatch-autocreate.service";
import { writeAudit } from "@/lib/audit";

// §4.8.3 travel+buffer signals for the conflict gate. The caller may supply the
// per-resource ETA directly, or a TomTom origin/destination pair to compute it;
// when neither is present the gate fails OPEN (no fabricated block), so this
// never refuses a valid assignment just because a coordinate is missing.
async function buildTravelSignals(body) {
  const t = body?.travel;
  const forRes = async (key) => {
    if (t?.[key]?.etaMinutes != null) return { etaMinutes: Number(t[key].etaMinutes) };
    const o = t?.[key]?.origin;
    const d = t?.[key]?.destination;
    if (o && d) {
      const etaMinutes = await tomtomEtaMinutes({ origin: o, destination: d }).catch(() => null);
      return etaMinutes != null ? { etaMinutes } : null;
    }
    return null;
  };
  return {
    vehicle: (await forRes("vehicle")) ?? undefined,
    driver: (await forRes("driver")) ?? undefined,
  };
}

// ASSIGN a vehicle+driver pair to a request.
//
// This is the step where Fleet commits real resources, so unlike the advisory
// conflict chips in the queue, blocking conflicts here are a hard 409. The
// caller can override with { force: true } — a deliberate escape hatch for the
// dispatcher who knows something the data doesn't — and the override is written
// into the timeline metadata so it is never silent.
//
// advanceReservation validates and records Pending -> Scheduled -> Assigned.
export async function PUT(req, { params }) {
  try {
    const session = await requirePermission(req, "reservations", "assign");
    const { id } = await params;
    const body = await parseBody(req);

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    const vehicleId = Number(body?.vehicle_id);
    const driverId = Number(body?.driver_id);

    if (
      !Number.isInteger(vehicleId) || vehicleId <= 0 ||
      !Number.isInteger(driverId) || driverId <= 0 ||
      !hasCompleteAssignment(vehicleId, driverId)
    ) {
      return err("Both a valid vehicle_id and driver_id are required.", 400);
    }

    // A request must be past-terminal before resources can be committed to it.
    if (![L.PENDING, L.SCHEDULED, L.ASSIGNED].includes(before.fleet_status)) {
      return err(`Cannot assign resources to a request that is ${before.fleet_status}.`, 409);
    }

    const travel = await buildTravelSignals(body);
    const conflicts = await detectRequestConflicts(before, { vehicleId, driverId, travel });
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

    // Designated-driver enforcement: a pair that departs from the vehicle's
    // active custodian is only legal when that custodian is provably
    // unavailable for the pickup window. `force` remains the escape hatch.
    if (!force) {
      const pairCheck = await validatePairAvailability({
        request: before,
        vehicleId,
        driverId,
      });
      if (!pairCheck.ok) {
        return Response.json(
          {
            error: pairCheck.conflict.message,
            conflict: pairCheck.conflict,
            hint: "Assign the designated driver, or resend with { force: true } to override.",
          },
          { status: 409 }
        );
      }
    }

    // Verify the referenced rows exist before writing FKs, so a bad id gives a
    // clear 400 rather than a constraint violation surfacing as a 500.
    const [vehicleRow, driverRow] = await Promise.all([
      query(`SELECT vehicle_id, plate_number FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`, [vehicleId])
        .then((r) => r.rows[0] || null),
      query(
        `SELECT d.driver_id, e.first_name, e.last_name
           FROM drivers d LEFT JOIN employees e ON e.employee_id = d.employee_id
          WHERE d.driver_id = $1 AND d.deleted_at IS NULL`,
        [driverId]
      ).then((r) => r.rows[0] || null),
    ]);

    if (!vehicleRow) return err(`Vehicle ${vehicleId} not found.`, 400);
    if (!driverRow) return err(`Driver ${driverId} not found.`, 400);

    const driverLabel = `${driverRow.first_name || ""} ${driverRow.last_name || ""}`.trim() || `#${driverRow.driver_id}`;

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.ASSIGNED,
      session,
      eventType: E.VEHICLE_ASSIGNED,
      description: `Assigned vehicle ${vehicleRow.plate_number} and driver ${driverLabel}.`,
      metadata: {
        vehicle_id: vehicleId,
        driver_id: driverId,
        forced: force && blocking.length > 0,
        overridden_conflicts: force && blocking.length > 0 ? blocking : undefined,
      },
      patch: { vehicle_id: vehicleId, driver_id: driverId },
      outbound: {
        vehicle: { plate_number: vehicleRow.plate_number },
        driver: { name: driverLabel },
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    // The recommended pair was committed — consume the active snapshot so the
    // same suggestion is never reapplied or shown again for this request.
    const { snapshot: activeSnapshot } = await getActiveRecommendation(id);
    if (activeSnapshot) {
      await markRecommendationConsumed(id, activeSnapshot.snapshot_id).catch(() => {});
    }

    // Record the driver half separately when both were assigned at once, so the
    // timeline shows each committed resource rather than one merged line.
    await recordReservationEvent({
      requestId: id,
      eventType: E.DRIVER_ASSIGNED,
      fromStatus: L.ASSIGNED,
      toStatus: L.ASSIGNED,
      session,
      description: `Driver ${driverLabel} assigned.`,
      metadata: { driver_id: driverId },
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { vehicle_id: before.vehicle_id, driver_id: before.driver_id, fleet_status: before.fleet_status },
      newValues: { vehicle_id: vehicleId, driver_id: driverId, fleet_status: L.ASSIGNED },
    });

    // GAP-FIX: a full pair is now also surfaced on the Dispatch board + the
    // driver's mobile trip list. When both vehicle and driver are committed,
    // auto-create the dispatch row (with a route/trip). Best-effort — the
    // assignment above is already committed, so a failure here must never roll it
    // back or turn the request into a 500.
    let dispatchId = null;
    let dispatchNumber = null;
    try {
      const dispatch = await createDispatchForRequest({
        request: before,
        vehicleId,
        driverId,
        session,
      });
      if (dispatch) {
        dispatchId = dispatch.dispatch_id;
        dispatchNumber = dispatch.dispatch_number;
        await syncDispatchSideEffects(dispatch.dispatch_id);
        await recordReservationEvent({
          requestId: id,
          eventType: E.DISPATCH_CREATED,
          fromStatus: L.ASSIGNED,
          toStatus: L.ASSIGNED,
          session,
          description: `Dispatch ${dispatch.dispatch_number || `#${dispatch.dispatch_id}`} created.`,
          metadata: { dispatch_id: dispatch.dispatch_id, dispatch_number: dispatch.dispatch_number ?? null },
        });
      }
    } catch (syncErr) {
      console.warn(`auto-dispatch for request ${id} failed:`, syncErr?.message || syncErr);
    }

    return ok({
      ...result.request,
      warnings: force ? blocking : [],
      dispatch_id: dispatchId ?? undefined,
      dispatch_number: dispatchNumber ?? undefined,
    });
  } catch (e) { return handleError(e); }
}
