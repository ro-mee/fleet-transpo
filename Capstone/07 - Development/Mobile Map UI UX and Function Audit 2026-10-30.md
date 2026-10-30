---
type: audit
date: 2026-10-30
status: implemented in source; browser and device acceptance pending
scope: mobile Map only
related: ["[[Live Map Radar]]", "[[Tracking]]", "[[Mobile Architecture]]", "[[Mobile Map Functionality Repairs 2026-10-21]]"]
---

# Mobile Map UI, UX and function audit — 2026-10-30

## Approved implementation follow-through — 2026-10-30

The owner subsequently authorized the complete Map plan, including all eight findings. They are now addressed in application source. The original findings and proposal images below are historical evidence of the initial audit, not the current implementation or new acceptance screenshots.

| Finding | Implemented resolution |
|---|---|
| MAP-01 | Fresh raw GPS within50m of the actual target controls the arrival banner. Missing/exhausted guidance stays neutral; raw/snapped, old/future and bootstrap-order regressions are covered. Server arrival remains manual. |
| MAP-02 | Single-owner native readiness before Maps and again after optional Settings; observable failure, explicit untracked choice, late-operation invalidation and failed-launch cancellation. |
| MAP-03 | Production assignment pins no longer contain heuristic arrival minutes. Distances say straight-line; road ETA requires actual current provider results. |
| MAP-04 | Measured scroll-bounded standby stack; active recovery inside trip scroll content, bounded separately when minimized. Directions/control clearance is reserved before sheet height. |
| MAP-05 |48dp layer controls, checked/expanded semantics and supported-layer-only Show all. |
| MAP-06 | Restore and persistent map controls use the shared safe navigation clearance and actual sheet geometry. |
| MAP-07 | Assignment count and View assignments remain available for missing/unverified coordinates. No fabricated pin or misleading waiting state while work exists. |
| MAP-08 | Named native HTML marker/cluster/control buttons retain activation/Escape behavior; native Trips is the reachable list alternative. |

Approved compact stage summaries and refined directions were implemented alongside these fixes. Existing trip/Cargo/geofence/ending-odometer handlers are retained. The independent review found and resolved three additional edge cases: short-screen directions collision, stale tracking readiness after Settings and future bootstrap timestamp ordering. Final automated evidence, exact source scope and remaining browser/device acceptance: [[Mobile Map Approved Improvements Implementation 2026-10-30]].

What this screen does: it shows the signed-in driver's own location, assigned pickups, current route and next trip step. Passenger and Cargo share the map and navigation controls, while keeping their separate information and clearance rules. The expected use is one driver with a small assignment list, up to three provider route choices and an active trip; this review does not establish whole-fleet capacity.

The initial audit requested a side-by-side visual like the earlier navigation comparison. **At that checkpoint no mobile application source was changed.** The current clay cards, approved Home artwork, bottom navigation and operating rules remain. The proposed right-hand images are review fixtures, not an implemented redesign. Audit tooling, documentation and images are the only additions for this task.

## Map visibility correction and competitor study — 2026-10-30

The owner liked the stage clarity but rejected the amount of map obstruction. The next review variant keeps a compact travelling tray, required at-stop checks and expandable details. The normal390×800 travelling Cargo fixture shrank from454px to166px (288px reclaimed); expand/collapse and retained pickup verification were checked. This supersedes the earlier tall travelling layout as the recommended direction, not as implemented source.

REA's Android inspection was attempted but returned a missing-adb provider error; no APK was supplied/found in the bounded package searches. Native inDrive/Grab/MOVE IT behavior was not reverse-engineered. Official driver documentation/images supply limited comparative evidence; exact current native mechanics remain unknown. Local source also shows fixed active-route camera padding, so production correction must account for measured overlays as well as reduce the sheet. See [[Mobile Map Visibility and Driver App Study 2026-10-30]]. No mobile production source changed.

## Trip-cycle visual coverage correction — 2026-10-30

The owner pointed out that the delivered images did not show the trip-cycle UI. The initial source/function audit included progression, but its paired visuals covered only standby/recovery. This visual gap is now filled with six stages each for Cargo and Passenger: ready, travelling to pickup, at pickup, travelling to destination, at destination, and completed/return to standby.

