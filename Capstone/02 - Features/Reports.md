---
type: feature
status: working
tags: [feature, reports, analytics]
source:
  - src/app/api/reports
  - src/app/(dashboard)/reports
  - src/app/(dashboard)/analytics
last_verified: 2026-08-31
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

### Accessibility & guardrail pass — 2026-08-26

Impeccable critique scored the surface **24/40** with three P1s; all three are fixed:

- **Keyboard-trapped custom date range** — `DatePicker` trigger (`src/components/ui/date-picker.jsx`) was a non-focusable `div`; it is now a real `<button>` (Radix supplies `aria-haspopup`/`aria-expanded`), with a visible focus ring, and the clear action became an overlay sibling button (`aria-label="Clear date"`, positioned where the inline icon sat) so no button nests inside another. Consumer `className` still lands on the visual box.
- **Silent blank screen on unauthorized deep-links** — `RouteGuard` (`dashboard-layout.jsx`) rendered `null` when denied, so e.g. the `management` role tapping a plate on `/reports/cost` saw a white void before the redirect. It now renders an "Access restricted" panel (role lacks permission + "Go to Dashboard now") while `useRequireRole`'s redirect fires; `useRequireRole` additionally returns `loading`, and open (`*`) paths render immediately instead of blanking during session load.
- **Sub-14px semantic text failing WCAG 1.4.3** — new AA ink tokens `--{success,warning,danger,info}-700` in `globals.css` (light `#047857/#b45309/#b91c1c/#1d4ed8`, dark `#34d399/#fbbf24/#f87171/#60a5fa`; Tailwind classes `text-{status}-700`). All small status chips/liters/cumulative figures on `/analytics` and `/reports` moved to `-700`. Solid-fill exceptions use palette constants that hold contrast in both themes: heatmap peak pill `bg-blue-600 text-white`, rank medal `bg-warning text-amber-950`, inverted-tooltip unit rate `text-emerald-400 dark:text-emerald-700`. Base status tokens remain for chart fills/icons (3:1 graphics rule). Drive-by: both `py-0.2` typos → `py-0.5`.

