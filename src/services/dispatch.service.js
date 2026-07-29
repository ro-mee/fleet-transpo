import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getDispatches(filters = {}) {
  return apiFetch(`/api/dispatch${buildQuery(filters)}`);
}

export async function getDispatchesByStatus() {
  return apiFetch("/api/dispatch/by-status");
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

export async function updateDispatchStatus(id, status) {
  return apiFetch(`/api/dispatch/${id}/status`, { method: "PUT", body: { status } });
}
