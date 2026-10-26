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
last_verified: 2026-10-22
related: ["[[Tracking]]", "[[Trips]]", "[[Mobile Architecture]]"]
---

# Driver Live Map Standby

## Vehicle Marker Integration: carlive.png (2026-09-13, implemented)

Integrated `mobile/assets/images/carlive.png` as the vehicle marker on the live map (`mobile/components/TomTomMap.js`), replacing synthetic SVG cars, headlights glow overlays, and the car color customizer:
- **Geometry & Sizing:** Asset is square (1254x1254) with a vertically centered car occupying 85.2% height (1068px) and 50.6% width (634px). Sized the container to 60px x 60px, yielding ~51px visible car height and ~30px visible width—directly within the 48–56px target so it anchors the radar without covering wave pulses.
- **Rotation:** Front of vehicle points straight up (North = 0°); GPS heading rotation is preserved relative to the map bearing.
- **Contrast & Styling:** Light mode uses a natural ground drop-shadow (`rgba(18, 38, 28, 0.28)`). Dark mode adds a subtle 1.5px pale mint contour outline (`drop-shadow(0 0 1.5px rgba(220, 245, 232, 0.60))`) and deeper ground shadow for sharp separation against dark tiles without noisy glow.
- **Color Customization Removed:** Completely removed the car customizer modal, swatches, and click handler, reinforcing FleetOps' forest green brand identity and keeping the map interface dedicated to tracking.
- **Resilient Asset Loading & Lifecycle Handshake:** Implemented async asset download with `expo-file-system` Base64 conversion and a persistent WebView handshake (`window.carMarkerImageUrl`, marker creation assignment, `MAP_READY` re-injection, and fallback checks on GPS ticks). Uses inline image data (or an HTTPS asset fallback) without Android file-access permissions; a missing image keeps the built-in marker. Native cold-start acceptance remains pending.

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
- Right-hand controls use existing **ClayCard** compact surfaces: direction/recenter and layers. The duplicate locate action was removed. The layers legend is closed initially; production offers Your Vehicle and Dispatch Requests only. Optional station/driver layers are development-only. Assigned dispatch markers and their existing authorized accept/details actions remain available. Anchored optional station/driver data is development-only; no other-driver live feed was introduced in the driver app.
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

## Driver Companion Map Tab Empty States (2026-09-30, implemented)

Added dedicated, status-aware empty states to the mobile Map tab (`mobile/app/(app)/(tabs)/map.js`) when the driver is not in an active operational state, matching the FleetOps Driver Companion dark visual design language (`#040D0A`, emerald glow accents `#34D399` / `#10B981`):

- **Supported Empty States (3):**
  1. **Off Duty**: Status Pill `OFF DUTY`, Title `You’re Off Duty`, Description `Live trip tracking becomes available when you start your shift.`, vector icon `map-marker-off`.
  2. **Rest Day**: Status Pill `REST DAY`, Title `Today is Your Rest Day`, Description `No operational map or trip tracking is needed today.`, vector icon `calendar-minus`.
  3. **Currently on Leave**: Status Pill `ON LEAVE`, Title `You’re Currently on Leave`, Description `Live trip tracking will be available when you return to active duty.`, vector icon `calendar-blank-outline` with diagonal slash bar.

- **Visual Hierarchy & Shared Architecture:**
  - **Top App Header**: FleetOps logo badge with car icon (`#34D399`), "FleetOps" title, "DRIVER COMPANION" uppercase tracking subtitle, circular notification bell button linking to `/notifications`.
  - **Atmospheric Background**: Deep dark teal/black gradient canvas (`#06130E` to `#020504`) with subtle abstract curved emerald wave ribbons (`borderWidth: 1.5`, sweeping gradient arcs) matching the companion design system.
  - **Centered Icon Card**: Squircle container (110x110dp, `borderRadius: 32`) with emerald neon edge highlights (`rgba(52, 211, 153, 0.45)`), soft ambient outer halo glow (`rgba(16, 185, 129, 0.16)`), and crisp white vector glyphs.
  - **Status Pill**: Capsule badge (`borderRadius: 22`) with glowing green pulse dot (`#34D399`) and bold tracking text.
  - **Pull-to-Refresh**: Wrapped in `ScrollView` with `RefreshControl` tied to `handleEmptyRefresh` to trigger `duty.refresh()` and `loadTrip()`, allowing drivers to re-evaluate their duty state immediately on-demand.
  - **Bottom Navigation**: Preserves active Map tab on `CurvedPillTabBar` without any parallel screens or duplicate route stacks.

