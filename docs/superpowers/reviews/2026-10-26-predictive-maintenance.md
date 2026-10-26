# Predictive maintenance final review record

Final code review: APPROVED after fix 01814e75a90bc491721306bfc930c8784260a088. The whole-branch review found one Important Routine-cycle conflict; the single fix wave and scoped re-review resolved it. No blocking finding remains.

Final verification: 6,223 tests passed / 174 skipped; 98 focused checks including 60 temporary-database cases passed; six demo scenarios passed; strict lint, UTF-8, whitespace and Webpack production build passed. The default Turbopack dependency-junction limit, existing output noise and unverified authenticated/device/concurrency acceptance are retained below.

This committed record preserves the temporary review reports. Their scratch log/reproduction paths are historical; committed regression tests now cover the finding. No merge, push or deployment was authorized or performed.

# Final whole-branch review - predictive maintenance

Date: 2026-10-26
Reviewer: maintenance_final_review_finish, completing the saved independent review checkpoints.
Reviewed source range: 6e0e74957c8c422abb1061ff357233e3f73612df..fcf52b953d93365508a1c75e927604fbf09f2582.
Checkout observed: 6ef94dcb333faaf8522b0adee26a57d0b3abb60e. Changes after the reviewed source head affect only the implementation-progress note.
Requirements: docs/superpowers/plans/2026-10-23-predictive-maintenance.md, accepted direction assessment, and Capstone/02 - Features/Maintenance.md.

## Coverage and method

The coverage ledger in final-review-progress.md records the earlier reviewed sections. This continuation reviewed all remaining package ranges: 7604-7768, 7829-7919, 8004-8080, and 8274-8761 (actual package end). Combined with the saved coverage, the whole branch package is covered; the unchanged SYSTEM-history lines intentionally excluded earlier are not branch changes. The package was not regenerated.

Read the Task 8 report and independent task review, deferred-minor ledger, and saved final verification summaries. Focused surrounding-code inspection checked generic POST, completion guards/callers, plan/order locking, configuration guards and tests to resolve the provisional Routine-cycle issue. One new, bounded in-memory route reproduction was run. No broad passing check was repeated. No database connection or operating write was made in this review.

## Strengths

- The product consistently separates observed due/overdue facts, forecasts, data sufficiency, work-order progress, and operational availability. Missing mileage and unsupported usage remain unknown, and the engine does not invent failure probabilities or manufacturer intervals.
- Independent plans, same-vehicle linkage, active-order uniqueness, consistent vehicle/plan/order lock ordering and transaction-local status/schedule/audit writes are a sound foundation. Rollback-only SQL fixtures exercise the actual queries and catalog-derived constraints rather than relying entirely on mocked SQL.
- Inspection evidence preserves canonical item/source identity and explicit mechanic outcomes. Immutable lifecycle snapshots and the fail-closed six-scenario demonstration provide useful traceability without pretending synthetic verification is production acceptance.
- Shared staff/mechanic presentation, persistent failed-save drafts, stale-version handling, role-scoped actions and documented browser limits are well integrated. New database relations have explicit classifications and verified privacy gates.

## Issues

### Critical (Must Fix)

None found.

### Important (Should Fix)

**I1 / P2 - An unlinked Routine completion invalidates an active linked Routine order.**

