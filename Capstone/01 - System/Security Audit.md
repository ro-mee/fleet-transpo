---
type: security
title: Security Audit
tags: [security, audit, roadmap]
source:
  - "src/app/api/**/route.js"
  - "src/lib/auth.js"
  - "src/lib/rate-limit.js"
  - "next.config.mjs"
  - "supabase/migrations/009_registration_policy.sql"
last_verified: 2026-09-02
---

# Security Audit

Findings from the 2026-08-20 gap analysis of the FleetOps web app + mobile driver app.

## Tier 1 — CLOSED 2026-08-20

| # | Finding | Status |
|---|---|---|
| S1 | Anon-key privilege escalation on `employees` (migration 009 policies + default anon table grants): anyone with the public anon key could insert a `system_admin` or overwrite a password hash | **CLOSED** — migration 060 drops both policies + `REVOKE ALL`; verified live |
| S2 | Seeded admin credential (`admin123`, migration 008) | **CLOSED** — migration 061 NULLs the known hash where it matches; live password rotated |
| S3 | Mobile login (`POST /api/mobile/auth/login`) unthrottled bcrypt compares | **CLOSED** — per-IP + per-account 5/min throttle, 429 + `Retry-After` |

## Tier 2 — PARTIALLY CLOSED

| # | Finding |
|---|---|
| S4 | **CLOSED 2026-08-22** — `src/proxy.js` permits only the exact `NEXT_PUBLIC_APP_URL` origin; denied origins receive `403`, allowed preflights echo only that origin, and `Vary: Origin` is set |
| S5 | **CLOSED, follow-up WIP 2026-08-22** — full header set applies to `/:path*`; the uncommitted CSP follow-up permits `'unsafe-eval'` only in development for React/Turbopack HMR and keeps production strict |
| S6 | Web and mobile share one JWT secret — a leak compromises both token systems — **CLOSED 2026-09-02**: mobile JWTs require a dedicated `MOBILE_JWT_SECRET` in production and reject reuse of `NEXTAUTH_SECRET`; development/test fallback remains warning-only. |
| S7 | **CLOSED 2026-09-01** — `resolveIdentity()` revalidates the live employee, role, active status, and driver link for every API request; disabled accounts also lose mobile refresh tokens |
| S8 | **CLOSED 2026-08-22** — `canAssignRole()` permits only an existing `system_admin` to create another system administrator; covered by a security-boundary test |
| S9 | **CLOSED 2026-09-01** — `driver` removed from general driver, trip, dispatch, and vehicle list surfaces; dedicated driver endpoints remain scoped |
| S10 | **PARTIAL 2026-08-22** — vehicle images now require fleet-role authorization, ≤5 MB JPEG/PNG/WebP MIME + byte signatures, a real vehicle, and orphan cleanup; document/other uploads still need the same audit |
| S11 | OCR endpoint can fetch arbitrary URLs (SSRF surface) — **CLOSED 2026-08-22**: `src/lib/security/remote-url.js` restricts server-side fetches (Tesseract + LLM vision) on `scan-document` and `license-scan` to data URLs or fleet-controlled hosts; the fuel-scan route was already owner-checked |
| S12 | `clientIp()` trusts the first `x-forwarded-for` value — rate limits are spoofable — **CLOSED 2026-08-22**: keys on the rightmost (proxy-added) hop, validates IP shape, strips `:port` |
| S13 | **CLOSED 2026-09-02** — forgot-password returns one generic response and never performs a browser-side account lookup; verified administrator-issued recovery links are handled through the server-only token route |
| S14 | **CLOSED 2026-09-01** — fuel list/detail and AI recommendation joins use explicit employee fields; password hashes are never serialized |
| S15 | **CLOSED 2026-09-01** — driver fuel writes require the driver's own trip or active vehicle assignment; general maintenance creation is operations-only |
| S16 | **CLOSED 2026-09-01** — only system administrators may mutate system-admin accounts; driver-account setup rejects linked non-driver roles |
| S17 | **CLOSED 2026-09-01** — global command-palette search is staff-only; drivers stay on dedicated ownership-scoped endpoints |

## Tier 3 — OPEN (design debt)

