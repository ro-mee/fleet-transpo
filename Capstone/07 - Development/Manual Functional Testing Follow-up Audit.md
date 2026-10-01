---
type: audit
status: remediation-complete
date: 2026-10-01
tags: [qa, ai, dispatch, maintenance, incidents, booking, exports]
related: ["[[Manual Functional Testing Remediation Plan]]", "[[AI Advisory]]", "[[Dispatch]]", "[[Maintenance]]", "[[Incidents]]", "[[Request Lifecycle]]", "[[Reports]]"]
---

# Manual Functional Testing Follow-up Audit

Follow-up to [[Manual Functional Testing Remediation Plan]]. The tester completed the remaining manual checks, including a disposable Assigned → Scheduled dispatch-release chain and cleanup. This note verifies the residual findings against current source, the live database and the actual downloaded files. All database work below was read-only.

## Executive verdict

The **dispatch release remediation passed**. The full audit is **not clean**, but the remaining findings are not one failure class:

| Finding | Classification | Verdict |
|---|---|---|
| AI Insights 20/21 “ready for guest dispatch” vs Resource Availability 1 ready / 20 blocked | **Confirmed misleading metric label** | The two numbers intentionally use different scopes, but AI Insights overstates its status-only count as dispatch readiness. |
| Predictive Maintenance shows 0 health records | **Not reproduced; wording/filter ambiguity** | The actual endpoint returns 21 predictions. Default/all should show 21; a selected empty risk filter can show 0. “Health Records” is not an accurate name for computed predictions. |
| AI Insights reports a maintenance-grounded vehicle while Predictive Maintenance appears empty | **Expected scope difference, but confusing copy** | AI Insights reads current `vehicle_status`; Predictive Maintenance reads service schedules and usage. The grounded vehicle has no predictive schedule and appears as low/unscheduled, not as an urgent prediction. |
| Incident #110 is open, unacknowledged and overdue, but no AI Insights incident alert | **Confirmed scope omission / copy gap** | AI Insights does not query incidents. Incident #110 is Moderate, so it is overdue in the registry but intentionally excluded from the Critical/Major SLA escalation notifier. |
| Local request Cancelled; Booking Status still Pending | **Expected field semantics + confirmed integration/copy gap** | `booking_status` is the last inbound Booking value and has no local writer. Cancellation emitted external `CANCELLED`, but the local runtime uses the mock gateway; no real Booking system was notified. |
| Export buttons said download started, contents not checked | **Now verified structurally and by aggregate content** | Recent CSV/XLSX files exist, open as valid packages, have the expected sheets/headers and contain the expected row/KPI counts. Visual rendering was not re-reviewed. |

## 1. Synthetic dispatch release and cleanup — PASS

The live history matching the tester's described disposable chain is request **512 / RS-2C5R**:

1. `Assigned → Scheduled`, event `dispatch_released`;
2. outbound integration event `status_scheduled` with external status `SCHEDULED`;
3. explicit cleanup `Scheduled → Cancelled`, event `cancelled`;
4. dispatch 624 and trip 490 remain `Cancelled` as history;
5. request remains `Cancelled` as history;
6. the active queue returned to **6 Today & overdue**, 0 Upcoming, 1 Assigned and 0 In Progress.

This is direct live proof that the release edge, pair clearing, reload persistence and cleanup all behaved as designed. The retained cancelled rows are audit/history, not active work.

## 2. AI Insights “20 of 21 ready” vs Resource Availability “1 / 20”

### What AI Insights actually measures

`GET /api/ai/insights` selects all non-deleted vehicles and passes them to `generateFleetInsights()`. That function counts only:

```text
vehicle_status = Available / all non-deleted vehicles
```

Live snapshot: **21 vehicles = 20 Available + 1 Under Maintenance**, so its deterministic card says:

> Fleet operates at 95% active availability (20 of 21 vehicles ready for guest dispatch).

The number is arithmetically correct for the stored status label. The phrase **“ready for guest dispatch” is not**: this calculation does not check a driver, pairing, duty schedule, time window, overlap, insurance/registration, number coding or licence evidence.

### What Resource Availability measures

The real `GET /api/dispatch/availability-pairs` route was replayed read-only for the same full Manila day and returned exactly the tester's result in `mode=today`:

- **1 ready**;
- **20 blocked**;
- reasons: 15 number-coding restrictions, 3 no usable designated/substitute driver, 1 expired insurance, 1 Under Maintenance.

In strict `mode=exact` over the full day it returned 0 ready / 21 blocked because one more pair could not fit the whole-day window inside its shift.