- **Operational Safety Gates:**
  - Zero active map, stale routes, previous trip lines, fake trip states, or pickup/destination markers rendered during empty states.
  - Location watching and trip polling intervals are suppressed while in an empty state to conserve device battery and network bandwidth.
  - Seamlessly re-engages GPS watching and trip polling as soon as the driver checks in or starts an active trip.
  - Tested and verified: `mobile/lib/map-empty-state.test.js` (8 tests passing), ESLint clean on `map.js`.

### Shared Off Duty illustration follow-up (2026-10-14)

The Map Off Duty empty state now uses the same supplied transparent clipboard/crossed-location illustration as Home and Trips, replacing only the former crossed-pin icon card. The status pill, title and tracking explanation remain explicit, so the image is decorative rather than the sole status indicator. Rest Day and On Leave retain their distinct calendar artwork, and empty-state polling/location behavior is unchanged. Focused duty/Home coverage passed 56/56 tests, scoped ESLint passed, and the Android Hermes export passed with 1,467 modules, a 5.69 MB bundle and 88 assets. Native device visual acceptance remains pending.

Size correction (2026-10-17): on-device review reported the illustration as far too large. The hero variant used here was reduced 220→132 px so it matches the 126 px glow wrapper it replaces, and the shared compact/card variants were reduced with it (72→44, 152→88). Presentation-only; focused five-file coverage passed 60/60, scoped ESLint, UTF-8 and diff checks passed. Device visual re-confirmation needs one Metro reload.

Screenshot follow-up (2026-10-17): explicit height now accompanies width because React Native Image otherwise retains the bundled asset's native height despite `aspectRatio`. The shared hero is 132×117.81 dp, keeping the status label, title and explanation within the empty-state layout. Map's empty-state scroll padding now reserves 168 dp plus the safe inset for the resting SOS/navigation controls. Four inherited-dimension regressions failed before correction; all 73 focused checks passed afterward. Component browser previews confirmed bounded artwork in both themes; complete native Map/SOS visual acceptance remains pending. Duty resolution, polling, tracking and notification routing are unchanged. See [[UI UX Audit - Mobile]].

Approved color alignment (2026-10-17): replaced the private mint/emerald empty/loading palette with the shared semantic app colors and reused ClayBadge primary for the centered status pill. This matches Trips' new header badge exactly in light and dark themes, and respects the existing high-contrast palette. Shared badges now use the registered Plus Jakarta Sans semibold face. Off Duty artwork sizing, Rest Day/On Leave symbols, text, refresh and all map/controller behavior remain intact. Final 99 focused tests, strict touched ESLint and Android Hermes export passed (1,468 modules, 5.72 MB, 88 assets). Browser previews used the real empty-state JSX/styles with fixture providers and substituted icon/gradient rendering; native visual acceptance remains pending. See [[UI UX Audit - Mobile]].

## Cross-State Map UI/UX Consistency & Functional Verification (2026-09-30, implemented)

Executed a comprehensive UI/UX audit and functional verification across all map states based on `impeccable`, `ui-ux-pro-max`, and `high-end-visual-design` principles:

1. **State Audit & Visual Uniformity**:
   - **Standby Radar Header (`standbyHeader`) Floating Card**: Wrapped naked floating text in a tactile clay capsule card (`styles.standbyHeaderCard`, `mats.compactShade`, `borderRadius: 20`, padding, subtle border), guaranteeing contrast across both light ivory and dark OLED map tiles while establishing spatial rhythm matching the bottom sheet and legend cards.
   - **Real-Time Notification Banner (`toastBanner`) Safe Layout**: Removed hardcoded `top: 104` and coupled positioning with `insets.top + 92`, eliminating layout collision with the standby header on devices with tall dynamic islands or camera notches.
   - **Informative GPS Loading State**: Enhanced the centered `globe.json` loading screen with explicit contextual status feedback (`Acquiring GPS position…` with `type.bodyMd`, `colors.onSurfaceVariant`), satisfying UI/UX Pro Max Priority 2 (feedback on wait states).
   - **Permission Denied State Alignment**: Elevated `permissionDenied` container with safe area insets (`paddingTop: Math.max(insets.top, 24) + 16`) and wrapped the location glyph inside a nested double-bezel clay tile (`permIconWrap` + `permIconInner`), harmonizing with the companion empty-state design architecture.
   - **WebView Turn-by-Turn Nav Header Safe Area**: Added dynamic `topInset` prop to `TomTomMap.js` (passing `Math.max(insets.top, 20) + 10`), eliminating camera notch / dynamic island occlusion on the HTML turn-by-turn banner.

