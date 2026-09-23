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
  - "mobile/lib/biometric.js"
  - "mobile/lib/app-lock.js"
  - "mobile/lib/biometric-errors.js"
last_verified: 2026-09-23
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
   — **Done 2026-09-02, then reversed 2026-09-22:** MFA shipped as TOTP for *all*
   roles and was subsequently replaced by mandatory email OTP. The "privileged roles
   first" staging was never used; see the last section of this document.
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

Deferred by design: verified email delivery, privileged step-up, per-device web-session
history, a scheduled token-pruning job, non-owner database/RLS enforcement, the remaining
upload audit, and CSP nonce/hash evaluation. These require an explicit provider or
deployment choice; the application does not present them as enabled. (`TOTP/recovery-code
MFA` left this list on 2026-09-02 and was itself replaced by email OTP on 2026-09-22 —
see the last section of this document.)

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

## Session management and TOTP 2FA — 2026-09-02 (IMPLEMENTED, SUPERSEDED 2026-09-22)

> **Superseded.** Everything below about sessions still holds. Everything below about
> the *factor* no longer describes the system: TOTP was removed on 2026-09-22 and
> replaced by email OTP — see the last section of this document. `employee_mfa` is still
> present in the database but nothing reads it, and `MFA_ENCRYPTION_KEY` is obsolete.
> `GET /api/auth/mfa/setup|confirm|disable` no longer exist.

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

## Session idle timeout & expiration UX — 2026-09-02 (IMPLEMENTED)

- Migration `089_session_idle_timeout.sql` adds `idle_timeout_seconds` to `web_sessions` (default 3600).
- `resolveCurrentIdentity()` enforces 1-hour idle timeout (`last_seen_at + idle_timeout_seconds`) and 12-hour absolute expiration (`expires_at`), returning explicit 401 codes: `SESSION_IDLE_TIMEOUT`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `ACCOUNT_DISABLED`, and `SESSION_INVALID`.
- Centralized `apiFetch` and `window.fetch` interceptors dispatch 401s to the session event bus and suppress error toast flooding when session modals are active.
- `GET /api/auth/heartbeat` synchronizes authoritative server timestamps. `POST /api/auth/heartbeat` slides the idle timer on verified human activity or "Stay signed in" click, without extending the 12-hour hard maximum. Background polling does not synthesize activity.
- `SessionExpiryModal` delivers an Apple/Linear-grade double-bezel design for idle warning (55m), 12h expiry warning (11h55m), and expired states.
- Multi-tab synchronization runs over `BroadcastChannel("fleetops_session_bus")`.
- Re-authentication restores the user's prior internal route via `isValidInternalPath()`-protected `sessionStorage`.
- Focused tests in `src/lib/auth/idle-session.test.js` and `src/lib/auth/return-to.test.js` pass (12/12). Full suite passes **487/487 across 46 files**. `npm run verify:auth` reports **220/220 guarded methods**.

## Live deployment assessment - 2026-09-18

### Scope and safety

- Target: `https://fleet-transpo.vercel.app` (public Vercel deployment).
- Authorization: explicit user authorization for a non-destructive assessment.
- Live actions were limited to `GET`, `HEAD`, and `OPTIONS` requests. No cookies,
  credentials, form submissions, uploads, AI calls, `POST`, `PUT`, `PATCH`, or
  `DELETE` requests were used. No production data was touched and no real
  mutation occurred.
- The live FleetMate model probe was not run because it writes temporary
  `ailogs` rows, even though it cleans them up afterward.

### Security test contract

Trust boundaries are the Vercel web app, per-route `requireAuth()` guards, the
separate mobile bearer-token surface, and Supabase PostgREST/anon access. The
protected resources are employees, drivers, vehicles, trips, reservations,
dispatch, evidence, GPS, uploads, maintenance, incidents, reports, and AI
telemetry. The live pass covered public page/API behavior, unauthenticated
rejection, malformed bearer rejection, CORS, security headers, public HTML
secret patterns, route-presence drift, and the live database/anon contract.

### Live results

- `GET /api/vehicles`, `/api/trips`, `/api/system/health`, and
  `/api/mobile/driver/me` returned `401` without a session.
