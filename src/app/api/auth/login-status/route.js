import { peekRateLimit, clientIp } from "@/lib/rate-limit";

// Public, read-only login-throttle status. NextAuth collapses every failed
// authorize() into the generic "CredentialsSignin" code client-side, which made
// a locked-out user see "Invalid email or password". The login page calls this
// after a failure to tell a rate-limited visitor the truth — including how long
// until they can retry. GET only; it never consumes a throttle hit.
export async function GET(req) {
  const ip = clientIp(req);
  const { allowed, retryAfter } = await peekRateLimit(`login:ip:${ip}`, { limit: 5, windowMs: 60_000 });
  return Response.json({ locked: !allowed, retryAfterSec: retryAfter });
}
