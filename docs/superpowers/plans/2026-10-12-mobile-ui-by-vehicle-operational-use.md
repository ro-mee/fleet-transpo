# Vehicle-Routed Driver Mobile Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Give each driver a mobile workspace that follows the operational use of the vehicle assigned to their current work: Cargo opens the shared hotel/restaurant cargo flow, while Passenger opens the hotel transportation flow.

**Architecture:** Use the current trip's assigned vehicle for trip screens; when there is no active trip on Home, use the driver's current standing vehicle assignment. The vehicle's `operational_use` selects the visual mode, and the saved trip `load_type` must agree before trip actions are allowed. Hotel and restaurant service codes change cargo source labels only; they do not create separate cargo workflows.

**Tech Stack:** Expo SDK 54, Expo Router 6, React Native, Next.js route handlers, PostgreSQL through the existing `pg` query layer, Vitest, and the existing Clay mobile design system in `mobile/lib/theme.js` and `mobile/components/clay/`.

## Global Constraints

- Keep the driver account role and shared Home / Map / Trips / Profile navigation unchanged.
- An active trip's own assigned vehicle takes priority for that trip; with no active Home trip, use the current standing assignment. Never use a completed trip to guess the current vehicle.
- Only explicit `Passenger` or `Cargo` vehicle use can select a workspace. A trip whose saved load type conflicts with its vehicle must show the vehicle's mode, explain the conflict, and disable accept/start/cargo/passenger actions.
- One Cargo mode serves both hotel and restaurant supplies. Use existing `service_code` / `service_name` values for source labels; never guess a source from cargo-description text.
- Keep current passenger guest/VIP behavior and cargo lifecycle rules. Do not change the canonical trip state machine, qualification policy, database schema, source-image policy, or production provider enablement.
- Preserve the documented legacy passenger presentation for rows without a typed load only when the assigned vehicle is explicitly Passenger. A Cargo vehicle with an untyped trip cannot enter cargo actions.
- Use the mobile Clay language already in the app: existing semantic theme tokens, warm ivory and forest palette, Plus Jakarta Sans, safe areas, readable hierarchy, thoughtful motion, and clear loading/empty/error/mismatch states. Do not apply web-only design tokens or add a UI dependency.
- Keep English copy plain and direct. Controls meet at least 44pt on iOS and 48dp on Android, work in light and dark themes, and remain usable with larger system text and reduced motion.
- Do not enable live cargo providers or source-image references as part of workspace routing. Demo scenarios remain read-only.

## File Map

- Create `mobile/lib/driver-workspace.js` and `mobile/lib/driver-workspace.test.js` for the pure vehicle-to-workspace decision.
- Modify `src/app/api/driver/me/route.js` and `src/app/api/driver/me/route.test.js` so the current standing assignment returns its operational use.
- Modify `mobile/app/(app)/(tabs)/index.js` and `mobile/components/home/DriverHomeCards.jsx` for the Home workspace presentation; extend `mobile/lib/cargo-home-render.test.js` for real-component copy checks.
- Modify `mobile/app/(app)/(tabs)/map.js`, `mobile/app/(app)/(tabs)/trips.js`, `mobile/app/(app)/trip/[id].js`, `mobile/components/cargo/CargoWorkflowScreen.jsx`, and `mobile/lib/cargo-view-model.js` so trip actions and direct cargo routes use the same compatibility rule. Extend their existing focused tests.
- Create `src/lib/trips/vehicle-load-compatibility.js` and its test; use it from both `src/app/api/trips/[id]/accept/route.js` and `src/app/api/mobile/driver/trips/[id]/accept/route.js`, plus `src/app/api/trips/[id]/start/route.js`, to reject incompatible assignments.
- Update `Capstone/04 - Architecture/Mobile Architecture.md` and `Capstone/02 - Features/Fleet And Vehicles.md` after implementation.

---

### Task 1: Define the workspace decision rule

**Files:**
- Create: `mobile/lib/driver-workspace.test.js`
- Create: `mobile/lib/driver-workspace.js`

**Interface:**
- Consumes: `resolveDriverWorkspace({ trip, assignedVehicle })`; `trip` is the exact active or opened trip, and `assignedVehicle` is the current profile assignment.
- Produces: `{ mode, tripReady, vehicleId, operationalUse, source, reason }`.
- `mode` is `"cargo"`, `"passenger"`, or `"unassigned"`; `source` is `"trip"`, `"standing_assignment"`, or `null`; `tripReady` is `true`, `false`, or `null` when no trip was supplied.
- `reason` is `null`, `"no_vehicle"`, `"missing_operational_use"`, `"missing_trip_type"`, or `"trip_type_mismatch"`.

