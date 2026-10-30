import {
  getAccessToken,
  getRefreshToken,
  getUser,
  saveTokens,
  clearAll,
} from "./storage";
import { clearOfflineCache, resolveDriverId } from "./offline-cache";
import { enqueueRequest, syncQueue, setApiFetch, hasPendingWork } from "./sync";
import { isTransportFailure } from "./connectivity-state";
import { captureCargoSession, captureCurrentCargoSession, isCurrentCargoSession, canRefreshCargoSession, getCargoActorSignal, isCurrentCargoActor } from "./cargo-sync";

// Re-exported so screens share the one classification: transport failures
// belong to the global connectivity banner, never to inline error surfaces.
export { isTransportFailure };

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!BASE_URL) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and point it at your dev machine's LAN IP."
  );
}

// Mobile networks are slow and the serverless backend cold-starts; a login is
// bcrypt + several sequential DB round-trips and can take 10s+ on a cold
// function. Android can also burn ~10s trying a dead IPv6 route before
// falling back to IPv4. 15s aborted healthy-but-slow requests in the field;
// 30s with one retry covers both cases.
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 1;

export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.status = status;
    // The server's machine-readable rejection reason (AuthError.code in
    // src/lib/api/utils.js). Screens branch on THIS, never on the message:
    // PRESHIFT_REQUIRED has to route the driver to the Pre-Shift check, and
    // matching prose would break silently the moment anyone rewords the copy.
    // Null for every status that carries no code — a plain 500, a transport
    // failure — so callers cannot mistake "no code" for a coded rejection.
    this.code = code;
  }
}

// ── Connectivity events (PR #3.1) ──────────────────────────────────────────
// A tiny emitter so the connectivity layer can observe real API outcomes
// without touching any screen. Classification is locked:
//
// - transport failure = timeout/abort (fetchWithTimeout), status 0, or a
//   network exception. ONLY these feed offline/unstable derivation.
// - 401/403 (auth/permission) and 5xx/429 (backend) are HTTP statuses with a
//   non-zero status and NEVER count as connectivity failures.
//
// Nothing here changes bearer/refresh/401/FormData/timeout/retry semantics;
// every emit site is fire-and-forget beside the existing control flow.
const apiEventListeners = new Set();

export function subscribeApiEvents(fn) {
  apiEventListeners.add(fn);
  return () => {
    apiEventListeners.delete(fn);
  };
}

function emitApiEvent(event) {
  apiEventListeners.forEach((l) => {
    try {
      l(event);
    } catch {
      // A listener must never break a request.
    }
  });
}

/** Shared helper for "Saved for sync" wording: { queued: true } means the
 *  server has NOT confirmed the action — never render success copy for it. */
export function wasQueued(result) {
  return result?.queued === true;
}

/**
 * Called when the refresh token is itself rejected — the session is
 * unrecoverable and the app must return to the login screen. The root layout
 * registers the handler so this module doesn't need to import the router.
 */
let onSessionExpired = () => {};
export function setSessionExpiredHandler(fn) {
  onSessionExpired = fn;
}

/**
 * fetch with an abort timeout so a hung request surfaces as a clear error
 * instead of an infinite spinner.
 */
async function fetchWithTimeout(url, init, externalSignals = []) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const signals = [init.signal, ...externalSignals].filter(Boolean);
  const abortFromCaller = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", abortFromCaller, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    for (const signal of signals) signal.removeEventListener("abort", abortFromCaller);
  }
}

/**
 * A single in-flight refresh shared by every concurrent 401.
 *
 * Without this, a screen firing three requests at once on a stale token would
 * run three refreshes; because refresh is single-use and rotating, the first
 * would succeed and the other two would present an already-revoked token and
 * log the driver out.
 */
let refreshPromise = null;

/**
 * Session death cleanup: wipe the signed-in driver's offline read cache
 * BEFORE deleting auth storage (the stored user holds the driverId we
 * namespace the cache by). One-directional import only — offline-cache.js
 * touches AsyncStorage alone, so this introduces no cycle.
 */
async function clearSession(session = null) {
  const isCurrent = () => isCurrentCargoSession(session);
  if (!isCurrent()) return;
  try {
    const stored = await getUser();
    if (!isCurrent()) return;
    await clearOfflineCache(resolveDriverId(stored));
  } catch {
    // Cache wipe is best-effort; auth cleanup below must still run.
  }
  if (!isCurrent()) return;
  await clearAll(isCurrent);
}