- Primary location: `src/services/maintenance-schedule.service.js:70-81`, especially the unconditional version increment at line 81 and linked-only version check at line 74.
- Reachability: generic creation remains allowed at `src/app/api/vehicle-maintenance/route.js:345-357`. Completion locks the Routine plan but checks no other active linked order at `src/services/maintenance-plan-workorders.service.js:36-46`; authorized generic completion reaches the schedule helper at `src/app/api/vehicle-maintenance/[id]/route.js:340-342`.
- Reproduction: create a reviewed Routine order on plan version 3; create a separate generic Routine order for the same vehicle; approve the generic order. Approval returns 200 and advances the plan to version 4, while the linked order retains version 3. Approving that linked order now returns 409, `Service plan changed since this work order was scheduled.` Refreshing cannot resolve this: filing a reviewed request for current version 4 returns the same active version-3 order (200), because `src/services/maintenance-plan-workorders.service.js:22-24` reuses it. Its stored version cannot be updated (`:49-53`), so the operator must cancel/archive the work order and create another just to recover the workflow.
- Why it matters: the existing generic workflow and new linked workflow can each be used legitimately, including historical unlinked Routine jobs. A successful action silently strands another active job. The configuration path already prevents this form of cycle replacement (`src/services/maintenance-plans.service.js:45-47`), but the generic completion path bypasses that protection. This is an integration defect, not an intentional request to remove legacy Routine support or weaken stale-cycle validation.
- Fix direction: under the existing vehicle/plan locks, reject a conflicting unlinked Routine completion with an actionable 409 before committing any completion, schedule, audit or snapshot change; alternatively reconcile it through an explicitly defined existing-order workflow. Preserve normal unlinked Routine advancement when no active linked Routine order exists, and preserve current-version linked completion. Do not silently rebind the linked order or merely remove the version guard. Cover existing unlinked orders and approvals that change the unlinked order's vehicle/type to Routine; verify active versus completed/cancelled/archived linked states and whole-request rollback.
- New review evidence: `.superpowers/sdd/2026-10-23-predictive-maintenance/review-routine-cycle.test.js` imports the real POST/PUT handlers and real schedule/plan helpers using the existing in-memory route fixture, with rollback restored. `.superpowers/sdd/2026-10-23-predictive-maintenance/review-routine-cycle.log` records one failing invariant test: generic completion 200, plan version 4, linked version 3, current-version scheduling reuses the same order, linked completion 409, stored linked status still Scheduled after rollback. This is a no-database reproduction, not a real concurrency or PostgreSQL acceptance test. No implementation code was changed.

### Minor (Nice to Have)

**M1 - Deferred expected-error output and existing build warning remain non-blocking.**

- The Task 2/3 ledger deferrals are expected permission-denial and audit-failure stderr. Final verification still logs expected failure-path messages (`.superpowers/sdd/2026-10-23-predictive-maintenance/task-8-logs/full-tests-final.log:20-26`) despite a passing suite. Task 8 also records the existing geoip dynamic-dependency warning (`task-8-logs/build-webpack.log:11-14`, originating in `src/lib/auth/geoip.js`).
- These can make unexpected regressions harder to spot. Capture/assert expected logging in the owning tests and clean up the unchanged build warning when those areas next change. They do not require expansion of this fix wave.
- Task 8's environment-file documentation minor was corrected in fcf52b95; it is closed, not deferred.

No additional confirmed integration finding emerged from the remaining review ranges.

## Verification and limits

Saved evidence inspected (not rerun): full suite 6,219 passed / 162 skipped; compatibility 544 passed / 48 skipped; explicit PostgreSQL TEMP fixtures 48 passed; demonstration 6/6; strict lint and encoding passed; Webpack production build passed; auth 342/342; migration ledger 169 applied / 0 pending / 0 changed; live contract 92 classified relations / 0 violations. The anon-only probe has 0 exposed, 44 explicit refusals and 48 inconclusive empty results resolved by the companion catalog contract. The empty responses themselves are not passes. Historical renamed migration ledger keys remain the documented existing condition.

The default Turbopack build fails on the worktree's out-of-root dependency junction; the installed documented Webpack fallback passes. Browser checks used real components with mocked authentication/API boundaries. Authenticated live application, actual device/font/zoom/reduced-motion acceptance and real multi-connection concurrency remain unverified. The new review test specifically exposes an interaction absent from the otherwise passing saved suites.

## Recommendations

