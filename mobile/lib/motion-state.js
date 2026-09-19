/**
 * Driving-motion derivation from GPS speed evidence.
 *
 * The coach-mark subsystem suppresses driver-facing tips while the vehicle is
 * moving (Capstone: Driver In-App Guide §7.1). That gate needs a single
 * defensible answer to "is this vehicle in motion right now", derived from the
 * one GPS stream the app already runs — the 30 s poster in `./tracking`.
 *
 * This module is deliberately React Native-free, following the same split as
 * `./connectivity-state` (pure derivation, unit-tested) vs. `./connectivity-context`
 * (RN glue). It is the only part of the motion feature the vitest suite can
 * reach: `vitest.config.mjs` includes `mobile/lib/**` only, never
 * `mobile/components/**` or `mobile/app/**`.
 *
 * WHY A HOLD WINDOW RATHER THAN THE LATEST FIX
 * A safety gate must not flicker open. Positions arrive every ~30 s, so the
 * latest fix is always stale by up to 30 s — and can be far staler through a
 * tunnel, an urban canyon, or a dropped fix. Reading only the newest sample
 * would un-suppress the guide at a red light, mid-route, exactly when the
 * driver is still driving. So motion is sticky: once seen, it holds for
 * MOVING_HOLD_MS regardless of what later fixes say. A stationary fix does not
 * clear the hold; only the passage of time does.
 *
 * WHY UNKNOWN FAILS OPEN
 * A null speed (no location permission, tracking disabled in Settings, or no
 * fix yet) never counts as motion. Blocking on unknown would silently disable
 * the entire in-app guide on any device without location, with nothing on
 * screen to explain why. The lock engages only on positive evidence.
 */

/**
 * Vehicle speed above which the driver is considered to be driving.
 * Capstone: Driver In-App Guide §7.1 specifies "> 10 km/h".
 */
export const MOVING_THRESHOLD_KMH = 10;

/**
 * The same threshold in metres per second, because that is the unit
 * `LocationObjectCoords.speed` actually reports.
 *
 * Do NOT drop the conversion: elsewhere in this app `coords.speed` is compared
 * against raw `1` and `2` (see `./tracking`, `app/(app)/(tabs)/map.js`), which
 * are 3.6 and 7.2 km/h. Comparing the un-converted spec number would move the
 * gate to 36 km/h — a car crawling in traffic would read as stationary.
 */
export const MOVING_THRESHOLD_MS = MOVING_THRESHOLD_KMH / 3.6;

/**
 * How long "was moving" persists after the last moving fix. 2 minutes covers a
 * red light, a traffic queue, a tunnel and a short GPS dropout — the cases
 * where a naive latest-fix check would wrongly re-enable tips — without
 * keeping tips suppressed for long after the driver has genuinely parked.
 */
export const MOVING_HOLD_MS = 2 * 60 * 1000;

/**
 * @typedef {object} MotionState
 * @property {number|null} lastMovingAt  epoch ms of the last fix showing motion
 * @property {number|null} lastFixAt     epoch ms of the last fix of any kind
 * @property {number|null} speedMs       the last reported speed, for debugging
 */

/** @returns {MotionState} */
export function createMotionState() {
  return { lastMovingAt: null, lastFixAt: null, speedMs: null };
}

/**
 * Folds one GPS fix into the motion state.
 *
 * `lastMovingAt` advances only on a fix at or above the threshold. A
 * null/undefined/NaN speed is recorded as "no evidence" and leaves the hold
 * exactly as it was — it neither starts one nor ends one.
 *
 * @param {MotionState|null} state
 * @param {{ speedMs?: number|null, atMs: number }} fix
 * @returns {MotionState} a new state; the input is never mutated
 */
export function recordFix(state, { speedMs = null, atMs } = {}) {
  const base = state || createMotionState();
  const speed = Number.isFinite(speedMs) ? speedMs : null;
  const moving = speed != null && speed >= MOVING_THRESHOLD_MS;

  return {
    lastFixAt: atMs ?? base.lastFixAt,
    speedMs: speed,
    lastMovingAt: moving ? (atMs ?? base.lastMovingAt) : base.lastMovingAt,
  };
}

/**
 * Whether the vehicle should be treated as driving at `nowMs`.
 *
 * True while a moving fix is still inside its hold window — including when the
 * most recent fix showed the vehicle stopped, which is the whole point.
 *
 * @param {MotionState|null} state
 * @param {number} nowMs
 * @returns {boolean}
 */
export function isDrivingAt(state, nowMs) {
  if (!state || state.lastMovingAt == null || !Number.isFinite(nowMs)) return false;
  return nowMs - state.lastMovingAt < MOVING_HOLD_MS;
}
