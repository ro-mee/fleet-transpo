---
type: plan
status: implemented
date: 2026-10-01
tags: [qa, reservations, dispatch, reports, analytics, exports, trips, vehicles]
related: ["[[Reservations]]", "[[Dispatch]]", "[[Trips]]", "[[Reports]]", "[[Fleet And Vehicles]]"]
---

# Manual Functional Testing Remediation Plan

> **For implementation:** Work through the checked steps in order. Investigate each reported mismatch before changing its code path, then verify the original UI symptom.

**Goal:** Resolve the reported UI and workflow inconsistencies, with the displayed figures and messages matching the underlying records.

**Architecture:** Keep the existing request, dispatch, trip, and report services as the owners of their data. Correct response handling and presentation in the current pages, and use the existing lifecycle writer for request status. Make a schema change only if a confirmed state or data contract requires it.

**Tech stack:** Next.js 16, React 19, TanStack Query, PostgreSQL through `pg`, Vitest, ExcelJS.

## Global constraints

- Read `.agents/AGENTS.md` and the relevant `Capstone/` notes before implementation.
- Check the installed Next.js guides before writing page or route code.
- Keep production diagnosis read-only; use supported workflows for disposable QA data.
- Preserve the single writer for request status and the Asia/Manila operational date rule.
- Use the current export, report, and form tools; no new dependency is planned.

---

**Scope:** Web Request Queue, Driver Performance, Reports, Analytics, exports, dispatch cancellation, trip detail, reservation creation, and vehicle edit. This is an implementation plan, not a record of completed fixes. No production data should be changed during diagnosis. Use existing helpers and endpoints; add no dependency unless a verified gap requires one.

**Business-rule assumption:** Cancelling a dispatch releases that assignment and its open trip, while the guest request remains available for reassignment. Only an explicit request cancellation cancels the guest request. This matches the current confirmation dialog but requires lifecycle work before it can be implemented safely.

## Evidence already found

| Observation | Current path and finding | Confidence |
|---|---|---|
| Initial queue counts are zero until a view change | `reservations/queue/page.js` renders `counts[id] || 0` while the request is loading. It also fetches `today` before a smart-tab choice and temporarily calculates the visible tab from counts, so tab and fetched rows can differ during steering. | Code-confirmed mechanism; reproduce the exact UI sequence. |
| “Today (6)” includes Sep 15–20 | The queue SQL defines Today as **today or overdue** in Asia/Manila. The vault says this is intentional dispatcher work grouping. The label hides that meaning. | Confirmed. |
| All Time shows 0 completed trips while shorter periods show 4 | The page sends `1970-01-01` to `2100-01-01`; the report SQL filters completed trips by `end_time`. All Time should contain either shorter period. | Mismatch reported; cause unconfirmed. |
| AI and report figures disagree | `/reports/page.js` still creates an `ABC-1234` / one-trip fallback when `byVehicle` is empty. `/analytics/page.js` can request AI narration before all metric feeds settle and its query key omits the metric snapshot. Its request-volume charts use request creation date, while other reports use trip/fuel event dates. | Confirmed paths; compare each displayed metric with source before changing formulas. |
| Trend/Calendar toggle looks reversed | The toggle values and conditional branches in `analytics/page.js` currently map `chart` to Trend and `calendar` to Calendar. | No static reversal found; needs browser reproduction. |
| Fuel export count disagrees with a list of 45 permits | `fuel/page.js` exports **fuel receipt records** via `getFuelRecords`, regardless of which list is visible. The paginated API returns `{ rows, total, counts }`, while export treats the result as an array. | Confirmed contract mismatch; determine whether 45 is permits or receipt claims. |
| Reservation `RS-VGFK` shows `#undefined` | The ingest POST returns a request with `request_id`, `reservation_number`, and optional `idempotent`; the new-reservation page reads `res.id` and `res.created`, which the route does not supply. | Confirmed. |
| Dispatch cancel also cancels the request | `setDispatchStatus()` explicitly cancels open trips and calls `advanceReservation(...Cancelled)` after changing the dispatch. The dialog promises the request remains available. The work is best-effort, so partial results are also possible. | Confirmed. |
| Cancelled trip shows Jan 1, 1970 | Trip detail passes nullable `start_time` and `end_time` into `formatDateTime`, which calls `new Date(value)`; `new Date(null)` is the epoch. | Confirmed display cause; stored values still need read-only check. |
| Vehicle edit category and license class are blank | The form resets from `GET /api/vehicles/[id]`; the GET selects both columns, and the controls have matching names. Stored null values, stale query state, or control timing remain possible. | Cause unconfirmed. |