2. **Functional Wiring**:
   - **Passenger Call Action**: Replaced the previously non-functional passenger call icon in the expanded active trip sheet with an active, accessible handler (`Linking.openURL('tel:' + activeTrip.passenger_phone)` if phone exists; graceful `AppAlert.alert("Contact Unavailable", ...)` fallback when omitted from the reservation; tactile scale feedback `pressed ? 0.95 : 1`).
   - **Trip State Machine**: Verified all 11 backend route contracts (`/accept`, `/start`, `/pickup-check`, `/at-pickup`, `/onboard`, `/enroute`, `/destination-check`, `/dropoff`, `/complete`), departure window clock gates, arrival proximity override flows, and offline sync queuing (`wasQueued`).

3. **Verification**:
    - ESLint: zero errors, zero warnings on `mobile/app/(app)/(tabs)/map.js` and `mobile/components/TomTomMap.js`.
    - Unit tests: **44 test files passed, 514 tests passed (100%)** in `mobile/lib/`.
    - Full repository test suite: **257 test files passed, 3,266 tests passed (100%)**.

## Cargo safety/readiness follow-up (2026-10-14)

Cargo Home movement now enters the existing guarded Map flow, while completion enters the shared actual-odometer form rather than Home's Passenger writer/modal. Cargo Map label, disabled state and action use the same `readinessFor` result for confirmed assignment/profile, duty/Pre-Shift, Pre-Trip and finite open timing. The callback recalculates time before accept/start. Missing timing or unresolved checks cannot offer an actionable Cargo start; Passenger's explicit legacy timing exception remains. Existing source/Fleet/receiver checks, proximity override, route preferences and tracking until server confirmation are preserved.

Combined1,270 tests/109 files, strict touched lint and Android Hermes export (1,457 modules/5.68 MB/82 assets) passed. Shared server guards now refuse typed Cargo without authority even in OFF mode. Live integration remains disabled by explicit user choice. Native screenshots, phone accessibility/keyboard, live concurrency and an actual Cargo pilot remain unverified. Details: [[Cargo UI Backend Readiness Review 2026-10-14]] and [[Mobile Architecture]].

## Map focus-effect infinite loop fix (2026-09-30, implemented)

`mobile/app/(app)/(tabs)/map.js` crashed with `Maximum update depth exceeded` and flooded `GET /api/mobile/driver/duty` (~120 ms cadence). Root cause: the `useFocusEffect(useCallback(..., [loadTrip, emptyStateKey, duty]))` depended on the whole `duty` object, but `useDuty()` returns a fresh spread object every render — so the expo-router focus effect (a `React.useEffect` on the callback identity) re-ran on every render while focused, calling `setDriverLocation({...})` + `duty.refresh()` (both setState) and re-rendering into itself. Fix: depend only on the stable `duty.refresh` (`const dutyRefresh = duty?.refresh`), same for `handleEmptyRefresh`, and re-seed the driver marker with a functional set + equality bail-out so an unchanged fix returns `prev` instead of minting a new object.

Verified: ESLint clean on `mobile/app/(app)/(tabs)/map.js`.

## Poll-churn follow-ups (2026-09-30, implemented)

Two render-churn issues found during the post-fix audit, neither a crash:

1. **15 s poll re-rendered forever.** `loadTrip` called `setActiveTrip` / `setNearbyTrips` with freshly-minted objects on every poll, so the whole screen (plus radar markers and WebView props) re-rendered every 15 s even when nothing changed. Both setters are now functional with a `samePayload` deep-equal bail-out (serialized comparison — drift-proof against new server fields, trivial cost at this payload size), so an unchanged poll keeps the previous references and renders nothing.
2. **`mapIntroActiveLayers` memo — no change needed.** Suspected `mats.clayTile` / `colors` were fresh per render; verified they are stable (`clayMaterials()` returns shared module objects, `useTheme()` value is memoized and `colors` is a shared palette). Its only real churn source was `activeTrip` identity, which fix 1 resolves.

Verified: ESLint clean; `standby-map` (1), `map-empty-state` (8) and `coach-marks` (142) suites pass — 151 tests.

## Light & Dark Theme Adaptability for Map Empty States (2026-09-30, implemented)

Made the Map tab empty states (`Off Duty`, `Rest Day`, `On Leave`) dynamically responsive to device color schemes (`useColorScheme()` light / dark):
- **Dark Appearance:** Deep teal/black canvas (`#040D0A`), sweeping darker emerald wave arcs, neon glowing emerald icon squircle (`rgba(52, 211, 153, 0.45)` border), glowing badge `#34D399` with dark badge surface, white headline (`#FFFFFF`), and muted body copy (`#A7F3D0`).
- **Light Appearance:** Crisp, clean mint-white canvas (`#F4F7F5` to `#F0FDF4`), soft forest ribbon strokes (`rgba(16, 185, 129, 0.18)`), mint-accented clay squircle (`#E6F4EA` surface, `#86EFAC` border, soft outer shadow), `#15803D` vector glyph, forest green badge pill (`#DCFCE7` surface, `#15803D` text), deep evergreen headline (`#17382F`), and readable secondary text (`#4B6358`).
- **Consistent Tokens via `emptyTheme`:** Extracted dynamic color tokens into a clean memoized object (`emptyTheme`) to prevent inline conditional sprawl and guarantee immediate response to OS-level theme toggles without tearing.
- **Verification:** ESLint clean on `mobile/app/(app)/(tabs)/map.js`, Vitest `mobile/lib/map-empty-state.test.js` passing.