async function refreshAccessToken(session = null) {
  const isCurrent = () => isCurrentCargoSession(session);
  const assertCurrent = () => {
    if (!isCurrent()) throw new ApiError("Cargo refresh cancelled because the signed-in account changed.", 0, "CARGO_SYNC_CANCELLED");
  };
  const assertRefreshable = () => {
    assertCurrent();
    if (!canRefreshCargoSession(session)) {
      throw new ApiError("Session refresh cancelled while sign-in is changing accounts.", 0, "CARGO_SYNC_CANCELLED");
    }
  };
  const key = `${session.phase}:${session.actorId ?? "anonymous"}:${session.generation}`;
  if (refreshPromise?.key === key) return refreshPromise.promise;

  const promise = (async () => {
    assertRefreshable();
    const refreshToken = await getRefreshToken();
    assertRefreshable();
    if (!refreshToken) {
      await clearSession(session);
      assertCurrent();
      onSessionExpired();
      throw new ApiError("No refresh token", 401);
    }

    const refreshBody = JSON.stringify({ refreshToken });
    const refreshInit = () => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: refreshBody,
    });
    let res;
    try {
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit(), [session.signal]);
      assertRefreshable();
    } catch (firstErr) {
      assertRefreshable();
      // Flaky reconnect: the packet carrying a successful rotation may be
      // lost in flight. Retry ONCE before concluding anything — the server
      // tolerates a repeated refresh inside its 1-minute grace window, while
      // a transport failure here must never look like a revoked session. If
      // the retry also fails to reach the server, it propagates as a plain
      // network error: no clearAll, no logout.
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit(), [session.signal]);
      assertRefreshable();
    }

    if (res.status === 429) {
      // Rate-limited is transient, not dead: wait once per the server's hint,
      // then try once more — silently. The cooldown/rate-limit 429 exists to
      // serialize concurrent refreshers; surfacing it would punish the driver
      // for a race they never started. Only a second consecutive 429 (genuine
      // throttling) reaches the caller, still with the session intact.
      let waitMs = 3000;
      let hint;
      try {
        hint = await res.json();
      } catch {
        // Keep the default wait.
      }
      assertRefreshable();
      try {
        const secs = Number(hint?.retry_after);
        if (Number.isFinite(secs) && secs > 0) waitMs = Math.min(secs, 10) * 1000;
      } catch {
        // Keep the default wait for malformed retry hints.
      }
      await new Promise((r) => setTimeout(r, waitMs));
      assertRefreshable();
      // A transport failure here propagates as a plain network error below
      // (no clearSession, no logout) via the caller's normal handling.
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit(), [session.signal]);
      assertRefreshable();
      if (res.status === 429) {
        throw new ApiError("Too many requests. Try again later.", 429);
      }
    }

    if (!res.ok) {
      await clearSession(session);
      assertCurrent();
      onSessionExpired();
      throw new ApiError("Session expired", 401);
    }

    const data = await res.json();
    assertRefreshable();
    const saved = await saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    }, isCurrent);
    assertRefreshable();
    if (!saved) assertRefreshable();
    return data.accessToken;
  })();
  refreshPromise = { key, promise };

  try {
    return await promise;
  } finally {
    if (refreshPromise?.promise === promise) refreshPromise = null;
  }
}

/**
 * fetch wrapper that attaches the bearer token and transparently retries once
 * after refreshing on a 401. Network failures are retried once; a hung request
 * is bounded by fetchWithTimeout.
 */