## Implementation order

### 1. Capture one reproducible baseline for each mismatch

**Read paths:** the pages above; `src/app/api/integration/transport-requests/route.js`; `src/app/api/reports/*/route.js`; `src/lib/reports/operational-reports.js`; `src/app/api/fuel/route.js`; `src/app/api/vehicles/[id]/route.js`. Follow the repository's Next 16 guides in `node_modules/next/dist/docs/` before editing route or page code.

- [ ] In an authenticated browser session, record selected tab/range, visible list and count, request URL, response status/body, and loading state. Repeat after reload and view changes. Use Asia/Manila dates for queue and report comparisons.
- [ ] Read the records for `RS-VGFK`, its QA dispatch/trip, and the affected vehicle **without writing to the database**. Confirm `request_id`, the three statuses, `start_time`, `end_time`, `category_id`, and `required_license_class`. Avoid logging guest or driver personal data in tests.
- [ ] Compare All Time and Last 30 Days responses and a direct read-only count of non-deleted Completed trips by `end_time` under identical boundaries. Compare each disputed KPI/chart and AI input with its source rows. Note when two widgets measure different entities or dates.
- [ ] Reproduce the Trend and Calendar clicks, including their `aria-pressed` state and rendered chart/heatmap. Record the browser and viewport if it only occurs at a particular size.

**Gate:** For each item, identify the first layer where values diverge (DB, API, client state, or presentation). Do not change a formula solely because the reported number looks wrong.

### 2. Make Request Queue labels, counts, and rows agree

**Files:** `src/app/(dashboard)/reservations/queue/page.js`; `src/lib/scheduling/smart-default-tab.js`; `src/app/api/integration/transport-requests/route.js`; focused queue tests; `Capstone/02 - Features/Reservations.md`.

- [ ] Add a focused failing UI test for first load: counts remain in loading state, then the selected tab, rows, and counts represent one query result after smart-tab steering. Preserve a manual tab selection during polling.
- [ ] Stop showing `0` for counts before the first successful response. Derive the displayed active tab from the same tab used in the current query, or wait until the steered query completes before changing the highlighted tab; choose the smallest change that passes the test.
- [ ] Keep the documented SQL rule that overdue requests are actionable. Rename the tab and its accessible description to say **Today & overdue** (or equivalent plain wording), and show pickup dates on overdue rows. Keep the count and row filter on the same existing predicate.
- [ ] Verify cold load, reload, manual tab switch, 30-second refresh, and a dated overdue request. Confirm no earlier request disappears into Upcoming.

### 3. Reconcile reporting windows, source data, AI narrative, and toggle behavior

**Files:** `src/app/(dashboard)/drivers/performance/page.js`; `src/lib/reports/operational-reports.js`; `src/app/(dashboard)/reports/page.js`; `src/app/(dashboard)/analytics/page.js`; `src/lib/ai/report-narrative.js`; existing page/report tests; `Capstone/02 - Features/Reports.md` and `Capstone/02 - Features/Driver Management.md`.

- [ ] Add one regression using four Completed trips in a shorter window: All Time must include at least those four. Use the baseline to fix the failing boundary (API query, cached response, or page state), then verify the API and page report the same total. Do not fabricate completed timestamps for cancelled trips.
- [ ] Delete the `ABC-1234` / one-trip fallback from the Fleet report. Empty activity should show an honest empty state, and a roster row should show zero trips if the design needs roster context.
- [ ] For each disputed KPI and chart, write down its unit, source table, status filter, event date, and selected period. Align only metrics meant to be the same; label genuine differences such as “requests created” versus “trips completed.” Add a small seeded regression covering empty data, nonzero data, and the date boundary.
- [ ] Trigger Analytics AI only after the required report feeds have succeeded; key/refetch it on the actual numbers and date window it narrates. Keep the existing per-report identity guard on Reports. Add a test where the period changes while an old AI response is in flight, and verify no stale or invented claim appears.
- [ ] If the browser reproduction confirms the toggle mismatch, fix the control/view mapping at its actual failing layer. If clicks already map correctly, leave that logic alone and clarify the chart and calendar titles/date scopes. Verify with an interaction test, including `aria-pressed`.

### 4. Make every export use the visible dataset and prove a download starts

