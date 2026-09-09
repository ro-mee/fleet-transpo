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

1. **Winky-Style Organic Animated Bloom Radar in FleetOps Color Schema**:
   - Replaced mechanical sweeps with **organic, layered undulating petal bloom waves** radiating from beneath the vehicle marker directly on the TomTom map canvas, styled completely in the FleetOps brand palette (Mint `#A6C7B8` & Emerald `#4DE3C1` in dark mode, Forest Green `#285448` & Sage `#A9C8B9` in light mode).
   - **4-Layer Harmonic Breathing Undulation**:
     - `layer-1` (Inner Core Bloom, ~125px): Concentric luminous gradient fill (`winkyBreathe1` 3.2s period).
     - `layer-2` (Mid Petal Bloom, ~205px): Asymmetric contour (`border-radius: 46% 54% 53% 47% / 52% 48% 52% 48%`, `winkyBreathe2` 4.4s period with 5° subtle undulation).
     - `layer-3` (Outer Petal Bloom, ~290px): Fluid counter-undulating contour (`border-radius: 53% 47% 48% 52% / 48% 53% 47% 52%`, `winkyBreathe3` 5.8s period with -5° oscillation).
     - `layer-4` (Ambient Dispersion Bloom, ~380px): Outermost gradient contour (`winkyBreathe4` 7.6s period).
   - **3 Staggered Concentric Expanding Ripples**:
     - `.radar-bloom-ripple` (`ripple-1`, `ripple-2`, `ripple-3`) emit every 1.4s, expanding outward from scale `0.35` to `3.4` with cubic-bezier easing (`cubic-bezier(0.16, 1, 0.3, 1)`).
   - **Vehicle Marker (Fleet Car)**:
     - Top-down fleet vehicle marker with headlights glow (`car-headlights-glow`), customizable color swatch palette (`carCustomizer` modal on vehicle tap), and heading rotation (`updateCarRotation`).
     - Pinned precisely to driver GPS coordinates; dynamically rotates to match vehicle heading and map bearing.
     - Sits directly above the organic radar bloom waves.

2. **Top HUD Status Pill & Range Selector**:
   - Clean top pill: `● RADAR | LIVE TRACKING`. Manual theme toggle removed to eliminate visual clutter; theme adapts automatically to app and system appearance settings (`dark` / `light`).
   - Range Selector: `[ 1 km ] [ 3 km ] [ 5 km ] [ All ]` easing camera zoom (`15.5`, `14.2`, `13.0`, `11.8`) and adjusting bloom scale.

3. **Interactive Markers & Dynamic Proximity Clustering**:
   - Circular nodes positioned on the map around the bloom layers:
     - **Normal Assignments**: Forest/Mint badge (`colors.primary`)
     - **Priority Dispatches**: Amber/Brass badge (`colors.secondary`) with glowing halo
     - **Emergency Requests**: Coral/Red badge (`colors.error`) with urgency glow
     - **Fleet Vehicles / Alert Areas**: Emerald badge (`#286B54`) and warning markers
   - Close markers group into high-visibility cluster badges (e.g. `[ 3 ]`).

4. **Compact Assignment Information Card**:
   - Tapping any dispatch node or cluster displays a floating details card over the lower map area.
   - Displays: Priority type, Assignment Title, Organization / Subtitle, Distance in km, Estimated Arrival (ETA min), `[ VIEW DETAILS ]`, `[ ACCEPT ]`, and close `✕`.
   - Allows previewing assignment details before accepting.

5. **FleetOps Map View & Theme Architecture**:
   - **Dark Mode**: Deep forest charcoal map (`#111816`), muted surfaces (`#1C2521`), roads (`#2A3530`), luminous mint bloom waves (`#A6C7B8` / `#4DE3C1`), top-down fleet car, and dark tactical cards (`#19211E`).
   - **Light Mode**: Warm ivory map (`#F5F2EC`), pastel surfaces (`#EDEAE3`), roads (`#FFFFFF`), forest green bloom waves (`#285448` / `#A9C8B9`), top-down fleet car, and crisp ivory cards (`#FFFDFC`).

6. **Collapsible Radar Legend & Recenter FAB**:
   - Interactive badge at top-left: `● Your Vehicle`, `◉ Safe Zone (1 km)`, `◌ Extended Range (3 km)`, `● High Alert Area`.
   - Floating recenter FAB with locate icon appears upon map drag and returns camera focus to the vehicle.

7. **Driver Operational Command Bottom Sheet**:
   - Driver profile avatar, personalized greeting ("Good day, [Name]"), on-duty badge ("✔ On Duty • Ready for assignments").
   - 15-second background auto-polling heartbeat badge displaying live coverage scope.
   - Standby quick-action buttons: `Schedule`, `Inspection`, `Vehicle`.
   - Completed trips counter row (`COMPLETED TRIPS TODAY`).
   - Prominent coral `[ 🛡 SOS ]` button wired directly to the emergency distress modal via `triggerDriverSos()`.

## Architecture & Implementation

### 1. Web-to-Native GPU-Accelerated Animation in `TomTomMap.js`
- The entire organic bloom radar and concentric ripples are rendered via CSS3 hardware-accelerated animations (`transform`, `opacity`, `filter`, `box-shadow`) inside the driver marker's DOM container (`originEl`).
- Zero React Native bridge overhead; 60-120 FPS GPU rendering.
- Stays 100% geographically pinned to driver GPS coordinates during map panning, rotation, and zooming.
- Functions exposed:
  - `window.updateRadarCoverage(km)`: Eases camera zoom and scales bloom container.
  - `window.updateCarRotation(heading)`: Rotates the forward-pointing center puck to match vehicle heading.
  - `window.renderRadarMarkers(markers, selectedKm)`: Calculates marker Euclidean clusters and binds tap events.
  - `window.recenterRadar()`: Eases camera to driver location with north-up bearing.
  - `window.applyFleetMapTheme(isDark)`: Switches body class (`scheme-dark` / `scheme-light`) and map layer styles.

### 2. Standby Radar Interface in `map.js`
- Manages `radarRadiusKm`, `selectedMarker`, `isPannedAway`, `legendExpanded`, and `radarMarkers`.
- Reads real active and pending driver trips from `/api/driver/me` and generates anchored dispatch nodes.
- Shows real-time toast banner notification upon polling new dispatches.
- Wires the coral SOS button to `triggerDriverSos()` in `DriverSos.js`.

### 3. Emergency SOS Distress Integration in `DriverSos.js`
- Exported `triggerDriverSos()` and `registerSosHandler()` to connect the bottom sheet's coral SOS button to the existing distress modal workflow.

## Verification
- Unit test suite: all 996 Vitest tests passing (`npm run test:run`).
- ESLint: zero errors, zero warnings across `map.js`, `TomTomMap.js`, and `DriverSos.js`.
- Android Expo dev client running cleanly.
