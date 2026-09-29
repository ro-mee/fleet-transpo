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
 * Three attempts against a 10^6 space leaves a 3-in-a-million guess chance,
 * and the account-level lockout below compounds it. The ceiling is not what
 * protects the code — the TTL above and the freeze below are — so it is kept
 * deliberately tight: every burned challenge costs the password again.
 */
export const OTP_MAX_ATTEMPTS = 3;

/**
 * Burned challenges allowed against one ACCOUNT before every code request and
 * verification is frozen for `OTP_LOCKOUT_WINDOW_MS`.
 *
 * The per-challenge ceiling above resets on each resend, so it alone cannot
 * stop a password holder looping `issue → 3 guesses → issue`; this is what
 * stops that loop. Three burns is nine wrong codes per fixed window — against
 * a 10^6 space that is roughly one guess every two minutes.
 */
export const OTP_LOCKOUT_LIMIT = 3;

/** Fixed window, measured from the account's first burn inside it. */
export const OTP_LOCKOUT_WINDOW_MS = 15 * 60_000;

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

/** Wire prefix of the account-lock token both login channels speak. */
export const OTP_LOCKED_PREFIX = "OTP_LOCKED:";

/**
 * Seconds from an `OTP_LOCKED:<seconds>` token, or null for anything else.
 *
 * Copy belongs to the client, so the server sends only the number. A caller
 * branches on `parseOtpLock(message) !== null` — one helper decides both the
 * branch and the countdown, and a malformed token falls through to the caller's
 * generic message instead of a bogus wait.
 */
export function parseOtpLock(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_LOCKED_PREFIX)) return null;
  const seconds = Number(message.slice(OTP_LOCKED_PREFIX.length));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

/** Wire prefix of the attempts-left token both login channels speak. */
export const OTP_ATTEMPTS_LEFT_PREFIX = "OTP_ATTEMPTS_LEFT:";

/** Wire prefix of the burn-strike token both login channels speak. */
export const OTP_STRIKE_PREFIX = "OTP_STRIKE:";

/**
 * Remaining attempts from an `OTP_ATTEMPTS_LEFT:<n>` token, or null for
 * anything else. Same contract as parseOtpLock: one helper decides both the
 * branch and the count, a malformed token falls through to the caller's
 * generic message, and the range is checked against the policy ceiling so a
 * corrupt token cannot show "7 attempts left" under a 3-attempt challenge.
 */
export function parseOtpAttemptsLeft(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_ATTEMPTS_LEFT_PREFIX)) return null;
  const count = Number(message.slice(OTP_ATTEMPTS_LEFT_PREFIX.length));
  return Number.isInteger(count) && count >= 1 && count <= OTP_MAX_ATTEMPTS ? count : null;
}

/**
 * Strike number (1..OTP_LOCKOUT_LIMIT) from an `OTP_STRIKE:<n>` token, or
 * null for anything else. The 3rd burn never carries this token — it carries
 * `OTP_LOCKED:<seconds>` — so 3 is accepted only as a defensive ceiling.
 */
export function parseOtpStrike(message) {
  if (typeof message !== "string" || !message.startsWith(OTP_STRIKE_PREFIX)) return null;
  const strike = Number(message.slice(OTP_STRIKE_PREFIX.length));
  return Number.isInteger(strike) && strike >= 1 && strike <= OTP_LOCKOUT_LIMIT ? strike : null;
}

/** "7 minutes" / "45 seconds" / "1 second" — the wait a locked-out user reads. */
export function formatLockWait(seconds) {
  const total = Math.max(1, Math.ceil(Number(seconds) || 0));
  if (total < 60) return `${total} second${total === 1 ? "" : "s"}`;
  const minutes = Math.ceil(total / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Copy for a wrong code while the challenge still has attempts left.
 *
 * Lives here, not in the three login surfaces, because they already drifted:
 * the web modal and the mobile login form told the user to request a new code
 * after the last failure and the mobile OTP screen — the one a driver actually
 * sees — did not. One helper, three callers, no way to ship two messages.
 *
 * The last attempt says what the next failure costs. Three wrong codes is the
 * number that burns the challenge and ends the MFA step, and a bare "1 attempt
 * left" does not tell them that.
 */
export function describeOtpAttemptsLeft(attemptsLeft) {
  const left = Number(attemptsLeft);
  const n = Number.isFinite(left)
    ? Math.min(OTP_MAX_ATTEMPTS, Math.max(1, Math.floor(left)))
    : OTP_MAX_ATTEMPTS;
  if (n === 1) {
    return "Incorrect code. 1 attempt left. One more wrong code cancels this code, and you'll need your password again for a new one.";
  }
  return `Incorrect code. ${n} attempt${n === 1 ? "" : "s"} left.`;
}

/**
 * Copy for the failure that burns the challenge, in three short lines:
 *
 *   1. what happened   — the code is cancelled, and why
 *   2. what to do      — the password again, because a strike ends the MFA step
 *   3. what it costs   — how many more cancelled codes lock the account
 *
 * Plain words on purpose. The wire token and the field are still `OTP_STRIKE`
 * / `strike`, but the screen never says "strike": the reader has just been told
 * their code was cancelled, so that is the thing counted, and "failed codes"
 * was actively wrong — three wrong codes cancel ONE code, so the number read a
 * third of its true size. The count still comes from `strike`, so the sentence
 * tracks the ladder: 1 of 3 → "2 more", 2 of 3 → "1 more", 3 of 3 → no warning
 * (that burn answers `OTP_LOCKED` before this copy is reached).
 *
 * Order is deliberate — the fact they can act on first, the deterrent second,
 * because a reader who stops after one line should still know what to do. The
 * lines are joined with `\n`; both surfaces render the string in a text block
 * (the web alert is `whitespace-pre-line`), and nothing is ever sent for the
 * user here, so the copy promises no code.
 */
export function describeOtpBurn({ strike } = {}) {
  const raw = Number(strike);
  const n = Number.isFinite(raw)
    ? Math.min(OTP_LOCKOUT_LIMIT, Math.max(1, Math.floor(raw)))
    : 1;
  const more = OTP_LOCKOUT_LIMIT - n;
  const windowMinutes = Math.round(OTP_LOCKOUT_WINDOW_MS / 60_000);
  const consequence =
    more > 0
      ? ` — ${more} more will lock this account for ` +
        `${windowMinutes} minute${windowMinutes === 1 ? "" : "s"}.`
      : ".";
  return (
    `Your code was cancelled after ${OTP_MAX_ATTEMPTS} wrong codes.\n` +
    "Enter your password again to get a new code.\n" +
    `Cancelled code ${n} of ${OTP_LOCKOUT_LIMIT}${consequence}`
  );
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
