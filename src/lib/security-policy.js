// Security & session policy — pure defaults/merge/validation. No DB, no React.
// Mirrors src/lib/dispatch-policy.js and src/lib/uvvrp/policy.js.
//
// Stored in system_settings under 'security_policy'. Every default below is the
// value the code hard-coded before this existed, so a database with no row
// behaves exactly as it did before — the queue never depends on an administrator
// having saved a policy.
//
// The session defaults are IMPORTED from src/lib/auth/session-policy.js rather
// than retyped: that module is the canonical home of the two session numbers and
// is imported by both the client and the server, so a second literal here would
// be exactly the drift its own header comment says exists to prevent.

import {
  IDLE_TIMEOUT_SECONDS,
  WEB_SESSION_TTL_SECONDS,
} from "@/lib/auth/session-policy";

export const SECURITY_POLICY_KEY = "security_policy";

/**
 * The stored shape. Seconds for anything the session machinery consumes,
 * minutes for the lockout window, days for the longer-lived credentials —
 * the unit each consumer already works in, so no call site has to convert.
 */
export const DEFAULT_SECURITY_POLICY = {
  /** No verified human activity before the session is considered gone. */
  idleTimeoutSeconds: IDLE_TIMEOUT_SECONDS,
  /** Absolute lifetime from login. Never extended by activity. */
  absoluteTtlSeconds: WEB_SESSION_TTL_SECONDS,
  /** Failed password attempts before the account freezes. */
  lockoutLimit: 10,
  /** The freeze window, measured from the first failure. */
  lockoutWindowMinutes: 15,
  /** How long an invite/temporary password stays usable. */
  tempPasswordTtlDays: 7,
  /** "Remember this device" — skips the emailed code for this long. */
  trustedDeviceTtlDays: 7,
  /** How far back a sign-in is looked up to decide whether a device is new. */
  newDeviceLookbackDays: 90,
};

/**
 * Per-field bounds, in the same units as DEFAULT_SECURITY_POLICY.
 *
 * Exported so the settings form can render min/max hints and reject a value
 * client-side with the SAME numbers the server enforces — two independent
 * range lists is how the client and server start disagreeing about what is
 * valid.
 */
export const SECURITY_POLICY_RANGES = {
  idleTimeoutSeconds: { min: 60, max: 3600 },
  absoluteTtlSeconds: { min: 900, max: 172800 },
  lockoutLimit: { min: 3, max: 50 },
  lockoutWindowMinutes: { min: 1, max: 1440 },
  tempPasswordTtlDays: { min: 1, max: 30 },
  trustedDeviceTtlDays: { min: 1, max: 90 },
  newDeviceLookbackDays: { min: 1, max: 365 },
};

/**
 * Human labels + units for the settings form, keyed by field — the EDITABLE
 * subset of SECURITY_POLICY_KEYS, in display order.
 *
 * `absoluteTtlSeconds` is deliberately not listed. It stays in the policy (the
 * session machinery reads it and it still governs `expires_at`, and a direct
 * PUT still carries it because SECURITY_POLICY_KEYS is unchanged), but the form
 * stopped offering it on 2026-09-29: the card already leads with the idle
 * timeout, and a second time limit read as more confusing than as protection.
 *
 * @type {{key: string, label: string, unit: string, hint: string, parts?: string[]}[]}
 */
export const SECURITY_POLICY_FIELDS = [
  {
    key: "idleTimeoutSeconds",
    label: "Idle timeout",
    unit: "seconds",
    // Entered as a minutes + seconds pair rather than one box of seconds:
    // "300" is a bad way to ask for five minutes. Only the input is split —
    // the stored value, the ranges and every consumer stay in seconds.
    parts: ["minutes", "seconds"],
    hint: "Signed out after this long with no activity. The warning and heartbeat intervals are derived from it.",
  },
  { key: "lockoutLimit", label: "Lockout threshold", unit: "attempts", hint: "Failed password attempts before the account freezes." },
  { key: "lockoutWindowMinutes", label: "Lockout window", unit: "minutes", hint: "Failures are counted across this window before the freeze resets." },
  { key: "tempPasswordTtlDays", label: "Temporary password lifetime", unit: "days", hint: "How long an invite link or temporary password stays usable." },
  { key: "trustedDeviceTtlDays", label: "Trusted device lifetime", unit: "days", hint: "A remembered browser skips the emailed code for this long." },
  { key: "newDeviceLookbackDays", label: "New-device lookback", unit: "days", hint: "How far back a successful sign-in counts as a device we have already seen." },
];

/** Every stored field, in declaration order. */
export const SECURITY_POLICY_KEYS = Object.keys(DEFAULT_SECURITY_POLICY);

const inRange = (key, v) => {
  const { min, max } = SECURITY_POLICY_RANGES[key];
  return Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max;
};

/**
 * Merge a stored policy over the defaults, clamping anything out of range back
 * to the default. Never trusts the stored shape: a tampered, truncated or
 * hand-edited row yields a usable policy rather than an exception on the login
 * path, which is where this is read.
 *
 * Unknown keys are dropped — the merged object carries exactly
 * SECURITY_POLICY_KEYS and nothing else.
 *
 * @param {*} stored raw `setting_value` JSON, or null
 * @returns {object} a complete, in-range policy
 */
