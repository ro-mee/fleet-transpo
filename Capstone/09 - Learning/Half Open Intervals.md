---
type: learning
tags: [learning, scheduling, correctness]
source:
  - supabase/migrations/023_dispatch_overlap_guard.sql
  - src/lib/scheduling/conflicts.js
last_verified: 2026-08-11
---

# Concept: Half Open Intervals

## What it is

Represent a time range as `[start, end)` — start included, end **excluded**. Two ranges overlap when:

```
A.start < B.end  AND  A.end > B.start
```

Strict `<` and `>`. No `=` anywhere.

## Why it matters

Use closed intervals (`<=`, `>=`) and back-to-back bookings falsely conflict. A dispatch ending at 10:00 and the next starting at 10:00 share exactly one instant, and a closed test calls that an overlap.

The bug report is *"the system says the van is double-booked but it isn't"* — and the dispatcher's workaround is to fudge times, which is worse than the bug.

## How it appears in my project — CONFIRMED

`supabase/migrations/023_dispatch_overlap_guard.sql`:

```sql
scheduled_departure < $2
AND COALESCE(scheduled_arrival, scheduled_departure) > $3
```

Both comparisons strict. A 08:00–10:00 dispatch and a 10:00–12:00 dispatch on the same vehicle **both succeed**, which is right — the vehicle is free at 10:00.

## The `COALESCE` is the subtle part

`scheduled_arrival` is nullable. Without `COALESCE`, a NULL arrival makes the comparison NULL, the `AND` yields NULL, the row is not counted, and **the overlap check silently passes**. Every open-ended dispatch would be invisible to the guard.

`COALESCE(scheduled_arrival, scheduled_departure)` treats a dispatch with no arrival as **zero-length** — it conflicts only with something spanning its exact departure instant.

That's a defensible reading, and worth knowing it's a *choice*. The alternative — treating NULL arrival as "occupies the vehicle indefinitely" — would block all later dispatches until an arrival is recorded. Stricter, arguably safer, much more annoying. **The repository does not currently document why this decision was made.**

## In three-valued logic, NULL is the real hazard

The general lesson generalises past intervals: in SQL, a comparison against NULL is neither true nor false. A `WHERE` clause silently drops those rows, so **a guard that forgets NULL fails open** — it finds no conflicts and permits the write. → [[Fail Closed By Default]]

Whenever a nullable column appears in a safety check, ask what the NULL case means before writing the comparison.

## Where else this shows up

The same convention should hold in `src/lib/scheduling/conflicts.js` — the app-level pre-check. If the two disagree, the UI and the database give different answers for the same booking and it looks nondeterministic. → [[ADR-006 Dual Double-Booking Guard]]

## Common mistakes

| Mistake | Consequence |
|---|---|
| `<=` / `>=` | Back-to-back bookings rejected |
| Forgetting `COALESCE` on a nullable bound | Guard silently passes |
| App and DB using different conventions | Non-reproducible conflicts |
| `BETWEEN` | It's inclusive on both ends — never use it for ranges |
| Mixing timezones across the comparison | Off-by-hours overlaps |

## Related concepts

[[TOCTOU And Advisory Locks]] · [[Fail Closed By Default]] · [[Dispatch]] · [[ADR-006 Dual Double-Booking Guard]] · [[Learning Dashboard]]
