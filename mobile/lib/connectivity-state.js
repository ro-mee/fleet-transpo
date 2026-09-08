/**
 * Pure connectivity state — no imports, no clock reads, no network.
 *
 * The provider (lib/connectivity-context.js) owns NetInfo + API/sync events
 * and feeds this module; every decision below is a deterministic function of
 * its inputs, so the whole state machine is unit-testable.
 *
 * Evidence rules (locked):
 * - ONLINE: reachable + recent API calls succeeding.
 * - UNSTABLE: technically connected, but >= UNSTABLE_FAILURE_THRESHOLD
 *   transport failures inside FAILURE_WINDOW_MS. Never signal bars.
 * - OFFLINE: isConnected === false, or isInternetReachable === false.
 *   HTTP statuses NEVER decide this: 401/403 are auth problems, 5xx are
 *   backend problems — only transport failures (timeout, abort, status 0 /
 *   network exception) count, recorded by the api.js emitter.
 * - Recovery is decisive: one transport success clears the failure window.
 *   A single isolated failure (count 1 < threshold) never moves the banner.
 * - "syncing" outranks everything while a drain is active with pending items.
 *   "Back online" / "All updates synced" are UI transients owned by the
 *   provider, not derived here: internet returning and the queue actually
 *   draining are two different states.
 */

export const FAILURE_WINDOW_MS = 60 * 1000;
export const UNSTABLE_FAILURE_THRESHOLD = 3;

/**
 * Transport-failure classifier (shared with mobile/lib/api.js, which
 * re-exports it for screens).
 *
 * true = timeout/abort (fetch timeout), status 0, or a network exception.
 * HTTP statuses are NEVER transport failures: 401/403 are auth/permission
 * problems, 4xx/5xx are client/backend problems. Screens use this to decide
 * whether an inline error surface should stay silent because the global
 * connectivity banner already speaks for the failure.
 */
export function isTransportFailure(error) {
  if (error == null) return false;
  if (error?.name === "AbortError") return true;
  const status = error?.status;
  if (status !== undefined && status !== null) return status === 0;
  const message = String(error?.message || "");
  return /network request failed|failed to fetch|fetch failed|timeout|timed out|aborted|econn|enotfound|etimedout|eai_again|unreachable|not connected|no internet|offline/i.test(message);
}

/** Delay before an automatic list retry (Home/Trips cold-start tolerance). */
export const LIST_AUTO_RETRY_MS = 1500;

/**
 * Whether a failed idempotent list load deserves one automatic retry before
 * showing an error: transport blips, a 401 that lands mid-rotation, 429
 * bursts, and transient 5xx. Never 400/403/404 — retrying those is pointless
 * and could mask real problems.
 */
export function shouldAutoRetry(error) {
  if (isTransportFailure(error)) return true;
  const status = Number(error?.status);
  if (!Number.isFinite(status)) return false;
  return status === 401 || status === 429 || (status >= 500 && status <= 599);
}

export function createConnectivitySignal() {
  return { failures: [], lastSuccessAt: null, lastFailureAt: null };
}

export function pruneFailures(failures, now = Date.now()) {
  if (!Array.isArray(failures)) return [];
  return failures.filter((t) => Number.isFinite(t) && now - t < FAILURE_WINDOW_MS);
}

/** A transport success clears the failure window — decisive recovery. */
export function recordTransportSuccess(signal, now = Date.now()) {
  const prev = signal || createConnectivitySignal();
  return { failures: [], lastSuccessAt: now, lastFailureAt: prev.lastFailureAt };
}

/** A transport failure appends one timestamped evidence point. */
export function recordTransportFailure(signal, now = Date.now()) {
  const prev = signal || createConnectivitySignal();
  return {
    ...prev,
    failures: [...pruneFailures(prev.failures, now), now],
    lastFailureAt: now,
  };
}

export function recentFailureCount(signal, now = Date.now()) {
  return pruneFailures(signal?.failures, now).length;
}

/**
 * @param {object} p
 * @param {boolean|null|undefined} p.isConnected NetInfo (null/undefined = unknown, never forces offline)
 * @param {boolean|null|undefined} p.isInternetReachable NetInfo (null = unknown)
 * @param {object} p.signal connectivity signal (failures, timestamps)
 * @param {boolean} p.syncActive a queue drain is in flight
 * @param {number} p.pendingCount queued actions awaiting the server
 * @returns {"online"|"unstable"|"offline"|"syncing"}
 */
export function deriveStatus({
  isConnected,
  isInternetReachable,
  signal,
  syncActive = false,
  pendingCount = 0,
  now = Date.now(),
} = {}) {
  if (syncActive && Number(pendingCount) > 0) return "syncing";
  if (isConnected === false) return "offline";
  if (isInternetReachable === false) return "offline";
  if (recentFailureCount(signal, now) >= UNSTABLE_FAILURE_THRESHOLD) return "unstable";
  return "online";
}
