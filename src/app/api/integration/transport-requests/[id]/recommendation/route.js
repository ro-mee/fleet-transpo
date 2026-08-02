import { query } from "@/lib/db";
import { requireAuth, ok, err, handleError } from "@/lib/api/utils";
import { loadRequest } from "@/services/reservation-lifecycle.service";
import { buildDispatchRecommendation } from "@/lib/ai/dispatch-advisor";

// AI dispatch recommendation for a single request (Phase 14).
//
// GET is a pure preview — it scores the current candidate pool and returns the
// payload without writing anything, so a dispatcher can open the panel on a
// request in any status. POST caches the result onto the request so the queue
// can render a badge without re-scoring on every page load.
//
// Candidate pools are filtered to genuinely dispatchable resources here, using
// the same "Available and not soft-deleted" definition as /api/vehicles/available.
// Scoring itself is deterministic and lives in lib/ai/dispatch-advisor.js.

async function fetchCandidates(request) {
  const passengers = Number(request?.passenger_count) || 1;

  const [vehicles, drivers] = await Promise.all([
    query(
      `SELECT v.*, row_to_json(vc.*) AS vehiclecategories
         FROM vehicles v
         LEFT JOIN vehiclecategories vc ON v.category_id = vc.category_id
        WHERE v.deleted_at IS NULL
          AND v.vehicle_status = 'Available'
          AND (v.seating_capacity IS NULL OR v.seating_capacity >= $1)
          AND ($2::int IS NULL OR v.category_id = $2::int)`,
      [passengers, request?.requested_category_id ?? null]
    ).then((r) => r.rows),

    query(
      `SELECT d.*, e.first_name, e.last_name
         FROM drivers d
         LEFT JOIN employees e ON e.employee_id = d.employee_id
        WHERE d.deleted_at IS NULL
          AND d.driver_status = 'Available'`
    ).then((r) => r.rows),
  ]);

  return { vehicles, drivers };
}

export async function GET(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher", "management"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    const { vehicles, drivers } = await fetchCandidates(request);
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers });

    return ok(recommendation);
  } catch (e) { return handleError(e); }
}

// POST — recompute and CACHE the recommendation onto the request row.
export async function POST(req, { params }) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager", "dispatcher"]);
    const { id } = await params;

    const request = await loadRequest(id);
    if (!request) return err("Transportation request not found", 404);

    const { vehicles, drivers } = await fetchCandidates(request);
    const recommendation = buildDispatchRecommendation({ request, vehicles, drivers });

    // Cache both halves plus the trip estimate so the queue and dispatch board
    // can show distance/duration without recomputing per render.
    const { rows } = await query(
      `UPDATE transportation_requests
          SET ai_vehicle_recommendation = $1,
              ai_driver_recommendation = $2,
              estimated_distance = COALESCE(estimated_distance, $3),
              estimated_duration = COALESCE(estimated_duration, $4)
        WHERE request_id = $5
      RETURNING *`,
      [
        JSON.stringify(recommendation.vehicle),
        JSON.stringify(recommendation.driver),
        recommendation.trip.estimated_distance_km,
        recommendation.trip.estimated_travel_minutes,
        id,
      ]
    );

    return ok({ ...recommendation, request: rows[0] ?? null });
  } catch (e) { return handleError(e); }
}
