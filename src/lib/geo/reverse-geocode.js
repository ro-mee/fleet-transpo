// Reverse geocoding (TomTom) for the mobile weather chip's place label.
//
// The chip shows WHERE the driver is (e.g. "Quezon City") rather than a
// condition string like "Heavy Drizzle" — the icon already carries the
// condition. Reuses the existing TomTom SERVER key (never shipped to the
// client), so no new provider account.
//
// Place names barely change: cached per coarse grid cell for 24 h, best-effort
// per server instance (same stance as the weather cache), fail-open to null —
// a missing place never breaks anything.
import { getServerKey } from "@/lib/tomtom";

const FETCH_TIMEOUT_MS = 2000;
// Same coarse grid as the weather cache so a ping and a place lookup for the
// same area share one cell identity. Approximate spacing — longitude distance
// varies with latitude.
const CELL_DEGREES = 0.1;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const cache = new Map(); // "lat,lng" → { expiresAt, place }

/**
 * Parse a TomTom reverse-geocode response into one place label.
 * Pure: no fetch, no cache — the vitest suite exercises this directly.
 * Preference: municipality → locality → countrySecondarySubdivision →
 * countrySubdivisionName. Null when nothing usable is present.
 * @returns {string|null}
 */
export function parsePlaceName(payload) {
  const address = payload?.addresses?.[0]?.address;
  if (!address) return null;
  const place =
    address.municipality ||
    address.locality ||
    address.countrySecondarySubdivision ||
    address.countrySubdivisionName ||
    null;
  if (place == null) return null;
  const trimmed = String(place).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cellKey(latitude, longitude) {
  const lat = Math.round(Number(latitude) / CELL_DEGREES) * CELL_DEGREES;
  const lng = Math.round(Number(longitude) / CELL_DEGREES) * CELL_DEGREES;
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

/**
 * The place name at a coordinate, or null. Coarse-grid cached for 24 h; the
 * provider call is capped at ~2 s and every failure resolves to null.
 *
 * @param {number} latitude
 * @param {number} longitude
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl]  injectable for tests
 */
export async function getPlaceName(latitude, longitude, opts = {}) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const key = getServerKey();
  if (!key) return null; // no routing/geocoding key configured — no place label

  const cacheKey = cellKey(lat, lng);
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.place;

  const fetchImpl = opts.fetchImpl ?? fetch;
  let place = null;
  try {
    const url =
      `https://api.tomtom.com/search/2/reverseGeocode/${lat},${lng}.json` +
      `?key=${encodeURIComponent(key)}`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (response?.ok) place = parsePlaceName(await response.json());
  } catch {
    place = null; // timeout / network / parse — fail open
  }

  cache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, place });
  return place;
}
