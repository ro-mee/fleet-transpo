---
type: feature
status: working
tags: [feature, tracking, gps, mobile]
source:
  - mobile/lib/tracking.js
  - mobile/lib/background-tracking.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-08-19
related: ["[[Trips]]", "[[Mobile Architecture]]"]
---

# Feature: Tracking

## What it does

Reports the driver's position to the server every 30 seconds during an active trip, in the **foreground** and, while an active trip is running, in the **background** (via `expo-task-manager`).

## How it works — CONFIRMED

Two decoupled mechanisms drive the foreground uploader (`mobile/lib/tracking.js`):

```js
// 1. Sensor → a ref. Fires whenever the device produces a fix.
watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })

// 2. Uploader → fixed cadence, independent of the sensor.
POST_INTERVAL_MS = 30 * 1000
POST `/api/mobile/driver/trips/${tripId}/gps`
```

**Decoupling the sensor from the upload is the design.** GPS fires at whatever rate the hardware and movement produce; the network sees exactly one request per 30 s regardless. Battery and data usage are bounded by a constant, not by how fast the van is moving.

`distanceInterval: 10` (metres) plus `accuracy: Balanced` further reduces sensor wake-ups — a stationary vehicle produces almost no updates.

## Background — added 2026-08-19 (`mobile/lib/background-tracking.js`)

Foreground-only was a deliberate scope decision (see [[ADR-010 Foreground Only GPS]]); the app has since moved to a dev build, so background tracking is now implemented. See [[ADR-011 Background GPS Tracking]] for the full decision and trade-offs.

Summary: a headless task (`fleetops-background-location`) posts GPS and accumulates per-leg km while the app is backgrounded during an active trip. `mobile/app/(app)/(tabs)/map.js` starts it on background via `AppState`, stops it and merges the accumulated km on return. The foreground watcher stays the source of truth; the task only fills the backgrounded gap.

**Requires a custom dev build** (not Expo Go) and, for Android production release, Play Store review with a justification.

→ [[Mobile Architecture]] · [[ADR-011 Background GPS Tracking]]

## Database

GPS columns on [[trips]]. There is no separate positions table — INFERRED: only the latest fix is retained, not a track history. **TODO:** confirm whether the GPS endpoint overwrites or appends. If it overwrites, route replay is impossible.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]] · [[ADR-011 Background GPS Tracking]]
