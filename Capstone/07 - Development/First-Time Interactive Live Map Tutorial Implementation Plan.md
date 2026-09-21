---
type: plan
status: implemented-source-hardened
tags: [plan, mobile, driver, map, coachmarks, onboarding]
last_verified: 2026-09-21
---

# First-Time Interactive Live Map Tutorial Implementation Plan

Date: 2026-09-20  
Status: Implemented; source hardening verified 2026-09-21. APK rebuild and device acceptance are pending explicit approval.

## Implementation result — 2026-09-20

The map-only `map_intro` milestone is implemented. It starts only from the
intentional Map-tab handler, keeps the existing `live_trip` milestone and
production trip swipe path separate, and uses a local-only five-stage practice
surface. Driver-scoped completion still uses the existing coach-mark storage.

The active-trip branch has no standby radar Layers control, so the Map screen
keeps `map_intro` as the owner, anchors the first two explanations to the
existing route-sheet components, and uses a read-only tutorial preview for the
Layers explanation. This avoids a missing-target wedge without changing a
production action or another tooltip.

## Scope guarantee

This is a map-only coach-mark addition. The existing `welcome`, `live_trip`, inspection, trip-readiness, fuel, incident, SOS, offline, and other tooltip definitions must remain behaviorally unchanged.

The existing `live_trip` milestone remains the real-trip guide with these targets:

- `map.current_target`
- `map.telemetry`
- `map.trip_progression`

No existing target ID, copy, completion key, production swipe callback, or non-map trigger will be replaced or overloaded.

## Goal

Add a first-time interactive Live Map tour that appears after the driver intentionally taps the Map tab when its driver-scoped completion key is absent, and teaches the real swipe interaction through a local-only sandbox.

Expected sequence:

`Map tab tap → Your Live Map → Stay oriented → Choose what you see → How your trip works → five local right swipes → You’re ready → Finish Tour`

Navigation must continue immediately; the tutorial may claim the milestone while the Map targets mount.

## Current architecture constraints

- `CurvedPillTabBar` owns the actual tab press and already preserves the normal `tabPress`/`navigate` flow.
- `CoachMarkProvider` owns driver-scoped completion, route matching, target registration, the no-preemption rule, and the Driving Safety Lock.
- `map.js` currently triggers `live_trip` from active-trip state. That trigger must be gated only while the new `map_intro` is pending or visible, then retried once after `map_intro` is dismissed or completed.
- The standby Map currently has the real Live Tracking header, the three-button control group, and the Layers control. The active-trip branch has separate floating controls and the existing real trip progression target.
- `SwipeButton.js` fires production trip mutations through its callback. It may be used as a visual/gesture reference only; its production callback must never be passed into tutorial practice.
- No haptics package is installed. Use the already-available React Native platform primitive for a short success pulse; do not add a dependency for this tooltip.

## Implemented changes

### 1. Add a separate milestone

Add `MAP_INTRO` to `mobile/lib/coach-marks.js`:

- `key: "map_intro"`
- `version: 1`
- `route: "/map"`
- completion through the existing `coach-mark-storage` functions
- driver-isolated key: `fleetops.guide.map_intro.v1_{driverId}`

The configuration will contain the three explanatory steps, five swipe-gated practice steps, and a final `Finish Tour` step. Existing `LIVE_TRIP` configuration is left untouched.

New target IDs:

- `map.standby_status` — exact existing standby status header
- `map.controls` — exact existing Map control group
- `map.layers` — exact existing Layers control
- `map.trip_practice` — the new local tutorial sandbox

The Map screen must continue to wrap each exact component with `CoachMarkTarget`; the WebView and arbitrary coordinates are never targets.

### 2. Trigger only from an intentional Map-tab press

Add a map-specific provider action, exposed alongside the existing context API, for `CurvedPillTabBar` to call only when `routeName === "map"` inside `handleTabPress`.

The action will:

1. Check the current visible-guide no-preemption rule.
2. Check the existing per-driver `map_intro` completion key.
3. Reserve a short-lived Map-intro pending state before the asynchronous storage read can race with `live_trip`.
4. Allow the existing navigation event and `navigation.navigate("map")`/fallback `router.push(...)` to proceed without waiting.
5. Claim `map_intro` after the storage check only when it is still eligible.

`map.js` will never use `useFocusEffect` or a generic screen-focus event to start `map_intro`. Programmatic navigation therefore cannot count as the first intentional Map exploration.

The pending state is map-specific and additive. Existing calls to `triggerMilestone(...)` keep their current behavior.

