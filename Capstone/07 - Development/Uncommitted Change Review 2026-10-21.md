# Uncommitted change review and commit split

Date: 2026-10-21. Scope: the entire uncommitted working tree on `feat/mechanic-integration` — 158 modified tracked files (+5,147/−2,971), ~150 new files, six feature workstreams (mobile rebrand, driver guidance v2, trip odometer photo verification, dual cargo signatures, fuel request/estimates work, mobile screen polish), three new migrations and one generated `schema.sql` dump. Review and cleanup only: the feature code itself was not rewritten. No commit, push, merge, deployment, migration apply or business-data write was performed.

## Verdict

The working tree is **internally consistent and free of merge conflicts**. No conflict markers exist anywhere (`git grep` over all files plus `git diff --check` are clean), no import or asset reference is broken, and every API contract was checked against the route that serves it. The review found **one real workflow bug, two contract/copy defects and thirteen pieces of dead code**, all corrected in place. Everything else that looked like a conflict is a *commit-ordering* constraint (shared files carrying hunks from two or three workstreams), documented in the split below.

Verification after the cleanup: `npm run test:run` → 547 files / 6,077 tests passed (12 PostgreSQL-integration files skipped — no live fixture DB), `npm run lint:ci` → clean at `--max-warnings 0`, `npm run db:check` → 166 migrations valid, `npm run verify:encoding` → clean, `npm run db:status` → 166 applied / 0 pending / 0 changed, `npm run verify:anon` → 0 EXPOSED with `trip_odometer_captures` explicitly refused (HTTP 401).

## Defects found and fixed

1. **Receipt litres could be folded into the tank twice** (`src/app/api/fuel/[id]/route.js`). The guard was `prev !== "Approved"`, but `Approved → Rejected` is a legal transition and a rejection never removes the litres already folded into `vehicles.fuel_level`, so re-approving the same record added them a second time (bounded only by `LEAST(100, …)`). The fold now requires that the record was never approved before (`approved_at IS NULL` in the pre-read) in addition to the status change. A regression test covers the reject → re-approve path.
2. **Mobile fuel withdraw reported success for a request that was never sent** (`mobile/app/(app)/fuel-report.js`). The call omitted `queueOnFailure: false`, so a transport failure queued the DELETE and returned `{ queued: true }`, which the handler treated as success — regenerating the dedup id while the permit was still open, and contradicting both the handler's own comment and the documented "refused while offline, not queued" contract. The flag is now passed, matching the other online-only calls in the same file.
3. **The unqueued-failure message claimed the opposite of what happened** (`mobile/lib/api.js`). With `queueOnFailure: false` the thrown message said "The queued request will be retried later", and the multipart message said "Receipt upload was not queued" even for the odometer photo upload. Both are now neutral and true: "Nothing was queued; retry when online" and "Upload was not queued; retry when online". The odometer error mapper was updated to match.
4. **Variance snapshot shape drift** (`src/lib/fuel/request-policy.js`). A no-verdict snapshot omitted `refilled_liters` while the verdict path included it, so a consumer reading the object uniformly saw `undefined`. The empty verdict now carries every key the verdict path carries.
5. **The odometer screen opened a sample path from a legacy tour link** (`mobile/app/(app)/trip/odometer.js`). It read `?tour=1` and rendered a practice screen that skips the real trip context, and it was the only operational screen not wrapped in `guardLegacyGuideLinks` — the incident, fuel, inspection and map screens all were. In guidance v2 the screen is now guarded exactly like the others, and the v2 practice host is unaffected because it composes the review view directly.
6. **The offline guide did nothing for an unclassified driver** (`mobile/components/ConnectivityBanner.jsx`). The Details action replayed the guide with the driver's workspace as the variant, but the guide catalogue only resolves `common`, `passenger` and `cargo`, so an unclassified workspace silently resolved nothing. The action now falls back to the common variant.

## Dead code removed