**Conclusion:** the numerical difference is legitimate because the scopes differ. The AI card's label is the defect. It should say **“20 of 21 vehicles marked Available”** or use the real pair-availability service before claiming dispatch readiness.

## 3. Predictive Maintenance “0 health records”

The current route and live data do not reproduce a zero in the default/all view:

- `GET /api/ai/predictive-maintenance` returned **21 predictions**;
- summary: 21 low, 19 unscheduled, 2 genuinely scheduled/healthy;
- the page computes Healthy as `low - unscheduled`, therefore **2**;
- the list heading uses `filteredPredictions.length`, so selecting a filter with no matches legitimately changes “Vehicle Telemetry Health Records” to 0.

These are not stored health records. They are one computed prediction per non-deleted, non-decommissioned vehicle. The heading **“Vehicle Telemetry Health Records”** is therefore imprecise.

The vehicle grounded by incident #110 is included, but its prediction is:

- risk `low`;
- score 50;
- basis `null`;
- confidence `low`;
- recommendation: add a service date or mileage.

That is not contradictory to the maintenance grounding. Operational grounding comes from `vehicle_status` and an active Emergency Repair; predictive risk comes from `next_service_date` / `next_service_mileage` plus usage/history. The two screens describe different facts, but their labels do not make the distinction clear.

If the tester saw 0 with **All/default** selected, that remains a browser/runtime-state issue to reproduce. Current source and live endpoint data say 21. If a risk filter was selected, 0 is expected.

## 4. Incident #110 and AI Insights

Live state:

- incident 110: `Open`, `Moderate`, unacknowledged, past `due_at`;
- grounding: `Complete`;
- vehicle: `Under Maintenance`;
- linked work order 55: `Emergency Repair`, `In Progress`;
- no maintenance automation error.

The incident registry correctly treats any open row past `due_at` as overdue, so #110 belongs in its SLA Overdue count/badge.

The escalation notifier is narrower: `escalateOverdueIncidents()` selects only **Critical or Major** incidents. Because #110 is Moderate, no `Incident SLA Breached — Unacknowledged` notification is expected. It already has nine linked notifications: eight `Vehicle Taken Out of Service` Alerts and one `Incident Report Under Review` Info.

AI Insights cannot surface #110 specifically because its endpoint never queries `driverincidents`; its deterministic feed covers fleet status, maintenance grounding, driver licences and LTO renewal. The page copy saying **“all core rule-based safety, compliance, and maintenance alerts remain fully active below”** and calling the cards **“Active Alerts”** therefore overstates that feed's coverage.

Separate documentation drift found: [[Incidents]] said the SLA notifier targets system_admin/fleet_manager/admin, while the current recipient query selects only fleet_manager/admin. This does not explain #110 (severity excludes it first), but the note is corrected to match the implementation.

## 5. Booking Status remains Pending after local cancellation

This is expected for the current data model:

- `fleet_status` is Fleet's lifecycle state and becomes `Cancelled`;
- `booking_status` is the value originally reported by Booking at ingest (“what Booking believes”);
- there is no later writer that mirrors Fleet transitions into `booking_status`.

The local cancellation did emit an outbound integration event. For the recent cancelled requests, including request 512, the latest log is `status_cancelled`, payload status `CANCELLED`, marked `processed` with no stored error.

That still is **not proof of external delivery**. The runtime reports:

```text
BOOKING_GATEWAY = mock
BOOKING_API_URL configured = false
```

The mock validates the event locally and returns `delivered: true`; it makes no external call. `HttpBookingGateway` is still an explicit “not connected yet” stub. Therefore:

- Pending Booking Status does not mean Fleet cancellation failed;
- `integration_log.status = processed` means the selected gateway accepted the call;
- under mock mode, no real Booking system was notified;
- the cancellation dialog and toast promising that Booking **will** be notified are misleading in this environment, especially because `advanceReservation()` ignores the `{ delivered }` result for user feedback.

Real delivery requires a working HTTP gateway plus Booking-side evidence/correlation for the same external booking ID. The current system cannot provide that.

## 6. Downloaded export contents — verified

Recent files in Downloads were inspected with bundled `openpyxl`, Python's CSV reader, and the shared Office package checker.

### CSV

- `fuel-permits-2026-10-01.csv`: **45 data rows**, 11 expected columns, no row-width mismatch; 21 Approved, 22 Fulfilled, 2 Rejected.
- `fuel-receipt-claims-2026-10-01.csv`: **1 data row**, 8 expected columns, no row-width mismatch; Pending.
- `fleet-analytics-summary-2026-10-01.csv`: 1 aggregate row; 4 trips, 13.31 km, 0 recorded fuel/maintenance cost in that selected period.

