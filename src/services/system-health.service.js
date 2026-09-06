import { apiFetch } from "@/lib/api/client";

export async function getSystemHealth() {
  return apiFetch("/api/system/health");
}

export async function retryPushDelivery() {
  return apiFetch("/api/system/health/push-retry", { method: "POST" });
}

export async function reviewPushFailures() {
  return apiFetch("/api/system/health/push-review", { method: "POST" });
}

export async function reviewAiFailures() {
  return apiFetch("/api/system/health/ai-review", { method: "POST" });
}

export async function retryIntegrationDelivery() {
  return apiFetch("/api/system/health/integration-retry", { method: "POST" });
}

export async function runSyncNow() {
  return apiFetch("/api/system/health/sync-now", { method: "POST" });
}
