# Predictive Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Track progress using the checkboxes and the execution note.

**Goal:** Deliver explainable service forecasts, separate service schedules, a traceable manager/mechanic workflow, and a modern maintenance workspace suitable for a realistic capstone demonstration.

**Architecture:** Extend the existing pure prediction engine and existing work-order lifecycle. Add only the persistence necessary for per-vehicle service tasks, evidence snapshots and linked outcomes. Keep operational availability separate from forecast urgency and preserve current permissions.

**Tech Stack:** Next.js 16.2.11, React 19, PostgreSQL through pg, Vitest, shared Radix components, TanStack Query, existing FleetOps design tokens.

## Global Constraints

- Work only in C:/Users/lenovo/.codex/worktrees/predictive-maintenance/capstone on codex/predictive-maintenance, based on 6e0e74957c8c422abb1061ff357233e3f73612df.
- The owner authorized implementation, a separate worktree and one commit per completed task. Do not merge, push or deploy.
- Read .agents/AGENTS.md and relevant Capstone notes before edits. Update Maintenance.md and SYSTEM.md per task, preserving unrelated work.
- Use explicit UTF-8 writes. No default PowerShell text-file writes.
- No new runtime dependencies. Preserve existing auth, assignment scope, separation of duties, incident grounding and Manila calendar semantics.
- Read installed Next.js route/client guidance before changing those surfaces.
- Observe failing behavioral tests before substantive logic changes, then run focused tests and lint. Review each task before moving on.
- Missing evidence remains unknown. Due status is not roadworthiness. Scheduled is not completed. No invented failure probabilities, confidence percentages or manufacturer intervals.
- Calendar-based usage estimates use observed calendar coverage, including idle days, not active days alone.
- All new public tables explicitly enable RLS and revoke anon/authenticated privileges. Register schema classifications. Apply migrations only with the supplied runner after checking its live ledger. Refresh generated schema.sql and verify catalog, app queries, db:contract and verify:anon.
- Keep current FleetOps Inter, semantic colors, shared components and restrained motion. UI/UX Pro Max, Impeccable and High-End Visual Design inform the work; repository UI rules win conflicts.
- The continuation automation is continue-predictive-maintenance-implementation. Check five-hour allowance at task boundaries; at 5% remaining or less checkpoint unfinished work and reset timestamp, then resume after reset. Disable schedule only when all work is complete.
- Progress authority: Capstone/07 - Development/Predictive Maintenance Implementation Progress 2026-10-23.md plus git log. Never restart completed tasks.
- The prior assessment at Capstone/07 - Development/Predictive Maintenance Direction Assessment 2026-10-23.md is the accepted product direction. It is historical review evidence, not a runtime completion claim.

## Setup and baseline

- [x] Created and attached managed worktree and branch.
- [x] Reused existing node_modules through a junction; no dependency versions changed.
- [x] Existing focused baseline: 4 files, 82 tests passed.
- [x] Primary checkout db:status: 166 applied, 0 pending, 0 changed. Recheck before choosing a new migration number.
- [x] Created a 30-minute continuation heartbeat for this chat.
- [x] Commit this plan and the accepted assessment in the isolated worktree (0c2f7f46).

### Task 1: Correct observed due status and unknown readings

**Files:** src/lib/ai/predictive-maintenance.js; src/lib/ai/predictive-maintenance.test.js; affected direct consumers/tests only; Maintenance.md and SYSTEM.md.
**Consumes:** existing predictVehicle(row, now), resolveDueDate({vehicle, usage, now}), predictFleet(rows, now), isUnscheduled(prediction).
**Produces:** existing response fields remain compatible; add explicit serviceStatus (overdue, due, upcoming, on_schedule, needs_data), dataIssues array and mileageOverdue boolean. Keep risk bands for existing consumers; unknown rows cannot be displayed as healthy.

- [x] Add regressions: exceeded mileage with zero trips and future/no calendar date; exact mileage threshold; one kilometre overdue at a high usage rate; null mileage with configured threshold; known overdue date with missing mileage; no schedule.
```js
const p = predictVehicle({ mileage: 5001, next_service_mileage: 5000, trip_count: 0 }, new Date("2026-10-23T04:00:00Z"));
expect(p.risk).toBe("overdue");
expect(p.kmToService).toBe(-1);
expect(p.mileageOverdue).toBe(true);
```
- [x] Run npx vitest run src/lib/ai/predictive-maintenance.test.js and confirm new assertions fail.
- [x] Detect known mileage/date thresholds before forecast confidence checks. Keep missing mileage null. Avoid negative-zero rounding hiding an exceeded threshold; do not invent days overdue without a valid rate. Make isUnscheduled mean absent schedule, not merely absent estimated date. Preserve summary counts with an explicit needs-data counter if required.
- [x] Run engine and predictive page tests; inspect all callers of isUnscheduled/effectiveDays to keep mechanic upcoming behavior truthful.
- [x] Update documentation, lint touched source, diff/encoding checks, review and commit: fix: distinguish overdue maintenance from uncertain forecasts.

