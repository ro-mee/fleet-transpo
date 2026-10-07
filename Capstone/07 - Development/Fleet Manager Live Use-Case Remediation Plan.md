---
type: implementation-plan
status: in_progress
date: 2026-10-02
tags: [fleet-manager, live-use-case, reports, data-integrity, dashboard]
related:
  - ../02 - Features/Reports.md
  - ../02 - Features/Driver Management.md
  - ../02 - Features/Dispatch.md
  - ../02 - Features/Maintenance.md
  - ../02 - Features/Fuel.md
  - ../02 - Features/Assignments.md
  - Manual Functional Testing Follow-up Audit.md
  - Manual Functional Testing Remediation Plan.md
---

# Fleet Manager Live Use-Case Remediation Plan

## Goal

Resolve or explain the eleven discrepancies in the October 2, 2026 Fleet Manager Live Use-Case Test Report without changing valid workflow rules or repairing data before its lifecycle is understood.

## Evidence boundary

The report records a sampled UI walkthrough, not a source-pinned build or a systematic API/RBAC test. It reports no confirmed critical defect and no operational mutations. Its observations are useful reproduction targets, not proof that the live application and this checkout ran the same code or data. Pin the tested deployment/build to a commit before treating any live observation as a confirmed regression.

Source review in this checkout confirms several presentation and scope risks: the dashboard counts every approved leave row, its upcoming schedule list does not exclude past scheduled departures, assignment coverage divides active pairings by vehicle count, and the driver directory and driver statistics use different populations. Other findings remain dependent on row contents, query responses, or business definitions and must be reproduced before changing their implementation.

## Finding assessment

| Finding | Current assessment | Planned response |
| --- | --- | --- |
| FM001 — AI report infers outage/inactivity from zero activity | Narrative generation can accept unsupported causal language; a 24-hour cached narrative can preserve it. | Make zero-activity wording deterministic and descriptive. Do not infer a cause from an empty report. Ensure the zero-activity path cannot reuse a stale unsupported narrative. |
| FM002 — past scheduled trip shown as upcoming; Dashboard and Availability disagree | Dashboard's upcoming list can include past scheduled departures. Today overview and exact-window readiness are intentionally different scopes, so the counts alone do not establish a defect. | Make schedule presentation time-aware in Asia/Manila and state the time scope. Reconcile shared trip classification where both pages claim the same scope. Never change persisted trip status just because time passed. |
| FM003 — searching Smith misses John Smith | Not reproduced against a pinned build. The linked-driver search already uses case-insensitive partial matching across names and contact fields; the unlinked-driver query branch and UI error state need inspection. | Capture the exact request, response, pagination, and UI state; fix filtering at the failing layer and distinguish a failed request from a legitimate zero-result search. |
| FM004 — maintenance report has zero records while register shows a completed item | Report uses `maintenance_date`; the report and register may use different date/status scopes. | Trace the exact record through the register, report payload, date range, status, deletion state, and UI labels. Agree on the report's event date and population before changing a query. |
| FM005 — reference #58 opens Driver Record Not Found | Not confirmed; it may be archived, stale, or an incorrect identifier. | Trace the source link and identifier through assignments/permits to the driver row and detail endpoint. Show an accurate unavailable/archived state when appropriate; do not undelete records or expose additional driver data. |
| FM006 — Total Drivers 12 vs 13 directory entries | Source confirms different populations: statistics count driver rows, while the directory can include unlinked/incomplete driver employees. | Name each population clearly or reconcile the contract. Keep incomplete/unlinked people visible with their completion state. |
| FM007 — 22 fulfilled permits, no fuel submissions/analytics | Lifecycle semantics are defined: successful receipt inserts a fuel record and fulfills the request in one transaction; analytics include approved fuel records. The sampled UI alone cannot establish data loss. | Trace each fulfilled request to its receipt record and status. If the link is absent, investigate transaction integrity and history; if records are pending, make analytics' approved-only scope clear. Do not backfill without evidence. |
| FM008 — scheduled maintenance date passed but item is not overdue | Persisted status currently counts exact lifecycle states; overdue is not represented in the maintenance summary. | Derive an overdue indicator for scheduled work whose date has passed in Asia/Manila. Preserve persisted status and exclude in-progress/completed work. |
| FM009 — “136% healthy fleet assignment rate” | Source computes active pairings divided by total vehicles, so the value can exceed 100%; the label describes a different measure. | Calculate distinct active assigned vehicles against the same active fleet population, or show a plain pairing count. Do not cap the existing ratio or call it fleet health. |
| FM010 — calendar-only predictions have 93/100 and 86/100 scores | Score is schedule/urgency and corrective-history derived, not a measured mechanical condition; the UI has a calendar-only caveat but calls it a health rating. | Label the score as a schedule outlook, show its inputs/coverage and confidence, and keep “No Schedule” distinct from a score. Do not imply sensor-based vehicle condition. |
| FM011 — Dashboard shows four on leave, Directory shows zero | Source counts every approved leave record in the dashboard while the directory's “On Leave” is current-state oriented. | Count approved leave active on the current Manila date for a “today” label, or label a historical total explicitly. Preserve dispatch's exact-date leave eligibility rules. |

