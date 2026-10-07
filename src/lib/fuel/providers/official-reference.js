/**
 * Official fuel-price provider adapter (Release D Task 12).
 *
 * Fetch → parse → validate → Pending snapshot. The adapter NEVER writes: a
 * validated announcement becomes a Pending payload for the (checkpoint)
 * repository, which persists it; activation to Active happens once, at
 * effectivity, by the repository — never by re-fetching.
 *
 * No official machine-readable source is configured: until one is identified
 * and legally cleared, the scheduler stays disabled and manual verified
 * snapshots (Task 10) are the only source. Nothing here hardcodes a provider
 * URL — the source registry entry is activation config, and data from any
 * other origin is rejected as untrusted rather than parsed.
 *
 * Nothing in this module names a database table, so the schema-contract
 * gates are unaffected: persistence lives with the Task 10 repository.
 */

import { rowInstant } from "@/lib/fuel/price-policy";

const ALLOWED_KEYS = new Set([
  "fuel_product",
  "region",
  "reference_price",
  "prior_price",
  "announced_at",
  "effective_at",
  "source_url",
]);

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

function fail(message) {
  const e = new Error(message);
  e.code = "PROVIDER_FORMAT";
  throw e;
}

/**
 * Parse one provider announcement against its registry entry.
 *
 * @param {object} payload parsed JSON body
 * @param {{id:string, origin:string}} source activation-config registry entry
 * @returns normalized announcement (strings/numbers/dates, no trust attached)
 */
export function parseOfficialReference(payload, source) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    fail("Provider announcement must be a JSON object.");
  }
  if (source === null || typeof source !== "object" || isBlank(source.id) || isBlank(source.origin)) {
    fail("Unknown provider source: announcements from unregistered origins are rejected.");
  }
  let origin;
  try {
    origin = new URL(String(source.origin)).origin;
  } catch {
    fail("Unknown provider source: announcements from unregistered origins are rejected.");
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) fail(`Unsupported provider field: ${key}. The announcement format drifted — retaining the last verified snapshot.`);
  }

  const product = String(payload.fuel_product ?? "").trim();
  const region = String(payload.region ?? "").trim();
  if (!product || product.length > 30) fail("Provider announcement needs a fuel product.");
  if (!region || region.length > 100) fail("Provider announcement needs a region.");

  const price = Number(payload.reference_price);
  if (!Number.isFinite(price) || price <= 0) fail("Provider announcement needs a positive reference price.");
  let prior = null;
  if (payload.prior_price !== undefined && payload.prior_price !== null) {
    prior = Number(payload.prior_price);
    if (!Number.isFinite(prior) || prior <= 0) fail("Provider prior price is malformed.");
  }

  const effective = rowInstant(payload.effective_at);
  if (!(effective instanceof Date) || Number.isNaN(effective.getTime())) {
    fail("Provider announcement needs a valid effectivity timestamp.");
  }
  let announced = null;
  if (payload.announced_at !== undefined && payload.announced_at !== null) {
    announced = rowInstant(payload.announced_at);
    if (!(announced instanceof Date) || Number.isNaN(announced.getTime())) fail("Provider announced-at is malformed.");
  }

  // Trust is origin-bound: the URL must belong to the configured source, over
  // https. A payload pointing anywhere else is untrusted data and cannot
  // self-verify, however well-formed it looks.
  let url;
  try {
    url = new URL(String(payload.source_url ?? ""));
  } catch {
    fail("Provider announcement needs a source URL from the configured origin.");
  }
  if (url.protocol !== "https:" || url.origin !== origin) {
    fail("Provider announcement URL is outside the configured source origin.");
  }

  return {
    fuel_product: product,
    region,
    reference_price: price,
    prior_price: prior,
    announced_at: announced ? announced.toISOString() : null,
    effective_at: effective.toISOString(),
    source_url: url.toString(),
  };
}

// Relative plausibility band for consecutive announcements (a typo-guard, not
// a market claim): 620 from 62 is a 10x jump and is rejected for manual
// review, while ordinary adjustments pass.
const MIN_RATIO = 0.5;
const MAX_RATIO = 2.0;

/**
 * Decide whether a parsed announcement becomes a Pending snapshot.
 *
 * @returns {{accept:boolean, lifecycle?:string, reason?:string, duplicate?:boolean}}
 */
export function validateProviderUpdate({ current = null, candidate } = {}) {
  if (!candidate || typeof candidate !== "object") return { accept: false, reason: "No candidate announcement." };
  const price = Number(candidate.reference_price);
  const effective = candidate.effective_at instanceof Date ? candidate.effective_at : new Date(candidate.effective_at);
  if (!Number.isFinite(price) || price <= 0) return { accept: false, reason: "Candidate price is malformed." };
  if (!(effective instanceof Date) || Number.isNaN(effective.getTime())) {
    return { accept: false, reason: "Candidate effectivity is malformed." };
  }
  if (current && typeof current === "object") {
    const currentPrice = Number(current.reference_price);
    const currentEffective = current.effective_at instanceof Date ? current.effective_at : new Date(current.effective_at);
    if (Number.isFinite(currentPrice) && currentPrice > 0) {
      const ratio = price / currentPrice;
      if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
        return { accept: false, reason: `Implausible change ${currentPrice} → ${price}: held for manual review, last verified snapshot retained.` };
      }
    }
    if (currentEffective instanceof Date && !Number.isNaN(currentEffective.getTime())) {
      if (effective.getTime() === currentEffective.getTime()) {
        return { accept: false, reason: "Duplicate announcement: already recorded.", duplicate: true };
      }
      if (effective.getTime() < currentEffective.getTime()) {
        return { accept: false, reason: "Stale announcement: an older effectivity than the recorded one." };
      }
    }
  }
  // Announcements rest Pending until effectivity; activation happens once, in
  // the repository, and never by re-fetching.
  return { accept: true, lifecycle: "Pending" };
}

/**
 * Fetch one announcement document. Fail-closed transport: any non-200,
 * timeout, or malformed body resolves to { ok:false } so the caller retains
 * the last verified snapshot instead of acting on a gap.
 */
export async function fetchReferencePrice({ sourceUrl, fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requested = new URL(sourceUrl);
    if (requested.protocol !== "https:") return { ok: false, reason: "Provider URL must use HTTPS." };
    const res = await fetchImpl(sourceUrl, { signal: controller.signal, redirect: "error" });
    if (!res || res.ok !== true) {
      return { ok: false, reason: `Provider fetch failed (status ${res?.status ?? "unknown"}): retaining the last verified snapshot.` };
    }
    if (res.redirected || (res.url && new URL(res.url).origin !== requested.origin)) {
      return { ok: false, reason: "Provider response changed origin; retaining the last verified snapshot." };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    return { ok: false, reason: `Provider fetch failed (${e?.name === "AbortError" ? "timeout" : e?.message || "network"}): retaining the last verified snapshot.` };
  } finally {
    clearTimeout(timer);
  }
}
