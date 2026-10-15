---
type: decision
status: accepted
date: 2026-08-19
tags: [decision, adr, mobile, gps, background]
source:
  - mobile/lib/background-tracking.js
  - mobile/app/(app)/(tabs)/map.js
  - mobile/app.json
last_verified: 2026-08-19
supersedes: "[[ADR-010 Foreground Only GPS]]"
---

# ADR-011: Background GPS Tracking

## Context

ADR-010 kept tracking foreground-only because background updates need a custom dev build plus Play Store review. The app has now moved to a dev build (background location requires it), which collapses the "no build pipeline" argument for staying foreground-only.

The operational cost of foreground-only is that tracking and per-leg km stop whenever the driver backgrounds the app or locks the phone — which is exactly what a shuttle driver does when they open Google Maps or the phone sleeps mid-trip.

## Decision

**Keep the foreground watcher AND the existing headless background task**, with user-visible navigation readiness and an `AppState` fallback:

- `expo-task-manager` defines task `fleetops-background-location` in `mobile/lib/background-tracking.js`.
- The task posts the fix to the same endpoints the foreground uploader uses and accumulates per-leg haversine km into AsyncStorage (`fleetops_bg_tracking`).
- `mobile/app/(app)/(tabs)/map.js` prepares it before external navigation and also wires it via `AppState`:
  - Google Maps action → validate trip/target, prepare tracking with permission opt-in, recheck the current session/trip/status/target, then launch. Unavailable tracking shows Stay Here first; only explicit Continue Without Tracking bypasses readiness. Trip GPS still starts only from Driver Accepted onward.
  - other background exit + active trip → update context, recheck trip, then `prepareBackgroundTracking` with `requestPermission: false`; a foreground return or ended trip during startup stops the task
  - foreground → stop the task and `mergeStoredKm(distRef)` into the same ref the watcher accumulates, clearing `prev` synchronously to avoid double-counting the gap
- The task ignores delivery while the app is active and rechecks after reading its stored context, preventing preflight registration from duplicating foreground GPS/distance.
- Trip/leg context is kept in sync on every trip or status change so the backgrounded task accumulates the correct leg and posts to the correct trip endpoint.

The foreground watcher stays the source of truth; the background task only fills the gap while backgrounded.

## Why preflight plus AppState (not always-on)

Always-on background tracking would run the headless task even when idle. Navigation preflight makes registration failure visible before leaving FleetOps; AppState covers other exits without opening a permission prompt in the background. The same task is reused, foreground delivery is ignored, and return stops it before merging distance. The permission workflow holds a tap lock, including its warning decision; hardware Back releases it safely. Registration readiness does not prove that a device or battery policy will deliver background fixes.

Automated verification on 2026-10-15: strict test-first handoff, warning, cancellation and foreground-overlap checks passed with all 1,045 mobile library tests across 76 suites. Physical Android launch, notification return, background fix delivery and no-jump distance acceptance remain pending.

Task 4 review follow-up: ordinary tracking transitions are serialized. The handoff waits for prior cleanup and owns readiness/rollback until launch settles; permission-related foreground returns cannot race its native start. A true Maps return during a pending platform promise is cleaned up by that owner after settlement. Replacement of its warning runs dismissal cleanup once and cannot leave background fallback suppressed. The five new RED/GREEN reproductions pass with all 1,050 mobile tests across 76 suites; physical acceptance remains pending.

Task 4 second-departure correction: owner return cleanup also joins the ordered tracking queue. A background departure during its pending native stop or distance merge queues the ordinary permission-free fallback behind cleanup instead of being discarded by the navigation lock. Ownership releases before the queued fallback rechecks the current trip/status and app state; returning, cancelling or reassigning while it waits prevents an obsolete restart. The existing task and exact-once stop-before-merge boundary remain unchanged. The second-departure reproduction failed before the fix; five new timing/stale-work cases pass with 128/128 focused Task 4 tests and all 1,055 mobile tests across 76 suites. Physical device acceptance remains pending.

Task 5 return recovery (2026-10-15): background GPS now awaits the server response and clears/stops the existing task on explicit `tracked: false` before accumulating that fix. Network errors remain non-queued and do not imply trip completion. Deliveries, context changes and merges serialize their storage work. Ordinary and late platform-launch foreground returns retain the ordered stop/merge boundary, capture the returning accumulator and trip, then refresh the canonical assignment. The live trip ref changes immediately on an accepted refresh, with existing request/session fencing; Passenger and Cargo share the same recovery and next-target rules. Strict RED/GREEN reproductions plus all 1,068 mobile tests across 76 suites and touched-file strict lint passed. Physical Android acceptance remains open.

## Costs / trade-offs — accepted

- **Requires a custom dev build** (background location is not supported in Expo Go): `expo prebuild --clean` + reinstall. ADR-010's blocker.
- **Android background location needs Play Store review** with a justification when releasing to production.
- **iOS requires "Allow Always" location permission** — a more intrusive prompt some users decline.
- **Battery/data**: a foreground service notification is shown while backgrounded; updates run at `Balanced` accuracy, `distanceInterval: 10`, `timeInterval: 30s` (same cadence as the foreground uploader).
- **App killed by the OS/user while backgrounded** → that stretch of GPS and km is lost. The task does not survive a force-stop.
- Per-leg km still relies on `trip_status`; a trip that completes while the app is backgrounded cannot be completed from the background task.

## Revisit if

- A full track history (route replay) is needed — currently only the latest fix per trip is retained on the server.
- The always-on, app-killed-immune case matters — would need a full foreground service strategy rather than the background task.

## Related

[[Tracking]] · [[Mobile Architecture]] · [[ADR-010 Foreground Only GPS]] · [[Decision Log]] · [[Trips]]
