---
type: feature
status: working
tags: [feature, map, radar, mobile, ui, standby]
source:
  - mobile/components/TomTomMap.js
  - mobile/app/(app)/(tabs)/map.js
  - mobile/components/RadarPulse.jsx
  - mobile/app/(app)/(tabs)/trips.js
  - mobile/components/home/DriverHomeCards.jsx
  - mobile/components/DriverSos.js
last_verified: 2026-09-09
related: ["[[Tracking]]", "[[Trips]]", "[[Mobile Architecture]]"]
---

# Feature: Live Map Radar Mode & Proximity Coverage Map

## What it does

When a driver opens the Live Map tab without an active trip assignment, the app operates in **Interactive Proximity + Dispatch Coverage Radar Mode**:

1. **Multi-Layered Concentric Depth Radar with High-Visibility Wave Pulse Layers**:
   - Inspired directly by the "Radar Wave Pulse – Visibility Layers" design specification ([`media_1788952463286.jpg`](file:///C:/Users/Joseph%20T%20Lopez/.gemini/antigravity-ide/brain/36335d0f-ca22-46a1-afe9-48cdff1fd179/.user_uploaded/media_1788952463286.jpg)):
   - **4 Visible Proximity Depth Tiers**:
     - **Zone 1 (Inner Proximity Tier, 130px)**: Immediate coverage (`1 km`). Harmonic 3.4s breathe.
     - **Zone 2 (Mid-Range Tier, 210px)**: Nearby dispatch scope (`3 km`). Harmonic 4.6s breathe.
     - **Zone 3 (Extended Range Tier, 290px)**: Extended dispatch scope (`5 km`). Harmonic 6.0s breathe.
     - **Zone 4 (Outer Ambient Dispersion Tier, 370px)**: All-area coverage (`All`). Harmonic 7.8s breathe.
   - **Central Vehicle Ambient Core (`.radar-core-glow`, 88px)**:
     - Infographic Layer 1 token: `#A8FFE1` (pale radiant mint) with 70–90% opacity and 22px glow (`rgba(92, 255, 220, 0.60)`).
   - **3 Distinct, Defined Wave Pulse Rings (Layer-by-Layer Visibility)**:
     - **Layer 2 – Inner Pulse (`.layer-inner`, 110px)**: Highest opacity (45–70%), sharp luminous `#5CFFDC` border (`1.5px solid rgba(92, 255, 220, 0.70)`), inner radial fill, and 14px halo. Emits at 0s.
     - **Layer 3 – Middle Pulse (`.layer-middle`, 110px)**: Medium opacity (25–45%), wider `#00FFB3` border (`1.5px solid rgba(0, 255, 179, 0.50)`), inner radial fill, and 18px glow. Emits at 0.35s.
     - **Layer 4 – Outer Pulse (`.layer-outer`, 110px)**: Low opacity (15–25%), soft `#00E5A8` border (`1.5px solid rgba(0, 229, 168, 0.32)`), smooth dispersion gradient, and 22px halo. Emits at 0.70s.
     - Full loop duration: 2.4s sequence (0ms -> 350ms -> 700ms -> 1200ms full pulse).
   - **Vehicle Marker (Fleet Car)**:
     - Top-down fleet vehicle marker with headlights glow (`car-headlights-glow`), customizable color swatch palette (`carCustomizer` modal on vehicle tap), and heading rotation (`updateCarRotation`).
     - Pinned precisely to driver GPS coordinates; dynamically rotates to match vehicle heading and map bearing.
     - Sits directly above the multi-layered radar field.
   - **Emergency Incident Marker Parity on Mobile**:
     - Standby emergency dispatch markers (`priority === 'emergency'`) render the exact web `.fleet-marker-pulse` element with `#ef4444` behind the emergency icon box for 1:1 parity with web incident markers.

2. **Top HUD Status Pill & Range Selector**:
   - Clean top pill: `● RADAR | LIVE TRACKING`. Adapts automatically to app appearance settings (`dark` / `light`).
   - Range Selector: `[ 1 km ] [ 3 km ] [ 5 km ] [ All ]` easing camera zoom (`15.5`, `14.2`, `13.0`, `11.8`) and dynamically scaling the radar pulse bloom up to 5 km.

3. **Strict Entity Visibility (Fleet Documentation Alignment)**:
   - Eliminates arbitrary commercial establishments.
   - Restricts visible map entities strictly to:
     - **Nearest Gas Stations** (`type: 'gas_station'`): Partner fuel stations (Petron, Shell, Caltex, Cleanfuel) displaying fuel grades, distance, and ETA.
     - **Nearest Fleet Drivers** (`type: 'driver'`): Active fleet vehicles with driver name, plate/model, and operational status (Available / En Route).
     - **Official Dispatch Requests** (`type: 'assignment'`): Real pending trip requests assigned by dispatcher/admin from `/api/mobile/driver/trips`.

4. **Dispatcher-Only Acceptance Logic**:
   - The driver can **only** accept bookings explicitly assigned by the dispatcher or admin (`selectedMarker.tripId`).
   - Tapping Gas Stations shows station details with a `[ REPORT FUEL ]` shortcut (navigating to `/fuel-report?station=...`) and `[ DISMISS ]` — **no accept action**.
   - Tapping Fleet Drivers shows driver/vehicle details with `[ DISMISS ]` — **no accept action**.
   - Tapping an official dispatch request shows `[ VIEW DETAILS ]` and `[ ACCEPT ]`.

5. **Radar Pulse 5 km Maxed Scaling**:
   - When set to 5 km or when zoomed out, the pulse expands dynamically (`baseScale` up to `2.55x`–`3.15x`) via `window.updateRadarBloomScale()`.
   - Listens to map `zoom` events so the multi-layered pulse wave envelope smoothly covers the entire 5 km coverage perimeter.

6. **Collapsible Radar Legend & Dynamic Recenter FAB**:
   - Interactive badge at top-left: `● Your Vehicle`, `⛽ Nearest Gas Station`, `🚗 Fleet Drivers`, `📄 Dispatch Requests`.
   - Floating recenter FAB with locate icon appears upon map drag and returns camera focus to the vehicle, dynamically lowering its position when the bottom sheet is collapsed.

7. **Full View Map (Swipe-Down Gestures)**:
   - The Idle Dashboard Bottom Sheet supports swipe-down gestures via `PanResponder` and spring animation (`idlePanY`).
   - **Collapsed Peek State**: Swiping down smoothly collapses the dashboard into a minimal ~44px bottom bar (`FULL MAP VIEW · SWIPE UP FOR DASHBOARD`), granting unobstructed full-screen view of the map and radar.
   - **Expanded State**: Swiping up or tapping the peek bar smoothly springs the sheet back to normal view.
   - **Redundant SOS Button Removed**: The extra coral SOS button in the bottom sheet was removed; the existing app header distress action and modal handle all emergency distress requests.

## Architecture & Implementation

### 1. Web-to-Native GPU-Accelerated Animation in `TomTomMap.js`
- Exposed functions:
  - `window.updateRadarCoverage(km)`: Eases camera zoom and triggers `window.updateRadarBloomScale()`.
  - `window.updateRadarBloomScale()`: Dynamically calculates scale based on range and map zoom level, expanding the bloom container up to 5 km.
  - `window.updateCarRotation(heading)`: Rotates the forward-pointing center puck to match vehicle heading.
  - `window.renderRadarMarkers(markers, selectedKm)`: Groups markers into Euclidean clusters, styles `.priority-station` and `.priority-vehicle`, and binds tap events.
  - `window.recenterRadar()`: Eases camera to driver location with north-up bearing.
  - `window.applyFleetMapTheme(isDark)`: Switches body class and map layer styles.

### 2. Standby Radar Interface in `map.js`
- Manages `radarRadiusKm`, `selectedMarker`, `isPannedAway`, `legendExpanded`, `radarMarkers`, and `isIdleCollapsed`.
- Reads real active and pending driver trips from `/api/mobile/driver/trips`.
- Restricts marker generation strictly to Gas Stations, Fleet Drivers, and Dispatch Requests.
- Renders `selectedMarkerCard` with dispatcher-only accept actions and Fuel Report shortcuts.
- Manages the swipe-down collapse mechanism for Full Map View.

## Verification
- Unit test suite: all 996 Vitest tests passing (`npm run test:run`).
- ESLint: zero errors, zero warnings across `mobile/app/(app)/(tabs)/map.js` and `mobile/components/TomTomMap.js`.
- Verified native dev client running without errors.
