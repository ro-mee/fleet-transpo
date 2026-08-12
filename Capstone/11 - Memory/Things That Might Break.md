---
type: memory
title: Things That Might Break
tags: [memory, risk]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Things That Might Break

Ranked by **likelihood × how long it would take you to work out why**.

## Will break, given traffic

| What | Trigger | Symptom |
|---|---|---|
| Route auth coverage | one new route without `requireAuth` | **an open endpoint.** Nothing checks; 113 routes rely on per-route discipline → [[Authentication]] |
| Runtime `CREATE TABLE` on a hot path | concurrent first-hits | DDL contention, latency spikes → [[DEBT Runtime DDL On Hot Path]] |
| `mobile_refresh_tokens` growth | time | unbounded table, no cleanup job → [[mobile_refresh_tokens]] |
| Fleet availability | any incident | ~~`shouldGroundVehicle()` grounds everything~~ **fixed 2026-08-11** → [[BUG shouldGroundVehicle Is A Stub]] |

## Will break when someone does something reasonable

| What | Trigger | Why |
|---|---|---|
| Fresh-database setup | `git clone` + **replaying migrations** | Still broken, and `db:up` will not save you — the migration files *cannot* reproduce this database (duplicate numbers, 008 missing, non-idempotent files). The working path is: run `schema.sql`, then `node scripts/migrate.mjs baseline`. **Never actually executed against an empty DB.** → [[DEBT Schema Drift From Migrations]] |
| Migration ordering | adding a migration | 008 missing, 6 numbers duplicated, **019 three times** → [[ADR-008 Manual Migration Procedure]] |
| Dispatch status write | setting `'Pending Reassignment'` | **FIXED 2026-08-11** — migration 033 declares it and `dispatch-state.js` has an explicit `INTERRUPT` set → [[BUG Pending Reassignment Not In State Machine]] |
| `/api/trips/[id]/start` | a driver hits a trip that isn't theirs | **FIXED 2026-08-11** — `AuthError` is imported; returns 404 → [[BUG AuthError Not Imported]] |
| Onboarding a collaborator | reading `docs/` or either ERD | they'll learn a system that doesn't exist → [[Documentation Rot]] |
| Driver reassignment | writing it without `withTransaction` | partial unique index rejects mid-flight → [[Connection Pooling vs Transactions]] |

## Will break at the boundary

| What | Trigger | Consequence |
|---|---|---|
| Inbound webhook | anyone POSTs to it | `BOOKING_WEBHOOK_SECRET` absent — **unverified sender** → [[System Boundaries]] |
| Outbound status | going live | `BOOKING_GATEWAY` unset — mock. Nothing reaches Booking, silently. |
| Cron endpoints | going live | `CRON_SECRET` absent — unauthenticated or non-functional |
| CORS | a browser from another origin | wildcard → [[Technology Stack]] |
| AI bullet parsing | narration containing "Ave." or "3.5" | prose-level contract, split on `.` → [[AI Advisory]] |

→ [[Environment Setup]]

## Will break under concurrency — untested

`trg_dispatch_overlap` is the **only** real double-booking guard and has never actually been raced. The design is sound (advisory lock before the check, per-resource key, half-open intervals). It's unverified. A two-connection race test is Phase 4. → [[TOCTOU And Advisory Locks]] · [[Roadmap]]

## The reason this list is long

**Nothing in the repository verifies the repository.** No CI, no runnable tests, no schema check, no route-auth audit. Every item above was found by hand and would have to be re-found by hand. → [[Technical Debt]] · [[Testing]]

## Related

[[Technical Debt]] · [[Bugs]] · [[Things I Should Not Forget]] · [[Roadmap]] · [[Current State]]
