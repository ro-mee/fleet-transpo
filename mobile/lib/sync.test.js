/**
 * Outbox gate tests (sync.js): hasPendingWork() mirror + drain convergence.
 * AsyncStorage is an in-memory Map; apiFetch is injected (sync.js must never
 * import api.js). What is real: fail-open startup, enqueue/drain convergence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const mem = new Map();
  return {
    default: {
      getItem: vi.fn(async (k) => (mem.has(k) ? mem.get(k) : null)),
      setItem: vi.fn(async (k, v) => {
        mem.set(k, v);
      }),
      removeItem: vi.fn(async (k) => {
        mem.delete(k);
      }),
      __clear: () => mem.clear(),
    },
  };
});

async function freshSync() {
  vi.resetModules();
  const mod = await import("./sync");
  const store = (await import("@react-native-async-storage/async-storage")).default;
  store.__clear();
  return { mod, store };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hasPendingWork", () => {
  it("fails open before the first count is known", async () => {
    const { mod } = await freshSync();
    expect(mod.hasPendingWork()).toBe(true);
  });

  it("is false after counting an empty queue", async () => {
    const { mod } = await freshSync();
    expect(await mod.getPendingCount()).toBe(0);
    expect(mod.hasPendingWork()).toBe(false);
  });

  it("flips true on enqueue and false after a successful drain", async () => {
    const { mod } = await freshSync();
    const apiFetch = vi.fn(async () => ({ ok: true }));
    mod.setApiFetch(apiFetch);

    await mod.enqueueRequest("POST", "/api/mobile/driver/trips/1/status", {
      status: "Started",
    });
    expect(mod.hasPendingWork()).toBe(true);
    expect(await mod.getPendingCount()).toBe(1);

    await mod.syncQueue();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(mod.hasPendingWork()).toBe(false);
    expect(await mod.getPendingCount()).toBe(0);
  });
});

describe("outbox cap", () => {
  it("drops the oldest non-incident once the cap is exceeded", async () => {
    const { mod, store } = await freshSync();
    for (let i = 0; i < 101; i++) {
      await mod.enqueueRequest("POST", "/api/mobile/driver/trips/1/status", { i });
    }
    const queue = JSON.parse(await store.getItem("@offline_queue"));
    expect(queue).toHaveLength(100);
    expect(queue[0].body.i).toBe(1); // i=0 was the oldest and was dropped
    expect(mod.hasPendingWork()).toBe(true);
  });

  it("never drops an incident report, even past the cap", async () => {
    const { mod, store } = await freshSync();
    await mod.enqueueRequest("POST", "/api/driver/incidents", { kind: "collision" });
    for (let i = 0; i < 101; i++) {
      await mod.enqueueRequest("PUT", "/api/mobile/driver/trips/1/status", { i });
    }
    const queue = JSON.parse(await store.getItem("@offline_queue"));
    expect(queue).toHaveLength(100);
    expect(queue.some((r) => r.path === "/api/driver/incidents")).toBe(true);
  });
});
