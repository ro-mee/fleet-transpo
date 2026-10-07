/**
 * Fuel reference-price policy (Release D Task 10).
 *
 * Pure functions over snapshot rows. No SQL here: the table-touching
 * repository, permission-gated manual API/UI and contract registration are an
 * explicit apply-checkpoint follow-up (see the Task 10 handoff in
 * Capstone/02 - Features/Fuel.md). Landing them now would force a choice
 * between the unclassified-table gate and the phantom-table gate while
 * schema.sql cannot be refreshed without the live apply.
 *
 * A reference price is provenance-carrying context for ESTIMATES. It never
 * replaces a receipt pump price, and per-trip snapshots (Task 11) copy the
 * applicable value instead of linking to it — so a late correction never
 * silently reprices a completed trip.
 */

// Coarse typo-guard band in PHP/L (62.70 vs 627.0 transposition), not a market
// claim. Relative-change rejection against the prior price lives in the
// provider adapter (Task 12), which sees consecutive announcements.
export const REFERENCE_PRICE_MIN = 1;
export const REFERENCE_PRICE_MAX = 200;

export const VERIFICATION_METHODS = ["Manual", "Automatic"];

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

function validPrice(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < REFERENCE_PRICE_MIN || n > REFERENCE_PRICE_MAX) return null;
  return n;
}

function rowInstant(value) {
  if (value === null || value === undefined || value === "") return null;
  const t = value instanceof Date ? value : new Date(value);
  return t instanceof Date && !Number.isNaN(t.getTime()) ? t : null;
}

/**
 * The verified applicable snapshot for a fuel product, region and instant —
 * or null when no price applies (stale/absent is explicit, never 0).
 *
 * Eligible rows: matching product + region, `Active` lifecycle, effective at
 * or before the instant, finite in-band price, PHP/L units. Among several,
 * the latest effective_at wins; an exact-effective tie breaks on the later
 * record, deterministically.
 */
export function priceAt(snapshots, { fuelType, region, at } = {}) {
  const product = String(fuelType ?? "").trim();
  const place = String(region ?? "").trim();
  const instant = rowInstant(at);
  if (!product || !place || !instant) return null;

  let best = null;
  let bestEffective = -Infinity;
  let bestId = -Infinity;
  for (const row of Array.isArray(snapshots) ? snapshots : []) {
    if (row == null || typeof row !== "object") continue;
    if (String(row.fuel_product ?? "").trim() !== product) continue;
    if (String(row.region ?? "").trim() !== place) continue;
    if (row.lifecycle !== "Active") continue;
    if (!VERIFICATION_METHODS.includes(row.verification_method)) continue;
    if (row.currency !== "PHP" || row.unit !== "L") continue;
    if (validPrice(row.reference_price) === null) continue;
    const effective = rowInstant(row.effective_at);
    if (!effective || effective.getTime() > instant.getTime()) continue;
    const id = Number(row.snapshot_id);
    const rank = Number.isFinite(id) ? id : -Infinity;
    if (effective.getTime() > bestEffective || (effective.getTime() === bestEffective && rank > bestId)) {
      best = row;
      bestEffective = effective.getTime();
      bestId = rank;
    }
  }
  return best;
}

/**
 * Validate a manual snapshot submission before it reaches the (checkpoint)
 * repository. Returns { ok:true, value } or { ok:false, errors }.
 */
export function validateSnapshotInput(input = {}) {
  const errors = {};
  const product = String(input.fuel_product ?? "").trim();
  const place = String(input.region ?? "").trim();
  if (!product || product.length > 30) errors.fuel_product = "Fuel product is required (max 30 characters).";
  if (!place || place.length > 100) errors.region = "Region is required (max 100 characters).";

  const price = input.reference_price === null || input.reference_price === undefined || input.reference_price === ""
    ? null
    : Number(input.reference_price);
  if (price === null || !Number.isFinite(price) || price < REFERENCE_PRICE_MIN || price > REFERENCE_PRICE_MAX) {
    errors.reference_price = `Reference price must be between PHP ${REFERENCE_PRICE_MIN} and ${REFERENCE_PRICE_MAX} per litre.`;
  }

  if (rowInstant(input.effective_at) === null) errors.effective_at = "Effective-at must be a valid timestamp.";
  if (input.announced_at != null && input.announced_at !== "" && rowInstant(input.announced_at) === null) {
    errors.announced_at = "Announced-at must be a valid timestamp.";
  }
  const url = String(input.source_url ?? "").trim();
  if (!url || url.length > 2000 || !/^https?:\/\/\S+$/i.test(url)) {
    errors.source_url = "An official http(s) source URL is required.";
  }
  if (!VERIFICATION_METHODS.includes(input.verification_method)) {
    errors.verification_method = "Verification method must be Manual or Automatic.";
  }
  if (input.verification_method === "Manual" && (input.verified_by === null || input.verified_by === undefined)) {
    errors.verified_by = "Manual snapshots require the verifier identity.";
  }
  if (input.verification_method === "Automatic" && isBlank(input.source_hash)) {
    errors.source_hash = "Automatic snapshots require the ingestion event/source hash.";
  }
  if (input.lifecycle != null && !["Pending", "Active", "Historical"].includes(input.lifecycle)) {
    errors.lifecycle = "Lifecycle must be Pending, Active or Historical.";
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      fuel_product: product,
      region: place,
      reference_price: price,
      prior_price: input.prior_price == null || input.prior_price === "" ? null : Number(input.prior_price),
      announced_at: input.announced_at ?? null,
      effective_at: input.effective_at,
      fetched_at: input.fetched_at ?? null,
      source_url: url,
      verification_method: input.verification_method,
      lifecycle: input.lifecycle ?? "Pending",
      source_hash: isBlank(input.source_hash) ? null : String(input.source_hash),
      verified_by: input.verified_by ?? null,
    },
  };
}
