---
type: feature
status: working
tags: [feature, reports, analytics]
source:
  - src/app/api/reports
  - src/app/(dashboard)/reports
  - src/app/(dashboard)/analytics
last_verified: 2026-08-22
---

# Feature: Reports

## What it does

Two separate role-guarded workspaces consume the report APIs and `recharts`:

- `/analytics` is the at-a-glance operational dashboard.
- `/reports` is the export/review workspace with Fleet, Fuel, Maintenance, Drivers, and Financial report modes.

Both routes support `admin`, `system_admin`, `fleet_manager`, and `management`; the wider dashboard shell adapts navigation and home content to the signed-in role.

## Current UX — VERIFIED 2026-08-22

- Reports has date presets, custom date ranges, report-type switching, CSV export, loading/error/empty states, and a number-grounded AI analyst card.
- Analytics keeps KPI, calendar, fuel, maintenance-risk, cost, and driver-performance views as a separate page rather than duplicating the report explorer.
- Hardcoded fallback values for fuel categories, monthly cost, maintenance risk, and driver rankings were removed today. Missing live data now renders an honest empty state.
- AI narrative generation treats empty or explicitly marked demo payloads as non-production input and does not invent operational findings.

The current report/analytics cleanup is **work in progress and uncommitted** as of 2026-08-22.

## Who it's for

The `management` role (id 7) — read + analytics, **explicitly denied lifecycle verbs**. This feature is essentially the whole reason that role exists. → [[RBAC]]

## The data problem — LAST LIVE CHECK 2026-08-11

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