Verification: eslint clean on all touched files, vitest 443/443, detector shows only the pre-existing low-impact `bounce-easing` warning. Still open from the critique (deferred by scope choice): dishonest empty states on `/analytics` (P2 #4), silent/UTC-stamped export (P2 #5), token-bypass hexes in the maintenance chart, `/reports/cost` retry-panel inconsistency, Badge component contrast (app-wide blast radius).

### P1 interaction batch — 2026-08-26 (second critique: 25/40)

Re-critique surfaced three new P1s; all fixed:

- **Export ends in silence / lies disabled** — `exportToCSV`/`exportToJSON` (`src/lib/export.js`) now stamp filenames with the local-day helper (`toCalendarDay`) instead of `toISOString()` (the UTC+8 yesterday-filed trap), and return `{ count, filename }`. `handleExport` on `/reports` toasts `Exported N rows — <file>` on success and `Nothing recorded in this period (<from> → <to>) to export.` when the active report has zero rows (previously a silent no-op while the button looked enabled).
- **Management dead-end via plate links** — `/reports/cost` renders plate numbers as plain text unless `can('vehicles','read')`; role 7 no longer gets bounced off `/fleet/vehicles/[id]`.
- **Inverted custom ranges** — `DatePicker` gained optional `minDate`/`maxDate` props (out-of-range days render disabled and are rejected in `handleSelectDay`); `/reports` couples From↔To (`maxDate={customRange.to}` / `minDate={customRange.from}`) so To < From can never reach the API.

### P2 batch — 2026-08-26

- **Charts visible to screen readers** — every recharts surface carries `role="img"` + plain-language `aria-label` summaries: pickup-volume trend, risk donut (names each tier count), both `/analytics` fuel composed charts, all three `/reports` charts (`ChartStage` gained a `label` prop).
- **Absence no longer dresses as health** — hero KPIs show an em-dash with neutral context while a feed has no snapshot; "Maintenance Risk Due" only takes success tone with a live prediction snapshot; empty donut swaps its pulsing green check for a static muted shield; `/analytics` fuel charts render honest `EmptyState`s instead of blank axes.

### Minor-tier backlog batch — 2026-08-26

- **Shared tone maps now AA** — `TONE_CHIP`/`TONE_TEXT` (`status-badge.jsx`) and `StatCard` tones render `-700` inks; fixes ~2.2:1 text at 10-12px in the AI analyst card, StatCard valueNotes, and every other consumer app-wide.
- **DatePicker `<select>`s focusable-visible** — month/year selects swap bare `focus:outline-hidden` for a primary ring + border.
- **URL-shareable report state** — `/reports` hydrates `report`/`range`/`from`/`to` from the query string (validated) and mirrors changes back via `history.replaceState`; a configured view is bookmarkable/shareable with no navigation cost.
- **Heatmap readable by SRs** — grid carries `role="img"` with peak-day/average summary; `role="img"` also silences decorative padding ghosts.
- **Scroll affordance restored** — `.scrollbar-thin` renders a slim translucent thumb instead of hiding bars entirely.
- **"All time" echo** — analytics timeframe header prints "All time" instead of literal `1970-01-01 → 2100-01-01`.

### AI analyst cross-report contamination fix — 2026-09-06

Switching report tabs (e.g. Fleet → Drivers) briefly or permanently rendered the
previous tab's AI copy under the new title — "AI Analyst - Driver performance"
above a "Fleet utilization is at 4%… busiest unit logged 1 trips" narrative.
Three compounding causes, all fixed:

- `AiAnalystCard` (`src/components/ai/ai-analyst-card.jsx`) fell back to a
  hardcoded fleet narrative + fleet actions whenever `data.narrative` was empty
  (which is exactly what the server returns while a tab's data is still loading:
  `mode: "no-data"`, `narrative: null`). The card now renders a neutral
  "Awaiting analysis / No analysis available" state — never another report's
  copy — and only renders a narrative whose server-echoed `report` matches its
  `report` prop. The hardcoded `2026-09-01 — 2026-09-05` footer date is gone;
  it shows the live window or "—".
- `/reports` (`src/app/(dashboard)/reports/page.js`) enabled the narrative query
  on `Boolean(narrativeData)`, but `{}` is truthy, so it fired before the active
  tab's report loaded; the fleet branch also fabricated `4%` / `1 trip` /
  `ABC-1234` fallbacks (`Number(x) || 4` turns a real 0 into "4%"). The query is
  now enabled only on `activeQuery.isSuccess + isValidReportPayload(...)`, the
  fleet fabrication is removed, the payload fingerprint is part of the query key
  (late-arriving report data triggers a refetch instead of sticking on
  "no-data"), and only `isNarrativeForReport(data, selectedReport)` output
  reaches the card — otherwise a "Generating analysis for X…" skeleton.
- New pure guards in `src/lib/ai/report-narrative.js`: `isValidReportPayload`
  (non-empty payload carrying the active report's schema fields) and
  `isNarrativeForReport` (strict `narrative.report === selectedTab` identity).

Regression tests in `src/lib/ai/report-narrative.test.js`: validity gate,
identity guard (fleet narrative rejected for drivers/fuel/maintenance/financial
tabs), and per-report vocabulary isolation — while `selectedReport` is
"drivers", "Fleet utilization" / "busiest unit" / "idle assets" must not appear.

Verification: eslint clean on all touched files, vitest 548/548.

### Native Excel Export & OpenXML Chart Generation — 2026-08-31 (Commit `a527f3e`)

Upgraded all reporting export capabilities from simple CSV text dumps to multi-tab **native Microsoft Excel (`.xlsx`) workbooks** with embedded OpenXML charts (Bar, Line, Doughnut) powered by `exceljs` and `jszip`:

- **Chart Generation Engine (`src/lib/reports/native-charts.js`)**:
  - Injects native OpenXML DrawingML charts (`chart1.xml`, `drawing1.xml`, `[Content_Types].xml` relations) directly into the Excel workbook ZIP package without requiring headless browser rendering or Python/Java runtimes.
  - Implemented responsive series mapping, custom color palettes (matching app branding), and clean axis labels.
- **Multi-Tab Structured Workbooks**:
  - `src/lib/reports/fuel-workbook.js`: Generates Fuel Consumption workbooks with KPI Summary, Monthly Spend trends, Efficiency charts, and Raw Submissions.
  - `src/lib/reports/remaining-workbooks.js`: Generates specialized workbooks for Analytics, Driver Performance, Fleet Cost, Fleet Utilization, Incidents, Maintenance, and Trip Performance.
  - `src/lib/reports/operational-reports.js`: Canonical server-side data computation pipeline for report aggregates.
- **9 Dedicated Excel API Endpoints**:
  - `GET /api/reports/analytics/excel`
  - `GET /api/reports/driver-performance/excel`
  - `GET /api/reports/financial/excel`
  - `GET /api/reports/fleet-cost/excel`
  - `GET /api/reports/fleet-utilization/excel`
  - `GET /api/reports/fuel-consumption/excel`
  - `GET /api/reports/incidents/excel`
  - `GET /api/reports/maintenance/excel`
  - `GET /api/reports/trip-performance/excel`
- **UI Integration & Direct Action**:
  - Added direct "Export Excel" action buttons on `/reports`, `/reports/cost`, `/analytics`, `/trips`, `/incidents`, and `/drivers/performance`.
  - Downloads receive timestamped filenames (`FleetOps_<Report>_YYYY-MM-DD.xlsx`) with instant toast feedback.
- **Automated Verification**:
  - Verified via `scripts/verify-reports.mjs` and Vitest test suites (`native-charts.test.js`, `fuel-consumption.test.js`).

Incident note: mid-batch, `analytics/page.js` was found partially reverted to an intermediate state (P2 chart/KPI edits lost, P1 `-700` edits intact) — consistent with OneDrive sync/checkpoint interference on this OneDrive-resident repo. All edits were re-applied and marker-audited via Node (`Get-Content` misdecodes UTF-8 as cp1252 here — don't trust its display of non-ASCII). eslint clean across all touched files, vitest 443/443.

Remaining known debt: hover-lift false affordance on non-clickable cards, duplicated per-page role lists vs `NAV_ROLES`, driver-dial rank badge clipping risk, heatmap cells not individually keyboard-reachable (summary label is the mitigation), Badge solid-variant contrast (app-wide blast radius).

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