- Supabase RLS is not a boundary (all app access uses the DB role, RLS policies inert). → [[Why RLS Is Not A Boundary]]
- CI now runs install, lint, tests, migration filename validation, the production
  build, and the method-level `npm run verify:auth` route guard audit. The static
  audit covers all 218 exported API methods; the live seven-route RBAC harness
  remains a supplemental database check.
- CI temporarily permits a bounded number of React Compiler/UI warnings; correctness errors remain blocking.

## Security module review — 2026-09-01

The shared route boundary is substantially stronger than the Settings > Security
screen: API identities are re-read from `employees` on each request and all 218
exported HTTP methods have an explicit guard or reviewed protocol exception. The
remaining work is concentrated in credential recovery, session lifecycle, and
operational visibility.

### Prioritized findings

1. **Release blocker until proven harmless:** the mobile login UI still exposes a
   `Fill Demo` action with `driver1` / `driver123`, contradicting the system note
   that demo login was removed. Delete it from production code and verify that no
   matching live account/password remains.
2. **High:** forgot-password performs only an existence lookup and never creates
   or delivers a reset link. The separate reset route is authenticated by an
   existing session and changes the password without the current password, so it
   is not an account-recovery mechanism.
3. **High:** web sessions are stateless JWTs with the framework's default 30-day
   idle lifetime. Password changes revoke neither those JWTs nor mobile refresh
   tokens in the normal change-password route, so a stolen web session survives a
   credential change.
4. **High:** rate-limit buckets are process-local. Restarts and multiple instances
   create independent counters, and web login has only an IP bucket rather than
   independent IP and normalized-account buckets.
5. **High:** mobile refresh rotation revokes the old token and inserts its
   replacement in separate database operations despite claiming one transaction.
   A failure can strand the session; replay is rejected but does not revoke a
   token family because no family/device model exists.
6. **Medium:** changing the login email needs no current-password/MFA step-up, new
   address verification, session invalidation, or security audit event.
7. **Medium:** authentication success/failure, password changes, recovery,
   refresh-token reuse, and session revocation are not written to the security
   audit trail. The Security screen therefore cannot show trustworthy recent
   activity or active devices.
8. **Medium:** 2FA is a disabled placeholder. Privileged accounts have no second
   factor or step-up authentication for account/role/connector-secret changes.
9. **Hardening:** make production fail when `MOBILE_JWT_SECRET` is missing or equal
   to `NEXTAUTH_SECRET`; use explicit auth projections instead of `select("*")`;
   equalize missing-user password checks; cap bcrypt inputs at 72 bytes; clean up
   expired refresh-token rows; finish the non-vehicle-image upload audit.

### Implementation order

1. Remove demo credentials and misleading reset behavior; add a regression test
   that rejects known/demo credentials in production source and seed data.
2. Add an employee credential/session version, put it in web/mobile claims, and
   compare it in the existing `resolveIdentity()` live lookup. In one transaction,
   every password/email/security change must update credentials, increment the
   version, revoke mobile refresh tokens and reset tokens, and write an audit row.
3. Implement real recovery using a cryptographically random, hashed, short-lived,
   single-use token and a configured trusted base URL. Keep responses uniform and
   require the normal login flow after reset. Until a delivery/verified-support
   channel exists, show only an honest contact-admin message.
4. Replace the in-memory auth limiter with a small PostgreSQL-backed limiter using
   the existing database stack. Apply independent per-IP and per-account buckets
   to web/mobile login and recovery, with generic 429 responses.
5. Make mobile refresh rotation use the existing `withTransaction()` helper; add
   token-family/device metadata, revoke a family on reuse, wire a real logout-all-
   devices action, and prune expired/revoked rows.
6. Add security-event coverage and then make the Security page factual: recent
   sign-ins/security events, active mobile devices, revoke-all, and accurate MFA
   state. Do not simulate per-device web sessions while web auth remains stateless.
7. Add vetted TOTP MFA for privileged roles first, hashed recovery codes, and
   step-up checks for sensitive account/role/secret changes.
8. Finish defense-in-depth work: runtime non-owner DB role/RLS strategy, remaining
   upload validation, CSP nonce/hash evaluation, and semantic auth tests in CI.

### Required verification

- First login and missing-account timing follow the same password-check path;
  IP/account limits stay shared across restarts and multiple instances.
