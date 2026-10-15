# Cargo readiness hardening implementation plan

**Goal:** close the reviewed server/mobile action gaps without inventing operational authority or changing Passenger presentation.

**Architecture:** persisted trip/request data selects Cargo server enforcement; no posted load type or UI gate grants authority. Home forwards Cargo workflow actions to the existing guarded Map/verification and completion screens. Map uses one shared readiness result for Cargo labels, enabled state and handler. Existing immutable manifests, receipt/event IDs, source ownership, clearance and receiver proofs remain the integration foundations.

**Stack:** installed Next.js Route Handlers/PostgreSQL services; Expo 54/React Native 0.81 shared mobile app; Vitest.

## Constraints and execution

User scope confirmation: "Keep live integration disabled for now; finish the safety fixes and plan." Tasks 1–3 are this execution's deliverable; Tasks 4–7 are explicitly deferred release work. No live provider installation, policy activation or operating-data write is authorized.

- Preserve all existing uncommitted work; use disjoint backend/mobile ownership in the current checkout. Do not reset, stage, commit, push or deploy.
- Read `.agents/AGENTS.md`, the relevant vault notes and installed Next route-handler guide before edits. UTF-8 edits through apply_patch only.
- Test first: demonstrate each reported missing check, implement the smallest shared correction, run affected regression and independent review.
- No live operating-row write, migration, policy change, partner request, fake proof, fabricated photo or new dependency is needed for Tasks 1–3.
- Unavailable authority blocks typed Cargo; Passenger and permitted legacy Passenger behavior remain usable. Existing ownership, permissions, inspection, geofence, mileage, tracking and audit contracts remain.

## Task 1 — server Cargo authority (backend owner)

Files: `src/services/cargo-execution.service.js`, its shared transition/completion/cancellation/dispatch callers, generic trip-edit route, and focused route/service regressions. Inspect every `prepareCargoLifecycle`, `cargoLifecycleEnabled`, `assertCargoCheckpoint` caller before changing signatures.

- [x] Write failing tests: compatible persisted Cargo cannot load/depart/complete/reassign/cancel around custody when providers are absent, even in default OFF; client load-type fields cannot bypass. Passenger and historical untyped Passenger are not blocked by a global ENFORCE value.
- [x] Resolve Cargo from the persisted trip/dispatch/request linkage using existing query/contracts, inside the applicable transaction; never infer from request bodies or merely the posted trip object. Refuse missing/ambiguous authority rather than falling back to Passenger.
- [x] Keep nonproduction transaction-bound execution fixtures valid. Separate provider preparation/lock order from per-trip decision so an unconfigured global flag cannot reject unrelated Passenger work before its type is known.
- [x] Make all generic/mobile transition, completion, reassignment and cancellation entry points use the shared per-trip check, including staff trip edits and dispatch/request cascades. Preserve table-before-row ordering and do not weaken post-receipt custody holds.
- [x] Test exact no-write refusal and unchanged Passenger result; malformed IDs/linkage, client-supplied status/type, current source/receiver authority, stale state and replay retain their protections. Lock-order regression and review passed; live concurrent-write acceptance remains deferred.
- [x] Run Cargo lifecycle/API and Passenger route/service regressions plus strict touched lint. Report changed paths, red/green evidence and remaining provider limitations.

## Task 2 — one Cargo mobile action/completion flow (mobile owner)

Files: `mobile/app/(app)/(tabs)/index.js`, `map.js`, existing readiness/action helpers and render/interaction tests. No changes to native tokens/components, API/storage/session contracts or backend files.

- [x] Add failing actual Home handler tests: Cargo At Pickup cannot PUT onboard directly; Cargo terminal action cannot use the Home cached-mileage modal; current account/profile/offline/mismatch gates still apply.
- [x] Cargo completion goes to the existing `/trip/complete` form. Cargo movement goes through the existing Map/current-stage cargo verification flow. Pre-start inspection/accept/start behavior must not bypass readiness. Preserve Passenger actions/layout and coachmarks.
- [x] Add failing Map tests for missing/invalid timing, closed window, unresolved/failed Pre-Shift, unresolved Pre-Trip, cached/unconfirmed profile/trip and incompatible assignment. All Cargo start labels, disabled state and handlers agree.
- [x] Reuse the existing `readinessFor` contract for Cargo timing/inspection eligibility, combined with existing online/session/workspace authority. Do not silently change documented Passenger/legacy timing exceptions.
- [x] Retain post-load/receiver checks immediately before movement/completion; preserve deliberate geofence overrides, tracking until server completion, route preferences, next assignment and session fences.
- [x] Run focused mobile and actor/session regressions, strict touched lint and source review.

## Task 3 — integration verification and record (main owner)

