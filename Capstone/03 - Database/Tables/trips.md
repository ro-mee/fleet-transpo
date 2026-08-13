---
type: reference
title: trips
tags: [database, table, trips]
source:
  - src/lib/scheduling/trip-state.js
  - src/app/api/trips/
last_verified: 2026-08-11
---

# Table: `trips`

**2 rows** — CONFIRMED. The execution record of a dispatch: the leg a driver actually performs.

## Role in the chain

```
transportation_requests → dispatchschedules → trips
```

A dispatch is a *booking*; a trip is the *doing*. GPS pings, status progression, and arrival all attach here. → [[Request Lifecycle]]

## Status — 16 values, adjacency graph

Governed by `src/lib/scheduling/trip-state.js`. Legal moves are dictated by an explicit adjacency graph (`NEXT` map). → [[Trip State Machine]]

With 2 rows, **at most 2 of the 16 statuses have ever occurred.** Which ones is answerable in one query:

```sql
SELECT status, count(*) FROM trips GROUP BY status;
```

→ [[Open Questions]]

## Notable — cancellation state

`CANCELLED` is explicitly supported as a terminal state. Like `COMPLETED`, once a trip is `CANCELLED`, it cannot transition to any other status.

## Ownership check

Driver-facing routes call `assertTripOwnership()`, which returns **404** (not 403) for a trip that isn't the caller's — deliberate, since trip ids are sequential integers. One route implements this incorrectly: `src/app/api/trips/[id]/start/route.js:67` throws an unimported `AuthError`, producing a 500. → [[Anti Enumeration 404 vs 403]] · [[BUG AuthError Not Imported]]

## Mobile interaction

The driver app reads its assigned trips and writes status + GPS. Foreground only — background location was deliberately scoped out. → [[Mobile Architecture]] · [[ADR-010 Foreground Only GPS]]

## What to verify before trusting reports

Every trip-based metric in [[Reports]] is computed over these 2 rows. Averages, utilisation, and on-time rates are all arithmetic on a sample of two. Seed realistic data before believing any of it. → [[Roadmap]]

## Related

[[Trips]] · [[Trip State Machine]] · [[dispatchschedules]] · [[transportation_requests]] · [[Database Overview]] · [[ERD]]