- Password reset/change, email change, disable, and logout-all invalidate the
  intended web and mobile sessions after refresh and navigation.
- Reset tokens expire, are single-use, are stored only as hashes, and never reveal
  account existence.
- Two concurrent refreshes cannot both succeed; a replay revokes the token family;
  an insert failure rolls back the old-token revocation.
- Privileged login and sensitive actions enforce MFA/step-up; every security event
  is auditable without logging passwords, bearer tokens, reset tokens, or cookies.
- `npm run verify:auth`, focused route tests, security-boundary tests, lint, build,
  and live multi-role checks remain green.

## Security module implementation status — 2026-09-02

The high-priority credential and session findings above are now implemented. The
2026-09-01 list is retained as the original review snapshot; this section is the
current behavior.

- Demo login controls were removed from the mobile login screen.
- Migration `087_auth_security_lifecycle.sql` adds `employees.auth_version`,
  PostgreSQL-backed `auth_rate_limits`, refresh-token family/device metadata,
  and hashed, expiring `password_reset_tokens`.
- Web sessions and mobile access/refresh tokens carry `auth_version`; the shared
  API identity resolver compares it with the live employee row. Password, email,
  role, and account-status changes increment the version and revoke mobile/reset
  sessions as appropriate.
- Login, recovery, password changes, email changes, refresh-token reuse, and
  mobile logout are auditable without writing passwords, bearer tokens, or reset
  tokens. Authentication throttles use independent IP and account buckets and
  fail closed if PostgreSQL is unavailable.
- Mobile refresh rotation is transactional, single-use, family-aware, and
  revokes the family on replay. Expired and long-revoked rows are pruned
  opportunistically on mobile login.
- Recovery now has an administrator-only reset-link issuer. Links are random,
  stored only as SHA-256 hashes, expire after 30 minutes, are single-use, and
  force a fresh sign-in after the password is changed. The public forgot-password
  response remains uniform because no verified email delivery provider is wired.
- Settings > Users exposes the administrator reset-link action and shows the
  one-time link only to the issuing operator. Production mobile auth now fails
  closed when `MOBILE_JWT_SECRET` is missing or equals `NEXTAUTH_SECRET`; missing
  account checks use the same bcrypt work as existing accounts, and passwords
  over bcrypt's 72-byte input limit are rejected.

Deferred by design: verified email delivery, TOTP/recovery-code MFA and
privileged step-up, per-device web-session history, a scheduled token-pruning
job, non-owner database/RLS enforcement, the remaining upload audit, and CSP
nonce/hash evaluation. These require an explicit provider or deployment choice;
the application does not present them as enabled.

## Security settings UX — 2026-09-02

Settings > Security now mirrors the credential lifecycle instead of presenting
placeholder actions:

- The password form shows the enforced password requirements, uses password
  autocomplete hints, exposes inline validation semantics, and tells operators
  that a successful change revokes web/mobile sessions and requires a fresh sign-in.
- The original 2FA panel reported that no factor was configured and enrollment
  was unavailable; this historical placeholder was replaced by the live setup
  and management flow documented below.
- Session Management originally showed sign-out guidance only; it now renders
  owner-scoped web and mobile session rows with immediate revocation.

The original presentation-only state is retained here as historical context.

## Session management and TOTP 2FA plan — 2026-09-02 (HISTORICAL)

Historical constraints confirmed before implementation (superseded by the implemented section below):

- Dashboard sessions are 12-hour stateless NextAuth JWTs. `auth_version` can
  invalidate every old session, but there is no server-side record that can list
  browsers or revoke one browser independently.
- Mobile refresh tokens already have a `family_id`, IP address, user agent, and
  revocation state. The access token does not carry/check its family, so revoking
  a family is not immediate until the current 15-minute access token expires.
- The mobile logout endpoint accepts `allDevices`, but the mobile auth provider
  currently sends only the current refresh token and exposes no logout-all action.
- Employee authentication is custom NextAuth/bcrypt plus the mobile JWT exchange;
  Supabase Auth MFA settings do not protect these flows. No TOTP or QR dependency
  is currently installed.

Historical delivery order (completed):

1. Replace the one global password-visibility switch with an independently
   controlled, keyboard-accessible eye button inside each password input.
