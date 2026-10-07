# Map Tutorial Off-Duty Preview Implementation Plan

> **For Codex:** Follow this plan task-by-task and obey the repository policy in `.agents/AGENTS.md`. Keep the Map tutorial local-only and update the linked Capstone notes after implementation.

**Goal:** Let a first-time driver complete the existing Map tutorial from Off Duty, Rest Day, or On Leave, then return to the exact status-aware Map empty state.

**Architecture:** Add a narrowly-scoped tutorial preview exception to the Map screen's empty-state render branch. Keep the resolved duty state intact so existing trip-fetch and GPS guards remain active; show a neutral basemap and the already-existing Map tutorial targets and local practice sandbox while the tutorial is pending or active. Finishing or skipping the existing `map_intro` milestone removes the exception, so the normal empty-state screen renders again.

**Tech Stack:** Expo Router, React Native, existing `CoachMarkProvider` / `CoachMarkTarget`, `TomTomMap`, Vitest, ESLint.

---

**Plan status:** Proposed; no application code or runtime behavior has changed yet.  
**Date:** 2026-10-03  
**Related notes:** [[First-Time Interactive Live Map Tutorial Implementation Plan]], [[Driver In-App Guide]], [[Mobile Architecture]], [[Trips]]

## Confirmed current behavior

- `map_intro` starts after an intentional Map-tab press when the current driver's existing completion key is absent.
- `mobile/app/(app)/(tabs)/map.js` resolves `emptyStateKey` and returns the full-screen empty state before reaching the normal Map JSX. That JSX contains `map.standby_status`, `map.controls`, `map.layers`, and `map.trip_practice`, so the guide can show its tooltip without those targets being mounted.
- The Map screen already gates trip loading/polling and the location watcher on `emptyStateKey`. The preview must preserve those gates while changing only which UI branch renders.
- The existing five-step `MapIntroPractice` is local-only. Keep its state transitions and the existing completion / Skip semantics.

## User-visible behavior contract

1. A first intentional Map-tab visit with an incomplete `map_intro` temporarily shows a clearly labeled **Map preview** when the driver resolves to `off_duty`, `rest_day`, or `on_leave`.
2. The preview mounts the existing coach-mark targets and the five-stage local practice sandbox. Use a neutral basemap without a live driver marker or operational assignment markers. Label the screen **Map preview**; the header and first tooltip must not claim that live tracking is running, and the tooltip should clarify that the current position appears during an active shift.
3. Keep the actual duty state non-operational throughout the preview. Do not request location permission, start a GPS/heading watcher, load or poll trips, change duty, or call trip / dispatch mutation APIs because of the tutorial.
4. **Finish Tour** and **Skip Tour** retain their current persistence semantics. Once the milestone closes, the ordinary status-aware Map empty state appears immediately.
5. Later Map visits continue to show the ordinary empty state. Existing active-trip Map behavior, the `live_trip` guide, the Map-tab trigger, other coach marks, and duty-state precedence stay unchanged.

## Implementation tasks

### Task 1: Pin tutorial-preview eligibility

**Files:**

- Modify: `mobile/lib/map-intro.js`
- Modify: `mobile/lib/map-intro.test.js`

**Steps:**

1. Add a failing table-driven test for a small pure helper, e.g. `shouldShowMapIntroPreview({ emptyStateKey, activeMilestone, mapIntroPending })`.
2. The helper returns `true` only when `emptyStateKey` is one of the known non-operational states and either the Map-intro reservation is pending or `activeMilestone === "map_intro"`.
3. Pin all three states (`off_duty`, `rest_day`, `on_leave`), both pending and active cases, and negative cases for a completed/no-longer-active tutorial, an unrelated milestone, or no empty state.
4. Run the focused test and confirm the new cases fail before implementing the helper, then pass after the implementation.

### Task 2: Render the preview while retaining off-duty guards

**Files:**

- Modify: `mobile/app/(app)/(tabs)/map.js`
- Modify: `mobile/lib/coach-marks.js` only if the current first-step copy needs to be made accurate for the preview
- Modify: `mobile/lib/map-empty-state.test.js`

**Steps:**

