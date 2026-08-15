// Driver departure/start window (complement to travel-buffer.js).
//
// travel-buffer.js answers "can this driver/vehicle be ASSIGNED to the next
// booking?" using previous_end + travel + safety_buffer. This file answers a
// DIFFERENT question: "when can the driver actually START the trip?" — the
// recommended departure so they reach the pickup on time without leaving hours
// early.
//
//     recommended_departure = scheduled_pickup − eta_to_pickup − departure_buffer
//     earliest_start        = recommended_departure − early_start_allowance
//     latest_start          = scheduled_pickup (soft; used to drive late warnings)
//
// Fail-open by design (mirrors travel-buffer.js): when scheduled_pickup or the
// ETA is missing, every value resolves to null so the START gate can never
// fabricate a block from absent data.

/**
 * Compute the departure/start window for a trip.
 *
 * @param {object} p
 * @param {Date|string|null} p.pickup          scheduled pickup datetime (dispatchschedules.scheduled_departure)
 * @param {number|null} p.etaMinutes           travel minutes from driver's current location to the pickup
 * @param {number} [p.departureBufferMinutes=10]  on top of ETA, so the driver arrives early
 * @param {number} [p.earlyStartAllowanceMinutes=10] how much before recommended departure is still allowed
 * @returns {{
 *   recommended_departure: Date|null,
 *   earliest_start: Date|null,
 *   latest_start: Date|null,
 *   eta_minutes: number|null,
 * }}
 */
export function computeDepartureWindow({
  pickup,
  etaMinutes,
  departureBufferMinutes = 10,
  earlyStartAllowanceMinutes = 10,
}) {
  if (pickup == null || pickup === "") {
    return {
      recommended_departure: null,
      earliest_start: null,
      latest_start: null,
      eta_minutes: null,
    };
  }

  const pickupMs = new Date(pickup).getTime();
  if (!Number.isFinite(pickupMs)) {
    return {
      recommended_departure: null,
      earliest_start: null,
      latest_start: null,
      eta_minutes: null,
    };
  }

  const buffer = Number(departureBufferMinutes);
  const allowance = Number(earlyStartAllowanceMinutes);
  const eta = Number(etaMinutes);

  // ETA unknown → no window (fail-open: cannot compute a departure offset).
  if (etaMinutes == null || !Number.isFinite(eta) || eta < 0) {
    return {
      recommended_departure: null,
      earliest_start: null,
      latest_start: pickupMs > 0 ? new Date(pickupMs) : null,
      eta_minutes: null,
    };
  }

  const b = Number.isFinite(buffer) && buffer > 0 ? buffer : 0;
  const a = Number.isFinite(allowance) && allowance > 0 ? allowance : 0;

  const recommended = pickupMs - (eta + b) * 60 * 1000;
  const earliest = recommended - a * 60 * 1000;

  return {
    recommended_departure: new Date(recommended),
    earliest_start: new Date(earliest),
    latest_start: new Date(pickupMs),
    eta_minutes: Math.round(eta),
  };
}
