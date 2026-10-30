---
type: implementation-plan
date: 2026-10-30
status: implemented and automated checks passed; browser and device acceptance pending
related: ["[[Mobile Map UI UX and Function Audit 2026-10-30]]", "[[Mobile Map Visibility and Driver App Study 2026-10-30]]"]
---

# Mobile Map Approved Improvements Implementation Plan

**Goal:** Apply the approved compact Map, directions design and all eight audit fixes.

**Architecture:** Preserve the canonical Map, single trip-location owner and existing server/Cargo state machine. Use a shared compact summary for both modes, expandable details, measured overlays and a non-reloading camera-inset bridge. Keep provider route calculations separate from UI framing.

**Tech stack:** Installed Expo54, React Native0.81.5/React19.1, TomTom Web SDK6.25.0 inside WebView, existing Vitest/native render harness. Read required Expo57 guide; do not upgrade SDK/dependencies.

**Constraints:** Preserve dirty checkout and approved Home/navigation/clay appearance. No DB/operating-data writes, deployment, commit or new dependency. Current source snapshot: scratch/mobile-map-implementation-2026-10-30/source-baseline.json. User approved the design and authorized all implementation; no intermediate permission gates.

## Task 1 — Renderer reliability, directions and camera

Files: mobile/components/TomTomMap.js; focused renderer runtime tests and optional small map-document helper.

- [x] Add failing runtime cases for valid route without directions far from target, target proximity, stale fixes and unexpected maneuver.
- [x] Fix MAP-01: proximity to destination, never proximity to the route line, controls the arrival banner. Missing/failed directions remain neutral; no server transition changes.
- [x] Apply approved banner: clear turn glyph, semantic clay surface, distinct distance/action/street, integrated optional following maneuver. Preserve dynamic text and unknown maneuvers truthfully.
- [x] Fix MAP-08: named keyboard-operable controls/markers; preserve touch behavior and escaped strings. Native/list assignment alternative is Task3.
- [x] Expose viewportInsets={{top,bottom,left,right}} and onNavigationLayout({height}) to Map. Measured insets update via bridge without rebuilding HTML or rerouting. Apply to overview/recenter/follow while preserving manual pan.
- [x] Verify focused runtime tests/lint; record actual interface and evidence.

## Task 2 — Background readiness

Files: mobile/lib/trip-location-owner.js, background-tracking.js as necessary, owner/handoff tests. Parent integrates only a minimal Map import/call.

- [x] Reproduce MAP-02 with foreground granted/background denied/start failure/session changes.
- [x] Expose prepareTripNavigation({tripId,leg,requestPermission}) from the single owner: verify current identity and background permission/readiness before Maps opens. Do not create an independent competing starter.
- [x] Surface background start failure truthfully through an owner status subscription and retain the explicit Continue Without Tracking path. Invalidate late readiness by current trip/session/visibility.
- [x] Verify native-boundary regression tests; return exact Map integration expression and status interface.

## Task 3 — Canonical screen and stage summaries

Files: mobile/app/(app)/(tabs)/map.js, map/PassengerMapSummary.jsx, TripOperationalSummary.jsx, new map/MapTripSummary.jsx, MapControlCluster.jsx if necessary; focused render/layout/marker tests.

- [x] Add regressions for MAP-03/07: production markers contain no heuristic road ETA; unresolved coordinates still expose assignment count/Open Trips; no fabricated coordinates.
- [x] Add meaningful stage render tests: ready/pickup/boarding/travel/finish, both modes, loading/stale estimates, Cargo checks and expanded details.
- [x] Compact travelling primary summary contains stage/current stop/valid ETA-distance and one unchanged next action. Expanded detail retains actual load/passenger/vehicle/reference and manifest/detail controls. At-stop Cargo retains verification entry/blocker. Finish wording explains ending-odometer form; keep handlers and authority.
- [x] Fix MAP-04: one measured/scroll-bounded standby status/GPS/notification/layers stack; active GPS notices respect measured directions height. Preserve weather and recovery.
- [x] Fix MAP-05: layer targets >=48dp, semantic checked/expanded state, Show all considers supported layers only.
- [x] Fix MAP-06: minimized restore and controls use shared safe clearance; no fixed88dp bottom. Use measured current sheet/controls and top overlay bounds for renderer viewportInsets.
- [x] Integrate Task2 readiness/status. Run current-operation/geofence/Cargo regressions before completing.

## Task 4 — Review, verification and documentation

