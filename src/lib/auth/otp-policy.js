/**
 * Email OTP policy constants.
 *
 * Dependency-free on purpose, for the same reason `session-policy.js` is: the
 * `"use client"` login modal needs the digit count, the attempt ceiling and the
 * resend cooldown to render its copy and its countdown, and it must not pull in
 * `@/lib/db` to get them. Server code imports from here too, so the two cannot
 * disagree about how long a code lives.
 *
 * See Authentication.md for the contract this implements.
 */

/** Digits in a login code. Six keeps the existing six-cell modal geometry. */
export const OTP_CODE_DIGITS = 6;

/**
 * How long an emailed login code stays valid.
 *
 * Five minutes is short by design. The code is a bearer credential sitting in
 * an inbox that the server does not control, and a plain SHA-256 digest of a
 * six-digit value is enumerable offline in well under a second — so the hash is
 * not the protection. The short window and the attempt ceiling are.
 */
export const OTP_TTL_SECONDS = 300;

/**
 * Failed verifications allowed against one challenge before it is burned.
 * Five attempts against a 10^6 space leaves a 5-in-a-million guess chance.
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Minimum gap between self-service code sends for one account. Re-submitting
 * the sign-in form is the resend path, so this is what stops a locked-out user
 * (or anyone who has the password) from turning the SMTP transport into a
 * mailbomb aimed at one inbox.
 */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/**
 * How long an administrator-issued emergency code stays valid. Longer than a
 * self-service code because it has to survive being read aloud over a phone
 * call, and it never travels by email — an operator reads it off the screen.
 */
export const OTP_BREAK_GLASS_TTL_SECONDS = 900;

/** Compact human label for the ttl, for UI copy. */
export function describeOtpTtl(seconds) {
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} seconds`;
}

/**
 * Reserved and non-routable domains. Mail addressed to these cannot be
 * delivered, so the failure is loud: no code is sent and the login is refused.
 * `fleetops.com` is in here because it is the seeded placeholder domain — the
 * project does not own it, so a code "sent" there would go nowhere.
 */
const UNDELIVERABLE_DOMAIN =
  /(^|\.)(example\.com|example\.org|example\.net|invalid|test|localhost|local|fleetops\.com|harness)$/i;

/**
 * Whether an address is worth handing to the SMTP transport at all.
 *
 * This is a *deliverability* check, not an ownership check. It answers "will
 * this bounce?" and deliberately says nothing about whether the mailbox belongs
 * to the employee — an address that is routable but belongs to a stranger is
 * worse than one that is not routable, and no amount of code can tell the two
 * apart. That question is answered out of band by
 * `scripts/audit-otp-inbox-ownership.mjs`, which keeps its own copy of this
 * pattern because scripts cannot import from `src/` (no `"type": "module"`).
 *
 * Both the web and mobile login gates refuse the sign-in when this returns
 * false. There is no fallback that lets the login through.
 */
export function isDeliverableEmailAddress(email) {
  const address = String(email ?? "").trim().toLowerCase();
  if (!address) return false;
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return false;
  const domain = address.slice(at + 1);
  if (!domain.includes(".")) return false;
  return !UNDELIVERABLE_DOMAIN.test(domain);
}

/**
 * Hides the mailbox name but keeps the domain legible: `zara••••••••@gmail.com`.
 *
 * The domain is the part worth reading. Email OTP turns `employees.email` into a
 * security-critical field, and the failure that matters here is an account whose
 * address is real but belongs to somebody else — a stranger's Gmail. A user who
 * sees `••••@gmail.com` when their address is at `@yahoo.com` has just been told
 * their login code is going to the wrong place, and that is a fact they can act
 * on. Masking the domain too would hide exactly the signal worth showing.
 */
export function maskEmailAddress(email) {
  const address = String(email ?? "").trim();
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return address;
  const local = address.slice(0, at);
  const head = local.slice(0, 2);
  return `${head}${"•".repeat(Math.max(3, local.length - head.length))}@${address.slice(at + 1)}`;
}
