import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const values = new Map();
  return { default: {
    getItem: vi.fn(async (key) => values.get(key) ?? null),
    setItem: vi.fn(async (key, value) => values.set(key, value)),
    removeItem: vi.fn(async (key) => values.delete(key)),
    __clear: () => values.clear(),
  } };
});

async function setup() {
  vi.resetModules();
  const drafts = await import("./cargo-drafts");
  const sync = await import("./cargo-sync");
  const storage = (await import("@react-native-async-storage/async-storage")).default;
  storage.__clear();
  sync.setCargoSessionActor("employee-A");
  const item = await drafts.saveCargoDraft({ actorId: "employee-A", tripId: 7,
    manifestRef: { kind: "REQUEST", id: "r1", revision: 3, hash: "hash-3" },
    draft: { stage: "PICKUP", observed_at: "2026-10-11T00:00:00Z", lines: [{ line_id: "oil", observed_quantity: "9", evidence: [{ uri: "file://photo.jpg", name: "photo.jpg", type: "image/jpeg" }] }] },
  });
  return { drafts, sync, storage, item };
}

beforeEach(() => vi.clearAllMocks());

describe("cargo evidence replay", () => {
  it("uploads staged evidence before sending the stable receipt and stores its server ID", async () => {
    const { sync, drafts, item } = await setup();
    const order = [];
    const api = {
      uploadEvidence: vi.fn(async (_tripId, form) => { order.push("upload"); expect(form.get("submission_id")).toMatch(/^[0-9a-f-]{36}$/); expect(form.get("submission_id")).toBe(item.submissionId); return { data: { execution_id: "e1", evidence_upload: { evidence_id: "server-evidence-1" } } }; }),
      submitReceipt: vi.fn(async (_tripId, receipt) => { order.push("receipt"); expect(receipt.submission_id).toBe(item.submissionId); expect(receipt.lines[0].evidence_ids).toEqual(["server-evidence-1"]); return { data: { pickup_state: "AWAITING_DECISION" } }; }),
    };
    const files = { exists: vi.fn(async () => true), getInfo: vi.fn(async () => ({ exists: true })) };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files });
    expect(order).toEqual(["upload", "receipt"]);
    expect((await drafts.listCargoDrafts("employee-A"))[0].evidence[0].evidenceId).toBe("server-evidence-1");
  });

  it("reuploads an older mismatched photo under the receipt submission before attaching", async () => {
    const { sync, drafts, item } = await setup();
    await drafts.updateCargoDraft("employee-A", item.submissionId, { evidence: item.evidence.map(file => ({ ...file, uploadSubmissionId: "old-submission", evidenceId: "old-photo" })) });
    let uploadedSubmission;
    let receipt;
    await sync.syncCargoDrafts({ actorId: "employee-A", api: {
      uploadEvidence: async (_id, form) => { uploadedSubmission = form.get("submission_id"); return { evidence_upload: { evidence_id: "bound-photo" } }; },
      submitReceipt: async (_id, value) => { receipt = value; return {}; },
    } });
    expect(uploadedSubmission).toBe(item.submissionId);
    expect(receipt.lines[0].evidence_ids).toEqual(["bound-photo"]);
  });

  it("stops on stale manifest and leaves the draft for review", async () => {
    const { sync, drafts } = await setup();
    const api = { uploadEvidence: vi.fn(async () => ({ data: { evidence_upload: { evidence_id: "ev-1" } } })), submitReceipt: vi.fn(async () => { throw { status: 409 }; }) };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    expect(api.submitReceipt).toHaveBeenCalledOnce();
    expect((await drafts.listCargoDrafts("employee-A"))[0].syncState).toBe("STALE_REVIEW");
  });

  it("checks the current manifest before uploading staged files", async () => {
    const { sync, drafts } = await setup();
    const api = {
      getExecution: vi.fn(async () => ({ data: { manifest: { manifest_ref: { hash: "newer-hash" } } } })),
      uploadEvidence: vi.fn(), submitReceipt: vi.fn(),
    };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    expect(api.uploadEvidence).not.toHaveBeenCalled();
    expect(api.submitReceipt).not.toHaveBeenCalled();
    expect((await drafts.listCargoDrafts("employee-A"))[0].syncState).toBe("STALE_REVIEW");
  });

  it("does not upload when the server denies the current driver", async () => {
    const { sync, drafts } = await setup();
    const api = {
      getExecution: vi.fn(async () => { throw { status: 403 }; }),
      uploadEvidence: vi.fn(), submitReceipt: vi.fn(),
    };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    expect(api.uploadEvidence).not.toHaveBeenCalled();
    expect((await drafts.listCargoDrafts("employee-A"))[0].syncState).toBe("TERMINAL_REVIEW");
  });

  it("keeps disabled-service failures pending without calling them offline", async () => {
    const { sync, drafts } = await setup();
    const api = { uploadEvidence: vi.fn(async () => { throw { status: 503, code: "CARGO_DISABLED" }; }), submitReceipt: vi.fn() };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    const row = (await drafts.listCargoDrafts("employee-A"))[0];
    expect(row.syncState).toBe("DEVICE_SAVED");
    expect(row.lastErrorCode).toBeNull();
  });

  it.each([[401, "REAUTHENTICATION_REQUIRED"], [403, "TERMINAL_REVIEW"], [404, "TERMINAL_REVIEW"]])("classifies %i without deleting evidence", async (status, state) => {
    const { sync, drafts } = await setup();
    const api = { uploadEvidence: vi.fn(async () => { throw { status }; }), submitReceipt: vi.fn() };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    expect((await drafts.listCargoDrafts("employee-A"))[0].syncState).toBe(state);
    expect(api.submitReceipt).not.toHaveBeenCalled();
  });

  it("cancels an upload drain at account switch and ignores its late response", async () => {
    const { sync, drafts, item } = await setup();
    let releaseUpload;
    const api = { uploadEvidence: vi.fn((_trip, _form, _actor, signal) => new Promise((resolve) => { releaseUpload = resolve; signal.addEventListener("abort", () => resolve({ aborted: true })); })), submitReceipt: vi.fn() };
    const drain = sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    await vi.waitFor(() => expect(api.uploadEvidence).toHaveBeenCalledOnce());
    sync.setCargoSessionActor("employee-B");
    expect(api.uploadEvidence.mock.calls[0][3].aborted).toBe(true);
    releaseUpload({ data: { evidence_upload: { evidence_id: "late-A-id" } } });
    await drain;
    expect(api.submitReceipt).not.toHaveBeenCalled();
    expect((await drafts.listCargoDrafts("employee-A"))[0].evidence[0].evidenceId).toBeNull();
    expect(item.actorId).toBe("employee-A");
  });

  it("serializes a new save behind the upload evidence checkpoint", async () => {
    const { sync, drafts, storage } = await setup();
    let releaseUpload;
    let releaseRead;
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    const api = { uploadEvidence: vi.fn(() => new Promise((resolve) => { releaseUpload = resolve; })), submitReceipt: vi.fn() };
    const drain = sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    await vi.waitFor(() => expect(api.uploadEvidence).toHaveBeenCalledOnce());
    const originalGet = storage.getItem;
    storage.getItem = vi.fn(async (key) => { const value = await originalGet(key); await readGate; return value; });
    releaseUpload({ data: { evidence_upload: { evidence_id: "server-evidence-1" } } });
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledOnce());
    const save = drafts.saveCargoDraft({ actorId: "employee-A", tripId: 8,
      manifestRef: { kind: "REQUEST", id: "r8", revision: 1, hash: "h8" }, draft: { lines: [] } });
    await Promise.resolve();
    expect(storage.getItem).toHaveBeenCalledOnce();
    releaseRead();
    await Promise.all([drain, save]);
    storage.getItem = originalGet;
    const rows = await drafts.listCargoDrafts("employee-A");
    expect(rows).toHaveLength(2);
    expect(rows[0].evidence[0].evidenceId).toBe("server-evidence-1");
  });

  it("retains a draft after transport outage and keeps partner receipt separate from business state", async () => {
    const { sync, drafts } = await setup();
    const api = { uploadEvidence: vi.fn(async () => ({ data: { evidence_upload: { evidence_id: "ev-1" } } })), submitReceipt: vi.fn(async () => { throw { status: 0 }; }) };
    await sync.syncCargoDrafts({ actorId: "employee-A", api, files: {} });
    const row = (await drafts.listCargoDrafts("employee-A"))[0];
    expect(row.syncState).toBe("DEVICE_SAVED");
    expect((await sync.getCargoSyncState("employee-A", 7)).fleetSaved).toBe(false);
    expect((await sync.getCargoSyncState("employee-A", 7)).partnerReceived).toBe(false);
  });

  it("reconciles an already-saved receipt with later Task 9 feedback and scopes state to the latest recount", async () => {
    const { sync, drafts, item } = await setup();
    await drafts.markCargoSubmitted("employee-A", item.submissionId, {
      pickup_receipt: { receipt_id: "receipt-current" }, feedback: { state: "WAITING" },
    });
    const api = {
      getExecution: vi.fn(async () => ({ data: {
        pickup_receipt: { receipt_id: "receipt-current" }, feedback: { state: "ACKNOWLEDGED" },
      } })),
      uploadEvidence: vi.fn(), submitReceipt: vi.fn(),
    };
    await sync.syncCargoDrafts({ actorId: "employee-A", api });
    expect((await drafts.listCargoDrafts("employee-A"))[0].partnerReceived).toBe(true);
    const next = await drafts.saveCargoDraft({ actorId: "employee-A", tripId: 7,
      manifestRef: item.manifestRef, draft: { stage: "PICKUP", lines: [] } });
    const state = await sync.getCargoSyncState("employee-A", 7);
    expect(state.fleetSaved).toBe(false);
    expect(state.partnerReceived).toBe(false);
    expect(state.drafts.at(-1).submissionId).toBe(next.submissionId);
  });

  it("keeps the saved local receipt state when Task 7 feedback is unavailable", async () => {
    const { sync, drafts, item } = await setup();
    await drafts.markCargoSubmitted("employee-A", item.submissionId, {
      pickup_receipt: { receipt_id: "receipt-current" }, feedback: { state: "WAITING" },
    });
    await sync.syncCargoDrafts({ actorId: "employee-A", api: { getExecution: async () => { throw { status: 503 }; } } });
    expect((await drafts.listCargoDrafts("employee-A"))[0].partnerReceived).toBe(false);
  });
});