## Shared Cargo/Passenger Route Options - 2026-10-14

Audit-fix follow-up: Compact Cargo Map moves vehicle metadata into expanded Details; current stop, provider telemetry, declared load and existing clearance/action area remain primary. Shared swipe shows Submitting while awaiting a status response and only confirms explicit current-session success; held/refused/queued/override/manual-completion navigation is not success. Reduced-motion confirmation uses static feedback. Tracking, routing, geofence/source/Fleet/receiver checks and Passenger child layout remain unchanged. Final 1,091 affected tests / 85 files and Android export passed; native screenshot/keyboard/screen-reader fit remains unverified.

Reference-layout follow-up: Cargo has compact operational sheets with reference/stage, current pickup/delivery target, real provider distance/time, declared kg, vehicle and expandable stops. Standby waits for assignment; matching confirmed completion creates an account/session-scoped notice with details/dismiss actions. Old geometry clears and next assignments use their own sheets. Passenger keeps its existing summary child layout; Cargo excludes guest avatars/counts. Canvas, route controls, safety gesture, geofences and source/Fleet/receiver holds remain shared. Native visual acceptance and unsupported audio/traffic controls are not claimed. See [[Mobile Architecture]].

Assigned/active Map offers one Route Options sheet and a current-target Google Maps control using native clay/theme primitives. Choices are provider-backed; Apply updates geometry, guidance, ETA and distance together. Avoid toll roads reaches pinned SDK 6.25.0 as `avoid: 'tollRoads'`, including later refreshes. Another trip resets settings; pickup-to-delivery preserves toll preference. Missing alternates are never fabricated. Failed/timed-out calculations retain the prior line/settings with stale-estimate feedback and retry.

Standby, GPS trip priority, tracking, geofences, overrides and cargo clearance remain shared. Live navigation requires actual GPS and an operational target; review-only proposals are not fuzzy-geocoded. Cargo Home/Map show real description/declared kg. Measured primary content and viewport/safe-area bounds keep actions above navigation; native acceptance remains pending.

Verification: 1,033 mobile/backend tests / 80 files, strict touched lint plus sizing follow-up, UTF-8 and whitespace checks passed. Two synthetic TomTom REST smoke requests returned HTTP 200 and valid route geometry/telemetry. After initial Windows temporary-file/disk failures, single-worker Android Hermes export passed (1,455 modules / 5.65 MB); final iOS/web exports remain unverified. No native captures/device, migration, operating write or deployment. See [[Mobile Architecture]].

Provider contract: [TomTom SDK 6.25.0 calculateRoute](https://api.tomtom.com/maps-sdk-for-web/6.x/6.25.0/documentation/dist/classes/Services.services.calculateRoute.html).

Final tracking follow-up: a server-confirmed completion uses the existing API event hook to clear the hidden Map's active ref, discard obsolete polls, clear its old route and reload the real next assignment. Pending background starts check the trip and app state before and after the asynchronous OS start, stopping if completion or foreground return intervened. Executable tests cover completion before and during start, refused/queued responses and another trip's event. The final 1,033-test run includes these guards and the single-scroll-area sheet correction. Focused source review found those two fixes resolved; native visual review remains pending (`recapture`) because no device/emulator captures were available.

## Assignment reachability and recovery - 2026-10-22

Pending/Approved/Assigned/Vehicle Assigned/Driver Assigned/Dispatched rows remain
in the standby radar. Only an accepted or ongoing trip selects the trip workspace,
so two future assignments can actually appear as real verified pickup pins.
Missing coordinates still produce no invented pin. Pre-start work does not bypass
Off Duty/Rest Day/On Leave; an underway trip preserves the operational workspace.
Accept locks synchronously and disables further taps while its write is pending.
Unchanged polls preserve a valid authorization snapshot while fetching; failed
reads still revoke it.

Production no longer advertises unsupported gas-station or other-driver feeds.
Map failure offers Retry map; delayed/lost GPS has separate truthful status and
Retry GPS. The map's visual sensors stop on blur, while the app-owned trip stream
keeps required distance collection. See [[Tracking]] and
[[Mobile Map Functionality Repairs 2026-10-21]] for verification and native limits.
