---
type: feature
status: working
tags: [feature, vehicles, fleet]
source:
  - src/app/api/vehicles
  - src/app/(dashboard)/fleet
  - src/lib/vehicles/odometer.js
last_verified: 2026-08-11
related: ["[[Dispatch]]", "[[Maintenance]]"]
---

# Feature: Fleet And Vehicles

## What it does

The vehicle registry: 20 vehicles, their categories, documents, odometer readings, and availability status.

## Key pieces

| Piece | Where |
|---|---|
| Categories | `vehiclecategories` — used by [[transportation_requests]].`requested_category_id` |
| Odometer validation | `src/lib/vehicles/odometer.js` — pure, rejects readings below last known |
| Document expiry | `isExpired()` checked at trip start; drives `trigger_notify_document_expiry` |
| Status sync | `syncVehicleStatus()` in `src/services/status.service.js:11` |
| Number coding | last plate digit → [[UVVRP Number Coding]] |

## Availability is derived, not stored

A vehicle is unavailable if it has an overlapping [[dispatchschedules]] row, is grounded by an incident, or has an expired document. There's no single `available` boolean that could go stale.

Except — grounding is currently broken: **any** incident grounds **any** vehicle. → [[BUG shouldGroundVehicle Is A Stub]]

## Missing pages — CONFIRMED

- `/fleet/availability` — **no page file**
- `src/app/(dashboard)/fleet/maintenance/` — **empty directory**

INFERRED: nav links may point here. **TODO:** grep the nav component.

## Database tables used

`vehicles` (20) · `vehiclecategories` · [[driver_vehicle_assignments]] · `vehicleinspection` **0 rows** · [[dispatchschedules]]

## Related

[[Dispatch]] · [[Maintenance]] · [[Fuel]] · [[UVVRP Number Coding]] · [[Feature Index]]