- Invalid bearer tokens returned `401` on both web and mobile-protected routes.
- CORS rejected `https://evil.example` with `403`, allowed only
  `https://fleet-transpo.vercel.app`, and returned `Vary: Origin`.
- HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, and `Permissions-Policy` were present.
- The public login HTML contained no matches for service-role/database/JWT/MFA
  secrets, private-key blocks, password hashes, or credential-shaped `api_key`
  fields. This does not prove that secrets are absent from every static bundle.
- The live database contract passed: 59 relations classified, 58/59 with RLS,
  zero unclassified or missing objects, zero contract violations, and the one
  view (`driver_stats`) using `security_invoker`.
- The anon probe found zero exposed relations. Its 49 `200 []` results were
  resolved by the catalog check as RLS-deny-all; 10 relations explicitly
  refused anon access.

### Findings and deployment drift

#### SEC-DEPLOY-001 - production CSP is behind the checked-in allowlist

**Potential / LOW.** The live `Content-Security-Policy` still contains
`img-src 'self' data: blob: https:`. The checked-in `next.config.mjs` narrows
this to fleet storage, app, and known map origins, and the source also validates
stored media references. The broad live header leaves a defense-in-depth gap for
legacy or otherwise attacker-controlled image references, but no exploit was
attempted and the source-side write guard limits demonstrated impact.

**Remediation:** deploy the intended commit, then re-check the live CSP and
perform a staging-only stored-media acceptance test.

#### SEC-DEPLOY-002 - live deployment is missing newer local routes

**INFO / release drift, not a confirmed vulnerability.** The local build emits
`/api/integration/transport-requests/[id]/evidence`, `assigned-status`,
`queue-impact`, `simulate`, and `return-matches`; the live deployment returned
`404` for each while the parent request route returned `401`. This means the
live security posture cannot be inferred from the current checked-in tree for
those features.

**Remediation:** verify the Vercel deployment commit/provenance and redeploy the
approved tree before performing authenticated evidence or Copilot verification.

### Local verification and limits

- `npm run verify:auth`: 275/275 route methods guarded.
- `npm run db:check`: 118 migration files valid.
- `npm run build`: passed; 203 pages/routes emitted.
- Targeted ESLint for the security assessment and route-auth audit: passed.
- Full Vitest with the documented Windows workaround: 169 files passed and 2
  files failed, with 1,909 passed and 5 failed tests. The five failures are
  stale assessment assertions that still expect the former ten-year media URL
  behavior and a face-photo test that still expects a URL to be persisted;
  current source stores keys and signs on read. They were not silently changed.
- Repository-wide `lint:ci` was blocked by generated `mobile/.expo` bundles,
  not the touched security source; targeted lint passed.
- Authenticated RBAC/IDOR, dispatch business rules, evidence references, GPS
  ownership, uploads, MFA/reset, session revocation, race tests, and browser
  rendering were not executed against production. They require approved test
  accounts and preferably staging. Static/local coverage is not live proof.

No Critical, High, or Medium vulnerability was confirmed in the tested scope.
The live CSP drift remains a low-severity potential finding, and the route
version drift remains an information-level release finding.
## Idle timeout was not enforced — FOUND AND FIXED 2026-09-18

**The finding.** Everything above was true except the part that mattered. `resolveCurrentIdentity()` (`src/lib/api/utils.js`) slid `web_sessions.last_seen_at` on any authenticated request older than 5 minutes, ungated by human activity. Because every dashboard page polls (sidebar counts at 30s via `app-shell.jsx`, live map at 15–30s, dispatch plan at 10s, notifications at 15s — two with `refetchIntervalInBackground: true`), `last_seen_at` was refreshed roughly every 5.5 minutes by an abandoned browser. The 1-hour idle deadline never elapsed; **only the 12-hour absolute cap was ever enforced.**

The 2026-09-02 note's line "Background polling does not synthesize activity" was true of the client-side activity flag and false of the server deadline. The client flag gated only the heartbeat POST — the server was moving the deadline regardless.