The report also notes “0 drivers on roster” in the Drivers report. Reproduce it with FM006 and clarify whether the report means linked driver records, all driver-role employees, or another roster population.

## Implementation sequence

### Phase 0 — Pin and reproduce

1. Record the deployed commit/build, role, timestamp and timezone, filters/date range, and exact user actions for each finding. Compare the deployed SHA with the checkout before attributing a live observation to current source.
2. Use a controlled non-production account and fixture. Capture the relevant page state plus request parameters and response payloads. Use read-only inspection for existing production data; do not create, approve, fulfill, reassign, delete, or backfill records during diagnosis.
3. Reproduce each row-level mismatch with its actual source records: driver reference #58, maintenance item QA-0001, leave dates, and fulfilled fuel requests/receipt records. Record which items are not reproducible and why.
4. Resolve definitions before changing metrics: “today,” “upcoming,” “roster,” maintenance event date, completed work, active fleet denominator, fuel submission, and predictive score.

### Phase 1 — Correct misleading workflow and report output

1. **Trip schedule (FM002):** exclude past departures from an “upcoming” list or label them as past scheduled items. Use a shared Manila-time comparison and show the date/window basis. Keep the lifecycle transition explicit and user/system initiated. Retain the distinction between coarse current readiness and exact-window availability.
2. **Driver search and reference (FM003, FM005):** reproduce API and UI behavior first. Cover both linked drivers and unlinked driver employees; apply the same search term to every included branch. Add a visible request-error state if the UI currently collapses errors into an empty directory. Correct stale/wrong links at their source, and provide an explanatory unavailable state for genuinely deleted or missing records.
3. **Report narrative (FM001):** when a range has no activity, return a deterministic statement limited to the observed range and metrics. Do not let the model infer outage, inactivity, or cause. Make the no-activity rule override or invalidate cached narratives that violate the new rule; preserve valid non-empty narrative behavior and the existing report-range validation.
4. **Maintenance report (FM004):** after QA-0001 and the report payload are compared, align the label, date field, and status grouping to the documented report contract. Keep `maintenance_date` versus completion date explicit; do not silently shift the report's meaning.

### Phase 2 — Reconcile summary scopes and derived states

1. **Drivers and leave (FM006, FM011):** state whether cards count linked driver records, all directory people, or currently active workers. Make “on leave today” use approved leave covering the Manila current date; preserve historical totals under an explicitly historical label if useful.
2. **Maintenance overdue (FM008):** derive an overdue badge/count for scheduled records with a date before the current Manila date. Keep the stored lifecycle status as Scheduled until an authorized transition occurs. Make the register, dashboard count, and report labels use compatible definitions.
3. **Assignment coverage (FM009):** derive numerator as distinct active vehicles with an active pairing and denominator as the same in-scope active fleet. Display numerator/denominator. Keep unassigned vehicle count consistent with this population; handle zero-vehicle cases without division errors.
4. **Predictive maintenance (FM010):** rename the score to describe what it measures (for example, service schedule outlook), disclose calendar-only or sparse-telemetry basis and confidence, and never label it a physical condition measurement. Keep unscheduled vehicles at “No Schedule.”

### Phase 3 — Gate fuel lifecycle before UI or data changes

For each fulfilled permit/request, trace the request ID to its `fuelrecords` row, status, soft-delete state, and analytics eligibility. The mobile receipt transaction is expected to insert the receipt and fulfill the request atomically. If that invariant is broken, investigate the write path, retries, and historical transaction evidence before changing data. If a receipt exists as Pending, preserve the approved-only analytics rule and correct any labels that imply every fulfilled request is already an approved analytics record. Any repair or migration requires a separate evidence-backed scope.

