---
type: feature
status: working
tags: [feature, map, radar, mobile, ui, standby]
source:
  - mobile/components/TomTomMap.js
  - mobile/app/(app)/(tabs)/map.js
  - mobile/components/CurvedPillTabBar.js
  - mobile/lib/ambient-weather.js
  - mobile/lib/standby-map.test.js
last_verified: 2026-09-13
related: ["[[Tracking]]", "[[Trips]]", "[[Mobile Architecture]]"]
---

# Driver Live Map Standby

## Vehicle Marker Integration: carlive.png (2026-09-13, implemented)

Integrated `mobile/assets/images/carlive.png` as the vehicle marker on the live map (`mobile/components/TomTomMap.js`), replacing synthetic SVG cars, headlights glow overlays, and the car color customizer:
- **Geometry & Sizing:** Asset is square (1254x1254) with a vertically centered car occupying 85.2% height (1068px) and 50.6% width (634px). Sized the container to 60px x 60px, yielding ~51px visible car height and ~30px visible width—directly within the 48–56px target so it anchors the radar without covering wave pulses.
- **Rotation:** Front of vehicle points straight up (North = 0°); GPS heading rotation is preserved relative to the map bearing.
- **Contrast & Styling:** Light mode uses a natural ground drop-shadow (`rgba(18, 38, 28, 0.28)`). Dark mode adds a subtle 1.5px pale mint contour outline (`drop-shadow(0 0 1.5px rgba(220, 245, 232, 0.60))`) and deeper ground shadow for sharp separation against dark tiles without noisy glow.
- **Color Customization Removed:** Completely removed the car customizer modal, swatches, and click handler, reinforcing FleetOps' forest green brand identity and keeping the map interface dedicated to tracking.
- **Resilient Asset Loading & Lifecycle Handshake:** Implemented async asset download with `expo-file-system` Base64 conversion and a persistent WebView handshake (`window.carMarkerImageUrl`, marker creation assignment, `MAP_READY` re-injection, and fallback checks on GPS ticks). Enables Android `allowFileAccess` permissions to guarantee instant, reliable rendering on cold app start without triggering redundant WebView DOM reloads.

## PR 4.5 ? Connected standby radar (2026-09-13, implemented)

