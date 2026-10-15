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

import { apiFetch, setSessionExpiredHandler, subscribeApiEvents } from "./api";
import { saveTokens, getAccessToken, getRefreshToken, getUser, clearAll } from "./storage";
import { completeSignIn, getRestorableSignedInUser, persistSignedInSession } from "./auth-session";
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
  it('emits local cancellation only after its server-confirmed response', async () => {
    await seedSession();
    const events = [], unsubscribe = subscribeApiEvents(event => events.push(event));
    try {
      global.fetch.mockResolvedValueOnce(jsonRes(200, { trip_status: 'Cancelled' }));
      await apiFetch('/api/trips/7/cancel', { method: 'PUT', body: '{}', queueOnFailure: false });
      expect(events.filter(event => event.type === 'trip-cancelled')).toEqual([{ type: 'trip-cancelled', tripId: '7' }]);
      events.length = 0;
      global.fetch.mockResolvedValueOnce(jsonRes(409, { error: 'Refused' }));
      await expect(apiFetch('/api/trips/7/cancel', { method: 'PUT', body: '{}', queueOnFailure: false })).rejects.toMatchObject({ status: 409 });
      expect(events.some(event => event.type === 'trip-cancelled')).toBe(false);
      global.fetch.mockRejectedValue(new TypeError('Network request failed'));
      await apiFetch('/api/trips/7/cancel', { method: 'PUT', body: '{}' });
      expect(events.some(event => event.type === 'trip-cancelled')).toBe(false);
    } finally { unsubscribe(); }
  });
  it('notifies a hidden Map only after server-confirmed completion, never queued or refused writes', async () => {
    await seedSession();
    const events = [];
    const unsubscribe = subscribeApiEvents(event => events.push(event));
    try {
      global.fetch.mockResolvedValueOnce(jsonRes(200, { trip_status: 'Completed' }));
      await apiFetch('/api/trips/7/complete', { method: 'PUT', body: '{}', queueOnFailure: false });
      expect(events.filter(event => event.type === 'trip-completed')).toEqual([{ type: 'trip-completed', tripId: '7' }]);
      events.length = 0;
      global.fetch.mockResolvedValueOnce(jsonRes(409, { error: 'Receiver required' }));
      await expect(apiFetch('/api/trips/7/complete', { method: 'PUT', body: '{}', queueOnFailure: false })).rejects.toMatchObject({ status: 409 });
      expect(events.some(event => event.type === 'trip-completed')).toBe(false);
      global.fetch.mockRejectedValue(new TypeError('Network request failed'));
      await apiFetch('/api/trips/7/complete', { method: 'PUT', body: '{}' });
      expect(events.some(event => event.type === 'trip-completed')).toBe(false);
    } finally { unsubscribe(); }
  });
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
  it("reports failed cleanup after deleting the other stored session records", async () => {
    await persistSignedInSession({
      accessToken: "A-access",
      refreshToken: "A-refresh",
      driver: { employeeId: "employee-A", id: "driver-A" },
    });
    const originalDelete = SecureStore.deleteItemAsync.getMockImplementation();
    const cleanupError = new Error("secure cleanup unavailable");
    SecureStore.deleteItemAsync.mockImplementation(async (key) => {
      if (key === "fleetops_access_token") throw cleanupError;
      return originalDelete(key);
    });
    try {
      await expect(clearAll()).rejects.toBe(cleanupError);
      expect(await getRefreshToken()).toBeNull();
      expect(await getUser()).toBeNull();
      expect(await getRestorableSignedInUser()).toBeNull();
    } finally {
      SecureStore.deleteItemAsync.mockImplementation(originalDelete);
    }
  });

  it.each(["fleetops_refresh_token", "fleetops_user"])(
    "holds a retry behind failed cleanup until the pending %s deletion settles",
    async (pausedKey) => {
      await persistSignedInSession({
        accessToken: "A-access",
        refreshToken: "A-refresh",
        driver: { employeeId: "employee-A", id: "driver-A" },
      });
      let releaseDelete;
      let startedDelete;
      const deleteStarted = new Promise((resolve) => { startedDelete = resolve; });
      const deleteGate = new Promise((resolve) => { releaseDelete = resolve; });
      const originalSet = SecureStore.setItemAsync.getMockImplementation();
      const originalDelete = SecureStore.deleteItemAsync.getMockImplementation();
      const persistenceError = new Error("secure storage unavailable");
      let retryTokenWriteStarted = false;
      let failedAttemptSettled = false;
      let retrySettled = false;
      let uiUser;
      const setUser = (value) => { uiUser = value; };
      SecureStore.setItemAsync.mockImplementation(async (key, value) => {
        if (key === "fleetops_access_token" && value === "failed-access") throw persistenceError;
        if (value === "B-access" || value === "B-refresh") retryTokenWriteStarted = true;
        return originalSet(key, value);
      });
      SecureStore.deleteItemAsync.mockImplementation(async (key) => {
        if (key === "fleetops_access_token") throw new Error("secure cleanup unavailable");
        if (key === pausedKey) {
          startedDelete();
          await deleteGate;
        }
        return originalDelete(key);
      });
      const failedAttempt = completeSignIn({
        accessToken: "failed-access",
        refreshToken: "failed-refresh",
        driver: { employeeId: "employee-B", id: "driver-B" },
      }, setUser).catch((error) => {
        failedAttemptSettled = true;
        return error;
      });
      let retry;
      let whileDeletePending;
      let firstError;
      try {
        await deleteStarted;
        retry = completeSignIn({
          accessToken: "B-access",
          refreshToken: "B-refresh",
          driver: { employeeId: "employee-B", id: "driver-B" },
        }, setUser).then((user) => {
          retrySettled = true;
          return user;
        });
        // Drain runnable promise callbacks without releasing the native delete.
        await new Promise((resolve) => setImmediate(resolve));
        whileDeletePending = { failedAttemptSettled, retryTokenWriteStarted, retrySettled };
      } finally {
        releaseDelete();
        [firstError] = await Promise.all([failedAttempt, retry]);
        SecureStore.setItemAsync.mockImplementation(originalSet);
        SecureStore.deleteItemAsync.mockImplementation(originalDelete);
      }

      expect(whileDeletePending).toEqual({
        failedAttemptSettled: false, retryTokenWriteStarted: false, retrySettled: false,
      });
      expect(firstError).toBe(persistenceError);
      // Compare booleans so a regression cannot print fixture credentials.
      expect((await getAccessToken()) === "B-access").toBe(true);
      expect((await getRefreshToken()) === "B-refresh").toBe(true);
      expect(await getUser()).toMatchObject({ employeeId: "employee-B", id: "driver-B" });
      expect(await getRestorableSignedInUser()).toEqual(uiUser);
      expect(isCurrentCargoActor("employee-B")).toBe(true);
    },
  );

  it.each(["transition", "signed_out"])(
    "blocks cold restore of complete leftover credentials with a %s marker",
    async (state) => {
      const user = await persistSignedInSession({
        accessToken: "A-access",
        refreshToken: "A-refresh",
        driver: { employeeId: "employee-A", id: "driver-A" },
      });
      expect(await getRestorableSignedInUser()).toEqual(user);
      // Simulate a process stopping after the marker but before any cleanup.
      await SecureStore.setItemAsync("fleetops_session_state", state);
      setCargoSessionActor(null);

      expect((await getAccessToken()) === "A-access").toBe(true);
      expect((await getRefreshToken()) === "A-refresh").toBe(true);
      expect(await getUser()).toEqual(user);
      expect(await getRestorableSignedInUser()).toBeNull();
    },
  );

  it("does not let a generic 401 refresh during a pending sign-in token write", async () => {
    await seedSession("A-access", "A-refresh");
    setCargoSessionActor("employee-A");
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
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url, init) => {
      if (String(url).includes("/api/mobile/auth/refresh")) {
        refreshCalls += 1;
        return jsonRes(200, { accessToken: "late-access", refreshToken: "late-refresh" });
      }
      if (init?.headers?.Authorization === "Bearer late-access") return jsonRes(200, { ok: true });
      return jsonRes(401, { error: "Unauthorized" });
    });

    const signIn = persistSignedInSession({
      accessToken: "B-access",
      refreshToken: "B-refresh",
      driver: { employeeId: "employee-B", id: "driver-B" },
    });
    await bWriteStarted;
    const generic = apiFetch("/api/driver/me");
    await expect(generic).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(refreshCalls).toBe(0);
    releaseBWrite();
    await signIn;
    SecureStore.setItemAsync.mockImplementation(originalSet);

    expect(await getRefreshToken()).toBe("B-refresh");
  });

  it.each([
    ["success", jsonRes(200, { accessToken: "late-access", refreshToken: "late-refresh" })],
    ["rejection", jsonRes(401, { error: "Session expired" })],
  ])("ignores a generic refresh %s that finishes after B signs in", async (_label, refreshResult) => {
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
    const pending = apiFetch("/api/driver/me");
    await vi.waitFor(() => expect(releaseRefresh).toBeDefined());

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
    expect(refreshSignal.aborted).toBe(true);
    releaseBWrite();
    await signIn;
    SecureStore.setItemAsync.mockImplementation(originalSet);
    releaseRefresh(refreshResult);

    await expect(pending).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(await getRefreshToken()).toBe("B-refresh");
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("fails sign-in closed when SecureStore rejects replacement credentials", async () => {
    await seedSession("A-access", "A-refresh");
    setCargoSessionActor("employee-A");
    let uiUser = { employeeId: "employee-A" };
    const setUser = vi.fn((value) => { uiUser = value; });
    const originalSet = SecureStore.setItemAsync.getMockImplementation();
    const originalDelete = SecureStore.deleteItemAsync.getMockImplementation();
    SecureStore.setItemAsync.mockImplementation(async (key, value) => {
      if (key === "fleetops_access_token" && value === "B-access") throw new Error("secure storage unavailable");
      return originalSet(key, value);
    });
    SecureStore.deleteItemAsync.mockImplementation(async (key) => {
      if (key === "fleetops_access_token") throw new Error("secure cleanup unavailable");
      return originalDelete(key);
    });

    await expect(completeSignIn({
      accessToken: "B-access",
      refreshToken: "B-refresh",
      driver: { employeeId: "employee-B", id: "driver-B" },
    }, setUser)).rejects.toThrow("secure storage unavailable");
    SecureStore.setItemAsync.mockImplementation(originalSet);
    SecureStore.deleteItemAsync.mockImplementation(originalDelete);

    expect(setUser).toHaveBeenLastCalledWith(null);
    expect(uiUser).toBeNull();
    expect(isCurrentCargoActor("employee-A")).toBe(false);
    expect(isCurrentCargoActor("employee-B")).toBe(false);
    expect(await getRestorableSignedInUser()).toBeNull();
    let refreshCalls = 0;
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes("/api/mobile/auth/refresh")) refreshCalls += 1;
      return jsonRes(401, { error: "Unauthorized" });
    });
    await expect(apiFetch("/api/driver/me")).rejects.toMatchObject({ code: "CARGO_SYNC_CANCELLED" });
    expect(refreshCalls).toBe(0);
  });

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
