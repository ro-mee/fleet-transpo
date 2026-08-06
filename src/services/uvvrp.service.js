import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getUvvrpBoard(filters = {}) {
  return apiFetch(`/api/uvvrp${buildQuery(filters)}`);
}

export async function getUvvrpExemptions() {
  return apiFetch("/api/uvvrp/exemptions");
}

export async function createUvvrpExemption(payload) {
  return apiFetch("/api/uvvrp/exemptions", { method: "POST", body: payload });
}

export async function setUvvrpExemptionActive(id, payload) {
  return apiFetch(`/api/uvvrp/exemptions/${id}`, { method: "PUT", body: payload });
}

export async function getUvvrpViolations(filters = {}) {
  return apiFetch(`/api/uvvrp/violations${buildQuery(filters)}`);
}

export async function decideUvvrpViolation(id, payload) {
  return apiFetch(`/api/uvvrp/violations/${id}/decide`, { method: "POST", body: payload });
}