**The fix.** Deleted the auto-slide; `POST /api/auth/heartbeat` is now the sole writer of `last_seen_at`, and the client slides it on real DOM activity (throttled to one write/minute) rather than sampling a flag every 5 minutes. Constants moved to `src/lib/auth/session-policy.js` and the dependent values (warning window, heartbeat interval) are derived from `IDLE_TIMEOUT_SECONDS`. Idle timeout reduced to **5 minutes** (migration `113_session_idle_timeout_5min.sql`, no backfill).

**Regression guards added:** a structural assertion in `src/security-boundaries.test.js` that `lib/api/utils.js` contains no `UPDATE web_sessions SET last_seen_at`, and derived-value invariants in `src/lib/auth/idle-session.test.js` (warning and heartbeat interval must stay strictly inside the idle window) — the checks that would have caught the three-way 300s collision a naive constant change produces.

**Severity:** the exposure window was the 12-hour absolute cap, not 1 hour, on every polling page — including with the window minimized. Full details in [[Authentication]].

## Email OTP replaced TOTP — DECIDED AND IMPLEMENTED 2026-09-22

**What changed.** The second factor is now a 6-digit code emailed to the account holder,
mandatory for every account including `driver`, on web and mobile. TOTP enrollment,
QR codes, shared secrets, AES-256-GCM secret storage and the three
`/api/auth/mfa/setup|confirm|disable` routes are gone. `employee_mfa` is retained but
unread.

**This is a recorded downgrade, not an upgrade.** TOTP's secret lives on the user's
device and needs no third party; email OTP collapses both factors onto one inbox and
makes Gmail SMTP a hard dependency of every login. It was chosen because it demos
without a phone, and accepted knowingly. The honest summary of the resulting posture is
**"MFA at first login per device, per week"** — not "MFA on every login" — because
trusted web devices still skip the code, now for 7 days instead of 30.

**What holds it up.** Both factors are checked inside the existing credential exchange,
so no new public endpoint was added and no enumeration surface exists: `authorize()` only
runs after the password verifies. Issuing a challenge deletes the employee's live ones
and inserts one, so "verify" means "the newest live challenge" with nothing on the wire.
The controls that actually matter are the 5-minute TTL, the 5-attempt ceiling that burns
the challenge, the 60-second send cooldown, and the table being unreachable from the anon
key — **not** the SHA-256 digest, which is trivially enumerable over a 10^6 space and is
documented as such at the call site.

**Fail-closed behaviour.** If SMTP is unconfigured or the address is not deliverable, the
login is refused with an honest message and audited as `mfa_unavailable`. There is no
bypass, no environment-gated override, and no fallback that lets a login through.

**Break-glass.** Two paths, both audited: recovery codes (10 per set, SHA-256 hashed,
single-use, now regenerated on the current password rather than a TOTP code, because
requiring an emailed code on the path taken when email fails is circular), and
admin-issued 15-minute emergency codes returned in plaintext once for an operator to read
aloud, which also raise a security alert. A live emergency code is never displaced by a
self-service send — that guard closes the deadlock where the admin's hand-delivered code
would be destroyed and replaced by an email the locked-out user cannot receive.

**The finding this created, which code cannot fix.** Email OTP turns `employees.email`
into a security-critical field, and **21 of 35 live accounts could not receive mail**
before this change — including the only `super_admin`. Addresses were corrected first,
as a precondition. What remains unfixable in code is an address that is routable but
belongs to a stranger: the code is delivered, just not to the right person, so the failure
is *silent* rather than loud. `scripts/audit-otp-inbox-ownership.mjs` is the out-of-band
gate for that question, and the login modal masks the local part while showing the domain
so a user can notice a wrong destination. Twelve accounts are still classified VERIFY
OWNERSHIP; see [[Bugs]].
The nineteen unreachable ones were identified the same day as harness debris:
`scripts/verify-p1-e2e.mjs` and `scripts/verify-p2-analytics.mjs` created an employee row
per run on the reserved `@example.com` domain and never removed it, which under mandatory
email OTP made them accounts nobody could sign into or delete. Both now tear down what
they create and `scripts/cleanup-harness-fixtures.mjs` sweeps the backlog (2026-09-23).
**Reading the gate's output.** Its verdicts derive from `OTP_FIX_*` keys in the gitignored
`.env.local`, so a working copy without that file used to print `0 owned` — which reads as
a finding and is really an unasked question. It now reports ownership as **UNKNOWN**, not
zero, when no key loaded. Same rule as the anon-key probe's refusal to call `200 []` a
PASS (SEC-DB-003): absence of evidence is not a verdict.

