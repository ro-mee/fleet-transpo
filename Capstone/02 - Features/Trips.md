---
type: feature
status: working
tags: [feature, trips, mobile]
source:
  - src/app/api/trips/[id]/start/route.js
  - src/lib/scheduling/trip-state.js
  - src/lib/vehicles/odometer.js
  - mobile/lib/tracking.js
last_verified: 2026-08-11
related: ["[[Dispatch]]", "[[Mobile Architecture]]"]
---

# Feature: Trips

## What it does

Records what actually happened: start odometer, GPS positions, arrival, completion odometer.

A [[dispatchschedules]] row is the **promise**; a `trips` row is the **execution**. 2 rows.

## How it works

```mermaid
flowchart LR
    D[Dispatch created] --> T["trip row<br/>status=ASSIGNED"]
    T --> A["driver accepts (mobile)"]
    A --> S["POST /trips/:id/start<br/>+ start odometer"]
    S --> G["GPS every 30s<br/>while foreground"]
    G --> AR[ARRIVED]
    AR --> C["POST /trips/:id/complete<br/>+ end odometer"]
    C --> R["request → Completed"]
    C --> N["trigger_notify_trip_completed"]
```

## The state machine is rank-based, not adjacency-based — CONFIRMED

`src/lib/scheduling/trip-state.js`:

```js
const RANK = {
  ASSIGNED: 0, PENDING: 1, APPROVED: 2,
  VEHICLE_ASSIGNED: 3, DRIVER_ASSIGNED: 4, DISPATCHED: 5,
  DRIVER_ACCEPTED: 6, TRIP_STARTED: 7, IN_PROGRESS: 7,
  EN_ROUTE: 8, ARRIVED: 9, COMPLETED: 100
};
const TERMINAL = { Completed, Cancelled };
```

`canTransitionTrip` enforces **monotonic non-decreasing rank** — you may skip forward, never go back.

Two details worth noting:

1. **`TRIP_STARTED` and `IN_PROGRESS` share rank 7.** They're synonyms; equal rank means either can follow the other. Deliberate.
2. **`COMPLETED` is 100, not 10.** A deliberate gap so intermediate states can be inserted later without renumbering. Small thing, good instinct.
3. **`CANCELLED` has no rank.** `isValidTripStatus` accepts it through a separate `||` branch. Same pattern as [[Dispatch State Machine]] — cancellation is orthogonal to progress, so it sits outside the ordering.

13 status values in `chk_trip_status` (`012_status_constraints.sql:65`).

→ [[Trip State Machine]] · [[State Machines]]

## Odometer validation — CONFIRMED

`src/lib/vehicles/odometer.js` → `validateOdometerReading()`. Pure function, no I/O. Guards against a reading lower than the vehicle's last known value — the cheap check that keeps mileage-derived reporting honest.

## Database tables used

[[trips]] (2) · [[dispatchschedules]] · [[transportation_requests]] · `vehicles` · `drivers` · `audit_logs`

## Edge cases

- **Trip id doesn't exist** → 404. ~~🔴 threw `ReferenceError`, returning 500~~ →
  **fixed 2026-08-11**, the import was missing. → [[BUG AuthError Not Imported]]
- **Not the driver's trip** → 404, not 403, so ids can't be enumerated. → [[Anti Enumeration 404 vs 403]]
- **Expired vehicle document** → `isExpired()` check at start
- **App backgrounded mid-trip** → GPS stops. Foreground-only by design. → [[Tracking]]

## Open questions

- With 2 rows, most of this is unexercised. Which of the 13 trip statuses have ever actually occurred? **TODO:** `SELECT status, count(*) FROM trips GROUP BY status`.

## Related

[[Trip State Machine]] · [[Dispatch]] · [[Tracking]] · [[Mobile Architecture]] · [[Feature Index]]
