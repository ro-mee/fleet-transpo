---
type: debt
status: resolved
severity: sev-2
tags: [debt, database, reservations, dispatch, resolved]
source:
  - supabase/migrations/036_drop_vehiclereservations.sql
  - src/services/status.service.js
  - supabase/migrations/016_reservation_module.sql
resolved: 2026-08-11
resolved_by: de0b078..5c12719
last_verified: 2026-08-11
---

# Debt: vehiclereservations vs transportation_requests

> **RESOLVED 2026-08-11** (roadmap Phase 3, item 11 — commit `5c12719`).
> `vehiclereservations` is dropped, both `reservation_id` columns are gone, and
> the dead sync branch is deleted. Kept for the reasoning, not as an open item.

## The problem — was CONFIRMED

The database had **two tables for the same business concept** (a guest
transportation request), and the seam between them was broken.

| Table | Rows | Written by | Usage |
|---|---|---|---|
| `transportation_requests` | 15 | inbound integration + `advanceReservation()` | **The live path** |
| `vehiclereservations` | **0** | nothing | Legacy — from the original 014 reservations module |

## The broken seam — was CONFIRMED

`syncDispatchReservation()` wrote to `dispatchschedules` **keyed on
`reservation_id`**, a column linking to `vehiclereservations`:

```js
UPDATE dispatchschedules SET status = ... WHERE reservation_id = ...
```

But rows created by the live dispatch flow carry **`request_id`**
(→ `transportation_requests`). The branch never matched a row.

> **Note on the source path.** Earlier versions of this note located that helper
> in `src/lib/scheduling/sync.js`. **No such file has ever existed** — confirmed
> against `find` and `git log --all`. The helper lived in
> `src/services/status.service.js`. See [[Mistakes I Made]].

## What was actually done

Migration `036_drop_vehiclereservations.sql`, plus the code change:

1. Dropped `vehiclereservations` (0 rows) and both `reservation_id` columns with
   their FKs and indexes.
2. Dropped two orphaned trigger functions that referenced the table.
3. Deleted `syncDispatchReservation()` and its 5 call sites across 3 modules.
4. Deleted the `/api/reservations/*` route tree — the endpoints that answered 410.

`dispatchschedules` now joins `transportation_requests` by `request_id` only,
which is option 1 of the three the original note proposed.

## The lesson that cost the most

Tests and lint both passed **while `syncDispatchReservation` was still imported
in three modules with five call sites.** Neither gate catches an unresolved
import in this setup — vitest only loads the modules its tests touch, and the
eslint config does not run `import/no-unresolved`. A full-tree grep for the
symbol after any extraction is not optional. → [[Things I Should Not Forget]]

## Why it happened — INFERRED

Migration `016_reservation_module.sql` retired the 014 ten-status reservation
vocabulary and moved the product onto `transportation_requests`. The old table
was left in place and the sync helper was never migrated to the new key. The
repository does not document why the table was kept rather than dropped at the
time.

## Related

[[transportation_requests]] · [[dispatchschedules]] · [[Request Lifecycle]] · [[Reservations]] · [[Technical Debt]] · [[Debugging Index]] · [[Mistakes I Made]]