- [x] **Step 1: Write the failing decision tests**

Cover: Cargo trip + Cargo vehicle returns Cargo mode; Passenger trip + Passenger vehicle returns Passenger mode; hotel and restaurant service codes both return the same Cargo mode; a trip's vehicle wins over a different standing assignment; mismatch keeps the vehicle-selected mode but sets `tripReady: false`; no vehicle or unsupported operational use returns `unassigned`; and a standing assignment works when no trip is supplied. Include the legacy case: an untyped trip on an explicitly Passenger vehicle remains Passenger, while an untyped trip on a Cargo vehicle is blocked.

- [x] **Step 2: Run the focused test and confirm the missing-module failure**

Run: `npm run test:run -- mobile/lib/driver-workspace.test.js`

Expected: FAIL because `driver-workspace.js` does not exist.

- [x] **Step 3: Implement and export the resolver as a named ES module function to match the mobile import contract.**

Read vehicle use from `trip.operational_use` / `trip.operationalUse` when a trip is supplied and from `assignedVehicle.operational_use` / `assignedVehicle.operationalUse` when no trip is supplied. A supplied trip with no `vehicle_id` must return `no_vehicle`; do not fall back to the standing assignment. Map only exact Passenger/Cargo values. Compare a typed trip's `load_type` with vehicle use; on mismatch preserve the mode from vehicle use and return `tripReady: false`. Do not read `service_code`, source text, or driver role to choose the mode.

- [x] **Step 4: Run the focused test and confirm all cases pass**

Run: `npm run test:run -- mobile/lib/driver-workspace.test.js`

Expected: PASS for all table-driven cases.

- [x] **Step 5: Commit the decision contract**

Run: `git add mobile/lib/driver-workspace.js mobile/lib/driver-workspace.test.js`

Then commit with: `test: define vehicle-routed driver workspace`

### Task 2: Return operational use for the standing assignment

**Files:**
- Modify: `src/app/api/driver/me/route.js`
- Modify: `src/app/api/driver/me/route.test.js`
- Verify: `src/app/api/mobile/driver/trips/route.js` and `src/app/api/mobile/driver/trips/route.test.js`

**Interface:**
- Home receives the standing assignment as `assignedVehicle.operationalUse`.
- Trip rows continue to receive `operational_use` from the already-existing trip vehicle join.

- [x] **Step 1: Add a failing profile contract assertion**

In the existing driver profile route test, make the assigned-vehicle fixture include `operational_use: "Cargo"` and assert the response includes `assignedVehicle.operationalUse === "Cargo"`. Assert the assigned-vehicle SELECT includes `v.operational_use`. In the mobile trips route test, assert the existing trip row preserves `operational_use: "Cargo"`.

- [x] **Step 2: Run the profile route test and confirm it fails**

Run: `npm run test:run -- src/app/api/driver/me/route.test.js`

Expected: FAIL because the standing-assignment query and response omit operational use.

- [x] **Step 3: Add the field to the existing query and response**

Select `v.operational_use` with the assigned vehicle and serialize it as `operationalUse` next to `vehicleId`, `plateNumber`, and `model`. Do not return a second vehicle lookup.

- [x] **Step 4: Verify both mobile wire shapes**

Run: `npm run test:run -- src/app/api/driver/me/route.test.js src/app/api/mobile/driver/trips/route.test.js`

Expected: PASS; the profile returns camelCase operational use and each mobile trip row retains snake_case operational use.

- [x] **Step 5: Commit the profile contract**

Run: `git add src/app/api/driver/me/route.js src/app/api/driver/me/route.test.js`

Then commit with: `feat: expose assigned vehicle operational use`

### Task 3: Give Home a distinct Cargo or Passenger workspace

**Files:**
- Modify: `mobile/app/(app)/(tabs)/index.js`
- Modify: `mobile/components/home/DriverHomeCards.jsx`
- Modify: `mobile/lib/cargo-home-render.test.js`
- Verify: `mobile/lib/driver-workspace.test.js`

