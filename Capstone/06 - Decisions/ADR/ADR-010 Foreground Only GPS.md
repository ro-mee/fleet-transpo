---
type: decision
status: superseded
date: 2026-08-11
superseded_by: "[[ADR-011 Background GPS Tracking]]"
superseded_date: 2026-08-19
tags: [decision, adr, mobile, gps, scope]
source:
  - mobile/lib/tracking.js
last_verified: 2026-08-19
---

# ADR-010: Foreground Only GPS

> **SUPERSEDED 2026-08-19 by [[ADR-011 Background GPS Tracking]].** The app moved to a dev build (which background location requires), so the "no build pipeline" argument for staying foreground-only no longer holds. Background tracking is now implemented in `mobile/lib/background-tracking.js`; the foreground watcher remains the source of truth. This note is kept for the reasoning history.

## Context

Trip tracking needs the driver's position. Expo supports both foreground (`watchPositionAsync`) and background location updates.

## Decision — CONFIRMED, and the code states the reason

**Foreground only.** From `mobile/lib/tracking.js`:

> *"background updates need a dev build plus Play Store review, so that is deliberately out of scope for this MVP."*

Two concrete blockers, both external:

1. Background location requires a **custom dev build** — not Expo Go
2. Android background location requires **Play Store review** with a justification of need

For a capstone on a timeline, both are real obstacles unrelated to the engineering.

## The implementation — CONFIRMED

```js
watchPositionAsync({ accuracy: Balanced, distanceInterval: 10 })  // sensor → ref
POST_INTERVAL_MS = 30 * 1000                                      // uploader → interval
```

**Sensor and uploader are decoupled.** GPS fires at whatever rate movement produces; the network sees exactly one request per 30 s. Battery and data are bounded by a constant rather than by vehicle speed. `distanceInterval: 10` means a stationary vehicle barely wakes the sensor at all.

That decoupling is good design independent of the foreground limitation, and it would survive a move to background tracking unchanged.

## Consequences

**Good:**
- Ships with Expo Go — no build pipeline, no store review
- No background-location permission prompt, which users often decline
- Better battery life
- Honest scope limit, recorded where a developer will find it

**Costs — the operational reality:**
- **Tracking stops when the driver backgrounds the app or locks the phone.** For a hotel shuttle where the driver keeps the app open, acceptable. Beyond that, not.
- Position history has gaps, so distance-travelled and ETA derived from GPS are unreliable
- The dashboard's live map can show a stale position with no indication it's stale

**TODO:** does the UI show *when* the last fix arrived? Displaying a 20-minute-old position as current is worse than showing nothing.

## Revisit if

- The app moves to a dev build for any other reason — the incremental cost of background location drops sharply
- Trips get long enough that drivers will inevitably background the app
- Distance-based billing or reporting is needed (that requires a complete track)

## Related

[[Tracking]] · [[Mobile Architecture]] · [[Trips]] · [[Decision Log]] · [[Graceful Degradation]]