Twelve saved comparisons use the real Map with sample service boundaries. The proposed summary makes stage/stop/next step explicit, places route estimates consistently, retains real load/passenger facts, and uses Confirm loading/boarding or Finish trip where appropriate. The latter explains the existing ending-odometer step (map.js:2510), rather than implying the arrival swipe alone completes the trip. All original safety callbacks, Cargo verification/source/Fleet/receiver gates, manual arrival and completion authority remain unchanged. No mobile source was edited.

These are review concepts, not an approved/apply-complete layout. More context can consume more map space; density and native/map visibility must be resolved before production implementation. Both completion fixtures remove the former stop/route; Cargo keeps its confirmed completion reference, Passenger returns to its existing standby surface. The completion event itself is simulated, not a live trip write.

Verification for this follow-up: both fixture bundles build; all 12 browser stage/action records checked and 12 screenshots saved with loaded fonts; completion records contain no former stop names. No new full/native test pass is claimed. Gallery: http://127.0.0.1:4194/map-cycle-gallery.html. Durable table/images: docs/design/mobile-map-audit-2026-10-30/trip-cycle-review.md. Evidence: scratch/mobile-map-audit-2026-10-30/cycle-browser-checks.json. The eight implementation findings below remain recommendations, not fixed code.

## Verdict and evidence boundaries

The native screen structure is sound enough to preserve: real Expo routes, labeled 48dp main map controls, native scroll surfaces, manual trip progression and server-owned authority. It is not a website pasted into an app. It does **not** yet pass release acceptance: missing-guidance arrival wording and background tracking readiness need correction first; overlay placement, small layer targets and WebView control semantics also need work.

**Eight findings: 0 P0, 2 P1 and 6 P2.** P1 means fix before release; P2 means a usable workaround exists but correction is needed. There is no new P0 blocker demonstrated by this audit.

The UI score below is a provisional source/browser-fixture assessment for the Android phone surface, not an accessibility certification or a measured hardware performance score.

| Dimension | Score | Evidence |
| --- | --- | --- |
| Accessibility | 2/4 | Main native controls are named; layer switches are much smaller and map-document controls lack button semantics. |
| Performance | 3/4 | Memoization, quantized marker updates, bridge throttling and hidden-map work gates are present. Physical frame rate and battery cost were not profiled. |
| Appearance and theming | 2/4 | Existing light/dark clay identity is coherent; standby uses its own two palettes and is not fully driven by high-contrast semantic colors. Full theme contrast was not certified. |
| Platform conformance | 3/4 | Native routing, touch-sized main controls and safe-area-aware primary sheet are present. A restore control still uses a fixed bottom offset. |
| Adaptivity | 2/4 | Primary sheet is measured and bounded, but standby overlays independently claim the same vertical space. Large-text/tablet/landscape acceptance remains open. |
| **Total** | **12/20** | **Significant targeted work needed; preserve the existing design.** |

## Must fix

### MAP-01 · P1 · Missing directions can produce a false “Arrived” banner

**Location:** `mobile/components/TomTomMap.js:1238`, `:1290`, `:1340`; `mobile/lib/navigation-route.js` route candidate validation/draw.

**What this is:** the map document chooses the next driving instruction and shows the navigation banner.

**Problem:** a provider route with valid geometry/metrics but missing guidance is accepted. The route controller sets `routeInstructions` to an empty list. With no upcoming instructions, the banner uses distance to the **route line**, rather than distance to the **destination**, to decide it has arrived. A driver on the start of a long route is close to that line.

**Reproduction:** the shipped `updateNavigationBanner` function was executed with a fresh fix at `[121, 14.6]`, a route ending at `[121.1, 14.7]`, empty instructions and zero distance to the route. It wrote `Arrived`. This is a UI assertion; it does not itself change the trip's server status.

**Smallest fix:** distinguish missing/exhausted guidance from arrival. Require a verified distance to the current destination before displaying arrival; otherwise show directions unavailable or keep a neutral route view. Preserve the manual arrival gesture and server geofence/override checks. Add a regression case with valid geometry and no guidance.

**If skipped:** the driver can receive arrival guidance while still far from the pickup/delivery. Suggested action: `$impeccable harden` plus a focused function correction.

### MAP-02 · P1 · Google Maps opens without confirming background tracking

**Location:** `mobile/app/(app)/(tabs)/map.js:1420`; `mobile/lib/trip-location-owner.js:120`; `mobile/lib/background-tracking.js:165`.

