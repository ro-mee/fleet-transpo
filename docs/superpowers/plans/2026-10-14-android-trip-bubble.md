# Android Active-Trip Bubble Implementation Plan

**Status (2026-10-16):** The related `codex/android-trip-bubble` branch reports Tasks 1-4 implemented and automated JavaScript checks completed. Native compilation, a fresh APK and every physical acceptance item remain pending; its latest note records an Expo cloud-upload approval hold. The original checklist is retained as a work breakdown, not a release-acceptance record. This commit records the plan without merging, building or uploading that branch.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional Android-only floating FleetOps shortcut that returns the driver from Google Maps to the authoritative active trip without owning tracking or trip workflow.

**Architecture:** Implement a local Expo module whose Kotlin service owns only Android overlay permission, a 56 dp draggable window, edge snapping, and a deep-link `PendingIntent`. A small JavaScript controller owns active-trip and foreground/background lifecycle, while the existing background GPS service remains completely independent.

**Tech Stack:** Expo SDK 54 local module, Kotlin, Android `WindowManager`, `TYPE_APPLICATION_OVERLAY`, Expo Router deep links, Vitest, Android JUnit.

## Global Constraints

- This plan is blocked until the Google Maps Navigation Handoff plan passes its physical Android exit gate.
- Android only; iOS receives no imitation overlay.
- Overlay permission is optional and is never requested at application startup.
- Navigation and background GPS must work when overlay permission is denied.
- The bubble displays no passenger, cargo, route, phone, or coordinate data.
- The bubble contains no state-changing trip action and no expanded quick panel.
- The bubble must not start, stop, or supervise GPS tracking.
- The service uses `START_NOT_STICKY`; a killed process must not resurrect a stale trip bubble on its own.
- A fresh FleetOps launch hides stale overlay state before restoring the authoritative trip.

---

### Task 1: Local Expo module and durable manifest source

**Files:**
- Create: `mobile/modules/fleetops-trip-bubble/package.json`
- Create: `mobile/modules/fleetops-trip-bubble/expo-module.config.json`
- Create: `mobile/modules/fleetops-trip-bubble/index.ts`
- Create: `mobile/modules/fleetops-trip-bubble/src/FleetOpsTripBubble.types.ts`
- Create: `mobile/modules/fleetops-trip-bubble/src/FleetOpsTripBubbleModule.ts`
- Create: `mobile/modules/fleetops-trip-bubble/android/build.gradle`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/AndroidManifest.xml`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/java/expo/modules/fleetopstripbubble/FleetOpsTripBubbleModule.kt`
- Modify: `mobile/app.json:14-23`

**Interfaces:**
- Produces the JavaScript bridge `FleetOpsTripBubble`.
- Produces native async functions `canDrawOverlays`, `openOverlaySettings`, `showTripBubble`, and `hideTripBubble`.

- [ ] **Step 1: Scaffold a local Android-only Expo module**

Run from `mobile/`: `npx create-expo-module@latest --local --platform android`

Name the module `fleetops-trip-bubble` and native class `FleetOpsTripBubbleModule`. Keep only the generated files listed above; do not add an iOS implementation.

- [ ] **Step 2: Define the typed bridge contract**

```ts
export type ShowTripBubbleResult = {
  shown: boolean;
  reason?: 'unsupported' | 'permission-denied' | 'invalid-trip' | 'start-failed';
};

export type FleetOpsTripBubbleModuleEvents = Record<string, never>;
```

- [ ] **Step 3: Make overlay permission survive clean prebuilds**

Add `android.permission.SYSTEM_ALERT_WINDOW` to `expo.android.permissions` in `mobile/app.json`. Keep the module service declaration in the module's own manifest so Android manifest merging remains the source of truth.

```xml
<service
  android:name=".FleetOpsTripBubbleService"
  android:exported="false"
  android:stopWithTask="true" />
```

- [ ] **Step 4: Implement permission and service bridge calls**

