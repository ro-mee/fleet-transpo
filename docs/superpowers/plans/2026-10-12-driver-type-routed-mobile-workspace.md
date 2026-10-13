# Driver-Type-Routed Mobile Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task. The user previously chose subagent-driven execution. Each task below is a small, testable slice with a reviewable commit.

**Goal:** When a driver signs in, show the mobile workspace that matches the fixed `driver_type` selected for that driver during Add Driver: Passenger drivers get the hotel guest/VIP transport workspace, and Cargo drivers get the one shared hotel/restaurant supplies workspace.

**Architecture:** The authenticated driver's saved `drivers.driver_type` is the only source that chooses the mobile workspace. The assigned vehicle's `operational_use` and the trip's `load_type` are separate compatibility checks; if either disagrees with the driver type, the app keeps showing the driver's correct workspace but blocks actions for that mismatched assignment. The existing vehicle-routed screens and guard work in the approved cargo worktree are retained, with only their mode selector changed.

**Tech Stack:** Expo SDK 54, Expo Router 6, React Native, the existing Clay mobile components and theme, Next.js route handlers, PostgreSQL through the existing `pg` query layer, and Vitest.

## Starting point and scope

- Continue from the approved `codex/cargo-core-sandbox` worktree based on Task 11, where the Passenger/Cargo screens and vehicle-first compatibility guards already exist. Inspect its current status before editing; preserve all existing commits and changes.
- This plan supersedes the workspace-selection rule in `docs/superpowers/plans/2026-10-12-mobile-ui-by-vehicle-operational-use.md`. It does not discard that plan's screens, mismatch states, or server guards.
- The driver-classification work is a prerequisite: Add Driver must save the selected `driver_type` as exactly `Passenger` or `Cargo`. Reuse that existing field and validation; do not create a duplicate column or migration.
- The mobile Home profile is loaded through `GET /api/driver/me` and `mobile/lib/driver-profile.js`. Use that authenticated profile as the workspace source rather than inferring type from an employee role, vehicle, trip, service label, or client-supplied value.

## Global constraints

- A driver's saved type selects the workspace on every login: `Passenger` → guest/VIP transportation; `Cargo` → the shared hotel and restaurant supply workflow. Hotel and restaurant only change source labels supplied by service metadata; they never create separate cargo modes.
- A missing or unsupported `driver_type` must show a calm “Driver type needs setup” state and disable operational actions. Never silently assume Passenger in the mobile app, including while profile data is loading or when using an offline cache.
- A vehicle/trip mismatch never changes the driver's workspace. It blocks that assignment's accept, start, passenger, and cargo actions and explains that Dispatch must correct the pairing. A `force` or manual-review option must not override a type mismatch.
- Preserve existing trip-state, qualification, duty, GPS, geofence, inspection, privacy, and cargo lifecycle checks. These are independent safety rules.
- Keep existing shared navigation and account roles. Do not enable real cargo providers, supply decisions, source images, uploads, new permissions, or production cargo operations.
- Do not add a database migration for this work. If the driver-type field is not yet present in the target branch, finish its separate approved classification work first.
- Use the existing mobile Clay components and semantic theme tokens, warm ivory/forest palette, and Plus Jakarta Sans. Do not apply web-only design tokens or add a UI dependency.
- Mobile acceptance must cover safe areas, light and dark themes, large system text, reduced motion, screen-reader labels, and minimum 44pt iOS / 48dp Android controls. Keep copy direct and understandable.

## Implementation tasks

### Task 1: Verify the classification and profile contract

**Files:**
- Modify: `src/app/api/driver/me/route.js`
- Modify: `src/app/api/driver/me/route.test.js`
- Verify: `src/app/api/drivers/route.js` and `"src/app/api/drivers/[id]/route.js"`
- Verify: `mobile/lib/driver-profile.js`

**Interface:** `GET /api/driver/me` returns the authenticated driver's saved `driverType` as `Passenger`, `Cargo`, or `null` when the stored classification is unusable. The existing `assignedVehicle` response remains available for vehicle details, but it does not select the workspace.

- [ ] **Step 1: Add failing profile-contract tests.** Assert that the query is scoped to the signed-in employee, selects `d.driver_type`, and returns `driverType` for both valid classifications. Add a missing/unsupported fixture and assert the API does not silently serialize it as Passenger. Keep the current response contract for other profile fields.
- [ ] **Step 2: Run the focused profile test and confirm it fails.** Run `npm run test:run -- src/app/api/driver/me/route.test.js`.
- [ ] **Step 3: Expose the saved classification.** Add `d.driver_type` to the existing authenticated self-profile query and serialize it as `driverType`. Do not add a second lookup or trust a request parameter. Confirm the Add Driver and edit endpoints already save only the two allowed values; complete the separate driver-classification plan first if they do not.
- [ ] **Step 4: Verify the mobile profile reader keeps the field.** Extend its focused contract test if profile normalization strips unknown fields. Keep the shared cached profile keyed to the authenticated employee.
- [ ] **Step 5: Run focused tests and commit.** Run the profile and driver-classification tests. Commit only the profile contract files with `feat: expose driver type to mobile profile`.

