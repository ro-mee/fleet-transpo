import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getDrivers(filters = {}) {
  return apiFetch(`/api/drivers${buildQuery(filters)}`);
}

export async function getDriver(id) {
  return apiFetch(`/api/drivers/${id}`);
}

export async function createDriver(driver) {
  return apiFetch("/api/drivers", { method: "POST", body: driver });
}

export async function updateDriver(id, driver) {
  return apiFetch(`/api/drivers/${id}`, { method: "PUT", body: driver });
}

export async function getDriverStats() {
  return apiFetch("/api/drivers/stats");
}
