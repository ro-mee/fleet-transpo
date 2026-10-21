import { beforeEach, describe, expect, it, vi } from "vitest";
const stored = new Map();
const storageGates = vi.hoisted(() => ({ read: null, write: null }));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: { getItem: async key => { await storageGates.read?.(key); return stored.get(key) || null; }, setItem: async (key, value) => { await storageGates.write?.(key); stored.set(key, value); } } }));
import { setCargoSessionActor } from "./cargo-sync";
import { readCargoForm, saveCargoForm, submitCargoObservation } from "./cargo-form-state";
import { listCargoDrafts, markCargoSubmitted } from "./cargo-drafts";
beforeEach(() => { stored.clear(); storageGates.read = null; storageGates.write = null; setCargoSessionActor("employee-12"); });
const ref = { kind: "REQUEST", id: "f4d34c33-78f0-4f8b-8614-243caf975318", revision: 1, hash: "a".repeat(64) };
const handover = { version: 1, signer_name: "Alex Santos", signer_role_or_dept: "Receiving", acknowledgment: "CARGO_HANDOVER_V1", captured_at: "2026-10-20T02:00:00.000Z", signature: { width: 600, height: 240, strokes: [[[20, 30], [60, 80], [100, 40]]] }, location: null };
const execution = { manifest: { manifest_ref: ref, service_code: "RESTAURANT_SUPPLY_PICKUP", source_ref: { system: "POS", external_request_id: "order" }, lines: [{ line_id: "boxes", name: "Fresh produce", expected_quantity: "10", unit: "boxes", quantity_basis: "TRANSPORT_PACKAGE" }] }, capabilities: { observe: true } };
const input = { actorId: "employee-12", tripId: "701", stage: "PICKUP", execution, handover, form: { manifestHash: ref.hash, counts: { boxes: "9" }, issues: { boxes: { remarks: "One box missing" } } } };
describe("cargo form preservation and submission", () => {
  it("requires a new acknowledgment but keeps a saved signature immutable on exact retry", async () => {
    await expect(submitCargoObservation({ ...input, handover: undefined, offline: true })).rejects.toThrow(/signature|handover|acknowledgment/i);
    expect(await listCargoDrafts(input.actorId)).toEqual([]);
    const first = await submitCargoObservation({ ...input, offline: true });
    expect(first.draft.handover).toEqual(handover);
    const retry = await submitCargoObservation({ ...input, handover: { ...handover, signer_name: "Different signer" }, form: { ...input.form, counts: { boxes: "4" } }, offline: true });
    expect(retry.submissionId).toBe(first.submissionId); expect(retry.draft.handover).toEqual(handover); expect(retry.draft.lines[0].observed_quantity).toBe("9");
    expect(await listCargoDrafts(input.actorId)).toHaveLength(1);
  });
  it("does not autosave an unsent signer or drawing in the editable count form", async () => {
    await saveCargoForm({ ...input, form: { ...input.form, handover } });
    const saved = await readCargoForm(input);
    expect(saved.handover).toBeUndefined(); expect(JSON.stringify(saved)).not.toContain("Alex Santos");
  });
  it("requires a fresh signature after a successful receipt and an explicit new count", async () => {
    const first = await submitCargoObservation({ ...input, offline: true });
    await markCargoSubmitted(input.actorId, first.submissionId, { pickup_receipt: { receipt_id: "receipt-1" } });
    const next = { ...input, handover: undefined, form: { ...input.form, counts: { boxes: "8" } }, offline: true };
    await saveCargoForm(next);
    await expect(submitCargoObservation(next)).rejects.toThrow(/handover|acknowledgment/i);
    const secondHandover = { ...handover, signer_name: "New releasing staff" };
    const second = await submitCargoObservation({ ...next, handover: secondHandover });
    expect(second.submissionId).not.toBe(first.submissionId); expect(second.draft.handover).toEqual(secondHandover);
    expect((await listCargoDrafts(input.actorId))[0].draft.handover).toEqual(handover);
  });
  it("keeps incomplete counts while navigating back, separately from the submission queue", async () => {
    await saveCargoForm({ ...input, form: { counts: { boxes: "" }, issues: { boxes: { remarks: "Still counting" } } } });
    expect((await readCargoForm(input)).counts.boxes).toBe(""); expect(await listCargoDrafts("employee-12")).toEqual([]);
    setCargoSessionActor("other"); expect(await readCargoForm({ ...input, actorId: "other" })).toBe(null);
  });
  it("retains one frozen receipt and submission identity across a 503 retry", async () => {
    const api = { getExecution: async () => { throw Object.assign(new Error("Disabled"), { status: 503 }); } };
    const first = await submitCargoObservation({ ...input, api, offline: false });
    const again = await submitCargoObservation({ ...input, api, offline: false });
    expect(first.submissionId).toBe(again.submissionId); expect(again.syncState).toBe("DEVICE_SAVED");
    expect((await listCargoDrafts("employee-12"))).toHaveLength(1); expect((await readCargoForm(input)).pendingSubmissionId).toBe(first.submissionId);
  });
  it("saves offline observations without asserting Fleet save or readiness", async () => {
    const row = await submitCargoObservation({ ...input, offline: true });
    expect(row.syncState).toBe("DEVICE_SAVED"); expect(row.fleetSaved).toBe(false);
  });
  it("does not silently bind an old count to a changed manifest", async () => {
    await expect(submitCargoObservation({ ...input, form: { ...input.form, manifestHash: "b".repeat(64) }, offline: true })).rejects.toThrow(/changed/i);
  });
  it("refuses observation outside the server capability or active account", async () => {
    await expect(submitCargoObservation({ ...input, execution: { ...execution, capabilities: { observe: false } }, offline: true })).rejects.toThrow(/permission/i);
    setCargoSessionActor("other"); await expect(submitCargoObservation({ ...input, offline: true })).rejects.toThrow(/account/i);
  });
});

  it("waits for the latest autosave before restoring a form", async () => {
    const saving = saveCargoForm({ ...input, form: { counts: { boxes: "7" } } });
    const restored = await readCargoForm(input);
    await saving; expect(restored.counts.boxes).toBe("7");
  });