### Task 2: Keep completion, status and qualifying schedule changes consistent

**Files:** src/services/maintenance-schedule.service.js and tests; src/services/status.service.js and relevant tests; src/app/api/vehicle-maintenance/[id]/route.js and tests; src/app/api/vehicle-maintenance/route.js and tests.
**Consumes:** existing withTransaction(tx), writeAuditRequired and work-order state machine.
**Produces:** recomputeVehicleSchedule(vehicleId, row, executor) and relevant status helper accept the transaction executor; existing callers retain a default DB executor.

- [x] Add behavioral regressions for unrelated Corrective/Inspection repair not advancing Routine schedule, qualifying Routine completion advancing it, failed schedule update rolling back completion, and unchanged terminal-state/assignee permissions.
```js
await recomputeVehicleSchedule(7, { status: "Completed", maintenance_type: "Corrective" }, tx);
expect(tx.query).not.toHaveBeenCalled();
```
- [x] Run focused tests and confirm failures before implementation.
- [x] Restrict legacy routine resets to completed Routine work. Put authoritative schedule/status writes inside the same transaction as completion and audit. Keep notifications post-commit. Inspect POST completed-record path as well as PUT. Ensure transaction-aware helpers never fall back to global query internally.
- [x] Run work-order/schedule/status tests including failure paths, lint, document and review.
- [x] Commit: fix: complete maintenance and qualifying schedules atomically.

- [x] Use only the supplied transaction executor in syncVehicleStatus. Lock affected vehicle rows in stable ID order before reading remaining active work; include old/new vehicles on reassignment. Preserve incident precedence and Manila dates. Verify live pg_constraint before choosing any status value: migration 014 and schema.sql disagree about Registration Expired. If live rejects it, resolve through the normal migration workflow; do not silently remove registration eligibility.
- [x] Require or server-stamp the actual completion date on transition; do not substitute a future scheduled date. Missing mileage_at_service stays unknown, without substituting the current vehicle mileage. Add regressions for both cases.

### Task 3: Add per-vehicle service schedules and safe configuration

**Files:** new src/lib/maintenance/service-catalog.js; new src/services/maintenance-plans.service.js; new src/app/api/maintenance/service-plans/route.js; numbered supabase migration; scripts/lib/schema-contract.mjs; schema.sql; focused service/route/schema tests.
**Consumes:** vehicle IDs, existing maintenance read/create/update permissions with an explicit staff configuration guard and audited transactions.
**Produces:** fixed service codes routine, brakes, tires; per-vehicle plans with interval_days/interval_km, last_service_date/last_service_mileage, next_service_date/next_service_mileage, version and audit timestamps. GET returns role-scoped plans; PUT creates/updates an authorized vehicle plan with expected_version conflict checks.

- [x] Read latest db:status and reserve the next unused version; verify schema and catalog conventions before naming the migration.
- [x] Test positive/null intervals (at least one interval or explicit due threshold configured), invalid vehicle/code, stale version (409), forbidden role and mechanic assigned-vehicle read scope.
```js
expect(SERVICE_CODES).toEqual(["routine", "brakes", "tires"]);
expect(validateIntervals({ interval_days: null, interval_km: -1 }).ok).toBe(false);
```
- [x] Create vehicle_service_plans with unique(vehicle_id, service_code), positive interval constraints, FKs, RLS and revoked public grants. Extend vehiclemaintenance with nullable service_plan_id and service_plan_version, without altering historical rows' meaning.
- [x] Import only existing usable vehicle routine schedule values as routine plans; do not invent brake/tire intervals or service history. Keep legacy routine fields synchronized for current dispatch/advisory consumers.
- [x] Add POST /api/vehicles/[id]/odometer under vehicles:update. Persist vehicle_id, reading_km, observed_at, recorded_at, recorded_by and reason in a private vehicle_odometer_observations table. Validate 0..2,000,000 km, no future observed time, reject readings below current mileage; update vehicle and observation atomically. Manual observations are not photo verification. No bulk backfill or decreasing correction workflow.
- [x] Apply via db:up, dump schema, verify constraints/policies/grants and real read queries; run db:contract and verify:anon, resolve inconclusive using catalog.
- [x] Update vault/schema documentation, review and commit: feat: configure independent vehicle service plans.

