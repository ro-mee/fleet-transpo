import { apiFetch } from "@/lib/api/client";

export async function getOpenFuelDiagnostics(vehicleIds) {
  const params = new URLSearchParams({ vehicle_ids: vehicleIds.join(",") });
  const rows = await apiFetch(`/api/vehicle-maintenance/fuel-diagnostics?${params}`);
  return Array.isArray(rows) ? rows : [];
}

// Staff mechanic directory for the assign-mechanic select
// (GET /api/mechanics). Returns active mechanics only.
export async function getMechanics() {
  const rows = await apiFetch(`/api/mechanics`);
  return Array.isArray(rows) ? rows : [];
}

// P0 mechanic integration: normalize the assignment key before it leaves the
// client. The staff select holds "" (create default) or the "unassigned"
// sentinel for "no mechanic" — neither may reach the server as a value:
// POST treats "" as absent and PUT would write it as an explicit unassign.
// Numeric strings from <select> values become numbers; null is preserved so
// an edit can explicitly unassign; anything else malformed is dropped rather
// than sent (the server 400s unknown ids, but garbage should not travel).
export function withAssignment(data = {}) {
  const out = { ...data };
  const v = out.assigned_mechanic_id;
  if (v === "" || v === undefined || v === "unassigned") {
    delete out.assigned_mechanic_id;
  } else if (v !== null) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.assigned_mechanic_id = n;
    else delete out.assigned_mechanic_id;
  }
  return out;
}

export async function getMaintenanceRecords(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/api/vehicle-maintenance${query ? `?${query}` : ""}`);
}

export async function getMaintenanceRecord(id) {
  return apiFetch(`/api/vehicle-maintenance/${id}`);
}

export async function createMaintenanceRecord(data) {
  // apiFetch stringifies once: passing a pre-stringified body would
  // double-encode it, and the route would read a string instead of an object
  // (POST 400s on the required fields, PUT reports "no writable fields").
  return apiFetch(`/api/vehicle-maintenance`, {
    method: "POST",
    body: withAssignment(data),
  });
}

export async function updateMaintenanceRecord(id, data) {
  // See createMaintenanceRecord: no pre-stringify here either.
  return apiFetch(`/api/vehicle-maintenance/${id}`, {
    method: "PUT",
    body: withAssignment(data),
  });
}

export async function getVehicleHistory(vehicleId) {
  return apiFetch(`/api/mechanic/vehicle-history?vehicle_id=${vehicleId}`);
}

export async function getPredictiveMaintenance() {
  return apiFetch(`/api/ai/predictive-maintenance`);
}

export async function createReviewedPlanWorkOrder(vehicleId, service, data) {
  return createMaintenanceRecord({ ...data, vehicle_id: vehicleId, service_plan_id: service.plan_id,
    expected_version: service.version, maintenance_type: service.service_code === "routine" ? "Routine" : "Preventive" });
}
