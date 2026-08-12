---
type: decision
status: accepted
date: 2026-08-11
tags: [decision, adr, concurrency, dispatch]
source:
  - supabase/migrations/023_dispatch_overlap_guard.sql
  - src/lib/scheduling/conflicts.js
last_verified: 2026-08-11
---

# ADR-006: Dual Double-Booking Guard

## Context

Two dispatchers can act at the same moment. Booking the same vehicle or driver for overlapping windows must be impossible — not merely unlikely.

An application-level check is inherently racy:

```
Dispatcher A: SELECT overlaps → none          Dispatcher B: SELECT overlaps → none
Dispatcher A: INSERT                          Dispatcher B: INSERT
                        → both succeed. Double-booked.
```

That's TOCTOU. → [[TOCTOU And Advisory Locks]]

## Options considered

1. **App check only** — racy. Rejected.
2. **`EXCLUDE USING gist` constraint** — the textbook Postgres answer for non-overlapping ranges. **Rejected, and migration 023 says why:**
   > *A literal `EXCLUDE USING gist` constraint can't be filtered by status.*
   A *cancelled* dispatch would still block an overlapping live one. Wrong behaviour.
3. **Trigger with advisory locks** — chosen for correctness.
4. **`SERIALIZABLE` isolation** — INFERRED not considered; would work but forces retry handling on every caller.

## Decision — CONFIRMED

**Both layers, with distinct jobs:**

| Layer | File | Job |
|---|---|---|
| Application | `src/lib/scheduling/conflicts.js` | **UX** — show the conflict before submit |
| Database | `trg_dispatch_overlap` (migration 023) | **Correctness** — nothing gets through |

The trigger:

```sql
PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
PERFORM pg_advisory_xact_lock(hashtext('dispatch_drv_' || NEW.driver_id));
-- then check, half-open:
--   scheduled_departure < $2
--   AND COALESCE(scheduled_arrival, scheduled_departure) > $3
-- RAISE ERRCODE 'P0001' on conflict
```

Three details that make it right:

1. **Lock before check.** Concurrent inserts serialise on the same key, closing the TOCTOU window.
2. **`pg_advisory_xact_lock`, not the session variant.** Released at commit/rollback — no leak path.
3. **Half-open interval.** A dispatch ending at 14:00 and one starting at 14:00 don't conflict. `COALESCE` treats a missing arrival as zero-length. → [[Half Open Intervals]]

## Consequences

**Good:**
- Double-booking is genuinely impossible, not just unlikely
- Cancelled dispatches don't block live ones — the thing `EXCLUDE` got wrong
- Good UX (early warning) *and* hard correctness

**Costs:**
- Overlap logic exists in two places and can drift. If `conflicts.js` and the trigger disagree, the user sees "no conflict" then gets a 409.
- The real guard is in SQL, invisible to anyone reading only `src/`
- `P0001` must be mapped to a friendly message in `handleError`
- Advisory locks briefly serialise dispatch creation per vehicle/driver — irrelevant at this scale

## Revisit if

- The two implementations drift → consider generating both from one definition, or dropping `conflicts.js` and relying on optimistic 409 handling
- Lock contention ever appears (it won't at 2 dispatches)

## Related

[[TOCTOU And Advisory Locks]] · [[Dispatch]] · [[dispatchschedules]] · [[Half Open Intervals]] · [[Decision Log]] · [[Defence In Depth]]
