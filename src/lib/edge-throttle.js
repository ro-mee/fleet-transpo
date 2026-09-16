// Best-effort per-instance flood guard for /api/* (wired in src/proxy.js).
//
// DELIBERATE LIMITS, do not "harden" without reading this:
// - Per-instance memory: with N instances the effective cap is ~N x EDGE_LIMIT.
//   This blunts single-source floods, not botnets. That is all it claims.
// - FAIL-OPEN: any internal error allows the request. This guards the whole
//   API's availability; failing closed here would turn a Map bug into a
//   self-inflicted outage. Credential paths keep their fail-closed DB throttles.
export const EDGE_LIMIT = 600;
export const EDGE_WINDOW_MS = 60_000;
const MAX_BUCKETS = 5_000;

const buckets = new Map();

export function checkEdgeThrottle(ip, nowMs = Date.now()) {
  try {
    const key = String(ip || "unknown");
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs) {
      if (buckets.size >= MAX_BUCKETS && !buckets.has(key)) {
        const oldest = buckets.keys().next().value;
        buckets.delete(oldest);
      }
      buckets.set(key, { count: 1, resetAt: nowMs + EDGE_WINDOW_MS });
      return { allowed: true, retryAfter: 0 };
    }
    bucket.count += 1;
    if (bucket.count > EDGE_LIMIT) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - nowMs) / 1000)) };
    }
    return { allowed: true, retryAfter: 0 };
  } catch {
    return { allowed: true, retryAfter: 0 };
  }
}