Standby now publishes through the global foreground poster after Profile duty check-in, using consented server-owned pairing and fresh accurate observations. Live Tracking is based on a server acknowledgement; missing/stale acknowledgement shows a paused state. Development-only anchored demo entities are excluded from production. The driver screen remains own-location only with its fixed 5 km visual circle and clay weather-above-nav layout. The existing dispatcher recommendation panel has a separately authorized, request-specific radar; scheduled planning never exposes current GPS. See [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan#Implementation record ? 2026-09-13]] for behavior, checks and device acceptance.

## Current presentation ? 2026-09-13

When there is no active trip, the map shows **Live Tracking / Waiting for assignment**, a vehicle at the current GPS fix, and a fixed **5 km radius**. Missing GPS reads **Locating vehicle** and does not invent a vehicle at fallback coordinates; interrupted connectivity uses a neutral indicator and **Connection interrupted**.

This replaces the former multi-tier radar, range selector, large standby dashboard, completed-trip count, quick actions and swipe-to-collapse sheet. Active-trip navigation and dispatch acceptance continue through their existing paths.

- The geographic boundary is a static, softly filled dashed circle around the driver. Its pixel diameter comes from projecting the existing circle geometry through the map, so zooming out shrinks the boundary instead of enlarging it. GPS changes update its scale at the current latitude.
- Expanding radar pulse rings animate for **3.6 seconds** with a 1.8s staggered secondary ripple, ease-out, using a visible 1.5px border (`rgba(40, 95, 80, .75)` light, `rgba(92, 255, 220, .85)` dark) and radial wash gradient, fading smoothly at the 5 km boundary. Scaling `box-shadow` is omitted on large bloom elements to preserve mobile GPU fill-rate, with animations paused dynamically during touch interactions (`.map-interacting`). CSS uses compositor-only transform and opacity with hardware layer backface isolation. Reduced-motion preference disables the pulse and preserves the boundary. The former bright core, tiered glows and standby headlights are removed.
- In-app indicator `RadarPulse.jsx` (Home empty state, Trips standby queue, SOS) similarly carries a 1.5px stroke and refined fill for clean, slightly visible scanning feedback without visual clutter.
- Recenter fits the actual coverage bounds with room for the header and bottom surfaces, resets north-up/flat view and resumes following. The circle is a visual coverage radius, not a new server-side operating-area restriction.
- Light maps retain the existing FleetOps styling with muted blue water, soft green land and quieter labels. Dark appearance still follows the app theme. Provider POI/transit/shield labels are hidden in standby.
- Right-hand controls use existing **ClayCard** compact surfaces: direction/recenter, layers, locate. The layers legend is closed initially; optional station/driver layers start hidden. Assigned dispatch markers and their existing authorized accept/details actions remain available. Anchored optional station/driver data is development-only; no other-driver live feed was introduced in the driver app.
- A compact **ClayCard** near the bottom-left shows real temperature, condition, place (or Local weather) and device-local day/date. It reuses **useAmbientWeather**; the hook also exposes the original weather payload for condition/place. No valid weather means no card, with no fabricated weather or loading surface.
- Weather sits **16 dp above** the existing 64 dp navigation pill, using its exported safe-area bottom-offset calculation. Controls share the weather bottom anchor. The navigation remains pinned below the weather.
- Navigation labels are **Home / Map / Trips / Profile**. The scan button, wave and center spacer are hidden while Map is selected; other tabs retain their existing scan action. Global SOS behavior is unchanged.

## Performance Optimization (2026-09-13, implemented)

Resolved mobile map panning and idle lag ("medj laggyy") across Android WebViews:
- **GPU Fill-Rate Protection:** Stripped GPU-saturating dynamic `box-shadow` calculations from the 1000px scaling radar bloom pulses, maintaining crisp 1.5px borders and smooth radial gradients with `translate3d(0, 0, 0)` and `-webkit-backface-visibility: hidden` layer isolation.
- **Gesture Interaction Suspension:** Dynamically toggles `.map-interacting` on `dragstart`/`dragend` to suspend pulse animations (`animation-play-state: paused`) while the user is actively panning or zooming, dedicating 100% of GPU resources to 60fps gesture rendering.
- **Prevented Redundant WebView Reloads:** Hoisted `cachedCarImage` at module level and removed `carImage` from `htmlContent` dependencies. Asset loads inject via `window.setCarMarkerImage` without re-creating the DOM or re-executing SDK scripts.
- **RAF-Throttled Transform Calculations:** Throttled `zoom` and `rotate` map event listeners via `requestAnimationFrame` to eliminate DOM layout thrashing.
- **React & Native Bridge Optimization:** Removed dead `setIsPannedAway` state setter which caused whole-screen re-renders on map touch; widened parked compass heading deadband to 10° to filter hand tremors; enabled Android WebView hardware acceleration (`androidHardwareAccelerationDisabled={false}`, `overScrollMode="never"`); and wrapped `TomTomMap` in `React.memo`.

## Verification

- ESLint: zero errors/warnings across touched files (`TomTomMap.js`, `map.js`, `RadarPulse.jsx`).
- Mobile Vitest: **20 test suites, 121 tests passed** (`npx vitest run mobile/lib --no-cache`).
- Android Expo export: **1,394 modules**, **5.14 MB Hermes bundle**, successful.
- Native visual/device acceptance remains pending: automated checks verify bundle integrity, zero runtime errors, and test pass rates.


## Web standby visibility fix - 2026-09-14

The web Live Map previously consumed only active-trip GPS and rescue positions, so PR 4.5 standby publications were invisible there. It now polls the separately authorized GET /api/tracking/standby-locations feed every 15 seconds and merges verified standby pins into the existing operations map. Standby pins carry driver/plate identity, a Standby label, observation time and accuracy, without a fabricated trip or breadcrumb history. The map shows a standby count and removes expired pins or pins from a failed standby feed; active trips take precedence for the same driver/vehicle.

The endpoint requires trips:read_all, uses private/no-store responses, and reuses standbyState, qualifiedGps and effectiveStandbyVehicle. Presence requires current attendance, consent, active session, tracking enabled, no active trip/rescue, a matching eligible vehicle and a fresh accurate observation from the current duty session. This explicitly adds operations-wide standby visibility; request-specific recommendation GPS relevance and generic API storage-field suppression remain unchanged. Foreground-only publication remains the current mobile scope. Per-driver eligibility checks are reused for the small fleet; batch schedule/pairing reads if polling cost becomes significant.

Verified: 15 focused tests across four files; targeted ESLint; web production build (200 pages); route authorization audit (264 guarded methods, zero failures); new identity SQL executed successfully against the configured database. Real-device/browser acceptance remains pending.

## Web operations workspace — v3 (2026-09-14, implemented)

Standby poll moved to 30 s. New `Available resources` card (verified standby pins with observed age; expired/failed-feed hidden; active-trip precedence kept) kept separate from `Fleet exceptions · active fleet only` (grounded vehicles + monitor incident signals from already-loaded page data — the standby feed never represents unavailable vehicles). Map viewport is dispatcher-owned (manual pan/zoom sticks; Recenter/select re-fits); selected-trip corridor is stable pickup→destination geometry with a distinct dashed approach stub. See [[Tracking]] for the full record and verification (114 files / 1164 tests, build 201 pages, auth 266/266).

## Editor-only TS noise fix — 2026-09-16

VSCode reported `TS1128 Declaration or statement expected` at the tail of `mobile/components/TomTomMap.js` (and the earlier 180-error cascade on `DriverHomeCards.jsx`). Root cause is project config, not code: the repo's only `jsconfig.json` sits at the root with no `jsx` flag, so the TS server parsed mobile JSX without JSX support. Added editor-only `mobile/jsconfig.json` (`jsx: react-jsx`, `checkJs: false`) so `mobile/` is its own TS project. No runtime effect (Metro/ESLint ignore jsconfig). Verified: `tsc -p mobile/jsconfig.json` 0 errors, ESLint clean on `TomTomMap.js` + `DriverHomeCards.jsx`. Reload VSCode window to clear stale Problems.
