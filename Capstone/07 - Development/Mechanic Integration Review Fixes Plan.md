# Mechanic integration review fixes — 2026-10-08

The user approved fixing the review findings and all six proposed improvements. Continue on the existing `feat/mechanic-integration` working tree, preserving the uncommitted implementation. Do not commit, publish, migrate, or create operational work orders during verification.

## Design and constraints

Keep incident automation, mechanic ownership checks, transition rules, cost restrictions, and predictive formulas intact. Use the existing permission matrix, notification copy and deduplication. No dependencies, tables, views or migrations are needed.

Staff assignment controls must work on both maintenance surfaces, show loading/error/retry and empty-directory states, preserve unchanged assignments and explicitly clear changed assignments. Creation notifies the assignee through the same fan-out used by edits.

Fuel reporting checks the latest open marked diagnostic for each visible vehicle before allowing a filing. Show its work-order number; creating another requires an explicit user choice. Query errors block filing until retry. Notifications open the staff maintenance register and retain work-order identity for deduplication.

Upcoming maintenance distinguishes loading and request failure from a successful empty result, including when the mechanic has no actionable jobs. Tomorrow dating uses the Manila operational calendar; status/availability verification exercises production behavior at midnight and month/year boundaries.

## Implementation sequence

- [x] Backend: write failing route/notification/date regressions; remove retired role, reuse notification fan-out on creation, correct fuel notification destination, add staff-only lean open-diagnostic lookup for up to ten vehicle IDs. Verify route permissions and positive integer bounds.
- [x] Assignment UI: test the real form control and submit lifecycle; repair Radix wiring; show directory loading/error/retry/empty states in both staff surfaces.
- [x] Reports and workshop UI: write failing page/component regressions for existing diagnostic confirmation and unavailable predictive data; implement the query and explicit repeat-filing choice.
- [x] Verification: run focused tests, real status/availability checks, role/security gate, lint, full suite and production build; review final diff and record actual limitations.
- [x] Documentation: sync Maintenance, Fuel, Notifications, System Overview and SYSTEM.md with verified behavior and evidence.

## Test contracts

Assignments: selecting 77 sends numeric 77; reopened assigned order shows 77; unchanged save omits assignment; selecting 78 sends 78; Unassigned sends null. Mechanic sees no assignment control. Directory failure must not silently clear an existing assignment.

Fuel: an open diagnostic 44 for vehicle 12 is shown before filing; no POST runs until the user explicitly chooses another; Completed/Cancelled/deleted/unmarked records are excluded; failed lookup disables creation. Stored and push notification references resolve to the maintenance register, never vehicle 44.

Upcoming: real page renders loading/unavailable/empty/populated states, retains <=14-day filtering, and does not claim no maintenance after a failed request.

Dispatch: use the production diagnostic builder and vehicle-status synchronization with isolated data doubles (no operational writes); independently assert literal calendar dates and resulting Available/Under Maintenance states before/on the due day. Exercise actual availability SQL against an isolated PostgreSQL fixture if existing harness supports it; clearly record if live-backed verification is unavailable.

## Completed verification

- Test-first regressions demonstrated the broken native-option/Radix wiring, missing report confirmation/failure states, missing workshop predictive feedback and host-timezone date comparison before fixes. Assignment tests call actual form event handlers and the real service, checking create/reopen/unchanged edit/reassign/clear payloads. Permission tests assert guard arguments and the actual permission matrix, not only a mocked denial.
- Final uncached full suite: 403 files passed, five skipped; 4,482 tests passed, 17 skipped. No failures.
- `npm run lint:ci`: passed after removing the disposable synthetic browser harness. `npm run verify:auth`: 318 guarded methods. `npm run db:check`: 155 valid migration files. `git diff --check`: passed.
- With `TZ=UTC` and `FLEETOPS_REVIEW_DB_TEST=1`, diagnostic builder/status/actual availability SQL: three files, 14 tests passed. PostgreSQL uses connection-local temporary tables inside a transaction that is rolled back; live column types are copied, not operational rows. Auth/coding gates and the clock boundary are isolated; no production triggers/RLS/full dispatch claim.
- Production build passed using the supported `next build --webpack` fallback. Normal Turbopack build failed with a Windows existing-junction error under `.next/node_modules/pg-*`; no project configuration was changed to bypass it. Webpack reported the existing dynamic-dependency warning from `src/lib/auth/geoip.js`.
- Browser verified the real shared Radix control with synthetic data: select another mechanic, clear, disabled loading, disabled error and retry recovery, with no console errors. At that automated-review stage the signed-in walkthrough was unverified because the existing session expired, and no operational work order was filed. The later signed-in smoke test below created two explicitly identified test records.
- Final review preserved automatic incident filing, assignee scopes, mechanic transition/field restrictions, lean projections and the predictive formula. No dependency, migration, table, view or RLS change; no deployment or commit.

Maintenance, Fuel, Notifications, System Overview and SYSTEM.md now document the corrected behavior and these limits.

