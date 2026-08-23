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

/**
 * Read-only check — does NOT consume a hit. Used by the public login-status
 * endpoint so the UI can tell a locked-out user the truth (and how long is
 * left) even though NextAuth collapses every authorize() failure into
 * "CredentialsSignin" client-side.
 */
export function peekRateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, remaining: limit, retryAfter: 0 };
  }
  return {
    allowed: bucket.count < limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfter: Math.ceil((bucket.resetAt - now) / 1000),
  };
}

/** Matches IPv4, IPv6, and optional ":port" suffixes on dotted quads. */
const IP_LIKE = /^[0-9a-fA-F:.]+$/;

/**
 * Best-effort client IP from a Next.js request's headers.
 *
 * x-forwarded-for is "client, proxy1, proxy2" — the LEFTMOST entry is what the
 * client sent itself and is trivially spoofable. The rightmost entry is the
 * one appended by the nearest trusted proxy, so that is what we key rate
 * limits on. Without a trusted proxy in front of the app neither header can be
 * fully trusted; rightmost-XFF is still strictly harder to spoof than first-XFF.
 */
export function clientIp(req) {
  const xff = req.headers?.get?.("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((s) => s.trim()).filter(Boolean);
    let nearest = hops[hops.length - 1];
    if (nearest) {
      nearest = nearest.replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/, "$1");
      if (IP_LIKE.test(nearest)) return nearest;
    }
  }
  const real = req.headers?.get?.("x-real-ip");
  if (real && IP_LIKE.test(real.trim())) return real.trim();
  return "unknown";
}