### Task 2: Make driver type the pure workspace decision

**Files:**
- Modify: `mobile/lib/driver-workspace.js`
- Modify: `mobile/lib/driver-workspace.test.js`

**Interface:** Update the existing resolver to consume `{ driverType, trip, assignedVehicle }`. It returns `mode: "passenger" | "cargo" | "unclassified"`, plus readiness and a stable reason. `driverType` alone chooses `mode`; trip and vehicle fields only determine whether work is allowed.

- [ ] **Step 1: Add failing decision tests.** Cover Passenger type with a Passenger vehicle/trip, Cargo type with a Cargo vehicle/trip, both driver/vehicle mismatch directions, both driver/trip mismatch directions, hotel and restaurant service codes on the same Cargo mode, missing/unknown driver type, no trip, no assigned vehicle, missing operational use, and the existing typed/untyped legacy cases.
- [ ] **Step 2: Run the resolver test and confirm it fails.** Run `npm run test:run -- mobile/lib/driver-workspace.test.js`.
- [ ] **Step 3: Change the resolver contract.** Always derive mode from exact `driverType`. For an opened trip, validate that trip's own vehicle and saved load type; never borrow the standing vehicle to make an incomplete trip look valid. With no trip, the driver's type still selects Home mode; no assigned vehicle produces an unassigned-work reason, not another mode. Return explicit reasons such as `missing_driver_type`, `unsupported_driver_type`, `no_vehicle`, `missing_operational_use`, `driver_vehicle_mismatch`, `missing_trip_type`, and `trip_type_mismatch`.
- [ ] **Step 4: Preserve only the existing legacy Passenger exception.** A legacy untyped passenger trip can remain usable only when the driver's type and the assigned vehicle use are both explicitly Passenger. Untyped Cargo trips remain blocked. Do not let service code or cargo-description text choose a mode.
- [ ] **Step 5: Run the resolver test and commit.** Run `npm run test:run -- mobile/lib/driver-workspace.test.js`. Commit with `fix: route driver workspace by saved type`.

### Task 3: Route Home and shared mobile context by profile type

**Files:**
- Modify: `mobile/app/(app)/(tabs)/index.js`
- Modify: `mobile/components/home/DriverHomeCards.jsx`
- Modify: `mobile/lib/driver-context.js` only if a shared profile normalization is needed
- Modify: `mobile/lib/cargo-home-render.test.js`
- Verify: `mobile/lib/driver-profile.js` and its tests

**Interface:** Home passes the profile's `driverType` to the workspace resolver. The standing vehicle assignment supplies plate/model details and assignment status only; it never decides Passenger versus Cargo.

- [ ] **Step 1: Add failing Home render cases.** Verify that Cargo type keeps the Cargo workspace with no vehicle or a mismatched vehicle; Passenger type keeps the transportation workspace with no vehicle or a mismatched vehicle; and missing type renders setup-needed copy rather than Passenger. Verify a mismatched active trip has no enabled trip action.
- [ ] **Step 2: Run Home render tests and confirm the new cases fail.** Run `npm run test:run -- mobile/lib/cargo-home-render.test.js mobile/lib/driver-workspace.test.js`.
- [ ] **Step 3: Connect the saved type to Home.** Use the existing `DriverWorkspaceCard` and Clay components. Keep shared tabs, safety actions, loading/error banners, passenger guest/VIP cues, and the one shared Cargo presentation. On profile loading, show a neutral loading state; do not flash Passenger UI.
- [ ] **Step 4: Make offline behavior fail safe.** A cached known type may identify the read-only workspace while offline, but all assignment-changing and trip-starting actions remain disabled until the current profile and trip are confirmed by the server. A missing cached type stays unclassified.
- [ ] **Step 5: Run the focused Home and Clay tests and commit.** Run the Home rendering, driver-workspace, and relevant Clay component tests. Commit with `feat: route mobile home by driver type`.

### Task 4: Apply the same mode and mismatch guard to every trip screen

