/**
 * Regression tests for the reconnect auth race (driver report: transient
 * "session" warning on Home after offline → online, self-healing on retry).
 *
 * Native modules are mocked at the boundary (SecureStore, AsyncStorage,
 * react-native Platform); fetch is stubbed per scenario. What is real: the
 * full apiFetch 401 → refresh → replay flow, single-flight refresh, and the
 * no-logout-on-transient rules.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));

vi.mock("expo-secure-store", () => {
  const mem = new Map();
  return {
    setItemAsync: vi.fn(async (k, v) => {
      mem.set(k, v);
    }),
    getItemAsync: vi.fn(async (k) => (mem.has(k) ? mem.get(k) : null)),
    deleteItemAsync: vi.fn(async (k) => {
      mem.delete(k);
    }),
    __clear: () => mem.clear(),
  };
});

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}));

import { apiFetch, setSessionExpiredHandler } from "./api";
import { saveTokens, getRefreshToken, clearAll } from "./storage";
import { persistSignedInSession } from "./auth-session";
import * as SecureStore from "expo-secure-store";
import { setCargoSessionActor, captureCargoSession, isCurrentCargoSession, isCurrentCargoActor } from "./cargo-sync";

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const onExpired = vi.fn();

beforeEach(() => {
  SecureStore.__clear();
  vi.clearAllMocks();
  onExpired.mockClear();
  setSessionExpiredHandler(onExpired);
  setCargoSessionActor(null);
  global.fetch = vi.fn();
});

async function seedSession(access = "OLD-A", refresh = "OLD-R") {
  await saveTokens({ accessToken: access, refreshToken: refresh });
}

describe("reconnect burst with an expired access token", () => {
  it("refreshes once for concurrent 401s and replays all callers", async () => {
    await seedSession();
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls++;
        return jsonRes(200, { accessToken: "A2", refreshToken: "R2" });
      }
      const auth = init?.headers?.Authorization;
      if (auth === "Bearer A2") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    const results = await Promise.all([
      apiFetch("/api/mobile/driver/trips"),
      apiFetch("/api/mobile/driver/trips"),
      apiFetch("/api/mobile/driver/trips"),
    ]);
    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("cargo account fencing", () => {
  it("invalidates A before sign-in queues B credentials and drops A's queued refresh write", async () => {
    await seedSession("A-access", "A-refresh");
    setCargoSessionActor("employee-A");
    const sessionA = captureCargoSession("employee-A");
    let releaseBWrite;
    let startedBWrite;
    const bWriteStarted = new Promise((resolve) => { startedBWrite = resolve; });
    const bWriteGate = new Promise((resolve) => { releaseBWrite = resolve; });
    const originalSet = SecureStore.setItemAsync.getMockImplementation();
    SecureStore.setItemAsync.mockImplementation(async (key, value) => {
      if (key === "fleetops_access_token" && value === "B-access") {
        startedBWrite();
        await bWriteGate;
      }
      return originalSet(key, value);
    });

    const signIn = persistSignedInSession({
      accessToken: "B-access",
      refreshToken: "B-refresh",
      driver: { employeeId: "employee-B", id: "driver-B" },
    });
    await bWriteStarted;
    expect(isCurrentCargoSession(sessionA)).toBe(false);
    const lateRefreshWrite = saveTokens(
      { accessToken: "late-A-access", refreshToken: "late-A-refresh" },
      () => isCurrentCargoSession(sessionA),
    );
    releaseBWrite();
    await Promise.all([signIn, lateRefreshWrite]);
    SecureStore.setItemAsync.mockImplementation(originalSet);

    expect(isCurrentCargoSession(sessionA)).toBe(false);
    expect(isCurrentCargoActor("employee-B")).toBe(true);
    expect(SecureStore.setItemAsync.mock.calls.some(([, value]) => value === "late-A-access")).toBe(false);
    expect(await getRefreshToken()).toBe("B-refresh");
  });

  it("shares one refresh flight between cargo and generic requests in the same session", async () => {
    await seedSession();
    setCargoSessionActor("employee-A");
    let refreshCalls = 0;
    let releaseRefresh;
    const gate = new Promise((resolve) => { releaseRefresh = resolve; });
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls += 1;
        await gate;
        return jsonRes(200, { accessToken: "A2", refreshToken: "R2" });
      }
      if (init?.headers?.Authorization === "Bearer A2") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });
    const cargo = apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false });
    const generic = apiFetch("/api/driver/me");
    await vi.waitFor(() => expect(refreshCalls).toBe(1));
    releaseRefresh();
    expect(await Promise.all([cargo, generic])).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
  });

  it("aborts a cargo refresh on account switch and cannot replace the new account tokens", async () => {
    await seedSession("A-access", "A-refresh");
    setCargoSessionActor("employee-A");
    let releaseRefresh;
    let refreshSignal;
    global.fetch = vi.fn((url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshSignal = init.signal;
        return new Promise((resolve) => { releaseRefresh = resolve; });
      }
      return Promise.resolve(jsonRes(401, { error: "Unauthorized" }));
    });
    const pending = apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false });
    await vi.waitFor(() => expect(releaseRefresh).toBeDefined());
    setCargoSessionActor("employee-B");
    await saveTokens({ accessToken: "B-access", refreshToken: "B-refresh" });
    expect(refreshSignal.aborted).toBe(true);
    releaseRefresh(jsonRes(200, { accessToken: "late-A-access", refreshToken: "late-A-refresh" }));
    await expect(pending).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(await getRefreshToken()).toBe("B-refresh");
  });

  it("does not restore an expired session after logout during refresh", async () => {
    await seedSession("A-access", "A-refresh");
    setCargoSessionActor("employee-A");
    let releaseRefresh;
    let refreshSignal;
    global.fetch = vi.fn((url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshSignal = init.signal;
        return new Promise((resolve) => { releaseRefresh = resolve; });
      }
      return Promise.resolve(jsonRes(401, { error: "Unauthorized" }));
    });
    const pending = apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false });
    await vi.waitFor(() => expect(releaseRefresh).toBeDefined());
    setCargoSessionActor(null);
    await clearAll();
    expect(refreshSignal.aborted).toBe(true);
    releaseRefresh(jsonRes(200, { accessToken: "late-A-access", refreshToken: "late-A-refresh" }));
    await expect(pending).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(await getRefreshToken()).toBeNull();
  });

  it("refuses a cargo request when its owner is not the signed-in employee", async () => {
    await seedSession();
    setCargoSessionActor("employee-B");
    await expect(apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false }))
      .rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores an A response that arrives after the account changes to B", async () => {
    await seedSession();
    setCargoSessionActor("employee-A");
    let releaseResponse;
    let fetchSignal;
    global.fetch = vi.fn((_url, init) => new Promise((resolve) => { releaseResponse = resolve; fetchSignal = init.signal; }));
    const pending = apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false });
    await vi.waitFor(() => expect(global.fetch).toHaveBeenCalledOnce());
    setCargoSessionActor("employee-B");
    expect(fetchSignal.aborted).toBe(true);
    releaseResponse(jsonRes(200, { data: { secret: "A" } }));
    await expect(pending).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
  });

  it("cancels cargo work when refresh expires the session", async () => {
    await seedSession();
    setCargoSessionActor("employee-A");
    setSessionExpiredHandler(() => setCargoSessionActor(null));
    global.fetch = vi.fn(async (url) => String(url).includes("/api/mobile/auth/refresh")
      ? jsonRes(401, { error: "Session expired" })
      : jsonRes(401, { error: "Unauthorized" }));
    await expect(apiFetch("/api/trips/7/cargo", { cargoActorId: "employee-A", queueOnFailure: false }))
      .rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
  });
});

describe("rotation race second chance", () => {
  it("recovers when the first replay 401s and the second rotation succeeds", async () => {
    await seedSession();
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls++;
        return refreshCalls === 1
          ? jsonRes(200, { accessToken: "A2", refreshToken: "R2" })
          : jsonRes(200, { accessToken: "A3", refreshToken: "R3" });
      }
      const auth = init?.headers?.Authorization;
      if (auth === "Bearer A3") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    const res = await apiFetch("/api/mobile/driver/trips");
    expect(res).toEqual({ ok: true });
    expect(refreshCalls).toBe(2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("still surfaces a real 401 after both rotations fail to satisfy the server", async () => {
    await seedSession();
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        return jsonRes(200, { accessToken: "AX", refreshToken: "RX" });
      }
      return jsonRes(401, { error: "Unauthorized" });
    });

    await expect(apiFetch("/api/mobile/driver/trips")).rejects.toMatchObject({ status: 401 });
  });
});

describe("refresh rate limit is transient, not death", () => {
  it("never clears the session on a 429", async () => {
    await seedSession("OLD-A", "KEEP-R");
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        return jsonRes(429, { error: "Too many requests. Try again later.", retry_after: 1 });
      }
      return jsonRes(401, { error: "Unauthorized" });
    });

    await expect(apiFetch("/api/mobile/driver/trips")).rejects.toMatchObject({ status: 429 });
    expect(onExpired).not.toHaveBeenCalled();
    expect(await getRefreshToken()).toBe("KEEP-R");
  });
});

describe("refresh transport retry on flaky reconnect", () => {  it("retries once and succeeds without touching the session", async () => {
    await seedSession();
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls++;
        if (refreshCalls === 1) throw new TypeError("Network request failed");
        return jsonRes(200, { accessToken: "A2", refreshToken: "R2" });
      }
      const auth = init?.headers?.Authorization;
      if (auth === "Bearer A2") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    const res = await apiFetch("/api/mobile/driver/trips");
    expect(res).toEqual({ ok: true });
    expect(refreshCalls).toBe(2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("a doubly-unreachable refresh propagates as network error, session intact", async () => {
    await seedSession("OLD-A", "KEEP-R");
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        throw new TypeError("Network request failed");
      }
      // Original GET: fail the first attempt so the retry path runs, then
      // behave as offline for the replay of the refresh flow.
      throw new TypeError("Network request failed");
    });

    await expect(apiFetch("/api/mobile/driver/trips")).rejects.toThrow(/Network request failed/);
    expect(onExpired).not.toHaveBeenCalled();
    expect(await getRefreshToken()).toBe("KEEP-R");
  });
});

describe("cold-start burst with a slow refresh and a staggered second wave", () => {
  it("joins every wave onto one refresh and replays all callers", async () => {
    await seedSession();
    let refreshCalls = 0;
    let releaseRefresh;
    const refreshGate = new Promise((resolve) => {
      releaseRefresh = resolve;
    });
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls++;
        await refreshGate;
        return jsonRes(200, { accessToken: "A2", refreshToken: "R2" });
      }
      const auth = init?.headers?.Authorization;
      if (auth === "Bearer A2") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    // Wave 1: three parallel calls hit 401 and park on the single refresh.
    const wave1 = Promise.all([
      apiFetch("/api/mobile/driver/trips"),
      apiFetch("/api/driver/me"),
      apiFetch("/api/mobile/driver/ref"),
    ]);
    // Wave 2 arrives mid-refresh with the still-old stored token.
    await new Promise((r) => setTimeout(r, 20));
    const wave2 = Promise.all([apiFetch("/api/mobile/driver/trips"), apiFetch("/api/driver/me")]);
    await new Promise((r) => setTimeout(r, 20));
    releaseRefresh();

    const [r1, r2] = await Promise.all([wave1, wave2]);
    expect([...r1, ...r2]).toEqual([{ ok: true }, { ok: true }, { ok: true }, { ok: true }, { ok: true }]);
    expect(refreshCalls).toBe(1);
    expect(onExpired).not.toHaveBeenCalled();
  });
});

describe("refresh 429 is waited out silently, not surfaced", () => {
  it("waits per retry_after and retries once, session and caller unaffected", async () => {
    await seedSession();
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls++;
        if (refreshCalls === 1) {
          return {
            ok: false,
            status: 429,
            json: async () => ({ error: "Too many requests. Try again later.", retry_after: 1 }),
          };
        }
        return jsonRes(200, { accessToken: "A2", refreshToken: "R2" });
      }
      const auth = init?.headers?.Authorization;
      if (auth === "Bearer A2") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    const res = await apiFetch("/api/mobile/driver/trips");
    expect(res).toEqual({ ok: true });
    expect(refreshCalls).toBe(2);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("a second consecutive 429 surfaces honestly with the session intact", async () => {
    await seedSession("OLD-A", "KEEP-R");
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: "Too many requests. Try again later.", retry_after: 1 }),
        };
      }
      return jsonRes(401, { error: "Unauthorized" });
    });

    await expect(apiFetch("/api/mobile/driver/trips")).rejects.toMatchObject({ status: 429 });
    expect(onExpired).not.toHaveBeenCalled();
    expect(await getRefreshToken()).toBe("KEEP-R");
  });
});
