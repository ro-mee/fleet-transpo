# Google Maps Navigation Handoff Implementation Plan

**Status (2026-10-16):** Source implementation is recorded on `codex/google-maps-handoff` and its descendant `codex/android-trip-bubble`. The original checklist is retained as the approved work breakdown; JavaScript verification is recorded in that branch's Tracking note, while physical Android acceptance remains pending. These plans are being committed on `feat/mechanic-integration` without merging the implementation branch.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an active FleetOps driver open the correct trusted pickup or destination in Google Maps while FleetOps verifiably continues background tracking and provides an Android notification return path.

**Architecture:** Consolidate mobile trip-phase decisions into one fail-closed pure helper, place external-navigation I/O behind a tested handoff function, and make the background tracker return explicit readiness results. Start tracking while FleetOps is still visible, retain the existing `AppState` merge safeguards, and ship without the overlay dependency.

**Tech Stack:** Expo SDK 54, React Native 0.81, Expo Router 6, `expo-location`, `expo-task-manager`, Vitest 3, Android foreground location service.

## Global Constraints

- Google Maps owns turn-by-turn navigation; FleetOps owns trip state, GPS reporting, and distance.
- Unknown, terminal, missing, invalid, or non-canonical targets fail closed.
- Passenger and Cargo use the same trip-phase and target resolver.
- Navigation must remain possible after an explicit warning when background permission is declined; the safe default is to stay in FleetOps.
- Starting external navigation must not mutate trip state.
- Foreground and background distance collectors must never run as two independent counters over the same interval.
- Do not log raw coordinates.
- No database migration, backend navigation table, or iOS overlay belongs in this release.
- Physical-device acceptance is required; Expo Go is not sufficient.

---

### Task 1: One fail-closed mobile trip-phase source

**Files:**
- Create: `mobile/lib/trip-navigation-phase.js`
- Create: `mobile/lib/trip-navigation-phase.test.js`
- Modify: `mobile/lib/navigation-route.js:3-11`
- Modify: `mobile/lib/background-tracking.js:31-50,236-241`
- Modify: `mobile/lib/navigation-route.test.js:125-136`
- Modify: `mobile/lib/background-tracking.test.js`

**Interfaces:**
- Produces: `navigationPhaseForStatus(status) -> "to_pickup" | "to_destination" | null`
- Produces: `legForNavigationPhase(phase) -> "leg1" | "leg2" | null`
- Produces: `legForStatus(status) -> "leg1" | "leg2" | null`
- Consumed by: `navigationTarget(trip)` and background tracking context.

- [ ] **Step 1: Write the failing phase-contract tests**

```js
import { describe, expect, it } from 'vitest';
import { navigationPhaseForStatus, legForStatus } from './trip-navigation-phase';

describe('mobile trip navigation phase', () => {
  it.each(['Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned', 'Dispatched', 'Driver Accepted', 'Trip Started', 'At Pickup'])(
    'maps %s to pickup and leg1', status => {
      expect(navigationPhaseForStatus(status)).toBe('to_pickup');
      expect(legForStatus(status)).toBe('leg1');
    }
  );
  it.each(['Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress'])(
    'maps %s to destination and leg2', status => {
      expect(navigationPhaseForStatus(status)).toBe('to_destination');
      expect(legForStatus(status)).toBe('leg2');
    }
  );
  it.each([null, '', 'Completed', 'Cancelled', 'Unexpected Status'])(
    'fails closed for %s', status => {
      expect(navigationPhaseForStatus(status)).toBeNull();
      expect(legForStatus(status)).toBeNull();
    }
  );
});
```

- [ ] **Step 2: Run the focused test and confirm the module is missing**

Run: `npm run test:run -- mobile/lib/trip-navigation-phase.test.js`

Expected: FAIL because `trip-navigation-phase.js` does not exist.

- [ ] **Step 3: Implement the pure status mapping**

```js
const TO_PICKUP = new Set([
  'Pending', 'Approved', 'Assigned', 'Vehicle Assigned', 'Driver Assigned',
  'Dispatched', 'Driver Accepted', 'Trip Started', 'At Pickup',
]);
const TO_DESTINATION = new Set([
  'Passenger Onboard', 'En Route', 'Drop-off', 'Arrived', 'In Progress',
]);

export function navigationPhaseForStatus(status) {
  if (TO_PICKUP.has(status)) return 'to_pickup';
  if (TO_DESTINATION.has(status)) return 'to_destination';
  return null;
}

export function legForNavigationPhase(phase) {
  if (phase === 'to_pickup') return 'leg1';
  if (phase === 'to_destination') return 'leg2';
  return null;
}

export function legForStatus(status) {
  return legForNavigationPhase(navigationPhaseForStatus(status));
}
```