### 3. Prevent `live_trip` from preempting the new Map tour

Update only the Map screen/provider coordination:

- While the Map-intro reservation or active milestone exists, the existing `live_trip` effect returns without claiming anything.
- Once `map_intro` changes to `null` after `Finish Tour` or Skip Tour, the active-trip effect gets one safe retry.
- If `map_intro` is already completed, `live_trip` keeps its current behavior.
- `map_intro` is a UI walkthrough and does not wait for motion state; the existing driving lock remains in effect for the other coach-mark milestones.
- No other milestone is reordered or given priority over another.

This specifically closes the async race between the Map-tab tap and the current `activeTrip` effect without changing the generic tooltip scheduler.

### 4. Add exact Map targets without changing Map behavior

In `mobile/app/(app)/(tabs)/map.js`:

- Wrap the existing standby header in `CoachMarkTarget targetId="map.standby_status"`.
- Wrap the existing standby control cluster in `CoachMarkTarget targetId="map.controls"`.
- Wrap only the existing Layers control in `CoachMarkTarget targetId="map.layers"`.
- Add the local practice surface under `CoachMarkTarget targetId="map.trip_practice"`.
- Preserve the existing `map.current_target`, `map.telemetry`, and `map.trip_progression` wrappers exactly.
- Do not call `recenter`, `setLegendExpanded`, `toggleCoverage`, or any production map action from a coach-mark step.

The active-trip branch does not expose the standby radar Layers control. If the first Map tap lands on an active trip, `map_intro` remains the owner: the existing route-sheet header and controls are spotlighted, and a read-only tutorial-only Layers preview supplies the missing explanatory target. After `Finish Tour`, the existing `live_trip` path can trigger for the real trip.

### 5. Add a local-only practice sandbox

Create one map-specific component, preferably `mobile/components/MapIntroPractice.jsx`, containing the tutorial state and an isolated swipe control. Keep the component out of the production trip-action path.

Local state only:

`start → pickup → guest → destination → dropoff → complete`

For every stage:

- require a rightward gesture using the production proportions, threshold, thumb motion, and reset behavior as visual references;
- show a compact lifecycle indicator (`Start`, `Pickup`, `Guest`, `Destination`, `Done`);
- show success/check styling and a short 350–500 ms transition;
- emit one local stage transition only after a successful swipe;
- reset the thumb on an early/failed release;
- support screen-reader activation through the same local transition path;
- respect reduced-motion preferences;
- never import the production trip API or call any trip, dispatch, reservation, GPS, geofence, odometer, incident, or notification endpoint.

The final local state shows the restrained `You’re ready` message and `Finish Tour`. Only that final action calls the existing coach-mark completion path for `map_intro`. Skip uses the current completion semantics for this milestone only and never marks `live_trip` complete.

### 6. Add the smallest opt-in coach-mark engine support

The current tooltip primary CTA can advance a step. Practice steps therefore need a narrowly scoped opt-in guard:

- Add an optional step property such as `requiresInteraction`.
- Default it to `false`, preserving every current tooltip exactly.
- Set it only on `map_intro` practice steps.
- `nextStep()` does nothing for a guarded step until `notifyInteraction("map.trip_practice", ...)` confirms that stage’s successful local swipe.
- Add an optional map-only back-navigation flag if needed so explanatory steps can go Back while an in-progress physical practice stage cannot be accidentally skipped or rewound.

No existing tooltip gets a new requirement, new target, new button behavior, or new storage behavior.

## Implementation order

1. Add the `MAP_INTRO` config and verify the existing `LIVE_TRIP` object is byte-for-byte behaviorally unchanged.
2. Add the opt-in provider reservation/interaction guard with defaults that preserve current milestones.
3. Add the Map-tab trigger while keeping navigation code and event emission intact.
4. Add the four new Map target wrappers and the gated `live_trip` retry.
5. Add the isolated local practice component and connect only its final completion to the provider.
6. Run focused tests, the mobile library suite, and ESLint on touched files.
7. Update the driver guide and system notes only after implementation verification.

## Verification record

### Automated

