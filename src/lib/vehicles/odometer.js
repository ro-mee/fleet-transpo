/**
 * Odometer reading sanity checks.
 *
 * Pure and shared by both trip routes. Mileage is the input to every km-based
 * prediction, so a bad reading is not a cosmetic problem: a low one walks
 * mileage backwards and defers every due-date on the vehicle, and a high one
 * marks a healthy vehicle overdue. The write itself also uses GREATEST as a
 * second line of defence.
 */

/**
 * Above this many kilometres in one trip, a reading is more likely a typo than
 * a journey. Flagged for review rather than rejected — a genuine provincial
 * transfer must not be blocked by a heuristic.
 */
export const MAX_PLAUSIBLE_TRIP_KM = 1500;

/**
 * Absolute ceiling for any odometer value accepted by an API.
 *
 * Deliberately far above any real reading — a heavy bus retired at a million
 * kilometres is still well inside it — because this is not a plausibility
 * heuristic. It is the bound that stops an unrealistically large mileage from
 * being written into a vehicle's service schedule, where the forward-only
 * GREATEST clamp in maintenance-schedule.service.js would make it permanent.
 * Judgement calls about whether a reading looks right belong in
 * validateOdometerReading; this is only the outer wall.
 */
export const MAX_ODOMETER_KM = 2000000;

export function validateOdometerReading({ reading, currentMileage } = {}) {
  const value = Number(reading);
  if (reading === null || reading === undefined || reading === "" || !Number.isFinite(value)) {
    return { ok: false, error: "Odometer reading is required and must be a number.", flagged: false, reason: null };
  }
  if (value < 0) {
    return { ok: false, error: "Odometer reading cannot be negative.", flagged: false, reason: null };
  }

  const current = Number(currentMileage);
  const hasCurrent = Number.isFinite(current) && current > 0;

  if (hasCurrent && value < current) {
    return {
      ok: false,
      error: `Odometer reading ${value.toLocaleString()} km is below the vehicle's recorded mileage of ${current.toLocaleString()} km.`,
      flagged: false,
      reason: null,
    };
  }

  const delta = hasCurrent ? value - current : 0;
  if (delta > MAX_PLAUSIBLE_TRIP_KM) {
    return {
      ok: true,
      error: null,
      flagged: true,
      reason: `Odometer jumped ${delta.toLocaleString()} km, above the ${MAX_PLAUSIBLE_TRIP_KM.toLocaleString()} km plausibility threshold for one trip. Flagged for review.`,
    };
  }

  return { ok: true, error: null, flagged: false, reason: null };
}