- [x] Run focused then full mobile library tests and relevant backend transition/permission tests. Strict changed-source lint, UTF8/whitespace and Android Hermes export.
- [x] Bundle current-source native-screen read-only fixtures with sample service/map boundaries. No production source rewrite or operating-data write. Provider/directions rendering is explicitly replaced, not validated by this fixture.
- [ ] Environment-deferred acceptance: browser access was disabled in Work settings before inspection, so fresh light/dark/narrow/enlarged screenshots could not be captured. Physical provider, GPS, permissions, gestures and accessibility remain device acceptance items; old proposal images are not implementation evidence.
- [x] Independent code review of task changes against starting snapshot and approved scope; resolve substantive findings and rerun covering checks.
- [x] Update audit finding ledger, Map visibility/feature/architecture/tracking notes and SYSTEM.md with actual results. No success or native claim from stale tests or preview-only code.

## Completed implementation and evidence — 2026-10-30

Canonical source changed only `map.js`, `TomTomMap.js`, `trip-location-owner.js` and `background-tracking.js` relative to the nine-file starting snapshot. Added `MapTripSummary`, `MapAssignmentNotice`, `map-layout` and focused regressions; adapted existing source-sliced camera/handoff fixtures to the new real interfaces. Older summary components remain available. Prior unrelated checkout changes were preserved. No dependency/SDK upgrade, DB/data write, deployment, commit or push.

All MAP-01 through MAP-08 are addressed in source; the resolution table is in [[Mobile Map UI UX and Function Audit 2026-10-30#Approved implementation follow-through — 2026-10-30]]. The new compact summary and refined directions retain existing manual/server/geofence/Cargo/ending-odometer behavior.

### Final verification

- **1,814 tests passed in 148 files: 1,667 mobile-library tests/139 files and 147 backend tests/9 files. No failures or skips.** Executed `run-verification.py tests`; exact JSON: `scratch/mobile-map-implementation-2026-10-30/verification-tests.json`. Includes the whole `mobile/lib` tree, transition/geofence/type/load/scheduling checks, mobile assignment/accept and trip accept/start routes.
- Strict lint passed on all19 task-touched JavaScript/JSX files with zero warnings. This covers implementation plus new/adapted tests; no threshold or suppression was added to silence a task failure.
- Android Hermes export passed after the final review fixes:1,545 modules,6.53MB bundle,103 assets. This is a JavaScript/asset export, not a new APK or phone installation. `scratch/mobile-map-implementation-2026-10-30/export.log` and `android-export/` contain evidence.
- Current-source native-screen sample bundle builds. Existing duplicate borderRadius warning in shared ui.js remains outside this task's unchanged styling scope. The schematic map and a clear directions-placeholder replace provider rendering; no fresh screenshot or rendered-layout acceptance is claimed.
- Independent review of actual task delta:21 focused files/387 tests passed; no remaining Critical/Important finding in reviewed scope. Source-snapshot diff saved as `scratch/mobile-map-implementation-2026-10-30/implementation.diff`.
- Renderer report:20 new runtime cases and103 focused tests. Tracking report:274 focused tests including8 real owner/native-background integration cases. These overlap with the full run and are not additive totals.
- UTF-8 and task whitespace checks are recorded in the final verification summary after documentation synchronization.

### Review corrections with reproduced regressions

1. Expanded/large collapsed sheets could collide with measured directions at667dp height. Geometry now reserves actual banner height and controls; recovery scrolls inside the measured content. At top24/bottom90/banner112, sheet top222 and controls164–212 stay below banner ending146. Only the handle owns dragging; content keeps normal scroll behavior.
2. Optional shortcut Settings could stop earlier native preparation. The shortcut offer now occurs inside prepare; after its asynchronous wait, a second nonprompting owner check must succeed before Linking. A failure reaches the existing explicit untracked choice; stale target work cancels its preparation. Real lifecycle/mutation tests reproduced and eliminated premature Maps launch.
3. A future timestamp on cold initialization could poison the new ordering watermark. Both initial and delivered watermarks are validated against current time; valid later fixes resume immediately. Two regressions reproduced and fixed the edge case.

### Remaining environment/device acceptance

Browser access was disabled; no fresh current-implementation visual inspection was possible. Earlier audit/prototype images remain references only. The automated generated-document/native-boundary tests and Android export do not establish physical behavior.

Device acceptance must check live provider tiles and turn text in both themes; narrow/enlarged text and safe insets; expanded/minimized scrolling/dragging and layer/marker touch targets; TalkBack/keyboard activation; actual foreground/background permission and optional Settings return; Maps departure/return, shortcut/notification removal, locked-screen moving fixes and real mileage continuity. Native registration does not prove GPS delivery. No native competitor REA claim is made.

Documentation synchronized: [[Live Map Radar]], [[Tracking]], [[Mobile Architecture]], the audit/visibility notes and root SYSTEM.md. These current entries supersede historical proposal-only status while preserving its evidence.
