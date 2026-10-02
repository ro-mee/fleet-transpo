import { apiFetch } from "@/lib/api/client";

export async function getHotelLocationSettings() {
  return apiFetch("/api/settings/hotel");
}

export async function updateHotelLocationSettings(payload) {
  return apiFetch("/api/settings/hotel", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function seedNaiaRoutes(terminals) {
  return apiFetch("/api/routes/seed-naia", {
    method: "POST",
    body: JSON.stringify(terminals ? { terminals } : {}),
  });
}

export async function getConnectors() {
  return apiFetch("/api/settings/connectors");
}

export async function getUvvrpPolicy() {
  return apiFetch("/api/settings/uvvrp");
}

export async function updateUvvrpPolicy(policy) {
  return apiFetch("/api/settings/uvvrp", {
    method: "PUT",
    body: policy,
  });
}

export async function getDispatchPolicy() {
  return apiFetch("/api/settings/dispatch");
}

export async function updateDispatchPolicy(policy) {
  return apiFetch("/api/settings/dispatch", {
    method: "PUT",
    body: policy,
  });
}

export async function getSecurityPolicy() {
  return apiFetch("/api/settings/security-policy");
}

export async function updateSecurityPolicy(policy) {
  return apiFetch("/api/settings/security-policy", {
    method: "PUT",
    body: policy,
  });
}

export async function getWorkShiftPolicy() {
  return apiFetch("/api/settings/work-shift");
}

export async function updateWorkShiftPolicy(policy) {
  return apiFetch("/api/settings/work-shift", {
    method: "PUT",
    body: policy,
  });
}

export async function applyWorkShiftPolicy(payload = {}) {
  return apiFetch("/api/settings/work-shift/apply", {
    method: "POST",
    body: payload,
  });
}

export async function getFuelPolicy() {
  return apiFetch("/api/settings/fuel");
}

export async function updateFuelPolicy(policy) {
  return apiFetch("/api/settings/fuel", {
    method: "PUT",
    body: policy,
  });
}
