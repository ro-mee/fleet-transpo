# Uncommitted review — commit split plan

Date: 2026-10-21. Branch: `feat/mechanic-integration`. Companion note: `Capstone/07 - Development/Uncommitted Change Review 2026-10-21.md`.

Twenty-three commits, ordered so each one leaves the tree consistent. `⚠` marks a file that carries hunks from two workstreams and must be staged with `git add -p` (or committed together with the named sibling commit).

## Final commit order as landed

The split is slightly reordered from the plan below so that no commit ever leaves a broken tree: the fuel work (12 → 13 → 14) lands before the odometer API commit because the fuel completion-path test has to know about the odometer queries, and the network-failure copy fix (20) lands before the odometer mobile commit because that commit's error mapper reads the new wording.

| # | Commit | Why it sits here |
|---|---|---|
| 1 | `chore(mobile): add the shared native-render test helper` | every later mobile suite needs it |
| 2 | `chore(tooling): declare sharp and expose the mobile brand generator` | the generator needs its dependency |
| 3 | `feat(mobile): rebuild the launch identity with the generated FleetOps brand` | brand assets and splash config |
| 4 | `refactor(mobile): adopt the shared FleetOps mark in auth and onboarding headers` | consumes the mark |
| 5 | `feat(db): add private trip odometer captures with a photo-required latch` | migration first, per repo convention |
| 6 | `feat(trips): add the odometer capture scan pipeline and lifecycle gate` | the service the API commit calls |
| 7 | `feat(fuel): resolve efficiency through one labelled precedence` | renames the `measured` basis |
| 8 | `feat(fuel): add the cancelled request lifecycle and receipt-driven tank level` | migrations 165 and 166 |
| 9 | `feat(fuel): add estimates monitoring for planned versus actual consumption` | updates the completion-path test |
| 10 | `feat(api): add odometer capture routes and atomic start/complete consumption` | after the fuel test update |
| 11 | `fix(mobile): correct the network-failure copy for unqueued requests` | before the odometer mapper reads it |
| 12 | `feat(mobile): add the shared odometer photo journey for start and completion` | |
| 13 | `feat(cargo): require a versioned handover acknowledgment on cargo receipts` | shared validator first |
| 14 | `feat(mobile): capture dual cargo signatures and review saved handovers` | consumes the validator |
| 15 | `feat(cargo): show the web chain-of-custody evidence and the Dispatch signature link` | |
| 16 | `feat(mobile): scope Trips into Today, Upcoming and History date tabs` | after the dated server scope |
| 17 | `feat(mobile): polish the notifications inbox` | |
| 18 | `refactor(mobile): polish the Home, Map and Profile presentation` | |
| 19 | `refactor(mobile): extract the incident and inspection forms` | |
| 20 | `feat(mobile): add the driver guidance v2 system with scoped practice` | last: it wraps the other screens |
| 21 | `chore(config): scope the lint ignores and un-ignore the local env templates` | |
| 22 | `chore(db): refresh the generated schema after the odometer and fuel migrations` | one generated dump, after 164–166 |
| 23 | `docs(vault): record the rebrand, guidance, odometer, fuel and cargo work` | |

The env templates (`.env.example`, `mobile/.env.example`) stay **untracked on purpose**: the credential-hygiene gate `SEC-CONFIG-005` refuses any tracked path that looks like an environment file, examples included, so the shared key list lives in the vault note instead.

## 1. chore(mobile): add the shared native-render test helper

```
Adds the React Native render mock the new mobile suites share. Roughly a
dozen test files from the guidance, odometer, cargo, fuel and notification
workstreams render component trees in Node, and the mock has to exist
before any of them can run — so it lands first.
```

- `mobile/lib/test-helpers/native-render.js`

## 2. chore(tooling): declare sharp and expose the mobile brand generator

```
The brand generator imported sharp while depending on it only as a hoisted
transitive of next, so a future Next.js version could silently break brand
regeneration. Declares sharp as a devDependency and adds a mobile:brand
script so the asset pipeline is reproducible from a clean install.
```

- `package.json`, `package-lock.json`, `scripts/generate-mobile-brand.mjs`

## 3. feat(mobile): rebuild the launch identity with the generated FleetOps brand

```
Replaces the car-badge startup with the generated road-ribbon identity: four
mark and lockup variants, a bounded 1.9 second route reveal split into a
reusable hook, and native splash and adaptive-icon configuration. The old
launch-only Lottie files are removed after a repository-wide reference
check, and the unreferenced splash-icon output is dropped from the generator.
```

