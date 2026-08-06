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

export async function deleteDriver(id) {
  return apiFetch(`/api/drivers/${id}`, { method: "DELETE" });
}

export async function getDriverStats() {
  return apiFetch("/api/drivers/stats");
}

// Finalizes a driver-role employee that has no drivers row yet.
export async function linkDriverAccount(employeeId) {
  return apiFetch("/api/drivers/link", { method: "POST", body: { employee_id: employeeId } });
}

// Enables / resets a driver's login (sets role + optional password).
export async function syncDriverAccount(id, data) {
  return apiFetch(`/api/drivers/${id}/account`, { method: "PUT", body: data });
}

// Driver self-service profile.
export async function getMyDriverProfile() {
  return apiFetch("/api/driver/me");
}

export async function updateMyDriverProfile(data) {
  return apiFetch("/api/driver/me", { method: "PATCH", body: data });
}

export async function acceptDriverConsent({ policyVersion, via }) {
  return apiFetch("/api/driver/me/consent", {
    method: "POST",
    body: { policy_version: policyVersion, accepted: true, via },
  });
}

export async function getMyVehicleInspection() {
  return apiFetch("/api/driver/vehicle-inspection");
}

export async function getMyIncidents() {
  return apiFetch("/api/driver/incidents");
}

export async function reportIncident(incident) {
  return apiFetch("/api/driver/incidents", { method: "POST", body: incident });
}

export async function getAllIncidents(filters = {}) {
  return apiFetch(`/api/incidents${buildQuery(filters)}`);
}

