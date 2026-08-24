// Pure decision helpers for license-compliance suspension.
//
// Extracted from status.service / the drivers PUT route so the rule is unit-
// testable without a database (same pattern as grounding.js and
// incidents/resolution.js). Callers own all DB writes and notifications.

import { DRIVER_STATUS, DRIVER_SUSPENSION_REASON } from "@/lib/constants";

const SUSPENDED = DRIVER_STATUS.SUSPENDED;
const LICENSE_EXPIRED = DRIVER_SUSPENSION_REASON.LICENSE_EXPIRED;

/**
 * Is the license expired as of today (server-local date)?
 * Null/invalid expiry counts as NOT expired — absence of data must never
 * auto-suspend a driver.
 *
 * Accepts Date instances (what pg returns for a DATE column) as well as
 * ISO strings. String-slicing a Date's toString() would misparse —
 * "Sun Aug 22 2027…" sliced to "Sun Aug 22" parses as year 2001.
 */
export function licenseExpired(licenseExpiry, now = new Date()) {
  if (!licenseExpiry) return false;
  let d;
  if (licenseExpiry instanceof Date) {
    d = licenseExpiry;
  } else {
    d = new Date(`${String(licenseExpiry).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const atMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return atMidnight.getTime() < today.getTime();
}

/**
 * Decide what the compliance layer should do with a driver's availability
 * flag.
 *
 * Rules:
 *  - 'suspend' when the license is expired — unless the driver is On Leave,
 *    which always wins (human leave beats machine compliance).
 *  - 'restore' ONLY when a previous compliance suspension ('license_expired')
 *    lingers after the license has become valid again. Manual/legacy
 *    suspensions (any other reason, or NULL) are never touched by code.
 *  - 'none' otherwise — including an already-suspended driver whose license
 *    is still expired (idempotent re-run).
 *
 * @param {{
 *   driverStatus?: string|null,
 *   suspensionReason?: string|null,
 *   licenseExpiry?: string|null,
 * }} input
 * @param {Date} [now]
 * @returns {{ action: 'suspend'|'restore'|'none' }}
 */
export function suspensionAction({ driverStatus, suspensionReason, licenseExpiry }, now = new Date()) {
  if (driverStatus === DRIVER_STATUS.ON_LEAVE) return { action: "none" };

  const expired = licenseExpired(licenseExpiry, now);

  if (expired && driverStatus !== SUSPENDED) {
    return { action: "suspend", reason: LICENSE_EXPIRED };
  }

  if (!expired && driverStatus === SUSPENDED && suspensionReason === LICENSE_EXPIRED) {
    return { action: "restore" };
  }

  return { action: "none" };
}