**Also found, not fixed:** 56 of 60 tables grant `TRUNCATE` to `anon`/`authenticated`,
which RLS does not cover. Migration `116` fixed three of them. PostgREST cannot issue
`TRUNCATE`, so this is latent rather than a live remote hole — it requires a raw Postgres
connection as `anon`. Recommended as a separate migration.

**Severity:** the decision is a deliberate reduction in factor strength with a new
single point of failure (SMTP). The compensating controls are the fail-closed gate, the
short TTL, the attempt ceiling and the two break-glass paths. Full details in
[[Authentication]] and the Decision Log.

## Biometric app lock — IMPLEMENTED, WITH STATED LIMITS 2026-09-23

**What it is.** An optional, off-by-default local application lock on the mobile app:
`AppLockProvider.locked` gates the authenticated tree, and the OS (Face ID / fingerprint
via `expo-local-authentication` + the keystore/keychain ACL) is the only thing that can
release it. No backend change: no route, no migration, no token, no biometric endpoint.
Full design in [[Authentication]] and [[Mobile Architecture]].

**Biometric data: none, anywhere.** FleetOps never collects, reads, stores, transmits or
logs a fingerprint, face scan, template or image. The app receives one native result
enum. Nothing biometric appears in `audit_logs`, analytics, or crash reports, and there
is nothing to leak because nothing is captured.

**What is stored on the device.**

