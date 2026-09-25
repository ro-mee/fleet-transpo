import { peekRateLimit, clientIp } from "@/lib/rate-limit";
import { checkAccountLockout } from "@/lib/auth/account-lockout";

// Public, read-only login-throttle status. NextAuth collapses every failed
// authorize() into the generic "CredentialsSignin" code client-side, which made
// a locked-out user see "Invalid email or password". The login page calls this
// after a failure to tell a rate-limited visitor the truth — including how long
// until they can retry. GET only; it never consumes a throttle hit.
//
// Query: ?email= (optional). When present, the per-account password lockout is
// peeked too, so a frozen account gets its own countdown instead of the generic
// message. Only a locked state is ever revealed (locked:true + seconds); an
// unlocked or unknown account always answers locked:false, so the endpoint is
// not an account-existence oracle.
//
// The account-level OTP lockout is deliberately NOT surfaced here. Answering
// `locked:true` for it needs the email resolved to an employee_id first, so the
// answer becomes conditional on the account existing — a public, unthrottled
// existence oracle for as long as a lock stands. The locked-out password-holder
// instead receives `OTP_LOCKED:<seconds>` directly from authorize (web) or the
// mobile 429, carrying the same countdown; this endpoint keeps its total,
// always-answerable contract.
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