### XLSX

- latest fleet activity workbook: valid XLSX package; sheets Summary, Analysis, Trends, Trip Details, Vehicle Roster; selected period carries 6 trip records, 39.85 km and a 21-row vehicle roster.
- same-day fleet activity exports: valid packages and correctly show 0 trip records / 0 distance for the empty day.
- latest analytics workbook: valid package; sheets Summary, Analysis, Trends, Vehicle Activity, Driver Leaderboard; selected period carries 4 trips and 13.31 km; fuel efficiency and punctuality are explicitly Insufficient data.

The package checker passed the latest fleet activity and analytics workbooks. Formulas and cached results are present. This verifies file integrity, sheet/header structure and aggregate contents; it is not a pixel-level Excel/LibreOffice visual review.

## Audit disposition

The release fix is accepted, and all four scope/copy items found here were then **remediated** (recorded below). The audit is now clean at the level this note can verify: source, live data, and downloaded files. Visual spreadsheet rendering and a real HTTP Booking exchange remain outside what was exercised.

## Remediation of the four findings — 2026-10-01

### 1. AI Insights no longer claims dispatch readiness

`generateFleetInsights()` (`src/lib/ai/rule-engine.js`) now emits:

> Fleet status is Available on 20 of 21 vehicles (95%). Dispatch readiness is a different question — it also needs a cleared driver, the requested window, compliance and number coding, so check Resource Availability.

Verified against live data: the corrected sentence is what the engine produces, and the real Today pair endpoint still answers 1 ready / 20 blocked — the two now read as answers to two different questions instead of a contradiction. `rule-engine.test.js` gained four tests pinning "counts vehicle_status only, and says so", "never claims dispatch readiness from a status count" and the empty-fleet case.

### 2. AI Insights no longer over-promises incident coverage

`ai/insights/page.js`: the deterministic-mode paragraph now names the coverage it has (fleet status, compliance, maintenance) and links to the **Incidents registry** for incident SLA/response state, stating plainly that this feed does not read incidents. The severity-panel count reads **Active Insights** and the dismiss control says *insight*, so the card no longer presents itself as the incident/safety alert feed.

The underlying policy is unchanged and deliberate: incident #110 stays visible in the registry (Open, Moderate, unacknowledged, past `due_at` → SLA Overdue), while the escalation notifier continues to page only on Critical/Major. Widening that severity set or teaching AI Insights to read incidents is a product decision that was **not** taken.

### 3. Predictive Maintenance is labelled as predictions

`maintenance/predictive/page.js` heading changed from *“Vehicle Telemetry Health Records”* to **“Vehicle Health Predictions”**, and a filtered view now reads `(0 of 21)` so an empty filter cannot be mistaken for an empty fleet. The reported default-view zero was not reproduced before or after this change: the endpoint returns 21 predictions (19 unscheduled, 2 healthy). The KPI band, engine and scoring are untouched.

### 4. The Booking hand-off now reports what actually happened

Previously the toast always said *“Booking will be notified”*, while `emitTransportStatus()` already knew whether anything was delivered and which gateway answered — the caller simply discarded it.

- `emitTransportStatus()` returns `{ delivered, gateway, reason? }`; the gateway name is resolved before the early return so an un-booked request reports `no-external-booking-id` instead of a bare false.
- `advanceReservation()` returns `bookingNotify` alongside `request`/`hops` instead of dropping the result.
- The cancel route returns `{ ...request, booking_notify }`.
- New client-safe `describeBookingNotify()` (`src/lib/integration/booking-notify.js`, no imports because the pages are client components) turns that into one honest sentence, checking **mock before delivered** so the local stub can never read as a notification.
- Both cancel dialogs now say the notice is *queued* and that leaving Fleet depends on the gateway being connected; both toasts report the real result.

Live behaviour unchanged and now legible: Fleet's cancellation and `integration_log` writes work; under `BOOKING_GATEWAY=mock` the message tells the operator nothing left the process. `booking-notify.test.js` (6 tests) and a new `cancel/route.test.js` (5 tests) pin the contract, including that the route still sweeps a `Pending Reassignment` dispatch and still refuses a terminal request.

### Verification for the remediation

Focused tests green; repository suite **3517 passed / 6 failed**, the six being the same pre-existing failures already recorded for 2026-10-01 (`auth-session` counter cap, `no-legacy-role` `system_admin` scan, `upload-storage` licence-signing scan, `standby` ×2, `driver-assignments` verified pairing) — **zero new failures**. Touched-file ESLint clean; production build `✓ Compiled successfully`.

The original read-only audit that produced these findings changed no application behaviour and no production data.
