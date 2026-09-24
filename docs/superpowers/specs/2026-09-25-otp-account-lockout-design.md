# Design: Account-Level OTP Lockout (3 Burns / 15 min)

**Date:** 2026-09-25
**Status:** Approved (design), not yet implemented
**Scope:** Server OTP layer (`otp-policy.js`, `email-otp.js`) + error surfacing on web (`auth.js`, `login/page.js`, `login-status`) and mobile (`api/mobile/auth/login`, `login.js`, `OtpVerificationView.jsx`). **No schema, no migration** — reuses `auth_rate_limits` (migration 087, already in `schema-contract.mjs:81`).

## Goal

Today the wrong-code ceiling is per *challenge*: burn a code, request a new one (60s cooldown), burn again — forever. An attacker holding a valid password can loop `issue → 5 guesses → issue` indefinitely at ~5 guesses/minute. Add an **account-level** lockout so that repeated burning trips a 15-minute freeze on both issuing and verifying codes, for **web and mobile alike**.

Existing layers this sits on top of (all unchanged): 5 attempts/challenge (`OTP_MAX_ATTEMPTS`), 60s resend cooldown, 5/min per-IP and per-account OTP buckets (`otp-login:*`, `otp-mobile-login:*`), 5/min credential buckets, 10-fail/15-min password lockout.

## Decisions (with rationale)

