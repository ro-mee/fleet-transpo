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
import { saveTokens, getRefreshToken } from "./storage";
import { __clear as clearSecureStore } from "expo-secure-store";

const jsonRes = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const onExpired = vi.fn();

beforeEach(() => {
  clearSecureStore();
  vi.clearAllMocks();
  onExpired.mockClear();
  setSessionExpiredHandler(onExpired);
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
