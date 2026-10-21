# Cargo UI and backend readiness review

Date: 2026-10-14. Scope: current Cargo mobile presentation/actions, execution/intake/feedback/physical-policy runtime and read-only migration/catalog status. Analysis only; no app code, settings, operating records or providers changed. Assumed use: multiple drivers and Fleet/source staff, with network interruptions and concurrent status changes. This is not a production penetration/load test.

## Verdict

### Current assessment follow-up - 2026-10-20

The signature capture, private saved-signature review on mobile/web and Dispatch connection are now implemented, with hidden-by-default disclosure. The remaining priority is real operating integration: approved manifest/execution/evidence providers, actual source/Fleet/receiving authority and exceptional custody handling, real fleet/physical-policy commissioning, partner feedback/recovery and authenticated phone/web pilot acceptance. Current source still deliberately refuses production cargo operation with503; this is not a missing-table-only problem or a feature-toggle activation. Fresh API/lifecycle/state checks passed89tests across3files. No live activation or setting change. See [[Cargo Remaining Work 2026-10-20]] for the current prioritized assessment; historical findings and verification below retain their original dates.

### Implemented safety follow-up (2026-10-14)

The historical findings below describe the analysis before implementation. Findings 1, 2 and 4 are now addressed in code and offline regression. The user explicitly chose: "Keep live integration disabled for now; finish the safety fixes and plan." Findings 3, 5, 6 and 7 remain deferred release gates, not completed operations.

- Server lifecycle guards classify the saved trip/dispatch/request, including proposed dispatch linkage. Typed Cargo and SUPPLY_DELIVERY refuse503 before writes when approved providers are unavailable, regardless of the old OFF/ENFORCE setting. Missing/ambiguous source authority refuses409. Passenger and permitted untyped Passenger remain usable. Generic edits, start, movement, completion, cancellation, reassignment and dispatch/request cascades cross the same boundary. Request cancellation rechecks stored type in its write transaction; resource reconciliation and Booking notification follow commit.
- Cargo Home now forwards movement to Map and terminal completion to the existing actual-odometer form after existing account/profile/offline/compatibility gates. It cannot use Home's Passenger status writer or cached-mileage modal for Cargo. Shared components and Passenger presentation/actions remain intact.
- Cargo Map uses shared `readinessFor` for its label, disabled state and handler, including confirmed duty/Pre-Shift, Pre-Trip and start timing. The handler rechecks the current time before accept/start. Passenger's documented missing-timing exception remains explicit; fresh source/Fleet/receiver checks and tracking until confirmed completion remain.

Independent review caught and repaired source-lock cycles and an unprotected legacy driver/vehicle classification read. Runtime preparation takes drivers/vehicles SHARE ROW EXCLUSIVE before row locks once per transaction. This deliberately serializes guarded lifecycle and competing master writes, following the existing small-fleet pattern; measure contention before wider rollout. Bound nonproduction fixture ordering and current-proof checks remain. Live-write concurrency acceptance was not performed.

Verification: combined 1,270 tests / 109 files passed; strict touched lint, route-auth334/334, UTF-8 and whitespace passed. Android Hermes export passed (1,457 modules / 5.68 MB / 82 assets). Final classifier SQL passed three read-only EXPLAIN checks. Fresh db:status163 applied/0 pending/0 changed; db:contract88 relations/0 violations. Independent review passed with166 tests/15 suites; optional DB suites36 tests skipped. No migration, operating-data write, provider activation, commit or deployment. Native/iOS/web/real-pilot and production provider acceptance remain unverified. See `docs/superpowers/plans/2026-10-14-cargo-readiness-hardening.md` for completed Tasks1–3 and deferred Tasks4–7.

Cargo presentation is improved, but a complete live cargo workflow is not ready. Database migration backlog is not the present blocker. Fix the cross-entry-point authority gaps first, then connect approved production providers and validate a real staged pilot. Do not solve this by disabling holds or using the simulated service in production.

## Prioritized findings

### 1. Required before live Cargo: per-trip server authority enforcement

`src/services/cargo-execution.service.js:18–29` returns no Cargo checkpoint while `CARGO_LIFECYCLE_MODE` is OFF (the code default). `transition.service.js:125–133` and `trip-lifecycle.service.js:45` consume this optional boundary. Therefore ordinary authorized status/completion endpoints are not guaranteed to require source acceptance, securement or receiver authority in OFF mode. This is an explicit staged-mode behavior, not a verified deployed exploit. It becomes an operational gap if typed Cargo jobs are admitted while the UI is described as clearance-enforced.

Required correction: re-read persisted trip/request type and enforce Cargo authority server-side for the applicable transitions, refusing unavailable authority without disabling Passenger/legacy traffic. A client hold is not protection for another client or a direct endpoint call. Merely setting ENFORCE is not a solution: the current unconfigured/production path throws before a trip-specific evaluation and can obstruct unrelated shared transitions. Test typed Cargo and Passenger through every generic/mobile status, completion, cancellation and reassignment endpoint.

### 2. Required: Home must use the same Cargo actions/completion path

`mobile/app/(app)/(tabs)/index.js:357–465` maintains independent status and odometer handlers. `doAction` sends onboard after workspace/session checks, without `resolveCargoMapGate`. Completion uses its own cached-mileage modal and direct PUT, instead of the shared fresh-authority/proximity/manual-completion screen. Map and `trip/complete.js` perform the stronger checks. A Cargo driver can therefore receive different clearance/recovery behavior depending on the entry screen.

