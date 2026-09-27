# Design: OTP Attempts & Strike Warning (Instant Freeze Countdown)

## Goal

Close the feedback gap found on 2026-09-27: the account-level OTP lockout (3 burns / 15 min) is enforced correctly, but a user spamming wrong codes sees one generic message every time — `That verification code is invalid or already used.` — with no attempts-left count, no strike warning, and no freeze countdown until *after* they trigger it and submit again. The backend already computes `attemptsRemaining` and `lockTripped`; `src/lib/auth.js` discards both by throwing a bare `MFA_INVALID`. This spec surfaces that state to the user on web and mobile.

## Decisions (with rationale)

1. **Value-bearing error tokens on the existing throw path** (Approach A). Three tokens, building on the established `ACCOUNT_LOCKED:<s>` / `OTP_LOCKED:<s>` convention:
   - `OTP_ATTEMPTS_LEFT:<n>` — after every wrong code (n = 4..1, never 0).
   - `OTP_STRIKE:<n>` — when a challenge burns (n = 1 or 2; the 3rd burn returns `OTP_LOCKED` instead).
   - `OTP_LOCKED:<exact seconds>` — returned **immediately by the burn itself** on the 3rd strike, not on the next submit.
   Rationale: `NextAuth.authorize()` can only throw a message, so web cannot receive a structured body without touching session callbacks (Approach B — rejected: divergent web/mobile shapes, large blast radius). Approach C (client pulls state from `login-status`) was rejected because the OTP branch of that endpoint was deliberately removed in the lockout final review to close an existence-oracle leak (`f6b051f`); re-adding it reopens that. Message tokens leak only the state of a challenge the client already holds (password already verified) — the same information family as the existing `ACCOUNT_LOCKED:<s>` seconds.
