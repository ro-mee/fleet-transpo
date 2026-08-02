// In-memory, per-key fixed-window rate limiter. Zero dependencies.
// NOTE: state is per-process. This is intentionally lightweight for a
// single-instance deployment; it does not coordinate across serverless
// instances. Good enough to blunt brute-force/credential-stuffing.

const buckets = new Map(); // key -> { count, resetAt }

let lastSweep = 0;
function sweep(now) {
  // Opportunistically drop expired buckets so the Map doesn't grow forever.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Consume one hit against `key`. Returns { allowed, remaining, retryAfter }.
 * @param {string} key       Unique bucket key (e.g. `login:${ip}`).
 * @param {object} [opts]
 * @param {number} [opts.limit]      Max hits per window (default 10).
 * @param {number} [opts.windowMs]   Window length in ms (default 60000).
 */
export function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();
  sweep(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { allowed: true, remaining: limit - bucket.count, retryAfter: 0 };
}

/** Best-effort client IP from a Next.js request's headers. */
export function clientIp(req) {
  const xff = req.headers?.get?.("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers?.get?.("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