describe("interactive cargo authority through deferred work", () => {
  it.each(["driver-type", "removed-trip", "route", "offline"].flatMap(change => ["execution", "file", "upload"].map(wait => [change, wait])))("stops %s during %s before the next side effect", async (change, wait) => {
    const { sync, drafts } = await setup();
    const authority = { driverType: "Cargo", trip: { trip_id: 7, vehicle_id: 3, operational_use: "Cargo", load_type: "Cargo" }, routeId: 7, online: true };
    const isAuthorized = tripId => authority.driverType === "Cargo" && authority.trip?.trip_id === Number(tripId) && authority.routeId === Number(tripId) && authority.online;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const started = [];
    const api = {
      getExecution: async () => { started.push("execution"); if (wait === "execution") await gate; return { manifest: { manifest_ref: { hash: "hash-3" } } }; },
      uploadEvidence: async () => { started.push("upload"); if (wait === "upload") await gate; return { evidence_upload: { evidence_id: "uploaded-id" } }; },
      submitReceipt: async () => { started.push("receipt"); return {}; },
    };
    const files = { getInfo: async () => { started.push("file"); if (wait === "file") await gate; return { exists: true }; } };
    const work = sync.syncCargoDrafts({ actorId: "employee-A", api, files, isAuthorized });
    await vi.waitFor(() => expect(started).toContain(wait));
    if (change === "driver-type") authority.driverType = "Passenger";
    if (change === "removed-trip") authority.trip = null;
    if (change === "route") authority.routeId = 8;
    if (change === "offline") authority.online = false;
    release();
    const result = await work;
    expect(result.cancelled).toBe(true);
    expect(started).not.toContain("receipt");
    if (wait !== "upload") expect(started).not.toContain("upload");
    const [row] = await drafts.listCargoDrafts("employee-A");
    expect(row.syncState).toBe("DEVICE_SAVED"); expect(row.evidence[0].evidenceId).toBeNull();
  });
});

