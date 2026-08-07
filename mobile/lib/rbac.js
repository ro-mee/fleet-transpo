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

/**
 * Driver feature flags. Every session in this app is a driver (enforced
 * server-side by requireDriver), so these are treated as always-on for driver
 * sessions; they exist to keep UI gating explicit rather than scattering
 * role checks across screens.
 */
export const ACTIONS = {
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
 * True when the signed-in session belongs to a driver.
 *
 * @param {Object|null} user
 * @returns {boolean}
 */
export function isDriverSession(user) {
  return Boolean(user?.role === ROLE.DRIVER);
}

/**
 * Action availability for the app. Every session here is a driver (the server
 * rejects anything else), so all driver actions are granted; the switch makes
 * this explicit and easy to narrow if a future role appears.
 *
 * @param {Object|null} user
 * @param {string} action  one of ACTIONS
 * @returns {boolean}
 */
export function canAction(user, action) {
  if (!isDriverSession(user)) return false;
  return [
    ACTIONS.MANAGE_TRIP,
    ACTIONS.REPORT_LOCATION,
    ACTIONS.REPORT_FUEL,
  ].includes(action);
}
