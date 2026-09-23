// TomTom implementation of the AddressGeocoder interface.
//
// Uses the SERVER key (TOMTOM_API_KEY) for everything. The public key that ships
// in the browser bundle is for raster tiles and static images only — address
// search and geocoding run server-side so the query, and the key that authorises
// it, never leave the server. The browser talks to /api/address/*, not to TomTom.
//
// Both calls fail open to null / []: a provider outage degrades the address
// field to "type it manually", which still saves. Nothing here throws on a
// network error, because a geocoder being down must not block a dispatcher.

import { getServerKey } from "@/lib/tomtom";
import { parseSearchResponse, parseReverseResponse, toAddressValue } from "../parse";

const PROVIDER = "tomtom";
const SEARCH_TIMEOUT_MS = 3000;
const PLACE_TIMEOUT_MS = 3000;

// Suggestions are keystroke-driven, so the same prefix is requested repeatedly
// as someone types, deletes and retypes. A short in-process cache turns that
// into one provider call without ever serving a stale *selection* — a place
// lookup (`geocode`) is a different endpoint with its own, shorter cache.
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MAX_LIMIT = 10;

/** Shortest query worth a provider call. Two characters matches half a city. */
export const MIN_QUERY_LENGTH = 3;

const searchCache = new Map(); // key -> { expiresAt, suggestions }

function cacheGet(key, now) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= now) {
    searchCache.delete(key);
    return null;
  }
  return hit.suggestions;
}

function cacheSet(key, suggestions, now) {
  // Bounded so a long-lived server instance cannot grow an unbounded Map from
  // user input. Insertion-ordered, so the first key is the oldest.
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = searchCache.keys().next().value;
    if (oldest !== undefined) searchCache.delete(oldest);
  }
  searchCache.set(key, { expiresAt: now + CACHE_TTL_MS, suggestions });
}

/** Test seam — keeps one suite's cache from leaking into the next. */
export function clearSearchCache() {
  searchCache.clear();
}

/**
 * Normalise a query into a cache key. Case and internal spacing do not change
 * what a search returns, so they should not each cost a provider call.
 * @param {string} query
 */
function cacheKey(query, bias) {
  const normalized = String(query).trim().replace(/\s+/g, " ").toLowerCase();
  const lat = Number(bias?.lat);
  const lon = Number(bias?.lon);
  const biasKey = Number.isFinite(lat) && Number.isFinite(lon)
    ? `@${lat.toFixed(2)},${lon.toFixed(2)}`
    : "";
  return `${normalized}${biasKey}`;
}

/**
 * TomTom Search API v2 — typeahead URL.
 * `countrySet=PH` scopes results to the Philippines, which is the whole point of
 * choosing a provider per deployment rather than accepting global results.
 *
 * @param {string} query
 * @param {{ lat?: number, lon?: number, limit?: number }} [opts]
 */
export function buildSearchUrl(query, opts = {}) {
  const key = getServerKey();
  const params = new URLSearchParams({
    key,
    countrySet: "PH",
    typeahead: "true",
    limit: String(Math.min(Math.max(Number(opts.limit) || 5, 1), MAX_LIMIT)),
  });
  const lat = Number(opts.lat);
  const lon = Number(opts.lon);
  // A bias, not a filter: it ranks nearby matches first without excluding a
  // valid address somewhere else in the country.
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    params.set("lat", String(lat));
    params.set("lon", String(lon));
  }
  return `https://api.tomtom.com/search/2/search/${encodeURIComponent(query)}.json?${params.toString()}`;
}

/**
 * TomTom Search API v2 — resolve one place id back to a full address.
 * @param {string} placeId
 */
export function buildPlaceUrl(placeId) {
  const key = getServerKey();
  const params = new URLSearchParams({ key, entityId: String(placeId) });
  return `https://api.tomtom.com/search/2/place.json?${params.toString()}`;
}

/**
 * Typeahead suggestions. Returns [] rather than throwing on any failure.
 *
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.lat] / [opts.lon]  proximity bias
 * @param {typeof fetch} [opts.fetchImpl]   injectable for tests
 * @param {number} [opts.now]               injectable clock for tests
 * @returns {Promise<Array<{ placeId: string, label: string, secondary: string }>>}
 */
export async function search(query, opts = {}) {
  const trimmed = String(query ?? "").trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return [];
  if (!getServerKey()) return [];

  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const key = cacheKey(trimmed, opts);
  const cached = cacheGet(key, now);
  if (cached) return cached;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let suggestions = [];
  try {
    const response = await fetchImpl(buildSearchUrl(trimmed, opts), {
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (response?.ok) suggestions = parseSearchResponse(await response.json());
  } catch {
    suggestions = []; // timeout / network / parse — fail open
  }

  // Failures are cached too, so a provider outage is not hammered once per
  // keystroke for every operator simultaneously.
  cacheSet(key, suggestions, now);
  return suggestions;
}

/**
 * Resolve a place id to a full AddressValue using the provider's OWN data.
 *
 * This is the only path that produces `verified: true` for a stored record.
 * The server calls it with a `providerPlaceId`; client-supplied coordinates are
 * never forwarded here, which is what makes a hand-crafted `verified: true`
 * payload worthless.
 *
 * @param {string} placeId
 * @param {object} [opts]
 * @param {string} [opts.rawInput]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<object|null>}
 */
export async function geocode(placeId, opts = {}) {
  const id = String(placeId ?? "").trim();
  if (!id || !getServerKey()) return null;

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(buildPlaceUrl(id), {
      signal: AbortSignal.timeout(PLACE_TIMEOUT_MS),
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    // place.json returns a bare result object, not a `results` array.
    const result = Array.isArray(payload?.results) ? payload.results[0] : payload;
    if (!result?.address) return null;
    return toAddressValue({
      address: result.address,
      position: result.position,
      id: result.id ?? id,
      rawInput: opts.rawInput,
      provider: PROVIDER,
    });
  } catch {
    return null;
  }
}

/**
 * Coordinates -> AddressValue.
 *
 * Deliberately NOT sharing `src/lib/geo/reverse-geocode.js`, despite both
 * calling TomTom's reverse endpoint. That module answers a different question —
 * "which city is the driver in?", for the mobile weather chip — and caches a
 * place NAME against a coarse 0.1-degree grid for 24 h. Reusing it here would
 * mean either widening its cache to hold full addresses (changing the semantics
 * of a module that serves an unrelated feature) or losing the postal components
 * this one exists to capture. The overlap is one URL, not one implementation;
 * parse.js carries the address-shaped parsing and that is the part worth having
 * exactly once.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<object|null>}
 */
export async function reverse(latitude, longitude, opts = {}) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (!getServerKey()) return null;

  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const params = new URLSearchParams({ key: getServerKey() });
    const response = await fetchImpl(
      `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lon}.json?${params.toString()}`,
      { signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) }
    );
    if (!response?.ok) return null;
    return parseReverseResponse(await response.json(), opts.rawInput);
  } catch {
    return null;
  }
}

export const tomtomProvider = Object.freeze({
  name: PROVIDER,
  search,
  geocode,
  reverse,
});