1. Derive the preview flag from `emptyStateKey`, `activeMilestone`, and `mapIntroPending` using the helper from Task 1.
2. Change only the full-screen empty-state return condition: keep that return for non-operational states when no Map tutorial preview is pending or active; otherwise continue into the existing no-active-trip Map layout so its real target wrappers and practice sandbox mount.
3. Keep `emptyStateKey` truthy during the preview. Do not change the existing guards around `loadTrip`, its 15-second refresh, or the foreground-location and heading watchers.
4. In the preview branch, render an explicit neutral label such as **Map preview** / **Tutorial only** instead of **Locating vehicle**, **Live Tracking**, or another live-status claim. Keep the basemap location generic and pass no driver or operational markers.
5. Make recenter harmless without a driver fix (no permission request); the Layers interaction may remain local to the preview. Do not wire any production trip action to tutorial progression.
6. If the duty-resolution placeholder (`isDutyResolving`) can still return before the tutorial targets mount on a first Map visit, let the pending / active Map tutorial use the same preview shell there. Do not alter the ordinary duty-resolution placeholder for other visits.
7. Extend `map-empty-state.test.js` or nearby source-level regression coverage to pin both sides of the render rule: normal visits retain all three existing empty states; pending/active `map_intro` reaches the preview; after completion/skip the empty state is restored.
8. If the first `map_intro` tooltip says live location is already visible, revise that copy to say the current position appears during an active shift. Keep the copy accurate for both the preview and a real operational Map.

### Task 3: Verify lifecycle, safety boundaries, and regressions

**Files:**

- Modify: `mobile/lib/coach-marks.test.js` only for a missing lifecycle regression assertion
- Modify: `mobile/lib/map-intro.test.js`
- Modify: `mobile/lib/map-empty-state.test.js`

**Steps:**

1. Verify the existing driver-scoped `map_intro` completion key and version are unchanged.
2. Verify Finish and Skip close the tutorial and restore the duty empty state without changing duty or marking `live_trip` complete.
3. Verify a pending/active tutorial does not bypass the `emptyStateKey` guards for trip load/refresh or GPS/heading subscriptions.
4. Verify `MapIntroPractice` remains local-only and its five successful swipes are the only practice progression path.
5. Verify on-duty/no-active-trip and active-trip Maps still render their existing controls and current-trip guide targets.

### Task 4: Update the source-of-truth notes

**Files:**

- Update: `Capstone/07 - Development/First-Time Interactive Live Map Tutorial Implementation Plan.md`
- Update: `Capstone/02 - Features/Driver In-App Guide.md`
- Update: `Capstone/04 - Architecture/Mobile Architecture.md`
- Update: `SYSTEM.md`

**Steps:**

1. Record that the tutorial preview exception applies only while `map_intro` is pending or active over a non-operational empty state.
2. Document the preserved duty, trip-fetch, and GPS boundaries and the return-to-empty-state behavior.
3. Record verification results only after the implementation checks below have actually passed. Keep this plan marked proposed until then.

## Verification plan

Run from the repository root:

```powershell
node node_modules\vitest\vitest.mjs run mobile/lib/map-intro.test.js mobile/lib/map-empty-state.test.js mobile/lib/coach-marks.test.js --no-cache --configLoader runner
npx.cmd eslint "mobile/app/(app)/(tabs)/map.js" mobile/lib/map-intro.js mobile/lib/map-intro.test.js mobile/lib/map-empty-state.test.js mobile/lib/coach-marks.test.js --max-warnings 0
```

Run the Android JS export from `mobile/`:

```powershell
npx.cmd expo export --platform android --no-bytecode
```

Manual device acceptance:

1. On a fresh driver or after Reset In-App Tips, confirm the driver is Off Duty and tap the Map tab.
2. Confirm the Map preview and first tooltip both appear with correctly measured targets, with no location permission prompt, vehicle marker, or live-tracking claim.
3. Complete the three explanatory steps and all five local swipes. Confirm the practice advances locally and creates no trip, dispatch, or duty change.
4. Repeat with Skip Tour. In both completion paths, confirm the correct Off Duty empty state returns immediately.
5. Reopen Map after completion and confirm it stays on the Off Duty empty state without replaying `map_intro`.
6. Repeat the empty-state return check for Rest Day and On Leave; smoke-check on-duty standby and active-trip behavior for regressions.

## Out of scope

- Changing the duty-state resolver, duty check-in/out workflow, or status precedence.
- Changing `map_intro` trigger eligibility, driver-scoped persistence, version, Skip behavior, or `live_trip` scheduling.
- Requesting GPS or showing fabricated driver, trip, dispatch, fuel-station, or tracking data in the preview.
- Adding backend state, a database migration, a new tutorial engine, or a new dependency.
- Redesigning the status-aware empty-state screens.
