import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getTrips(filters = {}) {
  return apiFetch(`/api/trips${buildQuery(filters)}`);
}

export async function getActiveTrips() {
  return apiFetch("/api/trips/active");
}

export async function getTrip(id) {
  return apiFetch(`/api/trips/${id}`);
}

export async function createTrip(trip) {
  return apiFetch("/api/trips", { method: "POST", body: trip });
}

export async function updateTrip(id, trip) {
  return apiFetch(`/api/trips/${id}`, { method: "PUT", body: trip });
}

export async function updateTripStatus(id, status) {
  return apiFetch(`/api/trips/${id}/status`, { method: "PUT", body: { status } });
}

export async function startTrip(id, startData) {
  return apiFetch(`/api/trips/${id}/start`, { method: "PUT", body: startData });
}

export async function completeTrip(id, endData) {
  return apiFetch(`/api/trips/${id}/complete`, { method: "PUT", body: endData });
}

export async function getTripLocations(tripId) {
  return apiFetch(`/api/trips/${tripId}/locations`);
}

export async function getLatestLocations() {
  return apiFetch("/api/trips/latest-locations");
}
