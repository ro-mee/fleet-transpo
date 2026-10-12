import { listCargoDrafts, updateCargoDraft, markCargoSubmitted } from "./cargo-drafts";

let sessionActorId = null;
let sessionGeneration = 0;
let sessionController = new AbortController();
let sessionPhase = "anonymous";
const actorDrains = new Map();
const drainControllers = new Map();

export function setCargoSessionActor(actorId) {
  const next = actorId == null || String(actorId) === "" ? null : String(actorId);
  const nextPhase = next == null ? "anonymous" : "authenticated";
  if (next !== sessionActorId || nextPhase !== sessionPhase) {
    sessionController.abort();
    sessionController = new AbortController();
    sessionActorId = next;
    sessionPhase = nextPhase;
    sessionGeneration += 1;
    for (const controller of drainControllers.values()) controller.abort();
    drainControllers.clear();
  }
}

export function beginCargoSessionTransition() {
  sessionController.abort();
  sessionController = new AbortController();
  sessionActorId = null;
  sessionPhase = "transition";
  sessionGeneration += 1;
  for (const controller of drainControllers.values()) controller.abort();
  drainControllers.clear();
}

export function isCurrentCargoActor(actorId) {
  return actorId != null && sessionActorId === String(actorId);
}

export function getCargoActorSignal(actorId) {
  return isCurrentCargoActor(actorId) ? sessionController.signal : null;
}

export function captureCargoSession(actorId) {
  if (!isCurrentCargoActor(actorId)) return null;
  return { actorId: String(actorId), generation: sessionGeneration, signal: sessionController.signal, phase: sessionPhase };
}

export function captureCurrentCargoSession() {
  return { actorId: sessionActorId, generation: sessionGeneration, signal: sessionController.signal, phase: sessionPhase };
}

export function isCurrentCargoSession(snapshot) {
  return Boolean(snapshot && sessionActorId === snapshot.actorId && sessionPhase === snapshot.phase && sessionGeneration === snapshot.generation && sessionController.signal === snapshot.signal && !snapshot.signal.aborted);
}

export function canRefreshCargoSession(snapshot) {
  return Boolean(snapshot && snapshot.phase !== "transition" && isCurrentCargoSession(snapshot));
}

function ensureCurrent(actorId, generation, isAuthorized, tripId) {
  if (!isCurrentCargoActor(actorId) || sessionGeneration !== generation) {
    const error = new Error("Cargo sync was cancelled because the signed-in account changed.");
    error.code = "CARGO_SYNC_CANCELLED";
    throw error;
  }
  if (isAuthorized && !isAuthorized(tripId)) {
    const error = new Error("Cargo assignment authority changed. Refresh your profile and current trip online before continuing.");
    error.code = "CARGO_AUTHORITY_CHANGED";
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

async function syncOne(row, { actorId, generation, api, files, signal, isAuthorized }) {
  const isCurrent = () => isCurrentCargoActor(actorId) && sessionGeneration === generation && (!isAuthorized || isAuthorized(row.tripId));
  ensureCurrent(actorId, generation, isAuthorized, row.tripId);
  try {
    if (typeof api.getExecution === "function") {
      const current = await api.getExecution(row.tripId, actorId, signal);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
      const view = current?.data ?? current;
      if (!view?.manifest?.manifest_ref?.hash || view.manifest.manifest_ref.hash !== row.manifestHash) {
        await updateCargoDraft(actorId, row.submissionId, { syncState: "STALE_REVIEW", lastErrorCode: "CARGO_MANIFEST_STALE" }, isCurrent);
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        return;
      }
    }

    const uploaded = [];
    for (let index = 0; index < row.evidence.length; index += 1) {
      const evidence = row.evidence[index];
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
      if (evidence.evidenceId) {
        uploaded.push(evidence);
        continue;
      }
      if (!evidence.uri) {
        await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: "CARGO_FILE_REFERENCE_MISSING" }, isCurrent);
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        return;
      }
      if (typeof files?.getInfo === "function") {
        const info = await files.getInfo(evidence.uri);
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        if (info?.exists === false) {
          await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: "CARGO_FILE_MISSING" }, isCurrent);
          ensureCurrent(actorId, generation, isAuthorized, row.tripId);
          return;
        }
      }
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
      const response = await api.uploadEvidence(row.tripId, evidenceForm(evidence, evidence.uploadSubmissionId), actorId, signal);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
      const view = response?.data ?? response;
      const evidenceId = view?.evidence_upload?.evidence_id;
      if (!evidenceId) throw Object.assign(new Error("Cargo upload response did not include an evidence ID."), { code: "CARGO_UPLOAD_RESPONSE_INVALID" });
      const updatedEvidence = { ...evidence, evidenceId, uploadState: "UPLOADED" };
      uploaded.push(updatedEvidence);
      const nextEvidence = row.evidence.map((item, itemIndex) => itemIndex === index ? updatedEvidence : item);
      await updateCargoDraft(actorId, row.submissionId, { evidence: nextEvidence, syncState: "DEVICE_SAVED" }, isCurrent);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
      row.evidence[index] = updatedEvidence;
    }

    ensureCurrent(actorId, generation, isAuthorized, row.tripId);
    const lines = (row.draft.lines || []).map((line) => {
      const lineIds = uploaded.filter((item) => item.lineId === line.line_id).map((item) => item.evidenceId);
      return { ...line, evidence_ids: [...new Set([...(line.evidence_ids || []), ...lineIds])] };
    });
    const receipt = { ...row.draft, submission_id: row.submissionId, manifest_ref: row.manifestRef, lines };
    const result = await api.submitReceipt(row.tripId, receipt, actorId, signal);
    ensureCurrent(actorId, generation, isAuthorized, row.tripId);
    await markCargoSubmitted(actorId, row.submissionId, result?.data ?? result ?? {}, isCurrent);
    ensureCurrent(actorId, generation, isAuthorized, row.tripId);
  } catch (error) {
    if (["CARGO_SYNC_CANCELLED", "CARGO_AUTHORITY_CHANGED"].includes(error?.code)) return;
    const status = statusOf(error);
    if (status === 409) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "STALE_REVIEW", lastErrorCode: error?.code || "CARGO_CONFLICT" }, isCurrent);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
    } else if (status === 401) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "REAUTHENTICATION_REQUIRED", lastErrorCode: "CARGO_REAUTH_REQUIRED" }, isCurrent);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
    } else if (status === 403 || status === 404) {
      await updateCargoDraft(actorId, row.submissionId, { syncState: "TERMINAL_REVIEW", lastErrorCode: error?.code || `HTTP_${status}` }, isCurrent);
      ensureCurrent(actorId, generation, isAuthorized, row.tripId);
    }
    // Network, 429, 5xx, disabled 503, and unknown failures retain DEVICE_SAVED.
  }
}

