import { apiFetch } from "@/lib/api/client";

export async function getLocations() {
  return apiFetch("/api/locations");
}

export async function createLocation(location) {
  return apiFetch("/api/locations", { method: "POST", body: location });
}

export async function updateLocation(id, location) {
  return apiFetch(`/api/locations/${id}`, { method: "PUT", body: location });
}
