# Design: Dev-Only OTP Bypass + Long Timeout for Manual Web Testing

**Date:** 2026-10-08
**Status:** Approved (design), not yet implemented
**Scope:** Web login OTP gate only (`src/lib/auth.js`). No mobile change, no migration, no schema change. Session timeout handled by existing config, no code.

## Goal

Manual web testing is painful: every login needs an emailed OTP, and the 5-minute idle timeout logs the tester out mid-flow. Add a testing convenience that removes both frictions locally without creating any production attack surface.

## Decisions (with rationale)

| # | Decision | Notes |
|---|---|---|
| 1 | **OTP bypass is a dev-only env flag, never a Settings UI toggle** | A DB-backed `otpEnabled` switch can be left OFF in prod by accident and becomes a kill switch to defend. An env flag that is inert in production cannot ship accidentally. Chosen per explicit user choice. |
| 2 | **Flag name: `DEV_BYPASS_OTP=1`, honored only when `NODE_ENV !== "production"`** | Single-purpose, greppable, self-describing. Production ignores it unconditionally (fail closed) and logs a warning if set. No other value enables it. |
| 3 | **Enforcement point: `authorize()` in `src/lib/auth.js`, top of the `if (!trustedDevice)` OTP block (~L152)** | This is the single choke point where web already decides trusted-device skip vs OTP demand. One branch, no new endpoint, no new module. Mobile route (`src/app/api/mobile/auth/login/route.js`) untouched — out of scope for manual web testing. |
| 4 | **Bypass still writes an audit row (`mfa_bypassed_dev`)** | Test logins stay visible in the audit trail. Answers "a second factor was skipped here" the same way `mfa_required` answers "a second factor was demanded here". |
| 5 | **Session timeout: no code, set `idleTimeoutSeconds=3600` via existing Security & Sessions card** | Range is already 60–3600, super-admin only, applies to sessions created after save. Re-login once after saving. The heartbeat keeps the session alive while active. A code-level "disable timeout" would touch `resolveCurrentIdentity()` in `src/lib/api/utils.js`, the exact file the 2026-09-18 fix made read-only — not worth reopening for a testing convenience. |
| 6 | **No new migration, no `schema.sql` diff, no `db:contract` / `verify:anon` work** | No table, no view, no policy change. The offline schema gate and anon probe are unaffected by construction. |
| 7 | **Safety pin: unit test asserting bypass is inert in production** | `NODE_ENV=production` + `DEV_BYPASS_OTP=1` must still demand OTP. Catches the one failure that matters: the flag leaking into a prod build. |

## Behaviour flow

```
authorize(email, password, { otpCode })
  password verifies
  trustedDevice? ── yes ──► existing skip (unchanged)
  DEV_BYPASS_OTP === "1" && NODE_ENV !== "production"?
    yes ──► writeAudit(mfa_bypassed_dev) ──► continue to session mint, no code issued/verified
    no  ──► existing OTP path unchanged (issue → requireCode → verify)
```

If `DEV_BYPASS_OTP=1` and `NODE_ENV=production`: ignore flag, follow existing OTP path, `console.warn` once at startup.

## Files touched (expected)

| Area | Files |
|---|---|
| Web server | `src/lib/auth.js` — dev bypass branch + audit + prod guard |
| Env docs | `.env.example` — `DEV_BYPASS_OTP=0` commented with "dev only, never set in production" |
| Tests | `src/lib/auth.dev-bypass.test.js` (new) — bypass on in dev, off without flag, off in prod even with flag |
| Docs | `Capstone/04 - Architecture/Authentication.md` — one paragraph under email OTP section noting dev-only bypass |

## Non-goals

- No mobile OTP bypass.
- No Settings UI toggle for OTP.
- No code change to idle-timeout machinery (`session-policy.js`, `security-policy.js`, `api/utils.js`, `heartbeat` route, `session-manager.jsx` all untouched).
- No change to lockout, rate limits, trusted devices, recovery codes, or emergency codes.

## Verification

- `npm test` green on touched files; new test file covers flag on/off × dev/prod matrix.
- `npm run lint:ci` clean.
- Manual: `DEV_BYPASS_OTP=1 npm run dev` → login with password only, no email needed; unset flag → OTP demanded again.
- Confirm prod guard: `NODE_ENV=production` build ignores flag (covered by test, plus startup warn).