Use `Settings.canDrawOverlays(context)` and `Settings.ACTION_MANAGE_OVERLAY_PERMISSION`. Validate `tripId.isNotBlank()` before starting the service. `showTripBubble` returns a result rather than throwing for permission denial.

- [ ] **Step 5: Verify autolinking and the merged manifest**

Run from `mobile/`: `npx expo prebuild --platform android --no-install`

Run from `mobile/android/`: `./gradlew :app:processDebugMainManifest`

Expected: the merged manifest contains one `SYSTEM_ALERT_WINDOW` permission and one non-exported bubble service.

- [ ] **Step 6: Commit the bridge scaffold**

```bash
git add mobile/modules/fleetops-trip-bubble mobile/app.json mobile/android/app/src/main/AndroidManifest.xml
git commit -m "feat: scaffold Android trip bubble module"
```

### Task 2: Minimal draggable overlay service

**Files:**
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/java/expo/modules/fleetopstripbubble/FleetOpsTripBubbleService.kt`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/java/expo/modules/fleetopstripbubble/BubblePosition.kt`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/test/java/expo/modules/fleetopstripbubble/BubblePositionTest.kt`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/res/drawable/fleetops_trip_bubble_background.xml`
- Create: `mobile/modules/fleetops-trip-bubble/android/src/main/res/drawable/fleetops_trip_bubble_icon.xml`

**Interfaces:**
- Consumes intent actions `SHOW` with `tripId` and `HIDE`.
- Produces one `TYPE_APPLICATION_OVERLAY` window and a `fleetops:///redirect-trip?tripId=<tripId>` tap intent.

- [ ] **Step 1: Write pure edge-snap tests**

```kotlin
@Test fun snapsLeftBeforeMidpoint() {
  assertEquals(0, BubblePosition.snapX(currentX = 200, bubbleWidth = 56, screenWidth = 1080))
}

@Test fun snapsRightAfterMidpoint() {
  assertEquals(1024, BubblePosition.snapX(currentX = 800, bubbleWidth = 56, screenWidth = 1080))
}

@Test fun clampsVerticalPosition() {
  assertEquals(24, BubblePosition.clampY(currentY = -100, topInset = 24, bottomLimit = 1800))
}
```

- [ ] **Step 2: Run the Kotlin tests red**

Run from `mobile/android/`: `./gradlew :fleetops-trip-bubble:testDebugUnitTest`

Expected: FAIL because `BubblePosition` is absent.

- [ ] **Step 3: Implement position math as a pure Kotlin object**

Keep screen/inset measurement outside the pure helper. Clamp the full 56 dp bubble inside visible bounds.

- [ ] **Step 4: Implement the overlay window**

Use:

```kotlin
WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
PixelFormat.TRANSLUCENT
```

Render a circular 56 dp FleetOps icon with elevation. Interpret movement inside Android's touch-slop as a tap; otherwise drag vertically and snap horizontally on release.

- [ ] **Step 5: Implement the safe deep-link tap**

Create an immutable/update-current `PendingIntent` for `fleetops:///redirect-trip?tripId=<encodedTripId>`. The triple slash makes `redirect-trip` an Expo Router path instead of an Android URI host. Do not place trip labels or private data in the intent extras or overlay view.

- [ ] **Step 6: Make show/hide idempotent**

Repeated SHOW updates the trip intent without adding a second window. HIDE removes the window if present and calls `stopSelf()`. `onDestroy()` removes the window defensively.

- [ ] **Step 7: Run Kotlin tests and assemble**

Run from `mobile/android/`: `./gradlew :fleetops-trip-bubble:testDebugUnitTest :app:assembleDebug`

Expected: PASS and debug APK produced.

- [ ] **Step 8: Commit the native bubble**

```bash
git add mobile/modules/fleetops-trip-bubble/android
git commit -m "feat: add minimal Android trip bubble"
```

### Task 3: JavaScript permission and lifecycle controller

**Files:**
- Create: `mobile/lib/trip-bubble.js`
- Create: `mobile/lib/trip-bubble.test.js`
- Modify: `mobile/app/(app)/(tabs)/map.js`

