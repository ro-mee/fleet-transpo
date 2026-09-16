import { peekRateLimit, clientIp } from "@/lib/rate-limit";
import { checkAccountLockout } from "@/lib/auth/account-lockout";

// Public, read-only login-throttle status. NextAuth collapses every failed
// authorize() into the generic "CredentialsSignin" code client-side, which made
// a locked-out user see "Invalid email or password". The login page calls this
// after a failure to tell a rate-limited visitor the truth — including how long
// until they can retry. GET only; it never consumes a throttle hit.
//
// Query: ?email= (optional). When present, the per-account lockout bucket is
// peeked too, so an account-frozen user gets their own countdown instead of
// the generic message. Only a locked state is ever revealed (locked:true +
// seconds); an unlocked account always answers locked:false, so the endpoint
// is not an account-existence oracle.
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
  return Response.json({ locked: !ipBucket.allowed, retryAfterSec: ipBucket.retryAfter, reason: "ip" });
}
