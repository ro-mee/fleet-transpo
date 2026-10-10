import { listCargoDrafts, updateCargoDraft, markCargoSubmitted } from "./cargo-drafts";

let sessionActorId = null;
let sessionGeneration = 0;
let sessionController = new AbortController();
const actorDrains = new Map();
const drainControllers = new Map();

export function setCargoSessionActor(actorId) {
  const next = actorId == null || String(actorId) === "" ? null : String(actorId);
  if (next !== sessionActorId) {
    sessionController.abort();
    sessionController = new AbortController();
    sessionActorId = next;
    sessionGeneration += 1;
    for (const controller of drainControllers.values()) controller.abort();
    drainControllers.clear();
  }
}

export function isCurrentCargoActor(actorId) {
  return actorId != null && sessionActorId === String(actorId);
}

export function getCargoActorSignal(actorId) {
  return isCurrentCargoActor(actorId) ? sessionController.signal : null;
}

function ensureCurrent(actorId, generation) {
  if (!isCurrentCargoActor(actorId) || sessionGeneration !== generation) {
    const error = new Error("Cargo sync was cancelled because the signed-in account changed.");
    error.code = "CARGO_SYNC_CANCELLED";
    throw error;
  }
}

function statusOf(error) {
  return Number(error?.status ?? error?.response?.status ?? 0);
}

function evidenceForm(file, submissionId) {
  const form = new FormData();
  form.append("submission_id", submissionId);
  form.append("file", {
    uri: file.uri,
    name: file.name || "cargo-evidence.jpg",
    type: file.type || "image/jpeg",
  });
  return form;
}

async function syncOne(row, { actorId, generation, api, files, signal }) {
  ensureCurrent(actorId, generation);
  try {
    if (typeof api.getExecution === "function") {
      const current = await api.getExecution(row.tripId, actorId, signal);
      ensureCurrent(actorId, generation);
      const view = current?.data ?? current;
      if (!view?.manifest?.manifest_ref?.hash || view.manifest.manifest_ref.hash !== row.manifestHash) {
        await updateCargoDraft(actorId, row.submissionId, { syncState: "STALE_REVIEW", lastErrorCode: "CARGO_MANIFEST_STALE" });
        ensureCurrent(actorId, generation);
        return;
      }
    }

    const uploaded = [];
    for (let index = 0; index < row.evidence.length; index += 1) {
      const evidence = row.evidence[index];
      ensureCurrent(actorId, generation);
      if (evidence.evidenceId) {
        uploaded.push(evidence);
        continue;
      }
      if (!evidence.uri) {
        await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: "CARGO_FILE_REFERENCE_MISSING" });
        ensureCurrent(actorId, generation);
        return;
      }
      if (typeof files?.getInfo === "function") {
        const info = await files.getInfo(evidence.uri);
        ensureCurrent(actorId, generation);
        if (info?.exists === false) {
          await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: "CARGO_FILE_MISSING" });
          ensureCurrent(actorId, generation);
          return;
        }
      }
      ensureCurrent(actorId, generation);
      const response = await api.uploadEvidence(row.tripId, evidenceForm(evidence, evidence.uploadSubmissionId), actorId, signal);
      ensureCurrent(actorId, generation);
      const view = response?.data ?? response;
      const evidenceId = view?.evidence_upload?.evidence_id;
      if (!evidenceId) throw Object.assign(new Error("Cargo upload response did not include an evidence ID."), { code: "CARGO_UPLOAD_RESPONSE_INVALID" });
      const updatedEvidence = { ...evidence, evidenceId, uploadState: "UPLOADED" };
      uploaded.push(updatedEvidence);
      const nextEvidence = row.evidence.map((item, itemIndex) => itemIndex === index ? updatedEvidence : item);
      await updateCargoDraft(actorId, row.submissionId, { evidence: nextEvidence, syncState: "DEVICE_SAVED" });
      ensureCurrent(actorId, generation);
      row.evidence[index] = updatedEvidence;
    }

    ensureCurrent(actorId, generation);
    const lines = (row.draft.lines || []).map((line) => {
      const lineIds = uploaded.filter((item) => item.lineId === line.line_id).map((item) => item.evidenceId);
      return { ...line, evidence_ids: [...new Set([...(line.evidence_ids || []), ...lineIds])] };
    });
    const receipt = { ...row.draft, submission_id: row.submissionId, manifest_ref: row.manifestRef, lines };
    const result = await api.submitReceipt(row.tripId, receipt, actorId, signal);
    ensureCurrent(actorId, generation);
    await markCargoSubmitted(actorId, row.submissionId, result?.data ?? result ?? {});
    ensureCurrent(actorId, generation);
  } catch (error) {
    if (error?.code === "CARGO_SYNC_CANCELLED") return;
    const status = statusOf(error);
    if (status === 409) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "STALE_REVIEW", lastErrorCode: error?.code || "CARGO_CONFLICT" });
      ensureCurrent(actorId, generation);
    } else if (status === 401) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "REAUTHENTICATION_REQUIRED", lastErrorCode: "CARGO_REAUTH_REQUIRED" });
      ensureCurrent(actorId, generation);
    } else if (status === 403 || status === 404) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: error?.code || `HTTP_${status}` });
      ensureCurrent(actorId, generation);
    }
    // Network, 429, 5xx, disabled 503, and unknown failures retain DEVICE_SAVED.
  }
}

export async function syncCargoDrafts({ actorId, api, files = {} }) {
  if (!isCurrentCargoActor(actorId)) return { synced: 0, cancelled: true };
  const key = String(actorId);
  if (actorDrains.has(key)) return actorDrains.get(key);
  const generation = sessionGeneration;
  const controller = new AbortController();
  const drain = (async () => {
    let synced = 0;
    try {
      const rows = await listCargoDrafts(actorId);
      ensureCurrent(actorId, generation);
      for (const row of rows) {
        if (["FLEET_SAVED", "STALE_REVIEW", "TERMINAL_REVIEW"].includes(row.syncState)) continue;
        ensureCurrent(actorId, generation);
        await syncOne(row, { actorId, generation, api, files, signal: controller.signal });
        ensureCurrent(actorId, generation);
        const latest = (await listCargoDrafts(actorId)).find((item) => item.submissionId === row.submissionId);
        if (latest?.fleetSaved) synced += 1;
      }
      return { synced, cancelled: false };
    } catch (error) {
      if (error?.code === "CARGO_SYNC_CANCELLED") return { synced, cancelled: true };
      throw error;
    } finally {
      if (actorDrains.get(key) === drain) actorDrains.delete(key);
      if (drainControllers.get(key) === controller) drainControllers.delete(key);
    }
  })();
  actorDrains.set(key, drain);
  drainControllers.set(key, controller);
  return drain;
}

export async function getCargoSyncState(actorId, tripId) {
  const rows = await listCargoDrafts(actorId);
  const matches = rows.filter((row) => String(row.tripId) === String(tripId));
  const last = matches[matches.length - 1] ?? null;
  return {
    drafts: matches,
    deviceSaved: matches.length > 0,
    fleetSaved: matches.some((row) => row.fleetSaved),
    partnerReceived: matches.some((row) => row.partnerReceived),
    state: last?.syncState ?? "NONE",
    lastErrorCode: last?.lastErrorCode ?? null,
  };
}
