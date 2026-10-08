# FleetOps passenger/cargo review corrections

Prepared on `feat/passenger-cargo` in `.worktrees/feat-passenger-cargo`, following the 2026-10-07 Tasks 1–13 review and the user's instruction to fix its findings. The dirty root/main checkout was preserved. No live database, migration apply/dump, source activation, seed execution, merge or deployment occurred. Generated `schema.sql` remains unchanged.

**Later 2026-10-08 closeout supersedes this preparation checkpoint:** main is integrated, 150–155 were applied through the approved runner, the generated dump and applied classifications were refreshed, and every P0/P1 received row-backed behavioral re-review. Full regression passed, including production build and the separate 16-test PostgreSQL suite. See [[FleetOps Passenger Cargo Review Closeout 2026-10-08]] for the current verdict and remaining acceptance deferrals. The earlier offline counts and holds below describe the earlier checkpoint only.

## Corrections and evidence

| Review area | Correction | Regression evidence |
|---|---|---|
| T4 runtime road readiness | Shared final validation, strict conflict evidence and typed availability use server-derived document, maintenance and incident evidence. Asset/class/category/capacity and commissioning are required. Document rows enter revision hashes and commit locks. | Real evidence/gate fixtures, query-projection assertions, missing/expired/changed evidence and overdue maintenance cases. |
| T4 attestation and rollout | Pending assets can be entered without an invented plate. Admin/super_admin confirms exact saved scans/numbers through an audited locked commissioning API and form. Changed document metadata invalidates old verification. | Actual commissioning API and form tests, authorization/atomic audit and document-change cases. |
| T2/T5/T7 historical boundary | Draft 151 leaves old `load_type` null with no default. Typed cargo with null passenger count survives rerun preflight; historical starts retain their prior path. Cohorts require every declared static evidence field and active pairing. | Migration structure checks, null-load start, missing cohort-field and unsupported capacity/class cases. Live SQL/rerun remains held. |
| T5 cargo evidence and blockers | Request evidence branches by declared load. Stored weight overrides stale caller fields; review overrides never clear overload. Dispatch create/edit return the same shared sentence as assignment/start. | Complete cargo through real engine evidence and exact endpoint blocker assertions. |
| T6 measured ranking | CAPACITY_FIT only breaks ties between fully verified safe options. Missing or blocked evidence cannot generate a false all-clear explanation. | Unsafe equal-band and verified capacity-fit ranking tests. |
| T9 full service window | The final closeout rejects short explicit plans. Missing arrivals derive driving plus named loading/securement/unloading/turnaround buffers. Unknown driving, invalid/blank buffers and missing pickup produce no window. New equal/backward arrivals return 400. Both dispatch writes and overlap checks use the accepted end. | Red-to-green pure schedule, radar, real POST/PUT boundary/persistence and PostgreSQL regressions. Passenger fallback preserved. |
| Renewed-document integration | Typed requests use verified documents rather than stale legacy vehicle expiry fields/status labels. Assignment, recommendations, availability, create/edit and start agree; historical row checks remain. | Renewed-doc/stale-row cases plus unchanged legacy expiry rejection. |
| T8 cargo presentation | Home, map, detail and history use shared load-aware actions/status labels; cargo has no guest-call action or invented passenger count. | Actual Home JSX rendering, helper parity and screen wiring assertions. Native/device acceptance remains held. |
| T10 verified price workflow | Added server repository, permission-gated manual API/review screen and estimate-region setting. Server supplies verifier identity. Historical intervals work; timestamps require real dates and explicit offsets; method-specific provenance and scalar prices are validated. | Real repository, API permissions, rendered review page, effectivity/history/invalid-provenance and timestamp tests. |
| T11 complete immutable basis | Real completion resolves repository prices under a locked trip transition. It captures efficiency, planned/actual distance, price identity/region and unavailable reason as one basis. Plan never substitutes for actual; rounded liters drive exact decimal cost. | Real route→service→repository tests, GPS/plan divergence, null basis, concurrent retries and half-cent arithmetic. |
| T12 automatic safety | Default remains disabled. Approved configuration, authenticated cron, transport-origin validation, stored history, duplicates and atomic effectivity publication precede automatic writes. | Real authenticated cron and repository adapters plus redirect-spoof, relative-change, repeat and effectivity tests. No provider call performed. |
| T13 actual parity | Shared service/status/search filters reach visible Trips, list/JSON reports, CSV and Excel. Planned/actual estimates and source details are projected; cargo utilization is shown/exported and unknown capacity omitted. | Real report endpoints, page rendering and decoded ExcelJS cells, including service and 65% cargo utilization. |
| Migration/contract integrity | Drafts 153–155 check actual scoped object shapes and provenance. Only the exact reviewed 154 table has a separate pending private classification. Live contract still demands its presence and protection. | Offline catalog-shape assertions and schema contract gate; no hidden SQL or hand-edited generated dump. |
| Demo preparation | Explicit supplied typed intake fixtures have a transaction-scoped exact-ID ledger and local disposable-DB guard. Fleet identities/odometer/compliance/prices are untouched; used requests refuse automatic removal. | Five offline tests of the actual helper; no seed run or full demo acceptance claim. |

The independent final review also identified starting-odometer authority and stale automatic announcement comparisons. Completion now uses the locked saved start, with strictly validated legacy fallback and a real end reading; booleans/objects cannot fabricate distance. Automatic publication compares the latest verified announcement, including Pending, while explicit manual historical backfill retains its predecessor semantics. All four new failure cases were demonstrated before correction.

## Verification

Final whole-suite run after the last odometer/provider corrections: **346 files / 3,987 tests passed**, 49.32 seconds. An intermediate run passed 3,982 before those extra regressions. The first broad run caught an incomplete in-progress UI module and an old Manual-price fixture missing its required verifier; both were corrected without weakening assertions. The original mocked-only workbook gap is now covered by decoding the real generated file.

- Strict repository-wide ESLint (`--max-warnings 0`): **passed**.
- Offline migration filename/version gate: **146 files valid**; no database connection.
- Route authentication audit: **300/300 exported methods guarded**.
- Diff whitespace check: passed (line-ending notices only).
- Production build, browser/native-device, PostgreSQL apply/rerun, live security/catalog and demo execution: **not performed**, preserving the documented external holds.

## Release boundaries

All migrations 150–155 remain prepared and unapplied. The expanded inventory in [[FleetOps Passenger Cargo Integration and Fuel Implementation Plan]] covers every new schema read/write, including **all shared passenger trip reads** that now join snapshot provenance or name estimate columns from 154/155. Schema-pending errors are not proof of rollout readiness.

Still required before release: Hotel/POS code and migration reconciliation, authorized fresh migration status/apply/dump, live RLS/grants/anon/FK/index/check/real-query verification, a production build with legitimate configuration, browser/device commissioning and driver acceptance, and reversible isolated-database demo acceptance. An official automatic source and its stale-warning policy need evidence; automatic publication stays disabled. No fabricated build configuration or market-validity horizon was introduced.

Task 1 remains the bounded create-only slice. Revision/cancellation protocol work and full partner/live acceptance remain separate scope. Task 14 is the docs-only acceptance-note task and is outside this correction request.