- `mobile/assets/brand/**` (22 files), `mobile/assets/{fleetops-icon,icon,favicon,android-icon-foreground,android-icon-background,android-icon-monochrome}.png`
- deleted: `mobile/assets/PRt4x4Ds0p.json`, `mobile/assets/car animation.json`, `mobile/assets/splash-icon.png`
- `mobile/app.json`, `mobile/app/_layout.js`, `mobile/components/LaunchScreen.js`, `mobile/components/logo.js`
- `mobile/lib/use-launch-sequence.js`, `mobile/lib/launch.js`
- `mobile/lib/{launch-animation,launch-visual,launch-handoff,mobile-brand,mobile-brand-integration}.test.js`
- `docs/superpowers/plans/2026-10-21-fleetops-mobile-rebrand.md`, `Capstone/01 - System/FleetOps Mobile Identity.md`

## 4. refactor(mobile): adopt the shared FleetOps mark in auth and onboarding headers

```
Login shows the mark and wordmark lockup behind one accessible label and
onboarding swaps the Ionicons squircle for the shared mark with a sage
subtitle. The security screens keep their icon tiles.
```

- `mobile/components/auth/AuthHeader.jsx`, `mobile/components/onboarding/OnboardingHeader.jsx`

## 5. feat(db): add private trip odometer captures with a photo-required latch

```
Adds the private trip_odometer_captures table with a stage-bound unique
index, the trips.odometer_capture_required latch, RLS with every client
privilege revoked, and a private trip-odometer-photos bucket. Registers the
table as PRIVATE in the schema contract and the bucket as a known media key,
and documents the two server-side rollout variables.
```

- `supabase/migrations/164_trip_odometer_captures.sql`, `scripts/lib/schema-contract.mjs`, `src/lib/storage/key-format.js`, `src/security-assessment/schema-contract.security.test.js`, `.env.example`

## 6. feat(trips): add the odometer capture scan pipeline and lifecycle gate

```
Strict total-kilometre extraction, a bounded server-side Gemini scan and a
private upload/reconcile/scan/evidence service with lease, CAS, expiry and
rate bounds. The shared photo-requirement gate decides when a trip may start
or finish, and the model never sees prior mileage or the expected distance.
```

- `src/lib/trips/{odometer-extraction,gemini-odometer,odometer-gate}.js` + tests
- `src/services/trip-odometer.service.js` + `trip-odometer.service.test.js` + `trip-odometer.service.postgres.test.js`
- `src/services/trip-odometer-lifecycle.test.js` + `trip-odometer-lifecycle.postgres.test.js`

## 7. feat(api): add odometer capture routes and atomic start/complete consumption

```
Driver upload, read and scan endpoints plus a staff evidence read behind
trips.read_all. Capture consumption happens inside the start and complete
transactions with replay acknowledgement, generic writers and driver accept
are gated, and the dashboard trip page renders the saved evidence.
```

- `src/app/api/mobile/driver/trips/[id]/odometer/route.js` + test, `[captureId]/route.js` + test, `[captureId]/scan/route.js` + test
- `src/app/api/trips/[id]/odometer/route.js` + test
- `src/app/api/trips/[id]/route.js` + test, `start/route.js` + test, `complete/route.js`, `src/app/api/trips/route.js`
- `src/app/api/mobile/driver/trips/route.js` ⚠ **heavily interleaved** — the date-scope query and the odometer projection share the same SELECT and WHERE blocks, so do not hunk-split it. Commit the whole file in whichever of commits 7 and 15 lands second, and name both changes in that body.
- `src/app/api/mobile/driver/trips/accept/route.js` + test
- `src/app/api/trips/[id]/live-monitor/route.test.js`, `src/lib/api/ownership.js`
- `src/services/trip-lifecycle.service.js` + test, `src/services/transition.service.js` + test
- `src/components/trips/trip-odometer-evidence.jsx` + test, `src/app/(dashboard)/trips/[id]/page.js` + `page.test.js`

## 8. feat(mobile): add the shared odometer photo journey for start and completion

```
One capture surface drives both stages: a start continues a server-confirmed
Pre-Trip directly into the camera, and the ending photo lives in the existing
completion screen. Drafts stay in memory, a lost response reconciles against
the exact capture id, and practice mode performs no writes. The screen is
also wrapped in the legacy-link guard like the incident, fuel, inspection and
map screens, so an old tour link cannot open the odometer as a sample.
```

