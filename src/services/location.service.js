import { apiFetch } from "@/lib/api/client";

export async function getLocations() {
  return apiFetch("/api/locations");
}

/**
 * One location, including the structured address behind it.
 *
 * Fetched when the picker OPENS rather than taken from the list: only the row
 * being edited needs its PSGC chain re-resolved, and doing that for every row on
 * every list load is work for a form that is usually closed.
 */
export async function getLocation(id) {
  return apiFetch(`/api/locations/${id}`);
}

export async function createLocation(location) {
  return apiFetch("/api/locations", { method: "POST", body: location });
}

export async function updateLocation(id, location) {
  return apiFetch(`/api/locations/${id}`, { method: "PUT", body: location });
}