**Files:** `src/app/(dashboard)/fuel/page.js`; `src/services/fuel.service.js`; `src/app/(dashboard)/reports/page.js`; `src/app/(dashboard)/analytics/page.js`; `src/lib/export.js`; workbook route/tests under `src/app/api/reports/` and `src/lib/reports/`; `Capstone/02 - Features/Fuel.md` and `Capstone/02 - Features/Reports.md`.

- [ ] Pin the intended Fuel export entity from the reproduction: permit requests or receipt claims. Make the button label name the entity and export the full visible, filtered dataset using the corresponding existing endpoint. In paginated mode read `response.rows` and `response.total`; never infer a successful export from the length of an envelope object. Check 45 visible permits versus one receipt claim separately.
- [ ] In Reports and Analytics, check active range, response status, nonempty blob, file name, and workbook/CSV content before success feedback. Use the existing download helper; toast wording should say the download **started**, because the browser cannot confirm a saved file.
- [ ] Add one focused check per affected export path for correct row count and file shape (`.csv` text or `.xlsx` ZIP/workbook), plus empty and server-error outcomes. Manually use a browser to confirm a file appears in Downloads and opens; record the actual sheet/row counts.

### 5. Correct lifecycle side effects, messages, and nullable trip times

**Files:** `src/services/transition.service.js`; `src/services/reservation-lifecycle.service.js`; `src/lib/scheduling/reservation-state.js`; `src/app/api/dispatch/[id]/cancel/route.js`; `src/app/(dashboard)/dispatch/[id]/page.js`; `src/app/(dashboard)/trips/[id]/page.js`; `src/lib/utils.js`; `src/app/(dashboard)/reservations/new/page.js`; existing lifecycle/API/UI tests; `Capstone/02 - Features/Dispatch.md`, `Reservations.md`, and `Trips.md`.

- [ ] First map every caller of `setDispatchStatus`, the request-cancel route, and trip cancellation. Write a status matrix for Scheduled/Assigned/In Progress/Completed dispatches, open/completed trips, and explicit request cancellation. Preserve the single writer and reservation event trail.
- [ ] Add a failing test for **cancel dispatch only**: dispatch and open trip are cancelled, resources released, request remains actionable with a legal state/event, and a second assignment can use it. Existing reservation adjacency permits `In Progress → Scheduled` but not `Assigned → Scheduled`; add only the transition needed for the pre-start case after checking its other callers. An explicit request-cancel action must still cancel the request. A completed trip must stay Completed.
- [ ] Replace the current best-effort dispatch/trip/request DB sequence with the existing transaction pattern so a failed request transition cannot leave a half-cancelled chain; keep outbound integration effects after a successful DB transition. Make the dialog describe the actual outcome, including any case where cancellation is forbidden.
- [ ] Use the POST response contract on the new-reservation page: distinguish `idempotent`, display `reservation_number` or `request_id`, and invalidate the queue/register query keys actually used. Test created and duplicate submissions without `undefined` in the toast.
- [ ] Audit callers of `formatDateTime`; make nullable/invalid values render as unavailable at the shared helper boundary, with trip detail copy such as **Not started** and **Not ended** where clearer. A cancelled unstarted trip must keep null timestamps in storage; do not backfill 1970 or invent start/end times. Test null, valid timestamp, and cancelled trip detail.

### 6. Restore vehicle edit prefill from the persisted row

**Files:** `src/app/(dashboard)/fleet/vehicles/new/page.js` (shared new/edit form); `src/app/(dashboard)/fleet/vehicles/[id]/edit/page.js`; `src/app/api/vehicles/[id]/route.js` only if the response is wrong; focused form test; `Capstone/02 - Features/Fleet And Vehicles.md`.

- [ ] Compare a vehicle's stored `category_id` and `required_license_class` with the GET response and the form's values after both the vehicle and category options load. Include an edit page opened directly, navigated to from detail, and reopened after save.
- [ ] If values are present in the response, fix only the form reset/control timing or normalization that drops them. If they are null in storage, show an explicit missing value and require deliberate selection on save; do not claim to prefill a value the system never stored.
- [ ] Verify both controls show persisted non-null values and save/reopen without changing them. Keep the supported license class validation and category ID type intact.

## Release checks

- [ ] Run focused Vitest checks for each changed path, then the repository test suite and touched-file lint. Record pre-existing failures separately; the 2026-10-01 journal records six existing full-suite failures after the merge.
- [ ] Run a production build. If a database migration becomes necessary, follow `.agents/AGENTS.md`: `db:status` before numbering, direct `db:up`, generated `db:dump`, and `db:contract`/`verify:anon` for new relations. No migration is assumed by this plan.
- [ ] Repeat the original manual workflow with a new disposable QA request and clean it up through the supported UI. Record before/after screenshots or response snapshots for every reported symptom, downloaded file names, and any remaining data-quality limitation.
- [ ] Update the relevant `Capstone/` feature notes and `SYSTEM.md` with the behavior actually implemented and fresh verification results. Do not mark a plan item fixed until its original symptom has been reproduced and retested.

