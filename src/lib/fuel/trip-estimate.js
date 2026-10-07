/**
 * Trip fuel estimates (Release D Task 11).
 *
 * Pure math over captured inputs. `estimated_fuel_l` is NOT measured burn and
 * is never written to the legacy `fuel_consumed` column, which keeps its
 * meaning unchanged. Missing basis yields null with a reason — never 0 and
 * never a fabricated actual.
 *
 * Decimal handling: litres round to 3 dp, cost to 2 dp (round-half-up via
 * exact decimal integer ratios), and cost derives from the ROUNDED litres so
 * ledger arithmetic reconciles exactly.
 */

const fraction = (value) => {
  const [mantissa, exponent = "0"] = String(value).toLowerCase().split("e");
  const [whole, decimals = ""] = mantissa.split(".");
  const scale = decimals.length - Number(exponent);
  const numerator = BigInt(whole + decimals);
  return scale >= 0 ? [numerator, 10n ** BigInt(scale)] : [numerator * 10n ** BigInt(-scale), 1n];
};
const halfUp = (numerator, denominator) => (2n * numerator + denominator) / (2n * denominator);

const validKm = (value) => {
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
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
  const efficiency = validKm(efficiencyKmpl);
  if (!Number.isFinite(efficiency) || efficiency <= 0) {
    return { liters: null, cost: null, basis: "unavailable", reason: "no-efficiency" };
  }
  const price = validKm(pricePerLiter);
  if (!Number.isFinite(price) || price <= 0) {
    return { liters: null, cost: null, basis: "unavailable", reason: "no-price" };
  }
  const [kmNumerator, kmDenominator] = fraction(distance);
  const [effNumerator, effDenominator] = fraction(efficiency);
  const [priceNumerator, priceDenominator] = fraction(price);
  const milliliters = halfUp(kmNumerator * effDenominator * 1000n, kmDenominator * effNumerator);
  const cents = halfUp(milliliters * priceNumerator * 100n, 1000n * priceDenominator);
  if (milliliters > 999999999999n || cents > 999999999999n) return { liters: null, cost: null, basis: "unavailable", reason: "out-of-range" };
  return { liters: Number(milliliters) / 1000, cost: Number(cents) / 100, basis: "measured", reason: null };
}