it("an interactive receipt does not send another trip's draft", async () => {
  const { sync, drafts, item } = await setup();
  const other = await drafts.saveCargoDraft({ actorId: "employee-A", tripId: 8, manifestRef: item.manifestRef, draft: { stage: "PICKUP", lines: [] } });
  const sent = [];
  const api = { uploadEvidence: async tripId => { sent.push(["upload", tripId]); return { evidence_upload: { evidence_id: "ev1" } }; }, submitReceipt: async tripId => { sent.push(["receipt", tripId]); return {}; } };
  await sync.syncCargoDrafts({ actorId: "employee-A", api, submissionId: item.submissionId, isAuthorized: tripId => String(tripId) === "7" });
  expect(sent).toEqual([["upload", "7"], ["receipt", "7"]]);
  expect((await drafts.listCargoDrafts("employee-A")).find(row => row.submissionId === other.submissionId).fleetSaved).toBe(false);
});

it("interactive work revalidates after waiting for an existing background drain", async () => {
  const { sync } = await setup();
  let release, authorized = true, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const background = sync.syncCargoDrafts({ actorId: "employee-A", api: { uploadEvidence: async () => { started = true; await gate; return { evidence_upload: { evidence_id: "background-ev" } }; }, submitReceipt: async () => ({ pickup_receipt: { receipt_id: "receipt-1" } }) } });
  await vi.waitFor(() => expect(started).toBe(true));
  const effects = [];
  const interactive = sync.syncCargoDrafts({ actorId: "employee-A", isAuthorized: () => authorized, api: { getExecution: async () => { effects.push("execution"); }, uploadEvidence: async () => { effects.push("upload"); }, submitReceipt: async () => { effects.push("receipt"); } } });
  authorized = false; release(); await background;
  expect((await interactive).cancelled).toBe(true); expect(effects).toEqual([]);
});

it("waiting interactive work cannot resume under a new login of the same account", async () => {
  const { sync } = await setup();
  let release, started = false;
  const gate = new Promise(resolve => { release = resolve; });
  const background = sync.syncCargoDrafts({ actorId: "employee-A", api: { uploadEvidence: async () => { started = true; await gate; return { evidence_upload: { evidence_id: "old-session" } }; }, submitReceipt: async () => ({}) } });
  await vi.waitFor(() => expect(started).toBe(true));
  const effects = [];
  const interactive = sync.syncCargoDrafts({ actorId: "employee-A", isAuthorized: () => true, api: { uploadEvidence: async () => { effects.push("upload"); return { evidence_upload: { evidence_id: "new-session" } }; }, submitReceipt: async () => { effects.push("receipt"); return {}; } } });
  sync.beginCargoSessionTransition(); sync.setCargoSessionActor("employee-A"); release(); await background;
  expect((await interactive).cancelled).toBe(true); expect(effects).toEqual([]);
});
