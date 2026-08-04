/**
 * Role-aware helpers for the driver app.
 *
 * Role always comes from the server: the JWT the mobile login endpoint mints
 * carries a `role` claim (src/lib/auth/mobile-token.js), so the client decodes
 * it rather than trusting a client-supplied value. The server remains the
 * enforcement authority on every request; these helpers only gate the UI.
 */

export const ROLE = {
  DRIVER: "driver",
};

export const ACTIONS = {
  READ_TRIPS: "read_trips",
  MANAGE_TRIP: "manage_trip",
  REPORT_LOCATION: "report_location",
  REPORT_FUEL: "report_fuel",
};

/**
 * Decodes the payload of a JWT access token. Base64url only — signature
 * verification stays server-side, so this is for reading claims, not trusting
 * them.
 *
 * @param {string} token
 * @returns {Object|null} decoded claims, or null if the token is not a JWT
 */
export function decodeJwtRole(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const json = globalThis.atob ? atob(padded) : Buffer.from(padded, "base64").toString("utf8");
    const claims = JSON.parse(json);
    return claims && typeof claims.role === "string" ? claims.role : null;
  } catch {
    return null;
  }
}

/**
 * True when the signed-in session belongs to a driver. The demo driver signs
 * in without a real token, so it is identified by flag instead of a JWT claim.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
export function isDriverSession(user) {
  return Boolean(user?.role === ROLE.DRIVER || user?.isDemoDriver);
}

/**
 * Action matrix for the app. Mirrors the driver column in docs/rbac-model.md;
 * every session in this app is a driver, so the matrix is the driver row and
 * everything else is denied. Kept as an explicit matrix so UI gating stays in
 * one place and future roles are added here, never scattered across screens.
 *
 * @param {Object|null} user
 * @param {string} action  one of ACTIONS
 * @returns {boolean}
 */
export function canAction(user, action) {
  if (!isDriverSession(user)) return false;
  return [ACTIONS.READ_TRIPS, ACTIONS.MANAGE_TRIP, ACTIONS.REPORT_LOCATION, ACTIONS.REPORT_FUEL].includes(
    action
  );
}
