import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "@cargo_drafts:";
export const MAX_CARGO_DRAFTS = 100;
const ownerMutations = new Map();

export class CargoDraftError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CargoDraftError";
    this.code = code;
  }
}

function ownerKey(actorId) {
  return actorId == null || String(actorId).trim() === "" ? null : `${PREFIX}${String(actorId)}`;
}

function makeSubmissionId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  });
}

async function readQueue(actorId) {
  const key = ownerKey(actorId);
  if (!key) throw new CargoDraftError("An authenticated employee account is required.", "CARGO_ACTOR_REQUIRED");
  try {
    const raw = await AsyncStorage.getItem(key);
    const rows = raw ? JSON.parse(raw) : [];
    return Array.isArray(rows) ? rows.filter((row) => row?.actorId === String(actorId)) : [];
  } catch {
    throw new CargoDraftError("Saved cargo evidence could not be read.", "CARGO_STORAGE_ERROR");
  }
}

async function writeQueue(actorId, rows) {
  const key = ownerKey(actorId);
  if (!key) throw new CargoDraftError("An authenticated employee account is required.", "CARGO_ACTOR_REQUIRED");
  await AsyncStorage.setItem(key, JSON.stringify(rows));
}

function mutateOwnerQueue(actorId, mutation) {
  const key = ownerKey(actorId);
  if (!key) return Promise.reject(new CargoDraftError("An authenticated employee account is required.", "CARGO_ACTOR_REQUIRED"));
  const previous = ownerMutations.get(key) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    const rows = await readQueue(actorId);
    const result = await mutation(rows);
    return result;
  });
  ownerMutations.set(key, next);
  return next.finally(() => { if (ownerMutations.get(key) === next) ownerMutations.delete(key); });
}

export async function saveCargoDraft({ actorId, tripId, manifestRef, draft }) {
  if (actorId == null || !manifestRef?.hash || tripId == null || !draft || typeof draft !== "object") {
    throw new CargoDraftError("Cargo draft is missing its owner, trip, manifest or receipt.", "CARGO_DRAFT_INVALID");
  }
  return mutateOwnerQueue(actorId, async (rows) => {
  const pending = rows.filter((row) => row.syncState !== "FLEET_SAVED").length;
  if (pending >= MAX_CARGO_DRAFTS) throw new CargoDraftError("Cargo evidence is full. Sync or review saved cargo before adding more.", "CARGO_QUEUE_FULL");
  const evidence = [];
  const normalizeEvidence = (file, lineId = null) => ({
    ...file,
    lineId,
    uploadSubmissionId: file.uploadSubmissionId || makeSubmissionId(),
    evidenceId: file.evidenceId ?? null,
    uploadState: file.evidenceId ? "UPLOADED" : "STAGED",
  });
  const lines = (draft.lines || []).map((line) => {
    const staged = Array.isArray(line.evidence) ? line.evidence : [];
    for (const file of staged) evidence.push(normalizeEvidence(file, line.line_id));
    const { evidence: _localEvidence, ...receiptLine } = line;
    return receiptLine;
  });
  for (const file of draft.evidence || []) evidence.push(normalizeEvidence(file));

  const row = {
    actorId: String(actorId),
    tripId: String(tripId),
    manifestRef: { ...manifestRef },
    manifestHash: String(manifestRef.hash),
    submissionId: draft.submission_id || makeSubmissionId(),
    draft: { ...draft, submission_id: undefined, lines },
    evidence,
    syncState: "DEVICE_SAVED",
    fleetSaved: false,
    partnerReceived: false,
    createdAt: new Date().toISOString(),
    lastErrorCode: null,
  };
  rows.push(row);
  await writeQueue(actorId, rows);
  return row;
  });
}

export async function listCargoDrafts(actorId) {
  return readQueue(actorId);
}

export async function updateCargoDraft(actorId, submissionId, update, isCurrent = () => true) {
  return mutateOwnerQueue(actorId, async (rows) => {
  if (!isCurrent()) return null;
  const index = rows.findIndex((row) => row.submissionId === submissionId);
  if (index < 0) return null;
  const patch = typeof update === "function" ? update(rows[index]) : update;
  rows[index] = { ...rows[index], ...patch };
  if (!isCurrent()) return null;
  await writeQueue(actorId, rows);
  return rows[index];
  });
}

export async function markCargoSubmitted(actorId, submissionId, result = {}, isCurrent = () => true) {
  return updateCargoDraft(actorId, submissionId, (existing) => {
    const receipt = existing.draft?.stage === "DELIVERY" ? result.delivery_receipt : result.pickup_receipt;
    return {
      syncState: "FLEET_SAVED",
      fleetSaved: true,
      partnerReceived: result.feedback?.state === "ACKNOWLEDGED",
      receiptId: receipt?.receipt_id ?? null,
      lastErrorCode: null,
    };
  }, isCurrent);
}
