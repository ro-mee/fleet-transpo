import { apiFetch } from "./api";

export class CargoApiError extends Error {
  constructor(message, status = 0, code = null) {
    super(message);
    this.name = "CargoApiError";
    this.status = status;
    this.code = code;
    this.kind = status === 401 ? "reauthentication" : status === 403 || status === 404 ? "terminal_review" : status === 409 ? "stale_manifest" : status === 0 || status >= 500 ? "retryable" : "request_error";
  }
}

function actorOptions(actorId, extra = {}, signal = undefined) {
  return { ...extra, cargoActorId: actorId, queueOnFailure: false, signal };
}

async function request(path, options) {
  try {
    return await apiFetch(path, options);
  } catch (error) {
    throw new CargoApiError(error?.message || "Cargo request failed.", error?.status ?? 0, error?.code ?? null);
  }
}

export const cargoApi = {
  async getHandovers(tripId, actorId, signal) {
    const response = await request(`/api/trips/${encodeURIComponent(tripId)}/cargo?include_handovers=1`, actorOptions(actorId, { method: "GET", cache: "no-store" }, signal));
    const view = response?.data ?? response;
    if (String(view?.trip_id) !== String(tripId) || !view?.handovers ||
      !Object.hasOwn(view.handovers, "pickup") || !Object.hasOwn(view.handovers, "delivery")) {
      throw new CargoApiError("Saved signatures could not be verified. Refresh this trip and try again.");
    }
    return view;
  },
  getExecution(tripId, actorId, signal) {
    return request(`/api/trips/${encodeURIComponent(tripId)}/cargo`, actorOptions(actorId, { method: "GET" }, signal));
  },
  uploadEvidence(tripId, formData, actorId, signal) {
    return request(`/api/trips/${encodeURIComponent(tripId)}/cargo/evidence`, actorOptions(actorId, { method: "POST", body: formData }, signal));
  },
  submitReceipt(tripId, receipt, actorId, signal) {
    return request(`/api/trips/${encodeURIComponent(tripId)}/cargo/receipts`, actorOptions(actorId, { method: "POST", body: JSON.stringify(receipt) }, signal));
  },
};
