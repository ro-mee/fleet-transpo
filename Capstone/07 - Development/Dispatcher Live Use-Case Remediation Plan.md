---
type: implementation-plan
status: in_progress
date: 2026-10-03
tags: [dispatcher, live-use-case, dispatch, availability, rbac]
related:
  - ../02 - Features/Dispatch.md
  - ../02 - Features/Reservations.md
  - ../02 - Features/Trips.md
  - ../02 - Features/Trip State Machine.md
  - ../06 - Decisions/ADR/ADR-013 Calendar Is The Dispatch Surface.md
---

# Dispatcher Live Use-Case Remediation Plan

## Goal

Resolve the confirmed urgency and availability explanations, then verify the remaining reported cross-module and endpoint issues without changing valid trip or reservation lifecycle rules.

## Evidence boundary

The October 2 report records a local Dispatcher walkthrough at commit `5fe4e10`, not production behavior. It submitted no consequential changes and did not exercise APIs, write authorization, a second Dispatcher, or an active trip. This checkout is now at `26ac198` after 12 commits, including a merge from `origin/main`. At plan start, the local UI observations had not been replayed against this newer checkout. The current authenticated local follow-up is recorded below; it does not establish deployed behavior.

The findings below separate confirmed source behavior from conclusions that still require a safe reproduction. Do not change sample records or use a live operational record to prove an assignment, trip, or responder mutation.

## Finding assessment