### Phase 4 — Verify and release

1. Add focused regression coverage for the accepted behavior in each touched layer, then run the repository's relevant checks for changed paths, test suites, and production build.
2. Perform a Fleet Manager browser retest against the pinned build using the acceptance checks below. Confirm no production operational rows were changed as part of verification.
3. Update the relevant feature notes and `SYSTEM.md` after implementation. A database migration is not part of this plan unless Phase 0 proves a schema/data invariant requires one; follow the repository migration runner policy if that changes.

## Acceptance checks

- **FM001:** Empty and non-empty report ranges never claim an outage or cause based only on zero activity. A pre-existing cached unsupported narrative cannot reappear for the empty range.
- **FM002:** Trips before, at, and after departure are classified consistently in the stated Manila-time scope; in-progress/completed cases remain clear; no clock-only lifecycle mutation occurs. Exact-window Availability retains its distinct readiness meaning.
- **FM003:** Exact and partial case-insensitive searches find linked and unlinked matching people across pages; clearing the query restores the list; request failure is visibly different from no matches.
- **FM004:** A known maintenance row appears or is excluded according to a stated date/status contract, including range boundaries and completed-date differences.
- **FM005:** Valid, archived/deleted, nonexistent, and wrong-type identifiers produce safe, accurate detail states; links do not expose another driver's private data.
- **FM006:** Summary cards and directory/report populations either reconcile or name their different scopes, including incomplete/unlinked entries.
- **FM007:** Fulfilled requests have a traceable receipt under the atomic-success contract. Pending versus approved records appear according to their documented registry and analytics scopes; retries do not duplicate receipts.
- **FM008:** Past, current, and future scheduled dates are correctly identified in Manila time; in-progress/completed records are excluded from overdue; the derived view does not rewrite stored status.
- **FM009:** Coverage uses distinct assigned vehicles and a matching active-fleet denominator, shows its numerator/denominator, and handles zero vehicles and duplicate/history pairings.
- **FM010:** No-schedule, calendar-only, sparse-telemetry, and adequately sampled predictions expose the correct basis and confidence without suggesting measured mechanical condition.
- **FM011:** Historical, current, and future approved leave are distinguished; the “today” count matches leave active on the Manila date while dispatch eligibility remains unchanged.
- **Shared:** Run role-restricted route/API checks in a controlled fixture because the report did not test authorization endpoints. Retest core dashboard, assignment, permit, maintenance, fuel, route/GPS, coding, and reporting navigation without mutating production data.

## Completion gate

This plan remains `in_progress` until the deployed build is pinned, the source-level changes pass verification, and the row-dependent findings are resolved against the correct live database or an isolated fixture. Do not treat the report's priority labels as confirmed severity. No live row repair or schema migration is authorized by this plan.

## Implementation record - 2026-10-03

The reviewed source is based on local commit `26ac198` after a fast-forward from `origin/main`. The report's tested deployment SHA is still unknown, so these are local source fixes and do not establish that the reported production build has changed.

