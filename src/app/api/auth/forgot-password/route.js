import { ok, err, handleError } from "@/lib/api/utils";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * POST /api/auth/forgot-password
 *
 * Public (pre-auth) endpoint. Replaces the old browser-side Supabase anon-key
 * lookup, which let anyone enumerate accounts via the public anon key.
 *
 * The response is identical whether or not the email exists, so this endpoint
 * cannot be used to enumerate accounts, and the existence check stays
 * server-side. Rate-limited per IP and per email.
 *
 * NOTE: no email provider is configured. An authorized administrator issues a
 * one-time link through POST /api/auth/reset-token until verified delivery is
 * available.
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const email = (body?.email || "").toString().toLowerCase().trim();
    if (!email) return err("Email is required", 400);

    const [ipBucket, accountBucket] = await Promise.all([
      rateLimit(`forgot-password:ip:${clientIp(req)}`, { limit: 5, windowMs: 60_000 }),
      rateLimit(`forgot-password:account:${email}`, { limit: 5, windowMs: 60_000 }),
    ]);
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    return ok({ message: "If an account exists for that email, contact your FleetOps administrator to receive a reset link." });
  } catch (e) { return handleError(e); }
}