Use the one consolidated final fix wave for I1 and focused regression coverage, then the required scoped re-review. Preserve the accepted permission, evidence, plan-version and atomicity rules. Update Maintenance.md, SYSTEM.md and the implementation-progress note through the parent-owned implementation/close-out flow; this read-only reviewer wrote only ignored review artifacts.

## Assessment

**Ready to merge? With fixes.**

The branch substantially follows the accepted plan and has strong saved verification, but I1 is a reachable workflow conflict that must be resolved before readiness approval. There are no Critical findings, one Important finding, and one consolidated non-blocking deferred output-noise item. Final review coverage is complete; final approval is withheld pending the fix and scoped re-review. No merge, push, deployment or branch mutation was performed.

# Final review fix report - I1 (2026-10-26)

Status: DONE - consolidated implementation wave committed and all required checks passed. Parent-owned single scoped re-review remains; this report does not claim final branch approval.

## Finding and decision

I1/P2 was the sole Important whole-branch review finding. An unlinked Routine approval advanced the authoritative plan and stranded a still-active linked Routine order on its former version. The accepted remedy is to refuse that conflicting approval, with no rebind, auto-cancellation or generic-creation restriction.

## Change

- src/services/maintenance-schedule.service.js: after the existing locked Routine plan read, an unlinked completion checks for a non-archived linked order in Scheduled, In Progress or Pending Inspection. It throws an actionable AuthError 409 before advancing the plan. The caller already holds the vehicle/plan locks; the existing transaction rolls back earlier work-order/status/snapshot writes. The linked stale-version guard remains.
- Only the real PUT caller invokes this helper. POST still strips completion evidence and forces Scheduled. It remains permitted while a linked Routine order is active.
- Route fixture now restores its transaction state on errors. Regression tests invoke real POST/PUT and real schedule helpers, rather than recreating completion decisions.
- PostgreSQL fixture now uses the real AuthError/handleError exports. The old stale-version test's mock-induced 500 expectation is corrected to the actual 409 contract.
- Existing schedule test doubles now supply the additional active-order read.

## Coverage

Active linked statuses (Scheduled, In Progress, Pending Inspection); inactive Completed/Cancelled/archived linked jobs; unlinked existing jobs; simultaneous PUT changes to type, vehicle, or both; unrelated corrective and brake jobs; linked completion after rejected generic approval; current-version active reuse; stale linked cycle; POST requesting Completed; whole-request rollback of every order field, plan version/schedule, vehicle state/mirror, audit and snapshot.

TEMP fixtures remain connection-local tables/local identity sequences in an outer ROLLBACK, with live reads only for catalog constraints and the existing read-only query checks. No operating rows, application sequences, migrations or dependencies were changed.

## Red / green evidence

Logs: .superpowers/sdd/2026-10-23-predictive-maintenance/final-fix-logs/.

- RED, before runtime edits: MAINTENANCE_FIXTURE_DB_TEST=1 npx vitest run src/app/api/vehicle-maintenance/plan-workorders.test.js src/app/api/vehicle-maintenance/atomic-completion.postgres.test.js -> 9 failed, 44 passed (53 total), exit 1. All failures were expected HTTP 200 instead of 409. red.log.
- Initial green compatibility exposed two outdated schedule-unit mocks (one exhausted response queue and one SELECT wildcard now matching the new guard read). All new conflict regressions and SQL cases passed. green-initial.log. Mocks were corrected without another runtime change.
- GREEN: MAINTENANCE_FIXTURE_DB_TEST=1 npx vitest run src/app/api/vehicle-maintenance/plan-workorders.test.js src/app/api/vehicle-maintenance/atomic-completion.postgres.test.js src/services/maintenance-schedule.service.test.js src/services/maintenance-plans.postgres.test.js src/services/maintenance-outlook.service.postgres.test.js src/services/maintenance-evidence.postgres.test.js -> 6 files / 98 passed, exit 0. Four SQL suites account for 60 TEMP cases; route tests 21 and schedule tests 17. green.log.
- npm run demo:maintenance -> all exact six required scenarios passed, exit 0. demo.log.