export async function apiFetch(path, options = {}) {
  const { skipAuth = false, queueOnFailure = true, skipQueueDrain = false, cargoActorId = null, ...init } = options;
  const assertCargoActor = () => {
    if (cargoActorId != null && !isCurrentCargoActor(cargoActorId)) {
      throw new ApiError("Cargo request cancelled because the signed-in account changed.", 0, "CARGO_SYNC_CANCELLED");
    }
  };

  assertCargoActor();
  let token = skipAuth ? null : await getAccessToken();
  assertCargoActor();

  const send = async (t) => {
    assertCargoActor();
    const headers = {
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      ...(init.headers || {}),
    };
    if (!(init.body instanceof FormData) && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (t) headers.Authorization = `Bearer ${t}`;
    const actorSignal = cargoActorId == null ? null : getCargoActorSignal(cargoActorId);
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, { ...init, headers }, [actorSignal]);
    assertCargoActor();
    return response;
  };

  let res;
  try {
    res = await send(token);
  } catch (e) {
    assertCargoActor();
    // First-attempt transport failure is connectivity evidence even when the
    // retry below succeeds (repeated retry-then-success IS instability). A
    // final success clears the window decisively, so one blip never sticks.
    if (isTransportFailure(e)) emitApiEvent({ type: "transport-failure" });
    // Network / timeout failure. Retry once — a transient Wi-Fi blip or a
    // slow cold start should not fail the whole request immediately.
    const handleNetworkFailure = async () => {
      if (init.body instanceof FormData) {
        throw new ApiError("Network request failed. Upload was not queued; retry when online.", 0);
      }
      if (!queueOnFailure) {
        throw new ApiError("Network request failed. Nothing was queued; retry when online.", 0);
      }
      const method = init.method || 'GET';
      // Auth requests are interactive: replaying a queued login minutes later
      // is never what the user wanted (and hammers the rate limiter).
      if (path.startsWith('/api/mobile/auth/')) {
        throw new ApiError("Network request failed. Check your connection.", 0);
      }
      if (['POST', 'PUT', 'DELETE'].includes(method.toUpperCase())) {
        let parsedBody = undefined;
        try {
          if (typeof init.body === 'string') parsedBody = JSON.parse(init.body);
          else parsedBody = init.body;
        } catch(err) {}
        
        await enqueueRequest(method, path, parsedBody);
        emitApiEvent({ type: "queued" });
        return { queued: true }; // Dummy successful response for offline actions
      }
      throw new ApiError("Network request failed. Check your connection.", 0);
    };

    if (MAX_RETRIES > 0) {
      // Login included: a cold serverless start or a dead IPv6 route is a
      // transient failure, and one retry (max 2 rate-limit hits per tap, under
      // the 5/min cap) converts it into a slow-but-successful login.
      try {
        res = await send(token);
      } catch (retryErr) {
        assertCargoActor();
        if (isTransportFailure(retryErr)) emitApiEvent({ type: "transport-failure" });
        return await handleNetworkFailure();
      }
    } else {
      return await handleNetworkFailure();
    }
  }

  if (res.status === 401 && !skipAuth) {
    // Access token expired mid-session; refresh once and replay the request.
    const doRefreshReplay = async () => {
      assertCargoActor();
      let fresh;
      try {
        const session = cargoActorId == null ? captureCurrentCargoSession() : captureCargoSession(cargoActorId);
        fresh = await refreshAccessToken(session);
      } catch (refreshErr) {
        assertCargoActor();
        if (isTransportFailure(refreshErr)) emitApiEvent({ type: "transport-failure" });
        throw refreshErr;
      }
      try {
        const response = await send(fresh);
        assertCargoActor();
        return response;
      } catch (sendErr) {
        if (isTransportFailure(sendErr)) emitApiEvent({ type: "transport-failure" });
        throw sendErr;
      }
    };
    res = await doRefreshReplay();
    if (res.status === 401) {
      // Rotation race second chance: the replay may have carried a token the
      // server had just rotated under a concurrent refresh. One more
      // refresh+replay with the newest stored token before surfacing a 401
      // the driver would read as a dead session.
      res = await doRefreshReplay();
    }
  }

  if (res.status === 204) return null;

  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response (HTML error page, empty body).
  }
  assertCargoActor();

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status, body?.code ?? null);
  }

  // Drain the outbox only when something is waiting. The old code hit
  // AsyncStorage (read + JSON.parse) after EVERY success — both branches of
  // the if/else were identical — for a queue that is empty almost always.
  // hasPendingWork() fails open while the count is unknown, so the first
  // success after cold start still drains and converges the mirror.
  if (!skipQueueDrain && hasPendingWork()) {
    syncQueue().catch(() => {});
  }

  emitApiEvent({ type: "success" });
  const completedTrip = options.method === 'PUT' && /^\/api\/trips\/(\d+)\/complete$/.exec(path);
  if (completedTrip) emitApiEvent({ type: 'trip-completed', tripId: completedTrip[1] });
  const cancelledTrip = options.method === 'PUT' && body?.trip_status === 'Cancelled' && /^\/api\/trips\/(\d+)(?:\/cancel|\/accept)?$/.exec(path);
  if (cancelledTrip) emitApiEvent({ type: 'trip-cancelled', tripId: cancelledTrip[1] });
  return body;
}

// Break the circular dependency: inject apiFetch into sync.js now that it is
// fully defined. sync.js must NOT import api.js directly.
setApiFetch(apiFetch);


export const api = {
  get: (path, opts) => apiFetch(path, opts),
  post: (path, body, opts) =>
    apiFetch(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
  put: (path, body, opts) =>
    apiFetch(path, { method: "PUT", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
  del: (path, body, opts) =>
    apiFetch(path, { method: "DELETE", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
};
