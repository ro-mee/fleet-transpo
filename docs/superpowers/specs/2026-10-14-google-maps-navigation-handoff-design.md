# Google Maps Navigation Handoff Design

**Date:** 2026-10-14
**Status:** Approved direction; source implemented on the related navigation/bubble branches, with native and physical release acceptance pending as of 2026-10-16

## Problem

An active FleetOps driver needs familiar turn-by-turn navigation without stopping FleetOps location updates, losing trip distance, or exposing unsafe trip actions while driving.

## Decision

Deliver the feature in two independent releases:

1. **Reliable navigation handoff:** FleetOps resolves the trusted current target, verifies that background tracking can run, opens Google Maps in driving-navigation mode, and relies on the existing Android tracking notification as the return path.
2. **Optional Android trip bubble:** after Release 1 passes physical-device acceptance, add a small tap-to-return overlay for drivers who explicitly grant Android's display-over-other-apps permission.

Release 1 is valuable and complete without the bubble. The bubble must never become responsible for GPS, distance, or trip state.

## Existing Foundation

- `mobile/lib/navigation-route.js` already validates trusted pickup/destination coordinates and builds a Google Maps URL.
- `mobile/app/(app)/(tabs)/map.js` already exposes the external-navigation action.
- `mobile/lib/background-tracking.js` already posts background fixes and accumulates per-leg distance.
- Map foreground/background transitions already stop one tracker before merging the other tracker's distance.
- `fleetops` is already the application deep-link scheme.
- Android already has the required location foreground-service declarations.

## Release 1 Architecture

### Shared trip phase

One pure mobile helper owns the mapping from trip status to:

- `to_pickup` or `to_destination`;
- `leg1` or `leg2`;
- pickup or destination coordinate fields.

Unknown and terminal statuses return no navigable phase. They must not silently become destination trips.

### Navigation handoff

The user-visible Navigate action performs one ordered operation:

1. Resolve and validate the current canonical target.
2. Ask for background-location permission while FleetOps is still visible, when needed.
3. Start or confirm the background location task and return a meaningful result.
4. Open the universal Google Maps URL with `travelmode=driving` and `dir_action=navigate`.
5. If Google Maps cannot open, stop the handoff-started background task and leave FleetOps in its normal foreground mode.

The normal `AppState` listener remains a safety net for screen lock and other background transitions, but it does not try to show a permission prompt after the app is already in the background.

### Return path

Release 1 uses the existing location foreground-service notification. Tapping it returns to FleetOps. On resume, the app stops background tracking, merges only the matching trip's stored distance, clears the cross-boundary GPS anchor, and reloads the current trip from the server.

### Honest failure behavior

- Invalid or untrusted target: do not open Google Maps.
- Background permission denied: explain that live background tracking is unavailable; offer **Stay in FleetOps** as the safe default and **Open Maps without live tracking** as an explicit secondary choice.
- Background service start failure: use the same warning; never claim tracking is active.
- Google Maps launch failure: remain in FleetOps and return the tracker to the normal foreground lifecycle.
- Trip no longer live: stop trip-scoped background work and discard its stale context.

## Release 2 Architecture

The Android bubble is a local Expo module backed by a small Android service using `TYPE_APPLICATION_OVERLAY`. JavaScript owns all trip decisions; Kotlin only owns permission checks, window presentation, drag/snap behavior, and opening `fleetops:///redirect-trip?tripId=<tripId>`.

The public bridge is deliberately small:

```ts
canDrawOverlays(): Promise<boolean>
openOverlaySettings(): Promise<void>
showTripBubble(tripId: string): Promise<{ shown: boolean; reason?: string }>
hideTripBubble(): Promise<void>
```

The first version of the bubble is one 56 dp circular FleetOps icon. It can be dragged vertically, snaps to the nearest horizontal edge, uses a 48 dp-or-larger touch target, and opens the active trip. It has no expanded panel and no trip-changing action.

The bubble appears only when all of these are true:

- Android device;
- active GPS-tracked trip;
- FleetOps is in the background;
- overlay permission is granted;
- the external-navigation handoff requested it.

It is hidden on foreground return, local completion/cancellation, a server response saying the trip is no longer live, logout, and service teardown. A fresh app launch also removes any stale overlay before restoring current server state.

## Safety and Privacy

- Do not show passenger, cargo, phone, coordinate, or route details in the overlay.
- Do not log raw coordinates in navigation/overlay events.
- Do not request overlay permission at application startup.
- Do not block Google Maps when overlay permission is declined.
- Do not expose Complete, Arrived, Onboard, Loaded, Cancel, or other workflow actions in the overlay.

## Not Doing

- Replacing Google Maps with a second FleetOps navigation engine.
- Adding an expanded overlay dashboard.
- Adding an iOS arbitrary overlay.
- Making overlay permission mandatory.
- Claiming the app survives Android force-stop; the accepted background-tracking ADR explicitly says it does not.
- Changing trip state merely because external navigation opened.
- Adding a database migration or new backend navigation table.

## Acceptance

Release 1 is accepted only after a physical Android drive test proves target selection, continued dispatcher updates, continued distance, notification return, no duplicate distance, and honest permission/service failures.

Release 2 begins only after Release 1 acceptance and is accepted only after overlay permission, drag/snap, deep-link return, foreground hiding, trip-end cleanup, process recreation, and permission revocation are exercised on physical Android devices.
