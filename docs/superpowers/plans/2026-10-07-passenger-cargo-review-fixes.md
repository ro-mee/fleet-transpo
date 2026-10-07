# Passenger/cargo review fixes implementation plan

> **For agentic workers:** Use test-first debugging and parallel independent ownership; verify each regression before proceeding.

**Goal:** Correct the reviewed Tasks 1–13 defects without applying migrations or deploying.

**Architecture:** Reuse the shared dispatch gate and engine evidence, preserve an explicit legacy request boundary, and make evaluated/stored cargo windows identical. Resolve verified fuel prices through a real repository and capture the completion basis atomically. Share report filters and decoded workbook data; keep automatic provider publication disabled until a verified source exists.

**Tech stack:** Next.js 16.2.11, React 19, Expo 57, PostgreSQL, Vitest 3, existing UI components and ExcelJS.

## Global constraints

- Work in the existing clean `feat/passenger-cargo` worktree; preserve dirty root/main edits.
- No live DB contact, migration apply/dump, seed execution, fabricated compliance, guessed prices, merge or deployment.
- Prepared migrations 150–155 may be corrected; no new version number is selected without an authorized status check.
- Legacy requests retain historical behavior; typed unknown evidence blocks. No override weakens typed safety.
- Existing Capstone specifications and the user-approved review fixes are the design authority.

## 1. Shared readiness, capacity and rollout

Files: `src/services/recommendation.service.js`, `src/lib/scheduling/conflicts.js`, vehicle readiness/API/form files, migrations 151/153, ranking and their tests. Owner: capacity worker.

- [x] Add failing complete-cargo, Pending readiness, legacy migration/start, identical blocker, missing cohort field, migration-rerun and unsafe-ranking tests.
- [x] Run each focused test before implementation; inspect the expected behavioral failure.
- [x] Integrate server-owned readiness and preserve null legacy load classification. Return unchanged blockers from endpoints. Make cohorts require all static evidence; verify exact catalog shapes.
- [x] Verify focused gate/vehicle/migration/ranking suites and update Fleet And Vehicles/runbook notes.

Interfaces remain `validatePairAvailability(...) -> {ok, conflict, serviceEnd, commitToken}` and `evaluateVehicleCapacity(request, vehicle)`; typed input must come from stored request rows.

## 2. Cargo service-window integrity

Files: `src/lib/scheduling/cargo-schedule.js`, `src/services/dispatch-radar.service.js`, dispatch POST/PUT and tests. Owner: root.

- [x] Reproduce explicit drive-only and equal/backward arrivals before edits.
- [x] Derive the minimum buffered end; insufficient explicit plans block or extend consistently. Invalid ordering must reject at API boundary before candidate evaluation.
- [x] Persist the accepted gate window at create/update and use it for overlap validation.
- [x] Prove accepted windows and stored values match; preserve passenger behavior and inspection FAIL blocking.

Example regression: with a 60-minute drive and 90 minutes handling, `cargoServiceEnd` must not accept a 60-minute service window as sufficient. `scheduled_arrival <= scheduled_departure` must return 400 before write.

## 3. Verified price workflow and atomic completion

Files: fuel policy/provider/repository/API/UI, trip lifecycle/complete caller, draft 154/155 and pending schema contract. Owner: fuel worker.

- [x] Reproduce Historical lookup, missing verification, offset-free timestamps, redirect spoof, planned/GPS mismatch, disconnected caller and concurrent capture.
- [x] Implement manual verified snapshots with server-derived verifier and permission checks; classify only exact reviewed pending tables without modifying generated schema.
- [x] Resolve production price basis and lock/recheck terminal state before atomically storing the whole completion basis. Actual distance excludes planned fallback.
- [x] Validate origin/current history/duplicate updates before publication; automatic route stays disabled by default.
- [x] Run real module/caller/fake-DB tests and update Fuel note.

Price resolution returns verified value plus snapshot/region provenance or null. Receipt price and `fuel_consumed` remain unchanged.

## 4. Driver copy and report parity

Files: mobile map/detail presentation, trip/report selectors, screen filters, APIs and workbooks. Owner: driver/report worker.

- [x] Reproduce cargo guest/status wording and removed workbook service cells with rendering/decoded workbook assertions.
- [x] Pass canonical service filters through screen, API, selector and export; return 400 for unknown codes.
- [x] Display/export planned/actual estimates and cargo utilization; unknown capacity remains omitted.
- [x] Prepare opt-in ledger-scoped demo scenarios without a seed run and update Reports/Trips notes.

## 5. Integration and final review

- [x] Review worker patches against all findings and resolve shared-file seams.
- [x] Run focused regressions, full suite, strict lint, offline migration filename and route-auth gates.
- [x] Preserve the production-build configuration hold: no legitimate `.env` in this worktree, so no build or invented configuration. Browser/device and live DB checks remain external.
- [x] Update branch SYSTEM.md and review closeout note with exact evidence and retained release holds.
- [x] Present changed files, test results and concrete remaining external gates. No deployment or DB apply.
