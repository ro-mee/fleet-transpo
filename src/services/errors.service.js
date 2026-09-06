import { apiFetch, buildQuery } from "@/lib/api/client";

export async function getAppErrors(filters = {}) {
  return apiFetch(`/api/errors${buildQuery(filters)}`);
}

export async function getAppError(errorId) {
  return apiFetch(`/api/errors?error_id=${encodeURIComponent(errorId)}`);
}

export async function reportAppError({ source, route, message, stack }) {
  // Fire-and-forget by contract: the reporter is already failing — a
  // rejected promise here must never cause a second crash or retry loop.
  try {
    return await apiFetch("/api/errors", {
      method: "POST",
      body: { source, route, message, stack },
    });
  } catch {
    return { received: false };
  }
}