2. Add a `web_sessions` table and a random `session_id` claim to dashboard JWTs.
   Check the active row in the shared identity resolver, record bounded
   last-seen/device metadata, mark sign-outs and credential changes as revoked,
   and force pre-migration web JWTs to sign in again.
3. Carry the mobile refresh `family_id` in access tokens and require the family
   to remain active during bearer authentication. This makes a device-family
   revocation effective on its next API request rather than after 15 minutes.
4. Add owner-scoped session APIs to list safe web/mobile session DTOs, revoke one
   session/family, and revoke all other sessions while preserving the current web
   session. Write every revocation to `audit_logs`.
5. Render real active-session rows in Settings > Security with channel, parsed
   device/browser label, created/last-active time, current-device state, per-row
   sign-out, and a confirmed “Sign out all other sessions” action. Wire the
   mobile client’s existing `allDevices` server capability as well.
6. Add encrypted per-employee TOTP enrollment state and hashed single-use
   recovery codes. Use an RFC 6238 implementation rather than custom OTP math;
   use 30-second, six-digit TOTP with a narrow clock-skew window and replay
   protection. Require a dedicated production encryption key for recoverable
   TOTP secrets.
7. Build setup, confirm, disable, and recovery-code regeneration endpoints.
   Enrollment requires the current password and a valid first TOTP; factor
   removal/replacement requires the current password plus an enrolled factor or
   recovery code. Enabling/disabling revokes sessions and forces a fresh login.
8. Enforce the second factor in both the NextAuth credential flow and the mobile
   driver login so an enrolled factor cannot be bypassed through another client.
   Apply independent IP/account MFA attempt limits, generic pre-password errors,
   single-use recovery codes, TOTP-step replay rejection, and security audit events
   without logging passwords, OTPs, recovery codes, or secrets.

Rollout will begin as opt-in but fully enforced once an account enrolls. Requiring
MFA for privileged roles should be enabled only after administrators have enrolled
and the recovery/support process has been exercised, avoiding a deployment-wide
lockout.

Required verification includes two-browser web revocation, mobile family
revocation, refresh/navigation behavior, password/email/session invalidation,
TOTP setup/login/disable, expired and replayed codes, one-time recovery codes,
rate limits, dark/light responsive UI, keyboard/touch visibility controls,
`npm run db:check`, `npm run db:up`, `npm run db:dump`, `npm run verify:auth`,
focused security tests, lint, and the production build.

## Verification — 2026-09-01

- `src/security-boundaries.test.js`: 8 tests pass, including role derivation,
  explicit employee projections, and driver list boundaries.
- New focused tests pass for fuel ownership (3), stale-session revalidation (3),
  system-admin target protection (1), and non-driver account demotion protection (1).
- `src/lib/auth/mobile-token.test.js`: 4 tests pass (dedicated secret, cross-key rejection, fallback warning, fail-closed).
- `src/lib/uploads/vehicle-image.test.js`: 1 test passes.
- Full suite: **478/479 tests across 46 files**; the one failure is the known
  integration-ingest fixture that throws before its intended `integration_log`
  write-failure branch. `lint:ci` has 0 errors, `db:check` passes, and the
  production build passes.
- `verify-rbac.mjs` repaired after route deletions in `0c0820c` rotted its inventory (review/reject/approve → flags/recommendation/assign); **72/72 checks pass** via `node --import ./scripts/route-harness-loader.mjs scripts/verify-rbac.mjs`.
- `npm run verify:auth`: **209/209 exported methods pass**.
- Security/CI commit: `1fae72c`; S6/S9/S11/S12 fixes uncommitted at time of writing.

## Verification — 2026-09-02

- `npm run verify:auth`: **218/218 exported methods pass** (including the
  administrator reset-token, session, and MFA endpoints).
- `npm run db:check`: **92 migration files valid**; `npm run db:status`: **92
  applied, 0 pending, 0 changed**. Migration 087 was applied through the direct
  database runner and `schema.sql` was regenerated from the live database.
- Focused security/auth checks: **49/49 tests pass**, including auth-version
  rejection, dedicated mobile secret enforcement, reset-token hashing, durable
  limiter fail-closed behavior, and account-boundary tests.
- `npm run lint:ci`: passes with zero errors or warnings.
- `npm run build`: production build compiles and prerenders all 166 pages;
  `/api/auth/reset-token` is included as a dynamic route.
