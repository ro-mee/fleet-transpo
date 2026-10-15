---
type: feature
status: working
tags: [feature, tracking, gps, mobile]
source:
  - mobile/lib/tracking.js
  - mobile/lib/background-tracking.js
  - mobile/lib/gps-odometer.js
  - mobile/lib/navigation-route.js
  - mobile/lib/external-navigation.js
  - mobile/lib/navigation-handoff.js
  - mobile/lib/trip-bubble.js
  - mobile/lib/trip-bubble-handoff.js
  - mobile/app/(app)/(tabs)/map.js
  - mobile/components/TomTomMap.js
  - src/app/api/mobile/driver/trips/[id]/gps/route.js
last_verified: 2026-10-06
related: ["[[Trips]]", "[[Mobile Architecture]]", "[[Live Map Radar]]"]
---

# Feature: Tracking

## Current Android trip bubble - 2026-10-16, Task 5

Tasks 1-4 are implemented in source through `2ca921c0`. The user's informed request to build now superseded the earlier implementation-start hold; it did not waive native or physical acceptance. Historical Task 1 scaffold and Task 2/3 integration limits below describe those checkpoints, not the current feature.

After successful existing live-tracking readiness, Navigate may offer the optional Android shortcut once. **Not now**, denial, Back, missing native module and native failure leave Maps navigation usable. The saved explanation choice prevents repeated prompts; returning from explicit Android Settings checks the real permission. **Continue Without Tracking** never offers or arms it. A fresh custom Android build is required: Expo Go, iOS/web and older installed Android builds without the module safely continue without the bubble.

The private native service implements one 56 dp draggable icon with edge snap, safe bounds and an accessible return tap. It shows only after successful Maps launch and a current departure; return, terminal/replaced trips, session changes and explicit remote `trip-not-live` invalidate stale work and attempt removal. The return URL is only a hint: authenticated Map reloads the canonical assignment. The icon exposes no passenger, cargo, destination or GPS data and no state-changing trip action. The existing foreground-service notification remains the fallback return path. The bubble owns no GPS, distance or trip lifecycle work; seeing it does not prove tracking delivery. Android can stop its ordinary service, and force-stop still ends tracking under [[ADR-011 Background GPS Tracking]].

Fresh automated gate: all 1,183 mobile tests across 82 files, full zero-warning lint, tracked-text UTF-8/mojibake and whitespace checks passed. Native unit tests plus debug assembly, and a separate manifest-merge attempt, both stopped before compilation with `ERROR: JAVA_HOME is not set and no 'java' command could be found in your PATH.` Kotlin compilation, the ten position JUnit cases, merged manifest and APK remain **PENDING**. Host inventory found no Java/JDK, Android SDK/AVD, adb/emulator or present Android device; device/build/Maps versions and vendor settings are unrecorded. The isolated checkout lacks ignored `mobile/services/google-services.json`; no configuration was invented.

Android Hermes export also passed with the installed Expo SDK 54 CLI and one worker: 1,472 modules, 87 unique asset files (89 metadata references) and a 5,714,055-byte bundle. Recovery first found complete output without its process exit; a fresh rerun then exited 0, and metadata, every asset, the Hermes header and current bubble/return markers were checked. The missing Google services file still produced a configuration warning; bundling does not verify native compilation, notification setup or background delivery. Exact task export/scratch folders were removed after recording evidence.

### Bubble physical acceptance - every item PENDING

- [ ] Install a fresh native build; record device model, Android/FleetOps/Maps versions and vendor battery/overlay restrictions without serial numbers or private trip data.
- [ ] Verify first explanation, Settings handoff, grant, denial, Back, later revocation and no repeated offers. Maps and GPS must remain usable for every optional-overlay outcome, measuring GPS separately.
- [ ] Verify the 56 dp icon and touch target over Maps, vertical drag, both edge snaps, no tap after drag, safe insets/cutouts/rotation and no obstruction of critical Maps controls; tap must restore authenticated FleetOps/current assignment.
- [ ] Verify cleanup on foreground return, completion, cancellation, remote `trip-not-live`, logout/expiry, process removal and fresh launch; record lock/unlock and Android/vendor service limits.
- [ ] Verify content description, TalkBack focus, large-font independence and high-contrast icon visibility; inspect that no private data or state-changing action is exposed.
- [ ] Complete the separate Google Maps moving/background-fix, notification-return and exact-once distance matrix below; force-stop survival is not promised.

No device step was performed. Task 5 records automated checks and remaining release gates only. The source plan exists untracked only in the main checkout and was left unchanged; its status is recorded in the task ledger and report instead of copying it into this worktree.

## Android bubble return and cleanup - 2026-10-16, Task 4

Review correction: foreground return preserves only the explicit, still-current Android Settings request. Pending availability/storage, an undecided alert and resolved offers are invalidated; Map unmount always clears them, including Settings. Four regressions failed first (actual Map availability round trip, stale alert action, Settings unmount, delayed storage). Covering checks passed 221/221 before the additional real Settings-denial case; the final full mobile run passed 1,183/1,183 across 82 files. Strict touched lint, encoding and whitespace passed. Tracking preparation/permission ownership and busy-state release remain unchanged; native/device acceptance is still pending.

`fleetops:///redirect-trip?tripId=...` is a return hint only. The guarded route hides the shortcut, waits for session restoration, and sends drivers through the existing authenticated Map. A refresh marker reruns Map's canonical assignment read even with an old empty-state parameter; the URL identity never selects, loads or changes a trip.

Startup waits for optional cleanup before restoring navigation. Logout, session expiry and sign-in invalidate pending permission/SHOW work immediately, including a later login by the same employee. Matching confirmed completion/cancellation, failed restoration and canonical replacement invalidate Map work before React commits. Foreground return still removes the native shortcut while allowing Android Settings to finish its actual permission check. The headless GPS handler hides on explicit `tracked: false / trip-not-live`; a captured work version prevents an old reply hiding a newer handoff. GPS ownership, queues, cadence and distance rules are unchanged.

Verification: strict test-first failures covered parser/guard/startup/auth, pending permission/SHOW and real Map/headless callbacks; eight focused suites passed 231/231, then the full mobile run passed 1,178/1,178 in 82 files. Strict touched lint, tracked-text encoding and whitespace passed. Native compilation and physical Android acceptance remain pending.

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

## Location unavailable — hardened 2026-08-22

Both the map watcher and `useTripTracking()` now catch failures from permission/location initialization. If location services are disabled or the current fix is unavailable, the app stops the posting state, shows a recoverable message, logs a warning, and continues running instead of producing an unhandled promise rejection/red error screen.
The screen-side hook also derives the settings-disabled state and suppresses stale
errors when no trip is selected, so tab focus changes cannot leave a false posting
indicator or old trip error visible.

## Background — added 2026-08-19 (`mobile/lib/background-tracking.js`)

Foreground-only was a deliberate scope decision (see [[ADR-010 Foreground Only GPS]]); the app has since moved to a dev build, so background tracking is now implemented. See [[ADR-011 Background GPS Tracking]] for the full decision and trade-offs.

Summary: a headless task (`fleetops-background-location`) posts GPS and accumulates per-leg km while the app is backgrounded during an active trip. Map prepares the existing task before opening Google Maps; `AppState` provides a permission-free fallback for other exits, then stops it and merges the accumulated km on return. The task ignores foreground delivery, including a foreground return during its context read. The foreground watcher stays the source of truth; the task only fills the backgrounded gap.

**Shared mobile navigation phase (2026-10-15):** `mobile/lib/trip-navigation-phase.js` now owns the status mapping used by the trusted navigation target and the existing background-tracking `legForStatus` export. Pending through At Pickup maps to pickup/leg1; Passenger Onboard, En Route, Drop-off, Arrived and In Progress maps to destination/leg2. Empty, terminal and unknown statuses return no target or leg. Passenger and Cargo use the same status rules. Verification: strict test-first checks reproduced the missing module and seven unsafe-fallback failures before implementation; the three focused phase, routing and background suites then passed 66/66 tests. This slice does not yet change tracking startup or the Google Maps launcher; physical Android acceptance remains pending.

