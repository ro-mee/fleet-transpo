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

export async function getRouteEstimate(origin, destination) {
  if (!origin || !destination || origin.latitude == null || origin.longitude == null || destination.latitude == null || destination.longitude == null) {
    throw new Error("Both locations need coordinates for a TomTom estimate.");
  }
  const valid = (value, min, max) => Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  if (!valid(origin.latitude, -90, 90) || !valid(destination.latitude, -90, 90) || !valid(origin.longitude, -180, 180) || !valid(destination.longitude, -180, 180)) {
    throw new Error("The selected locations have invalid coordinates.");
  }
  const originValue = `${origin.longitude},${origin.latitude}`;
  const destinationValue = `${destination.longitude},${destination.latitude}`;
  const result = await apiFetch(
    `/api/tomtom/route?origin=${encodeURIComponent(originValue)}&destination=${encodeURIComponent(destinationValue)}`
  );
  if (result?.distanceKm == null || result?.travelTimeMin == null) {
    throw new Error("TomTom did not return a usable route estimate.");
  }
  return result;
}

export async function recalculateRoute(id, route) {
  const origin = route?.origin_location;
  const destination = route?.destination_location;
  const result = await getRouteEstimate(origin, destination);
  return updateRoute(id, {
    estimated_distance: result.distanceKm,
    estimated_duration: result.travelTimeMin,
    estimate_source: "TomTom",
  });
}