## Broad verification so far

- npm run lint:ci -> exit 0, no errors/warnings. lint.log.
- npm run build -- --webpack -> exit 0, 249 static pages. Existing unchanged geoip.js dynamic dependency warning only. build-webpack.log.
- First npm run test:run -> 560 passed files / 1 failed file / 16 skipped files; 6,222 passed / 1 failed / 174 skipped. The sole failure was the existing 5,000ms source scan in schema-contract.security.test.js while lint and build were also running. No assertion mismatch, production logic failure, test deletion or threshold change. Full failing output retained in full-tests.log. Follow-up runs use unchanged thresholds without concurrent heavy checks.

## Source-scan follow-up

The first isolated original scan also timed out: 13 passed / 1 timed out, scan 12.27s against its unchanged 5s threshold (schema-scan-isolated.log). Therefore contention alone is not an established explanation.

Read-only profiling of all 829 production source files found no slow source input: direct Node extractor 99ms total (schema-scan-profile.log), ignored Vitest diagnostic 122ms total (schema-scan-vitest-profile.log), FIXBASE schedule source 0.129ms versus changed source 0.106ms with the expected extra vehiclemaintenance reference. An ignored exact copy of the full gate, adjusting only imports and adding timing logs, passed 14/14 in 387ms with unchanged threshold and no file over 50ms (schema-gate-profile.log). This copy is diagnostic evidence, never a substitute for the actual gate.

The actual original schema-contract.security.test.js then passed unchanged 14/14 in 358ms, exit 0 (schema-scan-repeat.log). No source/gate change, timeout override, cache deletion or extractor edit was made. Earlier delay is transient; its exact environmental cause remains unproven. Final full suite was then run without concurrent lint/build: 561 files / 6,223 tests passed, 16 files / 174 tests skipped (577 files / 6,397 total), exit 0, duration 109.35s. full-tests-final.log. The actual original schema-contract suite passed in that final run. The 60 opted-in maintenance SQL cases were separately enabled and passed in green.log; suite overlaps are not additive.

## Documentation and remaining final gates

Maintenance.md now documents the conflict rule, supported legacy paths and exact verification evidence; SYSTEM.md records the behavior and validation. No parent-owned plan/progress files were staged or changed by this implementer.

- npm run verify:encoding -> exit 0, tracked text valid UTF-8/no mojibake (encoding.log).
- git diff --check and git diff --cached --check -> exit 0.
- Exact-path staged diff reviewed: six intended source/test/note paths only, no dependency, migration, secret or parent-owned progress/plan changes.

## Commit and hand-off

Fix base assigned by parent: 6ef94dcb333faaf8522b0adee26a57d0b3abb60e.
Parent's documentation checkpoint advanced HEAD to 74a5a31c704eeaa8f3b430cfb841c835f0c935a1 during implementation; it was preserved.
Fix commit: 01814e75a90bc491721306bfc930c8784260a088 - fix: protect active routine work order cycles.
Six files, 111 insertions / 10 deletions. Only five new production lines.

Committed paths:
- src/services/maintenance-schedule.service.js
- src/services/maintenance-schedule.service.test.js
- src/app/api/vehicle-maintenance/plan-workorders.test.js
- src/app/api/vehicle-maintenance/atomic-completion.postgres.test.js
- Capstone/02 - Features/Maintenance.md
- SYSTEM.md

Post-commit git status --short was empty. No merge, push, deploy, automation change, cache deletion or additional review dispatch was performed. All ignored diagnostic artifacts and full logs remain intact for the parent's ONE scoped re-review.

Self-review: the guard uses the established active status predicate and existing vehicle/plan transaction locks; it checks the resultant completed row, preserves linked version validation and avoids rebinding or automatic cancellation. The SQL rollback fixture includes inspection_items to force a pre-guard completion snapshot and compares every persisted table state after rejection. The route regression then proves the still-current linked order remains reusable and completable. No new production abstraction was introduced.

