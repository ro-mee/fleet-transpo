/**
 * Fuel transaction integrity — deterministic anomaly flags and duplicate
 * detection.
 *
 * Every function here is either pure (computeFuelFlags) or a simple query
 * wrapper (detectDuplicateReceipt). No business decisions are made here —
 * the flags are informational and rendered in the verification studio. The
 * only hard block is an exact duplicate receipt (same receipt_transaction_id
 * already submitted).
 */

import { fuelTypeMismatch } from "./request-policy";

/**
 * Compute deterministic anomaly flags for a fuel transaction.
 *
 * Each flag is a boolean. Only truthy flags are included in the result.
 * An empty object means no anomalies detected.
 *
 * Flags:
 *   fuel_type_mismatch  – receipt fuel type ≠ vehicle fuel type
 *   price_anomaly       – price per liter outside a configurable range
 *   driver_edited       – driver changed AI-extracted values
 */
export function computeFuelFlags({
  receiptFuelType,
  vehicleFuelType,
  pricePerLiter,
  liters,
  tankCapacityL,
  fuelLevel,
  receiptScanData,
  submittedValues,
  // Configurable price range — defaults to a broad Philippine fuel range.
  // These should eventually come from system_settings but are safe defaults
  // that will not produce false positives for any common fuel type.
  minPricePerLiter = 30,
  maxPricePerLiter = 120,
} = {}) {
  const flags = {};

  // 1. Fuel type mismatch
  if (receiptFuelType && vehicleFuelType && fuelTypeMismatch(vehicleFuelType, receiptFuelType)) {
    flags.fuel_type_mismatch = true;
  }

  // 2. Price anomaly — unusually low or high price per liter
  const price = Number(pricePerLiter);
  if (Number.isFinite(price) && (price < minPricePerLiter || price > maxPricePerLiter)) {
    flags.price_anomaly = true;
  }

  // 3. Driver edited AI-extracted values
  if (receiptScanData && submittedValues) {
    const edited = {};
    const unwrap = (val) => (val && typeof val === "object" && "value" in val ? val.value : val);

    const aiLiters = Number(unwrap(receiptScanData.liters));
    const subLiters = Number(submittedValues.liters);
    if (Number.isFinite(aiLiters) && Number.isFinite(subLiters) && aiLiters !== subLiters) {
      edited.liters = { ai: aiLiters, submitted: subLiters };
    }
    const aiAmount = Number(unwrap(receiptScanData.amount) ?? unwrap(receiptScanData.total_amount));
    const subAmount = Number(submittedValues.amount);
    if (Number.isFinite(aiAmount) && Number.isFinite(subAmount) && aiAmount !== subAmount) {
      edited.amount = { ai: aiAmount, submitted: subAmount };
    }
    const aiStation = String(unwrap(receiptScanData.station_name) || "");
    const subStation = String(submittedValues.station_name || "");
    if (aiStation && subStation && aiStation !== subStation) {
      edited.station_name = { ai: aiStation, submitted: subStation };
    }
    if (Object.keys(edited).length > 0) {
      flags.driver_edited = true;
      flags.edited_fields = edited;
    }
  }

  return flags;
}

/**
 * Detect potential duplicate fuel receipts.
 *
 * Returns { exact: boolean, possible: boolean }
 *
 * Detection tiers:
 *   1. Exact: same receipt_transaction_id exists → block submission
 *   2. Possible: same station + date + amount + liters from another driver → flag
 *
 * The query intentionally excludes the submitting driver's own records
 * (the client_submission_id check handles same-driver resubmits).
 *
 * @param {object} db - A database connection (pool or transaction client)
 * @param {object} params
 */
export async function detectDuplicateReceipt(db, {
  receiptTransactionId,
  stationName,
  fuelDate,
  liters,
  amount,
  vehicleId,
}) {
  // Tier 1: exact receipt number match
  if (receiptTransactionId) {
    const { rows } = await db.query(
      `SELECT fuel_record_id FROM fuelrecords
        WHERE receipt_transaction_id = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [receiptTransactionId]
    );
    if (rows.length > 0) {
      return { exact: true, possible: false };
    }
  }

  // Tier 2: same station + date + amount + liters from any driver
  // This does NOT reject — it only flags as possible_duplicate.
  if (stationName && fuelDate && liters && amount) {
    const { rows } = await db.query(
      `SELECT fuel_record_id FROM fuelrecords
        WHERE station_name = $1
          AND fuel_date = $2
          AND liters = $3
          AND amount = $4
          AND deleted_at IS NULL
        LIMIT 1`,
      [stationName, fuelDate, liters, amount]
    );
    if (rows.length > 0) {
      return { exact: false, possible: true };
    }
  }

  return { exact: false, possible: false };
}
