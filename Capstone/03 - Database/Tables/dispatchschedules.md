---
type: table
title: dispatchschedules
tags: [database, table, dispatch, concurrency]
source:
  - supabase/migrations/012_status_constraints.sql
  - supabase/migrations/023_dispatch_overlap_guard.sql
  - supabase/migrations/147_dispatch_service_type.sql
  - supabase/migrations/148_supply_dispatch_allocations.sql
  - src/lib/scheduling/dispatch-state.js
last_verified: 2026-10-07
---

# Table: dispatchschedules

The **resource booking**: this vehicle + this driver, for this time window. 2 rows.

A dispatch is not a trip. The dispatch reserves the resources; the [[trips]] row records what actually happened.

## Key columns — CONFIRMED

| Column | Note |
|---|---|
| `request_id` | FK → [[transportation_requests]]. **The only parent** since migration 036. |
| `service_type` | `PASSENGER` or `SUPPLY_DELIVERY`; NULL is retained for historical requestless rows whose purpose is unknown. New rows default to `PASSENGER`. This is dispatch work classification, distinct from `transportation_requests.service_type_id`, which names the Booking product. |
| `vehicle_id`, `driver_id` | The reserved resources |
| `scheduled_departure`, `scheduled_arrival` | The window. Arrival is nullable. |
| `status` | 5 values — migration 033 declared `Pending Reassignment`, which live already allowed. → [[BUG Pending Reassignment Not In State Machine]] |
| `dispatch_number` | Assigned by `trg_dispatch_number` |

> **Was two parents until 2026-08-11.** `reservation_id` (FK →
> `vehiclereservations`, always NULL) was dropped with its table in migration
> `036_drop_vehiclereservations.sql`. It used to be the schema's biggest wart.
> → [[DEBT vehiclereservations vs transportation_requests]]

## The overlap guard — CONFIRMED, and the best code in the repo

`supabase/migrations/023_dispatch_overlap_guard.sql` installs `guard_dispatch_overlap()`, a `BEFORE INSERT OR UPDATE` trigger. Read the migration header — it explains its own reasoning:

> *A literal `EXCLUDE USING gist` constraint can't be filtered by status.*

That is why a trigger, not a constraint: an exclusion constraint would block a *cancelled* dispatch from overlapping a live one, which is wrong.

```sql
PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
PERFORM pg_advisory_xact_lock(hashtext('dispatch_drv_' || NEW.driver_id));
-- then the half-open overlap test:
--   scheduled_departure < $2
--   AND COALESCE(scheduled_arrival, scheduled_departure) > $3
```

Three things worth internalising:

1. **The advisory lock is taken *before* the check.** That closes the TOCTOU window — two concurrent inserts serialise on the same lock key. → [[TOCTOU And Advisory Locks]]
2. **`pg_advisory_xact_lock`, not the session variant** — released automatically at commit or rollback. No leak path.
3. **Half-open interval** (`<` and `>`): a dispatch ending at 14:00 and one starting at 14:00 do **not** overlap. The `COALESCE` treats a missing arrival as a zero-length window.

Raises `ERRCODE 'P0001'`, which the API layer maps to a user-facing conflict message.

## Two guards, deliberately — CONFIRMED

`src/lib/scheduling/conflicts.js` also checks overlaps in application code. That check is for **UX** (show the conflict before submit); the trigger is for **correctness** (nothing gets through). → [[ADR-006 Dual Double-Booking Guard]]

## Status vocabulary — CONFIRMED

`src/lib/scheduling/dispatch-state.js`:

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);
```

Transitions are **rank monotonicity**, not adjacency — you may skip forward, never back. `Cancelled` is special-cased because it has no rank.

## Supply delivery work classification — 2026-10-07

Migration `147_dispatch_service_type.sql` adds a checked `service_type` discriminator to this shared resource reservation. Request-linked legacy rows are backfilled as `PASSENGER`; unlinked historical rows stay NULL rather than receiving an assumed purpose. New writes default to `PASSENGER`. The current general dispatch API stamps `PASSENGER` and rejects an explicit `SUPPLY_DELIVERY` request.

Migration `148_supply_dispatch_allocations.sql` adds a private allocation bridge to a shipment and exact manifest revision. Deferred consistency triggers require a cargo dispatch and its allocation to be committed together, with no passenger request and the current manifest revision. One shipment may have only one `ASSIGNED` allocation, and one dispatch may be allocated only once; ended allocation history remains. These constraints do not add a cargo assignment API or create dispatches/trips.

## Related

[[Dispatch]] · [[Dispatch State Machine]] · [[trips]] · [[transportation_requests]] · [[Database Overview]] · [[ERD]]