**What this is:** FleetOps hands the driver to Google Maps and relies on its app-level owner to continue location collection.

**Problem:** the handoff sets `trackingReady` from foreground permission alone. Background permission/task readiness is not established there. After backgrounding, the owner calls `startBackgroundTracking()` but does not act on its `{ok:false}` result. A background denial or OS start failure can therefore occur without the existing “Continue Without Tracking” choice being offered by the handoff.

**Reproduction:** the actual Map handoff callback was run with foreground granted and a denied background-permission probe available. It checked foreground once, checked background zero times, opened Maps once and showed no tracking warning. Source tracing confirms the background start result is ignored. OS behavior on a real device was not simulated by this probe.

**Smallest fix:** let the existing single tracking owner expose/confirm background readiness before the handoff, and surface a failed start. Keep native lifecycle ownership in that owner; do not add a second task starter. Only arm the return bubble from truthful readiness, and retain the explicit untracked continuation choice.

**If skipped:** live dispatch positions and collected distance may stop while the driver believes the handoff prepared them. Suggested action: `$impeccable harden` plus focused owner/handoff tests, followed by a real permission-denied/background-drive test.

## Should fix

### MAP-03 · P2 · Assignment “arrival” minutes are a straight-line guess

**Location:** `mobile/app/(app)/(tabs)/map.js:265`, `:283`, `:2003`.

**What this is:** a selected pending assignment shows its distance and estimated arrival.

**Problem:** production assignment markers calculate `etaMinutes` as `max(3, round(haversineKm * 3.5))`. The details card labels it `Est. arrival` without showing the existing `etaSource: client-estimate`. Road access, traffic and the provider route are not involved. The comment claiming this is absent in production is obsolete: real assignment pins are explicitly returned before the development-only branch.

**Reproduction:** the actual production marker builder returned a four-minute estimate for a one-kilometre straight-line distance. The card renders that number as arrival minutes. The actual-component comparison reproduces the normal 1.5km/five-minute sample.

**Smallest fix:** label the distance as straight-line; show road ETA unavailable until a provider estimate for this driver-to-pickup route exists. Reuse a legitimate provider value if it has matching target/freshness, rather than fabricating one.

**If skipped:** drivers can plan around misleading travel minutes. Suggested action: `$impeccable clarify`. See `assignment-review.jpg`.

### MAP-04 · P2 · GPS recovery, standby header and layers overlap

**Location:** `mobile/app/(app)/(tabs)/map.js:1478`, `:1762`, `:1768`, `:1792`.

**What this is:** the standby view independently positions its status, delayed-GPS card, layers and transient assignment banner.

**Problem:** GPS notice top is `max(topInset,20)+76`; expanded layers top is `topInset+92`; the assignment banner also uses `topInset+92`. These surfaces do not reserve each other's measured height. At the 24dp sample top inset, layers begin just 16dp below the GPS card's top and cover its explanation/retry area. The header can cover the first part of the notice too.

**Reproduction:** a delayed fix plus expanded layers in the actual Map component shows the collision. The proposal uses measured header/GPS heights to stack them. This is browser layout evidence, not a physical gesture test.

**Smallest fix:** provide one measured vertical stack for top overlays, allow scrolling/collapse when space is short and place transient feedback without covering recovery. Preserve map controls and the compact weather-only rule.

**If skipped:** a driver cannot clearly read or use the recovery action when layers are open. Suggested action: `$impeccable layout`, then `$impeccable adapt`. See `gps-recovery.jpg`.

### MAP-05 · P2 · Layer switches have very small tap areas

**Location:** `mobile/app/(app)/(tabs)/map.js:2753`, `:2784`, `:2804`, `:2808`.

**What this is:** Coverage Legend contains a toggle header, layer switches and Show all.

**Problem:** the header has only a 28dp minimum. Each switch has 11-size text and 2dp vertical padding, without a minimum height or extra hit area. Current React Native Web switch rows measured **17px high**; the proposal measured **48px**. The native style itself has no 48dp target floor, though the exact native text height needs a phone check. Show all is small too and currently appears even when all supported production layers are already enabled, because hidden development layers are included in its condition.

