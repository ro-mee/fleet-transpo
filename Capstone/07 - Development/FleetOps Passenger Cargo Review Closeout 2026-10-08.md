# Passenger/cargo review closeout — 2026-10-08

This is the behavioral re-review of every P0/P1 in [[FleetOps Passenger Cargo Tasks 1-13 Code Review 2026-10-07]]. The October 7 report remains the historical verdict for `d56b5f9`; this note records the corrected branch after merging main `efbcd190`. The merge presented 17 conflicted files, all resolved while retaining the mechanic workshop, supply migrations 144–149, and defense implementation.

**Re-review verdict: enumerated P0/P1 code defects closed, with the acceptance deferrals below explicitly retained.** This is not a deployment or official-provider activation approval.

## Evidence scope

The database tests run actual application SQL against PostgreSQL rows isolated from operational data. Cargo/report/migration fixtures use temporary tables in transactions and roll back. Fuel uses a randomly named private fixture schema, copies column types without production defaults/triggers/sequences, verifies the namespace before each query, and removes that schema afterward. Database settings are transaction-local. These tests prove service/route/SQL behavior; live production constraints, grants and RLS are verified separately by the catalog gates. Authentication and external route-provider boundaries are controlled fixtures, not real driver login or provider acceptance.

An early fuel harness mistakenly used session-level search paths. It was corrected to `BEGIN` plus `SET LOCAL`; the affected pooled session paths were reset. A fresh connection again resolved the normal public request table, including 45 preserved null-classified legacy requests. No operational request, trip, price or vehicle was inserted by the proof harnesses. Final cleanup and concurrent-capture results are recorded below.

## Every P0/P1 re-reviewed

| Original finding | Behavioral evidence | Result |
|---|---|---|
| P0 T4: readiness absent from final gate | `passenger-cargo-db.integration.test.js` inserts a real Pending commissioning vehicle with no verified OR/CR/insurance. The real shared final gate rejects it; Ready with missing documents also fails. Complete verified evidence admits the same stored 650 kg cargo request. | Closed |
| P0 T9: equal/backward arrivals | `src/app/api/dispatch/window.test.js` exercises real final-gate logic for create/update, rejecting equal/backward before persistence. Deficient explicit windows return 409 with no INSERT/UPDATE; the PostgreSQL gate also rejects short/equal plans. | Closed |
| P1 T5: valid cargo fails request evidence | The PostgreSQL readiness test uses a persisted typed cargo row with null passengers, actual 650 kg weight, real evidence generation, verified documents and a real isolated assignment commit. No recommendation-service mock supplies success. | Closed |
| P1 T5/T7: historical starts regress | The PostgreSQL legacy test starts a preserved null-classified request on a legacy Pending vehicle without typed document evidence through the actual start route. Typed safety remains enforced for typed requests. | Closed |
| P1 T2: migration rerun rejects cargo | `typed-migration-db.integration.test.js` reconstructs the pre-T2 temporary catalog, executes the exact 151 body with only its namespace rebound, inserts valid cargo, then reruns it. Historical rows retain null classification and cargo remains valid. Live migration application used only the approved runner. | Closed |
| P1 T5: four endpoint messages differ | Actual assignment PUT, dispatch POST, dispatch PUT and trip-start PUT all return exactly `Vehicle REV5678 cargo capacity 1000 kg, request needs 1800 kg (over by 800 kg).` against the same stored overweight row. Supplied weight 1 cannot override stored 1800. | Closed |
| P1 T9: drive-only occupancy | Shared schedule/gate/endpoint tests derive 150 minutes from 60 minutes driving plus 90 minutes handling. Explicit shorter plans are rejected; accepted stored windows match overlap evidence. | Closed |
| P1 T7: incomplete cohort admission | Readiness inventory tests omit asset code, license class and category independently and reject cohort admission for each. No production vehicle was automatically admitted. | Closed in code; real cohort acceptance deferred |
| P1 T10/T11: real manual price wiring | `postgres-closeout.test.js` calls manual configuration/price routes, checks the server-owned verifier, then the actual completion route/repository. Persisted completion has non-null snapshot 44, actual 36 km, efficiency 9 km/L, price PHP 62.70/L, 4 L and PHP 250.80; audit events are checked. | Closed |
| P1 T11: planned distance overwrites GPS | The PostgreSQL completion test inserts realistic timestamped GPS points. Completion records GPS distance between 11 and 12 km with `gps-trail` provenance while retaining the separate 32 km plan. Offline tests also preserve unavailable actual distance rather than substituting the plan. | Closed |
| P1 T11: concurrent completions mix snapshots | Two independent PostgreSQL transactions complete the same isolated trip. The test checks actual backend IDs and `pg_blocking_pids`, then requires both results to retain the complete first snapshot and capture timestamp. The enabled fuel suite passed all three cases. | Closed |
| P1 T10: Historical intervals excluded | Real policy tests resolve a verified Historical snapshot inside its former interval and reject outside/unverified intervals. Manual repository rows flow through the same lookup in the PostgreSQL completion test. | Closed |
| P1 T10: timestamps lack timezone | Actual manual route persists `2020-01-01T00:00:00+08:00` as its UTC instant; real-row report/export tests compare decoded effectivity timestamps to that instant. Validation tests reject offset-free/impossible dates and confirm equivalent Z/+08 inputs. | Closed |
| P1 T13: screen/list/export parity | `trip-report-db.integration.test.js` inserts all five canonical service request/trip rows and calls real JSON/list/Excel routes, selectors and workbook builder. It decodes the real 28-column XLSX buffer and compares IDs, service, price basis and effectivity; the separate Fleet workbook verifies declared weight/capacity utilization. Unknown service is rejected; unknown cargo capacity is omitted from utilization. Independent `SUPPLY_DELIVERY` remains excluded from request-backed Fleet activity. Actual wrapper/render tests cover screen filter forwarding and cargo Home copy. | Data path closed; browser/device acceptance deferred |

