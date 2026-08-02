// Shared service-token authentication for machine-to-machine endpoints
// (cron triggers, inbound integration webhooks). This is NOT user auth — it's a
// shared secret presented by a trusted caller. Fail-closed: if the expected
// secret is unset, authentication always fails.

// Length-constant compare to avoid leaking the secret via timing.
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Extract a presented token from Authorization: Bearer <t> or ?token=<t>. */
export function presentedToken(req) {
  const auth = req.headers?.get?.("authorization");
  if (auth && auth.startsWith("Bearer ")) return auth.slice(7).trim();
  try {
    const qp = new URL(req.url).searchParams.get("token");
    return qp ? qp.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Verify the request carries the expected shared secret.
 * @returns {{ ok: true } | { ok: false, status: number, message: string }}
 */
export function verifyServiceToken(req, expectedSecret) {
  if (!expectedSecret) {
    return { ok: false, status: 503, message: "This endpoint is not configured." };
  }
  const token = presentedToken(req);
  if (!token || !safeEqual(token, expectedSecret)) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
