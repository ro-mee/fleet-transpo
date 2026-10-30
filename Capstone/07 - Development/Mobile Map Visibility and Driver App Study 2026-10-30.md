---
type: design-research
date: 2026-10-30
status: approved Map implemented; browser/device acceptance and native competitor REA pending
related: ["[[Mobile Map UI UX and Function Audit 2026-10-30]]", "[[Live Map Radar]]", "[[Tracking]]"]
---

# Mobile Map visibility and driver-app study

## Approved compact Map implemented — 2026-10-30

The later owner instruction authorized the full approved direction and all eight audit fixes. The canonical Map now contains the compact travelling summary, expanded real details, required at-stop Cargo entry and contextual trip actions. The actual renderer contains the refined semantic/clay directions design, measured banner-height reporting and non-reloading camera insets. Manual camera ownership and existing operating gates are preserved.

The sheet reserves directions/control space, including short-screen expanded cases; recovery is scrollable and the handle alone captures sheet dragging. Tracking is rechecked after any optional Settings wait before Maps opens. See [[Mobile Map Approved Improvements Implementation 2026-10-30]] for source/test/review evidence and the completed finding ledger.

Earlier prototype screenshots below remain design references. Current-source read-only fixtures were bundled, but browser access was disabled in Work settings during implementation, so no fresh production-implementation screenshot or visual acceptance is claimed. Native competitor REA and physical phone/provider/GPS/accessibility acceptance remain unresolved; the public competitor references did not become verified native evidence.

The owner liked the clearer trip-cycle summaries but reported that they cover too much map. The follow-up request was to investigate inDrive, Grab and MOVE IT through REA and recommend a better arrangement. Because FleetOps is a driver workspace, driver navigation is the relevant comparison; customer booking screens do not establish driver behavior.

## Recommendation

Use a compact travelling tray, a slightly larger at-stop tray for required checks, and expanded details on demand. Keep the clearer stage wording and the approved clay appearance. Move secondary information out of the travelling tray, rather than deleting it from the app. Keep the existing bottom navigation and manual/safety actions.

The map camera must also reserve the actual space occupied by overlays. Making the tray smaller alone does not guarantee that the car, target or next turn stays visible. The map should frame its useful area above the tray and below the instruction/status area, while respecting manual panning.

| View | Visible content | Information available on demand |
| --- | --- | --- |
| Travelling | Current stage/stop, short valid ETA/distance, one next action | Cargo/passenger facts, vehicle/reference, manifest and other trip details |
| At pickup/delivery | Current stop, relevant verification entry, required next confirmation | Full evidence/check explanations, manifest/details |
| Expanded | Full stage context and existing detail/verification entries | The existing trip-detail destination remains available |

Do not shrink buttons or text to force a fixed tray height. Allow natural growth for large text, long targets, loss of connection and blocking checks. The normal-size travelling fixture measures 166px, but that is a prototype result, not a universal native height requirement. Do not automatically collapse a panel while the driver is reading details, interacting with a field or reviewing a hold.

## Directions-banner UI refinement — 2026-10-30

The owner clarified that this pass is only about the directions banner. The review proposal now uses a clearer32px turn arrow on a forest/mint semantic primary tile, groups distance and maneuver, gives the road its own line and integrates the quieter following maneuver into the same clay surface. It uses shared theme colors and Plus Jakarta Sans, with no new dependency. Both comparison columns keep the same compact Map and bottom controls; only the banner differs.

Measured light/dark/narrow fixtures: the refined banner is112px high, matching the existing banner plus floating Next badge. The narrow frame has286px of banner width with no horizontal overflow. These are normal-text browser measurements, not a hard native size contract or large-text acceptance. The proposed road line can wrap instead of relying on the old single-line ellipsis.

Verification: current/proposal bundles build; light, dark and320px frames inspected with loaded fonts; height/overflow assertions and three browser records saved. Captures: refined-directions-detail.jpg, refined-directions-full.jpg, refined-directions-dark.jpg, refined-directions-small.jpg. Evidence: scratch/mobile-map-audit-2026-10-30/refined-directions-checks.json. Preview: http://127.0.0.1:4194/map-directions-refined.html .

This is a directions-only design preview. No mobile application source, route selection, location, camera framing, trip action or server rule was changed. Live provider/voice/large-text/native accessibility behavior is not established. The previous audit defects and camera/device acceptance remain open.

## Turn-by-turn directions included — 2026-10-30

