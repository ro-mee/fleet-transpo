import { DISPATCH_STATUS as D } from "@/lib/constants";

// Unassigned-departure warnings — the missing join between "no vehicle/driver"
// and "leaving soon".
//
// PURE and DETERMINISTIC, like src/lib/scheduling/priority.js: pass a fixed
// `now` and the same dispatch always yields the same alert. No DB, no React, so
// the tier arithmetic is testable without mounting anything.
//
// The board already knows both halves — /api/dispatch/by-status LEFT JOINs
// vehicles and drivers, so an unassigned row simply arrives with null ids — but
// nothing has ever compared that against scheduled_departure. This does.
//
// Not to be confused with trip-progress.js's `overdue`, which means a *running*
// trip has exceeded its planned duration. Here nothing has left yet, and that is
// precisely the problem.

/** Fallback tiers (minutes before departure) when dispatch_policy is unset. */
export const DEFAULT_DEPARTURE_ALERTS = {
  enabled: true,
  tiers: [30, 20, 10],
};

/** Alert tone → the design token families already used by StatusBadge/rails. */
export const ALERT_TONE = {
  notice: "info",
  warning: "warning",
  critical: "danger",
};

/** Why a dispatch is being flagged. */
export const ALERT_REASON = {
  UNASSIGNED: "unassigned",
  REASSIGNMENT: "reassignment",
};

// A dispatch is only a *departure* risk while it is still waiting to leave.
// In Progress means it left — whatever it is missing is no longer an assignment
// gap — and Completed/Cancelled are terminal.
const ELIGIBLE = new Set([D.SCHEDULED, D.PENDING_REASSIGNMENT]);

/**
 * Normalize a stored tier list: positive finite minutes, deduped, widest first.
 * Returns null when nothing usable survives, so callers can fall back.
 */
export function normalizeTiers(tiers) {
  if (!Array.isArray(tiers)) return null;
  const clean = [...new Set(tiers.map(Number).filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => b - a
  );
  return clean.length ? clean : null;
}

/**
 * Evaluate one dispatch.
 *
 * @param {object} dispatch            a row from /api/dispatch/by-status
 * @param {object} [opts]
 * @param {Date}   [opts.now]          fixed clock for tests
 * @param {number[]} [opts.tiers]      minutes-before-departure bands
 * @returns {{tier:number, minutesLeft:number, tone:string, reason:string, overdue:boolean}|null}
 *          null when the dispatch is fine, ineligible, or undated.
 */
export function departureAlert(dispatch, { now = new Date(), tiers } = {}) {
  if (!dispatch) return null;
  if (!ELIGIBLE.has(dispatch.status)) return null;

  // Pending Reassignment alerts even when both ids are still populated — the
  // pairing itself has been voided, so the dispatcher must act regardless.
  const isReassignment = dispatch.status === D.PENDING_REASSIGNMENT;
  const isUnassigned = !dispatch.vehicle_id || !dispatch.driver_id;
  if (!isReassignment && !isUnassigned) return null;

  // scheduled_departure is nullable, and new Date(null) is epoch 0 rather than
  // NaN — without this guard an undated dispatch reads as decades overdue.
  if (!dispatch.scheduled_departure) return null;

  const departure = new Date(dispatch.scheduled_departure).getTime();
  const clock = new Date(now).getTime();
  if (!Number.isFinite(departure) || !Number.isFinite(clock)) return null;

  const bands = normalizeTiers(tiers) || DEFAULT_DEPARTURE_ALERTS.tiers;
  const minutesLeft = Math.round((departure - clock) / 60000);

  // Past its departure time and still not sorted — the worst case, and it must
  // not fall out of the bottom of the bands.
  if (minutesLeft <= 0) {
    return {
      tier: 0,
      minutesLeft,
      tone: ALERT_TONE.critical,
      reason: isReassignment ? ALERT_REASON.REASSIGNMENT : ALERT_REASON.UNASSIGNED,
      overdue: true,
    };
  }

  // Match the tightest band the dispatch is inside: with [30,20,10], 27min is
  // tier 30 and 8min is tier 10. Outside the widest band there is no alert yet.
  let index = -1;
  for (let i = 0; i < bands.length; i++) {
    if (minutesLeft <= bands[i]) index = i;
  }
  if (index === -1) return null;

  // Severity comes from position in the list, so a 2-tier or 5-tier policy
  // escalates sensibly without hardcoding 30/20/10.
  let tone;
  if (index === bands.length - 1) tone = ALERT_TONE.critical;
  else if (index === 0) tone = ALERT_TONE.notice;
  else tone = ALERT_TONE.warning;

  return {
    tier: bands[index],
    minutesLeft,
    tone,
    reason: isReassignment ? ALERT_REASON.REASSIGNMENT : ALERT_REASON.UNASSIGNED,
    overdue: false,
  };
}

/**
 * Evaluate a whole board payload.
 *
 * @returns {Array<{dispatch: object, alert: object}>} most urgent first.
 */
export function departureAlerts(dispatches, opts = {}) {
  if (!Array.isArray(dispatches)) return [];
  return dispatches
    .map((dispatch) => {
      const alert = departureAlert(dispatch, opts);
      return alert ? { dispatch, alert } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.alert.minutesLeft - b.alert.minutesLeft);
}

/** Human phrasing shared by the toast, the banner and the card. */
export function alertMessage(alert) {
  if (!alert) return "";
  const what =
    alert.reason === ALERT_REASON.REASSIGNMENT ? "needs reassignment" : "still unassigned";
  if (alert.overdue) {
    const late = Math.abs(alert.minutesLeft);
    return late === 0 ? `Departing now — ${what}` : `${late} min overdue — ${what}`;
  }
  return `Departs in ${alert.minutesLeft} min — ${what}`;
}