export function mergeSecurityPolicy(stored) {
  const s = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  const merged = {};
  for (const key of SECURITY_POLICY_KEYS) {
    const fallback = DEFAULT_SECURITY_POLICY[key];
    merged[key] = inRange(key, s[key]) ? Number(s[key]) : fallback;
  }
  // Cross-field: an absolute cap at or below the idle window means the session
  // is already dead when the idle warning would fire, so the warning modal can
  // never be shown. Fall back to the default pair rather than emit a policy
  // that cannot behave.
  if (merged.absoluteTtlSeconds <= merged.idleTimeoutSeconds) {
    merged.absoluteTtlSeconds = DEFAULT_SECURITY_POLICY.absoluteTtlSeconds;
    if (merged.absoluteTtlSeconds <= merged.idleTimeoutSeconds) {
      merged.idleTimeoutSeconds = DEFAULT_SECURITY_POLICY.idleTimeoutSeconds;
    }
  }
  return merged;
}

/**
 * Validate an incoming policy. Returns `{ ok: true }` or `{ ok: false, error }`.
 *
 * Only the fields PRESENT are checked, so a partial PUT (the settings form
 * sends only what it edits) is not forced to restate the whole policy. The
 * route merges the validated candidate over the stored policy before saving,
 * exactly as the dispatch route does.
 *
 * @param {*} policy
 */
export function validateSecurityPolicy(policy) {
  if (policy === undefined || policy === null) return { ok: true };
  if (typeof policy !== "object" || Array.isArray(policy)) {
    return { ok: false, error: "policy must be an object" };
  }

  for (const key of SECURITY_POLICY_KEYS) {
    if (!(key in policy)) continue;
    const v = policy[key];
    if (v === undefined || v === null) continue;
    if (!inRange(key, v)) {
      const { min, max } = SECURITY_POLICY_RANGES[key];
      return { ok: false, error: `${key} must be a whole number between ${min} and ${max}` };
    }
  }

  // The cross-field rule, stated against the CANDIDATE after the caller has
  // layered it over the stored policy. Checked here so the error surfaces as a
  // 400 on save rather than being silently repaired by mergeSecurityPolicy.
  const idle = Number(policy.idleTimeoutSeconds);
  const absolute = Number(policy.absoluteTtlSeconds);
  if (
    Number.isFinite(idle) &&
    Number.isFinite(absolute) &&
    absolute <= idle
  ) {
    return {
      ok: false,
      error: "absoluteTtlSeconds must be greater than idleTimeoutSeconds",
    };
  }

  return { ok: true };
}

/**
 * Split a stored seconds total into the minutes + seconds pair the form shows.
 *
 * Pure display helper for the split idle-timeout input: `300` →
 * `{ minutes: "5", seconds: "0" }`. Strings, not numbers, because the inputs
 * are text and must be able to hold `""` while the operator is retyping.
 *
 * @param {*} totalSeconds
 * @returns {{minutes: string, seconds: string}}
 */
export function splitDurationParts(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  return { minutes: String(Math.floor(total / 60)), seconds: String(total % 60) };
}

/**
 * Join a typed minutes + seconds pair back into a stored seconds total.
 *
 * Empty halves count as 0 while typing, so clearing one box does not freeze
 * the other — the input can go momentarily empty and `Save` validates the
 * joined total (60–3600) once the operator is done.
 *
 * @param {*} minutes raw minutes text (`""` allowed)
 * @param {*} seconds raw seconds text (`""` allowed)
 * @returns {number} whole seconds, >= 0
 */
export function joinDurationParts(minutes, seconds) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return m * 60 + s;
}

/**
 * Seconds until the "Are you still there?" warning, and the two heartbeat
 * intervals — all derived from the idle window so they can never outlast it.
 *
 * This is the same arithmetic session-policy.js applies to its constants, but
 * takes the idle window as an argument so a configured value produces the same
 * invariants the defaults do. The regression guard for the relationship is
 * src/lib/auth/idle-session.test.js ("Derived session policy invariants").
 *
 * @param {number} idleTimeoutSeconds
 * @returns {{idleWarningSeconds:number, heartbeatMinGapSeconds:number, heartbeatIntervalSeconds:number}}
 */
export function deriveIdleWindows(idleTimeoutSeconds) {
  const idle = Number(idleTimeoutSeconds);
  const safe = Number.isFinite(idle) && idle > 0 ? idle : DEFAULT_SECURITY_POLICY.idleTimeoutSeconds;
  return {
    idleWarningSeconds: Math.min(5 * 60, Math.round(safe / 5)),
    heartbeatMinGapSeconds: Math.round(safe / 5),
    // Must stay strictly below the idle window or a tick can land on the
    // deadline itself.
    heartbeatIntervalSeconds: Math.max(1, Math.round(safe / 2)),
  };
}