The owner asked where route directions belong. The existing map already renders a separate top instruction banner (`mobile/components/TomTomMap.js:289`, `:536`, `:1297`) with maneuver icon, distance to the next maneuver, instruction/street and an optional Next-maneuver badge. The earlier schematic preview omitted it, so that picture did not show the complete navigation layout. This was a fixture omission, not removal from production.

The corrected review uses the current banner CSS/HTML and actual maneuver SVGs with explicit sample values:200m, right turn, Sample Rd, then straight. It appears alongside both the earlier tall proposal and the compact tray. Top directions answer what to do next on the road; the bottom tray names the current trip stop, remaining route estimate and human-confirmed trip action. The camera recommendation reserves both areas. Full step lists should stay behind details rather than permanently consuming map space.

Cargo and Passenger healthy-route samples show the banner; both GPS-lost samples hide the illustrative turn and expose Retry GPS. These fixtures demonstrate layout/state intent; they do not newly test the real provider, distance-to-maneuver calculation or production freshness controller. The original missing-guidance false-arrival finding remains open, as do native camera integration and device acceptance. No voice navigation, lane guidance or new routing capability is claimed.

Verification: current/proposal bundles build; four healthy/lost browser samples inspected, with loaded fonts and captured images. Source-derived banner includes real current theme roles. Saved directions-and-compact-tray.jpg, directions-passenger.jpg and gps-lost-cargo/passenger.jpg under docs/design/mobile-map-audit-2026-10-30/. Browser records: scratch/mobile-map-audit-2026-10-30/directions-browser-checks.json. No mobile source or operating-data changes. Preview: http://127.0.0.1:4194/map-directions-cargo.html .

## What REA could and could not establish

The actual REA call `inspect_adb_client({})` returned `capability_unavailable` / `unsupported_provider`:

> The selected adb binary was not found: adb. Set REA_ADB_PATH to an absolute path to an existing adb binary.

This is a provider failure, not successful app analysis, and no native-analysis Evidence ID was produced. Three conventional local adb paths were checked and were absent. No explicitly named Grab/inDrive/MOVE IT APK/APKS/XAPK was found in the bounded Downloads and scratch searches. No APK was supplied by the owner. This does not prove no Android phone is attached or no package exists anywhere on the computer; those were not established.

No APK was acquired, decompiled, installed or run. No app account, booking, ride, personal trip or live traffic was inspected. Native competitor REA remains unresolved until an actual package or a working Android inspection setup is available. No REA/client configuration or Android tooling was installed or changed. Public reference observations below are **not** native REA findings.

## Public evidence ledger

### Grab

**Observed public documentation:** Grab's Malaysia driver redesign, dated June21,2022, explicitly identifies more map space as a goal and describes quick access to job features. Its Singapore driver guide separates a trip/job overview from turn-by-turn navigation and documents navigation to pickup, arrival, pickup and drop-off actions. [MY redesign](https://www.grab.com/my/blog/driver/new-interface/), [SG driver navigation guide](https://www.grab.com/sg/driver/transport/inapp-nav/).