2. **Exact freeze seconds via a new `windowRetryAfter` field on `rateLimit()`.** The SQL already computes `retry_after` from `window_started_at` (anchored at burn #1); the JS currently zeroes it when `allowed` is true. Returning it as an additional field is non-breaking — no existing field changes, no caller changes. Approximating "900 s from now" was rejected: the window may be partially elapsed, and overstating the remaining wait makes the user retry into a still-locked server.
3. **Strike number derived from the DB-authoritative bucket** — `strike = OTP_LOCKOUT_LIMIT - bucket.remaining` after the consume — not from a counter in app state. Under concurrent attempts the bucket is the truth, so the number shown can never drift from the number that locks.
4. **Shared parsers with mobile parity pins.** Server helpers `parseOtpAttemptsLeft` / `parseOtpStrike` live beside `parseOtpLock` in `src/lib/auth/otp-policy.js`; `mobile/lib/otp.js` mirrors them with parity tests — the exact pattern already used for `OTP_LOCKED`. One helper decides both the branch and the value.
5. **Copy says "code", not "email code"** — recovery-code attempts spend the same challenge attempts, so the wording must fit both modes.

## Behaviour flow

### Server

1. `rateLimit()` (`src/lib/rate-limit.js`) gains `windowRetryAfter`: the raw computed `retry_after` seconds, always returned (≥ 0), regardless of `allowed`. Existing `allowed` / `remaining` / `retryAfter` are untouched.
2. `verifyLoginChallenge()` (`src/lib/auth/email-otp.js`), post-commit burn branch (line ~281):
   - every `attempts_exhausted` outcome gets `outcome.strike = OTP_LOCKOUT_LIMIT - bucket.remaining` (1, 2, or 3);
   - when `bucket.remaining === 0`: `outcome.lockTripped = true` (existing) **plus** `outcome.retryAfterSeconds = bucket.windowRetryAfter`;
   - the JSDoc outcome contract at the top of the function is updated to match.
3. Mapping at the throw/return sites — both channels, in this order:
   - `factor.lockTripped` → raise the security alert (existing), then **immediately** throw/return `OTP_LOCKED:<factor.retryAfterSeconds>` (web `src/lib/auth.js:252-269`; mobile `.../api/mobile/auth/login/route.js:260-283` uses the existing 429 `otpLockedResponse` with the new exact seconds).
   - `reason === "invalid"` → `OTP_ATTEMPTS_LEFT:<factor.attemptsRemaining>`.
   - `reason === "attempts_exhausted"` (not tripped) → `OTP_STRIKE:<factor.strike>`.
   - `expired` / `stale` auto-resend, `MFA_UNAVAILABLE`, `OTP_UNDELIVERABLE`, audit writes: **unchanged**.

### Web UI (`src/app/(auth)/login/page.js`, MFA catch ~line 823)

- Local `failAttempt(msg)` helper (refactor of the existing `MFA_INVALID` block: `setError(msg)`, clear code, `mfaStatus("error")`, refocus).
- Branches, before the generic fallback:
  - `parseOtpAttemptsLeft(err.message)` → `Incorrect code — N attempt(s) left.` (pluralise "attempt(s)").
  - `parseOtpStrike(err.message)` → `That code was wrong. Strike n of 3 — request a new code. {3-n} more failed code(s) will freeze this account for 15 minutes.`
  - `parseOtpLock(err.message)` (existing line ~857) → unchanged, but now reachable **from the 3rd burn itself** → countdown starts instantly.
  - `MFA_INVALID` equality → keeps today's generic copy (covers expired/stale and any unrecognised failure).

### Mobile UI

- `mobile/components/otp/OtpVerificationView.jsx` `verifyWith` catch (after the `MFA_INVALID` branch ~line 142): attempts branch → `Incorrect code.\nN attempt(s) left.`; strike branch → same strike copy as web (line-broken for `fail()`). `parseOtpLock` branch already exists — it becomes reachable from the burn.
- `mobile/app/login.js` (~lines 196-203): the same two branches beside its existing `parseOtpLock` / `MFA_INVALID` handling.
- Parsers + `OTP_ATTEMPTS_LEFT_PREFIX` / `OTP_STRIKE_PREFIX` added to `mobile/lib/otp.js`, mirroring its existing `parseOtpLock` block (lines 69-80).

### Example timeline (employee with empty bucket)

| Action | Response seen |
|---|---|
| code sent, wrong #1 | `Incorrect code — 4 attempts left.` |
| wrong #2 / #3 / #4 | `Incorrect code — 3/2/1 attempt(s) left.` |
| wrong #5 (burn 1) | `That code was wrong. Strike 1 of 3 — request a new code. 2 more failed codes will freeze this account for 15 minutes.` |
| resend (60 s cooldown, unchanged), wrong ×5 (burn 2) | `...Strike 2 of 3... 1 more failed code will freeze...` |
| resend, wrong ×5 (burn 3) | `Too many incorrect codes. Try again in {exact window seconds}.` — countdown live immediately; further issue/verify on all channels returns `otp_locked` |
| any successful sign-in later | bucket cleared (existing `clearOtpLockout` behaviour, unchanged) |

## Files touched (expected)

- `src/lib/rate-limit.js` — add `windowRetryAfter`.
- `src/lib/auth/email-otp.js` — `strike`, `retryAfterSeconds` on outcome; JSDoc.
- `src/lib/auth.js` — token mapping at the `!factor.ok` block.
- `src/lib/auth/otp-policy.js` — two prefix constants + two parsers.
- `src/app/(auth)/login/page.js` — `failAttempt` helper + two branches.
- `src/app/api/mobile/auth/login/route.js` — token mapping (instant `otpLockedResponse`).
- `mobile/lib/otp.js` — mirror prefixes/parsers.
- `mobile/app/login.js`, `mobile/components/otp/OtpVerificationView.jsx` — two branches each.
- Tests: `src/lib/auth/otp-policy.test.js` (or wherever otp-policy pins live), `mobile/lib/otp.test.js` parity pins, `email-otp` outcome tests, source pins for both throw sites and both UIs; `mobile .../route.test.js` unchanged-but-green.

## Verification

- `npm run test:run` — full suite green (baseline 208 files / 2557 tests; this spec's suite adds tests, never loses one).
- `npx eslint --max-warnings 0` on every touched file.
- Manual smoke (both channels): 5 wrong codes → strike 1 copy; resend → burn 2 → strike 2 copy; resend → burn 3 → countdown appears **without** a further submit; lock stands 15 min from burn #1.
- The `login-status` "active OTP lock produces no observable state" pin stays green — no endpoint changes.

## Out of scope

- Attempts-left progress UI (persistent counters, banners) — only the post-failure message.
- Resend-cooldown copy, expired/stale auto-resend behaviour, generic `MFA_INVALID` fallback copy.
- Changing the 3-burn / 15-minute policy itself, the 5-attempt challenge limit, or the 60 s resend cooldown.
- Re-adding any OTP state to `login-status` or any other endpoint.
- `account_locked` audit payloads, admin break-glass, emergency codes.

## Documentation updates (on implementation)

- `Capstone/` — update the note(s) that document the OTP lockout (behaviour table + copy matrix) with the three tokens and the instant-freeze behaviour.
- `System.md` — brief entry for the new failure-surface copy.
