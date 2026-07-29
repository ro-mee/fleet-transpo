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
