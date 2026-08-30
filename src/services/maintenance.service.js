import { apiFetch } from "@/lib/api/client";

export async function getMaintenanceRecords(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/api/vehicle-maintenance${query ? `?${query}` : ""}`);
}

export async function getMaintenanceRecord(id) {
  return apiFetch(`/api/vehicle-maintenance/${id}`);
}

export async function createMaintenanceRecord(data) {
  return apiFetch(`/api/vehicle-maintenance`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateMaintenanceRecord(id, data) {
  return apiFetch(`/api/vehicle-maintenance/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function getPredictiveMaintenance() {
  return apiFetch(`/api/ai/predictive-maintenance`);
}
