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

## Current UX — VERIFIED 2026-08-23

- Reports has date presets, custom date ranges, report-type switching, CSV export, loading/error/empty states, and a number-grounded AI analyst card.
- Analytics keeps KPI, calendar, fuel, maintenance-risk, cost, and driver-performance views as a separate page rather than duplicating the report explorer.
- Hardcoded fallback values for fuel categories, monthly cost, maintenance risk, and driver rankings were removed today. Missing live data now renders an honest empty state.
- AI narrative generation treats empty or explicitly marked demo payloads as non-production input and does not invent operational findings.

### Query-honesty pass — 2026-08-23

Failure states across the reporting surfaces now follow the shared primitives in `src/components/ui/query-feedback.jsx` (`QueryBoundary`, `QueryErrorBanner`):

- **`/reports`** — an errored tab renders an explicit retry panel instead of the "No records in this period" empty copy (a failure must never read as an empty period). Genuine-empty arrays still get the empty state. Date bounds use a local-day helper (`toLocalDay`, `en-CA`) because `.toISOString()` dropped "today" at UTC+8; Custom with missing dates no longer silently searches 1970→2100 — it shows "Pick both dates to set a custom range.", holds the export button, and queries the default month. Plates stay whole as React keys/identity and are truncated only visually (`title` carries the full plate).
- **`/analytics`** — per-card `QueryErrorBanner`s above pickup volume, fleet-risk, fuel, and driver cards; the hardcoded "92% Healthy" badge was replaced with a healthy share derived from `maintenanceRiskPie` (hidden while data is absent); `KPI_TONES.danger.deltaText` fixed from `text-warning` to `text-danger`.
- **`/executive`** — banner-at-top per failed feed so partial data still shows; KPIs show "—" during load (never "…"); driver severity inverted grammar fixed (≥70 Strong/success, ≥40 Developing/warning, else Improving/info); root `select-none` removed.
- **Other surfaces** — `/reports/cost` uses `TableSkeleton` + right-aligned numeric columns + neutral Cost/km tone; `/fleet/documents` gained a compliance error panel and local-safe expiry dates via `formatCalendarDate`; `/maintenance/predictive` gates all-zero summaries behind a retry panel and rows link to `/fleet/vehicles/[id]`; `/tracking/history` KPIs are relabeled "(recent)" / "Latest 50 shown" (query caps at 50) and rows deep-link to `/trips/{trip_id}`; `/drivers/performance` has a retry panel, ghost refresh button, driver-entity `StatusBadge`, and a Score-column provenance tooltip ("Average smooth-driving score reported per completed trip" — the API computes `AVG(smooth_driving_score)` over completed trips).

The current report/analytics cleanup is **work in progress and uncommitted** as of 2026-08-23.

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