- `mobile/lib/trip-odometer.js` + test, `mobile/lib/use-trip-odometer.js`, `mobile/lib/trip-odometer-{entry,recovery,render}.test.js`
- `mobile/app/(app)/trip/odometer.js`, `mobile/components/trips/OdometerCapture.jsx`, `OdometerReview.jsx`
- `mobile/app/(app)/trip/complete.js`, `mobile/lib/trip-completion-render.test.js`, `mobile/lib/map-action-confirmation.test.js`
- `mobile/app/(app)/trip/[id].js` ⚠ (odometer hunks only; the cargo handovers stay with commit 10)

## 9. feat(cargo): require a versioned handover acknowledgment on cargo receipts

```
New pickup and delivery receipts carry a validated handover in the existing
immutable payload, so no migration is needed. Unsigned history stays
replayable but can no longer authorise departure, completion or a new
clearance. Default reads strip the handover detail, partner and machine
projections redact it, and every cargo response is private and no-store.
```

- `shared/cargo-handover.js`, `src/lib/cargo/handover.test.js`
- `src/lib/cargo/contracts.js` + test, `api.js` + test, `execution-state.js` + test
- `src/services/cargo-execution.service.js` + test, `cargo-execution.repository.js` + test, `cargo-execution.client.js` + test, the two cargo DB-integration tests

## 10. feat(mobile): capture dual cargo signatures and review saved handovers

```
The signature pad opens only after the count review, the acknowledged
snapshot is frozen and invalidated whenever the account, session, manifest,
assignment, stage or connectivity changes, and a retry replays the saved
command without signing again. Trip Details gains an explicit, session-scoped
view of the saved handovers.
```

- `mobile/components/cargo/CargoSignatureModal.jsx`, `CargoTripHandovers.jsx`
- `mobile/lib/cargo-signature.js` + `cargo-signature.test.js` + `cargo-signature-render.test.js` + `cargo-signature-workflow.test.js`, `mobile/lib/cargo-trip-handovers-render.test.js`
- `mobile/lib/cargo-view-model.js` + test, `cargo-form-state.js` + test, `cargo-api.js` + test, `cargo-demo-fixtures.js`
- `scripts/cargo-demo/fixtures.test.mjs`
- `mobile/components/cargo/CargoWorkflowScreen.jsx` ⚠ (guidance hunks stay with commit 19), `CargoWorkflowContent.jsx` ⚠, `CargoDecisionStatus.jsx` ⚠, `CargoIssueSheet.jsx` ⚠, `CargoItemReceiptRow.jsx` ⚠, `CargoManifestList.jsx` ⚠
- `mobile/app/(app)/trip/[id].js` ⚠ (cargo hunks only)

## 11. feat(cargo): show the web chain-of-custody evidence and the Dispatch signature link

```
Trip Details now shows the paired pickup and delivery signature records,
hidden until they are explicitly requested, and the Dispatch cargo-review
block becomes two reachable buttons — one of them deep-links to the saved
signatures after the delayed trip and cargo queries resolve.
```

- `src/components/cargo/cargo-handover-evidence.jsx` + test, `use-cargo-handover-anchor.js` + test, `cargo-verification-panel.jsx` + test
- `src/app/(dashboard)/dispatch/[id]/page.js`

## 12. feat(fuel): resolve efficiency through one labelled precedence

```
resolveVehicleEfficiency is the single seam: an eligible measured basis
outranks the configured vehicle profile, which outranks the seat and
fuel-type heuristic, and every estimate labels which one it used. estimateFuel
no longer applies 8 km/L silently, gains an explicit return-leg assumption
and returns no litres for an unknown distance instead of a fabricated zero,
which also stops unknown-distance vehicles from scoring full fuel points.
The Manila date helpers back the measured window and the estimates surface.
```

- `src/lib/fuel/measured-efficiency.js` + test, `src/lib/fuel/trip-estimate.js` + test
- `src/lib/ai/rule-engine.js` + test, `src/lib/ai/dispatch-advisor.js` + test
- `src/lib/geo/distance.js` + `distance.test.js`, `src/lib/dates.js` + test
- `src/services/dispatch-recommendation-preparation.service.js` + test, `src/release-acceptance.test.js`

## 13. feat(fuel): add the cancelled request lifecycle and receipt-driven tank level

```
A driver can withdraw their own open permit, the 409 names the permit that
blocks a new request, and permits whose trip already ended are closed once
on the next attempt instead of parking the vehicle forever. Approving a
receipt folds its litres into the tank in the same transaction and stamps
the level timestamp, and the fold happens only the first time a record is
approved so a rejection followed by a re-approval cannot add the litres
twice.
```