Latest quota: 34% five-hour allowance remaining (reset Unix 1792985193), 58% weekly remaining. No new work at the stop threshold occurred.

## Limits

No authenticated live UI, actual device/font/zoom/reduced-motion acceptance or real multi-connection concurrency claim. Existing expected error-path output and geoip build warning remain non-blocking. The default Turbopack dependency-junction limitation is already documented; the documented Webpack fallback passed. Unchanged live migration/privacy gates are not being rerun.


# Scoped final fix re-review - 2026-10-26

## Finding verdicts

**I1 / P2 - An unlinked Routine completion invalidates an active linked Routine order. - ADDRESSED.**

`src/services/maintenance-schedule.service.js:74-78` now checks the locked Routine plan for a non-archived linked order in Scheduled, In Progress or Pending Inspection before allowing an unlinked completion to advance the plan. It throws an actionable AuthError 409 inside the existing transaction. The check is restricted to unlinked Routine work, uses the resultant vehicle/plan, and retains the linked stale-version guard. It neither rebinds an order nor changes generic creation.

`src/app/api/vehicle-maintenance/plan-workorders.test.js:49-61` covers all three active states through the real handlers, verifies rejection preserves order/plan/snapshot/audit/notification state, then proves the original linked order is still reusable and completes on its current version. `src/app/api/vehicle-maintenance/atomic-completion.postgres.test.js:85-132` covers actual SQL rollback (including a pre-guard completion snapshot), inactive/archived linked orders, simultaneous vehicle/type changes, unrelated corrective/brake work and POST normalization. The corrected AuthError mock checks the real 409 contract rather than a mock-induced 500.

## New breakage in the fix diff

None. No new Critical, Important or Minor finding. The five production lines use the existing lock/transaction discipline and established active-order predicate. Changed test doubles account for the new read; they do not replace the behavioral and actual-SQL regressions.

## Out-of-scope observations

None newly identified. Previously recorded expected-error stderr, unchanged geoip build warning, default Turbopack junction limitation, and authenticated/device/concurrency acceptance limits remain non-blocking and unchanged. The transient source-scan timeout is recorded honestly with its exact environmental cause unproven; the unchanged original gate and final full suite subsequently passed.

## Checks performed

- Read the prepared 382-line final-fix-review-package.md once, covering base 6ef94dcb333faaf8522b0adee26a57d0b3abb60e through head 01814e75a90bc491721306bfc930c8784260a088. Parent progress commit 74a5a31c is documentation context only. No fresh whole-branch review or regenerated diff.
- Compared the fix and covering assertions with I1's reproduction and accepted remedy. Read the final-fix report and saved logs: 9 expected red conflict cases; 98 green focused checks including 60 TEMP PostgreSQL cases; final full suite 6,223 passed / 174 skipped; actual original schema gate 14/14 in 358ms; six-case demo passed; strict lint, Webpack build and encoding output inspected. Passing tests were not rerun and no new test was needed.
- Verified the change is documented in `Capstone/02 - Features/Maintenance.md:664-670` and SYSTEM.md's final review conflict-fix entry. Parent retains final progress/automation close-out.
- Read-only review: no source, index, HEAD, database or operating changes. Only this ignored UTF-8 review artifact was written. Allowance at report preparation: 22% five-hour remaining, reset1792985193.

## Verdict

**Fix round: All findings addressed, no new Critical/Important breakage.**

**Final code-review readiness: APPROVED / ready to merge from the review standpoint.** The complete whole-branch review's sole Important finding is resolved by this fix. No review finding remains open that blocks readiness; the existing non-blocking limitations remain explicit. This is review approval only, not authorization or execution of a merge, push or deployment. Parent-owned documentation and automation close-out can proceed.