**Interfaces:**
- Produces: `tripBubbleAvailability() -> Promise<{ available: boolean; reason?: string }>`.
- Produces: `requestTripBubblePermission() -> Promise<{ granted: boolean }>`.
- Produces: `showTripBubble(tripId) -> Promise<{ shown: boolean; reason?: string }>`.
- Produces: `hideTripBubble() -> Promise<void>`.

- [ ] **Step 1: Write platform and bridge tests**

Test Android granted, Android denied, iOS/web unsupported, invalid trip ID, native rejection normalization, and idempotent hide.

- [ ] **Step 2: Run the tests red**

Run: `npm run test:run -- mobile/lib/trip-bubble.test.js`

Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement the thin platform wrapper**

```js
export async function showTripBubble(tripId) {
  if (Platform.OS !== 'android') return { shown: false, reason: 'unsupported' };
  if (tripId == null || String(tripId).trim() === '') return { shown: false, reason: 'invalid-trip' };
  try {
    return await FleetOpsTripBubble.showTripBubble(String(tripId));
  } catch {
    return { shown: false, reason: 'start-failed' };
  }
}
```

- [ ] **Step 4: Add an optional first-use explanation to the Navigate flow**

Only after Release 1 tracking preflight succeeds, check overlay permission. If absent, explain:

```text
Keep FleetOps within reach

FleetOps can show a small shortcut while you use Google Maps. Navigation and live tracking still work without it.

[Not now] [Open Android settings]
```

Returning from Settings must recheck permission. Do not assume it was granted. Continue Maps navigation whether the driver grants, declines, or backs out.

- [ ] **Step 5: Tie visibility to the existing AppState listener**

Show only after the external-navigation handoff requested a bubble and the app actually leaves the foreground with the same live trip. Hide before foreground distance merge when FleetOps becomes active.

- [ ] **Step 6: Run focused tests and lint**

Run: `npm run test:run -- mobile/lib/trip-bubble.test.js mobile/lib/navigation-handoff.test.js mobile/lib/navigation-route.test.js`

Run: `npx eslint mobile/lib/trip-bubble.js mobile/lib/trip-bubble.test.js mobile/app/\(app\)/\(tabs\)/map.js`

Expected: PASS.

- [ ] **Step 7: Commit the JavaScript controller**

```bash
git add mobile/lib/trip-bubble.js mobile/lib/trip-bubble.test.js mobile/app/'(app)'/'(tabs)'/map.js
git commit -m "feat: connect trip bubble to navigation lifecycle"
```

### Task 4: Deep-link restoration and stale overlay cleanup

**Files:**
- Create: `mobile/app/redirect-trip.js`
- Create: `mobile/lib/trip-deep-link.js`
- Create: `mobile/lib/trip-deep-link.test.js`
- Modify: `mobile/app/_layout.js`
- Modify: `mobile/app/(app)/(tabs)/map.js`
- Modify: `mobile/lib/background-tracking.js`
- Modify: `mobile/lib/background-tracking.test.js`

**Interfaces:**
- Consumes: `fleetops:///redirect-trip?tripId=<tripId>`.
- Produces: an authenticated redirect to the current active trip/Map, never blind trust in the URL trip ID.
- Produces: overlay hide on local terminal state and server `trip-not-live` response.

- [ ] **Step 1: Write deep-link parsing and authorization tests**

```js
expect(parseTripDeepLink('fleetops:///redirect-trip?tripId=701')).toEqual({ tripId: '701' });
expect(parseTripDeepLink('fleetops:///redirect-trip')).toBeNull();
expect(resolveTripReturnRoute({ requestedId: '701', activeTripId: '701' })).toBe('/(app)/(tabs)/map');
expect(resolveTripReturnRoute({ requestedId: '701', activeTripId: '702' })).toBe('/(app)/(tabs)/map');
```

The deep link chooses a return surface; server-loaded active state remains authoritative.

- [ ] **Step 2: Run tests red**