- [ ] **Step 4: Replace both private status lists with the shared helper**

Update `navigationTarget(trip)` to return `null` when `navigationPhaseForStatus()` returns `null`, and select origin only for `to_pickup`. Import and re-export `legForStatus` from `background-tracking.js` temporarily so existing callers remain compatible.

- [ ] **Step 5: Prove the resolver and existing route tests pass**

Run: `npm run test:run -- mobile/lib/trip-navigation-phase.test.js mobile/lib/navigation-route.test.js mobile/lib/background-tracking.test.js`

Expected: all tests PASS, including unknown-status fail-closed coverage.

- [ ] **Step 6: Commit the phase boundary**

```bash
git add mobile/lib/trip-navigation-phase.js mobile/lib/trip-navigation-phase.test.js mobile/lib/navigation-route.js mobile/lib/navigation-route.test.js mobile/lib/background-tracking.js mobile/lib/background-tracking.test.js
git commit -m "refactor: share mobile trip navigation phase"
```

### Task 2: Shared Google Maps URL and launcher

**Files:**
- Create: `mobile/lib/external-navigation.js`
- Create: `mobile/lib/external-navigation.test.js`
- Modify: `mobile/lib/navigation-route.js:13-17`
- Modify: `mobile/lib/navigation-route.test.js:130-136`
- Modify: `mobile/app/(app)/(tabs)/vehicle.js:70-82`
- Modify: `mobile/components/map.js:136-146`
- Modify: `mobile/app/(app)/incident/navigate.js:203-213`

**Interfaces:**
- Consumes: `{ lat: number, lng: number }` from `navigationTarget`.
- Produces: `externalNavigationUrl(target) -> string | null`.
- Produces: `launchExternalNavigation(target, openUrl) -> Promise<{ ok: true } | { ok: false, reason: "invalid-target" | "open-failed" }>`.

- [ ] **Step 1: Extend URL tests with driving-navigation mode and encoded coordinates**

```js
expect(externalNavigationUrl({ lat: 14.6, lng: 121 })).toBe(
  'https://www.google.com/maps/dir/?api=1&destination=14.6%2C121&travelmode=driving&dir_action=navigate'
);
```

Also test `null`, `NaN`, latitude outside `[-90, 90]`, and longitude outside `[-180, 180]`.

- [ ] **Step 2: Write launcher failure tests**

```js
it('reports an invalid target without calling the platform', async () => {
  const openUrl = vi.fn();
  await expect(launchExternalNavigation(null, openUrl)).resolves.toEqual({ ok: false, reason: 'invalid-target' });
  expect(openUrl).not.toHaveBeenCalled();
});

it('reports a platform launch failure', async () => {
  const openUrl = vi.fn().mockRejectedValue(new Error('no handler'));
  await expect(launchExternalNavigation({ lat: 14.6, lng: 121 }, openUrl)).resolves.toEqual({ ok: false, reason: 'open-failed' });
});
```

- [ ] **Step 3: Run the focused tests red**

Run: `npm run test:run -- mobile/lib/navigation-route.test.js mobile/lib/external-navigation.test.js`

Expected: FAIL on the absent `dir_action`, encoding, and launcher module.

- [ ] **Step 4: Implement the launcher with injected platform I/O**

```js
import { externalNavigationUrl } from './navigation-route';

export async function launchExternalNavigation(target, openUrl) {
  const url = externalNavigationUrl(target);
  if (!url) return { ok: false, reason: 'invalid-target' };
  try {
    await openUrl(url);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'open-failed' };
  }
}
```

- [ ] **Step 5: Move the three remaining hand-written Google Maps URLs onto the shared builder**

Preserve each screen's existing target and error behavior. Do not make Incident or Vehicle use the active-trip resolver when their domain already supplies an explicit destination.

- [ ] **Step 6: Run all navigation consumers' tests and lint**

Run: `npm run test:run -- mobile/lib/navigation-route.test.js mobile/lib/external-navigation.test.js mobile/lib/map-webview-escaping.test.js`

Run: `npx eslint mobile/lib/navigation-route.js mobile/lib/external-navigation.js mobile/app/\(app\)/\(tabs\)/vehicle.js mobile/components/map.js mobile/app/\(app\)/incident/navigate.js`

Expected: tests and lint PASS.

