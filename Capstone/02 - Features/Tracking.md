---
type: feature
status: working
tags: [feature, tracking, gps, mobile]
source:
  - mobile/lib/tracking.js
  - mobile/lib/background-tracking.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-08-31
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

## Location unavailable — hardened 2026-08-22 (WIP)

Both the map watcher and `useTripTracking()` now catch failures from permission/location initialization. If location services are disabled or the current fix is unavailable, the app stops the posting state, shows a recoverable message, logs a warning, and continues running instead of producing an unhandled promise rejection/red error screen. These changes are currently uncommitted.

## Background — added 2026-08-19 (`mobile/lib/background-tracking.js`)

Foreground-only was a deliberate scope decision (see [[ADR-010 Foreground Only GPS]]); the app has since moved to a dev build, so background tracking is now implemented. See [[ADR-011 Background GPS Tracking]] for the full decision and trade-offs.

Summary: a headless task (`fleetops-background-location`) posts GPS and accumulates per-leg km while the app is backgrounded during an active trip. `mobile/app/(app)/(tabs)/map.js` starts it on background via `AppState`, stops it and merges the accumulated km on return. The foreground watcher stays the source of truth; the task only fills the backgrounded gap.

**Requires a custom dev build** (not Expo Go) and, for Android production release, Play Store review with a justification.

→ [[Mobile Architecture]] · [[ADR-011 Background GPS Tracking]]

## Trip-Scoped & Status-Aware Live GPS Architecture — 2026-08-31 (Commit `abdc001`)

To prevent idle or stationary vehicles from polluting historical trip breadcrumbs and to give operators accurate visibility into active fleet movement:

1. **Trip-Scoped Ping Ingestion (`src/lib/gps.js`)**:
   - `/api/mobile/driver/gps` and `/api/mobile/driver/trips/[id]/gps` now validate trip status.
   - Pings are strictly recorded to `gpstracking` only when a driver is actively executing an `In Progress` trip. Stationary pings from drivers parked at the depot or between trips are discarded.
2. **Stale Connection & Disconnect Detection**:
   - Implemented `isStaleGps()` using a 3-minute threshold (`GPS_STALE_THRESHOLD_MS = 3 * 60 * 1000`).
   - If a vehicle in `In Progress` or `Dispatched` has not emitted a ping for > 3 minutes, its status indicator flags it as "Stale/Disconnected" with last-ping age context.
3. **Web Live Map Overhaul (`/tracking/live-map` & `src/components/maps/live-locations-map.jsx`)**:
   - **Status Filtering**: Interactive filter chips (*All*, *In Progress*, *Dispatched*, *Assigned*, *Stale/Disconnected*).
   - **Color-Coded Status Markers**: Emerald for In Progress, Amber for Dispatched/Assigned, and Slate for Stale/Inactive.
   - **Isolated Breadcrumbs**: Breadcrumb routes render exclusively for the currently selected active trip, eliminating overlapping polyline noise across the map.
   - **Driver Telemetry Drawer**: Displays live speed, compass heading, estimated destination ETA, and connection health.
4. **Mobile Lifecycle Synchronization**:
   - Background tracking tasks mount and unmount strictly on active trip state transitions (`In Progress` starts the watcher; completing or cancelling a trip terminates the background task and releases wake locks).

## Database

Every accepted fix is appended to `gpstracking` with `vehicle_id`, `trip_id`, coordinates, motion metadata, accuracy, and `recorded_at`. The same request also updates the driver's latest latitude/longitude for the live map. Route history is therefore retained per trip; the driver row is only the latest-position cache.

## Web: Trip Timeline — HIDDEN FROM NAV 2026-08-23

`/tracking/history` (the "Trip Timeline" / completed-trips review table) is **out of scope** and was removed from the sidebar (`workspaces.js`, incl. the management "Operational Review" entry), the command palette, and the `/tracking` module card. Nothing was deleted — the page still works via direct URL (`permissions.js` unchanged), and executive dashboard stat links to it still resolve.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]] · [[ADR-011 Background GPS Tracking]]