## Workbook mutation and other review findings

The October 7 experiment was repeated against the strengthened test: temporarily blanking the real workbook Service cell now fails the decoded-workbook assertion. The workbook source was restored and the suite rerun successfully. The test no longer substitutes a workbook builder or report selector.

Recommendation wording is limited to verified eligible safety bands. Readiness admission includes every static evidence gap. Driver cargo actions/status copy use shared load labels. Manual/automatic price reads require real provenance. Provider HTTP tests require redirect refusal and validate current-history/relative-change/duplicate handling. Automatic publication remains disabled: a permitted real source, redirect behavior against that source, persistence/effectivity activation and stale-warning operations have not received live acceptance.

## Database gates and migration artifact

The authorized runner applied pending 150–155 in filename order, each transaction recorded in the ledger. `db:dump` regenerated `schema.sql`: 76 tables, one view, 148 foreign keys, 187 standalone indexes, 21 functions and 30 triggers. Applied migration files were not edited. The dump is committed with the merge; its function-body whitespace is generated, not hand-normalized.

- `db:check`: 155 valid files; historical duplicate filename set unchanged.
- `db:status`: 155 applied, zero pending, zero changed. Three old renumbered ledger names remain reported; they are historical keys, not pending or changed migrations.
- `db:contract`: all 77 relations classified, including the existing view; zero violations, absent code relations or unclassified relations. `fuel_price_snapshots` is registered as applied/private.
- `verify:anon`: zero exposed, 29 explicit refusals, 48 inconclusive empty responses, zero unreachable. Its exit 1 is preserved. The paired live contract resolves all 48 through RLS enabled and no anon policy; empty HTTP results are never relabeled PASS.
- Fuel snapshot catalog: RLS enabled, zero policies, anon/authenticated TRUNCATE privileges false. The trips snapshot foreign key exists and is validated. The new table returned explicit HTTP 401/42501 refusal.

## Full regression after main resolution

After resolving main, `npm run lint:ci` passed with zero warnings; `npm run test:run` passed 381 files / 4,237 tests, with four opt-in database files / 16 tests skipped in the ordinary offline run. `npm run build` completed successfully with the actual configured environment, including mechanic and supply pages. `npm run verify:auth` passed all 315 exported methods. The final combined opt-in database run passed all four files / 16 tests in 53.64 seconds, including genuine row-lock concurrency. A fresh post-run catalog query confirmed zero remaining `fleetops_review_%` schemas and the default public search path; 45 legacy null-classified requests remain unchanged in count.

Main preservation checks include a working production build of all mechanic pages, actual maintenance query callbacks, unchanged supply migration SQL 144–149, and defense asset hashes. The 63 SVG files have canonical LF handling enforced in `.gitattributes`; their manifest and meaning are unchanged. No defense seed or customer-facing deployment was run.

## Documented acceptance deferrals

Real browser download/screen rendering, native driver device acceptance, legitimate fleet commissioning/cohort admission, and a full operational isolated-demo walkthrough remain acceptance work. Row-backed selectors/workbooks and actual component tests do not claim those manual checks. Task 1 remains a bounded create/replay integration: updates, cancellations and durable source revision lifecycle are outside this closure. Provider publication stays disabled pending the live-source acceptance above. These deferrals do not leave the enumerated P0/P1 code defects silently open.