**Observed image:** the SG turn-by-turn image shows a predominantly map surface, top turn instruction and compact ETA/pickup tray with an upward chevron. The separate overview image contains more job context and contact/action controls. [Official turn-by-turn image](https://assets.grab.com/wp-content/uploads/sites/4/2020/03/16145528/03-heading-to-PU-TBT.jpg), [official trip overview image](https://assets.grab.com/wp-content/uploads/sites/4/2020/03/16144932/02-heading-to-PU-in-transit.jpg).

**Inference:** the compact travelling view is a useful model for FleetOps; the chevron suggests an expansion affordance. **Unknown:** no drag/collapse gesture was exercised; exact snap heights, camera-padding calculations and automatic collapse behavior are not documented by these sources. The SG assets have 2020 URL paths and the MY article is from2022. They do not establish the latest Philippine app implementation. The VN guide has newer navigation sections, but its image URL also does not authenticate a current PH build. [VN guide](https://www.grab.com/vn/en/blog/driver/grabdieuhuong/).

### MOVE IT

**Observed public documentation:** Grab's Philippine editorial of December20,2023 says MOVE IT adopted GrabMaps and Navigation for rider-partner route finding. This supports a shared navigation technology relationship, not identical current UI geometry. [Official editorial](https://www.grab.com/inside-grab/stories/move-it-motorcycle-taxis/).

MOVE IT's accessible official staging migration-guide copy announces a batched transition to Grab Driver beginning June2025. The production URL returned403 during research. This is a published migration claim, not proof that every rider moved or that a particular installed version is current. [Staging guide](https://staging.moveit.com.ph/appsenso-migration-guide/).

**Unknown:** a separately current MOVE IT driver sheet, its snap points, camera behavior and stage transitions were not observed. Historical Driver2.0/customer booking images cannot answer those questions. Do not count MOVE IT as a third independently reverse-engineered present-day map design.

### inDrive

**Observed public documentation:** the official Drivers101 article documents a stage-based sequence: accept a suitable request, reach pickup and notify arrival, start after boarding, then complete after drop-off. This is useful evidence for changing the primary action with the trip stage. [Official driver guide](https://blog.indrive.com/en-co/article/drivers-101-how-to-use-our-app).

**Unknown:** the article uses older inDriver branding and does not establish current Philippine collapsed/expanded sheet geometry, gestures or camera logic. Bounded official-source searches did not provide enough evidence to verify those mechanics. No current native inDrive UI was inspected. Do not attribute FleetOps' proposed height or gestures to inDrive.

## Why FleetOps currently covers the route

The earlier proposal added stage, target, route estimate, load/passenger facts and explanatory next-step copy to the primary measured block. `mobile/app/(app)/(tabs)/map.js:549` measures that primary content and derives the collapsed sheet from its full height. More primary content therefore means a taller supposedly collapsed sheet. For travelling Cargo, the original manifest entry was also kept visible.

Camera framing is a second source of obstruction. In `mobile/components/TomTomMap.js:1068` and `:1732`, active route overview/initial framing uses a constant padding of50. It receives no measured active-sheet occlusion. Radar has separate proportional padding, which does not solve active-trip sheet clearance. No competitor's internal implementation is needed to establish this local code fact.

Before production implementation, expose measured top/bottom overlay clearance to the map document, apply it to route framing/follow/recenter consistently, and retain the driver's manual camera ownership. Keep navigation/restore controls reachable when the sheet is minimized. Do not automatically fit the route on every GPS tick or while the driver pans. This remains an implementation recommendation; the prototype does not modify camera code.

## Prototype and verification

Review-only `MapFirstSummary.jsx` introduces a compact travelling row in the existing Map. The original action callbacks, authority checks, target helper, Cargo verification callback, arrival gesture and navigation are unchanged. Cargo manifest/details remain available after expansion; at pickup, Verify cargo pickup stays visible alongside Confirm loading. Failed/unconfirmed assignment messages are retained by the fixture source transformation.

Four comparisons were rendered: Cargo/Passenger travelling to pickup and at pickup. In the 390×800 browser fixture with normal text:

- Previous travelling Cargo tray: **454px high**, top y=256.
- Compact travelling Cargo tray: **166px high**, top y=544.
- **288px of vertical map space recovered.** These numbers describe the tray only, not a hardware-certified usable-map percentage; other overlays still take space.
- Expanding shows the richer stage content, View trip details and View cargo manifest. Collapsing returns to166px/top544; manifest is tucked away while travelling.
- At pickup, the actual Verify cargo pickup and Confirm loading entries remain visible. Passenger arrival/boarding actions remain stage-specific.

Both fixture bundles build. Four images and browser records were checked, with both frames/fonts loaded. Prior audit tests were not rerun because production source was unchanged; no fresh native/full-suite test pass is claimed. Existing harmless duplicate-radius build warning in shared ui.js remains outside this task.

Preview: http://127.0.0.1:4194/map-compact-cargo-pickup.html . Images: `docs/design/mobile-map-audit-2026-10-30/compact-navigation-*.jpg`. Evidence: `scratch/mobile-map-audit-2026-10-30/compact-browser-checks.json`; review source: `MapFirstSummary.jsx`, `preview-body.txt` and `preview.mjs` in that scratch directory.

These are real Map component layouts with a schematic map and synthetic account/GPS/route data. They establish layout/expand behavior in the browser fixture, not native GPS accuracy, real provider camera behavior, phone gestures, all-theme/large-text behavior or Android performance.

## Status of the original questions

| Question | Status |
| --- | --- |
| Why does the FleetOps proposal cover the map? | Answered from current local source and measured fixture. |
| What arrangement best preserves stage clarity and map visibility? | Recommended and prototyped: compact travelling, required at-stop checks, expanded details. |
| What do the named competitors establish? | Partially answered from official driver material, with dates/geography and unknowns above. |
| Have their current native apps been reverse-engineered? | No; Android provider/package prerequisites unavailable. |
| Is the change applied to FleetOps? | No. Only research, review fixtures, images and documentation changed. |

Preserve the approved Home artwork, clay/navigation styling and all existing server/manual/Cargo safety rules. Production camera integration, all-stage/hold coverage and physical-device acceptance are still required before applying this design.
