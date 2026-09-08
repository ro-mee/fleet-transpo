import { describe, it, expect } from "vitest";
import {
  createConnectivitySignal,
  recordTransportSuccess,
  recordTransportFailure,
  recentFailureCount,
  deriveStatus,
  isTransportFailure,
  shouldAutoRetry,
  UNSTABLE_FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
} from "./connectivity-state";

const T0 = 1_700_000_000_000;

function failTimes(signal, times, start = T0) {
  let s = signal;
  times.forEach((dt, i) => {
    s = recordTransportFailure(s, start + dt);
  });
  return s;
}

describe("failure evidence", () => {
  it("counts failures inside the window only", () => {
    let s = createConnectivitySignal();
    s = failTimes(s, [0, 10_000, 20_000]);
    expect(recentFailureCount(s, T0 + 30_000)).toBe(3);
    expect(recentFailureCount(s, T0 + FAILURE_WINDOW_MS + 25_000)).toBe(0);
  });

  it("one success decisively clears the window", () => {
    let s = failTimes(createConnectivitySignal(), [0, 10_000]);
    s = recordTransportSuccess(s, T0 + 20_000);
    expect(recentFailureCount(s, T0 + 20_000)).toBe(0);
    expect(s.lastSuccessAt).toBe(T0 + 20_000);
  });
});

describe("isTransportFailure", () => {
  it("flags timeouts, aborts, status 0, and network exceptions", () => {
    expect(isTransportFailure({ name: "AbortError" })).toBe(true);
    expect(isTransportFailure({ message: "Network request failed. Check your connection.", status: 0 })).toBe(true);
    expect(isTransportFailure(new TypeError("Network request failed"))).toBe(true);
    expect(isTransportFailure({ message: "timeout of 30000ms exceeded" })).toBe(true);
  });

  it("never flags HTTP statuses — 401/403/5xx are not connectivity", () => {
    for (const status of [400, 401, 403, 404, 409, 429, 500, 502]) {
      expect(isTransportFailure({ message: "Request failed", status })).toBe(false);
    }
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure(undefined)).toBe(false);
  });
});

describe("shouldAutoRetry", () => {
  it("retries transport blips, rotation 401s, 429 bursts, and transient 5xx", () => {
    expect(shouldAutoRetry(new TypeError("Network request failed"))).toBe(true);
    expect(shouldAutoRetry({ status: 401, message: "Unauthorized" })).toBe(true);
    expect(shouldAutoRetry({ status: 429, message: "Too many requests" })).toBe(true);
    expect(shouldAutoRetry({ status: 500, message: "Internal error" })).toBe(true);
    expect(shouldAutoRetry({ status: 503, message: "Cold start" })).toBe(true);
  });

  it("never retries deterministic client errors", () => {
    for (const status of [400, 403, 404, 409, 422]) {
      expect(shouldAutoRetry({ status, message: "nope" })).toBe(false);
    }
    expect(shouldAutoRetry(null)).toBe(false);
    expect(shouldAutoRetry(new Error("plain"))).toBe(false);
  });
});

describe("deriveStatus", () => {
  it("is online when healthy", () => {
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: true, signal: createConnectivitySignal(), now: T0 })
    ).toBe("online");
  });

  it("tolerates unknown reachability without forcing offline", () => {
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: null, signal: createConnectivitySignal(), now: T0 })
    ).toBe("online");
    expect(
      deriveStatus({ signal: createConnectivitySignal(), now: T0 })
    ).toBe("online");
  });

  it("goes unstable only at the threshold, not on isolated failures", () => {
    const two = failTimes(createConnectivitySignal(), [0, 10_000]);
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: true, signal: two, now: T0 + 20_000 })
    ).toBe("online");
    const three = recordTransportFailure(two, T0 + 20_000);
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: true, signal: three, now: T0 + 20_000 })
    ).toBe("unstable");
    expect(UNSTABLE_FAILURE_THRESHOLD).toBe(3);
  });

  it("goes offline without usable internet", () => {
    const sig = createConnectivitySignal();
    expect(deriveStatus({ isConnected: false, signal: sig, now: T0 })).toBe("offline");
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: false, signal: sig, now: T0 })
    ).toBe("offline");
  });

  it("prefers syncing while a drain is active with pending items", () => {
    const sig = createConnectivitySignal();
    expect(
      deriveStatus({ isConnected: false, signal: sig, syncActive: true, pendingCount: 3, now: T0 })
    ).toBe("syncing");
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: true, signal: sig, syncActive: true, pendingCount: 0, now: T0 })
    ).toBe("online");
  });

  it("old failures age out back to online", () => {
    const s = failTimes(createConnectivitySignal(), [0, 10_000, 20_000]);
    expect(
      deriveStatus({ isConnected: true, isInternetReachable: true, signal: s, now: T0 + FAILURE_WINDOW_MS + 30_000 })
    ).toBe("online");
  });
});