- [x] Require maintenance:update plus explicit admin/super_admin/fleet_manager guard for configuration, and vehicles:update for odometer recording. Mechanics have maintenance:update and must not gain configuration permission.
- [x] Permit legacy explicit due thresholds even without an interval; label these as manual schedules. Add deferred_until/defer_reason fields, version increment on configuration/completion, same-vehicle plan linkage and the active-order partial unique index. Reject plan configuration changes while an active linked order exists (409) rather than allow silent cycle replacement.
- [x] Make plans authoritative: route existing vehicle schedule creation/update through the shared service or remove those writable fields only after adapting their forms. Keep routine legacy columns synchronized in the same transaction.

### Task 4: Ground forecasts in measured usage and expose task-level evidence

**Files:** src/app/api/ai/predictive-maintenance/route.js and tests; src/lib/ai/predictive-maintenance.js and tests; new src/services/maintenance-outlook.service.js and tests.
**Consumes:** Task 1 status semantics; Task 3 service plans; existing trips.actual_distance_km/distance_provenance and odometer evidence.
**Produces:** prediction.services[] per plan, dataIssues, evidence with valid/total sample counts, observation period, latest attributable reading time and usage rate; preserves existing vehicle-level summary contract.

- [x] Test that five completed trips with one measured distance are not high quality, estimated-only distance is excluded, invalid/negative readings are excluded, absent odometer timestamps stay unknown, and date-only schedules still work.
```js
expect(computeUsageRate({ km_90d: 500, trip_count: 5, valid_trip_count: 1 }).confidence).toBe("low");
```
- [x] Build measured-distance selection using the repository's existing provenance meanings, counting only qualifying samples. Explain a documented evidence-quality rule instead of presenting it as calibrated probability.
- [x] Compute task outlooks with the shared pure engine; aggregate vehicle urgency from the most urgent known task while retaining missing-data tasks.
- [x] Use actual verified reading timestamps where available; never use vehicle.updated_at as proof of an odometer observation.
- [x] Verify API/mechanic/advisory compatibility, document, review and commit: feat: explain service forecasts with measured evidence.

- [x] Align total/qualifying trip counts with the observation period. Incomplete measured coverage must be reported and must not turn a partial-distance sum into a confident full-usage rate or late service forecast; test five qualifying trips among many excluded trips. Do not impute missing distance.

### Task 5: Link service forecasts to existing work orders

**Files:** existing maintenance POST/PUT and services; new src/services/maintenance-plan-workorders.service.js and tests; relevant validation/client service/form modules.
**Consumes:** service_plan_id/version; existing assignee selection, Scheduled/In Progress/Pending Inspection/Completed lifecycle.
**Produces:** active_work_order link in outlook; explicit serviced task on completion; optional recorded defer reason/review date that never hides factual overdue status.

- [x] Test concurrent/repeated scheduling returns the existing active order for the same plan, different plans can have separate jobs, closed jobs allow a new cycle, and unauthorized/foreign vehicle-plan pairs fail.
```js
expect(secondResult.maintenance_id).toBe(firstResult.maintenance_id);
expect(otherPlanResult.maintenance_id).not.toBe(firstResult.maintenance_id);
```
- [x] Lock the service-plan row during reviewed creation and use a DB uniqueness guarantee for active linked work orders. Add an idempotent migration only after ledger check if the Task 3 migration is already applied.
- [x] Carry server-computed forecast evidence into creation, not trusted browser claims. Reuse existing notification and assignment paths.
- [x] On approved completion, update only the linked plan in the existing transaction, audit it, and update legacy routine values only for routine work. A brake inspection cannot reset oil service.
- [x] Test invalidating/retrying completion, rejection, cancellation/archive, linked-plan changes and role separation.
- [x] Document, review and commit: feat: connect service forecasts to reviewed work orders.

- [x] Require expected_version when filing a reviewed plan order; reject stale cycles with 409. Keep plan/vehicle linkage immutable after work starts. Lock vehicle then plan then work order consistently with completion. Recover the existing active order for repeated requests, with no duplicate notifications.

### Task 6: Add one inspection signal and lightweight outcome evidence

**Files:** new src/lib/maintenance/inspection-signals.js and tests; outlook service; existing work-order findings forms/API; new snapshot persistence service/migration and schema classifications.
**Consumes:** existing unresolved inspection checklist findings and source_inspection_id links; approved service plans/work orders.
**Produces:** recurring_inspection signal with source record links, explicit review disposition, and maintenance_forecast_snapshots with rule_version, captured_at, inputs, forecast, plan/work-order references and outcome.

