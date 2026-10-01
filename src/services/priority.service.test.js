import { describe, expect, it, vi, beforeEach } from "vitest";
import * as db from "@/lib/db";
import { recomputeDerivedPriority } from "@/services/priority.service";
import { getDispatchPolicy } from "@/services/dispatch-settings.service";

vi.mock("@/lib/db", () => ({ query: vi.fn(async () => ({ rows: [] })) }));

// `recomputeDerivedPriority` now takes the connection it should use, because the
// transition that triggers it may be inside a transaction that already holds the
// request row's lock. Run on the pool instead and the UPDATE waits on a lock only
// the caller's own transaction can release — a self-deadlock that leaves the
// priority silently stale.
describe("recomputeDerivedPriority connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 });
  });

  const REQUEST = {
    request_id: 7,
    pickup_datetime: "2026-09-15T16:00:00.000Z",
    fleet_status: "Scheduled",
    is_vip: false,
    is_emergency: false,
  };

  it("uses the pooled query when no connection is given", async () => {
    const result = await recomputeDerivedPriority(REQUEST);
    expect(result.has(7)).toBe(true);
    expect(db.query).toHaveBeenCalledTimes(2); // policy read + priority update
  });

  it("runs BOTH the policy read and the update on a supplied connection", async () => {
    const txCalls = [];
    const tx = {
      query: vi.fn(async (sql, params) => {
        txCalls.push(String(sql));
        return { rows: [], rowCount: 0 };
      }),
    };

    await recomputeDerivedPriority(REQUEST, null, tx);

    expect(txCalls).toHaveLength(2);
    expect(txCalls[0]).toContain("FROM system_settings");
    expect(txCalls[1]).toContain("UPDATE transportation_requests");
    // Nothing escaped to the pool: a second connection here is what deadlocks.
    expect(db.query).not.toHaveBeenCalled();
  });

  it("skips the policy read entirely when one is passed in", async () => {
    const policy = { criticalMinutes: 30, highMinutes: 60, mediumMinutes: 120 };
    await recomputeDerivedPriority(REQUEST, policy);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(db.query).mock.calls[0][0])).toContain("UPDATE transportation_requests");
  });

  it("keeps the derived level for a terminal status as null rather than a stale value", async () => {
    const result = await recomputeDerivedPriority({ ...REQUEST, fleet_status: "Completed" });
    expect(result.get(7)).toBeNull();
  });
});

describe("getDispatchPolicy connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the policy through the supplied connection", async () => {
    const tx = { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) };
    await getDispatchPolicy(tx);
    expect(tx.query).toHaveBeenCalledTimes(1);
    expect(db.query).not.toHaveBeenCalled();
  });
});
