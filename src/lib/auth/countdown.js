/**
 * Countdown presentation shared by every session-expiry surface.
 *
 * The expiry modal and the always-on TopNav chip both render "time left in this
 * session". They must never disagree: two copies of the `m:ss` math drift
 * silently, and a chip reading 1:04 next to a modal reading 1:03 reads as a bug
 * in the timeout itself rather than a bug in the formatting. So the math lives
 * here once and both surfaces import it.
 *
 * Dependency-free, for the same reason `./session-policy` is: a `"use client"`
 * component has to be able to import it.
 */
import { IDLE_WARNING_SECONDS } from "./session-policy";

/**
 * When a countdown escalates from neutral to its warning tone.
 *
 * Deliberately NOT `IDLE_WARNING_SECONDS`. At that threshold the expiry modal
 * opens and covers the screen with an opaque, backdrop-blurred overlay, so a
 * tone change there would never be seen — it would be dead code. Doubling it
 * puts the escalation ahead of the interruption, which is the only reason to
 * have a tone at all.
 *
 * Derived from the policy constant, never hand-written, so it cannot drift away
 * from the timeout it describes.
 */
export const COUNTDOWN_WARNING_SECONDS = IDLE_WARNING_SECONDS * 2;

/**
 * Whole seconds remaining, zero-clamped.
 *
 * `Number.isFinite` rather than a bare `Math.max`: `Math.max(0, NaN)` is NaN,
 * which would render as "NaN:NaN" instead of a countdown. Every caller passes a
 * computed number, but a formatter that cannot produce garbage is worth the one
 * line.
 */
function clampSeconds(secondsRemaining) {
  return Number.isFinite(secondsRemaining) ? Math.max(0, Math.floor(secondsRemaining)) : 0;
}

/**
 * `m:ss` — the modal's hero digits and the TopNav chip, byte for byte.
 *
 * Zero-clamped, because an expired deadline is a *negative* number of seconds
 * and "-0:03" would be worse than "0:00".
 *
 * Not fixed-width: anything under ten minutes renders four characters, but a
 * session still carrying a legacy 3600s idle window renders "59:59". Callers
 * must size to content rather than reserving a fixed width.
 */
export function formatCountdown(secondsRemaining) {
  const totalSec = clampSeconds(secondsRemaining);
  const m = Math.floor(totalSec / 60);
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

/**
 * The same value spoken, for `aria-label`.
 *
 * A screen reader announces "4:32" as "four colon thirty-two", which is not a
 * duration. This is the form that is.
 */
export function formatCountdownSpoken(secondsRemaining) {
  const totalSec = clampSeconds(secondsRemaining);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  const parts = [];
  if (minutes > 0) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** Which tone a countdown at this value should carry. */
export function countdownTone(secondsRemaining) {
  return clampSeconds(secondsRemaining) <= COUNTDOWN_WARNING_SECONDS ? "warning" : "neutral";
}
