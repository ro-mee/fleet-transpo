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
last_verified: 2026-08-22
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
| S6 | Web and mobile share one JWT secret — a leak compromises both token systems — **CLOSED 2026-08-22**: mobile JWTs sign with a dedicated `MOBILE_JWT_SECRET`; falls back to `NEXTAUTH_SECRET` with a warning so single-secret deploys keep working. Rotating it invalidates outstanding mobile access tokens immediately |
| S7 | No session revocation when a role is demoted (existing JWT keeps its old role claims until expiry) |
| S8 | **CLOSED 2026-08-22** — `canAssignRole()` permits only an existing `system_admin` to create another system administrator; covered by a security-boundary test |
| S9 | `GET /api/drivers` admits the `driver` role — drivers can enumerate their colleagues' data — **CLOSED 2026-08-22**: `driver` removed from that route's role list; drivers read only `/api/driver/me`, matching `GET /api/drivers/[id]` |
| S10 | **PARTIAL 2026-08-22** — vehicle images now require fleet-role authorization, ≤5 MB JPEG/PNG/WebP MIME + byte signatures, a real vehicle, and orphan cleanup; document/other uploads still need the same audit |
| S11 | OCR endpoint can fetch arbitrary URLs (SSRF surface) — **CLOSED 2026-08-22**: `src/lib/security/remote-url.js` restricts server-side fetches (Tesseract + LLM vision) on `scan-document` and `license-scan` to data URLs or fleet-controlled hosts; the fuel-scan route was already owner-checked |
| S12 | `clientIp()` trusts the first `x-forwarded-for` value — rate limits are spoofable — **CLOSED 2026-08-22**: keys on the rightmost (proxy-added) hop, validates IP shape, strips `:port` |
| S13 | Forgot-password responds differently for existing vs missing emails in a narrow window (server-side existence check; generic response closes it at the HTTP layer) |

## Tier 3 — OPEN (design debt)

- Supabase RLS is not a boundary (all app access uses the DB role, RLS policies inert). → [[Why RLS Is Not A Boundary]]
- CI now runs install, lint, **368 tests**, migration filename validation, and the production build. The security-boundary suite pins role escalation, generic 500 responses, and CORS behavior; a full static auth-guard scan remains a worthwhile addition.
- CI temporarily permits a bounded number of React Compiler/UI warnings; correctness errors remain blocking.

## Verification — 2026-08-22

- `src/security-boundaries.test.js`: 5 tests pass (added: rightmost-XFF keying, SSRF media guard).
- `src/lib/auth/mobile-token.test.js`: 4 tests pass (dedicated secret, cross-key rejection, fallback warning, fail-closed).
- `src/lib/uploads/vehicle-image.test.js`: 1 test passes.
- Full suite: **374/374 tests across 31 files pass**; lint:ci at the warning ceiling, 0 errors.
- `verify-rbac.mjs` repaired after route deletions in `0c0820c` rotted its inventory (review/reject/approve → flags/recommendation/assign); **72/72 checks pass** via `node --import ./scripts/route-harness-loader.mjs scripts/verify-rbac.mjs`.
- Security/CI commit: `1fae72c`; S6/S9/S11/S12 fixes uncommitted at time of writing.

## Related

[[Authentication]] · [[Why RLS Is Not A Boundary]] · [[Bugs]] · [[Current State]]