**Shared Google Maps launch (2026-10-15, handoff Task 2):** The shared URL builder now encodes the coordinate pair and requests `travelmode=driving&dir_action=navigate`. Invalid, non-finite or out-of-range coordinates return no URL. The new `launchExternalNavigation(target, openUrl)` waits for the platform open request and returns success, `invalid-target`, or `open-failed` without changing trip state or tracking. Vehicle, the static TripMap and the rescue navigation fallback now use this path while preserving their explicit destination and quiet launch-failure behavior. The active-trip Map already uses the shared URL builder; its tracking-before-launch workflow is a later task. Google's [Maps URL guide](https://developers.google.com/maps/documentation/urls/get-started#directions-action) notes that navigation may open a preview when device location is unavailable. Strict test-first verification observed five URL failures and a missing launcher module, then three consumer URL failures before migration; all seven focused navigation, WebView, tracking, odometer and notification suites passed 114/114 tests, and focused ESLint passed. Physical-device launch and background behavior remain unverified.

**Observable background readiness (2026-10-15, handoff Task 3):** `prepareBackgroundTracking({ tripId, leg, requestPermission })` requires a successful trip/leg context write, obtains foreground permission before checking background permission and starts the existing native task only when it is not already running. Permission prompting requires explicit opt-in; the default check never prompts. Results distinguish ready, unsupported web, denied permission and native startup failure. `stopBackgroundTracking()` reports success for an absent/stopped task and `stop-failed` for native lookup/stop errors. The existing AppState starter remains compatible and uses the same native task check without overwriting its saved context. The 10 m / 30 s cadence, balanced accuracy, automotive mode, foreground notification, odometer and merge rules remain unchanged. Initial strict test-first evidence: 17 new failures before implementation, then 44/44 focused readiness/odometer tests and 131/131 tests across seven related navigation/tracking suites passed; focused strict ESLint passed. Readiness confirms native registration, not delivery of real background fixes. Active-trip handoff wiring and physical Android acceptance remain later tasks.

**Task 3 review fixes (2026-10-15):** Missing foreground permission is checked/requested first with the same prompt opt-in; refusal stops before any background check, and native permission exceptions return `start-failed`. Context writes now reject on storage failure so preparation returns `start-failed` before permission/native calls instead of accepting stale trip context. The serialized write queue recovers after failure and preserves same-trip distance totals. Existing callers already catch context errors; the background task and foreground merge retain their best-effort save behavior. Strict test-first evidence: six permission-order/denial/error regressions failed before that fix, then three context-failure regressions failed before the persistence fix. Final focused readiness/odometer checks passed 54/54 tests; seven related regression suites passed 141/141; strict touched lint passed. Physical Android acceptance remains pending.

**Requires a custom dev build** (not Expo Go) and, for Android production release, Play Store review with a justification.

**Ordered Google Maps handoff (2026-10-15, Task 4):** Both Passenger and Cargo validate the current trip and trusted phase target before permission work, then await background readiness before opening the shared Google Maps launcher. The button stays disabled and ignores repeated taps during preparation and the warning decision. Denial, startup failure or unsupported tracking shows an honest warning with primary **Stay Here** and secondary **Continue Without Tracking**; only the latter opens Maps. Back dismisses safely and releases the lock. Earlier unaccepted assignments never request or start trip tracking and require that explicit override. Session, trip, status and target checks prevent stale launch after completion or assignment change; launch failure stops prepared tracking and reports the platform failure. The AppState fallback never prompts and stops a pending task after cancellation or foreground return, retaining stop-before-merge ordering. Shared AppAlert opt-ins stack long labels and report dismissal, preserving its default layout. Strict test-first evidence reproduced the missing orchestration module, 14 screen failures, three alert failures, one cancellation race and two foreground-duplication failures before their changes; all 1,045 mobile library tests across 76 suites passed. Physical Android permission, launch, notification, background-fix delivery and distance continuity acceptance remain pending; no coordinates are logged and no trip state or extra collector is added.

**Task 4 review follow-up (2026-10-15):** Ordinary background start and foreground stop/merge share one ordered transition queue. A handoff waits for earlier cleanup before preparing tracking, then owns readiness and rollback, so a permission-related foreground return cannot stop its just-prepared task. A real Maps departure and return during a slow platform-open promise is recorded; the owning operation stops and merges when that promise settles. Shared alerts notify a replaced warning exactly once, releasing its navigation lock; stale dismissal animations cannot run the old action or hide the replacement. Strict RED/GREEN reproduced both cleanup interleavings, the late-return cleanup gap and both replacement failures. Verification: all 1,050 mobile tests across 76 suites passed. Device acceptance remains pending.

**Task 4 second-departure correction (2026-10-15):** The handoff's delayed return stop/merge now joins the same tracking transition queue as ordinary AppState work. A new background departure during that cleanup is retained behind it and uses the existing permission-free fallback after ownership releases. The fallback rechecks the current trip, tracked status and app state before starting, so a return, cancellation or reassignment while waiting cannot restart obsolete tracking. Stop still precedes the single distance merge; no collector, cadence, GPS privacy boundary or warning choice changes. The original second-departure test failed with tracking off before the fix. Five new timing/stale-work cases pass with 128/128 focused Task 4 tests and all 1,055 mobile tests across 76 suites. Physical Android acceptance remains pending.

→ [[Mobile Architecture]] · [[ADR-011 Background GPS Tracking]]

**Return and stale-trip recovery (2026-10-15, Task 5):** The background task awaits the existing non-queued GPS response. An explicit `tracked: false` clears its trip, leg, distance and anchor context before counting that fix, stops the native task and drops the rest of that delivery batch. A network failure keeps local distance collection without inventing an ended-trip result. Task delivery, context changes and distance merges share the existing storage write queue, so an in-flight response cannot overwrite a newer assignment or replay already merged distance. Both ordinary foreground return and a delayed Maps launch return stop, merge only the returning trip's distance, then refresh the canonical assignment. The return captures its accumulator so a replacement assignment cannot receive old distance. Accepted refreshes update the live trip ref immediately; absent/terminal trips disappear, valid Passenger/Cargo trips retain the shared next-target rules, and existing request/session guards reject obsolete responses. Strict RED/GREEN reproduced missing rejection cleanup, missing refresh, delayed return refresh, immediate ref invalidation and replacement-distance mixing. All 1,068 mobile tests across 76 suites and touched-file strict lint passed. Physical Android delivery, notification return and distance continuity remain pending.

**Automated navigation release gate (2026-10-15, Task 6):** `mobile/lib/navigation-release.test.js` brings the Release 1 contract into one executable gate: Passenger/Cargo pickup and destination use the same leg authority, Maps receives encoded driving-navigation coordinates, unsafe targets never reach permission/platform work, readiness settles before launch, tracking failures require the explicit override, duplicate taps cannot launch twice, ended-trip overrides are refused, and return cleanup stops/merges before canonical refresh. It also guards the existing background-location and foreground-service permissions/plugin configuration. Controlled source/configuration regressions failed before restoration; all 21 release checks and all 1,089 mobile tests across 77 suites passed. Full zero-warning lint, tracked-text encoding and whitespace checks passed. Android Hermes export passed with 1,468 modules, 87 assets and a 5,698,753-byte bundle; current handoff markers were confirmed in the bytecode. Native compiler scratch files needed the approved main workspace write area after permission errors in the default/worktree temporary folders. The isolated checkout also emitted a missing `services/google-services.json` configuration warning; JavaScript export is not native-build acceptance. The requested `check:artifacts` command is unavailable in this repository and is not claimed as passing. Generated export/scratch directories were removed after recording evidence. Physical Android permission choices, notification return, moving/background GPS delivery, kill/lock/network behavior and distance continuity remain pending under Task 7. No application, dependency, database or deployment change belongs to this test-only gate.

## Google Maps physical Android acceptance - PENDING (2026-10-15, Task 7)

Release 1 has automated evidence, but physical acceptance has **not passed**. Read-only host checks found no `adb` or `emulator` command on PATH, no Android SDK environment variables, no default Android SDK or AVD directory, no running ADB/emulator process and no present Android/ADB/vendor/MTP device in Windows device inventory. The restricted inventory initially denied CIM access; the same checks succeeded outside that restriction and returned no matching device. No development build was installed, no drive occurred and no device result is inferred from an export or test double.

Device model, Android version, FleetOps native build version, battery optimization/vendor restrictions and Google Maps version are **not recorded: no usable physical device was available**. A fresh custom Android development build is required; Expo Go and an emulator do not establish the moving-device acceptance below. Cargo live integration remains disabled; use authorized nonproduction assignments without enabling a production provider or changing operating records for this check.

