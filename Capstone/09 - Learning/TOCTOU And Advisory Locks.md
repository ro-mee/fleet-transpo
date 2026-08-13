---
type: learning
tags: [learning, concurrency, postgres, database]
source:
  - supabase/migrations/023_dispatch_overlap_guard.sql
  - src/lib/scheduling/conflicts.js
last_verified: 2026-08-11
---

# Concept: TOCTOU And Advisory Locks

## What it is

**TOCTOU** — Time Of Check To Time Of Use. A gap between verifying a condition and acting on it, during which the condition can stop being true.

```
Request A: SELECT overlapping dispatches → none
                                              Request B: SELECT overlapping → none
Request A: INSERT                             Request B: INSERT
                    → both succeeded. Vehicle double-booked.
```

Neither request did anything wrong. The check was correct **when it ran**.

## Why it matters

**No amount of care in application code fixes this.** You can validate more thoroughly, add retries, check twice — the window remains, because the check and the insert are separate round trips and another connection can slip between them.

The fix has to come from something that can hold both operations under one lock. That means the database.

## How it appears in my project

`src/lib/scheduling/conflicts.js` performs exactly the racy check above. It is **still correct to have** — it gives the dispatcher immediate feedback before submitting. But it is a UX feature, not a safety guarantee. → [[ADR-006 Dual Double-Booking Guard]]

The real guard is `trg_dispatch_overlap`, installed by `supabase/migrations/023_dispatch_overlap_guard.sql`.

## Example from my codebase

```sql
-- BEFORE INSERT OR UPDATE ON dispatchschedules
PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
PERFORM pg_advisory_xact_lock(hashtext('dispatch_drv_' || NEW.driver_id));

-- only now check for overlap
--   scheduled_departure < $2
--   AND COALESCE(scheduled_arrival, scheduled_departure) > $3
-- RAISE EXCEPTION ... ERRCODE 'P0001'
```

Three things make this work:

1. **The lock is taken before the check.** A second transaction touching the same vehicle blocks at the `PERFORM` and doesn't reach its check until the first has committed or rolled back. The window is closed.
2. **`hashtext(...)` produces the lock key** from the vehicle/driver id, so transactions only contend when they involve the *same* resource. Two dispatches for different vehicles never block each other.
3. **`_xact_` — transaction-scoped.** Released automatically at commit or rollback. The session variant (`pg_advisory_lock`) would need an explicit unlock and leaks if the transaction dies.

The migration also explains why a constraint wasn't used:

> *A literal `EXCLUDE USING gist` constraint can't be filtered by status.*

An exclusion constraint would block a **cancelled** dispatch from overlapping a live one — wrong behaviour. That's why the check is a trigger with a `WHERE status …` predicate.

## Common mistakes

| Mistake | Why it fails |
|---|---|
| Trusting the app-level check | Racy by construction |
| Locking **after** the check | Doesn't close the window |
| `pg_advisory_lock` instead of `pg_advisory_xact_lock` | Leaks on error |
| Locking a global key instead of a per-resource one | Serialises all dispatch creation |
| `EXCLUDE USING gist` when status matters | Can't filter cancelled rows |
| Closed intervals (`<=`, `>=`) | Back-to-back bookings falsely conflict → [[Half Open Intervals]] |

## Related concepts

[[Half Open Intervals]] · [[Defence In Depth]] · [[Connection Pooling vs Transactions]] · [[ADR-006 Dual Double-Booking Guard]] · [[Dispatch]] · [[Learning Dashboard]]
