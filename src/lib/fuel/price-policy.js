/**
 * Fuel reference-price policy (Release D Task 10).
 *
 * Pure functions over snapshot rows. The server repository owns SQL and
 * effectivity transitions; the permission-gated review workflow supplies the
 * signed-in verifier. Its reviewed draft table has a separate pending schema
 * classification. Live schema/protection checks remain mandatory for release.
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
  if (!["number", "string"].includes(typeof value) || String(value).trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < REFERENCE_PRICE_MIN || n > REFERENCE_PRICE_MAX || Number(n.toFixed(2)) !== n) return null;
  return n;
}

export function rowInstant(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, sec, zone] = match;
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  if (+m < 1 || +m > 12 || +d < 1 || +d > days || +h > 23 || +min > 59 || +sec > 59) return null;
  if (zone !== "Z" && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59)) return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t;
}

export function hasVerification(row) {
  if (row.verification_method === "Manual") return ["number", "string"].includes(typeof row.verified_by) && Number.isSafeInteger(Number(row.verified_by)) && Number(row.verified_by) > 0;
  if (row.verification_method === "Automatic") return !isBlank(row.source_hash);
  return false;
}

/**
 * The verified applicable snapshot for a fuel product, region and instant —
 * or null when no price applies (stale/absent is explicit, never 0).
 *
 * Eligible rows: matching product + region, verified Active/Historical rows, effective at
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
    if (!["Active", "Historical"].includes(row.lifecycle)) continue;
    if (!hasVerification(row)) continue;
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
 * Validate a snapshot submission before it reaches the server
 * repository. Returns { ok:true, value } or { ok:false, errors }.
 */
export function validateSnapshotInput(input = {}) {
  const errors = {};
  const product = String(input.fuel_product ?? "").trim();
  const place = String(input.region ?? "").trim();
  if (!product || product.length > 30) errors.fuel_product = "Fuel product is required (max 30 characters).";
  if (!place || place.length > 100) errors.region = "Region is required (max 100 characters).";

  const price = validPrice(input.reference_price);
  if (price === null || !Number.isFinite(price) || price < REFERENCE_PRICE_MIN || price > REFERENCE_PRICE_MAX) {
    errors.reference_price = `Reference price must be between PHP ${REFERENCE_PRICE_MIN} and ${REFERENCE_PRICE_MAX} per litre.`;
  }

  if (rowInstant(input.effective_at) === null) errors.effective_at = "Effective-at must be a valid timestamp.";
  if (input.announced_at != null && input.announced_at !== "" && rowInstant(input.announced_at) === null) {
    errors.announced_at = "Announced-at must be a valid timestamp.";
  }
  const url = String(input.source_url ?? "").trim();
  let source;
  try { source = new URL(url); } catch { source = null; }
  if (!source || url.length > 2000 || !["https:", "http:"].includes(source.protocol) || source.username || source.password) {
    errors.source_url = "An official http(s) source URL is required.";
  }
  if (input.currency != null && input.currency !== "PHP") errors.currency = "Reference prices must use PHP.";
  if (input.unit != null && input.unit !== "L") errors.unit = "Reference prices must use liters.";
  if (!VERIFICATION_METHODS.includes(input.verification_method)) {
    errors.verification_method = "Verification method must be Manual or Automatic.";
  }
  if (input.verification_method === "Manual" && !hasVerification(input)) {
    errors.verified_by = "Manual snapshots require the verifier identity.";
  }
  if (input.verification_method === "Automatic" && isBlank(input.source_hash)) {
    errors.source_hash = "Automatic snapshots require the ingestion event/source hash.";
  }
  if (input.prior_price != null && input.prior_price !== "" && validPrice(input.prior_price) === null) errors.prior_price = "Prior price must be a valid PHP/L price.";
  if (input.fetched_at != null && rowInstant(input.fetched_at) === null) errors.fetched_at = "Fetched-at must include a valid calendar date and timezone.";
  if (input.source_hash != null && String(input.source_hash).length > 128) errors.source_hash = "Source hash exceeds 128 characters.";
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
