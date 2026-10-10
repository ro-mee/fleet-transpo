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

async function freshDrafts() {
  vi.resetModules();
  const drafts = await import("./cargo-drafts");
  const storage = (await import("@react-native-async-storage/async-storage")).default;
  storage.__clear();
  return { drafts, storage };
}

beforeEach(() => vi.clearAllMocks());

describe("account-scoped cargo drafts", () => {
  it("keeps both drafts when saves overlap on one owner queue", async () => {
    const { drafts, storage } = await freshDrafts();
    let releaseReads;
    const readGate = new Promise((resolve) => { releaseReads = resolve; });
    const originalGet = storage.getItem;
    storage.getItem = vi.fn(async (key) => {
      const value = await originalGet(key);
      await readGate;
      return value;
    });
    const save = (tripId) => drafts.saveCargoDraft({ actorId: "employee-7", tripId,
      manifestRef: { kind: "REQUEST", id: `r${tripId}`, revision: 1, hash: "h" }, draft: { lines: [] } });
    const first = save(1);
    const second = save(2);
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledOnce());
    releaseReads();
    await Promise.all([first, second]);
    expect((await drafts.listCargoDrafts("employee-7")).map((row) => row.tripId)).toEqual(["1", "2"]);
  });

  it("does not commit an owner update if the account fence expires during its read", async () => {
    const { drafts, storage } = await freshDrafts();
    const saved = await drafts.saveCargoDraft({ actorId: "employee-7", tripId: 1,
      manifestRef: { kind: "REQUEST", id: "r1", revision: 1, hash: "h" }, draft: { lines: [] } });
    let releaseRead;
    const readGate = new Promise((resolve) => { releaseRead = resolve; });
    const originalGet = storage.getItem;
    storage.getItem = vi.fn(async (key) => { const value = await originalGet(key); await readGate; return value; });
    let current = true;
    const update = drafts.updateCargoDraft("employee-7", saved.submissionId, { evidence: [{ evidenceId: "late" }] }, () => current);
    await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledOnce());
    current = false;
    releaseRead();
    await update;
    storage.getItem = originalGet;
    expect((await drafts.listCargoDrafts("employee-7"))[0].evidence).toEqual([]);
  });

  it("uses the receipt ID for the draft stage when both receipts are returned", async () => {
    const { drafts } = await freshDrafts();
    const delivery = await drafts.saveCargoDraft({ actorId: "employee-7", tripId: 44,
      manifestRef: { kind: "REQUEST", id: "req-1", revision: 2, hash: "abc" }, draft: { stage: "DELIVERY", lines: [] } });
    await drafts.markCargoSubmitted("employee-7", delivery.submissionId, {
      pickup_receipt: { receipt_id: "pickup-1" }, delivery_receipt: { receipt_id: "delivery-1" },
    });
    expect((await drafts.listCargoDrafts("employee-7"))[0].receiptId).toBe("delivery-1");
  });
  it("persists stable submission IDs under the employee account across reloads", async () => {
    const { drafts } = await freshDrafts();
    const first = await drafts.saveCargoDraft({
      actorId: "employee-7", tripId: 44,
      manifestRef: { kind: "REQUEST", id: "req-1", revision: 2, hash: "abc" },
      draft: { stage: "PICKUP", lines: [] },
    });
    vi.resetModules();
    const reloaded = await import("./cargo-drafts");
    const rows = await reloaded.listCargoDrafts("employee-7");
    expect(rows[0].submissionId).toBe(first.submissionId);
    expect(await reloaded.listCargoDrafts("driver-7")).toEqual([]);
  });

  it("preserves existing evidence and returns an explicit queue-full error", async () => {
    const { drafts } = await freshDrafts();
    for (let i = 0; i < 100; i++) {
      await drafts.saveCargoDraft({ actorId: "employee-7", tripId: i,
        manifestRef: { kind: "REQUEST", id: `r${i}`, revision: 1, hash: "h" }, draft: { lines: [] } });
    }
    await expect(drafts.saveCargoDraft({ actorId: "employee-7", tripId: 101,
      manifestRef: { kind: "REQUEST", id: "last", revision: 1, hash: "h" }, draft: { lines: [] } }))
      .rejects.toMatchObject({ code: "CARGO_QUEUE_FULL" });
    expect(await drafts.listCargoDrafts("employee-7")).toHaveLength(100);
  });

  it("creates a new immutable submission after a source WAIT recount", async () => {
    const { drafts } = await freshDrafts();
    const common = { actorId: "employee-7", tripId: 44,
      manifestRef: { kind: "REQUEST", id: "req-1", revision: 2, hash: "abc" } };
    const first = await drafts.saveCargoDraft({ ...common, draft: { stage: "PICKUP", lines: [{ line_id: "oil", observed_quantity: "8" }] } });
    await drafts.markCargoSubmitted("employee-7", first.submissionId, { state: "WAITING" });
    const second = await drafts.saveCargoDraft({ ...common, draft: { stage: "PICKUP", lines: [{ line_id: "oil", observed_quantity: "9" }] } });
    expect(second.submissionId).not.toBe(first.submissionId);
    expect((await drafts.listCargoDrafts("employee-7")).map((row) => row.submissionId)).toEqual([first.submissionId, second.submissionId]);
  });
});