Run: `npm run test:run -- mobile/lib/trip-deep-link.test.js`

Expected: FAIL because the parser/resolver is absent.

- [ ] **Step 3: Implement the authenticated redirect route**

The route reads the requested ID for diagnostics only, reloads the current trip through existing authenticated app state, and routes to Map. It must not render or mutate a foreign/ended trip based solely on the URL.

- [ ] **Step 4: Hide stale overlays at every authoritative boundary**

Call `hideTripBubble()` on:

- root launch before restoring navigation;
- logout/session loss;
- Map foreground return;
- local completed/cancelled event;
- a GPS response with `tracked: false` and `reason: 'trip-not-live'`;
- failure to restore a matching active trip.

- [ ] **Step 5: Add race tests**

Cover completion while SHOW is pending, foreground return while SHOW is pending, another trip replacing the requested trip, and a late HIDE after service teardown. Final state must have no visible bubble.

- [ ] **Step 6: Run lifecycle regressions**

Run: `npm run test:run -- mobile/lib/trip-deep-link.test.js mobile/lib/trip-bubble.test.js mobile/lib/background-tracking.test.js mobile/lib/navigation-route.test.js`

Expected: PASS.

- [ ] **Step 7: Commit restoration and cleanup**

```bash
git add mobile/app/redirect-trip.js mobile/app/_layout.js mobile/app/'(app)'/'(tabs)'/map.js mobile/lib/trip-deep-link.js mobile/lib/trip-deep-link.test.js mobile/lib/trip-bubble.js mobile/lib/trip-bubble.test.js mobile/lib/background-tracking.js mobile/lib/background-tracking.test.js
git commit -m "fix: remove stale trip bubbles across lifecycle changes"
```

### Task 5: Bubble release gate and documentation

**Files:**
- Modify: `Capstone/02 - Features/Tracking.md`
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/04 - Architecture/Mobile Architecture.md`
- Modify: `SYSTEM.md`
- Modify: `docs/superpowers/plans/2026-10-14-android-trip-bubble.md`

**Interfaces:**
- Produces the Android-only acceptance record; changes no runtime interface.

- [ ] **Step 1: Run automated checks**

Run: `npm run test:run -- mobile/lib`

Run: `npm run lint:ci`

Run: `npm run verify:encoding`

Run: `git diff --check`

Run from `mobile/android/`: `./gradlew :fleetops-trip-bubble:testDebugUnitTest :app:assembleDebug`

Expected: all commands PASS.

- [ ] **Step 2: Test permission behavior on a physical Android device**

Verify first request explanation, Settings handoff, grant, denial, backing out, later revocation, and no repeated prompts. Navigation and GPS must remain functional in every overlay-permission outcome.

- [ ] **Step 3: Test overlay behavior over Google Maps**

Verify 56 dp appearance, touch target, vertical drag, left/right snap, no accidental tap after drag, no obstruction of critical Google Maps controls, and tap-to-return.

- [ ] **Step 4: Test lifecycle cleanup**

Verify FleetOps foreground, completion, cancellation, remote `trip-not-live`, logout, app process removal, phone lock/unlock, rotation, and fresh launch. Record any Android-vendor battery or overlay restrictions.

- [ ] **Step 5: Test accessibility and safety**

Verify content description, TalkBack focus, large-font independence, high-contrast icon visibility, and that no private trip data or state-changing action appears in the overlay.

- [ ] **Step 6: Update vault documentation and the plan status**

Record exact device evidence and remaining limitations. State explicitly that overlay availability does not prove tracking availability and that force-stop still ends tracking under ADR-011.

- [ ] **Step 7: Commit accepted bubble documentation**

```bash
git add 'Capstone/02 - Features/Tracking.md' 'Capstone/02 - Features/Trips.md' 'Capstone/04 - Architecture/Mobile Architecture.md' SYSTEM.md docs/superpowers/plans/2026-10-14-android-trip-bubble.md
git commit -m "docs: record Android trip bubble acceptance"
```
