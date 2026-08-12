---
type: table
title: driver_vehicle_assignments
tags: [database, table, concurrency]
source:
  - src/lib/db.js
  - src/services
last_verified: 2026-08-11
---

# Table: driver_vehicle_assignments

The **standing pairing** between a driver and a vehicle — distinct from a per-trip [[dispatchschedules]] booking. Often abbreviated `dva`.

## The interesting part: partial unique indexes — CONFIRMED

The table carries `uq_dva_active_*` **partial unique** indexes — unique only over rows where the pairing is active (something like `WHERE released_at IS NULL`).

Effect: **at most one active pairing per driver, and one per vehicle**, while unlimited historical rows are allowed. A plain `UNIQUE` couldn't do this; it would block the history.

## Why this table forced `withTransaction` into existence — CONFIRMED

From the docstring at `src/lib/db.js:56-72`:

> `query()` checks a connection out per call, so two statements from it can land on different clients and cannot share a transaction. Anything that must be all-or-nothing needs this instead — notably reassigning a driver's vehicle, where the old pairing has to close and the new one open atomically or the `uq_dva_active_*` partial unique indexes reject the pair mid-flight.

Reassigning a driver is two statements:

```
1. close the old active pairing   (set released_at)
2. open the new active pairing    (insert)
```

Run them on **different pooled connections** and there is a moment where **two active pairings exist** — the partial unique index rejects step 2. The operation fails for a reason that looks nothing like its cause.

`withTransaction(fn)` pins one client for both statements so the intermediate state is never visible.

**This is the single best worked example in the codebase of why connection pooling and transactions interact.** → [[Connection Pooling vs Transactions]]

## Related

[[drivers]] · [[vehicles]] · [[dispatchschedules]] · [[Connection Pooling vs Transactions]] · [[Database Overview]] · [[Driver Management]]