- [x] Review both task diffs and receive an independent correctness review; repair important findings before handoff.
- [x] Run the combined mobile/Cargo/Passenger lifecycle and API regression; strict touched lint; UTF-8/whitespace gates; Android Hermes export using a workspace temporary folder if needed.
- [x] Recheck read-only migration status/catalog contract if server SQL assumptions change. No migration application is authorized by this plan.
- [x] Update Mobile Architecture, Trips, Live Map Radar, the readiness review and SYSTEM.md with actual changes, exact verification and incomplete release gates.

## Tasks 4–7 — externally gated operational completion

These remain OPEN, not part of a simulated success claim. Their implementation cannot safely substitute guessed business rules or fake providers.

4. **Production intake/execution/evidence:** obtain named source/Fleet/receiver/data/privacy owners; approved source and organization mapping; production manifest contract and endpoint/authentication; securement and receiving proof method; evidence storage/retention/access policy. Implement real adapters against the existing version/replay-safe contracts, then run authenticated end-to-end tests on approved test identities. Keep current 503 behavior until installed authority passes these checks. Never turn on simulated fixtures in production.
5. **Physical rollout:** obtain vehicle/source/mass standards and real measured vehicle/package evidence. Audit the existing cohort, run approved SHADOW checks, reconcile conflicting old/profile kg values without automatic copying, and enable ENFORCE only for the approved cohort. Prove recommendation, dispatch, reassignment and start all use the same current evidence. No live policy or fleet values are changed in this execution.
6. **Feedback/staff recovery:** obtain approved partner gateway and scoped staff read/retry authority; configure authenticated transport and the existing leased worker; prove timeout, duplicate/stale/conflicting feedback, controlled retry and manual handoff. Distinguish receipt acknowledgement from quantity acceptance/stock closure. Do not start an unapproved cron or send partner traffic.
7. **Device/pilot:** use an actual Android/iOS device or emulator and approved test data. Capture 360/375dp, largest text, both themes, landscape, keyboard/safe area, reduced motion and screen reader. Run clean pickup, shortage WAIT/recount, rejection, partial delivery, receiver hold, offline/reconnect, account switch, completion and next assignment. Reference matching and a real Cargo pilot require these results; bundling alone does not complete this gate.

## Completion report

Separate implemented Tasks 1–3 from gated Tasks 4–7. Give the exact unresolved owner/configuration/device inputs needed to continue, not a claim that Cargo is operational.

## Progress ledger

- Task 1: complete — `cargo_server_hardening`; 157 tests / 13 offline suites, strict lint and whitespace passed. Tests first proved OFF bypass, proposed Cargo reassignment, no-trip Cargo dispatch cancellation and stale request cancellation. Independent source review passed after lock repairs; no live writes.
- Task 2: complete — `cargo_mobile_hardening`; actual Home/Map red-green regressions, 227 tests / 14 focused suites, strict lint and whitespace passed. Independent Task 2 source review passed; additional reviewer run 55 tests / 4 suites passed. Combined verification remains Task 3; native acceptance is deferred.
- Task 3: complete — combined regression 1,270 tests / 109 files; strict backend/mobile touched lint, route-auth 334/334, UTF-8 and whitespace passed. Android Hermes export passed (1,457 modules, 5.68 MB, 82 assets). Read-only db:status 163 applied / 0 pending / 0 changed; db:contract 88 relations / 0 violations. Three final classifier queries passed EXPLAIN against the live catalog without executing rows or writes. Vault and SYSTEM.md synchronized.
- Tasks 4–7: deferred by explicit user choice; preserve disabled integration and record future requirements.

## Review and acceptance record

Independent review passed Tasks 1 and 2 after repairing a source-row lock inversion and protecting legacy driver/vehicle classification. Runtime preparation now takes `drivers, vehicles` table SHARE ROW EXCLUSIVE before row locks, once per transaction. This follows the existing small-fleet evidence-lock pattern but deliberately serializes guarded lifecycle writes and competing driver/vehicle master writes. Measure contention before a larger rollout; replace with reviewed ordered per-resource locks if needed, never simply remove protection. Bound nonproduction fixture transactions retain their established drivers-table/driver-row/trip-row order.

Independent review ran 166 tests across 15 suites; two optional database suites with 36 tests remained skipped. The main combined run selected only offline/stubbed tests and passed all 1,270 tests. SQL EXPLAIN confirms catalog validity, not concurrent operational behavior. No live-write concurrency test, native captures, production build/deployment, actual source/Fleet/receiver/evidence provider acceptance or real Cargo pilot was performed. No commit, migration, setting change, operating-row write or provider activation occurred. The task-created export cache was removed; the Android export remains at `mobile/.expo/cargo-hardening-export-20261014`.