**Files:**
- Modify: `mobile/app/(app)/(tabs)/map.js`
- Modify: `mobile/app/(app)/(tabs)/trips.js`
- Modify: `mobile/app/(app)/trip/[id].js`
- Modify: `mobile/components/cargo/CargoWorkflowScreen.jsx`
- Modify: `mobile/lib/cargo-view-model.js` and its tests
- Modify: the existing cargo screen-copy and verification-render tests
- Verify: `src/app/api/mobile/driver/trips/route.js` and `src/app/api/mobile/driver/trips/route.test.js`

**Interface:** Every trip-specific screen uses the authenticated `driverType` for presentation and runs the shared compatibility resolver against that exact trip before showing actions. History remains read-only and keeps the trip's stored historical labels.

- [ ] **Step 1: Add failing screen cases.** Cover Cargo driver + Passenger vehicle/trip and Passenger driver + Cargo vehicle/trip. Verify Map, Trips, trip detail, and direct Cargo deep links show the mismatch and no accept/start/cargo/passenger action. Verify valid Passenger and Cargo flows retain existing guest/VIP and shared supplies behavior.
- [ ] **Step 2: Run the affected mobile tests and confirm the new cases fail.** Run the focused workspace, Home, cargo view-model, cargo copy, verification-render, and mobile trip-feed suites.
- [ ] **Step 3: Wire the shared resolver into every entry point.** Keep the driver's fixed mode visible. For mismatches, disable actions and state that Dispatch must correct the driver, vehicle, or trip type. A direct route or deep link must not bypass this guard.
- [ ] **Step 4: Preserve separate source labels and shared cargo flow.** Use trusted service metadata for Hotel or Restaurant labels. Do not add a hotel-cargo versus restaurant-cargo screen split. Keep all current evidence, custody, and cargo lifecycle gates intact.
- [ ] **Step 5: Run focused mobile tests and commit.** Run the entire affected mobile test set plus the existing trip-feed tests. Commit with `fix: guard mobile trip actions by driver type`.

### Task 5: Enforce compatible pairings wherever staff assigns or changes a type

**Files:**
- Modify: `src/lib/trips/vehicle-load-compatibility.js` and its test
- Modify: `src/app/api/driver-assignments/route.js` and `src/app/api/driver-assignments/route.test.js`
- Modify: `"src/app/api/integration/transport-requests/[id]/assign/route.js"` and its test
- Modify: `"src/app/api/dispatch/[id]/route.js"`; create its focused route test if none exists
- Modify: `"src/app/api/drivers/[id]/route.js"` and its existing update test
- Verify: the dispatch recommendation/availability responses do not offer an incompatible pair

**Interface:** One shared server-side compatibility rule checks `driver_type`, vehicle `operational_use`, and, when assigning to a typed request, its `load_type`. The check uses database values, not client claims.

- [ ] **Step 1: Add failing shared-rule and boundary tests.** Cover the four matching/mismatching Passenger/Cargo combinations; missing or unsupported driver type; missing vehicle use; typed request mismatch; the limited legacy Passenger case; and a `force: true` attempt that must still fail for type mismatch. Cover custodial vehicle pairing, reservation assignment, dispatch reassignment, and editing `driver_type` while it would invalidate an active pairing or trip.
- [ ] **Step 2: Run focused tests and confirm the mismatches are currently accepted or unfiltered.** Run the helper, driver-assignment, reservation assignment, dispatch, and driver edit tests.
- [ ] **Step 3: Extend the shared helper.** Reuse `src/lib/trips/vehicle-load-compatibility.js` from the approved worktree and expand its contract to include `driverType`. Keep one pure evaluator rather than copy-pasting comparisons across routes.
- [ ] **Step 4: Enforce at final writes.** In each existing assignment transaction, re-read the driver's type, vehicle operational use, and request load type immediately before committing the pairing. Preserve the current transaction and row-lock order. Reject mismatches with 409; the dispatcher's manual `force` option may not bypass this rule. Filter incompatible suggestions where the current recommendation/availability response exposes the pair.
- [ ] **Step 5: Protect driver-type edits.** If staff changes a driver's type, reject the update with 409 when an active vehicle pairing or in-progress trip would become incompatible. Allow the change after the conflicting assignment is resolved through the existing approved reassignment workflow.
- [ ] **Step 6: Run all boundary tests and commit.** Commit only the helper, assignment routes/services, and tests with `fix: prevent incompatible driver vehicle assignments`.

### Task 6: Recheck compatibility on every server trip action

**Files:**
- Modify: `"src/app/api/trips/[id]/accept/route.js"` and its test
- Modify: `"src/app/api/mobile/driver/trips/[id]/accept/route.js"` and its test
- Modify: `"src/app/api/trips/[id]/start/route.js"` and its test
- Modify: `src/services/transition.service.js` and its test only if the existing transaction hook needs the check
- Reuse: `src/lib/trips/vehicle-load-compatibility.js`