## Manual acceptance checklist supplied to the user

Use a desktop and a disposable test vehicle/work order. Start the local app with `npm run dev` if needed, sign in again, and keep staff and mechanic accounts in separate browser profiles. Staff needs Admin/Super Admin/Fleet Manager; two active mechanic accounts allow reassignment testing.

1. Staff `/maintenance`: Add Maintenance Record, choose Inspection/Scheduled/Normal, tomorrow, zero cost and mechanic A. Create; reopen and confirm A. Change another field and save; assignment stays A. Reassign B and reopen; clear with Unassigned and reopen. Repeat assignment on `/fleet/maintenance`.
2. Check A's assignment notification after creation and B's after reassignment. Mechanic taps must open the work order. Use a separate High/Emergency test order to check urgent assignee/staff alerts; staff taps open `/maintenance`.
3. Assign the test order to A again. Mechanic A sees it in `/mechanic`; B cannot open the unassigned-to-B record. Start transitions to In Progress; save evidence and Mark Ready transitions to Pending Inspection. No mechanic completion, self-assignment, cost/vehicle/priority editing. Staff reviews completion through the existing process.
4. Assigned order detail: verify Vehicle history sections and display-only Incident/Inspection chips on records that actually have those sources. Do not add fake source IDs. An unassigned vehicle's history request and `/api/mechanics` must be refused for mechanic accounts.
5. Coming up uses existing predictive data for assigned vehicles within 14 days, excluding unscheduled rows. With no eligible data it is empty; with zero actionable jobs it still remains visible. This is not the manually entered work-order date.
6. Staff `/reports`, Fuel consumption & estimated efficiency, choose a date range with a Below-baseline row. File once, verify Inspection/Normal/Scheduled/cost zero/tomorrow in Manila, then reload the report. Open diagnostic number appears; Create another diagnostic only asks for confirmation; Keep existing does not create; Confirm another deliberately creates a separate order. Reload alone never files. Its notification opens `/maintenance`.
7. An otherwise eligible vehicle stays available today after that future diagnostic. Due-day grounding applies tomorrow. Existing incidents/other maintenance/coding and driver eligibility can independently prevent dispatch. Use automated midnight tests rather than changing the computer/server clock.
8. Optional browser error checks: DevTools Request blocking for `*/api/mechanics*`, `*/api/vehicle-maintenance/fuel-diagnostics*`, or `*/api/ai/predictive-maintenance*`, one at a time, then reload. Directory error disables selection and preserves the assignee; lookup error blocks filing; predictive error says unavailable. Remove the block and retry/reload. Network throttling on a reload reveals loading states. Restore normal settings afterward.
9. Empty mechanic directory and notification infrastructure failure are covered by automated tests; use an isolated test environment to simulate them manually. Do not disable real accounts or break notification services to test these cases.

### Completed signed-in local smoke test — 2026-10-08

Verified with separate Admin and Mechanic sign-ins: created and assigned work order #83 from `/maintenance`; the mechanic saw the assignment notification, opened the assigned order, saved explicitly test-only diagnosis text, and moved it Scheduled → In Progress → Pending Inspection. The order detail showed Vehicle History, and an attempt to open unassigned diagnostic #84 as the mechanic returned the fail-closed Not Found state. The staff `/fleet/maintenance` assignment picker also populated and accepted a mechanic selection; that second form was cancelled without creating a record. The main register displayed Incident #117.

The mechanic dashboard showed a successful empty Upcoming state. On `/reports`, the monthly range had no eligible estimate, so the quarter range was used. Filing from an eligible Below-baseline row created diagnostic #84 (DMM-4201, Inspection/Normal, zero cost, scheduled 2026-10-09); reload showed the open diagnostic, and **Keep existing** from the repeat-filing prompt left it as the only open diagnostic. The relevant assignment, inspection-ready and fuel-diagnostic in-app notifications appeared, and the staff inspection-ready notification opened `/maintenance`.

The local run left two clearly identified test records in place: #83 (DMM-4211, Pending Inspection, test-only diagnosis) and #84 (DMM-4201, Scheduled fuel diagnostic). Cancel or clean them up before operational use. The app was signed out at the end. This manual run did not cover a second mechanic account, direct `/api/mechanics` denial (the browser blocked the URL), request-blocking recovery states, high-priority alert creation, or real availability for DMM-4201, which was already under maintenance.

The run caught a real edit-date bug: PostgreSQL's local-midnight `DATE` value serialized to UTC, so October 9 reached the form as `2026-10-08T16:00Z` and prefilled October 8. `GET /api/vehicle-maintenance` now normalizes `maintenance_date` and `completed_date` to calendar strings before responding. A route regression reproduced the old response first; after the fix the route suite passes 16/16. The full suite has not been rerun since this correction. The earlier checklist above remains useful for the untested cases. Full automation is available with `npm run test:run`; focused date/status checks use `npx vitest run src/lib/fuel/diagnostic.test.js src/services/status.fuel-diagnostic.test.js`.
