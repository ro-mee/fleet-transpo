---
type: table
title: vehiclereservations
tags: [database, table, legacy, dropped]
status: dropped
source:
  - supabase/migrations/014_reservations.sql
  - supabase/migrations/016_reservation_module.sql
  - supabase/migrations/036_drop_vehiclereservations.sql
dropped_on: 2026-08-11
last_verified: 2026-08-11
---

# Table: vehiclereservations

> **DROPPED 2026-08-11** — migration `036_drop_vehiclereservations.sql`, commit
> `5c12719`. This note is kept as history, not as a schema reference. The live
> reservations table is and was [[transportation_requests]].

**Was: legacy, 0 rows, no writer.**

The name was the trap: it looked like the reservations table and never was.

## History — CONFIRMED

| Migration | What happened |
|---|---|
| `014_reservations.sql` | Created this table with a **10-status** vocabulary |
| `016_reservation_module.sql` | **Retired** that vocabulary, moved the product onto `transportation_requests` with a 9-status CHECK, back-filled rows, normalised `Normal` → `Medium` |
| `036_drop_vehiclereservations.sql` | Dropped the table, both `reservation_id` columns, their FKs and indexes, and two orphaned trigger functions |

Between 016 and 036 the table sat empty for twenty-two migrations.

## What it cost while it existed

`dispatchschedules.reservation_id` was a live FK pointing here. Because the table
was empty, that column was always NULL on real rows — so `syncDispatchReservation()`,
which keyed on it, **never matched anything**.

The harm was never the unused table. It was a code path silently keyed to it,
which meant status propagation appeared to be implemented while doing nothing;
the dispatch and trip routes had grown their own inline `UPDATE ... SET status`
calls to compensate. Two mechanisms, one of them dead.
→ [[DEBT vehiclereservations vs transportation_requests]]

> **Correction.** This note previously located that helper in
> `src/lib/scheduling/sync.js`. **No such file has ever existed.** It was
> `src/services/status.service.js`. → [[Mistakes I Made]]

## What the drop actually took

Not just the table. The full removal was: 2 columns, 2 FKs, 2 indexes, 2 trigger
functions, 1 function, 5 call sites across 3 modules, and the `/api/reservations/*`
route tree that had been answering 410. A "cheap schema cleanup" reached further
than the one-line estimate suggested — worth remembering next time something is
described as trivially droppable.

The migration is idempotent (`DROP ... IF EXISTS` throughout), as required for
this repo where the live DB runs ahead of the files in places.

## Related

[[transportation_requests]] · [[dispatchschedules]] · [[DEBT vehiclereservations vs transportation_requests]] · [[Migrations]] · [[Database Overview]]
