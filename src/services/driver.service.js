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

// Runs OCR + the license regex parsers on a driver's own scan. Returns
// { ok, extracted_data, ... }; "unclear" scans are never persisted client-side.
export async function scanLicenseDocument(payload) {
  return apiFetch("/api/driver/license-scan", { method: "POST", body: payload });
}

export async function getMyTrips(filters = {}) {
  return apiFetch(`/api/driver/trips${buildQuery(filters)}`);
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

// Weekly work schedule + leave (migration 049).
export async function getDriverWorkSchedule(driverId) {
  return apiFetch(`/api/driver-work-schedules?driver_id=${driverId}`);
}

export async function saveDriverWorkSchedule(driverId, days) {
  return apiFetch("/api/driver-work-schedules", { method: "PUT", body: { driver_id: driverId, days } });
}

export async function getMyWorkSchedule() {
  return apiFetch("/api/driver-work-schedules");
}

export async function getMyLeaveRequests() {
  return apiFetch("/api/driver/leave");
}

export async function requestDriverLeave(data) {
  return apiFetch("/api/driver/leave", { method: "POST", body: data });
}

export async function withdrawDriverLeave(leaveRequestId) {
  return apiFetch(`/api/driver/leave?leave_request_id=${leaveRequestId}`, { method: "DELETE" });
}

export async function getDriverLeaveRequests(driverId) {
  return apiFetch(driverId ? `/api/driver-leave-requests?driver_id=${driverId}` : "/api/driver-leave-requests");
}

export async function reviewDriverLeave(leaveRequestId, status, notes) {
  return apiFetch(`/api/driver-leave-requests/${leaveRequestId}`, {
    method: "PATCH",
    body: { status, notes },
  });
}

export async function getDriverLeaveBalances(driverId) {
  return apiFetch(driverId ? `/api/driver-leave-balances?driver_id=${driverId}` : "/api/driver-leave-balances");
}

export async function getMyLeaveBalances() {
  return apiFetch("/api/driver/balances");
}

export async function reportIncident(incident) {
  return apiFetch("/api/driver/incidents", { method: "POST", body: incident });
}

export async function getAllIncidents(filters = {}) {
  return apiFetch(`/api/incidents${buildQuery(filters)}`);
}

export async function getIncidentSummary(filters = {}) {
  return apiFetch(`/api/incidents${buildQuery({ ...filters, summary: true })}`);
}

export async function updateIncident(id, payload) {
  return apiFetch(`/api/incidents/${id}`, { method: "PATCH", body: payload });
}