---

## Implementation record — 2026-10-01

**Verdict on the plan itself:** sound and implementable as written. Every claim it marked *confirmed* reproduced in code, and its two "cause unconfirmed" items resolved as follows:

| Plan item | Plan's confidence | What the read-only probe / code showed |
|---|---|---|
| Queue counts zero until a view change | code-confirmed mechanism | **Confirmed.** `counts[id] \|\| 0` while `isLoading`; the highlight came from `counts` while the query fetched the fallback tab |
| "Today (6)" includes Sep 15–20 | confirmed intentional | **Confirmed.** Live: `today = 6`, five of them Sep 14–19 overdue. Label fixed, predicate kept |
| All Time 0 vs shorter 4 | mismatch reported; cause unconfirmed | **Not reproducible.** Live API: driver performance All Time = 30d = 4; fleet utilisation All Time 6 ⊇ 30d 4. Invariant pinned by tests; the real adjacent defect (different reports window on different date columns) named in [[Reports]] |
| AI and report figures disagree | confirmed paths | **Confirmed.** The Fleet report fabricated `ABC-1234`/1 trip/`4%` — including during loading — while the AI narrated the real payload |
| Trend/Calendar toggle looks reversed | no static reversal; needs browser repro | **Mapping was correct** (verified in code). The *scopes* were wrong: trend hard-coded to 7/14 days under a "selected period" subtitle, calendar necessarily the current month. Clarified, mapping untouched |
| Fuel export count disagrees with 45 permits | confirmed contract mismatch | **Confirmed, and worse.** Live: 45 `fuelrequests` vs 1 `fuelrecords`; the envelope was passed to `exportToCSV`, so nothing downloaded at all |
| `RS-VGFK` shows `#undefined` | confirmed | **Confirmed.** Live row: `request_id` 510, `reservation_number` RS-VGFK, `fleet_status` Cancelled |
| Dispatch cancel also cancels the request | confirmed | **Confirmed, with live impact.** 4 requests Cancelled solely by a dispatch stand-down |
| Cancelled trip shows Jan 1, 1970 | confirmed display cause | **Confirmed.** All 3 live `Cancelled` trips store NULL `start_time` and `end_time` |
| Vehicle edit category/licence blank | cause unconfirmed | **Data, not a bug.** 16/21 vehicles NULL `category_id`, 20/21 NULL `required_license_class`. The form's reset was correct; the *blank* was unnamed |

**No migration was required** — confirmed against the live catalog (column presence and CHECK constraints), not the migration files.

### Work done, by plan section

- **§1 Baseline.** Captured read-only, reproducibly: `scratch/qa-remediation-baseline.mjs` (queue tab counts, overdue rows, `RS-VGFK`, fleet NULL counts, cancelled-trip NULLs, permits-vs-claims, cancelled-dispatch requests) and `scratch/qa-remediation-reports.mjs` (the real report services with the exact windows the pages send). Live diagnosis only; **no production row was written.**
- **§2 Queue.** `resolveQueueTabView()` + `queueTabBadges()` own the tab/query/highlight agreement and the "not loaded ≠ 0" rule; the tab is **Today & overdue**; an accessible name carries the real count state; the queue no longer prints a hard-coded `10:30 AM` or a `request_id`-seeded fake travel estimate.
- **§3 Reporting.** Fabricated Fleet fallbacks deleted (KPI zeros, roster-as-activity, `ABC-1234`); an honest `NoData` for an empty window; `All Time ⊇ shorter window` pinned at both the range and the SQL boundary; the Analytics narrative gated on all five feeds succeeding, keyed on the snapshot fingerprint **and** window, and identity-guarded by report **and** range; Trend/Calendar scopes stated instead of implied.
- **§4 Exports.** `fuelExportTarget()` exports the visible view (receipt claims / budget / permits) and names it on the button; `collectPagedRows()` unwraps the paginated envelope and walks every page; `getWorkbook()` refuses a non-OK, empty or non-workbook body before any success feedback; every export toast says the download *started*.
- **§5 Lifecycle.** Dispatch stand-down now releases the request to `Scheduled` instead of cancelling it, in one transaction (dispatch flip re-validated `FOR UPDATE`, open trips cancelled, `Completed` trip preserved, terminal request left alone), through the single writer with `db: tx`, outbound after commit, and a refused release rolling the chain back. The reservation adjacency gained the `Assigned → Scheduled` release edge, direct-only. The request-cancel route sweeps `Pending Reassignment` too. The injector page reads the real POST contract. `formatDateTime`/`formatDate`/`formatTime` are null-safe at the shared boundary and trip detail reads *Not started* / *Not ended* with NULL kept in storage.
- **§6 Vehicles.** The two controls now name the state they are in ("Not recorded — …" plus an explanatory hint) instead of showing an unexplained empty field; the LTO code stays required on save.

