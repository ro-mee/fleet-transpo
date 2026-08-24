---
type: reference
title: vehicles
tags: [database, table, fleet]
source:
  - src/lib/uvvrp/
  - src/lib/driver/grounding.js
last_verified: 2026-08-11
---

# Table: `vehicles`

**20 rows** — CONFIRMED. The fleet.

## The plate number is operational data, not a label

The last digit of the plate determines which weekday the vehicle **may not be dispatched** in Manila. Live policy from `system_settings.uvvrp_policy`:

| Weekday | Restricted plate endings |
|---|---|
| Monday | 1, 2 |
| Tuesday | 3, 4 |
| Wednesday | 5, 6 |
| Thursday | 7, 8 |
| Friday | 9, 0 |

`{ enabled: true, location: "Manila", response: "block" }` — **block**, not warn. A restricted vehicle is refused, not flagged. → [[UVVRP Number Coding]]

This is the one place where a data-entry typo in a plate number silently changes scheduling behaviour.

## Availability is derived, not stored

Whether a vehicle can be used on a given day is computed from several sources, none of which is a single "available" column:

| Input | Where |
|---|---|
| Overlapping dispatch | `trg_dispatch_overlap` on [[dispatchschedules]] |
| Number coding | [[UVVRP Number Coding]] |
| Grounded by incident | `shouldGroundVehicle()` |
| Active driver pairing | [[driver_vehicle_assignments]] |
| Maintenance | [[Maintenance]] |

The `/fleet/availability` page (with the shared `StatusBoard` component) was merged **2026-08-23** into `/dispatch/availability` (Drivers | Vehicles tabs). The board is a read-only projection of `vehicle_status` — availability itself is still derived. → [[Frontend]]

## Grounding affects this table's usefulness — CONFIRMED

`shouldGroundVehicle()` **used to** return `true` for every incident with a vehicle id, ignoring severity — and the caller did far more than set a status: it cancelled trips, unassigned the driver/vehicle pair, and reset the dispatch to `Pending Reassignment`. On a 20-vehicle fleet, a few cosmetic incidents would ground a meaningful fraction of it, and the symptom was low availability rather than an error. **Fixed 2026-08-11** — it now grounds only on a breakdown-type report or Major/Critical severity. → [[BUG shouldGroundVehicle Is A Stub]] · [[Bugs]]

## Assignment constraint

`uq_dva_active_*` partial unique indexes allow at most one **active** pairing per vehicle. Reassignment must close the old row and open the new one atomically. → [[Connection Pooling vs Transactions]] · [[driver_vehicle_assignments]]

## Related

[[Fleet And Vehicles]] · [[UVVRP Number Coding]] · [[Maintenance]] · [[Fuel]] · [[driver_vehicle_assignments]] · [[Database Overview]] · [[ERD]]