- [ ] **Step 7: Commit the shared launcher**

```bash
git add mobile/lib/navigation-route.js mobile/lib/navigation-route.test.js mobile/lib/external-navigation.js mobile/lib/external-navigation.test.js mobile/app/'(app)'/'(tabs)'/vehicle.js mobile/components/map.js mobile/app/'(app)'/incident/navigate.js
git commit -m "feat: centralize Google Maps navigation launch"
```

### Task 3: Observable background-tracking readiness

**Files:**
- Modify: `mobile/lib/background-tracking.js:145-189`
- Modify: `mobile/lib/background-tracking.test.js`

**Interfaces:**
- Produces: `prepareBackgroundTracking({ tripId, leg, requestPermission }) -> Promise<{ ok: boolean; reason?: "unsupported" | "permission-denied" | "start-failed" }>`.
- Produces: `stopBackgroundTracking() -> Promise<{ ok: boolean; reason?: "stop-failed" }>`.
- Preserves: `updateLegContext`, `mergeStoredKm`, and the task name.

- [ ] **Step 1: Add Expo Location mocks for permission lookup and task state**

```js
getBackgroundPermissionsAsync: vi.fn(),
requestBackgroundPermissionsAsync: vi.fn(),
hasStartedLocationUpdatesAsync: vi.fn(),
startLocationUpdatesAsync: vi.fn(),
stopLocationUpdatesAsync: vi.fn(),
```

- [ ] **Step 2: Write failing readiness-result tests**

Cover these exact outcomes:

- already started returns `{ ok: true }` without starting twice;
- granted permission updates context before starting;
- `requestPermission: false` never opens a permission prompt;
- denied permission returns `{ ok: false, reason: 'permission-denied' }`;
- a native start exception returns `{ ok: false, reason: 'start-failed' }`;
- web returns `{ ok: false, reason: 'unsupported' }`.

- [ ] **Step 3: Run the background tests red**

Run: `npm run test:run -- mobile/lib/background-tracking.test.js`

Expected: FAIL because explicit readiness results do not exist.

- [ ] **Step 4: Implement permission-before-start and explicit results**

```js
export async function prepareBackgroundTracking({ tripId, leg, requestPermission = false }) {
  if (Platform.OS === 'web') return { ok: false, reason: 'unsupported' };
  await updateLegContext({ tripId, leg });
  const current = await Location.getBackgroundPermissionsAsync();
  const permission = current.status === 'granted' || !requestPermission
    ? current
    : await Location.requestBackgroundPermissionsAsync();
  if (permission.status !== 'granted') return { ok: false, reason: 'permission-denied' };
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
      await Location.startLocationUpdatesAsync(TASK_NAME, BACKGROUND_OPTIONS);
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'start-failed' };
  }
}
```

Extract the existing service options as `BACKGROUND_OPTIONS`. Keep the 10 m / 30 s cadence, balanced accuracy, automotive activity type, and foreground notification.

- [ ] **Step 5: Make stop observable without making cleanup noisy**

Return `{ ok: true }` when stopped or already absent, and `{ ok: false, reason: 'stop-failed' }` only for a real native failure. Existing callers may ignore the value.

- [ ] **Step 6: Run tests and lint**

Run: `npm run test:run -- mobile/lib/background-tracking.test.js mobile/lib/gps-odometer.test.js`

Run: `npx eslint mobile/lib/background-tracking.js mobile/lib/background-tracking.test.js`

Expected: PASS.

- [ ] **Step 7: Commit readiness reporting**

```bash
git add mobile/lib/background-tracking.js mobile/lib/background-tracking.test.js
git commit -m "fix: verify background tracking before navigation"
```

### Task 4: Ordered Map handoff with honest warnings

**Files:**
- Create: `mobile/lib/navigation-handoff.js`
- Create: `mobile/lib/navigation-handoff.test.js`
- Modify: `mobile/app/(app)/(tabs)/map.js:824-862,1387-1424,2169-2175`

**Interfaces:**
- Consumes: `navigationTarget`, `legForStatus`, `prepareBackgroundTracking`, `stopBackgroundTracking`, and `launchExternalNavigation`.
- Produces: `beginNavigationHandoff({ trip, requestPermission, openUrl }) -> Promise<{ ok: boolean; reason?: string; target?: object }>`.
- UI result reasons: `invalid-target`, `permission-denied`, `start-failed`, `open-failed`.

- [ ] **Step 1: Write the orchestration tests before editing the screen**