- `supabase/migrations/165_vehicles_fuel_level_updated_at.sql`, `166_fuelrequests_cancelled_status.sql`
- `src/lib/fuel/request-policy.js` + test
- `src/app/api/fuel/requests/route.js` + test, `src/app/api/fuel/[id]/route.js` + test
- `src/components/ui/status-badge.jsx`
- `mobile/app/(app)/fuel-report.js` ⚠ (the guidance trigger belongs to commit 19), `mobile/components/fuel/FuelRequestForm.jsx`, `FuelReceiptReview.jsx`
- `Capstone/03 - Database/Tables/vehicles.md`

## 14. feat(fuel): add estimates monitoring for planned versus actual consumption

```
The estimates read-out reports range-wide totals instead of page-derived
ones, adds planned versus actual and estimate versus receipt columns, flags
a stale reference price, and keeps a null cost distinct from a zero. The
page gains a KPI grid with denominators, an accessible daily table and a
paged export.
```

- `src/lib/fuel/price-policy.js`, `src/lib/fuel/trip-estimate.js` ⚠ (the basis rename also appears in commit 12), `src/lib/fuel/completion-path.test.js`
- `src/app/api/fuel/estimates/route.js` + test, `src/app/(dashboard)/fuel/estimates/page.js` + test
- `scripts/verify-fuel-requests.mjs`

## 15. feat(mobile): scope Trips into Today, Upcoming and History date tabs

```
The server now serves owned-driver date scopes with validated limits and
offsets, and the screen renders segmented date tabs in a raised header with
history pagination. SectionList windowing replaces eager card building, the
per-scope snapshots are cleared on logout, and the newest snapshot wins when
the vehicle and trip context is resolved.
```

- `mobile/lib/trips-schedule.js`, `use-trip-schedule.js`, `use-screen-clock.js` + test, `duty-layout-render.test.js`
- `mobile/lib/driver-context.js`, `mobile/lib/offline-cache.js` ⚠
- `src/app/api/mobile/driver/trips/route.js` ⚠ (see commit 7 — commit the whole file in whichever of the two lands second)
- `mobile/app/(app)/(tabs)/trips.js`
- `mobile/app/(app)/trip/[id].js` ⚠ (the cache lookup only)

## 16. feat(mobile): polish the notifications inbox

```
The inbox is rewritten on the raised card system: wrapped titles, category
and severity presentation, honest date-aware timestamps, an explicit
read/unread row, a 48 dp dismiss control outside the card target and a
full-width mark-all-read. The provider keeps the array identity for
identical payloads and now reports a failed refresh instead of showing an
empty inbox.
```

- `mobile/app/(app)/(tabs)/notifications.js`, `mobile/context/notification-feed.jsx`, `mobile/lib/notifications/presentation.js`, `mobile/lib/notifications/inbox-render.test.js`

## 17. refactor(mobile): polish the Home, Map and Profile presentation

```
Map's empty state adopts the semantic palette and the shared badge, with the
summary and the control cluster extracted. Home uses a compact weather chip
and stops its skeleton pulse and route previews while hidden. Profile shows
My Work for every driver type and drops the duplicated Personal-Info rows,
and the off-duty artwork is bounded to its layout slots on both axes.
```

- `mobile/app/(app)/(tabs)/index.js` ⚠ (the clock and preview work only), `mobile/app/(app)/(tabs)/map.js` ⚠ (the extraction only)
- `mobile/components/home/DriverHomeCards.jsx`, `DriverHomeHeader.jsx` ⚠ (the weather work only), `home/materials.js`, `mobile/components/WeatherChip.js`, `mobile/components/clay/ClayBadge.jsx`
- `mobile/components/map/MapControlCluster.jsx`, `PassengerMapSummary.jsx`
- `mobile/components/OffDutyIllustration.jsx`, `mobile/lib/off-duty-illustration.test.js` (after commit 15)
- `mobile/app/(app)/(tabs)/profile.js`, `profile/personal.js`, `profile/help.js`, `mobile/components/ClayMenuRow.jsx`

## 18. refactor(mobile): extract the incident and inspection forms

```
No behaviour change: the incident form, its severity assessment, the critical
confirmation and the upload payload move into their own components, and the
inspection checklist moves into one, both preserving the style fallbacks and
the Pre-Trip and Pre-Shift trip_id rules. The styles the extraction orphaned
are removed.
```

- `mobile/app/(app)/incidents.js`, `mobile/components/incidents/IncidentReportForm.jsx`, `IncidentCriticalConfirmation.jsx`
- `mobile/app/(app)/inspection.js` ⚠ (the extraction only; the odometer continuation stays with commit 8), `mobile/components/inspection/InspectionChecklist.jsx`
- `mobile/lib/inspection-photo-render.test.js`, `mobile/lib/reference-photo-render.test.js`