**Smallest fix:** preserve the existing clay surface while providing 48dp row targets, readable theme type, checked state and spacing. Calculate Show all from supported layers only. Android recommends at least a 48×48dp focusable area, including padding. [Android accessibility guidance](https://developer.android.com/guide/topics/ui/accessibility/views/apps-views).

**If skipped:** map filtering is harder to tap accurately, especially with enlarged text or reduced dexterity. Suggested action: `$impeccable adapt`.

### MAP-06 · P2 · “Show trip info” can overlap bottom navigation

**Location:** `mobile/app/(app)/(tabs)/map.js:2167`, especially `:2174`; shared bottom clearance at `:548`.

**What this is:** Overview minimizes the trip sheet and leaves a restore control.

**Problem:** primary sheet placement uses safe-area-aware `standbyBottom`, but the restore control uses a fixed `bottom:88`. At an 800dp screen height and 48dp bottom inset, the original bar begins at y=684; the restore control extends to y=712, into the bar's band. It may become partly covered or harder to tap. The sheet's native control row also moves offscreen with the minimized sheet, so the map-document controls' accessibility matters.

**Reproduction:** current layout arithmetic demonstrates a 28dp overlap into the navigation band. Native stacking/touch clipping remains to be confirmed on the intended device; the calculation does not establish the entire button is unreachable.

**Smallest fix:** use the shared bottom clearance for the restore control and verify it with 0/16/48dp inset cases. Keep the existing navigation position and the user's approved curve on other tabs. Map intentionally continues to hide scan/curve.

**If skipped:** restoring the trip sheet is less reliable on phones with larger navigation insets. Suggested action: `$impeccable adapt`.

### MAP-07 · P2 · Assigned work can be absent from the Map while it says “Waiting”

**Location:** `mobile/app/(app)/(tabs)/map.js:261`, `:867`, `:1787`, `:2079`; `mobile/components/TripOperationalSummary.jsx` standby copy.

**What this is:** pending assignments are discovered through pickup pins in standby.

**Problem:** correctly, a trip without verified pickup coordinates produces no invented pin. But no non-map assignment entry or pending count replaces it, and both the header and Cargo standby card still say the driver is waiting for an assignment. The trip can exist in Trips while remaining undiscoverable within this Map view.

**Reproduction:** the production builder returned zero markers for an assigned row without pickup coordinates. Source and the fixture confirm standby wording is independent of `nearbyTrips.length`.

**Smallest fix:** expose the existing pending count with a real Open Trips action. Say that a pickup location needs verification when applicable. Do not invent a pin, route, ETA or a new dispatch workflow. The visual proposal demonstrates clearer count/copy; a production action still needs implementation.

**If skipped:** the Map suggests there is no work even though the driver has an assignment. Suggested action: `$impeccable clarify`, then `$impeccable harden`.

### MAP-08 · P2 · Map-document controls lack accessible button behavior

**Location:** `mobile/components/TomTomMap.js:554`, `:562`, `:957`, `:1023`.

**What this is:** the map WebView creates clickable recenter/overview controls and assignment/cluster markers.

**Problem:** they are clickable `div` elements with no button role, focus index or keyboard activation handlers. Icon-only document controls also lack accessible names. Native controls around the map are labeled, but do not supply semantics to the controls and assignment pins inside the document.

**Evidence:** direct source inspection of the generated document and marker creation. This establishes missing markup/activation behavior, not a tested claim that every TalkBack user is blocked.

**Smallest fix:** use real named buttons or equivalent role/focus/Enter/Space behavior in the document, with meaningful marker names and a native/list alternative for assigned work. Avoid trapping map gestures or flooding screen readers with GPS updates.

**If skipped:** keyboard, switch-control and screen-reader operation remains less predictable. Suggested action: `$impeccable harden`, then physical TalkBack testing.

## What works and should stay

- Accepted/ongoing work takes priority over earlier pending assignments. Pending work remains in the standby radar.
- Server/profile/session/type/vehicle confirmation guards remain. A queued update is not accepted as confirmed success; Cargo source/Fleet/receiver clearance is preserved.
- Pickup/destination targets use the shared phase helper and reject unresolved provenance. No fake pickup pin is substituted for a missing coordinate.
- Active route metrics are separated from planned whole-trip metrics. Route session keys, leg-change resets, stale estimates and timeout/retry paths are present.
- Map and GPS retries are separate. Hidden display sensors and renderer work are paused while trip distance collection belongs to the app-level owner.
- Native main map controls have labels and 48dp targets. Sheet expansion has an accessible button, measured content bounds and a reduced-motion path.
- Arrival actions remain human-confirmed. API endpoints check ownership and the server transition service checks state/clearance and proximity/typed override rules. A map banner is not server authority.
- Passenger call availability depends on an actual number. Cargo information does not become invented guest information.
- Production excludes the fabricated gas-station/other-driver feeds. Keep the approved brand, Home imagery, clay materials and bottom navigation.

## Function coverage and verification

| Flow | Evidence and result |
| --- | --- |
| Off Duty / Rest Day / On Leave | Source gates and existing empty-state tests pass; no new duty behavior proposed. |
| Standby / assignment selection | Real pins, accepted-trip priority, pending selection and duplicate-accept guards covered; MAP-03/07 remain. |
| Passenger / Cargo progression | Current render/readiness/action tests pass; server authority paths inspected and focused tests pass. |
| Route choices / toll preference | Existing provider geometry/metrics/selection/session tests pass; no fabricated alternate proposed. |
| GPS / renderer recovery | Cleanup, freshness, retry/error and hidden-state tests pass; standby layout collision remains. |
| External navigation / return bubble | Existing handoff/race tests pass; added callback probe exposes background-readiness gap. Bubble visibility is not proof of tracking. |
| Arrival / geofence override | Existing typed-conflict/manual-transition tests pass; separate missing-guidance banner probe exposes MAP-01. |
| Insets / accessibility | Actual-component fixture confirms overlap and 17px layer rows; source confirms restore offset and WebView semantics gaps. Native acceptance remains open. |

Fresh commands/results:

- **506 tests passed / 24 mobile files** covering Map, routing, GPS, background owner, bridge, guide and Cargo presentation.
- **130 tests passed / 8 backend files** covering trip feed, acceptance, start, transition, geofence, trip state and driver/vehicle type checks. These use existing isolated test boundaries, not live operating writes.
- **Five audit probes** reproduced false arrival, handoff readiness checks, heuristic arrival minutes, omitted unresolved-location assignment and restore/inset arithmetic. They assert the observed defects; a successful probe run does not mean those defects are fixed.
- Both current/proposal browser bundles build. Existing `mobile/components/ui.js` emits a duplicate `borderRadius` warning; no build failure. This harmless pre-existing duplicate was left outside this Map audit.
- Actual Map screen fixtures inspected for assignment, delayed GPS/layers and active Cargo route. The proposal is an in-memory source copy used only by the fixture. Fonts/icons/clay/native layout components come from current source; OS/API/location services are replaced with sample boundaries.
- Browser layer switch measurement: current 17px vs proposed 48px. The source's current target style is consistent with this risk; this is not an Android measurement.

No new Android/iOS export, installation, physical GPS drive, live API/database query or performance profile was run for this read-only audit. No full-repository test pass is claimed. Large-text, all-theme/high-contrast contrast, landscape/tablet/foldable layouts, screen-reader focus/gestures, native keyboard and actual map-provider availability still require acceptance. The schematic map in the images does not prove live map rendering or turn accuracy.

Evidence tools and logs are in `scratch/mobile-map-audit-2026-10-30/`: `verify-findings.mjs`, `findings-evidence.json`, `tests.log`, `server-tests.log`, `preview.mjs`, `preview-body.txt`, `fixture.jsx`. Existing local preview server serves the fixtures at port4194. Durable image explanations are in `docs/design/mobile-map-audit-2026-10-30/README.md`.

## Recommended order

1. `$impeccable harden`: MAP-01/02 first, with focused regression tests. Keep one background tracking owner and all server checks.
2. `$impeccable layout` / `$impeccable adapt`: MAP-04/05/06, including enlarged text and safe areas.
3. `$impeccable clarify`: MAP-03/07 without adding invented information or removing approved visuals.
4. `$impeccable harden`: MAP-08 plus device screen-reader acceptance.
5. `$impeccable polish`: final visual consistency after functional correction and native verification.

These recommendations can be implemented separately or together. Re-run the audit after fixes; the current report and images are recommendations only.

**Verdict:** fix false arrival and tracking readiness first; enhance the existing Map instead of replacing it. **Not checked:** physical device behavior, real road/GPS/provider results, live database, all-device/theme acceptance and load/performance profiling.
