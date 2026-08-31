import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getRoutes(filters = {}) {
  return apiFetch(`/api/routes${buildQuery(filters)}`);
}

export async function getRoute(id) {
  return apiFetch(`/api/routes/${id}`);
}

export async function createRoute(route) {
  return apiFetch("/api/routes", { method: "POST", body: route });
}

export async function updateRoute(id, route) {
  return apiFetch(`/api/routes/${id}`, { method: "PUT", body: route });
}

export async function deleteRoute(id) {
  return apiFetch(`/api/routes/${id}`, { method: "DELETE" });
}

export async function recalculateRoute(id, route) {
  const origin = route?.origin_location;
  const destination = route?.destination_location;
  if (!origin || !destination) throw new Error("Route endpoints are not configured.");
  const originValue = `${origin.longitude},${origin.latitude}`;
  const destinationValue = `${destination.longitude},${destination.latitude}`;
  const result = await apiFetch(
    `/api/tomtom/route?origin=${encodeURIComponent(originValue)}&destination=${encodeURIComponent(destinationValue)}`
  );
  if (result?.distanceKm == null || result?.travelTimeMin == null) {
    throw new Error("TomTom did not return a usable route estimate.");
  }
  return updateRoute(id, {
    estimated_distance: result.distanceKm,
    estimated_duration: result.travelTimeMin,
    estimate_source: "TomTom",
  });
}
