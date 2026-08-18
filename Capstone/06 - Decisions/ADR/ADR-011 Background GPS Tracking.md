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

**Keep the foreground watcher AND add a headless background task**, driven by `AppState` so the two never run simultaneously (no double-counted km, no duplicate GPS posts):

- `expo-task-manager` defines task `fleetops-background-location` in `mobile/lib/background-tracking.js`.
- The task posts the fix to the same endpoints the foreground uploader uses and accumulates per-leg haversine km into AsyncStorage (`fleetops_bg_tracking`).
- `mobile/app/(app)/(tabs)/map.js` wires it via `AppState`:
  - background + active trip → `updateLegContext` then `startBackgroundTracking`
  - foreground → stop the task and `mergeStoredKm(distRef)` into the same ref the watcher accumulates, clearing `prev` synchronously to avoid double-counting the gap
- Trip/leg context is kept in sync on every trip or status change so the backgrounded task accumulates the correct leg and posts to the correct trip endpoint.

The foreground watcher stays the source of truth; the background task only fills the gap while backgrounded.

## Why AppState (not always-on)

Always-on background tracking would run the headless task even when idle. Driving it from AppState means the task only starts when there is an active trip and the app leaves the foreground — bounded battery and data, no background activity while the driver is just browsing.

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