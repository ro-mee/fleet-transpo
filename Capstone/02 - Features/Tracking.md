---
type: feature
status: working
tags: [feature, tracking, gps, mobile]
source:
  - mobile/lib/tracking.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-08-11
related: ["[[Trips]]", "[[Mobile Architecture]]"]
---

# Feature: Tracking

## What it does

Reports the driver's position to the server every 30 seconds during an active trip.

## How it works — CONFIRMED (`mobile/lib/tracking.js`)

Two decoupled mechanisms:

```js
// 1. Sensor → a ref. Fires whenever the device produces a fix.
watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })

// 2. Uploader → fixed cadence, independent of the sensor.
POST_INTERVAL_MS = 30 * 1000
POST `/api/mobile/driver/trips/${tripId}/gps`
```

**Decoupling the sensor from the upload is the design.** GPS fires at whatever rate the hardware and movement produce; the network sees exactly one request per 30 s regardless. Battery and data usage are bounded by a constant, not by how fast the van is moving.

`distanceInterval: 10` (metres) plus `accuracy: Balanced` further reduces sensor wake-ups — a stationary vehicle produces almost no updates.

## Foreground only — deliberate and documented — CONFIRMED

> *"background updates need a dev build plus Play Store review, so that is deliberately out of scope for this MVP."*

This is a **scope decision recorded in the code**, which is the best place for it.

**The operational consequence is real:** a driver who backgrounds the app or locks the phone stops being tracked. For a hotel shuttle where the driver keeps the app open, acceptable. For anything longer, not.

→ [[Mobile Architecture]]

## Database

GPS columns on [[trips]]. There is no separate positions table — INFERRED: only the latest fix is retained, not a track history. **TODO:** confirm whether the GPS endpoint overwrites or appends. If it overwrites, route replay is impossible.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]]
