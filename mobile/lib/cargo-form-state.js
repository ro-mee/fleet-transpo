import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveCargoDraft, listCargoDrafts } from "./cargo-drafts";
import { captureCargoSession, isCurrentCargoSession, syncCargoDrafts } from "./cargo-sync";
import { buildCargoReceipt } from "./cargo-view-model";
const writes = new Map();
const submissions = new Map();
function keyFor({ actorId, tripId, stage }) {
  if (actorId == null || tripId == null || !["PICKUP", "DELIVERY"].includes(stage)) throw new Error("Cargo form account, trip and stage are required.");
  return `@cargo_form:${actorId}:${tripId}:${stage}`;
}
function current(actorId) {
  const snapshot = captureCargoSession(actorId);
  if (!snapshot) throw new Error("The signed-in account changed. Reopen cargo verification.");
  return snapshot;
}
function check(snapshot) { if (!isCurrentCargoSession(snapshot)) throw new Error("The signed-in account changed. Reopen cargo verification."); }
export async function readCargoForm(input) {
  const snapshot = current(input.actorId);
  const key = keyFor(input);
  await (writes.get(key) || Promise.resolve()); check(snapshot);
  const value = await AsyncStorage.getItem(key); check(snapshot);
  return value ? JSON.parse(value) : null;
}
export function saveCargoForm(input) {
  const snapshot = current(input.actorId), key = keyFor(input);
  const write = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    check(snapshot); await AsyncStorage.setItem(key, JSON.stringify(input.form)); check(snapshot); return input.form;
  });
  writes.set(key, write);
  return write.finally(() => { if (writes.get(key) === write) writes.delete(key); });
}
export async function submitCargoObservation(input) {
  const key = keyFor(input);
  if (submissions.has(key)) return submissions.get(key);
  const snapshot = current(input.actorId);
  const work = (async () => {
    check(snapshot);
    if (input.execution?.capabilities?.observe !== true) throw new Error("Server observation permission is required.");
    const hash = input.execution?.manifest?.manifest_ref?.hash;
    if (input.form?.manifestHash !== hash) throw new Error("The manifest changed. Refresh and recount before submitting.");
    const rows = await listCargoDrafts(input.actorId); check(snapshot);
    const savedForm = await readCargoForm(input); check(snapshot);
    let row = rows.find(item => String(item.tripId) === String(input.tripId) && item.draft.stage === input.stage && item.manifestHash === hash && (item.submissionId === savedForm?.pendingSubmissionId || item.submissionId === input.form?.pendingSubmissionId));
    if (!row) row = rows.filter(item => String(item.tripId) === String(input.tripId) && item.draft.stage === input.stage && item.manifestHash === hash && item.syncState !== "FLEET_SAVED").at(-1);
    if (!row) {
      const draft = buildCargoReceipt(input.execution, { stage: input.stage, counts: input.form.counts, issues: input.form.issues, reportIssue: input.reportIssue === true });
      check(snapshot); row = await saveCargoDraft({ actorId: input.actorId, tripId: input.tripId, manifestRef: input.execution.manifest.manifest_ref, draft }); check(snapshot);
    }
    if (input.reportIssue && !row.draft.lines.some(line => ["SHORTAGE", "EXCESS", "DAMAGE"].includes(line.issue_code))) throw new Error("Report an issue only for a shortage, excess or damage. Retry this clean receipt through Confirm pickup.");
    await saveCargoForm({ ...input, form: { ...input.form, pendingSubmissionId: row.submissionId } }); check(snapshot);
    if (!input.offline) { await syncCargoDrafts({ actorId: input.actorId, api: input.api, files: input.files }); check(snapshot); }
    const latest = await listCargoDrafts(input.actorId); check(snapshot);
    return latest.find(item => item.submissionId === row.submissionId) || row;
  })();
  submissions.set(key, work);
  return work.finally(() => { if (submissions.get(key) === work) submissions.delete(key); });
}