```js
it('starts tracking before opening Google Maps', async () => {
  const calls = [];
  const result = await beginNavigationHandoff({
    trip,
    prepare: async () => { calls.push('tracking'); return { ok: true }; },
    launch: async () => { calls.push('maps'); return { ok: true }; },
  });
  expect(result.ok).toBe(true);
  expect(calls).toEqual(['tracking', 'maps']);
});
```

Also prove invalid targets never request permission, tracking failure never opens Maps, and Maps failure calls the injected rollback exactly once.

- [ ] **Step 2: Run the handoff tests red**

Run: `npm run test:run -- mobile/lib/navigation-handoff.test.js`

Expected: FAIL because the handoff module is absent.

- [ ] **Step 3: Implement the pure orchestration seam**

Keep React Native APIs injected so the order and failure paths are testable without rendering the Map screen.

- [ ] **Step 4: Replace `openExternalNavigation` in Map with an async guarded action**

Disable the button while the handoff is running. On `permission-denied` or `start-failed`, show:

```text
Background tracking unavailable

FleetOps cannot confirm live tracking while Google Maps is open.

[Stay in FleetOps] [Open Maps without live tracking]
```

The safe/default action is **Stay in FleetOps**. The secondary action launches Maps only after the driver's explicit choice. Invalid targets retain the current Dispatch-verification message. Launch failure reports that Google Maps could not be opened.

- [ ] **Step 5: Change the AppState fallback to never request permission in background**

Use `prepareBackgroundTracking({ ..., requestPermission: false })` from the background transition. Preserve the existing before-start and during-start stale-trip guards and the stop-then-merge ordering on foreground return.

- [ ] **Step 6: Add source-based tests for the warning buttons and stale guards**

Extend the current VM-style Map tests to verify:

- the safe button does not open Maps;
- the explicit secondary button does;
- repeated taps are locked;
- completion during permission/start prevents launch;
- foreground return while start is pending stops the task.

- [ ] **Step 7: Run focused tests and lint**

Run: `npm run test:run -- mobile/lib/navigation-handoff.test.js mobile/lib/navigation-route.test.js mobile/lib/background-tracking.test.js`

Run: `npx eslint mobile/lib/navigation-handoff.js mobile/lib/navigation-handoff.test.js mobile/app/\(app\)/\(tabs\)/map.js`

Expected: PASS.

- [ ] **Step 8: Commit the ordered handoff**

```bash
git add mobile/lib/navigation-handoff.js mobile/lib/navigation-handoff.test.js mobile/app/'(app)'/'(tabs)'/map.js
git commit -m "feat: add reliable Google Maps handoff"
```

### Task 5: Return and stale-trip recovery

**Files:**
- Modify: `mobile/app/(app)/(tabs)/map.js:848-858`
- Modify: `mobile/lib/navigation-route.test.js`
- Modify: `mobile/lib/background-tracking.js:86-139`
- Modify: `mobile/lib/background-tracking.test.js`

**Interfaces:**
- Consumes: GPS response `{ success: true, tracked: false, reason: "trip-not-live" }`.
- Produces: cleared background context and stopped task for a trip the server no longer considers live.

- [ ] **Step 1: Write a failing background-task test for `trip-not-live`**

Mock the GPS post to resolve with `{ success: true, tracked: false, reason: 'trip-not-live' }`. Assert that stored `tripId`, `leg`, `prev`, and `pending` are cleared and no distance is added for that fix.

- [ ] **Step 2: Write a foreground-return refresh test**

Assert that return to `active` performs `stop -> merge for expected trip -> loadTrip`, in that order, and cannot merge another trip's stored distance.

- [ ] **Step 3: Run the tests red**

Run: `npm run test:run -- mobile/lib/background-tracking.test.js mobile/lib/navigation-route.test.js`

Expected: FAIL on stale-trip cleanup and/or foreground refresh order.

- [ ] **Step 4: Await the trip-scoped GPS result inside the task**

When the server returns `tracked: false`, clear the context before accumulation and stop future task delivery. Network failure remains non-queued and does not fabricate a terminal trip result.

- [ ] **Step 5: Reload authoritative trip state after foreground merge**

Call the existing `loadTrip()` only after stop and merge settle. Retain the request/session guards so an older reload cannot replace a newer driver or trip.

- [ ] **Step 6: Run lifecycle regressions**

Run: `npm run test:run -- mobile/lib/background-tracking.test.js mobile/lib/navigation-route.test.js mobile/lib/gps-odometer.test.js mobile/lib/tracking.test.js`