- The retained suite currently reports **474/474 passing across 43 files**;
  temporary implementation checks were removed after verification. The
  integration-ingest fixture still covers its best-effort `integration_log`
  write-failure branch.

## RBAC permission centralization — 2026-09-02

- Page-level guards now derive the current path's role policy from
  `getRequiredRolesForPath()`; page-local role arrays are no longer a second
  navigation policy.
- Cleanly mapped API methods now call `requirePermission()`, which derives its
  allowlist from `rolesFor()` and the shared matrix. This includes operational
  CRUD/lifecycle routes, settings, incidents, notifications, device tokens,
  search, fuel requests/allocations, AI operations, maps, and account setup.
- Collection-wide `read_all` / `update_all` actions keep the distinction between
  staff-wide data and driver-owned records. Ownership, self-service, service-token,
  and trusted side-effect recipient checks remain explicit because a role/action
  pair alone cannot express those scopes.
- Verification: `npm run lint:ci`, `npm run db:check`, and
  `npm run verify:auth` pass; the route-auth audit reports **218/218** guarded
  methods. The default Vitest config loader still hits a local Windows/esbuild
  access-denied error, but `--configLoader runner` runs the full suite at
  474/474 across 43 retained test files.

## Session management and TOTP 2FA — 2026-09-02 (IMPLEMENTED)

The planned security-settings work is now implemented and server-enforced:

- Each Settings > Security password field has its own keyboard-accessible eye
  button; revealing one value does not reveal the others.
- Dashboard JWTs carry a random `sessionId` that must match an active
  `web_sessions` row. Activity updates are bounded to five-minute intervals;
  sign-out, credential changes, and account disablement revoke rows.
- Mobile access JWTs carry their refresh `familyId`; bearer requests require an
  unrevoked, unexpired row in that family. The mobile client supports current
  device and all-device sign-out.
- `GET/DELETE/POST /api/auth/sessions` returns owner-scoped safe device DTOs,
  revokes one browser/family, or signs out all other sessions while preserving
  the current browser. The Security page renders this live list.
- Migration 088 adds `web_sessions`, encrypted `employee_mfa` setup state, and
  hashed single-use `mfa_recovery_codes`. TOTP uses RFC 6238-compatible,
  30-second six-digit codes with a narrow clock-skew window and replay guard.
- MFA setup, confirmation, disablement, and recovery-code regeneration require
  current-password step-up checks, rate limits, and audit events. Enabling or
  disabling MFA revokes sessions and requires a fresh sign-in. `MFA_ENCRYPTION_KEY`
  is required in production; development derives a warning-backed local key.
- Enrolled factors are required by both web credentials and mobile driver login;
  missing or invalid factors never issue a session.

## Verification — 2026-09-02 (session/MFA implementation)

- Migration 088 was applied with `npm run db:up`; `npm run db:dump` refreshed
  `schema.sql`, and `information_schema` confirms `web_sessions`,
  `employee_mfa`, and `mfa_recovery_codes` are live.
- `npm run db:check`, `npm run db:status`, and `npm run verify:auth` pass;
  route-auth audit reports 218/218 guarded methods.
- Temporary implementation checks for identity, rate limiting, reset tokens,
  sessions, MFA, and route boundaries were removed after verification at the
  operator's request. The retained suite passes **474/474 tests across 43 files**.
- The live transaction smoke check used during implementation confirmed TOTP
  replay rejection and one-time recovery-code consumption; temporary data was
  rolled back.
- `npm run lint:ci` and `npm run build` pass; the production build includes the
  session/MFA route handlers and renders 172 pages.
- The default Vitest config loader still hits the known Windows/esbuild access
  denial; `npm exec vitest -- --configLoader runner ...` runs the focused tests.

## Verification follow-up — 2026-09-02 (MFA setup fix)

- Fixed the 2FA setup 500 caused by calling the removed `otpauth` v9
  `Secret.generate()` API; enrollment now uses `new Secret().base32`.
- The permanent regression test passes, and the retained suite is now
  **474/474 across 43 files** with `--configLoader runner`.

## Related

[[Authentication]] · [[Why RLS Is Not A Boundary]] · [[Bugs]] · [[Current State]]
