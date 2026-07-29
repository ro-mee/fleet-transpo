import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getVehicles(filters = {}) {
  return apiFetch(`/api/vehicles${buildQuery(filters)}`);
}

export async function getVehicle(id) {
  return apiFetch(`/api/vehicles/${id}`);
}

export async function createVehicle(vehicle) {
  return apiFetch("/api/vehicles", { method: "POST", body: vehicle });
}

export async function updateVehicle(id, vehicle) {
  return apiFetch(`/api/vehicles/${id}`, { method: "PUT", body: vehicle });
}

export async function deleteVehicle(id) {
  return apiFetch(`/api/vehicles/${id}`, { method: "DELETE" });
}

export async function getAvailableVehicles(filters = {}) {
  return apiFetch(`/api/vehicles/available${buildQuery(filters)}`);
}

export async function getVehicleCategories() {
  return apiFetch("/api/vehicle-categories");
}

export async function getBranches() {
  return apiFetch("/api/branches");
}

export async function createCategory(category) {
  return apiFetch("/api/vehicle-categories", { method: "POST", body: category });
}

export async function updateCategory(id, category) {
  return apiFetch(`/api/vehicle-categories/${id}`, { method: "PUT", body: category });
}

export async function deleteCategory(id) {
  return apiFetch(`/api/vehicle-categories/${id}`, { method: "DELETE" });
}

export async function getVehicleMaintenance(filters = {}) {
  return apiFetch(`/api/vehicle-maintenance${buildQuery(filters)}`);
}

export async function createVehicleMaintenance(record) {
  return apiFetch("/api/vehicle-maintenance", { method: "POST", body: record });
}

export async function updateVehicleMaintenance(id, record) {
  return apiFetch(`/api/vehicle-maintenance/${id}`, { method: "PUT", body: record });
}

export async function getVehicleDocuments(vehicleId) {
  return apiFetch(`/api/vehicles/${vehicleId}/documents`);
}

export async function createVehicleDocument(doc) {
  return apiFetch(`/api/vehicles/${doc.vehicle_id}/documents`, { method: "POST", body: doc });
}

export async function updateVehicleDocument(id, doc) {
  return apiFetch(`/api/vehicle-documents/${id}`, { method: "PUT", body: doc });
}

export async function deleteVehicleDocument(id) {
  return apiFetch(`/api/vehicle-documents/${id}`, { method: "DELETE" });
}

export async function archiveVehicleMaintenance(id) {
  return apiFetch(`/api/vehicle-maintenance/${id}`, { method: "PUT", body: { deleted_at: new Date().toISOString() } });
}