it("rejects an unclassified issue before saving a receipt but retains clean confirmation", async () => {
  const clean = { ...input, form: { ...input.form, counts: { boxes: "10" }, issues: { boxes: { reported: true, remarks: "Packaging checked" } } }, offline: true };
  await expect(submitCargoObservation({ ...clean, reportIssue: true })).rejects.toThrow(/shortage|excess|damage/i);
  expect(await listCargoDrafts("employee-12")).toEqual([]);
  const row = await submitCargoObservation(clean);
  expect(row.draft.lines[0].issue_code).toBe(null);
  await expect(submitCargoObservation({ ...clean, reportIssue: true })).rejects.toThrow(/shortage|excess|damage/i);
  expect(await listCargoDrafts("employee-12")).toHaveLength(1);
});

it.each(["driver-type", "removed-trip", "route", "offline"])("does not create a receipt after %s changes during a form read", async change => {
  const authority = { type: "Cargo", assigned: true, route: "701", online: true };
  const isAuthorized = tripId => authority.type === "Cargo" && authority.assigned && authority.route === String(tripId) && authority.online;
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  storageGates.read = async key => { if (key.startsWith("@cargo_form:")) { started = true; await gate; } };
  const writes = [];
  const api = { uploadEvidence: async () => { writes.push("upload"); }, submitReceipt: async () => { writes.push("receipt"); } };
  const work = submitCargoObservation({ ...input, isAuthorized, api, offline: false });
  const rejection = expect(work).rejects.toThrow(/authority|assignment|refresh/i);
  await vi.waitFor(() => expect(started).toBe(true));
  if (change === "driver-type") authority.type = "Passenger";
  if (change === "removed-trip") authority.assigned = false;
  if (change === "route") authority.route = "702";
  if (change === "offline") authority.online = false;
  release(); await rejection;
  expect(await listCargoDrafts(input.actorId)).toEqual([]); expect(writes).toEqual([]);
});

it("rechecks authority inside a deferred draft queue mutation before saving a new receipt", async () => {
  let authorized = true, release, reads = 0, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  storageGates.read = async key => { if (key.startsWith("@cargo_drafts:") && ++reads === 2) { started = true; await gate; } };
  const work = submitCargoObservation({ ...input, offline: true, isAuthorized: () => authorized });
  const rejected = expect(work).rejects.toThrow(/authority|assignment|refresh/i);
  await vi.waitFor(() => expect(started).toBe(true)); authorized = false; release(); await rejected;
  expect(await listCargoDrafts(input.actorId)).toEqual([]);
});

it("retains an already-created draft when authority changes during its form checkpoint and sends nothing", async () => {
  let authorized = true, release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  storageGates.write = async key => { if (key.startsWith("@cargo_form:")) { started = true; await gate; } };
  const effects = [];
  const api = { getExecution: async () => { effects.push("execution"); }, uploadEvidence: async () => { effects.push("upload"); }, submitReceipt: async () => { effects.push("receipt"); } };
  const work = submitCargoObservation({ ...input, offline: false, api, isAuthorized: () => authorized });
  const rejected = expect(work).rejects.toThrow(/authority|assignment|refresh/i);
  await vi.waitFor(() => expect(started).toBe(true)); authorized = false; release(); await rejected;
  const [row] = await listCargoDrafts(input.actorId);
  expect(row.syncState).toBe("DEVICE_SAVED"); expect(row.draft.lines[0].observed_quantity).toBe("9"); expect(effects).toEqual([]);
});
