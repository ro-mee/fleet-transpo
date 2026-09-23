import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { withTransaction } from "@/lib/db";
import { recoveryCodeHash } from "@/lib/auth/mfa";
import {
  OTP_BREAK_GLASS_TTL_SECONDS,
  OTP_CODE_DIGITS,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_TTL_SECONDS,
} from "@/lib/auth/otp-policy";

/**
 * Server-only: reads and writes `email_otp_challenges` and `mfa_recovery_codes`,
 * so routes and the NextAuth `authorize` callback may import this, and client
 * components may not.
 *
 * The code never determines which login attempt it belongs to: only one
 * challenge per employee is ever live, because issuing a new one deletes the
 * previous. That is why no challenge id travels over the wire, and why
 * re-submitting the sign-in form is the resend path.
 */

export const OTP_PURPOSE_LOGIN = "login";
export const OTP_PURPOSE_BREAK_GLASS = "break_glass";

function ttlFor(purpose) {
  return purpose === OTP_PURPOSE_BREAK_GLASS ? OTP_BREAK_GLASS_TTL_SECONDS : OTP_TTL_SECONDS;
}

/** Strips the separators people type from a code read off a screen. */
function normalizeCode(code) {
  return String(code ?? "").replace(/[\s-]/g, "");
}

/**
 * A CSPRNG-backed six-digit code, zero-padded.
 *
 * `randomInt` is rejection-sampled by Node, so this is uniform over 000000 to
 * 999999 — a code is never biased toward a smaller number.
 */
export function generateOtpCode() {
  return String(randomInt(0, 10 ** OTP_CODE_DIGITS)).padStart(OTP_CODE_DIGITS, "0");
}

export function hashOtpCode(code) {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

/**
 * Compares two hex digests without leaking where they diverge.
 *
 * `timingSafeEqual` throws on a length mismatch, which would itself be an
 * oracle, so unequal lengths short-circuit to false.
 */
function digestsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/**
 * Issues the challenge for one employee, or explains why it would not.
 *
 * Returns one of:
 *   { ok: true,  code, expiresAt }          a fresh code was minted
 *   { ok: false, reason: "cooldown", retryAfterSeconds }
 *   { ok: false, reason: "break_glass_held" }  a live admin-issued code exists;
 *                                              do NOT email, prompt for that one
 *   { ok: false, reason: "no_account" }
 *
 * The break-glass branch is the one that matters. A locked-out user holding a
 * code an administrator read to them still has to submit the sign-in form, and
 * if that submission replaced their challenge with a mailed one, the code in
 * their hand would be dead and the email was the thing that could not reach
 * them in the first place. So an existing break-glass challenge is left alone.
 */
export async function issueLoginChallenge({ employeeId, purpose = OTP_PURPOSE_LOGIN, ip, userAgent }) {
  let outcome;
  await withTransaction(async (tx) => {
    const { rows: account } = await tx.query(
      `SELECT auth_version FROM employees
        WHERE employee_id = $1 AND deleted_at IS NULL AND status = 'Active'
        FOR UPDATE`,
      [employeeId]
    );
    if (!account[0]) {
      outcome = { ok: false, reason: "no_account" };
      return;
    }
    const authVersion = Number(account[0].auth_version);

    const { rows: live } = await tx.query(
      `SELECT challenge_id, purpose, created_at
         FROM email_otp_challenges
        WHERE employee_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        FOR UPDATE`,
      [employeeId]
    );

    const held = live.find((row) => row.purpose === OTP_PURPOSE_BREAK_GLASS);
    if (held) {
      outcome = { ok: false, reason: "break_glass_held" };
      return;
    }

    const previous = live[0];
    if (previous) {
      const { rows: age } = await tx.query(
        `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (NOW() - $1::timestamptz))))::int AS age_seconds`,
        [previous.created_at]
      );
      const elapsed = Number(age[0]?.age_seconds ?? 0);
      if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
        outcome = { ok: false, reason: "cooldown", retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - elapsed };
        return;
      }
    }

    // One live challenge per employee: retire every previous row so a code that
    // was already mailed cannot still be redeemed after a resend.
    await tx.query(
      `UPDATE email_otp_challenges
          SET consumed_at = NOW()
        WHERE employee_id = $1 AND consumed_at IS NULL`,
      [employeeId]
    );

    const code = generateOtpCode();
    const { rows: created } = await tx.query(
      `INSERT INTO email_otp_challenges
         (employee_id, code_hash, purpose, max_attempts, auth_version, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' seconds')::interval, $7, $8)
       RETURNING expires_at`,
      [
        employeeId,
        hashOtpCode(code),
        purpose,
        OTP_MAX_ATTEMPTS,
        authVersion,
        String(ttlFor(purpose)),
        ip ?? null,
        userAgent ? String(userAgent).slice(0, 500) : null,
      ]
    );

    outcome = { ok: true, code, expiresAt: created[0].expires_at, purpose };
  });
  return outcome;
}

