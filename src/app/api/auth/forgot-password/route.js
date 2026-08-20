import { query } from "@/lib/db";
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
 * NOTE: no email provider is configured, so a real reset link is never
 * delivered — the reset itself is handled by the authenticated
 * POST /api/auth/reset-password flow.
 */
export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    const email = (body?.email || "").toString().toLowerCase().trim();
    if (!email) return err("Email is required", 400);

    const ipBucket = rateLimit(`forgot-password:${clientIp(req)}`, { limit: 5, windowMs: 60_000 });
    const accountBucket = rateLimit(`forgot-password:${email}`, { limit: 5, windowMs: 60_000 });
    if (!ipBucket.allowed || !accountBucket.allowed) {
      return err("Too many requests. Try again later.", 429);
    }

    // Existence check stays server-side; the response is identical either way.
    await query(
      `SELECT employee_id FROM employees WHERE email = $1 AND deleted_at IS NULL LIMIT 1`,
      [email]
    );

    return ok({ message: "If an account exists for that email, a reset link has been sent." });
  } catch (e) { return handleError(e); }
}