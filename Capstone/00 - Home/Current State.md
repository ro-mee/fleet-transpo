---
type: status
title: Current State
tags: [status, dashboard]
source:
  - "(whole repository)"
  - "live DB dnxuphhxlzidvwtdqqkq"
last_verified: 2026-08-20
---

# Current State

> Read this before every session. Update it after every significant change.

## What is working — CONFIRMED

- **Full request pipeline:** Booking ingest → queue → review → approve → assign → dispatch → trip start → complete → outbound notify. See [[Request Lifecycle]].
- **RBAC:** 6 roles, enforced on all **113** API routes via `requireAuth` (was 119; the 6-route `/api/reservations/*` tree was deleted 2026-08-11). `scripts/verify-rbac.mjs` pins the UI matrix to the per-route role lists — **78 checks pass**. See [[RBAC]].
- **Mobile driver app:** login, trips, accept, GPS, fuel, incidents. See [[Mobile Architecture]].
- **AI advisory:** deterministic rule engine + predictive maintenance. See [[AI Advisory]].
- **UVVRP number coding:** live and set to `block` mode for Manila.
- **Double-booking prevention:** app check + DB trigger. See [[ADR-006 Dual Double-Booking Guard]].
- **Test suite:** **362 tests across 27 files, all passing** (run 2026-08-20). Caveat worth keeping in view: the suite passes even when a deleted symbol is still imported — it is not a link check. → [[Things I Should Not Forget]]
- **Schema is recorded in the repo** — `schema.sql` is checked in, so drift is visible in any diff, and a ledger records what has been applied. Rebuilding a fresh DB is `schema.sql` + `migrate.mjs baseline`, **not** `db:up` — and that path is untested. The runner hashes LF-normalized content (EOL churn can't trip it) and offers `db:rebaseline` for the rare deliberate re-record. See [[Migrations]].

## What is broken — CONFIRMED

| Issue | Severity | Note |
|---|---|---|
| ~~A live DB password sits in git history~~ | ~~**1**~~ | **CLOSED 2026-08-11 — rotated.** The leaked value is now rejected by the server. History still holds it; it is worthless. → [[SEC Database Password In Git History]] |
| `npm run lint` reports 38 errors / 33 warnings (pre-existing, all in UI code) | — | [[Bugs]] |

**Fixed in this session — 2026-08-11:**

| Was broken | Fix | Verified |
|---|---|---|
| `AuthError` used but never imported → 500 instead of 404 | import added in `src/app/api/trips/[id]/start/route.js` | lint clean |
| `shouldGroundVehicle` grounded **every** incident | now implements its documented rule; test inverted | **8 tests pass in file** |
| Test suite could not execute — vitest not installed | `npm i -D vitest@^3.2.7`; `vitest.config.mjs` already existed | **197 tests, 16 files pass** |
| `vehiclereservations` (0 rows, dead since migration 016) and its unreachable sync branch | migration 036 dropped the table, 2 columns, 2 FKs, 2 indexes, 2 trigger functions; removed `syncDispatchReservation()` + 5 call sites + the `/api/reservations/*` tree | `db:dump` diff, no schema drift |
| The two ingest doors wrote **13 vs 19 columns** — a pulled request landed with no category, estimate, reservation number or timeline | one shared `ingestRequest()` in `src/lib/integration/ingest.js` | **6 new tests**, one asserting both doors emit an identical SQL string + params |
| `README.md` was `create-next-app` boilerplate; `docs/rbac-model.md` documented **9** roles; 4 ERDs modelled the pre-013 branch schema | all three rewritten, `docs/erd/` deleted — `schema.sql` replaces it | RBAC harness 78 checks |
| `Badge` / `Search` used but never imported in `assign-dialog.jsx` | both imports added | lint clean |
| `setRequestFlags` used but never imported in `reservations/queue/page.js` | import added — **4th instance of the same bug class** | 0 `no-undef` errors |
| `no-undef` was off, which is why all four survived | enabled in `eslint.config.mjs` with browser/node/serviceworker + Expo `__DEV__` globals | lint 60 → 38 errors |
| Root `proxy.js` (dead Supabase-ssr auth) shadowing confusion | deleted via `git rm` | `src/proxy.js` only remains |
| `'Pending Reassignment'` rejected by the state-machine validator | explicit `INTERRUPT` set in `dispatch-state.js` — a rank cannot express its cycle | **9 tests in file** |
| Live `chk_dispatch_status` had 5 values, migrations declared 4 | migration 033 | applied, no-op on live |
| 4 live tables + 1 column declared by no migration | migrations 034, 035 | applied, row counts unchanged |
| Every verification script silently loaded **no** env — `load-env.mjs` defaulted to a nonexistent `.env.local`, then choked on the BOM and CRLF | fallback list, BOM strip, `/\r?\n/` split | 10 keys load |
| No record of which migrations had been applied | `scripts/migrate.mjs` + `schema_migrations` ledger | tamper test refuses, exits 1 |
| **sev-1 API sweep 2026-08-20** — SQL-injection columns (9 routes), raw `api_key` leaked by `ai/providers` POST/PUT, driver fuel self-approval, mobile fuel resubmit 500 | allowlisted columns, shared `maskProvider()`, forced `Pending`, fixed `WHERE` placeholders | eslint clean on 13 files; **362/362 tests pass** → [[Bugs]] |

**Security Tier 1 — 2026-08-20:**

| Was broken | Fix | Verified |
|---|---|---|
| **S1 — anon-key privilege escalation on `employees`** (migration 009): the public Supabase anon key could `INSERT` an account at any `role_id` (including `system_admin`) and `SELECT` emails; `anon` also held full table grants (UPDATE/DELETE/…) | migration 060 drops both 009 policies + `REVOKE ALL ON employees FROM anon` | live `pg_policies` + `information_schema.role_table_grants` empty for `anon`; `db:dump` no drift |
| **S2 — seeded admin credential** (`admin123` hash shipped in migration 008) | migration 061 NULLs the known hash where it still matches; live admin password rotated to a fresh strong random hash (cost 10) | live `password_hash` no longer the seeded value; bcrypt verify `true` after rotation |
| **S3 — mobile login unthrottled** (`POST /api/mobile/auth/login` ran bcrypt compares with no rate limit — largest brute-force gap) | per-IP + per-account 5/min throttle mirroring the web login, 429 + `Retry-After` | eslint clean; **362/362 tests pass** |
| **Forgot/reset wrote through the anon key** — `auth.service.js` used the browser anon client for `signUp`/`resetPassword`/`updatePassword` | functions removed; server routes `POST /api/auth/forgot-password` (rate-limited, generic response, no email enumeration) and `POST /api/auth/reset-password` (session-bound employee, revokes `mobile_refresh_tokens`) replace them; pages rewired | lint clean on 6 files; manual smoke next deploy |

## What is incomplete — CONFIRMED

- ~~`/fleet/availability`, `/drivers/availability`~~ — added 2026-08-12 (Phase 4 item 15) with the shared `StatusBoard` component, **removed 2026-08-15**: availability is derived from schedule-overlap, not a board page → [[Fleet And Vehicles]] · [[Dispatch]]
- `src/app/(dashboard)/fleet/maintenance/` — **removed 2026-08-12**; maintenance CRUD lives at `/maintenance` (relocated there by `9c69f08`), the dir was an empty leftover
- **10 tables have zero rows** — `fuelrecords`, `vehicleinspection`, `notification_preferences`, `recommendation_snapshots`, `ai_insights`, `ai_recommendations`, `uvvrp_violations`, `driverattendance`, `service_types`, `booking_channels`. INFERRED: built, never exercised end-to-end. (Was 11; `vehiclereservations` was dropped rather than filled.)
- ~~Mobile: no push notifications~~ — added 2026-08-19: in-app 3-tier delivery layer (heads-up banners + toasts) upgraded to **real server-sent push** (Expo Push Service + FCM, `device_tokens` migration 058). **VERIFIED:** test push returned Expo ticket+receipt `ok` and delivered as a real OS notification. FCM V1 service account added to Expo; Android channel now created at startup (commit 175075b) so backgrounded/killed delivery displays. **Trigger-created notifications push via an outbox** (migration 059 + `flushOutbox`): dispatch assignments now send the assigned driver a loud OS push, verified end-to-end. Still missing: offline sync, background location (built; needs device rebuild), guest experience (per `mobile/README.md`)
- `HttpBookingGateway` throws `"not connected yet"` — only the mock gateway works

## Environment gaps — CONFIRMED

`.env` has 10 keys. **Missing:** `CRON_SECRET`, `BOOKING_WEBHOOK_SECRET`, `BOOKING_GATEWAY`, any LLM key.

Consequence: `/api/cron/sync` and the Booking webhook return **503 by design** (fail-closed). Scheduled compliance sync never runs. See [[Environment Setup]].

## Suggested next priorities

1. ~~Rotate the exposed database password~~ → **done 2026-08-11**, old value confirmed rejected. → [[SEC Database Password In Git History]]
2. Renumber or freeze the migrations — the ledger makes duplicate numbers survivable, not correct. `008` is still missing and `019` still appears ×3.
3. Fix the 38 pre-existing UI lint errors — [[Bugs]]. Largest group is 15 set-state-in-effect.
4. ~~Replace `README.md`~~ → **done 2026-08-11** → [[DOC README Is Boilerplate]]
5. ~~`SYSTEM.md` still describes the grounding bug as live~~ → **done 2026-08-11**; that passage and the second stub claim are gone. → [[Documentation Rot]]
6. Add an `engines` field to `package.json`. The README states Node 20.9+, which is **Next 16's** requirement — this repo declares none of its own.
7. **Security Tiers 2–3 (S4–S13)** from the 2026-08-20 gap analysis: CORS `"*"` in `next.config.mjs` + `src/proxy.js`, missing security headers, web+mobile sharing one JWT secret, no session revocation on role demote, admin→system_admin escalation, `GET /api/drivers` readable by `driver` role, unconstrained uploads, OCR SSRF, `clientIp()` trusting `x-forwarded-for`, forgot-password response differences (mitigated, not eliminated). → [[Security Audit]]

## Pending decisions

- ~~whether `vehiclereservations` should be dropped or revived~~ — **DECIDED 2026-08-11: dropped**, migration 036. It had 0 rows, no writer, and its only consequence was a sync branch that never fired. → [[vehiclereservations]]
- **UNKNOWN:** whether to keep `substitute_vehicle_schedules`. It has **1 live row** (this vault previously recorded 0) and no references in `src/`. Migration 034 declares it rather than dropping it, because dropping destroys the row and that is a product call, not a cleanup call.
- ~~whether this vault should be committed to git~~ — **DECIDED 2026-08-11:** it stays untracked, OneDrive is the backup. Consequence: no version history, and `git add -A` would sweep it in → [[Things I Should Not Forget]]
- **UNKNOWN:** whether the single row in `aiproviders` holds a working LLM key
- **UNKNOWN:** whether to renumber or freeze the migrations. `008` is missing, `019` appears ×3. The `schema_migrations` ledger keys on **filename**, which makes the duplicates survivable — it does not make them correct.

## What to learn next

- [[Tests Can Encode Bugs]] — the grounding bug is the case study
- [[TOCTOU And Advisory Locks]] — how migration 023 solved a real race
- [[Anti-Corruption Layer]] — the pattern this whole integration layer is built on

---

## Project scale — CONFIRMED (live query, 2026-08-11, after Phase 3)

| Metric | Value |
|---|---|
| Live tables / views | 38 / 1 |
| Foreign keys | 77 |
| Indexes (standalone) / functions / triggers | 84 / 11 / 16 |
| API route files | 113 |
| Pages | 61 |
| Migrations | 63 files (43 at 2026-08-11; through 061 `invalidate_seeded_admin_hash`) |
| Test files | 27 — **362 tests, all passing** |

Counted from the checked-in `schema.sql`, regenerated with `npm run db:dump`.
One of the 38 tables is `schema_migrations`, the ledger created 2026-08-11.
Migrations 033–035 **declared** four tables that already existed (`ailogs`,
`ai_report_narratives`, `system_settings`, `substitute_vehicle_schedules`)
without creating anything; migration 036 then **removed** one
(`vehiclereservations`), along with 2 FKs, 2 indexes and 2 trigger functions —
which is where the drops from 88→77 FKs, 95→84 indexes, 13→11 functions and
19→16 triggers come from. **How this vault previously arrived at "37 / 86" is
not recorded**; treat those as unverified rather than as a measurement of
something specific.

**Data volumes indicate a demo deployment, not production:** 20 vehicles, 23 drivers, 15 requests, **2 trips, 2 dispatches**. 29 of 47 employees are soft-deleted test-harness accounts.

## Related

[[Home]] · [[Bugs]] · [[Technical Debt]] · [[Open Questions]] · [[Roadmap]]