| Item | Protection | Contents |
|---|---|---|
| `fleetops_biometric_sentinel` (service `fleetops.biometric`) | `requireAuthentication: true` → Android `setUserAuthenticationRequired(true)`; iOS `biometryCurrentSet`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY` | a **non-secret** unlock marker; reading it *is* the assertion |
| `fleetops_biometric_meta` | default keychain service, ungated | lock on/off, employee/driver id, first name, method, timestamps |

No password, no plaintext credential, and **no biometric data** is written to
`AsyncStorage` or any ordinary local storage. Metadata is ungated on purpose — the lock
screen must render its label without raising a prompt — and carries nothing that is
useful to an attacker beyond which account last enabled the lock.

**The honest boundary: this is a lock, not encryption.** The session refresh token stays
in `fleetops_refresh_token`, readable, and is *not* behind the biometric gate. Both
alternatives were tried on paper and fail on this platform: Android gates **writes** too,
so re-sealing a copy after each 15-minute rotation prompts every 15 minutes; and
re-sealing only at lock time hands back a superseded token whose presentation wipes the
whole refresh family, signing the driver out. Leaving it readable is also what keeps
background trip GPS alive while locked. The consequence, stated rather than implied:
**a patched JS bundle or injected code inside the app sandbox defeats this lock.** It
raises the cost of casual access; it is not a boundary against an attacker who controls
the app's own code.

**Revocation always wins.** Biometric success releases a local gate and mints nothing.
Every server-side revocation path (Sign Out, admin revoke, `auth_version` bump, account
disable, refresh expiry) still produces a 401 on the next request, including immediately
after a successful unlock.

**Enrollment tampering is handled by the OS, not by our code.** iOS `biometryCurrentSet`
permanently invalidates the sentinel when the enrolled set changes — adding a fingerprint
to a seized but unlocked phone does not open FleetOps. A settled read returning `null` is
treated as `CREDENTIAL_INVALIDATED`: biometric login is switched off locally, the driver
keeps their session, and the password path takes over. There is no fallback to an
unprotected local credential.

**Not protected against, and not claimed:**

- **Rooted / jailbroken devices.** No integrity check exists anywhere in this repo — no
  `jail-monkey`, SafetyNet, Play Integrity or `expo-device` usage — and the OS keystore is
  the trust anchor, so on a rooted device that anchor is gone. Adding a "root detected =
  secure" check was declined as unreliable in both directions.
- **A compromised device-owner account**, server-side account compromise, or privileged
  malware.
- **The 5 minutes after an unlock**, by design.
- **iOS app-switcher snapshots are best-effort.** Android sets `FLAG_SECURE` while the
  privacy veil is up; iOS obscuring needs a native scene-delegate hook this app does not
  have, and the JavaScript cover may land after the snapshot is taken.
- **The backgrounded-not-yet-locked window** before the 5-minute threshold elapses.
- **Weak biometrics on Android — closed, but worth knowing it needed closing.** The
  installed `expo-local-authentication` types default `authenticateAsync` to
  `biometricsSecurityLevel: 'weak'` on Android, which admits Class 2 camera-based face
  unlock — materially weaker than a fingerprint. The lock is still safe because
  `SecureStore.canUseBiometricAuthentication()` returns `false` unless the enrolled method
  is *sufficiently secure*, and `getCapability()` consults it before the enable toggle is
  offered at all, so a weak-biometric-only device cannot switch the lock on.

**Language discipline.** This is a **convenience lock**. No claim of "bank-level
security", "100% secure", or that biometrics replace the password. Password + mandatory
email OTP remains the only way to establish a session, and the server remains the sole
authority on whether one is valid.

**Verification — run 2026-09-23, results below are actual output, not intent.**

- `mobile/lib/app-lock.test.js` (18), `biometric-method.test.js` (14) and
  `biometric-errors.test.js` (23) — **55 tests, all passing.** They pin the lock policy
  (including fail-closed behaviour on a backwards clock), the platform-correct labels,
  and the error/state matrix.
- `npx eslint mobile/` — **0 problems.** This is the gate that caught a defect reading had
  missed: a `react-hooks/refs` warning for assigning `enabledRef.current` during render in
  `app-lock-context.jsx`. Plain `npm run lint` exits 0 on a warning, so only `lint:ci`
  (`--max-warnings 0`) would have failed the pipeline; the ref is now written from an effect.
- `npm run verify:auth` — **276 passed, 0 failed** across 276 exported HTTP methods. No
  route gained or lost a guard.
- `npm run db:status` — **122 files, applied 122, pending 0, changed 0.** No migration
  was added or altered. (It also lists 4 ledger-only filenames — 113, 114, 115, 120 —
  which are pre-existing gaps, now recorded in `AGENTS.md`.)

The full-repo `vitest run` aborted on an out-of-memory fault late in the run, after ~140
of 143 files and with no failures recorded before the abort. That is environmental and
pre-existing (see the vitest memory note), not caused by this change; the three new
suites ran to completion and reported their own counts. **Physical-device E2E on both
platforms remains the outstanding gate.**

One planned gate was **not** run: `npm run build`, the production web build. This change
touches nothing under `src/**`, so it cannot affect that build — but that is reasoning
rather than a measurement, and it is recorded as such instead of being listed above.

**What the device run then found (2026-09-23).** The rebuilt dev client crashed on first
launch: `AppPrivacyVeil` was imported as a *named* import from a default-only module, so it
resolved to `undefined` and React rejected the element. One word — the braces — in
`app/_layout.js`. It is fixed, and it is recorded here rather than quietly corrected
because of what it says about the list above: **every automated gate in this section was
structurally blind to it.** The lint setup is ESLint 9 with `eslint-config-next` and no
`eslint-plugin-import`, so `import/named` — the one rule written for this exact mistake —
is not enabled; the unit tests never render `app/_layout.js`; and no type checker runs on
these `.js` files. Green lint and a green unit suite are not evidence that a screen
renders. The unrun gate was the only one that could have caught it, and it caught it on the
first launch.

**Checked against the installed native typings, not just the docs** (`expo-local-authentication@17.0.9`,
`expo-secure-store@15.0.8`): `requireAuthentication` → iOS `biometryCurrentSet` /
Android `setUserAuthenticationRequired(true)` (the enrollment-invalidation claim above);
`WHEN_UNLOCKED_THIS_DEVICE_ONLY` and `authenticationPrompt` present; and every member of
the `LocalAuthenticationError` union mapped explicitly, with the test asserting on the
full union. That check caught one real defect — the map keyed on `unavailable`, which the
native layer never emits, so a genuinely unavailable sensor fell through to the generic
message. The real code is `not_available`; it is now mapped, and a test pins it.

## Related

[[Authentication]] · [[Why RLS Is Not A Boundary]] · [[Bugs]] · [[Current State]]