### Release checks

| Check | Result |
|---|---|
| Focused Vitest per changed path | green |
| Repository suite | **3489 passed / 6 failed** — the six are exactly the pre-existing failures recorded on 2026-10-01 (`auth-session` counter cap, `no-legacy-role` `system_admin` scan, `upload-storage` licence-signing scan, `standby` ×2, `driver-assignments` verified pairing). **Zero new failures.** |
| Touched-file lint | `eslint` exit 0 |
| Production build | `✓ Compiled successfully` (217/217 static pages) |
| Migration needed? | **No.** Live catalog probe confirms every column and CHECK the new chain writes already exists |
| `scripts/verify-cancel-cascade.mjs` | Updated to the corrected two-direction rule. **Not executed** — needs a running dev server + auth |
| Authenticated browser retest of each original symptom | **Open.** This checkout has no browser session, so the manual/visual half of §1 and §4 ("confirm a file appears in Downloads and opens") was **not** performed |

### Deviations from the plan, and why

- **§3 first bullet** asked to fix a failing All Time boundary. There was nothing failing at the API layer, so instead of changing a formula that the numbers did not justify, the invariant is pinned by tests and the genuine cross-report date-column inconsistency is documented.
- **§3 toggle bullet** anticipated either a mapping fix or clarified titles. Code inspection showed the mapping was already correct, so only the scopes were clarified — the plan's own fallback.
- **§4 fuel entity** was pinned to **both** entities rather than one: the Permits view exports permits, the Registry exports receipt claims, and the button names which.
- **§6** stops short of making `category_id` mandatory. The plan said "require deliberate selection on save"; the LTO code already is required, and making the category mandatory would block unrelated edits on 16 of 21 vehicles. That is a product decision, flagged rather than taken.

## Manual completion follow-up — 2026-10-01

The tester completed the remaining browser workflows. The Assigned → Scheduled release passed after reload; the disposable request was explicitly cancelled for cleanup; its request/dispatch/trip remain as Cancelled history; and the active Today & overdue count returned to 6. Live event history independently confirms `dispatch_released` (`Assigned → Scheduled`) followed by cleanup (`Scheduled → Cancelled`).

Downloaded files were also located and checked: both latest XLSX packages pass the Office integrity checker, and the CSV/XLSX structures and aggregate contents match the displayed row/KPI counts. The release check table above is therefore superseded as follows:

- synthetic dispatch-release acceptance: **passed**;
- export file presence/integrity/content: **passed structurally and by aggregate data** (visual workbook rendering not re-reviewed);
- scope/copy findings: **remediated the same day** (below), so the audit no longer blocks on wording.

The four issues found were: AI Insights called a status-only 20/21 count “ready for guest dispatch” although the real Today pair endpoint returns 1/20; AI Insights excluded incidents while promising all core alerts; Predictive Maintenance called computed predictions “Health Records” (its reported default-view zero was not reproduced — the endpoint returns 21); and Booking notification copy promised an external outcome while the configured gateway is mock-only and `booking_status` remains an inbound mirror.

**Remediation.** `generateFleetInsights()` now names the status question and points at Resource Availability; the AI Insights page names its real coverage and count vocabulary and links to the Incidents registry; the Predictive Maintenance heading reads “Vehicle Health Predictions (N of total)”; and the Booking hand-off is reported rather than promised — `emitTransportStatus()` returns `{ delivered, gateway, reason? }`, `advanceReservation()` returns `bookingNotify`, the cancel route returns `booking_notify`, and `describeBookingNotify()` checks mock before delivered. Two product decisions were deliberately **not** taken and stay open: teaching AI Insights to read incidents, and widening the SLA escalator beyond Critical/Major. A real HTTP Booking gateway still does not exist. Evidence and tests: [[Manual Functional Testing Follow-up Audit]].