**Interface:**
- Home calls `resolveDriverWorkspace({ trip: activeTrip, assignedVehicle: driverProfile?.assignedVehicle })`.
- Add an exported `DriverWorkspaceCard({ workspace, trip, assignedVehicle })` to `DriverHomeCards.jsx`.

- [x] **Step 1: Add failing rendered-component cases**

Extend the existing static-render test to check that Cargo mode displays a clear Cargo vehicle/work label, cargo description and declared weight, and a Hotel or Restaurant source label from service metadata; it must not render guest name or passenger count. Check Passenger mode displays the hotel transportation and guest information. Check unassigned and mismatch states show a plain explanation and no enabled trip action.

- [x] **Step 2: Run the Home rendering test and confirm the new cases fail**

Run: `npm run test:run -- mobile/lib/cargo-home-render.test.js`

Expected: FAIL because the mode-specific workspace card and blocked-state copy do not exist.

- [x] **Step 3: Add the mode-aware Home card**

Build `DriverWorkspaceCard` from existing Clay cards, theme tokens, type styles, and vector icons. Show a visible mode label and assigned plate. Cargo mode prioritizes manifest/source, weight, and pickup/delivery progress; Passenger mode prioritizes guest transfer details and preserves any existing VIP cue. Source-specific labels use only service metadata. A mismatch keeps the vehicle-selected mode visible but locks actions and says the saved trip type does not match the vehicle. An absent assignment or operational use shows a neutral Fleet/Dispatch next step.

- [x] **Step 4: Route Home through the resolver and verify the rendered cases**

Render the workspace card using the active trip first and the standing assignment only when there is no active trip. Keep existing navigation, loading/error/offline banners, and shared safety actions. Never resolve Home mode from a completed trip.

Run: `npm run test:run -- mobile/lib/cargo-home-render.test.js mobile/lib/driver-workspace.test.js`

Expected: PASS for Cargo, Passenger, source-label, mismatch, and unassigned states.

- [x] **Step 5: Commit the Home workspace**

Run: `git add "mobile/app/(app)/(tabs)/index.js" mobile/components/home/DriverHomeCards.jsx mobile/lib/cargo-home-render.test.js`

Then commit with: `feat: route driver home by vehicle use`

### Task 4: Apply the same rule to trip screens and cargo actions

**Files:**
- Modify: `mobile/app/(app)/(tabs)/map.js`
- Modify: `mobile/app/(app)/(tabs)/trips.js`
- Modify: `mobile/app/(app)/trip/[id].js`
- Modify: `mobile/components/cargo/CargoWorkflowScreen.jsx`
- Modify: `mobile/lib/cargo-view-model.js`
- Modify: `mobile/lib/cargo-view-model.test.js`
- Modify: `mobile/lib/cargo-screen-copy.test.js`
- Modify: `mobile/lib/cargo-verification-render.test.js`
- Modify: `src/app/api/mobile/driver/trips/route.js`
- Modify: `src/app/api/mobile/driver/trips/route.test.js`

**Interface:**
- Every trip-specific screen calls `resolveDriverWorkspace({ trip })` for that exact trip.
- Keep `isCargoLoad(trip)`, `tripStatusLabel`, and stored `load_type` as the source for trip-specific content and historical labels; workspace mode adds compatibility validation.

- [x] **Step 1: Add failing mismatch coverage**

Add cases proving that Cargo vehicle + Passenger trip and Passenger vehicle + Cargo trip both show a named mismatch and expose no accept/start/cargo CTA. Add cases proving a valid Cargo trip still opens the current cargo pickup/delivery route and a valid Passenger trip retains the current guest flow. Add a direct cargo-route test proving it cannot open cargo actions for a Passenger or mismatched trip.

- [x] **Step 2: Run the focused mobile tests and confirm the mismatch cases fail**

Run: `npm run test:run -- mobile/lib/cargo-view-model.test.js mobile/lib/cargo-screen-copy.test.js mobile/lib/cargo-verification-render.test.js src/app/api/mobile/driver/trips/route.test.js`

Expected: FAIL because trip screens currently trust load type without checking the assigned vehicle's use.

- [x] **Step 3: Guard each trip-specific action surface**

In Map, trip details, Trips cards, and the cargo view model, show the mode from that trip's vehicle and disable operational actions when `tripReady` is false. In `CargoWorkflowScreen.jsx`, apply the `readCargoScreenSources()` gate before showing overview, pickup, or delivery actions so direct deep links receive the same protection as the Map button. Keep existing state-transition labels and geofence/cargo gates for matching trips. Keep History read-only and preserve its stored trip type labels.

