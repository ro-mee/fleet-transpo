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

export async function getTripLocations(tripId) {
  return apiFetch(`/api/trips/${tripId}/locations`);
}

export async function getLatestLocations() {
  return apiFetch("/api/trips/latest-locations");
}
