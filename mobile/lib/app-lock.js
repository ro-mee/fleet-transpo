/**
 * Application-lock policy for the FleetOps driver app.
 *
 * Deliberately dependency-free so the lock provider, the lock screen and the
 * tests all read the same numbers. Nothing else in the codebase may hold the
 * timeout — change it here.
 *
 * The window mirrors the web idle timeout (IDLE_TIMEOUT_SECONDS = 300 in
 * src/lib/auth/session-policy.js) so the two channels agree on what "idle"
 * means and cannot drift apart.
 *
 * This module is a UI gate only. It never touches tokens, the server session,
 * or biometric data; see biometric.js and AppLockProvider for those.
 */

/** How long the app may sit away from the foreground before the authenticated UI re-locks. */
export const APP_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * True when the app must re-lock after returning to the foreground.
 *
 * Fails CLOSED wherever the elapsed time cannot be established:
 *
 * - A backwards clock (elapsed < 0) locks. An attacker who takes an unlocked
 *   phone and winds the clock back could otherwise defeat the window outright,
 *   and the cost of being wrong in this direction is one biometric prompt.
 * - A non-finite `now` locks for the same reason.
 *
 * A null/absent `backgroundedAt` means the app never left the foreground this
 * session, so there is nothing to resume from — a cold start is NOT a resume and
 * is handled separately by the provider.
 *
 * @param {{ backgroundedAt: number|null, now: number, timeoutMs?: number }} args
 * @returns {boolean}
 */
export function shouldLockOnResume({ backgroundedAt, now, timeoutMs = APP_LOCK_TIMEOUT_MS }) {
  if (!Number.isFinite(backgroundedAt)) return false;
  if (!Number.isFinite(now)) return true;
  if (now < backgroundedAt) return true;
  return now - backgroundedAt >= timeoutMs;
}

/**
 * Folds one AppState transition into the "when did we leave the foreground"
 * timestamp.
 *
 * Two rules matter:
 *
 * 1. **Only a transition out of `active` stamps the clock.** Re-stamping while
 *    already away would let a stray `inactive` deep into a backgrounded period
 *    (the app switcher, a system dialog) silently extend the window — the
 *    bypass this lock exists to prevent.
 * 2. **`inactive` stamps too, not just `background`.** On iOS the app switcher
 *    peek is exactly when an attacker would look, so it must count as leaving.
 *
 * @param {{ previousState: string, nextState: string, backgroundedAt: number|null, now: number }} args
 * @returns {{ backgroundedAt: number|null, resumedFrom: number|null }}
 */
export function noteAppStateChange({ previousState, nextState, backgroundedAt, now }) {
  if (nextState === "active") {
    // Hand the stamp to the caller once, then clear it so a second `active`
    // event cannot re-evaluate the same window.
    return { backgroundedAt: null, resumedFrom: Number.isFinite(backgroundedAt) ? backgroundedAt : null };
  }
  if (previousState === "active") {
    return { backgroundedAt: now, resumedFrom: null };
  }
  return { backgroundedAt: Number.isFinite(backgroundedAt) ? backgroundedAt : null, resumedFrom: null };
}

/**
 * The lock state a cold start begins in.
 *
 * Biometric lock is OFF by default: a driver who has never opted in keeps the
 * app's existing behaviour exactly.
 *
 * @param {{ biometricEnabled: boolean }} args
 * @returns {boolean} whether the authenticated UI starts locked
 */
export function initialLocked({ biometricEnabled }) {
  return biometricEnabled === true;
}