export async function syncCargoDrafts({ actorId, api, files = {}, isAuthorized, submissionId }) {
  if (!isCurrentCargoActor(actorId)) return { synced: 0, cancelled: true };
  const key = String(actorId);
  const waitingSession = captureCargoSession(actorId);
  if (actorDrains.has(key)) {
    if (!isAuthorized) return actorDrains.get(key);
    await actorDrains.get(key);
    if (!isCurrentCargoSession(waitingSession)) return { synced: 0, cancelled: true };
    // Interactive work must revalidate after waiting for a background drain.
    return syncCargoDrafts({ actorId, api, files, isAuthorized, submissionId });
  }
  const generation = sessionGeneration;
  const controller = new AbortController();
  const drain = (async () => {
    let synced = 0;
    try {
      const rows = await listCargoDrafts(actorId);
      ensureCurrent(actorId, generation);
      for (const row of rows) {
        if (submissionId && row.submissionId !== submissionId) continue;
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        if (row.syncState === "FLEET_SAVED") {
          if (typeof api.getExecution === "function" && row.receiptId) {
            try {
              ensureCurrent(actorId, generation, isAuthorized, row.tripId);
              const current = await api.getExecution(row.tripId, actorId, controller.signal);
              ensureCurrent(actorId, generation, isAuthorized, row.tripId);
              const view = current?.data ?? current;
              const stageReceipt = row.draft?.stage === "DELIVERY" ? view?.delivery_receipt : view?.pickup_receipt;
              if (stageReceipt?.receipt_id === row.receiptId) {
                const acknowledged = view?.feedback?.state === "ACKNOWLEDGED";
                await updateCargoDraft(actorId, row.submissionId, {
                  partnerReceived: acknowledged,
                  feedbackState: view?.feedback?.state ?? null,
                }, () => isCurrentCargoActor(actorId) && sessionGeneration === generation && (!isAuthorized || isAuthorized(row.tripId)));
                ensureCurrent(actorId, generation, isAuthorized, row.tripId);
              }
            } catch (error) {
              if (["CARGO_SYNC_CANCELLED", "CARGO_AUTHORITY_CHANGED"].includes(error?.code)) throw error;
              // The Task 7 view may be unavailable; keep the last truthful local receipt state.
            }
          }
          continue;
        }
        if (["STALE_REVIEW", "TERMINAL_REVIEW"].includes(row.syncState)) continue;
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        await syncOne(row, { actorId, generation, api, files, signal: controller.signal, isAuthorized });
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        const latest = (await listCargoDrafts(actorId)).find((item) => item.submissionId === row.submissionId);
        ensureCurrent(actorId, generation, isAuthorized, row.tripId);
        if (latest?.fleetSaved) synced += 1;
      }
      return { synced, cancelled: false };
    } catch (error) {
      if (["CARGO_SYNC_CANCELLED", "CARGO_AUTHORITY_CHANGED"].includes(error?.code)) return { synced, cancelled: true };
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
    fleetSaved: Boolean(last?.fleetSaved),
    partnerReceived: Boolean(last?.partnerReceived),
    state: last?.syncState ?? "NONE",
    lastErrorCode: last?.lastErrorCode ?? null,
  };
}
