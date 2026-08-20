---
type: security
title: Security Audit
tags: [security, audit, roadmap]
source:
  - "src/app/api/**/route.js"
  - "src/lib/auth.js"
  - "src/lib/rate-limit.js"
  - "supabase/migrations/009_registration_policy.sql"
last_verified: 2026-08-20
---

# Security Audit

Findings from the 2026-08-20 gap analysis of the FleetOps web app + mobile driver app.

## Tier 1 — CLOSED 2026-08-20

| # | Finding | Status |
|---|---|---|
| S1 | Anon-key privilege escalation on `employees` (migration 009 policies + default anon table grants): anyone with the public anon key could insert a `system_admin` or overwrite a password hash | **CLOSED** — migration 060 drops both policies + `REVOKE ALL`; verified live |
| S2 | Seeded admin credential (`admin123`, migration 008) | **CLOSED** — migration 061 NULLs the known hash where it matches; live password rotated |
| S3 | Mobile login (`POST /api/mobile/auth/login`) unthrottled bcrypt compares | **CLOSED** — per-IP + per-account 5/min throttle, 429 + `Retry-After` |

## Tier 2 — OPEN

| # | Finding |
|---|---|
| S4 | `Access-Control-Allow-Origin: "*"` hardcoded in `next.config.mjs` and `src/proxy.js` — any origin can call the API with a stolen session cookie |
| S5 | No security headers (HSTS/CSP/X-Frame-Options/referrer) on API responses |
| S6 | Web and mobile share one JWT secret — a leak compromises both token systems |
| S7 | No session revocation when a role is demoted (existing JWT keeps its old role claims until expiry) |
| S8 | No check preventing `admin` from escalating to `system_admin` |
| S9 | `GET /api/drivers` admits the `driver` role — drivers can enumerate their colleagues' data |
| S10 | Upload endpoints lack size/type limits (vehicle images, documents) |
| S11 | OCR endpoint can fetch arbitrary URLs (SSRF surface) |
| S12 | `clientIp()` trusts the first `x-forwarded-for` value — rate limits are spoofable |
| S13 | Forgot-password responds differently for existing vs missing emails in a narrow window (server-side existence check; generic response closes it at the HTTP layer) |

## Tier 3 — OPEN (design debt)

- Supabase RLS is not a boundary (all app access uses the DB role, RLS policies inert). → [[Why RLS Is Not A Boundary]]
- No CI gate asserting every `src/app/api/**/route.js` calls `requireAuth`/`requireDriver`; the guarantee is per-route discipline.
- `npm run lint` still reports pre-existing UI errors (38 at 2026-08-11).

## Related

[[Authentication]] · [[Why RLS Is Not A Boundary]] · [[Bugs]] · [[Current State]]
