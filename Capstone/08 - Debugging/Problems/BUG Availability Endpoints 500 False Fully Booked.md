---
type: bug
status: closed
severity: sev-1
tags: [bug, availability, ai-assign, reservations, 500]
source:
  - src/app/api/vehicles/available/route.js
  - src/app/api/drivers/route.js
last_verified: 2026-08-18
---

# Bug: Availability endpoints 500 → AI-Assign shows false "Fully booked"

## Symptom

The AI-Assisted Assignment dialog reported **"Fully booked at this time slot"**,
**"0 vehicles available / 0 drivers on duty"**, even though the fleet had
eligible, unrestricted vehicles and drivers for the pickup window (e.g. RS-E9KZ,
a VIP Guest request at Aug 18 06:00 — 3 cat-1 vehicles and 5 drivers available,
no coding/insurance/schedule restriction).

## Root cause

Both availability endpoints re-declared `returnAt` inside a block that already
had an outer `returnAt` in scope, then referenced it in its own initializer:

```js
const returnAt = searchParams.get("return_at"); // outer (string | null)
...
if (pickupAt) {
  ...
  const returnAt = returnAt ? new Date(returnAt) : null; // TDZ ReferenceError!
```

`const returnAt` shadows the outer binding, so `returnAt ? ...` reads the
**inner, not-yet-initialised** binding → `ReferenceError: Cannot access
'returnAt' before initialization` → the route returned **500** whenever
`pickup_at` was present AND `return_at` was absent (exactly the dialog's call for
a request with no `scheduled_arrival`).

The dialog's `getAvailableVehicles` / `getDrivers` queries then failed, the
arrays stayed empty, and the UI fell into the "Fully booked / 0 / 0" empty state.
The availability data was never the problem — the routes were erroring.

## Fix

Renamed the inner binding to `returnDate` (and used `returnAt: returnDate` in the
`driverBlockReason` call), removing the self-shadowing in both files:
- `src/app/api/vehicles/available/route.js`
- `src/app/api/drivers/route.js`

## Verification

Reproduced through the real route handlers with the route-harness-loader for
RS-E9KZ (`pickup_at=2026-08-17T22:00:00.000Z`, no `return_at`):
- Before: 500 `ReferenceError` in both routes.
- After: `200` — `/api/vehicles/available` → **3** vehicles (TEST-9545/547/707),
  `/api/drivers` → **5** drivers (26, 22, 20, 2, 1).
- eslint clean on both files.
- Scheduling/uvvrp/services suites pass (5 pre-existing `driver-schedule.test.js`
  failures unrelated to this change).

## Related

[[AI Advisory]] · [[Reservations]] · [[Bugs]] · [[Fleet And Vehicles]]
