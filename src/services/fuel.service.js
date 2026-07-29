import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getFuelRecords(filters = {}) {
  return apiFetch(`/api/fuel${buildQuery(filters)}`);
}

export async function createFuelRecord(record) {
  return apiFetch("/api/fuel", { method: "POST", body: record });
}

export async function getFuelAnalytics() {
  return apiFetch("/api/fuel/analytics");
}
