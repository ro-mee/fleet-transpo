import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getFuelRecords(filters = {}) {
  return apiFetch(`/api/fuel${buildQuery(filters)}`);
}

export async function getFuelRecord(id) {
  return apiFetch(`/api/fuel/${id}`);
}

export async function createFuelRecord(record) {
  return apiFetch("/api/fuel", { method: "POST", body: record });
}

export async function updateFuelRecord(id, record) {
  return apiFetch(`/api/fuel/${id}`, { method: "PUT", body: record });
}

export async function updateFuelStatus(id, { status, rejection_reason }) {
  return apiFetch(`/api/fuel/${id}`, {
    method: "PUT",
    body: { status, rejection_reason },
  });
}

export async function deleteFuelRecord(id) {
  return apiFetch(`/api/fuel/${id}`, { method: "DELETE" });
}

export async function getFuelAnalytics() {
  return apiFetch("/api/fuel/analytics");
}

export async function getFuelRequests(filters = {}) {
  return apiFetch(`/api/fuel/requests${buildQuery(filters)}`);
}

export async function reviewFuelRequest(request) {
  return apiFetch("/api/fuel/requests", { method: "PUT", body: request });
}

export async function getFuelAllocations(filters = {}) {
  return apiFetch(`/api/fuel/allocations${buildQuery(filters)}`);
}

export async function saveFuelAllocation(allocation) {
  return apiFetch("/api/fuel/allocations", { method: "PUT", body: allocation });
}