## 19. feat(mobile): add the driver guidance v2 system with scoped practice

```
Independent Passenger and Cargo guides replace the forced onboarding tour
behind the default-off v2 switch, with scoped progress, full Help
explanations, replay per section and an explicitly labelled local practice
that performs no operational write, upload or offline-queue effect. The
legacy coach-mark system stays as the default-off fallback. The offline
guide now resolves for an unclassified driver instead of doing nothing, and
the guide-only thresholds stop being exported.
```

- `mobile/components/coachmarks/DriverGuideLibrary.jsx`, `DriverGuideProvider.jsx`, `DriverGuideTrigger.jsx`, `DriverGuideWorkWatch.jsx`, `DriverPracticeHost.jsx`, `GuideDetailsSheet.jsx`, `LegacyGuideLinkGuard.jsx`, `PracticeBanner.jsx`
- `mobile/components/coachmarks/CoachMarkProvider.jsx`, `CoachMarkOverlay.jsx`, `CoachMarkTooltip.jsx`, `mobile/components/ConnectivityBanner.jsx`, `DriverSos.js`
- `mobile/lib/driver-guidance-config.js`, `driver-guide-{controller,policy,progress}.js`, `driver-guides.js`, `driver-practice.js`, `driver-practice-readiness.js`, `use-driver-practice.js`, `coach-mark-storage.js` and their tests
- `mobile/app/(app)/profile/guide-practice.js`, `mobile/app/(app)/_layout.js`
- `mobile/lib/api.js` ⚠ (the skipQueueDrain option only), `mobile/lib/api-refresh.test.js`

## 20. fix(mobile): correct the network-failure copy for unqueued requests

```
A request that was deliberately not queued reported that it would be retried
later, and a multipart failure claimed a receipt upload, which is wrong for
every other upload. Both messages now say what actually happened, and the
odometer error mapper follows the new wording.
```

- `mobile/lib/api.js` ⚠ (the message hunks only), `mobile/lib/use-trip-odometer.js` ⚠ (the matcher only), `mobile/lib/trip-odometer-render.test.js` ⚠

## 21. chore(config): commit the env examples and scope the lint ignores

```
Un-ignores .env.example at any depth while .env, .env.local and mobile/.env
stay ignored, documents the two server-side odometer variables and the mobile
app variables, and keeps the brain-storm scratch directory out of lint. The
dead demo flag is removed from the mobile example and the used guidance
switch is added.
```

- `.gitignore`, `.env.example`, `mobile/.env.example`, `eslint.config.mjs`

## 22. chore(db): refresh the generated schema after the odometer and fuel migrations

```
Regenerates schema.sql from the live database so the review artifact matches
what production runs. The dump carries migration 164, 165 and 166 together,
so it is committed once here, after their own migration commits, and is
never hand-split.
```

- `schema.sql`

## 23. docs(vault): record the rebrand, guidance, odometer, fuel and cargo work

```
Records the implemented behaviour, the verification and the honest limits of
each workstream in the vault and in the plan documents, including the
uncommitted review note with its defect list, the dead code that was removed
and the commit-ordering constraints.
```

- `SYSTEM.md`, `Capstone/07 - Development/Uncommitted Change Review 2026-10-21.md` (new)
- `Capstone/07 - Development/{REA Codex Integration 2026-10-21,Cargo Remaining Work 2026-10-20,Coach Marks Passenger Cargo Proposal Assessment 2026-10-20,Driver Guidance Redesign Implementation Plan 2026-10-20,Dual Cargo Signature Plan Assessment 2026-10-20,Dual Cargo Signatures Implementation 2026-10-20,Level 3 Fuel Efficiency Measurement Plan,Trip Odometer Photo Verification 2026-10-19}.md`
- `Capstone/01 - System/{FleetOps Mobile Identity,Mobile Home Claymorphism Implementation Plan,Mobile Profile & Settings Claymorphism Implementation Plan,UI UX Audit - Mobile}.md`
- `Capstone/02 - Features/{Driver In-App Guide,Driver Management,Fuel,Incidents,Live Map Radar,Notifications,Trips}.md`
- `Capstone/03 - Database/Tables/{cargo_execution_storage,vehicles,trip_odometer_captures}.md`
- `Capstone/04 - Architecture/Mobile Architecture.md`, `Capstone/07 - Development/{Environment Setup,Cargo UI Backend Readiness Review 2026-10-14}.md`, `Capstone/11 - Memory/Deployment Knowledge.md`
- `docs/design-system.md`, `docs/superpowers/plans/*.md`, `docs/superpowers/specs/2026-10-20-driver-guidance-redesign-design.md`
