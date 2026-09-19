/**
 * Canonical web-session timing policy.
 *
 * This module exists so the client and the server read the SAME numbers.
 * `src/lib/auth/sessions.js` cannot be imported from a `"use client"` component
 * (it pulls in `@/lib/db` and `geoip-lite`), so the policy lives here,
 * dependency-free, and `sessions.js` re-exports it for existing importers.
 *
 * Before this module, the idle warning and the heartbeat interval were
 * hand-copied 300s literals on the client while the server held its own 3600s —
 * three independent "5 minutes" that nobody kept in sync.
 *
 * The derived values below are the guard against that class of bug: the warning
 * window and the heartbeat interval are computed FROM the idle timeout, so
 * changing the timeout can never again produce a warning window that swallows
 * the whole timeout, or a heartbeat that fires exactly at the deadline.
 */

/** Absolute session lifetime. Computed once at login and NEVER extended. */
export const WEB_SESSION_TTL_SECONDS = 12 * 60 * 60;

/**
 * Idle timeout: how long a session survives with no verified human activity.
 * 5 minutes — deliberately tight for unattended operator terminals. Raise this
 * one number to relax the policy; everything else scales with it.
 */
export const IDLE_TIMEOUT_SECONDS = 5 * 60;

/**
 * How long before idle expiry the "Are you still there?" warning appears.
 * 20% of the idle window, capped at 5 minutes:
 *   - 1-hour timeout → 300s (the original behaviour)
 *   - 5-minute timeout → 60s
 * Without the ratio the warning would equal a 5-minute timeout and the modal
 * would be on screen from the moment of login, never dismissing.
 */
export const IDLE_WARNING_SECONDS = Math.min(5 * 60, Math.round(IDLE_TIMEOUT_SECONDS / 5));

/** How long before the 12-hour absolute expiry its warning appears. */
export const ABSOLUTE_WARNING_SECONDS = 5 * 60;

/**
 * Minimum spacing between two activity heartbeats. A user clicking and typing
 * continuously must not issue a write per keystroke; this caps it at one per
 * window while still keeping the countdown fresh.
 */
export const ACTIVITY_HEARTBEAT_MIN_GAP_SECONDS = Math.round(IDLE_TIMEOUT_SECONDS / 5);

/**
 * Backstop interval for the periodic heartbeat — a floor in case DOM activity
 * events are missed. Must stay well below IDLE_TIMEOUT_SECONDS so a tick can
 * never land on (or after) the idle deadline.
 */
export const ACTIVITY_HEARTBEAT_INTERVAL_SECONDS = Math.round(IDLE_TIMEOUT_SECONDS / 2);
