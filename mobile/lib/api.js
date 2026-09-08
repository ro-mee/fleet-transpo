import {
  getAccessToken,
  getRefreshToken,
  getUser,
  saveTokens,
  clearAll,
} from "./storage";
import { clearOfflineCache, resolveDriverId } from "./offline-cache";
import { enqueueRequest, syncQueue, setApiFetch } from "./sync";
import { isTransportFailure } from "./connectivity-state";

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
  constructor(message, status) {
    super(message);
    this.status = status;
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
async function fetchWithTimeout(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
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
async function clearSession() {
  try {
    const stored = await getUser();
    await clearOfflineCache(resolveDriverId(stored));
  } catch {
    // Cache wipe is best-effort; auth cleanup below must still run.
  }
  await clearAll();
}

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      await clearSession();
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
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit());
    } catch (firstErr) {
      // Flaky reconnect: the packet carrying a successful rotation may be
      // lost in flight. Retry ONCE before concluding anything — the server
      // tolerates a repeated refresh inside its 1-minute grace window, while
      // a transport failure here must never look like a revoked session. If
      // the retry also fails to reach the server, it propagates as a plain
      // network error: no clearAll, no logout.
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit());
    }

    if (res.status === 429) {
      // Rate-limited is transient, not dead: wait once per the server's hint,
      // then try once more — silently. The cooldown/rate-limit 429 exists to
      // serialize concurrent refreshers; surfacing it would punish the driver
      // for a race they never started. Only a second consecutive 429 (genuine
      // throttling) reaches the caller, still with the session intact.
      let waitMs = 3000;
      try {
        const hint = await res.json();
        const secs = Number(hint?.retry_after);
        if (Number.isFinite(secs) && secs > 0) waitMs = Math.min(secs, 10) * 1000;
      } catch {
        // Keep the default wait.
      }
      await new Promise((r) => setTimeout(r, waitMs));
      // A transport failure here propagates as a plain network error below
      // (no clearSession, no logout) via the caller's normal handling.
      res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, refreshInit());
      if (res.status === 429) {
        throw new ApiError("Too many requests. Try again later.", 429);
      }
    }

    if (!res.ok) {
      await clearSession();
      onSessionExpired();
      throw new ApiError("Session expired", 401);
    }

    const data = await res.json();
    await saveTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    });
    return data.accessToken;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

/**
 * fetch wrapper that attaches the bearer token and transparently retries once
 * after refreshing on a 401. Network failures are retried once; a hung request
 * is bounded by fetchWithTimeout.
 */
export async function apiFetch(path, options = {}) {
  const { skipAuth = false, queueOnFailure = true, ...init } = options;

  let token = skipAuth ? null : await getAccessToken();

  const send = async (t) => {
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
    return fetchWithTimeout(`${BASE_URL}${path}`, { ...init, headers });
  };

  let res;
  try {
    res = await send(token);
  } catch (e) {
    // First-attempt transport failure is connectivity evidence even when the
    // retry below succeeds (repeated retry-then-success IS instability). A
    // final success clears the window decisively, so one blip never sticks.
    if (isTransportFailure(e)) emitApiEvent({ type: "transport-failure" });
    // Network / timeout failure. Retry once — a transient Wi-Fi blip or a
    // slow cold start should not fail the whole request immediately.
    const handleNetworkFailure = async () => {
      if (init.body instanceof FormData) {
        throw new ApiError("Network request failed. Receipt upload was not queued; retry when online.", 0);
      }
      if (!queueOnFailure) {
        throw new ApiError("Network request failed. The queued request will be retried later.", 0);
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
      let fresh;
      try {
        fresh = await refreshAccessToken();
      } catch (refreshErr) {
        if (isTransportFailure(refreshErr)) emitApiEvent({ type: "transport-failure" });
        throw refreshErr;
      }
      try {
        return await send(fresh);
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

  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, res.status);
  }

  // If we get here, the request was successful, so we can try to drain the queue in the background
  if (init.method && ['POST', 'PUT', 'DELETE'].includes(init.method.toUpperCase())) {
    syncQueue().catch(() => {});
  } else {
    // For GETs, also trigger a sync to ensure everything is caught up if the network is back
    syncQueue().catch(() => {});
  }

  emitApiEvent({ type: "success" });
  return body;
}

// Break the circular dependency: inject apiFetch into sync.js now that it is
// fully defined. sync.js must NOT import api.js directly.
setApiFetch(apiFetch);


export const api = {
  get: (path) => apiFetch(path),
  post: (path, body, opts) =>
    apiFetch(path, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
  put: (path, body, opts) =>
    apiFetch(path, { method: "PUT", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
  del: (path, body, opts) =>
    apiFetch(path, { method: "DELETE", body: body instanceof FormData ? body : JSON.stringify(body), ...opts }),
};
