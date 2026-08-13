---
type: reference
title: Important Files
tags: [codebase, reference]
source:
  - src/lib/api/utils.js
  - src/lib/db.js
  - mobile/lib/api.js
  - supabase/migrations/023_dispatch_overlap_guard.sql
last_verified: 2026-08-11
---

# Important Files

The dozen files that carry the system. If you understand these, you understand it.

## Tier 1 — nothing works without these

| File | Why |
|---|---|
| `src/lib/api/utils.js` | `requireAuth()`. **The entire authorization boundary**, used by all 113 routes. → [[Authentication]] |
| `src/lib/db.js` | The only place a DB connection is made. Both paths privileged. → [[ADR-004 Dual Database Access]] |
| `src/lib/auth.js` | NextAuth config — Credentials + JWT strategy |
| `src/lib/mobile-auth.js` | The separate mobile token system |

## Tier 2 — the domain model

| File | Why |
|---|---|
| `src/lib/scheduling/reservation-state.js` | 9 states, adjacency map, BFS `transitionPath()` → [[Reservation State Machine]] |
| `src/lib/scheduling/dispatch-state.js` | 5 states, 3 ranks, monotonic → [[Dispatch State Machine]] |
| `src/lib/scheduling/trip-state.js` | 16 states, explicit adjacency map → [[Trip State Machine]] |
| `src/services/reservation-lifecycle.service.js` | `advanceReservation()` — the single writer → [[ADR-007 Single Writer For Reservation Status]] |
| `src/lib/scheduling/conflicts.js` | App-level overlap detection (UX half of the guard) |

## Tier 3 — the boundary

| File | Why |
|---|---|
| `src/lib/integration/contracts.js` | Zod schemas that **are** the contract → [[Anti-Corruption Layer]] |
| `src/lib/integration/status-map.js` | 9 internal → 7 external status collapse |
| `src/lib/integration/booking-gateway.js` | Mock vs HTTP. HTTP **throws** — nothing is connected. |

## Tier 4 — read these to learn something

| File | What it teaches |
|---|---|
| **`supabase/migrations/023_dispatch_overlap_guard.sql`** | Advisory locks, TOCTOU, why not `EXCLUDE USING gist`, half-open intervals. **The best file in the repo.** → [[TOCTOU And Advisory Locks]] |
| **`mobile/lib/api.js`** | Single-flight token refresh, and a docstring that explains the race precisely → [[Token Rotation And Refresh Races]] |
| `src/lib/db.js:56-72` | Why connection pooling breaks multi-statement atomicity → [[Connection Pooling vs Transactions]] |
| `src/lib/ai/dispatch-advisor.js:11-14` | How to put an LLM in a real workflow safely → [[ADR-003 Deterministic AI]] |
| `supabase/migrations/002_rls_policies.sql:1-12` | *"⚠️ INERT AT RUNTIME"* — honest self-documentation → [[Why RLS Is Not A Boundary]] |
| `mobile/lib/rbac.js` | Client-side decode ≠ trust → [[Client Side Role Decoding Is Not Security]] |
| `supabase/migrations/024_driverincidents.sql` | What happens when a migration drops a table live code uses |

## Files to be suspicious of

| File | Problem |
|---|---|
| `src/lib/driver/grounding.js` | The grounding rule — breakdown-type **or** Major/Critical. Was a stub that grounded everything; fixed 2026-08-11 → [[BUG shouldGroundVehicle Is A Stub]] |
| `src/app/api/trips/[id]/start/route.js:67` | Undefined `AuthError` → [[BUG AuthError Not Imported]] |
| `src/services/integration.service.js` | Named like server ingest; is a **client** wrapper. The server-side writer is `src/lib/integration/ingest.js`. |

**Three entries left this table on 2026-08-11**, all rewritten against live rather
than annotated: `docs/rbac-model.md` (had claimed 9 roles), `docs/erd/*.mmd`
(deleted — `schema.sql` replaces it) and `README.md` (was `create-next-app`
boilerplate). Prefer the source anyway. → [[Documentation Rot]]

## Related

[[Codebase Map]] · [[Where Is This]] · [[Debugging Index]] · [[Learning Dashboard]] · [[Architecture]]
