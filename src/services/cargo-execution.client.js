import { apiFetch, buildQuery } from "@/lib/api/client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function tripPath(tripId, suffix = "") {
  const id = Number(tripId);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("A valid trip is required.");
  return `/api/trips/${id}/cargo${suffix}`;
}

function responseData(response) {
  return response?.data ?? response;
}

export async function getCargoExecution(tripId, { historyLimit = 20, historyOffset = 0 } = {}) {
  return responseData(await apiFetch(`${tripPath(tripId)}${buildQuery({ history_limit: historyLimit, history_offset: historyOffset })}`));
}

export async function getCargoHandovers(tripId, { signal } = {}) {
  const data = responseData(await apiFetch(`${tripPath(tripId)}${buildQuery({ include_handovers: 1 })}`, { signal, cache: "no-store" }));
  if (Number(data?.trip_id) !== Number(tripId) || !data?.handovers ||
    !("pickup" in data.handovers) || !("delivery" in data.handovers)) {
    throw new Error("The private cargo signatures are unavailable.");
  }
  return data.handovers;
}

export async function getCargoEvidence(tripId, evidenceId) {
  if (!UUID.test(evidenceId || "")) throw new Error("A valid cargo photo reference is required.");
  const data = responseData(await apiFetch(`${tripPath(tripId)}${buildQuery({ evidence_id: evidenceId })}`));
  const evidence = data?.evidence?.find((item) => item.evidence_id === evidenceId);
  if (!evidence?.url) throw new Error("The private cargo photo is unavailable.");
  return evidence;
}

export async function clearCargoDeparture(tripId, payload) {
  return responseData(await apiFetch(tripPath(tripId, "/clearance"), { method: "POST", body: payload }));
}

export async function recordManualCargoDecision(tripId, payload) {
  return responseData(await apiFetch(tripPath(tripId, "/manual-decision"), { method: "POST", body: payload }));
}

export async function retryCargoFeedback({ tripId, sourceSystem, organizationId, eventId }) {
  const id = Number(tripId);
  if (!Number.isSafeInteger(id) || id < 1 || !["PMS", "POS", "SCM"].includes(sourceSystem) ||
    typeof organizationId !== "string" || !organizationId.trim() || !UUID.test(eventId || "")) {
    throw new Error("Cargo feedback retry details are incomplete.");
  }
  return responseData(await apiFetch("/api/integration/cargo/feedback", {
    method: "POST",
    body: { trip_id: id, source_system: sourceSystem, organization_id: organizationId, event_id: eventId },
  }));
}

export function cargoSourceHref(kind, localId) {
  if (kind === "REQUEST" && /^(?:[1-9]\d*)$/.test(String(localId || ""))) {
    const id = Number(localId);
    return Number.isSafeInteger(id) ? `/reservations/${id}` : null;
  }
  if (kind === "SUPPLY" && UUID.test(localId || "")) {
    return `/supply-deliveries?shipmentId=${encodeURIComponent(localId)}`;
  }
  return null;
}

export function resolveCargoSourceHref(manifest, sourceLink, linkedRequestId) {
  const kind = manifest?.manifest_ref?.kind;
  if (kind === "REQUEST") {
    const localId = sourceLink?.kind === "REQUEST" ? sourceLink.local_id : linkedRequestId;
    return cargoSourceHref(kind, localId);
  }
  if (kind === "SUPPLY" && sourceLink?.kind === "SUPPLY") {
    return cargoSourceHref(kind, sourceLink.local_id);
  }
  return null;
}
