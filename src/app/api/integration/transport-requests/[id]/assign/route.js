import { query } from "@/lib/db";
import { requirePermission, parseBody, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { detectRequestConflicts } from "@/lib/scheduling/conflicts";
import { hasCompleteAssignment } from "@/lib/scheduling/reservation-state";
import { resolveTravelSignals, travelAdvisories } from "@/lib/scheduling/travel-signals";
import { validatePairAvailability, getActiveRecommendation, markRecommendationConsumed } from "@/services/recommendation.service";
import { createDispatchForRequest, syncDispatchSideEffects } from "@/services/dispatch-autocreate.service";
import { writeAudit } from "@/lib/audit";
import { commitDispatchEvidence } from '@/services/dispatch-evidence.service';
import { verifyPlanToken } from '@/services/dispatch-plan-evidence.service';
import { isFuelNoise } from '@/lib/dispatch/decision';

// NOTE: the §4.8.3 travel+buffer signals are no longer built from the request
// body. `body.travel` is still accepted, but only as a cross-check against the
// ETA the server derives from stored data — see lib/scheduling/travel-signals.

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
    const force = body?.force === true;
    const overrideReason = typeof body?.override_reason === 'string' ? body.override_reason.trim() : '';
    if (force && (!overrideReason || overrideReason.length > 500)) return err('Manual review requires a reason between 1 and 500 characters.',400);

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

    const planSelection = { requestId: id, vehicleId, driverId, mode:force ? 'manual' : 'verified' };
    if (body.plan_token !== undefined) await verifyPlanToken(body.plan_token, planSelection);

    const travel = await resolveTravelSignals({
      request: before,
      vehicleId,
      driverId,
      claimed: body?.travel ?? null,
    });
    const conflicts = await detectRequestConflicts(before, { vehicleId, driverId, travel });
    // What the gate could not verify, and where the caller's own estimate
    // disagreed with the derived one. WARNING only — these inform the dispatcher,
    // they never become the 409 below. (`§4.8.3`'s unverified case is raised by
    // detectRequestConflicts itself, from the same shared evaluator the queue
    // uses, so this only adds what is unique to the assign call: the cross-check.)
    const advisories = travelAdvisories(travel, { vehicleId, driverId });
    conflicts.push(...advisories);
    const blocking = conflicts.filter((c) => c.severity === "blocking");

    if (blocking.length > 0) {
      return Response.json(
        {
          error: blocking[0].message,
          conflicts: blocking,
          hint: "Resolve the hard conflicts before assigning.",
        },
        { status: 409 }
      );
    }

    // Designated-driver enforcement: a pair that departs from the vehicle's
    // active custodian is only legal when that custodian is provably
    // unavailable for the pickup window. `force` remains the escape hatch.
    let pairCheck;
    {
      pairCheck = await validatePairAvailability({
        request: before,
        allowReview: force && typeof body?.override_reason === "string" && body.override_reason.trim().length > 0,
        vehicleId,
        driverId,
      });
      if (!pairCheck.ok) {
        return Response.json(
          {
            error: pairCheck.conflict.message,
            conflict: pairCheck.conflict,
            hint: "Resolve the conflict. Only unverified evidence allows manual review with an override reason.",
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

    let committedDispatch = null;
    const assignmentRequest = { ...before, scheduled_arrival:pairCheck.serviceEnd };
    const result = await advanceReservation({
      requestId: id,
      toStatus: L.ASSIGNED,
      session,
      eventType: E.VEHICLE_ASSIGNED,
      description: `Assigned vehicle ${vehicleRow.plate_number} and driver ${driverLabel}.`,
      metadata: {
        dispatch_evidence: pairCheck.evidence,
        vehicle_id: vehicleId,
        driver_id: driverId,
        forced: force,
        manual_review: pairCheck.reviewed === true,
        acknowledged_findings: force ? [...(pairCheck.evidence?.advisories ?? []).filter((a) => !isFuelNoise(a?.message)), ...(pairCheck.evidence?.feasibility?.reasons ?? []).map(message=>({message}))] : undefined,
        // PR #2 thesis field: why the dispatcher ignored the advisory/blocks.
        override_reason:
          force && typeof body?.override_reason === "string" && body.override_reason.trim()
            ? body.override_reason.trim().slice(0, 500)
            : undefined,
      },
      patch: { vehicle_id: vehicleId, driver_id: driverId },
      writeAssignment: (sql, values, event) => commitDispatchEvidence(pairCheck.commitToken, async tx => {
        // Recheck under the existing operational locks, before the assignment.
        if (body.plan_token !== undefined) await verifyPlanToken(body.plan_token, planSelection, tx);
        const updated = await tx.query(sql,values);
        if (!updated.rows[0]) return updated;
        committedDispatch = await createDispatchForRequest({ request:assignmentRequest,vehicleId,driverId,session,tx });
        await recordReservationEvent({...event,db:tx,strict:true});
        return {...updated,eventRecorded:true};
      }),
      outbound: {
        vehicle: { plate_number: vehicleRow.plate_number },
        driver: { name: driverLabel },
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    // The recommended pair was committed — consume the active snapshot so the
    // same suggestion is never reapplied or shown again for this request.
    const { snapshot: activeSnapshot } = await getActiveRecommendation(id);
    if (activeSnapshot && Number(activeSnapshot.vehicle_id) === vehicleId && Number(activeSnapshot.driver_id) === driverId) {
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
      const dispatch = committedDispatch;
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
      reviewed: pairCheck.reviewed === true,
      warnings: force ? (pairCheck.evidence?.advisories ?? []).filter((a) => !isFuelNoise(a?.message)) : [],
      advisories: advisories.length ? advisories : undefined,
      dispatch_id: dispatchId ?? undefined,
      dispatch_number: dispatchNumber ?? undefined,
    });
  } catch (e) { return handleError(e); }
}