| Finding | Implementation/evidence in this checkout | Remaining acceptance |
| --- | --- | --- |
| FM001 | Explicitly zero-trip Fleet windows return deterministic, non-causal wording before cache lookup or model call. Route and narrative tests cover stale-cache bypass and empty-window wording. | Retest the report page on the pinned deployed build, including a non-empty range. |
| FM002 | Upcoming scheduled departures are filtered by exact instant; reassignment exceptions remain visible. Manila date helper is used for dashboard calendar-day scopes. Pure and dashboard tests cover past/future rows and no persisted lifecycle write exists in this path. | Replay the Fleet Manager dashboard and confirm Availability's exact-window scope remains clearly distinct. |
| FM003 | DataTable search values now include nested employee name/email/phone fields. The API search covers linked and incomplete branches; incomplete rows are omitted when status/license filters cannot be evaluated. Request failures show retry and are distinct from no matches. | Confirm exact/partial search and pagination in the deployed browser with a controlled account. |
| FM004 | Read-only snapshot on 2026-10-03 found 7 non-deleted rows for Sep 25-Oct 2 Manila, including 4 with Completed status by `maintenance_date`. Three completed rows have `completed_date` in-range. A zero-cost Completed row dated Sep 30 Manila has no `completed_date`; the `QA-0001` marker was not present in the description, remarks, provider, or service-center fields checked. The current report query should return 7 rows and 4 Completed, so the screenshot's zero is not reproduced from this snapshot/source. | Compare the pinned browser request parameters and payload to this snapshot; identify the exact QA-0001 row before changing report semantics. |
| FM005 | Read-only snapshot confirms driver #58 is soft-deleted, with 1 assignment and 2 fuel-request references. The detail route still returns not found without exposing archived data; its page now explains that the profile may be archived, deleted, or the link may be stale. No row was restored or changed. | Confirm the archived state is clearly explained from the pinned assignment and permit links. Do not restore or reveal the archived record. |
| FM006 | Dashboard card and Drivers report now say linked driver profiles; incomplete driver accounts remain visible. Current DB snapshot has 22 active profiles and 1 unlinked driver-role employee, so the expected current counts are 22 vs 23. The report's 12 vs 13 is not the current snapshot. | Verify both counts against one pinned browser payload; retain the explicit population labels. |
| FM007 | Permits expose active/archived receipt counts and eligibility. At 2026-10-03 02:59 Manila, the documented live project had 22 fulfilled requests: 21 linked only to archived receipts, 1 linked to an active receipt, and none without a linked receipt. Across fuel records, 49 of 50 were archived (20 retained `Approved`, 29 retained `Pending`); no archived record had a matching `fuelrecords` audit event. Earlier same-day snapshots reported 24 fulfilled requests and 12 active Approved records, so these live counts changed between read-only checks and must be treated as timestamped. The DELETE route now locks and archives an active fuel record and writes a required audit event in the same transaction; audit failure rolls back the archive. It records actor, time, prior status, and permit link, but no free-text reason. No data repair was made. | Historical archive actor/reason cannot be recovered from current audit history. Compare the walkthrough against a pinned build; do not backfill or unarchive based on the screenshot. |
| FM008 | API and register derive overdue only for Scheduled rows with `maintenance_date` before today's Asia/Manila date. Stored status is preserved; dashboard/register show the derived count/badge. | Verify boundary dates and labels in a controlled fixture and deployed browser. |
| FM009 | Coverage uses unique open-ended assignments intersected with non-deleted, non-decommissioned vehicles. Numerator/denominator are shown; the zero-fleet value is an em dash. Decommissioned vehicles are excluded from the matching unassigned count. | Confirm source payload and all assignment statuses with fixture/browser acceptance. |
| FM010 | Predictive page now says Service Outlook, names schedule urgency/corrective-history inputs, distinguishes no schedule, and exposes calendar-only versus adequate 90-day mileage-sample wording. Scoring is unchanged. | Retest unscheduled, low-sample, and sufficient-sample cards against the deployed page. |
| FM011 | Approved leave is counted for the current Asia/Manila calendar day and deduplicated by driver; historical/future/pending rows are excluded. Current snapshot has 0 approved drivers on Oct 2 and 1 on Oct 3, so the screenshot's count of 4 is not reproduced. Dispatch eligibility is untouched. | Validate leave-date boundaries with fixture/browser acceptance and compare the dashboard against the pinned Oct 2 payload. |

Verification: the prior source changes passed **68 tests across 10 files**, including the original `src/app/api/drivers/route.test.js` create/address suite. The receipt and unavailable-driver follow-up passed **11 tests across 3 files**. The latest focused run passed **14 tests across 4 files**, including transactional receipt-archive audit success, rollback-on-audit-failure, and already-archived behavior; changed paths passed ESLint and `git diff --check`. Live aggregates ran in `READ ONLY` transactions against the documented project. Earlier Turbopack and Webpack builds exhausted the Node heap; the latest host check showed about 0.34 GB free, so a build retry was not attempted. No migration or data row was changed by this work.

The database target was verified again as project `dnxuphhxlzidvwtdqqkq` / database `postgres`. `npm run db:status` reports 140 applied files, no pending or changed migrations, and three historical ledger keys with no on-disk file (`113_maintenance_repairer_identity.sql`, `114_app_errors_rls.sql`, `115_rls_gap_tables.sql`). Read-only snapshots changed between checks, including fulfilled permits (24 to 22) and active approved fuel rows (12 to 0); no query in this work wrote to the database. No local Vercel project link or CLI is available, and the deployed SHA remains unknown. The available local browser session is Dispatcher, so Fleet Manager acceptance is still open. Latest host memory was about 0.34 GB free, insufficient for a safe build retry after the earlier heap failures.
