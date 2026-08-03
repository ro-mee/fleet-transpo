import { apiFetch, buildQuery } from "@/lib/api/client";

// Fleet Reservation Queue — transportation requests received FROM the Booking
// subsystem. Fleet consumes these; it never creates them. Everything here talks
// to /api/integration/*, the boundary between Fleet and Booking.

export async function getTransportRequests(filters = {}) {
  return apiFetch(`/api/integration/transport-requests${buildQuery(filters)}`);
}

// One request with its joins, dispatches, and advisory conflicts — what the
// reservation detail page renders. Distinct from the list GET, which cannot
// afford the dispatch sub-select per row.
export async function getTransportRequest(id) {
  return apiFetch(`/api/integration/transport-requests/${id}`);
}

// Fleet review — claim a Pending request (Pending -> Under Review).
export async function startReview(id) {
  return apiFetch(`/api/integration/transport-requests/${id}/review`, { method: "PUT" });
}

export async function approveTransportRequest(id) {
  return apiFetch(`/api/integration/transport-requests/${id}/approve`, { method: "PUT" });
}

export async function rejectTransportRequest(id, reason = null) {
  return apiFetch(`/api/integration/transport-requests/${id}/reject`, {
    method: "PUT",
    body: { reason },
  });
}

// Commit resources to an approved request (Approved -> Scheduled -> Assigned).
// Either id may be omitted to assign one half at a time; the server keeps the
// value already on the request. Blocking conflicts return 409 unless `force` is
// set, which is recorded on the timeline as an override.
export async function assignResources(id, { vehicleId, driverId, force = false } = {}) {
  return apiFetch(`/api/integration/transport-requests/${id}/assign`, {
    method: "PUT",
    body: {
      ...(vehicleId != null ? { vehicle_id: vehicleId } : {}),
      ...(driverId != null ? { driver_id: driverId } : {}),
      ...(force ? { force: true } : {}),
    },
  });
}

export async function assignVehicle(id, vehicleId, { force = false } = {}) {
  return assignResources(id, { vehicleId, force });
}

export async function assignDriver(id, driverId, { force = false } = {}) {
  return assignResources(id, { driverId, force });
}

// Abort a request already past intake. Distinct from reject, which is the
// review decision at intake.
export async function cancelRequest(id, reason = null) {
  return apiFetch(`/api/integration/transport-requests/${id}/cancel`, {
    method: "PUT",
    body: { reason },
  });
}

// Move the pickup time. Does not change fleet_status — a reschedule is a
// property change, not a lifecycle step.
export async function rescheduleRequest(id, pickupDatetime, reason = null) {
  return apiFetch(`/api/integration/transport-requests/${id}/reschedule`, {
    method: "PUT",
    body: { pickup_datetime: pickupDatetime, reason },
  });
}

// Append-only event log for one request — what the timeline component renders.
export async function getRequestTimeline(id) {
  return apiFetch(`/api/integration/transport-requests/${id}/timeline`);
}

// AI advisor. GET is a pure preview and writes nothing; pass { persist: true }
// to cache the result onto the request so the queue can badge it without
// re-scoring. Neither variant assigns anything — a human always confirms.
//
// { narrate: true } additionally asks the LLM provider for a written rationale
// over the pick the rule engine already made. It is a separate, slower call on
// purpose — the scored result should never wait on prose. Returns the same
// payload either way, with `narration` null when the provider doesn't answer.
export async function getRecommendation(id, { persist = false, narrate = false } = {}) {
  const qs = narrate && !persist ? "?narrate=1" : "";
  return apiFetch(`/api/integration/transport-requests/${id}/recommendation${qs}`, {
    method: persist ? "POST" : "GET",
  });
}

// Pull canned/queued requests from the configured Booking gateway (mock in dev).
export async function pullTransportRequests() {
  return apiFetch("/api/integration/pull", { method: "POST" });
}

// Dev-only mock injector: push a hand-authored request through the same inbound
// boundary a real Booking webhook would use.
export async function injectTransportRequest(payload) {
  return apiFetch("/api/integration/transport-requests", { method: "POST", body: payload });
}
