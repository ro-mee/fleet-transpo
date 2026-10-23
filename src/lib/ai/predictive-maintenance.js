/**
 * Predictive maintenance engine.
 *
 * Pure functions only — no database, no fetch, no ambient clock. Every input
 * arrives as an argument, including `now`, so each risk band boundary can be
 * tested exactly rather than approximately. The endpoint in
 * src/app/api/ai/predictive-maintenance/route.js does the I/O and pipes rows
 * through here.
 */

import { toCalendarDay } from "@/lib/dates";

/** Lowercase, and defined once. Both the engine and the pages import this. */
export const RISK = Object.freeze({
  OVERDUE: "overdue",
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

/** Trailing window for the usage-rate query, in days. */
export const USAGE_WINDOW_DAYS = 90;

/**
 * Below this many completed trips in the window there is no trustworthy burn
 * rate. A projection from two trips is a guess wearing a number's clothes;
 * presenting it with the same authority as one backed by 90 days of trips is
 * worse than not predicting at all.
 */
export const MIN_TRIPS_FOR_CONFIDENCE = 5;

/** pg returns SUM/COUNT as strings. Coerce, and treat unusable input as 0. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Derives km/day from a vehicle's trailing-window trip totals.
 *
 * kmPerDay divides by USAGE_WINDOW_DAYS — the calendar window — and not by
 * active_days. A vehicle that drives 600 km across 5 days averages 120 km per
 * active day but 6.7 km per calendar day; since a due-date projection is a
 * question about calendar days, dividing by active_days would overstate the
 * rate by the vehicle's idle ratio. activeDays is still returned: it is a
 * useful utilisation figure and distinguishes one long haul from steady daily
 * use, but it is not the projection denominator.
 */
export function computeUsageRate({ km_90d, trip_count, active_days } = {}) {
  const km = num(km_90d);
  const tripCount = num(trip_count);
  const activeDays = num(active_days);

  const hasEnoughTrips = tripCount >= MIN_TRIPS_FOR_CONFIDENCE;
  const hasDistance = km > 0;
  const confidence = hasEnoughTrips && hasDistance ? "high" : "low";

  return {
    kmPerDay: confidence === "high" ? km / USAGE_WINDOW_DAYS : 0,
    tripCount,
    activeDays,
    confidence,
  };
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight for a date-ish value, so day counts ignore wall-clock time.
 *
 * Routed through toCalendarDay because `pg` returns DATE columns as Dates
 * pinned to *local* midnight: reading UTC components off one shifts the day
 * backward at positive offsets, turning a 2026-07-31 due-date into 2026-07-30
 * at UTC+8 — see the note on src/lib/dates.js:7. toCalendarDay reads local
 * components from Dates and slices strings, which is the only handling that is
 * correct for both shapes the driver may hand back.
 */
function toMidnight(value) {
  const day = toCalendarDay(value);
  if (day === null) return null;
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole days from `now` until `dateValue`. Negative when the date has passed —
 * deliberately unclamped, because "18 days overdue" and "due today" are
 * different operational states and the previous Math.max(0, ...) collapsed them.
 * Returns null when there is no usable date, which is how a dimension signals
 * that it should not participate in the minimum.
 */
export function daysUntil(dateValue, now = new Date()) {
  const target = toMidnight(dateValue);
  if (target === null) return null;
  const today = toMidnight(now);
  if (today === null) return null;
  return Math.round((target - today) / MS_PER_DAY);
}

/** Numeric or null — distinguishes "absent" from "zero". */
function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolves a vehicle's two independent due-dates and picks the sooner.
 *
 * Mileage alone is not a prediction: 3,000 km remaining means nothing without a
 * burn rate. Dividing the remaining distance by km/day converts it into days,
 * which is the only unit the two dimensions share and therefore the only one
 * they can be compared in.
 *
 * A dimension with no data is excluded from the minimum rather than counted as
 * zero. A configured mileage threshold without a reading or usable rate has
 * no estimated day; the caller reports that evidence gap separately.
 */
export function resolveDueDate({ vehicle = {}, usage = {}, now = new Date() } = {}) {
  const daysToService = daysUntil(vehicle.next_service_date, now);

  const nextServiceMileage = numOrNull(vehicle.next_service_mileage);
  const currentMileage = numOrNull(vehicle.mileage);
  const kmToService =
    nextServiceMileage === null || currentMileage === null ? null : nextServiceMileage - currentMileage;

  // A projection needs both a target and a trustworthy rate. kmPerDay > 0 also
  // guards the division. Observed threshold crossings are checked separately
  // and remain overdue even when no rate is available.
  const canProject =
    kmToService !== null && usage.confidence === "high" && usage.kmPerDay > 0;
  const projectedDaysToService = canProject
    ? kmToService < 0 ? Math.min(-1, Math.round(kmToService / usage.kmPerDay)) : Math.round(kmToService / usage.kmPerDay)
    : null;

  const candidates = [];
  if (daysToService !== null) candidates.push({ days: daysToService, basis: "time" });
  if (projectedDaysToService !== null || kmToService === 0) {
    candidates.push({ days: projectedDaysToService ?? 0, basis: "mileage" });
  }

  // Sooner wins, so a heavily-used vehicle escalates on mileage before its
  // calendar date arrives.
  const winner = candidates.reduce(
    (best, c) => (best === null || c.days < best.days ? c : best),
    null
  );

  const mileageOverdue = kmToService !== null && kmToService < 0;
  const observedMileageWins = mileageOverdue && (winner === null || winner.days >= 0);
  return {
    daysToService,
    kmToService,
    projectedDaysToService,
    effectiveDays: observedMileageWins ? null : winner ? winner.days : null,
    basis: observedMileageWins ? "mileage" : winner ? winner.basis : null,
    mileageOverdue,
  };
}

/**
 * Bands the single effective day-count.
 *
 * overdue / critical / high keep the boundaries the existing tile labels
 * promise ("Critical (7 days)", "High (30 days)"). The medium/low cut moves
 * from 30 to 90 days: with a mileage projection in play, "more than 30 days"
 * spans five weeks to two years, which is too coarse to plan against.
 */
export function riskForDays(effectiveDays) {
  if (effectiveDays === null || effectiveDays === undefined) return RISK.LOW;
  if (effectiveDays < 0) return RISK.OVERDUE;
  if (effectiveDays <= 7) return RISK.CRITICAL;
  if (effectiveDays <= 30) return RISK.HIGH;
  if (effectiveDays <= 90) return RISK.MEDIUM;
  return RISK.LOW;
}

/**
 * 0–100, replacing the four hardcoded values (95/70/40/15) the old engine
 * returned. Three terms:
 *
 *  - urgency, dominant: how close the effective due-date is, ramped across the
 *    90-day planning horizon
 *  - overdue severity: an additional penalty that keeps growing past zero days,
 *    so three weeks overdue outranks one day overdue
 *  - corrective ratio: unplanned repairs as a share of the last year's records
 *
 * A vehicle with no schedule scores at the mid-point: it is not known-healthy,
 * and claiming 95 would be a lie about data that does not exist.
 */
export function healthScore({ effectiveDays, correctiveCount = 0, totalCount = 0 } = {}) {
  if (effectiveDays === null || effectiveDays === undefined) return 50;

  // Urgency: 0 at/past due, full marks beyond the 90-day horizon.
  const horizon = 90;
  const urgency = Math.min(Math.max(effectiveDays, 0), horizon) / horizon;
  let score = 15 + urgency * 85;

  // Overdue severity: capped so a long-abandoned vehicle bottoms out rather
  // than driving the score arbitrarily negative.
  if (effectiveDays < 0) {
    score -= Math.min(Math.abs(effectiveDays), 30) * 0.5;
  }

  // Corrective ratio, weighted lightly: history informs health but the
  // upcoming service is the actionable signal. No history means no penalty —
  // an unmaintained new vehicle is not the same as a repeatedly broken one.
  if (totalCount > 0) {
    score -= (correctiveCount / totalCount) * 15;
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

/** Whole-number km for display, tolerating pg's string aggregates. */
function roundKm(value) {
  return value === null || value === undefined ? null : Math.round(value);
}

/**
 * Prose that names the basis, so the number on screen is never unexplained.
 * The UI renders this directly; a reader must be able to tell a mileage-driven
 * escalation from a calendar one, and a projection from a guess.
 */
function buildRecommendation({ risk, basis, effectiveDays, kmToService, kmPerDay, confidence, dataIssues }) {
  if (basis === null) {
    return dataIssues.includes("missing_schedule")
      ? "No service schedule set — add a next service date or mileage to predict this vehicle."
      : dataIssues.includes("missing_mileage")
        ? "Service mileage is set but the odometer reading is missing — record mileage to assess when it is due."
        : "Service mileage is set, but trip data is too limited to estimate a due date.";
  }

  const overdueBy = effectiveDays === null ? null : Math.abs(effectiveDays);

  if (basis === "mileage") {
    if (risk === RISK.OVERDUE) {
      const rate = effectiveDays === null ? "" : " (~" + Math.round(kmPerDay) + " km/day)";
      return "Service mileage exceeded by " + Math.abs(roundKm(kmToService)) + " km" + rate + " — ground the vehicle and service it now.";
    }
    if (kmToService === 0) return "Service mileage reached — service the vehicle now.";
    return roundKm(kmToService).toLocaleString() + " km to service at ~" + Math.round(kmPerDay) + " km/day — due in about " + effectiveDays + " day" + (effectiveDays === 1 ? "" : "s") + ".";
  }

  // basis === "time"
  const thin = confidence === "low" ? " — calendar only, not enough trip data to project mileage" : "";
  if (risk === RISK.OVERDUE) {
    return `Service is ${overdueBy} day${overdueBy === 1 ? "" : "s"} overdue — ground the vehicle and service it now${thin}.`;
  }
  if (risk === RISK.CRITICAL) {
    return `Service due in ${effectiveDays} day${effectiveDays === 1 ? "" : "s"} — schedule it this week${thin}.`;
  }
  if (risk === RISK.HIGH) {
    return `Service due in ${effectiveDays} days — book it within the month${thin}.`;
  }
  return `Service due in ${effectiveDays} days${thin}.`;
}

/**
 * One CTE row in, one prediction out. Pure: the same row and clock always
 * produce the same result, which is why the boundary tests can be exact.
 */
export function predictVehicle(row = {}, now = new Date()) {
  const usage = computeUsageRate(row);
  const due = resolveDueDate({ vehicle: row, usage, now });

  const risk = due.mileageOverdue ? RISK.OVERDUE : riskForDays(due.effectiveDays);
  const hasSchedule = numOrNull(row.next_service_mileage) !== null || due.daysToService !== null;
  const dataIssues = [];
  if (!hasSchedule) dataIssues.push("missing_schedule");
  if (numOrNull(row.next_service_mileage) !== null && numOrNull(row.mileage) === null) dataIssues.push("missing_mileage");
  if (due.kmToService > 0 && due.projectedDaysToService === null && due.daysToService === null) {
    dataIssues.push("insufficient_usage");
  }
  const serviceStatus = risk === RISK.OVERDUE ? "overdue"
    : due.effectiveDays === 0 ? "due"
    : due.effectiveDays === null ? "needs_data"
    : due.effectiveDays <= 30 ? "upcoming" : "on_schedule";
  const correctiveCount = num(row.corrective_count);
  const totalCount = num(row.total_count);

  return {
    vehicle_id: row.vehicle_id,
    plate_number: row.plate_number,
    vehicle_name: row.vehicle_name,
    mileage: numOrNull(row.mileage),
    // Normalized here, not on the page. pg hands these back as Date objects
    // pinned to *local* midnight; JSON serialization would send them as a UTC
    // instant, and the browser slicing that back to 10 characters reads the UTC
    // day — one behind the real calendar day at any positive offset. This is
    // the last point where the local-midnight Date still exists.
    next_service_date: toCalendarDay(row.next_service_date),
    next_service_mileage: numOrNull(row.next_service_mileage),
    last_service_date: toCalendarDay(row.last_service_date),
    risk,
    serviceStatus,
    dataIssues,
    mileageOverdue: due.mileageOverdue,
    score: healthScore({ effectiveDays: due.effectiveDays, correctiveCount, totalCount }),
    basis: due.basis,
    confidence: usage.confidence,
    daysToService: due.daysToService,
    kmToService: roundKm(due.kmToService),
    kmPerDay: usage.kmPerDay,
    projectedDaysToService: due.projectedDaysToService,
    effectiveDays: due.effectiveDays,
    recommendation: buildRecommendation({
      risk,
      basis: due.basis,
      effectiveDays: due.effectiveDays,
      kmToService: due.kmToService,
      kmPerDay: usage.kmPerDay,
      confidence: usage.confidence,
      dataIssues,
    }),
  };
}

/**
 * True when neither service threshold is configured. A mileage threshold with
 * a missing reading or usable rate is scheduled but needs data; a null basis
 * alone cannot distinguish those cases.
 */
export function isUnscheduled(prediction) {
  return !prediction || (prediction.next_service_date == null && prediction.next_service_mileage == null);
}

/**
 * Scores the fleet and precomputes the band counts.
 *
 * The summary exists so the pages read one number per tile instead of
 * re-filtering the array — the re-filtering is where the capitalisation bug
 * lived, and four separate passes over the same array is how two of them
 * drifted apart.
 *
 * Observed overdue mileage sorts first even without a day estimate. Rows with
 * no day estimate otherwise sort last; they need more evidence, not a healthy
 * ranking.
 */
export function predictFleet(rows = [], now = new Date()) {
  const predictions = rows.map((r) => predictVehicle(r, now));

  const sorted = [...predictions].sort((a, b) => {
    if (a.serviceStatus === "overdue" && b.serviceStatus !== "overdue") return -1;
    if (b.serviceStatus === "overdue" && a.serviceStatus !== "overdue") return 1;
    if (a.effectiveDays === null && b.effectiveDays === null) return 0;
    if (a.effectiveDays === null) return 1;
    if (b.effectiveDays === null) return -1;
    return a.effectiveDays - b.effectiveDays;
  });

  const summary = {
    overdue: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: predictions.length,
    unscheduled: 0,
    needsData: 0,
  };
  for (const p of predictions) {
    summary[p.risk] += 1;
    if (isUnscheduled(p)) summary.unscheduled += 1;
    if (p.serviceStatus === "needs_data") summary.needsData += 1;
  }

  return { predictions: sorted, summary };
}