- [x] **Step 4: Run the focused mobile suite**

Run: `npm run test:run -- mobile/lib/cargo-view-model.test.js mobile/lib/cargo-screen-copy.test.js mobile/lib/cargo-verification-render.test.js mobile/lib/cargo-home-render.test.js mobile/lib/driver-workspace.test.js src/app/api/mobile/driver/trips/route.test.js`

Expected: PASS; matching trips keep current behavior and mismatches cannot expose operational actions.

- [x] **Step 5: Commit the trip screen guards**

Run: `git add "mobile/app/(app)/(tabs)/map.js" "mobile/app/(app)/(tabs)/trips.js" "mobile/app/(app)/trip/[id].js" mobile/components/cargo/CargoWorkflowScreen.jsx mobile/lib/cargo-view-model.js mobile/lib/cargo-view-model.test.js mobile/lib/cargo-screen-copy.test.js mobile/lib/cargo-verification-render.test.js src/app/api/mobile/driver/trips/route.js src/app/api/mobile/driver/trips/route.test.js`

Then commit with: `fix: guard trip screens against vehicle type mismatch`

### Task 5: Enforce vehicle/load compatibility on the server

**Files:**
- Modify: `src/app/api/trips/[id]/accept/route.js`
- Create: `src/app/api/trips/[id]/accept/route.test.js`
- Modify: `src/app/api/mobile/driver/trips/[id]/accept/route.js`
- Create: `src/app/api/mobile/driver/trips/[id]/accept/route.test.js`
- Modify: `src/app/api/trips/[id]/start/route.js`
- Modify: `src/app/api/trips/[id]/start/route.test.js`
- Modify: `src/services/transition.service.js`
- Modify: `src/services/transition.service.test.js`
- Create: `src/lib/trips/vehicle-load-compatibility.js`
- Create: `src/lib/trips/vehicle-load-compatibility.test.js`

- [x] **Step 1: Write failing server tests**

For `checkVehicleLoadCompatibility({ loadType, operationalUse })`, test the matching Cargo/Passenger pairs, typed mismatches, missing/unsupported use, a Cargo vehicle with an untyped request, and an untyped legacy request with a Passenger vehicle. For both accept endpoints and the start endpoint, test matching pairs and confirm every rejected case returns HTTP 409 before any trip state transition or cargo action.
Test that the regular accept route's compatibility callback runs inside the shared transition write path before its trip update, without changing callers that do not provide the callback.

- [x] **Step 2: Run the route tests and confirm the mismatch cases fail**

Run: `npm run test:run -- "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.test.js" src/lib/trips/vehicle-load-compatibility.test.js`

Expected: FAIL because accept/start do not currently compare request load type with the assigned vehicle's operational use.

- [x] **Step 3: Add one shared compatibility check**

Implement `src/lib/trips/vehicle-load-compatibility.js` with `checkVehicleLoadCompatibility({ loadType, operationalUse })`, returning `{ ok: true, reason: null }` or `{ ok: false, reason: "missing_operational_use" | "unknown_load_type" | "type_mismatch" | "cargo_requires_typed_load" }`. Require a valid `Passenger` or `Cargo` operational use. Typed requests require an exact match. Preserve the existing untyped legacy Passenger path only when operational use is explicitly Passenger; reject unknown load types and untyped Cargo requests. Both accept routes read the current request type and assigned vehicle use from the database inside the acceptance write path, before status mutation. The start route reads the same pair from the database and checks it before its trip write. Return 409 with a driver-readable reason and do not add a migration.
The regular accept route supplies the compatibility read through a narrow optional `beforeWrite` callback on `setTripStatus`; invoke it inside the existing write/transaction path immediately before the transition write. Existing callers without the option keep the same behavior.

- [x] **Step 4: Run route tests and existing trip presentation tests**

Run: `npm run test:run -- "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.test.js" src/lib/trips/vehicle-load-compatibility.test.js src/lib/trips/load-presentation.test.js src/services/transition.service.test.js`

Expected: PASS; matching transitions work, mismatch transitions do not write, and legacy Passenger labels remain unchanged.

- [x] **Step 5: Commit the server gate**