| Location | Removed |
|---|---|
| `mobile/components/logo.js` | `BrandBar` export and its `bar` style — nothing rendered it after the rebrand; the README row was corrected to the real exports |
| `mobile/assets/splash-icon.png` + `scripts/generate-mobile-brand.mjs` | The generator wrote an asset no config or code consumed (the splash plugin renders `splash-mark-*.png`); the file is deleted and the identity note updated |
| `src/lib/api/utils.js` | The unused third `data` parameter of `err()` — zero callers anywhere; the file is back to its two-parameter form and no longer appears in the diff |
| `mobile/lib/cargo-view-model.js` | The `export` keyword on `cargoQuantity` and `compareCargoQuantities` — module-private helpers with no external consumer. `cargoMapAction` keeps its export because the test suite asserts it directly |
| `mobile/lib/notifications/presentation.js` | The `export` keyword on `mobileNotificationMeta` — internal helper only |
| `mobile/app/(app)/(tabs)/map.js` | Seven styles orphaned by the `PassengerMapSummary` extraction (`sheetHeader`, `locationIconWrapper`, `locationTextWrapper`, `locationIndicator`, `divider`, `headerStatsRight`, `headerDistValue`) — the extracted component carries its own copies |
| `mobile/app/(app)/incidents.js` | Five styles orphaned by the form extraction (`severityRow`, `severityBtn`, `severityText`, `tourSimulationCard`, `tourNextBtn`) |
| `mobile/app/(app)/inspection.js` | The empty `checkItemLabel: {}` style |
| `mobile/components/trips/OdometerCapture.jsx` | Two styles never referenced in that file (`reading`, `number`) — `OdometerReview` defines its own pair |
| `src/app/api/fuel/requests/route.js` | The never-passed `db` injection parameter of `openRequestForVehicle` |
| `mobile/.env.example` | `EXPO_PUBLIC_ENABLE_DEMO` and its comment describing a "Sign in as driver (demo)" screen that does not exist; the used-but-undocumented `EXPO_PUBLIC_DRIVER_GUIDES_V2` switch was added in its place |
| `mobile/lib/driver-context.js` | The stale header comment that still listed only `HOME_TRIPS/TRIPS_ALL` while the code also reads `TRIPS_TODAY` newest-wins |
| `mobile/lib/driver-guide-policy.js` | The `export` keyword on `GUIDE_MOTION_MAX_AGE_MS` and `GUIDE_PARKED_MAX_SPEED_MS` — module-private thresholds |
| `mobile/lib/driver-practice.js` | The `export` keyword on `sampleCargoExecution` — an internal sample payload builder |

Not removed on purpose: the legacy coach-mark system is a live default-off branch (`CoachMarkProvider.jsx:82` switches to the v2 provider only when `DRIVER_GUIDES_V2` is on), and the `__DEV__`-guarded layout log inside it is a deliberate developer diagnostic. The barrel re-exports of `CoachMarkOverlay` and `CoachMarkTooltip` in `mobile/components/coachmarks/index.js` have no consumer (both are imported by direct path) but pre-date this working tree, so they were left as a follow-up.

## Dependency repaired

`scripts/generate-mobile-brand.mjs` imported `sharp`, which was only present as a hoisted transitive of `next` — a future Next.js version could drop it and silently break brand regeneration. `sharp` is now a declared root devDependency and the generator has a script entry (`npm run mobile:brand`), with the lockfile updated in the same change.

## Commit-ordering constraints (not code defects)

- `schema.sql` is a generated dump that now contains migration 164 (odometer), 165 and 166 (fuel) together. It must be committed once, after both workstreams' migration commits, and never hand-split.
- `mobile/lib/test-helpers/native-render.js` is a shared mock imported by ~11 new test files across other workstreams; it must land before the first of them.
- `mobile/app/(app)/trip/[id].js` carries odometer, cargo-handover and trips-cache hunks; `mobile/app/(app)/(tabs)/map.js` carries the extraction, the guidance practice host and the odometer gate; `mobile/app/(app)/(tabs)/index.js` carries the clock/preview work and the odometer gates; `mobile/app/(app)/inspection.js` carries the odometer continuation and the guidance rework; `mobile/components/home/DriverHomeHeader.jsx` carries the compact weather and the brand signature. These need hunk-level staging (`git add -p`) or an explicit ordering.
- `mobile/lib/off-duty-illustration.test.js` also pins the Trips screen's negatives, so the off-duty fix must land after (or with) the Trips date-tabs commit.
- `mobile/lib/api.js` carries both the network-failure copy fix and the guidance `skipQueueDrain` option; stage the two hunks separately.

## Follow-ups deliberately left alone

- Service and repository layers both validate a new cargo receipt (same rule, two layers) — a drift risk, not a defect; unify in a separate change.
- Four pre-existing hand-rolled Manila date formatters were not migrated to the new canonical `formatManilaDateTime`.
- Manual guide replay stays network-dependent: when the 15-second readiness refresh is stale, the emergency state is unknown, so the replay is refused rather than risking an interruption of real emergency work. The guide text itself still reads without it. The Help message could be clearer about the stale check.
- `mobile/eas.json` ships a TomTom public key in plaintext and an unused `EXPO_PUBLIC_DISPATCHER_PHONE`; `mobile/eas.json` also still defines the dead `EXPO_PUBLIC_ENABLE_DEMO`. All pre-existing and outside this diff.
- The 48 `INCONCLUSIVE` rows from `verify:anon` are pre-existing tables that hold a `SELECT` grant but hide rows through RLS; `db:contract` reports 0 violations across 89 relations, so they are resolved from the database side.

## Verification

Full suite after the cleanup: 547 test files / 6,077 tests passed, 12 skipped (PostgreSQL integration, no fixture DB). Strict lint clean, `db:check` and `verify:encoding` clean, `verify:anon` 0 EXPOSED with the new odometer table refused, `db:status` 166 applied / 0 pending / 0 changed. No commit, push, merge, deployment or migration apply was performed. See [[FleetOps Mobile Identity]], [[Trip Odometer Photo Verification 2026-10-19]], [[Fuel]], [[Cargo Remaining Work 2026-10-20]] and [[Driver Guidance Redesign Implementation Plan 2026-10-20]].
