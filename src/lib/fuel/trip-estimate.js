/**
 * Trip fuel estimates (Release D Task 11).
 *
 * Pure math over captured inputs. `estimated_fuel_l` is NOT measured burn and
 * is never written to the legacy `fuel_consumed` column, which keeps its
 * meaning unchanged. Missing basis yields null with a reason — never 0 and
 * never a fabricated actual.
 *
 * Decimal handling: litres round to 3 dp, cost to 2 dp (round-half-up via
 * Math.round on scaled integers), and cost derives from the ROUNDED litres so
 * ledger arithmetic reconciles exactly.
 */

const roundTo = (value, dp) => {
  const factor = 10 ** dp;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const validKm = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Which distance feeds the estimate. Odometer math first, then the validated
 * trip distance, then the server-derived GPS trail — the same precedence the
 * completion path persists.
 */
export function resolveEstimateDistance({ odometerKm = null, tripDistanceKm = null, gpsTrailKm = null } = {}) {
  const odo = validKm(odometerKm);
  if (odo !== null) return { km: odo, provenance: "odometer" };
  const trip = validKm(tripDistanceKm);
  if (trip !== null) return { km: trip, provenance: "trip-distance" };
  const trail = validKm(gpsTrailKm);
  if (trail !== null) return { km: trail, provenance: "gps-trail" };
  return { km: null, provenance: null };
}

/**
 * @returns {{ liters:number|null, cost:number|null, basis:string, reason:string|null }}
 */
export function estimateFuelCost({ distanceKm = null, efficiencyKmpl = null, pricePerLiter = null } = {}) {
  const distance = validKm(distanceKm);
  if (distance === null) return { liters: null, cost: null, basis: "unavailable", reason: "no-distance" };
  const efficiency = efficiencyKmpl === null || efficiencyKmpl === undefined || efficiencyKmpl === ""
    ? null
    : Number(efficiencyKmpl);
  if (!Number.isFinite(efficiency) || efficiency <= 0) {
    return { liters: null, cost: null, basis: "unavailable", reason: "no-efficiency" };
  }
  const price = pricePerLiter === null || pricePerLiter === undefined || pricePerLiter === ""
    ? null
    : Number(pricePerLiter);
  if (!Number.isFinite(price) || price <= 0) {
    return { liters: null, cost: null, basis: "unavailable", reason: "no-price" };
  }
  const liters = roundTo(distance / efficiency, 3);
  return { liters, cost: roundTo(liters * price, 2), basis: "measured", reason: null };
}