Run: `git add "src/app/api/trips/[id]/accept/route.js" "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.js" "src/app/api/trips/[id]/start/route.test.js" src/services/transition.service.js src/services/transition.service.test.js src/lib/trips/vehicle-load-compatibility.js src/lib/trips/vehicle-load-compatibility.test.js`

Then commit with: `fix: reject incompatible driver trip assignments`

### Task 6: Document, verify, and review the complete flow

**Files:**
- Modify: `Capstone/04 - Architecture/Mobile Architecture.md`
- Modify: `Capstone/02 - Features/Fleet And Vehicles.md`
- Modify: `SYSTEM.md` with the completed implementation and verification record.
- Update: `.superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/progress.md` with the completed Task 14 verification ledger entry.
- Add: `docs/superpowers/plans/2026-10-12-mobile-ui-by-vehicle-operational-use.md` as the reviewed implementation-plan artifact.

- [x] **Step 1: Update the source-of-truth notes**

Record that vehicle operational use selects the driver workspace, Passenger means hotel guest transportation, and Cargo means the one shared hotel/restaurant cargo workflow. Record that source labels do not choose the flow, trip type must match vehicle use before actions, and missing/mismatched assignments direct the driver to Fleet/Dispatch. State that no live cargo provider or source-image policy changed.

- [x] **Step 2: Run all affected tests**

Run: `npm run test:run -- mobile/ src/app/api/driver/me/route.test.js src/app/api/mobile/driver/trips/route.test.js "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.test.js" src/lib/trips/vehicle-load-compatibility.test.js src/lib/trips/load-presentation.test.js src/services/transition.service.test.js`

Expected: PASS for the complete mobile regression and affected API contracts.

- [x] **Step 3: Run lint and Android bundle export**

Run from the repository root: `npm run lint:ci -- mobile/lib/driver-workspace.js mobile/lib/driver-workspace.test.js mobile/lib/cargo-home-render.test.js "mobile/app/(app)/(tabs)/index.js" mobile/components/home/DriverHomeCards.jsx "mobile/app/(app)/(tabs)/map.js" "mobile/app/(app)/(tabs)/trips.js" "mobile/app/(app)/trip/[id].js" mobile/components/cargo/CargoWorkflowScreen.jsx mobile/lib/cargo-view-model.js mobile/lib/cargo-view-model.test.js mobile/lib/cargo-screen-copy.test.js mobile/lib/cargo-verification-render.test.js src/app/api/driver/me/route.js src/app/api/driver/me/route.test.js src/app/api/mobile/driver/trips/route.js src/app/api/mobile/driver/trips/route.test.js "src/app/api/trips/[id]/accept/route.js" "src/app/api/trips/[id]/accept/route.test.js" "src/app/api/mobile/driver/trips/[id]/accept/route.js" "src/app/api/mobile/driver/trips/[id]/accept/route.test.js" "src/app/api/trips/[id]/start/route.js" "src/app/api/trips/[id]/start/route.test.js" src/services/transition.service.js src/services/transition.service.test.js src/lib/trips/vehicle-load-compatibility.js src/lib/trips/vehicle-load-compatibility.test.js`

Then run from `mobile/`: `npx expo export --platform android --no-bytecode`.

Expected: zero lint warnings and a successful Android JavaScript bundle export. This is not a native-device test.

- [x] **Step 4: Complete the visual and behavior acceptance matrix**

On an Android device or emulator, verify a Cargo vehicle with a hotel supply trip, a Cargo vehicle with a restaurant supply trip, a Passenger vehicle with a guest trip, a VIP guest trip where existing data provides the cue, each mismatch direction, and a missing vehicle use. Confirm Cargo source labels differ while Cargo workflow stays the same; mismatch and missing states have no active trip action. Check a 375px phone, a larger phone, landscape, light and dark themes, large system text, reduced motion, safe areas, screen-reader labels, and touch targets. If no native device is available, record that limitation and rely on automated checks and export without claiming device acceptance.

- [x] **Step 5: Check the final diff and commit documentation**

Run: `git diff --check`

Then run: `git add "Capstone/04 - Architecture/Mobile Architecture.md" "Capstone/02 - Features/Fleet And Vehicles.md" SYSTEM.md docs/superpowers/plans/2026-10-12-mobile-ui-by-vehicle-operational-use.md .superpowers/sdd/2026-10-09-driver-qualifications-cargo-verification/progress.md`

Commit with: `docs: record vehicle-routed mobile workspace`
