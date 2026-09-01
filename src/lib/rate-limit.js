import { query } from "@/lib/db";

// Authentication throttles are persisted in PostgreSQL so a restart or a
// second application instance cannot reset the counters. The table is created
// by migration 087. A limiter database failure fails closed rather than
// silently allowing unthrottled credential attempts.

/**
 * Consume one hit against `key`. Returns { allowed, remaining, retryAfter }.
 * @param {string} key       Unique bucket key (e.g. `login:${ip}`).
 * @param {object} [opts]
 * @param {number} [opts.limit]      Max hits per window (default 10).
 * @param {number} [opts.windowMs]   Window length in ms (default 60000).
 */
export async function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  try {
    const { rows } = await query(
      `WITH cleanup AS (
         DELETE FROM auth_rate_limits
          WHERE updated_at < NOW() - INTERVAL '1 day'
       )
       INSERT INTO auth_rate_limits (bucket_key, window_started_at, hit_count, updated_at)
       VALUES ($1, NOW(), 1, NOW())
       ON CONFLICT (bucket_key) DO UPDATE
         SET hit_count = CASE
               WHEN auth_rate_limits.window_started_at + ($2::double precision * INTERVAL '1 millisecond') <= NOW()
                 THEN 1
               ELSE LEAST(auth_rate_limits.hit_count + 1, $3 + 1)
             END,
             window_started_at = CASE
               WHEN auth_rate_limits.window_started_at + ($2::double precision * INTERVAL '1 millisecond') <= NOW()
                 THEN NOW()
               ELSE auth_rate_limits.window_started_at
             END,
             updated_at = NOW()
       RETURNING hit_count,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM
           (window_started_at + ($2::double precision * INTERVAL '1 millisecond') - NOW())))::int) AS retry_after`,
      [String(key).slice(0, 512), windowMs, limit]
    );

    const hitCount = Number(rows[0]?.hit_count) || 1;
    const retryAfter = Number(rows[0]?.retry_after) || 0;
    return {
      allowed: hitCount <= limit,
      remaining: Math.max(0, limit - hitCount),
      retryAfter: hitCount <= limit ? 0 : retryAfter,
    };
  } catch (error) {
    console.error("Auth rate limiter unavailable:", error?.message || error);
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(windowMs / 1000) };
  }
}

/**
 * Read-only check — does NOT consume a hit. Used by the public login-status
 * endpoint so the UI can tell a locked-out user the truth (and how long is
 * left) even though NextAuth collapses every authorize() failure into
 * "CredentialsSignin" client-side.
 */
export async function peekRateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  try {
    const { rows } = await query(
      `SELECT hit_count,
         GREATEST(0, CEIL(EXTRACT(EPOCH FROM
           (window_started_at + ($2::double precision * INTERVAL '1 millisecond') - NOW())))::int) AS retry_after
         FROM auth_rate_limits
        WHERE bucket_key = $1`,
      [String(key).slice(0, 512), windowMs]
    );
    if (!rows[0] || Number(rows[0].retry_after) <= 0) {
      return { allowed: true, remaining: limit, retryAfter: 0 };
    }
    const hitCount = Number(rows[0].hit_count) || 0;
    return {
      allowed: hitCount < limit,
      remaining: Math.max(0, limit - hitCount),
      retryAfter: Number(rows[0].retry_after) || 0,
    };
  } catch (error) {
    console.error("Auth rate limiter unavailable:", error?.message || error);
    return { allowed: false, remaining: 0, retryAfter: Math.ceil(windowMs / 1000) };
  }
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