/**
 * Verifies a login code against the employee's single live challenge, falling
 * back to a single-use recovery code. Consumes on success and burns the
 * challenge once the attempt ceiling is reached.
 *
 * Returns one of:
 *   { ok: true,  method: "otp" | "recovery" }
 *   { ok: false, reason: "expired" | "stale" | "invalid" | "attempts_exhausted",
 *     attemptsRemaining? }
 */
export async function verifyLoginChallenge({ employeeId, authVersion, code }) {
  let outcome;
  await withTransaction(async (tx) => {
    const { rows } = await tx.query(
      `SELECT challenge_id, code_hash, purpose, attempts, max_attempts, auth_version
         FROM email_otp_challenges
        WHERE employee_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
        FOR UPDATE`,
      [employeeId]
    );
    const challenge = rows[0];

    if (challenge) {
      // A challenge minted before a password/email/role/account change is not
      // redeemable after it — the shared auth lifecycle retires it here.
      if (Number(challenge.auth_version) !== Number(authVersion)) {
        await consume(tx, challenge.challenge_id);
        outcome = { ok: false, reason: "stale" };
        return;
      }
      if (Number(challenge.attempts) >= Number(challenge.max_attempts)) {
        await consume(tx, challenge.challenge_id);
        outcome = { ok: false, reason: "attempts_exhausted", attemptsRemaining: 0 };
        return;
      }
      if (digestsMatch(challenge.code_hash, hashOtpCode(code))) {
        await consume(tx, challenge.challenge_id);
        outcome = { ok: true, method: "otp" };
        return;
      }
    }

    // Recovery codes are independent of any challenge: they are the fallback
    // that works when the mail never arrives at all.
    const { rows: used } = await tx.query(
      `UPDATE mfa_recovery_codes
          SET used_at = NOW()
        WHERE recovery_code_id = (
          SELECT recovery_code_id
            FROM mfa_recovery_codes
           WHERE employee_id = $1 AND code_hash = $2 AND used_at IS NULL
           ORDER BY recovery_code_id
           LIMIT 1
           FOR UPDATE
        )
        RETURNING recovery_code_id`,
      [employeeId, recoveryCodeHash(code)]
    );
    if (used.length) {
      if (challenge) await consume(tx, challenge.challenge_id);
      outcome = { ok: true, method: "recovery" };
      return;
    }

    if (!challenge) {
      outcome = { ok: false, reason: "expired" };
      return;
    }

    // Neither matched: count it against the challenge and burn it if that was
    // the last allowed attempt.
    const attempts = Number(challenge.attempts) + 1;
    const exhausted = attempts >= Number(challenge.max_attempts);
    await tx.query(
      `UPDATE email_otp_challenges
          SET attempts = $2,
              consumed_at = CASE WHEN $3 THEN NOW() ELSE consumed_at END
        WHERE challenge_id = $1`,
      [challenge.challenge_id, attempts, exhausted]
    );
    outcome = {
      ok: false,
      reason: exhausted ? "attempts_exhausted" : "invalid",
      attemptsRemaining: Math.max(0, Number(challenge.max_attempts) - attempts),
    };
  });
  return outcome;
}

async function consume(tx, challengeId) {
  await tx.query(
    `UPDATE email_otp_challenges SET consumed_at = NOW() WHERE challenge_id = $1`,
    [challengeId]
  );
}

/**
 * Mints an administrator-issued emergency code. Never emailed — the operator
 * reads it to the locked-out user, so it is returned to the caller once and
 * only its hash is stored.
 */
export async function issueEmergencyCode({ employeeId, ip, userAgent }) {
  return issueLoginChallenge({
    employeeId,
    purpose: OTP_PURPOSE_BREAK_GLASS,
    ip,
    userAgent,
  });
}