Expected: PASS, including existing no-double-count and completion-race tests.

- [ ] **Step 7: Commit stale-trip recovery**

```bash
git add mobile/lib/background-tracking.js mobile/lib/background-tracking.test.js mobile/app/'(app)'/'(tabs)'/map.js mobile/lib/navigation-route.test.js
git commit -m "fix: stop background tracking for ended trips"
```

### Task 6: Automated release gate

**Files:**
- Create: `mobile/lib/navigation-release.test.js`
- Verify: `mobile/app.json`

**Interfaces:**
- Verifies the complete Release 1 contract without changing production interfaces.

- [ ] **Step 1: Add a release-contract test**

The test must assert:

- the URL contains `api=1`, encoded destination coordinates, `travelmode=driving`, and `dir_action=navigate`;
- pickup and destination use the same status authority as `leg1` and `leg2`;
- terminal/unknown/untrusted targets do not launch;
- tracking is prepared before platform launch;
- a tracking failure requires an explicit override;
- app configuration retains background location and foreground-service permissions.

- [ ] **Step 2: Run all affected mobile tests**

Run: `npm run test:run -- mobile/lib`

Expected: all mobile library tests PASS.

- [ ] **Step 3: Run strict checks**

Run: `npm run lint:ci`

Run: `npm run verify:encoding`

Run: `git diff --check`

Expected: all commands PASS.

- [ ] **Step 4: Produce the Android JavaScript bundle**

Run from `mobile/`: `npx expo export --platform android --output-dir dist-navigation-check`

Expected: Android export completes with no missing module, route, or asset error. Remove only the exact generated `mobile/dist-navigation-check` directory after recording the result.

- [ ] **Step 5: Commit the automated release gate**

```bash
git add mobile/lib/navigation-release.test.js
git commit -m "test: gate external navigation release"
```

### Task 7: Physical Android acceptance and documentation

**Files:**
- Modify: `Capstone/02 - Features/Tracking.md`
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/04 - Architecture/Mobile Architecture.md`
- Modify: `Capstone/06 - Decisions/ADR/ADR-011 Background GPS Tracking.md`
- Modify: `SYSTEM.md`
- Modify: `docs/superpowers/plans/2026-10-14-google-maps-navigation-handoff.md`

**Interfaces:**
- Produces: recorded evidence and the go/no-go decision for the separate bubble plan.

- [ ] **Step 1: Install a fresh development build on a physical Android device**

Do not use Expo Go. Record Android version, device model, FleetOps build version, and whether battery optimization is enabled.

- [ ] **Step 2: Exercise the required drive matrix**

Verify all of the following with real movement:

1. Driver Accepted and Trip Started navigate to pickup.
2. Passenger Onboard, En Route, Drop-off, Arrived, and In Progress navigate to destination.
3. Cargo and Passenger use the same phase rules.
4. Google Maps begins navigation or route preview according to device location availability.
5. Dispatcher receives new fixes while Google Maps is foreground.
6. Per-leg distance grows once and does not jump on return.
7. The foreground-service notification returns to FleetOps.
8. Missing/untrusted coordinates do not open Maps.
9. Permission denial shows the honest warning and each choice behaves correctly.
10. Completion/cancellation removes trip-specific background work.

- [ ] **Step 3: Record measured evidence**

Document timestamps for the last FleetOps foreground fix, at least two background fixes, the first resumed fix, distance before/after, and any vendor battery restriction. Do not place raw coordinates in the note.

- [ ] **Step 4: Update the vault and ADR**

Record the implemented handoff, exact verification results, remaining device/vendor limits, and whether Release 2 is authorized. Update ADR-011 because tracking startup moves from background-only AppState timing to a user-visible preflight plus AppState fallback.

- [ ] **Step 5: Run documentation checks**

Run: `npm run verify:encoding`

Run: `git diff --check`

Expected: PASS.

- [ ] **Step 6: Commit the accepted Release 1 documentation**

```bash
git add 'Capstone/02 - Features/Tracking.md' 'Capstone/02 - Features/Trips.md' 'Capstone/04 - Architecture/Mobile Architecture.md' 'Capstone/06 - Decisions/ADR/ADR-011 Background GPS Tracking.md' SYSTEM.md docs/superpowers/plans/2026-10-14-google-maps-navigation-handoff.md
git commit -m "docs: record Google Maps handoff acceptance"
```

## Release 1 Exit Gate

Do not start the bubble plan until Task 7 has physical-device evidence and the user confirms that the notification return path is still insufficient for drivers.
