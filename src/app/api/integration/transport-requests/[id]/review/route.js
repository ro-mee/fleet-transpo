import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { RESERVATION_LIFECYCLE as L, RESERVATION_EVENT as E } from "@/lib/constants";
import { advanceReservation, loadRequest } from "@/services/reservation-lifecycle.service";
import { recordReservationEvent } from "@/services/reservation-events.service";
import { writeAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";

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

    // Fetch candidate vehicles and drivers for scoring.
    const [{ rows: vehicles }, { rows: drivers }] = await Promise.all([
      query(`SELECT v.*, vc.category_name FROM vehicles v LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id WHERE v.deleted_at IS NULL AND v.vehicle_status = 'Available'`),
      query(`SELECT d.*, e.first_name, e.last_name, e.phone FROM drivers d LEFT JOIN employees e ON d.employee_id = e.employee_id WHERE d.deleted_at IS NULL AND d.driver_status = 'Available'`),
    ]);

    const recommendation = buildDispatchRecommendation({ request: before, vehicles, drivers });
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
