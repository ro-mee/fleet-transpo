import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getIntegrationLogs(filters = {}) {
  return apiFetch(`/api/integration/logs${buildQuery(filters)}`);
}

export async function logInboundEvent(args) {
  return apiFetch("/api/integration/inbound", { method: "POST", body: args });
}

export async function logOutboundEvent(args) {
  return apiFetch("/api/integration/outbound", { method: "POST", body: args });
}

export async function markIntegrationProcessed(logId) {
  return apiFetch(`/api/integration/logs/${logId}`, { method: "PUT", body: { status: "processed" } });
}

export async function markIntegrationFailed(logId, errorMessage) {
  return apiFetch(`/api/integration/logs/${logId}`, { method: "PUT", body: { status: "failed", error_message: errorMessage } });
}