- `map_intro` key/version/route and all four target IDs are registered.
- Existing `live_trip` key, version, route, copy, and three target IDs remain present.
- Storage is driver-isolated, versioned, resettable through Reset Tips, and naturally fresh after uninstall/reinstall.
- A Map-tab press triggers the new path; programmatic Map navigation does not.
- GPS permission, GPS readiness, and moving state do not suppress the first Map walkthrough.
- An open/pending `map_intro` prevents `live_trip` from preempting; `live_trip` becomes available after completion/skip.
- Failed swipe resets; one successful swipe advances exactly one local stage.
- `MapIntroPractice` has no production trip API import or mutation callback.
- Completion storage is written only after `Finish Tour` (or the explicitly retained Skip Tour semantics).
- Existing real `SwipeButton` callbacks and trip API branches are unchanged.
- Reduced-motion and light/dark token paths remain valid.
- Target measurement remains exact, positive-sized, route-scoped, and free of stale registrations.
- Existing coach-mark tests remain green.

### Commands run

- `node node_modules\\vitest\\vitest.mjs run mobile/lib --no-cache --configLoader runner` — 25 files / 201 tests
- `npx.cmd eslint` on every touched mobile file with `--max-warnings 0` — clean
- `npx.cmd expo export --platform android --no-bytecode` from `mobile/` — 1,387 modules bundled
- manual first-install path: Home → intentional Map tap → three explanations → five right swipes → Finish Tour remains the device acceptance path

### Results

- Mobile library suite: 25 files / 201 tests passed.
- Touched-file ESLint: passed with `--max-warnings 0`.
- Android export with `--no-bytecode`: passed; 1,387 modules bundled.
- Standard Hermes Android export remains environment-blocked by Windows `hermesc.exe` permission denied; this is not a source failure.
- No connected native device was available for the manual first-install visual path.

## Documentation after implementation

`Capstone/02 - Features/Driver In-App Guide.md`, `Capstone/04 - Architecture/Mobile Architecture.md`, and `SYSTEM.md` were updated with the verified Map-intro behavior, active-trip fallback, touched files, and test results.

## Explicitly out of scope

- changing any non-Map tooltip;
- changing Home’s welcome trigger;
- replacing or extending the production trip swipe callback;
- changing trip/GPS/background tracking/geofence/arrival override/API behavior;
- adding backend tutorial state or fake trips/data;
- adding a new tooltip persistence system;
- adding a new dependency solely for the tutorial;
- adding confetti, mascots, gamification, or a separate onboarding screen.

### Post-release Map marker fix (2026-09-20)

The downloaded preview APK exposed a separate cold-start issue: `map.js` waited for a fresh highest-accuracy location before publishing the own-vehicle marker or establishing the watcher. The implementation now applies an 8-second timeout and a recent cached-location fallback before using the same watcher and odometer logic. The final correction also reserves Map intent before `tabPress` emission and gives the coach overlay Android elevation above the native TomTom WebView. These are Map reliability fixes only; they do not alter other tooltip definitions or production trip callbacks.

Verification: focused coach-mark/Map-intro tests 56/56, touched Map ESLint clean, Android export successful with 1,387 modules, and final EAS preview build `2dea7830-a960-4fd4-8e5c-4f11168ce7dd` finished successfully. Final APK: https://expo.dev/artifacts/eas/9CcUWryae0tYqy6s0SgRvNDB5QCI2liNFy_HZp5PjvY.apk

### Source hardening after downloaded-APK report (2026-09-21)

The downloaded preview APK still showed neither the first Map spotlight nor the own-vehicle car. The source-level causes were separate:

- the normal GPS spinner returned before `CoachMarkTarget` instances could mount;
- after Reset In-App Tips, Home's Welcome card could still own the full-screen overlay when the driver intentionally tapped Map;
- Android WebView could reject the local `file://` car image URI after the marker was created.

The source correction mounts the Map shell while `map_intro` is pending or active, lets an intentional Map-tab tap hand off only from the reset-triggered Welcome card, keeps that Welcome-only scrim pass-through for navigation, validates the fresh-fix result before trying the cached fix, and retains the original radar-dot fallback when the bundled PNG is unavailable. These changes add no watcher, polling loop, API request, dependency, fake release radar data, or change to the production trip swipe path.

Verification: touched-file ESLint passed and focused coach-mark/Map-intro tests passed 60/60. No EAS rebuild was run after this correction because the user explicitly requested that rebuilding wait; native APK visual acceptance is pending the user's rebuild instruction.

### Simplified first-install trigger (2026-09-21)

The first Map walkthrough now uses the intentionally simple eligibility rule:
an intentional Map-tab tap plus no completed `map_intro` key for the current
driver. It does not wait for GPS, location permission, or motion state; those
only affect the live vehicle marker and production tracking. Existing non-Map
coach marks and the real-trip guide retain their existing behavior.

Verification: focused coach-mark/Map-intro tests passed **60/60** and touched
source ESLint passed. No rebuild or EAS command was run.