Physical checklist - every item below remains unperformed:

- [ ] Record device model, Android version, FleetOps native build version, Maps version and battery optimization/vendor settings after installing a fresh development build.
- [ ] For Passenger and Cargo, Driver Accepted and Trip Started navigate to the trusted pickup; Passenger Onboard, En Route, Drop-off, Arrived and In Progress navigate to the trusted destination.
- [ ] Confirm Google Maps navigation or route preview according to actual device location availability.
- [ ] With real movement and Maps in front, confirm the dispatcher receives at least two new background fixes.
- [ ] Confirm each leg gains distance once, with no jump when FleetOps returns.
- [ ] Tap the existing foreground-service notification and confirm return to FleetOps and the canonical current assignment.
- [ ] Confirm missing, invalid and untrusted coordinates cannot open Maps.
- [ ] Deny foreground/background permission, verify the honest warning, Stay Here, Continue Without Tracking and hardware Back; record the permission outcome without assuming background delivery.
- [ ] Complete/cancel the authorized test trip and confirm trip-specific background work stops; check remote ended-trip recovery too.
- [ ] Record lock/unlock, network loss/recovery, app removal/force-stop and vendor battery restrictions; force-stop survival is not promised by ADR-011.

Measurement record remains blank because no drive was performed: last foreground fix time; first and second dispatcher-confirmed background fix times; first resumed fix time; leg1/leg2 km before leaving, before return and after merge; notification return outcome; permission and vendor settings; cleanup outcome. Record timestamps with timezone and the associated non-sensitive test/build identifier. Do not record raw coordinates, passenger/cargo details, tokens or device serial numbers in this note.

Automated evidence is from the committed Task 6 run at `8d5b38e8a533423c7cec948a275bf24e1f089dc4`, not a physical run: release gate 21/21; all mobile library tests 1,089/1,089 across 77 files; full zero-warning lint; tracked-text encoding and whitespace checks; Android Hermes export 1,468 modules, 87 assets, 5,698,753-byte bundle with current handoff markers. The isolated checkout's missing Google services configuration warning leaves native notification/build configuration unaccepted. `check:artifacts` is unavailable in this repository and is not a passed gate.

**Final full-repository check (2026-10-15):** At implementation commit `1ffcccf3`, the complete suite finished with 5,603 passed, 11 failed and 72 skipped tests across 511 files. Ten repeatable failures are outside this mobile change: four AI pair-scoring cases, five dispatch-window cases and one recommendation-availability case. The additional schema-contract failure was a full-suite timeout; its separate rerun passed all 13 checks, while the recommendation case still failed. The base-to-head change contains no changes under `src/`, `scripts/`, or the root package files. The earlier nine-failure baseline record was incomplete; do not read the mobile/export passes as a green full-repository gate. The work is saved on `codex/google-maps-handoff` and remains unmerged pending the required acceptance and repository gates.

**Release 2 / Android bubble scaffold (2026-10-15, Task 1):** The user explicitly authorized building the bubble after being informed that physical acceptance is deferred, overriding the earlier implementation-start hold. Physical acceptance remains PENDING. `mobile/modules/fleetops-trip-bubble` is now an Android-only local Expo SDK 54 module with typed optional imports, overlay permission/settings calls and durable permission/service declarations. iOS, web and older Android builds safely return unsupported. The non-exported service is a nonsticky scaffold that immediately stops; no overlay is implemented or called from app screens yet. Native show returns `invalid-trip`, `permission-denied` or `start-failed`, never a fabricated success. Task 2 must implement and acknowledge a real overlay before returning `shown: true`. The existing notification remains the implemented return path; GPS, trip state and distance collection are unchanged.

Task 1 verification: four optional-bridge checks failed before implementation and then passed; all 1,093 mobile checks across 78 files passed, with strict touched ESLint and TypeScript checks. Installed SDK 54 autolinking finds the module once on Android and excludes it on Apple. XML checks verified one generated overlay permission and the source service's non-exported/stop-with-task flags. Android prebuild was attempted but stopped at the absent ignored `services/google-services.json`; Gradle's manifest task could not run because Java is unavailable, and no Android SDK/device is installed. Neither a merged-manifest/native compile nor physical overlay behavior is claimed. See [[Mobile Architecture]].

## Android bubble permission and Maps lifecycle — Task 3 (2026-10-15)

After successful existing live-tracking readiness, Navigate checks the optional Android bridge. Missing modules, iOS/web and native failures continue without a shortcut. Missing overlay permission gets one themed AppAlert explanation with stacked **Not now** / **Open Android settings** actions; the offer is saved before presentation, so dismissal/replacement and repeated taps do not nag. A storage failure skips the offer. Settings return checks real permission; denial, Back or opening failure still continues Maps. Explicit **Continue Without Tracking** never offers or arms the bubble, preserving the Driver Accepted GPS boundary.

The controller arms immediately before the Maps request and requires both platform success and a departure within five seconds. It survives either launch/AppState ordering, checks the captured trip/status/target/session before show, and never treats the earlier Settings departure as Maps. Return clears ownership and calls native hide immediately; tracking stop/merge and failed-launch rollback await that removal attempt. A new navigation attempt cancels an older arm, trip changes invalidate it, and Map unmount hides it. Native queued-show generations provide the attachment race guard. This uses only the existing successful tracking foreground-service eligibility and adds no GPS collector or service management.

Verification: wrapper RED (11 missing-module failures), helper RED (missing module), six callback/expiry RED failures, then separate late-hide/prior-arm/failed-launch rollback regressions before each correction. One full mobile run passed 1,135/1,135 tests across 80 files; after the final rollback regression, seven focused suites passed 163/163. Touched strict lint passed. Native compilation and physical Android permission, overlay, Maps-return and GPS acceptance remain pending; root/auth/deep-link/remote rejection cleanup belongs to Task 4.

## Android bubble native service — Task 2 (2026-10-15)

**Android bubble native service (2026-10-15, Task 2):** Replaced the scaffold with one private 56 dp circular return icon. It contains no trip label, passenger, destination or GPS data. Dragging uses Android touch slop, clamps the full icon inside system-bar/cutout bounds and snaps to an edge; taps use the accessible click path and an immutable, update-current, app-scoped `fleetops:///redirect-trip?tripId=` link with an encoded ID. Repeated show updates the existing window. Show reports success only after attachment and a fresh permission check; a five-second timeout, startup refusal, newer request or hide returns failure. Main-queue request generations prevent delayed show from recreating a hidden bubble. Hide removes directly without starting a background service; permission revocation, service destruction and stop-with-task clean up defensively. Hide rejects when cleanup cannot be confirmed.

The controller must call show while an activity is visible or the app already has its existing foreground tracking service running. Android may stop an ordinary background service once those conditions end; this bubble does not start, keep alive or stop GPS, and adds no foreground service or permission. Keep the existing notification return path and treat bubble failure as optional. No app screen caller or expanded panel is added in this slice. Six position JUnit tests were written before implementation, but both Gradle attempts stopped before compilation because Java is absent: no native RED/GREEN, APK or physical acceptance is claimed. All 1,093 mobile library tests across 78 files, focused strict lint/TypeScript and real Android autolinking passed. See [[Mobile Architecture]].

**Task 2 review fix (2026-10-15):** API26–29 now uses Android's normal safe parent frame, with cutout avoidance, rather than mixing small-window relative insets with whole-display dimensions. The display-wide visible frame supplies width/height; offsets remain local to its left/top, so those margins are applied once. The frame is queried again for moves/configuration changes and checked before shown acknowledgement. API30+ retains WindowMetrics. Four additional pure JUnit cases cover zero small-window insets, top/bottom bounds, landscape left/right bars, cutout origins and rotation. Native execution remains unavailable without Java; focused optional-bridge checks passed 4/4 and strict touched lint passed. Device acceptance is still pending.

## Trip-Scoped & Status-Aware Live GPS Architecture — 2026-08-31 (Commit `abdc001`)

To prevent idle or stationary vehicles from polluting historical trip breadcrumbs and to give operators accurate visibility into active fleet movement:

