import AsyncStorage from "@react-native-async-storage/async-storage";
import { saveCargoDraft, listCargoDrafts } from "./cargo-drafts";
import { captureCargoSession, isCurrentCargoSession, syncCargoDrafts } from "./cargo-sync";
import { buildCargoReceipt } from "./cargo-view-model";
import { validateCargoHandover } from "../../shared/cargo-handover";
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
function check(snapshot, isAuthorized, tripId) {
  if (!isCurrentCargoSession(snapshot)) throw new Error("The signed-in account changed. Reopen cargo verification.");
  if (isAuthorized && !isAuthorized(tripId)) throw Object.assign(new Error("Cargo assignment authority changed. Refresh your profile and current trip online before continuing. Any saved draft is retained."), { code: "CARGO_AUTHORITY_CHANGED" });
}
export async function readCargoForm(input) {
  const snapshot = current(input.actorId);
  const key = keyFor(input);
  await (writes.get(key) || Promise.resolve()); check(snapshot, input.isAuthorized, input.tripId);
  const value = await AsyncStorage.getItem(key); check(snapshot, input.isAuthorized, input.tripId);
  return value ? JSON.parse(value) : null;
}
export function saveCargoForm(input) {
  const snapshot = current(input.actorId), key = keyFor(input);
  // Editable counts may autosave; an unsent acknowledgment stays in memory only.
  const { handover: _unsentHandover, ...form } = input.form;
  const write = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    check(snapshot, input.isAuthorized, input.tripId); await AsyncStorage.setItem(key, JSON.stringify(form)); check(snapshot, input.isAuthorized, input.tripId); return form;
  });
  writes.set(key, write);
  return write.finally(() => { if (writes.get(key) === write) writes.delete(key); });
}
export async function submitCargoObservation(input) {
  const key = keyFor(input);
  if (submissions.has(key)) return submissions.get(key);
  const snapshot = current(input.actorId);
  const work = (async () => {
    check(snapshot, input.isAuthorized, input.tripId);
    if (input.execution?.capabilities?.observe !== true) throw new Error("Server observation permission is required.");
    const hash = input.execution?.manifest?.manifest_ref?.hash;
    if (input.form?.manifestHash !== hash) throw new Error("The manifest changed. Refresh and recount before submitting.");
    const rows = await listCargoDrafts(input.actorId); check(snapshot, input.isAuthorized, input.tripId);
    const savedForm = await readCargoForm(input); check(snapshot, input.isAuthorized, input.tripId);
    let row = rows.find(item => String(item.tripId) === String(input.tripId) && item.draft.stage === input.stage && item.manifestHash === hash && (item.submissionId === savedForm?.pendingSubmissionId || item.submissionId === input.form?.pendingSubmissionId));
    if (!row) row = rows.filter(item => String(item.tripId) === String(input.tripId) && item.draft.stage === input.stage && item.manifestHash === hash && item.syncState !== "FLEET_SAVED").at(-1);
    if (!row) {
      const handover = validateCargoHandover(input.handover);
      const draft = buildCargoReceipt(input.execution, { stage: input.stage, counts: input.form.counts, issues: input.form.issues, reportIssue: input.reportIssue === true, handover });
      check(snapshot, input.isAuthorized, input.tripId); row = await saveCargoDraft({ actorId: input.actorId, tripId: input.tripId, manifestRef: input.execution.manifest.manifest_ref, draft, isCurrent: () => { check(snapshot, input.isAuthorized, input.tripId); return true; } }); check(snapshot, input.isAuthorized, input.tripId);
    }
    if (input.reportIssue && !row.draft.lines.some(line => ["SHORTAGE", "EXCESS", "DAMAGE"].includes(line.issue_code))) throw new Error("Report an issue only for a shortage, excess or damage. Retry this clean receipt through Confirm pickup.");
    await saveCargoForm({ ...input, form: { ...input.form, pendingSubmissionId: row.submissionId } }); check(snapshot, input.isAuthorized, input.tripId);
    if (!input.offline) { await syncCargoDrafts({ actorId: input.actorId, api: input.api, files: input.files, isAuthorized: input.isAuthorized, submissionId: row.submissionId }); check(snapshot, input.isAuthorized, input.tripId); }
    const latest = await listCargoDrafts(input.actorId); check(snapshot, input.isAuthorized, input.tripId);
    return latest.find(item => item.submissionId === row.submissionId) || row;
  })();
  submissions.set(key, work);
  return work.finally(() => { if (submissions.get(key) === work) submissions.delete(key); });
}
