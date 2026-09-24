import { peekRateLimit, clientIp } from "@/lib/rate-limit";
import { query } from "@/lib/db";
import { checkAccountLockout } from "@/lib/auth/account-lockout";
import { checkOtpLockout } from "@/lib/auth/email-otp";

// Public, read-only login-throttle status. NextAuth collapses every failed
// authorize() into the generic "CredentialsSignin" code client-side, which made
// a locked-out user see "Invalid email or password". The login page calls this
// after a failure to tell a rate-limited visitor the truth — including how long
// until they can retry. GET only; it never consumes a throttle hit.
//
// Query: ?email= (optional). When present, the per-account password lockout AND
// the account-level OTP lockout (`lockout:otp:<employee_id>`) are peeked too, so
// a frozen account gets its own countdown instead of the generic message. Only
// a locked state is ever revealed (locked:true + seconds); an unlocked or
// unknown account always answers locked:false, so the endpoint is not an
// account-existence oracle.
export async function GET(req) {
  const ip = clientIp(req);
  const email = new URL(req.url).searchParams.get("email") || "";
  const [ipBucket, lockout] = await Promise.all([
    peekRateLimit(`login:ip:${ip}`, { limit: 5, windowMs: 60_000 }),
    email ? checkAccountLockout(email) : Promise.resolve({ allowed: true, retryAfter: 0 }),
  ]);
  if (!lockout.allowed) {
    return Response.json({ locked: true, retryAfterSec: lockout.retryAfter, reason: "account" });
  }
  if (email) {
    const { rows } = await query(
      `SELECT employee_id FROM employees
        WHERE email = $1 AND deleted_at IS NULL AND status = 'Active'`,
      [email.toLowerCase().trim()]
    );
    if (rows[0]) {
      const otp = await checkOtpLockout(rows[0].employee_id);
      if (!otp.allowed) {
        return Response.json({ locked: true, retryAfterSec: otp.retryAfter, reason: "otp" });
      }
    }
  }
  return Response.json({ locked: !ipBucket.allowed, retryAfterSec: ipBucket.retryAfter, reason: "ip" });
}
