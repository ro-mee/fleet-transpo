import {
  getAccessToken,
  getRefreshToken,
  saveTokens,
  clearAll,
} from "./storage";

const BASE_URL = process.env.EXPO_PUBLIC_API_URL;

if (!BASE_URL) {
  console.warn(
    "EXPO_PUBLIC_API_URL is not set. Copy .env.example to .env and point it at your dev machine's LAN IP."
  );
}

const TIMEOUT_MS = 15000;
const MAX_RETRIES = 1;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
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

async function refreshAccessToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      await clearAll();
      onSessionExpired();
      throw new ApiError("No refresh token", 401);
    }

    const res = await fetchWithTimeout(`${BASE_URL}/api/mobile/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    if (!res.ok) {
      await clearAll();
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
  const { skipAuth = false, ...init } = options;

  let token = skipAuth ? null : await getAccessToken();

  const send = async (t) => {
    const headers = {
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
    // Network / timeout failure. Retry once — a transient Wi-Fi blip or a
    // slow cold start should not fail the whole request immediately.
    if (!skipAuth && MAX_RETRIES > 0) {
      res = await send(token).catch((retryErr) => {
        throw new ApiError("Network request failed. Check your connection.", 0);
      });
    } else {
      throw new ApiError("Network request failed. Check your connection.", 0);
    }
  }

  if (res.status === 401 && !skipAuth) {
    // Access token expired mid-session; refresh once and replay the request.
    const fresh = await refreshAccessToken();
    res = await send(fresh);
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

  return body;
}

export const api = {
  get: (path) => apiFetch(path),
  post: (path, body, opts) =>
    apiFetch(path, { method: "POST", body: JSON.stringify(body), ...opts }),
  put: (path, body) =>
    apiFetch(path, { method: "PUT", body: JSON.stringify(body) }),
};
