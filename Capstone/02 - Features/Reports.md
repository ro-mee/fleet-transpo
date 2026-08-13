---
type: feature
status: working
tags: [feature, reports, analytics]
source:
  - src/app/api/reports
  - src/app/(dashboard)/reports
last_verified: 2026-08-11
---

# Feature: Reports

## What it does

Analytics for management: 6 API routes under `/api/reports/`, dashboard pages, charts via `recharts`.

## Who it's for

The `management` role (id 7) — read + analytics, **explicitly denied lifecycle verbs**. This feature is essentially the whole reason that role exists. → [[RBAC]]

## The data problem — CONFIRMED

Reports are only as good as the data underneath, and the underlying tables are nearly empty:

| Source | Rows |
|---|---|
| `trips` | **2** |
| `dispatchschedules` | **2** |
| `fuelrecords` | **0** |
| `driverattendance` | **0** |
| `vehicleinspection` | **0** |

INFERRED: any report over fuel efficiency, driver attendance, or trip volume currently renders empty or near-empty. The queries may be correct; there is no way to tell from the output.

`driver_stats` (a **view**, no migration file) is presumably a reporting aggregate. → [[DEBT Schema Drift From Migrations]]

## What this means practically

**Do not treat a working reports page as evidence the reports are right.** With 2 trips, an off-by-one in a date range or a wrong join produces output indistinguishable from correct output.

**TODO:** seed a realistic dataset (say 200 trips across 3 months) and re-check each report against hand-computed expected values. This is the single highest-value testing task for the reporting feature.

## Related

[[RBAC]] · [[Database Overview]] · [[Fuel]] · [[Current State]] · [[Feature Index]]
