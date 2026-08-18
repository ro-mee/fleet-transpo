/**
 * Tier classification for mobile notifications.
 *
 * Pure and unit-testable: given a notification row (from GET /api/notifications)
 * it decides which delivery surface it earns and how urgent it reads.
 *
 * Tiers:
 *   "push"     — heads-up banner AND an OS-level local notification. For
 *                important real-time events that deserve a system surface even
 *                while the driver is in another app or the screen is locked.
 *   "heads-up" — a heads-up banner only (urgent / time-sensitive in-app).
 *   "silent"   — no popup at all; the row just updates the Alerts tab + badge.
 *
 * Tone maps to the mobile design system's semantic containers so urgency is
 * signalled by icon + text + color, never color alone.
 */

export const TIER = {
  PUSH: "push",
  HEADS_UP: "heads-up",
  SILENT: "silent",
};

export const TONE = {
  CRITICAL: "critical",
  WARNING: "warning",
  SUCCESS: "success",
  INFO: "info",
};

// Severity values that escalate to a push (from driverincidents.severity).
const PUSH_SEVERITIES = new Set(["Critical", "Major"]);
const HEADS_UP_SEVERITIES = new Set(["Moderate"]);

// Notification `type` values that escalate to a push.
const PUSH_TYPES = new Set(["Alert", "Emergency"]);

// `reference_type` values that are always operational urgency.
const PUSH_REFERENCES = new Set(["incident"]);

/** @param {object} notif  a notifications row (type, severity, reference_type) */
export function classifyNotification(notif = {}) {
  const { type = "", severity, reference_type: ref = "" } = notif;

  // Highest first.
  const isPush =
    type === "Emergency" ||
    type === "Alert" ||
    (ref === "incident" && PUSH_SEVERITIES.has(severity)) ||
    PUSH_SEVERITIES.has(severity) ||
    (ref === "incident" && PUSH_REFERENCES.has(ref));

  if (isPush) {
    return { tier: TIER.PUSH, tone: TONE.CRITICAL, urgent: true };
  }

  const isHeadsUp =
    type === "Warning" || HEADS_UP_SEVERITIES.has(severity);

  if (isHeadsUp) {
    return { tier: TIER.HEADS_UP, tone: TONE.WARNING, urgent: true };
  }

  return { tier: TIER.SILENT, tone: TONE.INFO, urgent: false };
}

/**
 * Classify an in-app event that did not come through the notifications table.
 * The feed only auto-routes DB rows; app code calls `notify.*` directly for
 * these, and can use this helper to keep the same tone vocabulary.
 */
export function toneForInAppEvent(kind) {
  switch (kind) {
    case "sos":
    case "critical":
    case "error":
      return TONE.CRITICAL;
    case "warning":
      return TONE.WARNING;
    case "success":
      return TONE.SUCCESS;
    default:
      return TONE.INFO;
  }
}