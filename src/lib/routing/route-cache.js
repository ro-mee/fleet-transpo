// Short-TTL in-memory cache for live TomTom route summaries.
//
// Why: the recommendation path can ask for several driver→pickup ETAs per
// request. Without caching, one panel open = N live routing calls (API cost +
// latency). The key rounds coordinates (~11 m at 4 decimals) and buckets the
// departure time into 10-minute windows so near-simultaneous callers share one
// provider response. Entries expire after ROUTE_CACHE_TTL_MS.
//
// Provenance contract (shared with the feasibility context service):
//   "live"     — fresh provider response
//   "cached"   — served from this cache (still fresh within TTL)
//   "snapshot" — canonical route / stored estimate, not a live call
//   "fallback" — heuristic (haversine @ 25 km/h), no provider data
//   "unknown"  — nothing usable; caller must fail open

export const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
export const ROUTE_CACHE_BUCKET_MIN = 10;

const store = new Map();

function roundCoord(value) {
  return Number(Number(value).toFixed(4));
}

/** Bucket a timestamp to the start of its N-minute window (epoch ms). */
export function bucketDepartAt(value, bucketMin = ROUTE_CACHE_BUCKET_MIN) {
  const ms = new Date(value).getTime();
  if (!Number.isFinite(ms)) return null;
  const size = Math.max(1, Number(bucketMin)) * 60 * 1000;
  return Math.floor(ms / size) * size;
}

export function buildRouteCacheKey(origin, destination, opts = {}) {
  const o = Array.isArray(origin) ? origin : [origin?.lat, origin?.lng];
  const d = Array.isArray(destination) ? destination : [destination?.lat, destination?.lng];
  if (!o || !d) return null;
  const nums = [...o, ...d].map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  if (Math.abs(nums[0]) > 90 || Math.abs(nums[2]) > 90) return null;
  if (Math.abs(nums[1]) > 180 || Math.abs(nums[3]) > 180) return null;
  const bucket = opts.departAt != null && opts.departAt !== ""
    ? bucketDepartAt(opts.departAt, opts.bucketMin)
    : "no-depart";
  if (opts.departAt != null && opts.departAt !== "" && bucket == null) return null;
  const alt = Math.min(2, Math.max(0, Math.floor(Number(opts.maxAlternatives) || 0)));
  return [
    roundCoord(nums[0]), roundCoord(nums[1]),
    roundCoord(nums[2]), roundCoord(nums[3]),
    bucket, `alt${alt}`,
  ].join("|");
}

export function getCachedRoute(origin, destination, opts = {}) {
  const key = buildRouteCacheKey(origin, destination, opts);
  if (!key) return null;
  const entry = store.get(key);
  if (!entry) return null;
  const ttl = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : ROUTE_CACHE_TTL_MS;
  if (Date.now() - entry.cachedAt > ttl) {
    store.delete(key);
    return null;
  }
  return { ...entry.value, provenance: "cached" };
}

export function setCachedRoute(origin, destination, value, opts = {}) {
  const key = buildRouteCacheKey(origin, destination, opts);
  if (!key || value == null) return null;
  store.set(key, { value: { ...value }, cachedAt: Date.now() });
  return key;
}

export function clearRouteCache() {
  store.clear();
}
