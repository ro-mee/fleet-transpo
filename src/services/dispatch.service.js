import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getDispatches(filters = {}) {
  return apiFetch(`/api/dispatch${buildQuery(filters)}`);
}

export async function getDispatchesByStatus() {
  return apiFetch("/api/dispatch/by-status");
}

/**
 * Everything the Phase 16 calendar draws for one visible window: dispatches plus
 * the maintenance, leave, and downtime that explain why a lane is blocked, plus
 * the vehicle and driver rosters that form the lanes.
 *
 * @param {{from: string, to: string}} range ISO bounds of the visible window
 */
export async function getDispatchCalendar(range) {
  return apiFetch(`/api/dispatch/calendar${buildQuery(range)}`);
}

export async function getDispatch(id) {
  return apiFetch(`/api/dispatch/${id}`);
}

export async function createDispatch(dispatch) {
  return apiFetch("/api/dispatch", { method: "POST", body: dispatch });
}

export async function updateDispatch(id, dispatch) {
  return apiFetch(`/api/dispatch/${id}`, { method: "PUT", body: dispatch });
}

export async function updateDispatchStatus(id, status, reason) {
  return apiFetch(`/api/dispatch/${id}/status`, { method: "PUT", body: { status, reason } });
}