| # | Decision | Notes |
|---|---|---|
| 1 | **3 burned challenges → 15-minute lock** | 3 burns × 5 attempts = **15 wrong codes** per 15-min fixed window (window starts at the first burn). Against a 10⁶ space that is ~1 guess/minute — ~50 years to enumerate. Rejected "10 failed codes" (a legitimate user's 10 typos = only 2 bad codes, false-positive-prone) and "2 burns" (harsher than needed). |
| 2 | **Bucket = `lockout:otp:${employeeId}` in `auth_rate_limits`** | Same table + `rateLimit()`/`peekRateLimit()` as the password lockout (`account-lockout.js`). No new table → no migration, no `schema.sql` diff, no `db:contract`/`verify:anon` work (bucket rows are not tables/views). Keyed by `employee_id`, not email, so it matches the OTP layer's identity. |
| 3 | **Enforcement lives only in `email-otp.js`** | `issueLoginChallenge` and `verifyLoginChallenge` are the single choke point both channels already call (`auth.js:161/221`, `mobile/.../login/route.js:163/217`). Writing it at the call sites would mean two copies and a silent gap the moment a third caller appears. |
| 4 | **Scope = issue + verify, both purposes — no bypass** | Lock blocks: minting a new code (incl. resend), verifying a code, the recovery-code fallback inside verify, **and** the admin `issueEmergencyCode` path (`emergency-code/route.js`). Chosen over "break_glass passes": the lock is 15 min and self-healing, so the admin can simply wait; a bypass would be a second rule to defend. Accepted consequence: an admin cannot mint an emergency code for a locked account until the window expires. |
| 5 | **Consume AFTER the transaction commits** | `rateLimit()` opens its own connection via `query()`, outside `withTransaction`. Consuming inside the tx would record a hit even if the tx rolled back. So `verifyLoginChallenge` runs the tx, then — only if `outcome.reason === "attempts_exhausted"` — spends exactly one hit. An exhausted challenge is consumed, so one burn = one hit, never two. |
| 6 | **Peek (read-only) at the top of both functions** | Returns `{ ok:false, reason:"otp_locked", retryAfterSeconds }` before any DB work on the challenge. No attempt is spent, no recovery code is tried, no code is mailed while locked. `peekRateLimit` never consumes. |
| 7 | **Lock trip is surfaced: `lockTripped` on the outcome** | The consume that reaches the ceiling returns `lockTripped: true`, so call sites raise the existing `account_locked` security alert with `details: { channel, factor: "otp" }` — same alert type as the password lockout, no change to `SECURITY_ALERT_TYPES`. The `mfa_failure` audit already records `reason: "otp_locked"` for free (it logs `factor.reason`). |
| 8 | **Success clears the bucket** | After a successful OTP *or* recovery-code verification, best-effort `DELETE` of the bucket (mirrors `clearAccountLockout`). A user who burned 2 codes then got in starts clean — past struggle must not make the next typo half-way to a lock. |
| 9 | **Wire format = `OTP_LOCKED:<seconds>`** | Mirrors the existing `ACCOUNT_LOCKED:${retryAfter}` token (`auth.js:49`). Thrown by `authorize`, returned 429 by the mobile route. Clients parse the seconds for a countdown. Rejected a human-readable server string: copy belongs to the client, and the token keeps it translatable. |
| 10 | **`/api/auth/login-status` learns the OTP bucket** | Web NextAuth collapses failures, so the page already re-queries this endpoint after a failed submit (`login/page.js:948`). Extend it: given `?email=`, resolve `employee_id` (read-only) and peek the OTP bucket; answer `{locked:true, retryAfterSec, reason:"otp"}`. It only ever reveals a *locked* state — an unlocked account still answers `locked:false`, so no existence oracle (same invariant as today). |
| 11 | **Fail closed, inherited** | `peekRateLimit`/`rateLimit` return `allowed:false` on a DB error (`rate-limit.js:51,82`). During an outage OTP stops working — which it would anyway, since the challenge lives in the same DB. |
| 12 | **Trusted devices unaffected** | A remembered browser skips OTP entirely (`auth.js:112-134`) before any challenge exists. The lock governs the OTP path only; nothing to change there. |

## Behaviour flow

```
issueLoginChallenge(employeeId)
  peek lockout:otp:<id> ── locked? ──► { ok:false, reason:"otp_locked", retryAfterSeconds }
  … existing: no_account / break_glass_held / cooldown / mint …

verifyLoginChallenge(employeeId, authVersion, code)
  peek lockout:otp:<id> ── locked? ──► { ok:false, reason:"otp_locked", retryAfterSeconds }
  BEGIN TX … (stale / attempts_exhausted / match / recovery / invalid) … COMMIT
  outcome.reason === "attempts_exhausted" ──► rateLimit(+1 hit)   [after commit]
        └─ remaining === 0 ──► outcome.lockTripped = true
  outcome.ok === true ──► DELETE bucket (best-effort)
```

Call sites then: `otp_locked` → `OTP_LOCKED:<sec>` (429 + `Retry-After` on mobile); `lockTripped` → `raiseSecurityAlert(account_locked, {factor:"otp"})`.

**Client copy:**
- Web verify step: "Too many incorrect codes. Try again in N minutes." — sets the existing `lockSeconds` countdown so the form stays frozen (`login/page.js:897`).
- Web login-status path: same countdown, `reason === "otp"` branch alongside the existing `account`/`ip` messages (`login/page.js:955-957`).
- Mobile OTP step: new branch in `OtpVerificationView.jsx` (after `MFA_INVALID`/`MFA_UNAVAILABLE`) showing minutes-remaining copy; initial-send lock surfaces in `mobile/app/login.js` catch alongside the existing `MFA_*` branches.
- Admin emergency-code endpoint: `issued.reason === "otp_locked"` → 429 "That account is temporarily locked after too many incorrect codes. Try again in N minutes."

## Files touched (expected)

| Area | Files |
|---|---|
| Policy constants | `src/lib/auth/otp-policy.js` — `OTP_LOCKOUT_LIMIT = 3`, `OTP_LOCKOUT_WINDOW_MS = 15 * 60_000` |
| Enforcement | `src/lib/auth/email-otp.js` — peek in `issueLoginChallenge`/`verifyLoginChallenge`; post-commit consume; `lockTripped`; success clear; exports `otpLockoutKey`/`checkOtpLockout` |
| Web server | `src/lib/auth.js` — map `otp_locked` → `OTP_LOCKED:<sec>` (issue + verify branches), raise alert on `lockTripped` |
| Web status | `src/app/api/auth/login-status/route.js` — peek OTP bucket by email, `reason:"otp"` |
| Web UI | `src/app/(auth)/login/page.js` — handle `OTP_LOCKED:` in the three catch sites + `reason:"otp"` message |
| Mobile server | `src/app/api/mobile/auth/login/route.js` — `otp_locked` → 429 `OTP_LOCKED:<sec>`, alert on `lockTripped` |
| Admin | `src/app/api/auth/mfa/emergency-code/route.js` — map `otp_locked` → 429 |
| Mobile UI | `mobile/app/login.js`, `mobile/components/otp/OtpVerificationView.jsx` — `OTP_LOCKED:` branches |
| Tests | `src/lib/auth/email-otp.test.js` — `vi.mock("@/lib/rate-limit")` (see below) |

No new tables/views → `db:status`, `db:contract`, `verify:anon` not in play. `schema.sql` untouched.

## Verification

1. **Unit (`email-otp.test.js`):** the file mocks `@/lib/db` with a scripted transaction whose **unmatched reads throw** — importing `@/lib/rate-limit` therefore requires an explicit `vi.mock("@/lib/rate-limit")` defaulting to `{allowed:true, remaining, retryAfter:0}` or every existing test fails on the new peek. New cases: (a) locked peek blocks issue with `otp_locked`; (b) locked peek blocks verify before any challenge query, attempts untouched; (c) each `attempts_exhausted` outcome consumes exactly one hit; (d) the consume that hits the ceiling sets `lockTripped`; (e) success deletes the bucket; (f) recovery codes are refused while locked (decision 4).
2. **Regression suites:** `src/security-boundaries.test.js` and `src/lib/auth/trusted-device.test.js` pin **call-site ordering** inside `auth.js` (e.g. `await issueLoginChallenge` position) — run them; `src/security-assessment/auth-session.security.test.js` pins the `ACCOUNT_LOCKED:` token shape and OTP branch ordering; `mobile/lib/otp.test.js` parity pins (mask, TTL, cooldown) must stay green.
3. **End-to-end:** burn 3 codes against one account → 4th submit (web) and 4th resend (mobile) answer `OTP_LOCKED` with a live countdown; after the window the normal flow resumes untouched; a successful login clears the counter (burn 2 → success → burn 1 → still unlocked).
4. **Non-regression:** trusted-device sign-in still bypasses OTP during a lock; normal 5-attempt/60s-cooldown behaviour unchanged when the bucket is empty; `npm run lint` on touched files (repo baseline: 38 errors / 33 warnings, all pre-existing).

## Out of scope

- **Recovery-code guessing when no challenge is live** — `verifyLoginChallenge` answers `expired` before the recovery lookup ever spends an attempt, so that path never trips the lock. Pre-existing; already capped at 5/min by the `otp-login:*` buckets. Not addressed here.
- The per-challenge ceiling (5), TTL (300s), resend cooldown (60s) and the 5/min OTP buckets — unchanged.
- Email-ownership verification (`audit-otp-inbox-ownership.mjs`) and SMTP deliverability.
- Password lockout, credential buckets, trusted devices — untouched.
- Admin bypass of the lock (explicitly declined — decision 4).

## Documentation updates (on implementation)

- `Capstone/04 - Architecture/Authentication.md` — §OTP: document the account-level lockout, the bucket, the `OTP_LOCKED` token, and the no-bypass rule (including its effect on emergency codes).
- `Capstone/06 - Decisions/Decision Log.md` — 3 burns/15 min over 10-codes/2-burns; no break-glass bypass; reuse of `auth_rate_limits` over a new table.
- `Capstone/01 - System/Security Audit.md` — record the loop gap (burn → resend → burn) and its closure.
- `Capstone/01 - System/System Overview.md` changelog + root `SYSTEM.md` — one line each.
