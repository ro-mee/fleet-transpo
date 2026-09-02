/**
 * Safe navigation utility to save and restore the user's location across session expiration.
 * Strictly enforces internal FleetOps relative paths to eliminate open-redirect vulnerabilities.
 */

const RETURN_TO_KEY = "fleetops_return_to";

/**
 * Validates that a path is a safe, internal, relative FleetOps route.
 * Rejects absolute URLs, protocol-relative URLs, schemes, control chars, and auth pages.
 */
export function isValidInternalPath(path) {
  if (!path || typeof path !== "string") return false;
  const trimmed = path.trim();

  // Must begin with a single slash, not followed by a second slash or backslash
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return false;
  }

  // Reject URL scheme indicators (e.g., http:, javascript:, data:)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return false;
  }

  // Reject control characters or whitespace injections
  if (/[\r\n\t\0]/.test(trimmed)) {
    return false;
  }

  // Never redirect back to public auth entrypoints
  const authPrefixes = ["/login", "/register", "/forgot-password", "/reset-password"];
  for (const authRoute of authPrefixes) {
    if (trimmed === authRoute || trimmed.startsWith(`${authRoute}?`) || trimmed.startsWith(`${authRoute}/`)) {
      return false;
    }
  }

  return true;
}

function getStorage() {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage;
  }
  if (typeof globalThis !== "undefined" && globalThis.sessionStorage) {
    return globalThis.sessionStorage;
  }
  return null;
}

/**
 * Saves current path to sessionStorage if it is a valid internal route.
 */
export function saveReturnTo(path = null) {
  const storage = getStorage();
  if (!storage) return;

  const target =
    path ||
    (typeof window !== "undefined"
      ? window.location.pathname + window.location.search
      : null);

  if (isValidInternalPath(target)) {
    try {
      storage.setItem(RETURN_TO_KEY, target);
    } catch {
      // Storage quota or privacy sandbox blocked
    }
  }
}

/**
 * Retrieves and clears the saved returnTo path, falling back to role dashboard.
 */
export function getAndClearReturnTo(role = null) {
  const defaultRoute = role === "driver" ? "/driver" : "/dashboard";
  const storage = getStorage();
  if (!storage) return defaultRoute;

  try {
    const saved = storage.getItem(RETURN_TO_KEY);
    storage.removeItem(RETURN_TO_KEY);
    if (isValidInternalPath(saved)) {
      return saved;
    }
  } catch {
    // Storage quota or privacy sandbox blocked
  }
  return defaultRoute;
}