- [x] Test repeat matching normalized checklist findings, resolved findings excluded, combined brakes_tires source retained honestly, no synthetic diagnosis, and mechanic scopes.
- [x] Define repeated as the same failed checklist key on at least two distinct inspections within 30 calendar days after the latest relevant completed repair, with explicit counts/dates and links.
- [x] Persist snapshots at reviewed scheduling and completion (meaningful lifecycle changes), not as a side effect of GET or every page render. Record mechanic confirmed/not_confirmed/inconclusive with evidence. Do not turn these into failure probabilities.
- [x] Use the existing inspection-to-work-order route/locking semantics where applicable, preserving its source deduplication constraints. No new automatic grounding or duplicate issue-report table.
- [x] Test snapshot rollback with failed creation/completion, scoped reads and truthful empty evaluation.
- [x] Apply/dump/verify any migration with the same security gates; document, review and commit: feat: trace inspection signals and maintenance outcomes.

- [x] Store structured checklist_item_id, original inspection IDs, outcome, outcome actor and time on linked work orders or immutable snapshots; extend mechanic validation and scoped reads. Match repeated unresolved items by vehicle and canonical item ID, not free-text repair type. Reuse the active order for that item even if a newer inspection exists; unrelated completed repairs cannot clear it.
- [x] Add a GET-no-writes regression. Capture snapshots/observations at the odometer mutation too when needed to observe threshold crossings; otherwise label that outcome unobserved. Early service closes a cycle without counting it as a prediction error.

- [x] Keep outcomes evidence-based: no accuracy score or exact timing error from a crossing known only between readings. An observation predating its forecast is not prospective prediction evidence. Preserve per-item source associations on multi-item inspection orders; generic legacy completion alone is not confirmed item-specific repair.
- [x] An approved not_confirmed disposition retires only its explicitly reviewed source findings from the unresolved set, without inventing a repair or clearing other reports. Inconclusive remains unresolved; new reports can establish a new recurring signal.

### Task 7: Build the shared maintenance workspace

**Files:** new src/components/maintenance/service-outlook.jsx and supporting small components/tests; src/app/(dashboard)/maintenance/predictive/page.js; src/app/(dashboard)/fleet/maintenance/components/PredictiveOverview.js; fleet maintenance page/form; relevant mechanic detail components.
**Consumes:** task/evidence/work-order response from Tasks 4-6 and existing shared UI controls.
**Produces:** one shared outlook presentation, configuration and scheduling actions, with existing routes preserved.

- [x] Read docs/design-system.md, requested design skills and installed Next.js client/component guide; inspect existing table, dialog, picker and date controls.
- [x] Add real-component tests for overdue/no-data/scheduled/error/loading/read-only states, matching values on both maintenance routes, and role-appropriate action destinations.
- [x] Use compact summaries followed by a priority list and desktop detail panel; stack into focused mobile detail. Columns: vehicle, service, due status, reason/evidence, next action. Avoid decorative charts and physical-health scores.
- [x] Expose Review, Schedule service, View work order, Record odometer and Set schedule only when authorized and applicable. Reuse assignee directory/picker and existing work-order lifecycle. Forms preserve inputs after failure and refresh authoritative state after success.
- [x] Keep availability, service urgency and work-order progress distinct. Use Due within 7 days for routine timing. Counters state units and do not imply overlapping categories partition a total.
- [x] Verify keyboard/focus, touch, light/dark, narrow/desktop and error states in a browser where available. Clearly label fixtures; never claim fixture checks are live authenticated checks.
- [x] Document rendered evidence/limits, review and commit: feat: unify the maintenance service outlook workspace.

### Task 8: Demonstrate, verify and close out

**Files:** focused workflow tests; a non-destructive demo fixture/preview using existing test patterns; Capstone implementation progress and Maintenance.md; SYSTEM.md.
**Consumes:** all tasks and review evidence.
**Produces:** reproducible demo steps, verified branch and per-task commit ledger.

- [ ] Cover the six accepted scenarios: overdue without trips, supported future forecast, missing inputs, repeated inspection finding, active-order reuse and isolated service completion.
- [ ] Demo data must be explicitly labeled and isolated; do not create live fleet/work-order records for a demonstration without an explicit reason and cleanup mechanism.
- [ ] Run focused maintenance/mechanic/inspection/dispatch compatibility suites, full tests, lint:ci, verify:auth, verify:encoding, db:check, build and applicable live DB gates. Record exact failures or unavailable verification rather than claiming success.
- [ ] Review the full branch with an independent reviewer; address important findings and rerun affected checks.
- [ ] Update user-facing documentation and final commit: test: verify predictive maintenance workflow and demo.
- [ ] Confirm clean worktree and commit history, disable continuation heartbeat, report completion and remaining environment limits. Leave branch/worktree available for user review.
