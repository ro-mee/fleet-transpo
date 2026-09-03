---
type: moc
title: Feature Index
tags: [moc, features]
source:
  - src/app/api
  - src/app/(dashboard)
last_verified: 2026-08-22
---

# Feature Index

Each note answers: what it does, why it exists, how it works, which files, which tables.

## The main line

| Feature | State | Note |
|---|---|---|
| Reservations / request intake | ✅ working (15 rows) | [[Reservations]] |
| Dispatch & assignment | ✅ working (2 rows) | [[Dispatch]] |
| Trip execution | ✅ working (2 rows) — sev-1 fixed 2026-08-11 | [[Trips]] |
| GPS tracking | ✅ foreground + background; unavailable-location recovery WIP | [[Tracking]] |

## Resources

| Feature | State | Note |
|---|---|---|
| Fleet & vehicles | ✅ working (20) | [[Fleet And Vehicles]] |
| Driver management | ✅ working — grounding stub fixed 2026-08-11 | [[Driver Management]] |
| Driver assignments & substitutes | ✅ centralized module `/fleet/assignments` (2026-08-23); detail-page cards now view-only | [[Assignments]] |
| Incidents | ✅ report→ground→resolve loop closed 2026-08-23 | [[Incidents]] |
| Maintenance | ⚠ empty route dir; incident→emergency-repair path live | [[Maintenance]] |
| Fuel | ⚠ Gemini scanner user-confirmed; post-change DB save pending | [[Fuel]] |
| Travel Expenses | ⚪ built; requires audit workflow | [[Travel Expenses]] |
| Routes registry | ✅ Canonical directional routes with location identities, post-use lock, and TomTom estimates | [[Routes]] |

## Cross-cutting

| Feature | State | Note |
|---|---|---|
| AI advisory | ✅ deterministic, LLM optional | [[AI Advisory]] |
| UVVRP number coding | ✅ policy live in `system_settings` | [[UVVRP Number Coding]] |
| Notifications | ✅ DB-trigger driven (164 rows) | [[Notifications]] |
| Booking integration | ⚠ contract built, far end mocked | [[System Boundaries]] |
| Driver consent & visibility | ✅ | [[Driver Consent]] |
| Reports & analytics | ✅ separate role-guarded pages; honest empty-state cleanup WIP | [[Reports]] |

Legend: ✅ exercised · ⚠ works with a known problem · ⚪ built but zero rows

## The eleven zero-row tables

`fuelrecords`, `vehicleinspection`, `notification_preferences`, `recommendation_snapshots`, `ai_insights`, `ai_recommendations`, `uvvrp_violations`, `driverattendance`, `service_types`, `booking_channels`

Ten, not the eleven this note used to list. `vehiclereservations` left the list by being **dropped** (migration 036) rather than exercised — the distinction matters, because "empty" can mean *not yet used* or *nothing will ever write here*, and only the second is safe to delete.

INFERRED: UI and API exist for most of these; the workflows have never been run end-to-end. That's the honest state of the project — **broad, not deep**.

## Related

[[Home]] · [[System Overview]] · [[Data Flow]] · [[Where Is This]] · [[Current State]]