Read-only executable proofs extracted the real callbacks and substituted only API/device boundaries: a compatible Cargo trip at At Pickup sent `/api/trips/7/onboard` without an execution provider; a Cargo Drop-off trip sent `/api/trips/7/complete` with `{end_odometer:100001}` without receiver verification. No network request or operating write was made by these proofs. Server ownership/geofence/mileage checks still apply, but finding 1 means Cargo authority is not universally guaranteed by the default server mode.

Required correction: route Home to the existing Map/cargo verification and canonical completion form, or reuse the same guarded action logic. Remove the parallel completion flow rather than designing another Cargo component. Tests must cover Home and direct API entry points, not only Map.

### 3. Production workflow providers remain unimplemented/uninstalled

Manifest intake POST returns fixed 503 (`src/app/api/integration/cargo/manifests/route.js:5`). Execution read/receipt/decision/clearance/manual/evidence exports are disabled (`cargo-execution.service.js:36–41`); the factory explicitly permits simulated nonproduction configuration only. The staff simulator refuses a Cargo submit (`src/lib/cargo/cargo-draft.js:64`). Private photo storage is also fixture-only. Tables and screens existing do not make intake or receipt operations available.

Needed: approved production source mapping, authenticated versioned manifest intake, execution provider, Fleet securement authority, receiving authority and private evidence/access/retention policy. Use the existing immutable/versioned/replay-safe contracts; no third manifest/receipt store or fake approval. Keep the source business decision, Fleet safety decision, receiver confirmation, trip completion and inventory closure separate. These need external owner approval, not just a UI setting.

### 4. Map's action still disagrees with its readiness summary

`map.js:2063` treats absent earliest_start as an open window. Its Cargo summary says timing is not supplied (`:2070`), but the swipe title/disabled rules (`:2375–2379`) can still offer START ROUTE once Pre-Trip passes. Trip Details uses `readinessFor` and requires known timing. The summary correction did not unify action eligibility.

Needed: use the same readiness result for label, enabled state and handler. Preserve any intentional Passenger/legacy exception explicitly. Otherwise the driver sees an unconfirmed start message beside an enabled start control.

### 5. Physical capacity enforcement still needs an approved rollout

`src/lib/cargo/physical-policy.js:7` defaults to OFF; `cargo-physical.service.js:25` bypasses physical evaluation in that mode. In SHADOW, findings are advisory. Profile-derived payload, dimensions/openings, volume, handling and temperature support exists, but displaying a profile or passing the older kg check does not establish physical enforcement.

Needed: approved standards/source/mass references, real measured vehicle profiles, package evidence and a staged OFF/SHADOW/ENFORCE rollout, with transaction-time rechecks. Unknown mandatory evidence must block the enforced cohort. Live policy values and actual fleet measurements were not queried in this review, so no claim is made that the checked deployment currently uses OFF.

### 6. Partner feedback and staff recovery are not operational yet

`getCargoGateway` refuses real sends without configured providers. `listCargoFeedback` and `retryCargoFeedback` are fixed 503 (`cargo-feedback.service.js:142–143`). The durable outbox/lease/retry machinery exists, but no live acknowledgement, failed-event review or staff retry workflow is proven.

Needed: authenticated partner transport, scheduled worker, monitored failures, source-scoped staff retry/reconciliation and approved manual handoff. Receipt acknowledgement must never be displayed as quantity approval or stock posting. Do not point the existing worker at a simulated gateway for production.

### 7. Native UI acceptance remains a release gate

No device/emulator captures establish the reference layouts on a real phone. Test 360/375dp, largest text, both themes, landscape, keyboard/safe area, screen readers, slow/offline/reconnect and account changes. Walk through clean pickup, 10 expected/9 observed, WAIT then recount, rejection, partial delivery, receiver hold, completion and next assignment. Build/render tests are not phone acceptance.

Further polish after correctness: show existing source/Fleet/receiver blocker summaries beside the Map action before the driver attempts it; retain refresh and verification recovery. Real intake draft persistence needs a scoped/retention-approved design; do not confuse unsaved staff simulator input with the already persistent mobile observation drafts. Real post-shift metrics and delivery timelines should use saved events, never the sample image numbers. Photos/signatures/scanning are not automatic requirements while their policy/contracts are absent.

## Verification and current database status

- Fresh existing boundary regression: 6 files / 86 tests passed, covering lifecycle OFF/unconfigured ENFORCE behavior, cargo API restrictions, disabled runtime and mobile gate behavior. These tests do not prove production operation.
- Fresh `npm run db:status`: 163 on-disk migrations applied, 0 pending, 0 changed; ledger-only historical keys 113/114/115 remain. Older notes reporting 161 and missing 162/163 are historical.
- Fresh `npm run db:contract`: 88 classified/live relations (87 tables and 1 view), no missing/unclassified relations and 0 contract violations. Catalog checks do not prove source providers, live policy values, receiving authority or the actual anon HTTP probe; `verify:anon` was not rerun here.
- No migration apply/dump, source activation, partner call, public operating-row write, code fix, new full-suite/build or deployment. Native/end-to-end partner, real fleet readiness and deployed environment flags remain unverified.

Recommended order: 1–2 authority/entry consistency, 4 action-readiness alignment, approved providers/physical rollout/feedback (3, 5, 6), then native and real pilot acceptance (7). Keep existing safety holds until those authorities are available.

Related: [[Mobile Architecture]] · [[Trips]] · [[Live Map Radar]] · [[FleetOps Cargo Rollout Runbook]] · [[Supply Chain Consolidation Implementation 2026-10-13]] · [[UI UX Audit - Mobile]].
