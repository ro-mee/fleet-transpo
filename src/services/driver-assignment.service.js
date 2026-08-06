import { apiFetch, buildQuery } from "@/lib/api/client";

// Custodial driver ↔ vehicle pairings (migration 017) — who is normally
// responsible for which car. Separate from the per-trip assignment made at
// dispatch time, which lives in dispatch.service.js.

/**
 * Active pairings, or the full history when `history: 1` is passed.
 * @param {{driver_id?: number, vehicle_id?: number, history?: 0|1}} [filters]
 */
export async function getDriverAssignments(filters = {}) {
  return apiFetch(`/api/driver-assignments${buildQuery(filters)}`);
}

/**
 * Pair a driver with a vehicle.
 *
 * Answers 409 with `{ requires_force, current_assignment }` when the vehicle is
 * already held by a different driver — `apiFetch` preserves that body on
 * `error.data`, so the caller can show who would be displaced and resend with
 * `force: true`. Moving a driver off their own car needs no confirmation.
 */
export async function assignDriverVehicle({ driver_id, vehicle_id, notes, force }) {
  return apiFetch("/api/driver-assignments", {
    method: "POST",
    body: { driver_id, vehicle_id, notes, force },
  });
}

/**
 * Release a pairing. Closes the interval rather than deleting the row — the
 * history is the reason this is a table and not a column.
 */
export async function releaseDriverAssignment(assignmentId, release_reason) {
  return apiFetch(`/api/driver-assignments/${assignmentId}`, {
    method: "DELETE",
    body: { release_reason },
  });
}
