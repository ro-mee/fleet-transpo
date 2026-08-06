import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getAuditLogs(filters = {}) {
  return apiFetch(`/api/audit${buildQuery(filters)}`);
}
