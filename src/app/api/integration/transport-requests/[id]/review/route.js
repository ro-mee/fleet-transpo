import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";
import { NON_DISPATCHABLE_VEHICLE_STATUSES } from "@/lib/ai/pair-scoring";

// Fleet review — START REVIEW on a transportation request.
//
// Moves a freshly-arrived request from Pending to Under Review, stamps who
// picked it up, and attaches the deterministic dispatch scoring so the review
// dialog can show a candidate vehicle/driver the moment it opens.
//
// Scoring here is RULE-BASED and local (see lib/ai/rule-engine.js) — no LLM and
// no network call. That is deliberate: a status transition must not depend on an
// external provider being up or fast. The LLM-written rationale lives on the
// recommendation endpoint, which is advisory and may fail without consequence.
export async function PUT(req, { params }) {
  try {
    const session = await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const before = await loadRequest(id);
    if (!before) return err("Transportation request not found", 404);

    // Candidate pools for scoring, plus the pairing data the scorer needs to
    // decide WHO may drive each vehicle.
    //
    // Vehicles: excluded only by statuses that ground the vehicle. `Reserved`
    // means "has a booking today", not "taken at this hour", so it is kept and
    // the `schedule_load` overlap below decides the requested window instead —
    // the same authority the recommendation endpoint uses.
    //
    // Drivers: the whole roster. The scorer must be able to see that a vehicle's
    // custodian is On Leave in order to look for their assigned substitute; with
    // only `Available` rows it would mistake the car for one that has no
    // custodian at all. Eligibility is then re-checked per driver.
    //
    // Pairs/substitutes were previously not loaded here at all, so this endpoint
    // scored every vehicle as having no designated driver.
    const windowStart = before?.pickup_datetime ? new Date(before.pickup_datetime).toISOString() : null;
    const windowEnd = windowStart
      ? new Date(new Date(windowStart).getTime() + 60 * 60 * 1000).toISOString()
      : null;

    const [{ rows: vehicles }, { rows: drivers }, { rows: activePairs }, { rows: activeSubstitutes }] =
      await Promise.all([
        query(
          `SELECT v.*, vc.category_name,
                  COALESCE((
                    SELECT COUNT(*)
                      FROM dispatchschedules ds
                     WHERE ds.vehicle_id = v.vehicle_id
                       AND ds.deleted_at IS NULL
                       AND ds.status IN ('Scheduled', 'In Progress')
                       AND ($2::timestamptz IS NULL OR ds.scheduled_departure < $2)
                       AND ($1::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1)
                  ), 0)::int AS schedule_load
             FROM vehicles v
             LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
            WHERE v.deleted_at IS NULL
              AND v.vehicle_status <> ALL($3::text[])`,
          [windowStart, windowEnd, NON_DISPATCHABLE_VEHICLE_STATUSES]
        ),
        query(
          `SELECT d.*, e.first_name, e.last_name, e.phone,
                  COALESCE((
                    SELECT COUNT(*)
                      FROM dispatchschedules ds
                     WHERE ds.driver_id = d.driver_id
                       AND ds.deleted_at IS NULL
                       AND ds.status IN ('Scheduled', 'In Progress')
                       AND ($2::timestamptz IS NULL OR ds.scheduled_departure < $2)
                       AND ($1::timestamptz IS NULL OR COALESCE(ds.scheduled_arrival, ds.scheduled_departure) > $1)
                  ), 0)::int AS schedule_load
             FROM drivers d
             LEFT JOIN employees e ON d.employee_id = e.employee_id
            WHERE d.deleted_at IS NULL`,
          [windowStart, windowEnd]
        ),
        query(`SELECT driver_id, vehicle_id FROM driver_vehicle_assignments WHERE assigned_until IS NULL`),
        query(
          `SELECT vehicle_id, substitute_driver_id, effective_from, effective_until
             FROM substitute_vehicle_schedules`
        ),
      ]);

    for (const v of vehicles) v._schedule_load = Number(v.schedule_load) || 0;
    for (const d of drivers) d._schedule_load = Number(d.schedule_load) || 0;

    const recommendation = buildDispatchRecommendation({
      request: before,
      vehicles,
      drivers,
      activePairs,
      activeSubstitutes,
    });
    const recVehicle = recommendation.vehicle?.recommended;
    const recDriver = recommendation.driver?.recommended;

    const scoringNote = recVehicle && recDriver
      ? `Dispatch scorer: ${recVehicle.vehicle_name || "Vehicle"} (${recVehicle.score}% match) and driver ${recDriver.driver_name} (${recDriver.score}% match).`
      : "Dispatch scorer: no scheduling conflicts detected.";

    const result = await advanceReservation({
      requestId: id,
      toStatus: L.UNDER_REVIEW,
      session,
      eventType: E.REVIEWED,
      description: `Fleet review started. ${scoringNote}`,
      patch: {
        reviewed_by: session?.user?.employeeId ?? null,
        reviewed_at: new Date().toISOString(),
        ai_vehicle_recommendation: JSON.stringify(recommendation.vehicle),
        ai_driver_recommendation: JSON.stringify(recommendation.driver),
      },
    });

    if (!result.ok) return err(result.error, result.status || 409);

    // Record the scoring on the timeline. Not an LLM call — see the note above.
    await recordReservationEvent({
      requestId: id,
      eventType: E.VEHICLE_RECOMMENDED,
      description: scoringNote,
      session,
      metadata: recVehicle?.score != null ? { match_score: recVehicle.score } : null,
    });

    await writeAudit(req, session, {
      action: "update",
      resource: "transportation_requests",
      resourceId: id,
      oldValues: { fleet_status: before.fleet_status },
      newValues: { fleet_status: L.UNDER_REVIEW },
    });

    return ok(result.request);
  } catch (e) { return handleError(e); }
}
