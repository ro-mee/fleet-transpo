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

## Pickup punctuality columns (2026-09-29, migration `139_driver_punctuality.sql`)

`at_pickup_at TIMESTAMPTZ NULL` — authoritative pickup-arrival timestamp,
written server-side on the `At Pickup` transition, first-write-wins so retries
never rewrite history. `at_pickup_override BOOLEAN NOT NULL DEFAULT FALSE` —
marks arrivals recorded with `geofence_override=true` (claimed, not
geofence-proven). Partial indexes `idx_trips_at_pickup` and
`idx_trips_driver_completed_end`. Pre-existing Completed rows have NULL and
correctly read as Not Measured. Punctuality anchor is
`dispatchschedules.scheduled_departure` with a 5-minute grace; see the Driver
Punctuality plan (`docs/superpowers/plans/2026-09-29-driver-punctuality.md`).
Writer implemented 2026-09-29 in `setTripStatus`
(`src/services/transition.service.js`, commit `6156c8e`): same-statement
`at_pickup_at = COALESCE(at_pickup_at, NOW())` stamp plus `OR` override latch,
AT_PICKUP transitions only; verified by
`src/services/transition-punctuality.test.js` (full suite 3228 passed).

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