- [ ] **Step 1: Add failing API tests.** For both accept routes and start, prove matching assignments proceed and every mismatch returns 409 before trip status changes. Include a forged client `driverType`; prove the API uses the authenticated driver's database classification. Include qualification and current state-machine regressions.
- [ ] **Step 2: Run the route tests and confirm the mismatch cases fail.** Run the focused accept, start, helper, and transition-service suites.
- [ ] **Step 3: Add the server check before every state write.** Load the authenticated driver's stored type, the trip's assigned vehicle use, and the persisted trip/request load type in the existing transaction path. Return a plain driver-readable 409 for mismatch and do not write trip state or cargo state. Keep existing state transition and qualification checks unchanged.
- [ ] **Step 4: Verify direct API calls cannot bypass the mobile screen.** Ensure web and mobile accept/start routes share the helper; do not rely on disabled buttons or client-side checks as authorization.
- [ ] **Step 5: Run focused API tests and commit.** Commit with `fix: reject trip actions for mismatched driver types`.

### Task 7: Document, run regression checks, and review mobile acceptance

**Files:**
- Update: `Capstone/02 - Features/Driver Management.md`
- Update: `Capstone/04 - Architecture/Mobile Architecture.md`
- Update: `SYSTEM.md`
- Update: `.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/progress.md` only if implementation is being tracked as a continuation there

- [ ] **Step 1: Update source-of-truth notes after implementation.** Record that Add Driver's saved fixed `driver_type` selects the mobile workspace; vehicle use and trip load type are enforced compatibility checks; Restaurant and Hotel supplies share Cargo; and missing/mismatched classifications block work. State that production cargo providers and source-image references remain disabled.
- [ ] **Step 2: Run the complete affected automated suites.** Run the workspace, Home, Clay, trip-screen, cargo-view-model, driver profile, driver assignment, dispatch assignment, trip accept/start, trip feed, qualification, and transition tests. Do not treat unrelated full-suite results as evidence for this feature.
- [ ] **Step 3: Run scoped lint and the Android JavaScript export.** From the repository root, run `npm run lint:ci -- mobile/lib/driver-workspace.js mobile/lib/driver-workspace.test.js "mobile/app/(app)/(tabs)/index.js" "mobile/app/(app)/(tabs)/map.js" "mobile/app/(app)/(tabs)/trips.js" "mobile/app/(app)/trip/[id].js" mobile/components/home/DriverHomeCards.jsx mobile/components/cargo/CargoWorkflowScreen.jsx mobile/lib/cargo-home-render.test.js mobile/lib/cargo-view-model.js mobile/lib/cargo-view-model.test.js mobile/lib/cargo-screen-copy.test.js mobile/lib/cargo-verification-render.test.js mobile/lib/driver-profile.js src/app/api/driver/me/route.js src/app/api/driver/me/route.test.js src/app/api/driver-assignments/route.js src/app/api/driver-assignments/route.test.js "src/app/api/integration/transport-requests/[id]/assign/route.js" "src/app/api/integration/transport-requests/[id]/assign/route.test.js" "src/app/api/dispatch/[id]/route.js" "src/app/api/dispatch/[id]/route.test.js" "src/app/api/drivers/[id]/route.js" "src/app/api/trips/[id]/accept/route.js" "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.js" "src/app/api/trips/[id]/start/route.test.js" src/lib/trips/vehicle-load-compatibility.js src/lib/trips/vehicle-load-compatibility.test.js, then from `mobile/` run `npx expo export --platform android --no-bytecode`. Require zero lint warnings and a successful export; this does not count as a native device test.
- [ ] **Step 4: Review the acceptance matrix on device or emulator.** Verify Cargo driver with Restaurant and Hotel examples, Passenger driver with guest and VIP examples, both driver/vehicle mismatch directions, both driver/trip mismatch directions, missing type, missing vehicle, profile loading, and offline cached profile. Confirm no mismatched operational action is enabled. Check safe areas, small and large phone widths, light/dark themes, large text, reduced motion, touch targets, and screen-reader labels. If no device/emulator is available, record that limit without claiming device acceptance.
- [ ] **Step 5: Review the final diff.** Run `git diff --check`, inspect the changed files for accidental changes outside this plan, and keep production provider, database migration, source-image, and policy activation out of scope.
- [ ] **Step 6: Commit the documentation and verification record.** Commit the Capstone notes, `SYSTEM.md`, and implementation progress entry with `docs: record driver-type mobile workspace routing`.