1. **Trip-Scoped Ping Ingestion (`src/lib/gps.js`)**:
   - `/api/mobile/driver/gps` and `/api/mobile/driver/trips/[id]/gps` now validate trip status.
   - Pings are strictly recorded to `gpstracking` only when a driver is actively executing an `In Progress` trip. Standby observations now use the separate latest-only presence path described under PR 4.5 below; they do not enter gpstracking.
2. **Stale Connection & Disconnect Detection**:
   - Implemented `isStaleGps()` using a 3-minute threshold (`GPS_STALE_THRESHOLD_MS = 3 * 60 * 1000`).
   - If a vehicle in `In Progress` or `Dispatched` has not emitted a ping for > 3 minutes, its status indicator flags it as "Stale/Disconnected" with last-ping age context.
3. **Web Live Map Overhaul (`/tracking/live-map` & `src/components/maps/live-locations-map.jsx`)**:
   - **Status Filtering**: Interactive filter chips (*All*, *In Progress*, *Dispatched*, *Assigned*, *Stale/Disconnected*).
   - **Color-Coded Status Markers**: Emerald for In Progress, Amber for Dispatched/Assigned, and Slate for Stale/Inactive.
   - **Isolated Breadcrumbs**: Breadcrumb routes render exclusively for the currently selected active trip, eliminating overlapping polyline noise across the map.
   - **Driver Telemetry Drawer**: Displays live speed, compass heading, estimated destination ETA, and connection health.
   - **Always auto-fit viewport (2026-09-03)**: `MapViewport` re-fits the view to all pins (or the selected trip's route/marker) on every GPS poll — removed the stable `focusKey` guard that skipped re-fitting when the marker set was unchanged. Drivers that move out of view are re-centered on the next 15s refresh; user pans are also re-fitted on refresh (accepted trade-off, same behavior as the incident map's `FitBounds`).
   - **Permanent vehicle labels (2026-09-03)**: vehicle markers on latest-locations data (`/tracking/live-map`, role dashboards) show a permanent tooltip label — status-color dot + plate + driver name — no hover/click needed; the click popup (telemetry, Street View) is unchanged. Raw GPS-history rows (`/trips/[id]`) have no identity, so they keep the plain hover tooltip. Also fixed plate resolution reading nested `l.vehicles.plate_number` (was flat access, so labels/popups fell back to "Vehicle #N").
   - **No-gray markers & navigation panel removed (2026-09-03)**: `STATUS_COLOR` now maps *every* `LIVE_TRIP_STATUSES` phase (pre-trip blue, to-pickup amber, passenger-onboard/arrived green); previously unmapped statuses fell back to gray. `DEFAULT_MARKER` is blue, not gray. The floating "Live Route Navigation" panel (turn-by-turn instructions, distance/ETA chip) was removed from the component along with the `instructions`, `routeDistanceKm`, `routeTravelMin`, and `showNavigationPanel` props; the route polyline, origin/destination pin labels, and the sidebar trip metrics remain.
   - **Incident layer removed (2026-09-03)**: Open-incident markers, the "Open incidents" stat card, and the sidebar incident list were removed from the live map — the Incidents module (`/incidents`) already plots incidents on its own map, so the layer was redundant. `LiveLocationsMap` no longer accepts an `incidents` prop (incident pin rendering, legend entry, and CSS deleted from the component).
   - **Marker key collision fixed (2026-09-04)**: `CircleMarker` React keys now prefer the per-row `tracking_id` / `gps_tracking_id` over `trip_id`. GPS-history rows (`/trips/[id]` map) all share the same `trip_id`, so the old `trip_id ||` key chain gave every breadcrumb of a trip the identical key (React "two children with the same key" error, duplicated/omitted markers on each 15s refetch). The coordinate fallback also appends the row index so a stationary vehicle (identical consecutive coords) can't collide. Latest-locations rows keep working — one row per trip, `gps_tracking_id` unique.
   - **Ctrl + scroll to zoom (2026-09-04)**: the live map (and every `LiveLocationsMap` consumer — `/tracking/live-map`, role dashboards, `/trips/[id]`) now zooms on ctrl/⌘ + wheel and ignores plain wheel scrolling, flashing a "Use ctrl + scroll to zoom the map" hint for 1.2s on plain scroll — the same UX the incident map already had. The handler + hint overlay were extracted to the shared `src/components/maps/map-ctrl-zoom.jsx` (`MapCtrlZoom` / `ZoomHintOverlay`); `incident-map.jsx` now consumes the shared module instead of its private copy. Plain scrolling no longer gets swallowed by the map when zoom is disabled. The 15s auto-fit still re-fits the viewport on each GPS poll (existing accepted trade-off).
4. **Mobile Lifecycle Synchronization**:
   - Background tracking tasks mount and unmount strictly on active trip state transitions (`In Progress` starts the watcher; completing or cancelling a trip terminates the background task and releases wake locks).

## Database

Every accepted fix is appended to `gpstracking` with `vehicle_id`, `trip_id`, coordinates, motion metadata, accuracy, and `recorded_at`. The same request also updates the driver's latest latitude/longitude for the live map. Route history is therefore retained per trip; the driver row is only the latest-position cache.

## Web: Trip Timeline — HIDDEN FROM NAV 2026-08-23

`/tracking/history` (the "Trip Timeline" / completed-trips review table) is **out of scope** and was removed from the sidebar (`workspaces.js`, incl. the management "Operational Review" entry), the command palette, and the `/tracking` module card. Nothing was deleted — the page still works via direct URL (`permissions.js` unchanged), and executive dashboard stat links to it still resolve.

## GPS Ingest Enrichment — PR #3 Arrival Intelligence (2026-09-08)

Both ingest paths (`/api/mobile/driver/trips/[id]/gps` POST and `/api/trips/[id]/locations` POST) now return a `geofence` object alongside the stored row: `near_pickup`, `near_destination`, `distance_to_pickup_m/_destination_m`, `geofence_state` (known/unknown), and per-end verdicts. Legacy/v1 targets retain their existing registry/text fallback chain; persisted v2 requests bypass sender text, partner proposals, gazetteer, and seeds, and use only an active Fleet location matching an explicit request FK. `(0,0)` is accepted only for that explicit linked v2 `canonical_registry` target (and may remain in route geometry fetched to it); GPS current positions and recent pings remain sentinel-safe. Targets are cached for 5 minutes. Fixes worse than ±150 m accuracy are stored but yield UNKNOWN, never an arrival claim. The mobile foreground poster publishes the verdict to screens, which render "near pickup/destination" banners — the swipe/button transitions stay human-confirmed. No status is ever auto-mutated by position.

**Target derivation fix (2026-09-08):** `getTripGeofenceTargets`'s re-query selected `origin, destination FROM trips` — columns that do not exist (migration 007 dropped them). On the live database that query raised "column does not exist" and the function's catch silently returned `{pickup: null, destination: null}` for **every** trip: no geofence verdicts, no monitor target/corridor, and the live map's route line never drew for request-dispatched trips (no `route_id`). The re-query now derives endpoint names through the dispatch's booking request first (route as fallback) — the same chain as `src/lib/api/trips-query.js` — pinned by a regression test. Lesson (third strike of the same bug class): mocked `db.query` tests never touch the real schema, so every new SQL must be run against the live database before "done".

## Connectivity vs GPS — PR #3.1 (2026-09-08)

Connectivity status and GPS status are separate surfaces. Offline + live trip tracking renders "Offline · GPS still recording / Last synced {age} · Showing saved data · Dispatcher may see your last synced location" — only when the poster is genuinely feeding the current trip (trip id set, no poster error, post within 90 s), never inferred from merely being offline, and never "live location active". GPS lifecycle, posting cadence, and geofence rules unchanged. → [[Mobile Architecture]]

## Offline Read Mode fix (2026-09-08)

The login route returns camelCase (`employeeId`) and `signIn` stores it verbatim, but `resolveDriverId` matched only snake_case — the offline cache was never written nor read on any screen, and `clearOfflineCache` was dead code. Fixed (camelCase first); regression-pinned against the exact wire shape. Work Schedule became the 4-state template (offline+cached rows+inline note / offline+never-synced card / online+confirmed-empty / online+data), with per-source `syncedAt` as the confirmed-empty signal. Details → [[Mobile Architecture]] Offline Read Mode.

## Live Monitoring & Delay Intelligence — PR #4 (2026-09-08)