| Finding | Current assessment | Planned direction |
| --- | --- | --- |
| DP-001 — overdue work counted as departing within 30 minutes | Confirmed in `src/components/dashboard/role-dashboard.jsx`: `minsUntil <= 30` accepts negative values. The dashboard also links the combined departure total to an unfiltered calendar. The queue’s today-or-overdue grouping is a separate, intentional work bucket. | Count only timestamps from now through the next 30 minutes; report overdue items separately. Make each card open the matching filtered queue or calendar set. |
| DP-002 — assigned, unstarted dispatch not surfaced as delayed | Confirmed. The dashboard’s delayed metric examines only `dispatches.inProgress`, and `tripProgress()` measures an over-plan trip only after it has started. The existing start-window notification scan is limited to Driver Accepted trips, while the reported trip remained Assigned. | Add a distinct derived “past pickup, no start recorded” signal for active pre-start assignments. Reuse the start-window rules and notification dedupe where appropriate. Keep delayed-in-progress separate and never change stored status based only on elapsed time. |
| DP-003 — Hiace/SUV mismatch | Live record 508 → dispatch 622 → trip 488 resolves to vehicle 37. The reservation labels requested category as Guest Transportation and assigned model as Hiace. Trip detail labels Model Hiace and Vehicle type/name SUV; the vehicle row has `model=Hiace`, `vehicle_name=SUV`, `manufacturer=Toyota`, category Guest Transportation. The displayed terms come from different columns, but the master row is ambiguous. | Keep the field-specific labels. Do not rewrite the live vehicle row until its owner confirms whether “SUV” is the intended vehicle type/name. |
| DP-004 — availability empty-state contradiction | The report establishes contradictory copy, but the exact zero-count predicate should be checked before renaming it. | Make the heading, count, and helper text describe the same set of pairs and the selected date/window. |
| DP-005 — TEST-707 coding reason | A reason-generation defect is confirmed in `src/app/api/dispatch/availability-pairs/route.js`: it reports a coding restriction whenever policy is enabled and the plate is non-exempt, without checking the plate digit against that date’s restriction. The underlying eligibility verdict for TEST-707 is not established by the screenshot. The shared `isRestricted()` policy already exists. | Use the existing date-and-plate policy when selecting and explaining this reason; include the evaluated digit, restricted digits, and exemption state. Do not create a duplicate policy implementation. |
| DP-006 — timeline returns Not Found | Authenticated local GET of `/api/integration/transport-requests/508/timeline` rendered five events. The prior Not Found did not reproduce; no route fix is indicated. | Keep separate UI states for a real empty history, missing request, forbidden read, and transient failure. Reopen only if Not Found recurs. |
| DP-007 — Copilot evidence recheck returns Not Found | The approved authenticated GET for request 499 returned the recommendation JSON successfully (HTTP 200 by the route's default `Response.json` status), with `narration: null`; Not Found did not reproduce. The response evaluated zero candidates because this request is overdue and has no eligible pair for its service date. The UI button itself was not clicked. | No route patch is indicated. If the button still shows Not Found, capture that UI request and reconcile its URL/ID. Ensure the zero-candidate response is presented with its specific eligibility reasons and stale evidence remains fail-closed. |
| DP-008 — Dispatcher opens Driver Assignments | The role matrix grants Dispatcher read access only. An isolated route-level test now invokes all five pairing/substitute mutation handlers under a Dispatcher session and confirms 403 before DB or audit calls; Fleet Manager remains allowed by the actual permission guard. No live write was attempted. | Keep read-only access and permission-gated controls. Treat route-level fixture coverage as code verification, not a live cookie/session API acceptance run. |
| DP-009 — stale responder fix still has a numeric ETA | The report observed “Stale fix” with no age. `responder-tracking.js` already defines a five-minute freshness threshold, but the candidate selector/API presentation still needs to be traced. | Return and show the last-fix time/age. Suppress or clearly de-emphasize distance and ETA when the timestamp is missing or outside the agreed freshness window. |

| DP-010 — Dispatcher calendar returns 500 | Reproduced in the authenticated local calendar before the session expired. Live PostgreSQL exposes `vehicles.manufacturer`; the route selected nonexistent `vehicles.make` (error 42703). | Select `manufacturer AS make` to preserve the existing calendar API shape. No schema or vehicle data change is needed. |

## Implementation sequence

### 0. Pin and reproduce

1. Record the current commit and confirm the local app is running this checkout, not a stale Next.js dev-server manifest.
2. DP-006 now succeeds in the authenticated local session: the timeline GET for request 508 rendered five events, so no route patch is indicated. The single approved DP-007 GET for request 499 returned HTTP 200 and zero eligible candidates, so the reported Not Found did not reproduce. Verify the Recheck button's rendered state separately; any further live preview requires explicit approval because route feasibility may send pickup/drop-off coordinates to TomTom.
3. In an isolated test dataset, compare the request ID, dispatch ID, trip ID, vehicle ID, requested category, vehicle model/category, plate, policy date, and raw availability response for representative records.
4. Keep this baseline read-only. Assignment, trip progression, incident response, concurrency, and role-write checks belong in isolated fixtures.

### 1. Repair dispatch urgency

1. Extract or reuse a pure timestamp classifier with an injected `now`; use exact instants for decisions and Asia/Manila only for calendar-day grouping and display.
2. Bound “departing within 30 minutes” to `now <= departure <= now + 30 minutes`. Keep past departures in an explicit overdue bucket and leave the Reservation Queue’s today/overdue semantics intact.
3. Give assigned departures and unassigned pickups matching destinations: calendar filter for assigned runs, queue filter for unassigned requests. Avoid a combined count whose destination omits one of those sets.
4. Add a separate pre-start overdue indicator after the agreed grace rule. Reuse `crossedStartWindowThreshold`/`latest_start` and the existing `trip_start_overdue` notification path where it fits; extend its eligible statuses only after reconciling the supported mobile accept/start flow. Exclude cancelled/completed work and never infer that an unstarted trip was completed or that the passenger was served.
5. Show the same “no start recorded” signal on Dashboard, Calendar, and Trip detail. Keep it distinct from an in-progress trip exceeding its planned duration. Do not rewrite dispatch, trip, driver, or reservation status from a timer.

### 2. Make availability decisions explainable

1. In Availability, use the shared UVVRP policy to determine whether the specific plate is restricted on the selected departure date. Report the coding reason only when that predicate is true and no active exemption applies.
2. Keep the existing assignment-time server guard authoritative. The availability board is advisory; a correction to its explanation must not weaken assignment revalidation.
3. Verify request category, vehicle model, and vehicle category from their source rows. Render distinct labels when they mean distinct things; correct a data or join defect only after confirming the identity and intended category.
4. Reconcile the “clear today” count with its exact predicate, then update its title and empty-state copy together.

### 3. Restore timeline and recommendation recovery

1. If direct requests succeed after a clean dev-server restart, treat the UI messages as a stale-runtime observation and document that outcome; do not patch a working route.
2. If they still fail, trace request-ID mapping and the route’s lookup result. Return 404 only for a genuinely missing request, `200 []` for a real empty timeline, and a permission/transient error with a working retry path for other failures.
3. For Copilot, identify whether the failing request is the per-request recommendation GET or queue-plan POST. Keep expired/missing evidence visible by item and make recheck refresh current evidence without making a stale option assignable.

### 4. Close role and stale-GPS presentation gaps

1. Preserve Dispatcher pairing read access only where it supports dispatch eligibility explanation. Make contextual links and controls accurately say “View pairing” or “Manage pairing” according to the user’s permissions.
2. Prove the Dispatcher cannot create, update, release, or schedule substitutions through direct API calls; prove Fleet Manager actions still work. Add a reduced read-only view or route restriction only if the role matrix says the pairing registry itself is outside Dispatcher scope.
3. Expose responder `last_location_update` and age in the candidate list. Apply one documented stale threshold to numeric proximity/ETA; retain the candidate with an explicit stale state only if operations policy permits choosing from stale evidence.

### 5. Resolve optional scope decisions

- Confirm whether Fleet Reports is intentionally absent from Dispatcher navigation against the role matrix; document the decision without adding a new module by assumption.
- Consider an incident SLA attention card only after defining which open, unacknowledged, and overdue counts belong on Dashboard.
- Do not treat zero active trips/zero GPS points as an outage when the empty state correctly explains that no trip has started.
- Verify duplicate driver names by driver ID before changing Calendar labels.

## Acceptance and verification

- A pickup in the past is absent from “departing within 30 minutes”; a pickup exactly now and one through +30 minutes are included; a later pickup is excluded. Overdue counts remain visible separately.
- Every dashboard urgency link opens a filtered view whose rows reconcile to that card’s count.
- An assigned trip past its pickup with no recorded start is visible as “no start recorded” after the approved threshold, but its persisted status stays unchanged. Started, completed, cancelled, unknown-time, and stale/offline cases remain distinct.
- For the same plate and selected date, Availability and the Number Coding board agree on restriction and exemption. An unrelated eligibility block is never explained as number coding.
- The request, assigned vehicle, dispatch, and trip retain their IDs; fields named model/category/requested category are consistent with their source and labels.
- Timeline history, true empty history, missing record, forbidden read, and transient retry have distinct outcomes. Recommendation refresh succeeds or names the evidence item that remains unverified; stale evidence cannot authorize assignment.
- Dispatcher can read only the pairing data allowed by the role matrix and receives 403 for pairing/substitute writes; Fleet Manager workflows remain functional.
- Fresh, stale, timestamp-missing, and out-of-order responder fixes display truthful age and ETA states.
- Validate with pure unit tests, API/authorization tests, and an authenticated browser pass over isolated test data. No production acceptance claim follows from unit/build checks alone.

## Data and deployment scope

No migration is currently planned. Prefer existing dispatch settings and start-window rules. If a grace-period setting does not exist, choose and document its operational value before deciding whether configuration needs a schema change. Any implementation that adds a database object must follow the repository migration runner, catalog/anon checks, and `schema.sql` workflow in `.agents/AGENTS.md`.

## Implementation progress — 2026-10-03

Implemented in the current checkout:

- **DP-001:** `src/lib/scheduling/dispatcher-urgency.js` classifies exact instants. Past pickups no longer enter the next-30-minute totals. Scheduled departures link to Calendar's `soon` filter; unassigned pickups link to a new SQL-backed `departing-soon` Queue filter, so the filter count, rows, and pagination use one predicate.
- **DP-002:** the Dispatcher dashboard now counts assigned pre-start work at or after pickup with no recorded start. Calendar events and Trip detail show the same derived state. `PRE_START_TRIP_STATUSES` in `src/lib/scheduling/trip-state.js` now drives start-window notifications for the mobile-supported pre-start statuses; the existing `latest_start` threshold remains scheduled pickup. No dispatch, trip, reservation, or driver status is changed by elapsed time.
- **DP-003:** detail labels distinguish assigned vehicle/model, requested vehicle category, service, and the vehicle `vehicle_name` field. For the reported chain (reservation 508, dispatch 622, trip 488), all references resolve to vehicle 37. The vehicle row stores `model=Hiace` and `vehicle_name=SUV`; reservation 508 shows requested category Guest Transportation and assigned model Hiace, while trip 488 shows Model Hiace / Vehicle type/name SUV. This is a master-data naming decision, not an ID/join mismatch. No live data was changed.
- **DP-004:** availability copy now describes eligible pairs with no trip activity and the empty state describes the eligible busy set.
- **DP-005:** availability uses `numberCodingBlockReason()` and the shared `isRestricted()` policy with the selected date and exemption set before naming number coding.
- **DP-008:** read-only users now see View pairing/substitute links; users without `driver_assignments:create` do not see the Matchmaking Assistant or its staging controls. A new isolated authorization test exercises all five pairing/substitute write handlers and confirms Dispatcher 403s before query, transaction, or audit side effects; the actual permission guard allows Fleet Manager for each action.
- **DP-009:** responder candidates expose `last_location_update` and age. Coordinates, distance, and ETA are returned only for fixes younger than the existing five-minute threshold; missing, stale, invalid, or future timestamps cannot produce numeric proximity/ETA.
- **DP-010:** `GET /api/dispatch/calendar` failed because the essential vehicle roster query selected `vehicles.make`, while the connected database has `vehicles.manufacturer`. The query now aliases `manufacturer AS make`, matching the calendar consumer without changing the database or response shape. The user confirmed the calendar is working and supplied a screenshot with populated summary and resource lanes after the correction.

### Remaining acceptance

- **DP-007 UI-button acceptance remains open.** The approved authenticated GET for request 499 returned HTTP 200 with `narration: null`, no eligible candidates, and overdue/out-of-shift evidence; the reported Not Found did not reproduce at the endpoint. Code inspection confirms the empty state renders the first specific exclusion reason. The Recheck button was not clicked, so browser rendering remains unverified; repeating it would make another route-feasibility lookup. No recommendation POST, LLM narration, or assignment was run.
- **DP-003 vehicle master-data confirmation remains open.** Vehicle 37's `vehicle_name` is `SUV` while its `model` is `Hiace`. Trip detail now labels the field “Vehicle type/name” to match the fleet form; the owner should confirm whether “SUV” is the intended value before any record correction.
- **DP-008 live cookie/session replay remains open.** Isolated route tests prove the 403 boundary with the actual permission helper and no side effects, but do not exercise the user's browser cookie against the local HTTP server.

### Verification performed

- Focused Vitest: **126 tests passed across 14 files**, including the dispatcher urgency, no-start, calendar, queue, UVVRP, responder freshness, and pairing/substitute authorization cases. A separate recommendation GET suite passed **2/2** tests with radar/LLM/database writes mocked.
- `npm run verify:auth` passed: **294/294** exported API methods have an explicit guard or reviewed protocol exception. ESLint passed for the calendar route and both new test files.
- `git diff --check` passed for the follow-up changes; the new test files also passed a trailing-whitespace scan.
- Live catalog inspection confirmed `vehicles.manufacturer` exists and `vehicles.make` does not; selecting `make` returned PostgreSQL `42703`. The SQL now maps the real column to the existing `make` API field. The user-provided post-fix screenshot confirms that the calendar rendered its summary and resource lanes; a separate HTTP status/body was not captured.
- Authenticated local browser check: the Dispatcher opened reservation 508; its Timeline rendered five events (created, scheduled, vehicle assignment, driver assignment, dispatch creation). Trip 488 showed the derived overdue/no-start warning while the persisted state remained Assigned. The approved direct GET for request 499 returned HTTP 200 with current recommendation JSON and `narration: null`; it reported zero eligible candidates for an overdue service date. This confirms the endpoint Not Found did not reproduce. The Recheck button was not clicked.
- No database object or migration was added. No operational record was written. A production build was not run while the existing `next start` process owns this checkout's `.next` output.