While a trip is live, the system now answers the four operational questions deterministically — *okay pa ba ang trip? male-late ba? nalilihis ba sa route? maaapektuhan ba ang susunod na assigned trip?* — and **recommends only**: nothing in this layer mutates a trip, dispatch, or assignment (the AI copilot is PR #5, separate).

- **Shared phase resolver** (`src/lib/trip-phase.js`): the ONE trip_status → phase (to_pickup / to_destination) interpretation, consumed by the live map AND the monitor. No private status list exists anywhere else.
- **Pure engines** (no DB/network): `src/lib/monitoring/live-trip-monitor.js` condenses risk to NORMAL / WATCH / ATTENTION / ACTION / UNKNOWN (delay thresholds 5/10/15 min; next-ASSIGNED-trip slack with a 10-min turnaround floor; UNKNOWN never downgrades to NORMAL — "can't tell" is not "all good"); `src/lib/geo/off-route.js` confirms a deviation only on **>250 m × 2 consecutive valid observations** (accuracy ≤150 m, ≤5 min fresh) and clears it on <150 m × 2 (hysteresis).
- **I/O service** `src/services/live-trip-monitor.service.js`, two locked modes: **fleet summary = cheap triage** (`summarizeFleet` — cached signals + durable alert rows only, never a fresh TomTom call per trip) and **selected trip = expensive precision** (`evaluateLiveTripMonitor` — fresh traffic-aware ETA, passenger minutes, next-trip reposition routing). The off-route **corridor is intent-anchored** — a pinned polyline refreshed only on phase/target change or 10-min expiry, never mid-deviation (re-anchoring per ping would launder a detour into "on route"); the ETA leg is vehicle-anchored and refreshes on movement. Off-route streaks read from the `gpstracking` breadcrumbs (latest 3), never process memory — serverless-safe.
- **Strict v2 reposition — Task 4 Slice B (2026-10-06):** next-trip selection carries the request fingerprint and explicit pickup/drop-off IDs. V2 reposition uses only the active, non-retired Fleet location linked through the request ID; missing, mismatched, retired, or invalid coordinates yield unknown, and neither partner proposals nor a stored route endpoint is a fallback. V1 keeps the existing text/gazetteer behavior. The selected-trip payload retains per-endpoint `canonical_registry` / `pending_review` / `unknown` provenance for both current targets and the next request. Trip status, lifecycle writes, and geofence state transitions are unchanged.
- **Durable alerts** (`trip_monitor_alerts`, migration 109): writes only on appear / severity-jump / resolve; notifications fire on **threshold entry** (into ≥ATTENTION → Warning to the dispatcher; into ≥ACTION → Alert to dispatcher + fleet_manager with push), so NORMAL→ACTION, WATCH→ACTION, UNKNOWN→ACTION and ATTENTION→ACTION each notify exactly once. **Resolution is lifecycle-owned**: `completeTrip`/`cancelTrip` resolve a trip's active alerts inside their transaction; the fleet endpoint keeps only a defensive sweep.
- **APIs**: `GET /api/trips/live-monitor` (fleet triage, `trips:read_all`) and `GET /api/trips/[id]/live-monitor` (full evaluation; a driver may read their OWN trip — foreign trips 404). `/api/trips/latest-locations` stays raw telemetry, untouched.
- **Web Live Operations UI** (`/tracking/live-map`): LIVE OPERATIONS strip + risk chips (All / Action / Attention / Watch / Normal / GPS issues — chips filter the trip LIST only, never the map). The selected-mission drawer gains the monitor block: risk badge, live ETA, schedule delay, traffic delay, route status, **next assigned trip** impact sentence, signals list, and View Trip / Review Reassignment / View Incident links. Map markers get a restrained risk accent (ACTION rose+pulse, ATTENTION/WATCH amber, UNKNOWN gray; NORMAL and stale-GPS markers unchanged). Each **Active trips list row** also shows the derived trip endpoints — `pickup → drop-off` from the request, falling back to the route (`routeLineFor`, same derivation chain as the drawer; silent for manual trips with neither — trips has no origin/destination columns, see `src/lib/api/trips-query.js`). An evaluation of restoring `trips.origin/destination` as stored columns (2026-09-08) rejected it: 40% of dev trips have no request/route to source them, and a stored copy would dual-source the request's truth. The map's route line resolves its target from the trip's route record; trips dispatched straight from a request have none, so `mapTargetFor` falls back to the monitor's geofence-resolved target (detail evaluation first, then the cheap fleet row — same shared phase resolver, so the kinds always agree).
- **Mobile**: both GPS POST routes return a `monitor` payload (ingest-side `evaluatePingMonitor`, best-effort — a banner failure can never fail the GPS write). The foreground poster publishes it trip-id-tagged (same staleness guard as the geofence verdict), and the map screen shows ONE calm banner while en route — "Route deviation detected / Check your navigation when safe." · "Heavy traffic ahead / Arrival may be delayed by about N min." · "GPS updates delayed / Keep location access enabled." Derivation is a pure RN-free module (`mobile/lib/monitor-banner.js`, re-exported by `tracking.js`). No risk-level jargon and no dispatcher-style next-trip panic copy while driving.

## Map Weather Chip — 2026-09-09

Ambient current-conditions pill on the driver map screen, fed through the GPS ingest response. **Weather is permanently chip-only** — never a banner, toast, or notification; actionable issues (off-route / traffic / GPS) keep the one banner surface, weather is quiet context beside them (see [[Mobile Map Weather Chip Implementation Plan]]).

- **Server**: `src/lib/weather.js` — Open-Meteo current-weather adapter (keyless). `parseCurrentWeather` is pure (WMO code → label; unknown code → null); `getCurrentWeather` caches per coarse ~0.1° grid cell for 10 min (failures cached 1 min so an outage isn't hammered per ping) and caps the provider call at ~2 s — the poster waits on this response every 30 s, so weather must fail fast and open to null. The **post-write advisory block is now shared**: `src/services/ping-advisories.service.js` (`buildPingAdvisories`) builds geofence + monitor + weather for BOTH POST handlers (`/api/mobile/driver/trips/[id]/gps` and `/api/trips/[id]/locations`), ending their duplication. Auth stays route-specific (driver-only vs permission-checked) — only the enrichment was extracted.
- **Mobile**: `weather`/`weatherTripId` in `usePosterStatus` (published from the GPS POST response, trip-id-tagged; cleared immediately when the active trip changes — Trip A's weather can never show on Trip B). Pure derivation `mobile/lib/weather-chip.js` (`weatherChipFor` → `{icon, temperature, label}`, WMO→Ionicon table; invalid/unknown → null, and `formatTemperature` guards null-vs-0 so a missing temperature is silence, never "0°"). `mobile/components/WeatherChip.js` renders the compact pill (content-fit, token-styled, no press/animation/skeleton) **in the Home header, beside the notification bell** (moved 2026-09-09 from the map's floating-controls row per review — the map screen shows no weather surface). **Label precedence: place over condition** — the chip shows WHERE the driver is ("Quezon City"); the icon carries the condition, so strings like "Heavy Drizzle" never appear. `weatherChipFor` prefers the server's `placeName`, falls back to the condition string only when no truthful place resolved, and renders nothing when neither exists. No new location stream — the chip uses the coordinates of the ping the driver already posts, so idle drivers (no pings) get no weather, same trip-scoping as GPS itself. No DB write, no migration. A claymorphism restyle of the header (app-background pill shell, condition-tinted icon discs, clay shadows on avatar/bell) was applied and then **reverted the same day after on-device review** — the original surface/border idiom looked better; no styling decisions from that pass survive.
- **Place label (reverse geocoding, 2026-09-09):** `src/lib/geo/reverse-geocode.js` — TomTom reverse-geocode adapter reusing the existing SERVER key (`getServerKey()`; null when unconfigured — no place, never an error). `parsePlaceName` prefers municipality → locality → countrySecondarySubdivision → countrySubdivisionName; cached per coarse ~0.1° grid cell for 24 h; ~2 s timeout; fail-open. `src/lib/weather.js` gains `getCurrentConditions` = weather + `placeName` composed in one payload (place failure never loses the weather) — used by both the GPS ingest advisories and `/api/mobile/driver/weather`.
- **No-trip weather (2026-09-09, same day revision):** the chip must be visible whenever there is a truthful payload, not only en route. New `GET /api/mobile/driver/weather` (driver-authenticated) resolves position from `latitude`/`longitude` query params (the app's one-shot fix, only read when foreground permission is already granted — the endpoint never triggers a prompt) → falling back to the driver's last-known position (`drivers.current_*`) → `weather: null`. `mobile/lib/ambient-weather.js` (`useAmbientWeather`) fetches it on a 10-min cadence (aligned with the server cache TTL — one Open-Meteo call per cell per TTL across BOTH the GPS ingest path and this endpoint, they share the cache) and feeds the Home chip when the poster has no trip payload. Trip weather still wins while a trip is live (freshest, same rail as geofence/monitor); the ambient fetch covers idle/between-trips; no truthful payload → no chip. One-shot fetch, never a position watcher — a decorative chip does not justify continuous location.
- **Route line persists on stale GPS (2026-09-08):** the live map's trip route line no longer vanishes when the driver's GPS is delayed/offline. The origin is now the LAST KNOWN position (any valid fix), and staleness is communicated rather than hidden: a dashed/dimmer polyline (`routeStale` prop on `LiveLocationsMap`), a "· last known position" suffix on the origin pin label, and "Route drawn from last known position" / "· from last known position" in the selected-mission drawer. The **rescue route keeps its strict freshness rule** — its ETA ladder is a live-response tool, not corridor context, so a stale responder fix still shows "Waiting for a fresh responder GPS fix" instead of drawing.

## Live map Drop-off infinite-loading fix — 2026-09-09

Driver report: with the active trip at `Drop-off`, opening the live map (`mobile/app/(app)/(tabs)/map.js`) spun on `globe.json` forever. Three parallel diagnoses agreed the `Drop-off` status strings themselves were consistent everywhere (`Drop-off` canonical in `src/lib/constants.js`, DB CHECK, `GPS_TRACKING_STATUSES`, `isState4`) — the sheet state machine was fine. The stuck loader was the `!mapReady` overlay whose only writer is the WebView's `MAP_READY` post:

- **Root cause (most likely):** `pickupLabel`/`dropoffLabel` were interpolated raw into single-quoted JS inside the WebView HTML (`TomTomMap.js`). The Drop-off leg is the first time the *destination* name is injected (`Drop-off: ${destination}`), so a destination with an apostrophe (e.g. `Queen's…`) broke the whole `<script>` block — `initMap()` never ran, `MAP_READY` never fired, overlay never lifted. Fixed with `escapeJsSingle` (backslash → single-quote → newline) for both labels.
- **Hardening:** `MAP_READY` is now posted *before* `applyFleetMapTheme()` (which runs in try/catch), so a theme failure can't strand the overlay. `map.js` fail-opens both remaining infinite paths: overlay auto-lifts 20 s after mount if `MAP_READY` never arrives, and the fullscreen GPS loader falls through after 15 s to render from the trip's stored coords (idle map falls back to Manila 14.6, 121.0). Also fixed the idle-branch overlay condition (`(!activeTrip || !mapReady)` was always true inside the `!activeTrip` branch → now `!mapReady`).
- Null `destination_latitude/longitude` (request-dispatched trips with no `route_id` + gazetteer miss) was ruled out as the loader cause — it only suppresses the dest pin/route/ETA, and `MAP_READY` fires before those guards.

## Arrival gates — 2026-09-09 (spam-proof proximity enforcement)
Driver report: the live map let a trip advance from pickup to Drop-off by
spamming the swipe — the "far away" warning could be retried through.
Investigation (3 parallel agents) found the real shape of the hole:

- `at-pickup`, `onboard`, `dropoff` had **zero** proximity enforcement, client
  or server — only `complete` was gated (PR #3). There was nothing to bypass;
  the warning the driver saw was the completion pre-check only.
- `SwipeButton` had no in-flight lock (`busy` prop existed but was never
  passed/checked on the gesture path), so a second swipe could double-fire a
  transition while the first PUT was still pending.
- The check verdict itself is non-deterministic across retries (new ping
  lands, 10-min freshness decay flips outside→unknown), so retry-until-green
  could land on a favorable read.

Fix — gates at the choke point, override-with-reason (same pattern as the
completion gate, never a hard block that could strand a driver):

- `setTripStatus` (`src/services/transition.service.js`) now enforces:
  `At Pickup` / `Passenger Onboard` must sit inside the **pickup** geofence,
  `Drop-off` inside the **destination** geofence, evaluated from the server's
  own latest GPS ping. `outside` → 409 (`GEOFENCE_OUTSIDE`) unless the call
  carries `{ geofence_override: true, geofence_reason }` (reason required,
  400 without it, written to audit). `unknown` stays fail-open. `En Route` is
  deliberately ungated (mid-leg consequence of onboard — gating it on the
  pickup would 409 legitimate retries filed after leaving the pickup area).
- New `checkPickupProximity` (`trip-geofence.service.js`, shared core with the
  destination check) + `GET /api/trips/[id]/pickup-check` advisory endpoint.
- Mobile: `map.js` pre-checks pickup/destination before the PUTs — outside
  offers Go Back / Proceed Anyway, and Proceed Anyway goes to the new generic
  `trip/override` screen (typed reason → PUTs with override). A 409 race
  between check and PUT surfaces the same offer. Swipe carries `busy`
  (in-flight lock in `SwipeButton` gesture path + dimmed track).
- Verified: eslint clean, `trip-geofence` + `geofence` + `trip-state` 31/31
  green (3 new pickup tests), route-auth audit 259/259.

## Map smoothness pass — 2026-09-09

Driver report: lag on the live map after the styling passes. Diagnosis (3 parallel agents) found render/bridge churn, not the clay itself (`clayMaterials` returns stable refs; only `homeMaterials` allocated per call):

- GPS `setDriverLocation` rebuilt state on **every** fix (even parked): full-screen re-render + `easeTo(2800)` camera restart + radar-marker `JSON.stringify` bridge transfer every ~3 s. Fixed with a parked bail-out (`<8 m` + `<5°` + `<1 m/s` returns prev; odometer still sees raw fixes via `distRef`) in `map.js` and `incident/navigate.js` (which also gained the 5° compass gate).
- Camera `easeTo` now re-fires only after ~16 m of movement; marker + rotation still update per fix.
- `radarMarkers` rebuild on a ~11 m quantized grid (heading-only fixes no longer rebuild); `origin`/`destination` + map callbacks stabilized with `useMemo`/`useCallback` (hoisted above early returns, null-safe).
- 15 s `loadTrip` poll gated on `AppState === 'active'`; `homeMaterials` cached per scheme; `RouteTimeline`/`RadarPulse`/`TripMapPreview` memoized with stable `stops` arrays at call sites.
- Verified: touched-file ESLint clean, full Vitest 96 files / 1098 tests green. No device profiler available — confirm on-device.
- Home follow-up: up to 3 `TripMapPreview` WebViews mounted in the same frame as the tab switch (one per trip card) — deferred each behind `InteractionManager.runAfterInteractions` (1.2 s fallback) with the loading placeholder meanwhile. No visual change after load.
- Round 2 (scroll + tap lag): map GPS watcher + 15 s poll now focus-gated (tabs stay mounted — background Highest-accuracy fixes kept feeding renders/bridge while on Home; odometer still accumulates via refs, position re-seeds on refocus); poster publishes only on change (removed the duplicate per-tick publish); Home layer memoized (header/hero/actions/cards + stable shortcuts/vehicle/callbacks) with `removeClippedSubviews` on the Home scroll; `RouteTimeline`/`RadarPulse`/`TripMapPreview` memoized.
- Round 3 (tile/tag/node shadow flattening): icon tiles, timeline nodes, status pills and small chips no longer carry `elevation`/`shadow*` (edge strips alone carry the molded read); hero/trip cards, sheets, CTAs and FABs keep full clay depth. ~15 offscreen layers removed per Home render with no layout/token changes.
- Round 4 (Android gradient overlays): metric wash, trip sheen and avatar sheen `LinearGradient`s render only off-Android (transparent overdraw every scroll frame); vehicle photo uses `fadeDuration={0}`. Clay edges unchanged, so the molded read survives.

## Related

[[Mobile Architecture]] · [[Trips]] · [[Feature Index]] · [[Graceful Degradation]] · [[ADR-011 Background GPS Tracking]]


## PR 4.5 ? Context-aware dispatch (2026-09-13, implemented)

The app-level foreground poster now also publishes checked-in standby fixes when no trip/rescue takes precedence. Standby uses separate latest-only fields (migration 111), observed-time/accuracy qualification and live-session/consent checks; it never queues offline or creates a trip breadcrumb trail. Profile controls duty via existing attendance. The driver map live label comes from acknowledged publication, not local marker movement. Generic API responses strip standby storage fields.

Verification and remaining device acceptance: [[PR 4.5 Context-Aware Dispatch Radar Implementation Plan#Implementation record ? 2026-09-13]]. Full suite: 1,140 passing tests; later focused checks: 37 passing tests; web build, Android export, route-auth audit and migration/query verification passed.


## Web standby visibility fix - 2026-09-14

The web Live Map previously consumed only active-trip GPS and rescue positions, so PR 4.5 standby publications were invisible there. It now polls the separately authorized GET /api/tracking/standby-locations feed every 15 seconds and merges verified standby pins into the existing operations map. Standby pins carry driver/plate identity, a Standby label, observation time and accuracy, without a fabricated trip or breadcrumb history. The map shows a standby count and removes expired pins or pins from a failed standby feed; active trips take precedence for the same driver/vehicle.

The endpoint requires trips:read_all, uses private/no-store responses, and reuses standbyState, qualifiedGps and effectiveStandbyVehicle. Presence requires current attendance, consent, active session, tracking enabled, no active trip/rescue, a matching eligible vehicle and a fresh accurate observation from the current duty session. This explicitly adds operations-wide standby visibility; request-specific recommendation GPS relevance and generic API storage-field suppression remain unchanged. Foreground-only publication remains the current mobile scope. Per-driver eligibility checks are reused for the small fleet; batch schedule/pairing reads if polling cost becomes significant.

Verified: 15 focused tests across four files; targeted ESLint; web production build (200 pages); route authorization audit (264 guarded methods, zero failures); new identity SQL executed successfully against the configured database. Real-device/browser acceptance remains pending.

## Driver Mobile Map audit — 2026-09-29

A full end-to-end audit of the driver mobile map and everything feeding it
(screen → hooks → APIs → DB → response → UI). Fixes below are confirmed defects,
not refactors. Verification is stated honestly: **no physical device was used**,
so every background-GPS and compass claim remains NOT VERIFIED ON DEVICE.

### 1. Live GPS is never queued offline (data integrity, high)

`lib/tracking.js` already passed `queueOnFailure: false` on the responder and
standby branches, with a comment explaining why: a live point replayed from the
offline outbox overwrites the driver's *current* position with a stale one. The
**trip** branch and the background task did not pass it, so a trip-GPS ping was
the only operational write still replayable — minutes-old coordinates landing on
the dispatcher's live map, and becoming the basis for the geofence/monitor
verdicts returned in the same response. Both now pass it.

### 2. One odometer rule set (`mobile/lib/gps-odometer.js`, new)

The segment rules existed as two hand-copied blocks — foreground in `map.js`,
background in `background-tracking.js` — and had **drifted**. The foreground copy
counted a segment on `(speed > 1 || seg > 0.02)`, an OR, so its own comment
("only counted when the vehicle is actually moving") was not what ran: a parked
vehicle drifting >20 m billed mileage every cycle. **Neither copy had any
time-delta guard** although both assumed fixes are "≤3s apart", so a resume gap
or tunnel could add a phantom segment.

The shared module measures from a stable **anchor** (not the previous fix — a
wobble would otherwise bill a 60 m segment each cycle) and applies:

| Rule | Value | Rationale |
|---|---|---|
| Max segment | 400 m | beyond this it is a glitch, not driving |
| Max implied speed | 180 km/h | matches the server's own `TRAIL_MAX_KMH` |
| Max anchor gap | 5 min | a stale fix is not a driving baseline |
| Speed `>= 0` | authoritative | "stopped" beats magnitude: parked is parked |
| Speed `null`/`-1` | unknown | magnitude may carry it, gap-bounded |

Also: no distance banks without a leg context (it previously silently fell
through to `leg2`), and the leg list is no longer duplicated — `legForStatus()`
is now the single definition shared with the background task.

Tests: `mobile/lib/gps-odometer.test.js` (15) — jump rejection incl. the
`14.60,121.00 → 14.90,121.40` scenario, sub-400 m teleport caught only by implied
speed, parked-jitter rejection, a 5-minute stationary drift banking zero, Trip
A → Trip B isolation, leg-flip straddling fix.

### 3. WebView document escaping (`components/TomTomMap.js`)

The map is one `<script>` block. Any dynamic value that closes its own quote,
carries a line break, or emits `</script` makes the whole block a syntax error:
`initMap()` never runs, MAP_READY never fires, and the globe.json overlay spins
forever. Addresses escaped **only** the single quote, so a trailing backslash
(`C:\path\`) escaped the closing quote — the identical whole-map failure the
label fix was written for. Popup labels are also interpolated into
`setHTML(...)`, so they additionally needed HTML escaping. Now: one
`escapeJsString` (backslash, quote, U+2028/9, newlines) plus `escapeHtml`.

Tests: `mobile/lib/map-webview-escaping.test.js` (15) — apostrophes, `</script>`,
trailing backslash, newlines, U+2028/9, Unicode, and a mixed torture value, each
**round-tripped through a real JS parser** rather than string-compared.

### Mobile map safety follow-up — 2026-10-02

The initial escaping implementation still left nested HTML/JavaScript contexts,
raw script-element termination, and radar-title `innerHTML` paths. These were
fixed with `mobile/lib/map-webview-data.js`: script values now use JSON literal
serialization with `<` and line-separator escaping; popup labels are escaped
for HTML and then serialized for JavaScript; CSS asset strings are escaped;
coordinates/radius are range-checked; and radar payloads are reduced to fields
needed by the map (no raw trip object). Radar text uses DOM `textContent`.

The shared odometer now turns a fix after a gap over five minutes into a
recovery candidate. A second time-ordered fix within the 400 m / 180 km/h
plausibility limits confirms the baseline without adding mileage. The
background task persists the same `prev` and `pending` state instead of
overwriting its anchor after every fix. The foreground/background transition
clears both anchors at the existing boundary, preserving the straddling-fix
drop and exact-once distance merge. The unobserved gap remains uncounted.

Verification on 2026-10-02: focused mobile tests passed (26/26), changed-file
ESLint passed, and Android Expo export bundled 1,424 modules. Native Android/iOS
WebView and background-location checks remain open because no ADB/device was
available. See [[Mobile Map WebView and GPS Odometer Safety Implementation Plan]].

### 4. Fake map entities were also suppressing real ones (high)

`getOperationalRadarMarkers` builds real assignment pins from the driver's own
pending trips **plus** hard-coded gas stations and fleet drivers at fixed offsets
from the live position. The whole builder sat behind `if (!driverLocation ||
!__DEV__) return []`, so **production rendered an empty radar** and the coverage
legend described layers that could never appear — real assignments were
collaterally suppressed by the same gate that hid the fakes. A real trip with
unresolved coordinates was placed at `lat + 0.008`, i.e. a **fabricated pin on a
real dispatch** ~900 m from wherever the driver was standing.

Now: real assignments always render, a trip without coordinates is skipped
rather than guessed, and only the fabricated entities sit behind
`DEMO_ENTITY_MODE = __DEV__`. Verified in the exported production bundle — the
station/driver strings are absent (constant-folded away) while `assignment`,
`MAP_READY` and `pickup-check` are all present.

### 5. Accept/Start race on the map (correctness)

The swipe fired `accept` **without awaiting**, then awaited `start`. The server
state machine allows only `Assigned → Driver Accepted → Trip Started`, one hop at
a time, so `start` raced the accept and could 409 with "Cannot move a trip from
Assigned to Trip Started". The driver saw a failure for what is really two
ordered steps. Accept is now awaited first.

### 6. The standby "Live Tracking" chip could not go stale (truthfulness)

The header's freshness test is `now - poster.standbyObservedAt <= 90000`, but
`now` was only advanced by an interval that ran **while a pre-start trip was
showing**. During idle/standby `now` stayed frozen at module load, so the
difference was large and negative and the chip kept claiming a live publication
long after the poster had stopped or failed. The tick now runs unconditionally.

### 7. Active-trip selection could pick a pending trip

The screen took the first non-terminal row, but the server orders by
`scheduled_departure ASC NULLS LAST`, so a pending assignment sorting ahead of
the trip being driven won — wrong route, wrong status header, wrong swipe
action, and the odometer re-pointed at an unstarted trip. A GPS-tracked trip now
always wins; pre-start is the fallback.

### 8. Impure state updater

`toggleCoverage` called `setSelectedMarker` from inside the
`setCoverageVisibility` updater — a side effect during React's render phase
(StrictMode double-invokes it; concurrent rendering warns). Moved out.

### Known limitations, deliberately unchanged

- **Background GPS is NOT device-verified.** Static analysis confirms the wiring
  (permission request, `TaskManager` definition, AppState start/stop, trip/leg
  context, AsyncStorage merge), not that Android/iOS actually delivers fixes
  while minimised or locked.
- **`onMapDragged` is a no-op** in the map screen, so a manual pan leaves the
  camera following again on the next ~16 m move. Intentional or not, it is
  unchanged — a UX decision, not a defect.
- ETA/distance on the map are **live TomTom** (`ROUTE_CALCULATED`) with
  freshness/leg-change invalidation (2026-09-30): no live route yet or a failed
  refresh renders "Calculating live route…" / "Route temporarily unavailable"
  plus a separate "Planned" line — the server-stored
  `estimated_duration`/`estimated_distance` is never substituted into the live
  slot. The radar assignment card's "Est. arrival" is a **client estimate**
  (haversine × 20 km/h), labelled as an estimate and dev-only.

→ [[Bugs]] · [[Live Map Radar]] · [[Trips]]



The Live Map is now a dispatcher operations workspace reusing the existing engines (shared trip-phase resolver, cheap-fleet + full-detail monitor, intent-anchored off-route corridor, geofence target chain, standby eligibility, RBAC). No new engine, provider, migration, or mobile scope.

- **Stable mission corridor**: pickup→destination road geometry keyed by endpoints (never by live GPS), `staleTime` 5 min; route-`id` trips use canonical route coords, route-less trips use the monitor's new additive `endpointTargets` pair (existing canonical → gazetteer chain, nulls when unresolvable). Corridor draws only with both ends known. GPS moves only the marker, the dashed amber vehicle→pickup approach stub (relationship line, never a route), and ETA math.
- **Viewport ownership**: manual drag/zoom sticks; auto-fit only on first load, mission selection (`focusStamp`), or Recenter button.
- **Scan-friendly rows**: opportunistic ETA/delay from cheap fleet rows only (zero new TomTom calls), next-trip-at-risk flag, max-2 priority tokens (VIP/Airport from `is_vip`/`service_name`, capped calm).
- **Drawer**: phase sentence ("Heading to pickup" / "Guest onboard — heading to destination"), straight-line context ("2.1 km from pickup"), corridor-specific degraded copy.
- **Resources**: `Available resources` (standby eligibility only, 30 s poll) separate from `Fleet exceptions · active fleet only` (grounded vehicles + monitor incident signals from already-loaded data — standby feed never carries unavailable vehicles).
- **Pickup-overdue**: past-baseline + no usable ETA while `to_pickup` → WATCH with reason (fail-open, no fabricated minutes).
- **Projection**: `TRIPS_SELECT` gains `priority/is_vip/is_emergency/derived_priority/service_type_id/service_name` (+ `service_types` join); guest PII stays out (pinned by test). `recorded_at` remains `COALESCE(device, NOW())` device-capture-or-server-fallback; health basis unchanged.

Verified: full Vitest 114 files / 1164 tests green (incl. 3 overdue, 3 endpointTargets, 3 projection tests; one legacy fleet test re-pinned to future-baseline for the new overdue rule); targeted ESLint clean; live-DB projection check (14 keys incl. new signals); `next build` 201 pages; route-auth audit 266/266. Browser/device acceptance pending.

## Driver mobile live-ETA honesty pass — 2026-09-30 (implemented)

Static audit confirmed the route/ETA/traffic pipeline is genuinely TomTom
(`traffic: true`, `computeTravelTimeFor: all`, `sectionType: traffic`), but the
UI overstated it in seven HIGH ways. Fixed in
`mobile/app/(app)/(tabs)/map.js` + `mobile/components/TomTomMap.js`:

1. **Leg-change stale ETA:** `routeData` cleared only on `trip_id` change, so
   pickup→destination kept showing the old leg's minutes. Now cleared on
   `trip_id | pickup/dest phase | dest coords` (`routeLegKey` effect).
2. **Failure left stale ETA visible:** recalc/initial failures only set the
   WebView banner text; native kept old numbers. WebView now posts
   `ROUTE_UNAVAILABLE` (and `ROUTE_REFRESHING` on recalc start); native marks
   `routeStale` and renders "Route temporarily unavailable" instead of numbers.
3. **Planned estimates posed as live ETA:** `estimated_duration/distance`
   (whole planned trip) filled the live slot before TomTom answered. Now the
   live slot shows `--` + "Calculating live route…" with the plan on a separate
   "Planned ~N min · M km" line.
4. **`+N min` implied addition:** TomTom `travelTime` already includes traffic.
   Badge now reads "Incl. ~N min traffic" (neutral, 2–4 min) or "Heavy traffic ·
   incl. ~N min" (≥5 min, aligned with the server monitor threshold); <2 min
   shows no badge.
5. **Per-section badges were invented:** total delay was split proportionally by
   degree deltas and labelled `+N min`. Now prefers `sec.delayInSeconds` when
   exposed; fallback stays length-weighted but uses haversine meters and is
   labelled `~N min`, shown only for ≥2 min.
6. **`ROAD_CLOSED` → `ROAD_CLOSURE`:** the explicit closure branch never
   matched TomTom's documented category; both strings now accepted (closure
   still reddens via `magnitudeOfDelay >= 3` regardless).
7. **Stuck-in-traffic starvation:** refresh skipped when moved <~20 m, so a jam
   never refreshed. Now refreshes on movement OR route age ≥4 min.
8. **Single active route:** initial load requested `maxAlternatives: 1` then the
   refresh dropped it to 0 with no explanation. Now 0 everywhere — no phantom
   alternative line.
9. **`Driver Accepted` no longer poses as en route:** header read "EN ROUTE TO
   PICKUP" before START ROUTE; now "READY TO START".
10. **Route payload carries provenance:** `ROUTE_CALCULATED` includes
    `calculatedAt`, `trafficAware: true`, `source: 'tomtom'`, and
    `noTrafficTravelTimeInSeconds` when present.

Deliberately unchanged (documented limits): traffic colouring covers the
**active route only** (no whole-map flow overlay — defense wording must say
"traffic along the active route"); the travelled portion of the polyline is not
yet trimmed; endpoint resolution is still per-module (shared
`resolveTripEndpoints` is future work).

Verified: ESLint clean on both touched files; `mobile/lib` 46 files / 525
tests green. No physical-device run — live-key ETA refresh, rerouting,
pickup→destination switch, GPS jitter, and network loss/recovery still need a
side-by-side device acceptance vs TomTom/Google Maps.


## Completion and route-session safety - 2026-10-14

Map retains active foreground/background GPS and odometer context while the driver enters the actual ending reading. Only server-confirmed completion clears leg context/stops background tracking; failed or queued writes do not release the trip. Shared GPS accumulation remains but is no longer substituted for the actual ending reading.

Live fixes move through the WebView bridge instead of rebuilding navigation. Trip-scoped preferences, driver/trip/leg keys and request sequences prevent obsolete routes replacing newer targets/choices. Missing GPS never places the driver at pickup. Failed/timed-out refreshes preserve previous geometry with explicit stale-estimate wording.

Verification: existing GPS/background/odometer plus new routing/completion interactions passed within the 1,033-test focused run. Native device/background behavior remains untested. After initial Windows file/disk failures, the Android Hermes export passed (1,455 modules / 5.65 MB); final iOS/web exports remain unverified. See [[Mobile Architecture]] for complete limits.

Final tracking follow-up: a server-confirmed completion uses the existing API event hook to clear the hidden Map's active ref, discard obsolete polls, clear its old route and reload the real next assignment. Pending background starts check the trip and app state before and after the asynchronous OS start, stopping if completion or foreground return intervened. Executable tests cover completion before and during start, refused/queued responses and another trip's event. The final 1,033-test run includes these guards and the single-scroll-area sheet correction. Focused source review found those two fixes resolved; native visual review remains pending (`recapture`) because no device/emulator captures were available.
