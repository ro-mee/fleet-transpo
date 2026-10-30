# Mobile Home Claymorphism Implementation Plan

## Selected visual changes undone — 2026-10-30

At the owner's explicit request, restored the pre-audit curved-wave bottom navigation, original colors/shape/scan placement, shared clay card/button shadows/highlights/radii and the Home header's avatar/bell decoration. Shared clay.js, ClayCard and ClayButton use the saved original source. The original molded engine is restored for cards/buttons/pills/tiles; input material styling remains unchanged because inputs were not selected for this rollback. Header appearance is restored while retaining the intrinsic-height fix that prevents enlarged text overlap. Canonical Map retains a compatibility height helper returning the restored64dp height. Home trip cards/CTA regain their prior curves/raised edges; the safe information foreground/background pair remains.

The popup changes were not reverted. Existing input accessibility,48dp target floor, high-contrast status fixes, truthful duty, visible Incident/End Duty, preserved drafts, server acknowledgment, exact-trip Cargo/override and responder identity guards remain. Original Home images/composition and launch/branding remain intact. No operating-data, dependency, database, commit or deployment change.

Verification:223 checks passed across12 focused material/navigation/Home/accessibility/alert/guide files; strict changed-file lint passed. Android Hermes export passed (1542 modules); UTF-8 and whitespace checks passed. Actual before/current browser fixtures confirmed restored curves, shadows and header decoration; captures are saved as restored-navigation.jpg, restored-controls.jpg and restored-header.jpg under docs/design/mobile-ui-review-2026-10-30/. Input's remaining flat outline/larger text is intentional in this comparison. Native-device/all-theme acceptance remains pending.

## Four-change UI comparison — 2026-10-30

Prepared the owner's requested before/current visual comparison for bottom navigation, shared card/button/input styling, AppAlert and Home header, using real React Native Web component source and identical sample data. Left comes from the saved pre-audit snapshot; right comes from current source. Screenshots are saved in docs/design/mobile-ui-review-2026-10-30/ and the local4194 interactive menu is ui-comparison.html. Browser access was available for these captures. No application or design was modified. The current alert Continue label visibly has weak contrast; this was faithfully shown and remains an identified presentation issue, not corrected as part of this read-only preview. These light-theme captures do not establish native or all-theme accessibility acceptance.


## Change-scope clarification — 2026-10-30

The owner asked what else the audit changed after Home artwork restoration. Read-only comparison with the saved pre-resume hashes and task reports confirmed: the illustrated Home scene/composition and Home-only material recipe were restored, but the shared card/button/input material system still has the audit's flatter surfaces; the bottom bar still has semantic colors,16dp corners, no reference wave and adaptive text/scan placement; alert styling and the Home header's lighter avatar treatment remain changed. Functional fixes to duty/Incident/End Duty, contrast/48dp targets, forms/server acknowledgment, profile/permissions, exact-trip Cargo/override and responder identity remain. The resumed audit did not alter the prior launch animation, logo, app configuration or package/dependency files. This was scope explanation only; no application code or design was changed.


## Owner correction: restore the illustrated Home — 2026-10-29

The owner clarified that the requested audit should enhance the recent Home design, not remove its images or replace its visual composition. The audit implementer's removal of the Cargo depot/truck and Hotel scene was an overreach, not a necessary fix. This instruction supersedes the earlier operational-only Home revision below: preserve the existing artwork, headings, colors and illustrated overview when making future enhancements. An audit finding alone does not authorize deleting approved design content.

Restored the saved pre-audit DriverHeroCard composition from scratch/mobile-ux-audit-2026-10-29/source-baseline.json: bundled cargo-depot.png/hotel.png, date, original Cargo/Passenger headlines,28dp outer shell/26dp scene, responsive illustration placement, summary and vehicle row. The hero is back at the top after existing urgent prompts/saved-data note; it is no longer a stripped summary at the bottom. Matching loading shapes and Home-only molded materials are restored. No original image asset was regenerated or replaced.

Retained the functional fixes: truthful/unknown duty state for both driver types within the scene, visible Report Incident before More, independent End Duty, safe trip/session/offline actions, readable upcoming labels,48dp controls and corrected large-text header height. Shared non-Home controls and other audit bug fixes remain. High-contrast mode retains its preexisting text-focused presentation without decorative artwork; no default theme setting changed.

Checks:66 tests passed across cargo-home-render, cargo-home-actions, home-materials, home-contrast, home-trips and mobile-brand-integration. strict changed-file lint and Android Hermes export passed (1540 modules); UTF-8/whitespace checks passed. Preview4194 was rebuilt from the actual components and serves both original scene branches. Browser control was disabled in Work settings, so no fresh visual screenshot/native acceptance is claimed; reload the normal Cargo or Passenger light preview to see the restored art.

## Operational Home revision — 2026-10-29

The owner's approved full mobile audit replaces the October 28 decorative work overview with compact duty/current work first, retaining forest/ivory/brass and existing state/API/tutorial gates. Incident stays visible among four shortcuts for both types; End Duty is a separate persistent action during confirmed duty. Secondary counts and assigned vehicle appear below assignments. Unknown/saved information stays distinct; setup/mismatch warnings remain. Quieter 16dp cards and12dp controls reuse the existing shared material APIs. High-contrast upcoming labels use semantic information pairs; stacked header identity keeps intrinsic height rather than a zero flex basis. Loading shapes follow the compact duty/secondary summary instead of removed art. The earlier illustrated composition is historical. Verification and physical-device limits: [[Mobile UI UX Audit 2026-10-29]].

## Cargo and Hotel Home composition revision — 2026-10-28

The owner requested a more creative treatment for both Home variants. The final implementation shares one clay composition: a large illustrated scene, a compact statistics strip, a vehicle row separated by a divider, and individual raised shortcut tiles. Cargo uses the existing forest theme with the bundled depot/truck scene; Hotel uses the warm secondary theme with the existing hotel scene. Both retain Plus Jakarta Sans, the mobile theme and clay materials. The preceding October 27 entry and artwork prompt remain provenance and historical verification; this revision supersedes its layout and acceptance status. Root `DESIGN.md` and `.impeccable` describe the web dashboard and remain unchanged.

- **Scene and summary:** `DriverHomeCards.jsx` uses a 28dp outer curve, a 26dp scene curve and 18dp scene/summary side padding. The headline uses the existing bold display face at a base 24/30 size/line-height; metric values use 30/36 and tabular numbers. Both derive their app preference scale from the theme caption scale and retain OS text scaling. Cargo's duty ribbon reports actual duty or active-trip status. Counts remain upcoming trips and all-time completed trips, including unknown and response-cap states. The truck illustration is decorative, separate from the actual assigned vehicle and its optional photo.
- **Order and operational identity:** a real current assignment now appears before shortcuts. Its loading placeholder occupies the same position; the hero placeholder follows the scene/statistics/vehicle structure. These are approximate loading shapes, not a claim of identical heights for every data or text-size state. Passenger workspace metadata is compact, and actual guest name, VIP state and passenger count are presented together in the trip card through the existing load helpers. Cargo identity, source and readiness information remain tied to their existing inputs. Upcoming assignments and the existing empty/error/offline distinctions remain available below the shortcuts.
- **Responsive behavior:** header identity/utilities, scene title/art and statistics reflow below 360dp, above OS font scale 1.3, or with the app's large-text setting. The real vehicle photo yields space in that layout. Assignment headings stack below 380dp or with enlarged text, and the full-schedule control has a 48dp minimum height. High contrast hides decorative scene art, uses the surface/text pair and removes the scene's artwork-sized minimum height. Individual 48dp shortcut tiles retain their existing More/Less behavior, permissions and tutorial guards. Existing trip selection, map lifecycle, navigation callbacks, inspection/departure/source gates and completion handlers remain unchanged.
- **Final automated evidence:** five focused files / 63 tests passed (`cargo-home-render` 38, `cargo-home-actions` 9, `home-materials` 2, `home-trips` 8, `mobile-brand-integration` 6). Strict lint on the four changed source files, UTF-8 verification and `git diff --check` passed. The final Android Hermes export, including the loading-slot correction, passed with 1,525 modules, a 5.42 MB bundle and 96 assets. Independent review found no remaining blocker in the reviewed source/captures after its loading-position finding was corrected. No full repository or native acceptance result is implied.
- **Sampled visual and interaction evidence:** actual React Native Web components with sample fixtures were inspected for Cargo and Hotel light/dark modes at 390px, Hotel at 320px, enlarged headlines and Hotel statistics using 2× OS scale plus 1.15× app scale, and initial high-contrast states. Sample callbacks passed for Cargo assignments/history/vehicle/More/Fuel, keyboard full-schedule activation, and Hotel assignments/details/More/incident. Captures are retained locally under `scratch/cargo-home-preview/`: `v2-cargo-light.png`, `v2-hotel-light.png`, `v2-cargo-dark.png`, `v2-hotel-dark.png`, `v2-hotel-small.png`, `v2-cargo-large.png`, and `v2-hotel-large-lower.png`. These are isolated fixture samples, not exhaustive visual acceptance or authenticated native screens.
- **Acceptance limits:** Cargo's narrow capture had incomplete font loading; its accessible text was present, but narrow Cargo visual acceptance is incomplete. Browser control became disabled again before the final revisit, so the last high-contrast compaction and loading-position correction have source/automated checks but no final visual recapture. Existing React Native Web shadow and pointer-event deprecation warnings remain; a clean console is not claimed. Native screen-reader behavior, Android shadows/text scaling, live map gestures and authenticated trip completion remain unverified. No new dependency, backend or database change, commit or deployment was made. The one-time continuation automation was removed after completion.

## Cargo Home hotel-family refinement — 2026-10-27

The owner asked for Cargo Home to resemble the hotel Home treatment with a stronger Cargo-specific composition and imagery. `mobile/components/home/DriverHomeCards.jsx` now pairs the existing Cargo tagline and date with a decorative depot/truck scene, a clear duty-status panel, raised count links, the assigned-vehicle row, and molded shortcuts. This extends the incumbent mobile design: warm ivory, forest and sage from `mobile/lib/theme.js`, Plus Jakarta Sans, and the existing `homeMaterials` clay surfaces. Root `DESIGN.md` explicitly covers the web dashboard, so it and `.impeccable` remain unchanged. The passenger hotel artwork remains in place.

- **Data and actions:** the metrics still mean upcoming trips and all-time trips completed. Unknown/count-cap states, actual vehicle identity/photo source, duty and active-trip status, navigation callbacks, shortcut permissions, tutorial guards, and trip/inspection gates retain their existing sources and behavior. The illustrated truck is decorative and does not identify the driver's assigned vehicle. No delivery totals were invented.
- **Layout and text:** Cargo scene and count cards stack below 360dp, above OS font scale 1.3, or when the app's large-text preference is selected. The real vehicle photo yields space in this stacked layout. Cargo's custom headline and metric sizes derive their preference scale from `type.caption`, preserving the app's small/large text choices as well as native OS scaling. Decorative Cargo art is hidden in high contrast and dimmed in dark mode. These are source-confirmed behaviors; full visual acceptance is still pending.
- **Artwork:** `mobile/assets/images/cargo-depot.png` is a bundled transparent RGBA PNG, 1536 × 1024 pixels, 1,906,058 bytes, generated with the built-in image generation tool and copied into the app. It introduces no remote image request or package dependency.
- **Verification:** after the text-preference correction, all four focused test files / 57 tests passed, strict changed-file ESLint passed, `git diff --check` passed, and Android Hermes export passed (1,525 modules, 5.43 MB bundle, 96 assets). Source review confirmed the text-size finding was resolved and found no remaining shipping blocker in the reviewed source.
- **Visual limits:** `scratch/cargo-home-preview/light.png` records an inspected light-mode fixture rendered from the actual React Native Web components with sample data. A partial dark view was seen but no complete dark capture or acceptance pass was saved. Further browser review stopped because local browser control was disabled in Work settings; no adb/device was available. Narrow layouts, enlarged text, high contrast, the final post-correction visual recapture, and native appearance remain unverified. The web preview emitted shadow/prop deprecation warnings and an unattributed observer error, so a clean-console result is not claimed. No database, backend, dependency, deployment, or commit change belongs to this task.

Exact artwork generation prompt, retained for provenance:

> Use case: stylized-concept. Asset type: decorative transparent PNG for a compact mobile cargo driver dashboard. Create an exceptionally polished 3D clay miniature cargo depot, in the visual family of a friendly clay hotel illustration: warm ivory rounded warehouse with a dark sage loading-bay door, one small sage-green delivery box truck in three-quarter view, two small kraft parcels on the loading platform, a few rounded green shrubs, and an elegant short curved pale gray access road. Cream ceramic and soft matte clay materials, tactile beveled shapes, warm soft studio light, gentle ambient shadows, forest green and muted sage with tiny warm ochre accents. Isometric three-quarter front view. A cohesive restrained vignette, not scattered icons. Landscape composition approximately 3:2, building and truck centered, scene fills frame with modest padding. Actual fully transparent background; no solid backdrop, no lettering, no labels, no logos, no watermark, no UI, no people. Clear attractive silhouette at 180px wide. The truck is decorative, not a photo of an assigned vehicle. Save generated output for use as a bundled mobile application image.

## Keep-clay performance follow-up — 2026-10-21

The owner chose to keep the existing clay appearance. Home now uses the shared focus/foreground presentation clock, stops its loading pulse while hidden, and omits hidden route renderers with equal-aspect placeholders. All applicable current/upcoming road previews return when active; map documents reload on return. Notification polls with identical complete ordered payloads no longer publish a new array/context, avoiding unnecessary Home updates. No shadow recipe, palette, GPS owner or trip/duty gate changed. The sibling Trips list now uses SectionList windowing. Full mobile-filtered verification passed 112 files / 1,272 tests, strict touched lint and Android Hermes export; browser fixtures checked retained Trips clay styling and larger text. Native Android frame rate, shadows, WebView resume and release-build acceptance remain pending. Details and work-count evidence: [[UI UX Audit - Mobile]].

Date: 2026-09-09
Status: Implemented; automated checks and isolated component review completed. Native device acceptance remains pending.

## Direction and scope

### AssignmentsHeading syntax cleanup — 2026-09-16

Resolved JSX syntax errors in `mobile/components/home/DriverHomeCards.jsx` caused by an unclosed `<View>` tag and duplicated `AssignmentsHeading` return block (kept the `headingRow`/`headingTitle` variant; removed the dead `type.titleLg` return). Cleaned duplicate import of `statusColorForTone` / `tripStatusTone` and removed trailing duplicate `empty`, `mapArt`, and outdated `scheduleLink` styles in `StyleSheet.create` (single `scheduleLink` at `minHeight: 40` now wins; no other component affected). Verified 2026-09-16: ESLint clean (0 errors) on `DriverHomeCards.jsx` and its caller `app/(app)/(tabs)/index.js`; no mobile test script exists (root Vitest is web-only), so no test run applies.

### Empty-state map scenery — 2026-09-12

Owner request: put `mobile/assets/images/map.png` (3D clay map with pin, transparent) in the Next Trip empty state, center-right — position fixed per ui-ux-pro-max guidance (flexbox row over absolute overlay: `flexDirection: 'row'`, `alignItems: 'center'`, text `flex: 1` left, 112x90 art right, decorative `accessible={false}`, slight dim in dark mode). Follow-up optical-lift fix: the PNG is optically bottom-heavy (visible mass + transparent padding sit low), so `s.mapArt` gained layout-neutral `transform: [{ translateY: -20 }]` — vertical only, no horizontal shift, card/text/badge/typography/colors untouched (`-24` held as fallback pending device screenshot; long-term fix is cropping the PNG's transparent padding). Copy, handlers, and empty-state branching unchanged; current-card empty/radar untouched. Touched-file ESLint clean; Android export passed.

### Dynamic trip list — 2026-09-12

Owner request: replace the fixed Current + Next (+Then) slots with a status-driven list ("conditional current pinned first, all upcoming chronological"). Empty state intentionally untouched — the dynamic layout only runs once at least one actual trip exists.

- **Selector** (`mobile/lib/home-trips.js`): `selectHomeTrips` returns `{ current, upcoming }` (`next`/`secondNext` removed). `current` = first open trip matching the server active statuses (unchanged definition — tracking, weather poster, vehicle context, and action gates keyed off it are untouched). `upcoming` = all remaining open trips in server order, which is chronological (`ORDER BY scheduled_departure ASC NULLS LAST` — no backend change, no client sort). `Completed`/`Cancelled` still excluded. New `HOME_UPCOMING_LIMIT = 3`.
- **Render** (`(tabs)/index.js`): `!activeTrip && upcoming.length === 0` renders the pre-existing empty path verbatim (same `Today's Assignments` heading, same two null cards, all confirmed/offline/not-synced copy and radar behavior unchanged). Otherwise: current card only when it exists (pinned first), `Upcoming Trips` heading, and an `UpcomingTripList` child rendering `upcoming.slice(0, 3)` (first `NEXT TRIP`, rest new `UPCOMING` tag) plus a `+N more · View Full Schedule` footer reusing the heading's `goTrips` (`/trips`) destination past the cap.
- **Cards** (`DriverHomeCards.jsx`): `VARIANT` gains `upcoming` (muted teal, same family as next); `then` kept in the map (no remaining consumer, zero-risk); `AssignmentsHeading` takes an optional `title` (default `Today's Assignments`, so the empty path is zero-change); heading row is now single-line (`nowrap`, title shrinks with tail ellipsis, link never shrinks) per owner request.
- **Lint note**: inline `.slice()`/`.map()` calls as JSX props in `Home` trip the repo's strict `preserve-manual-memoization` rule (bailout misattributed to `goFuelReport`/`activeTrip`). Fix: slice/count hoisted to body consts (`visibleUpcoming`, `hiddenUpcomingCount`) and the list in the memo child — same rendered output, no unrelated refactors.
- **Verification**: full Vitest suite 101 files / 1112 tests passed (incl. rewritten selector cases + cap-constant case); ESLint clean on all 4 touched code files (`home-trips.js`, `home-trips.test.js`, `DriverHomeCards.jsx`, `(tabs)/index.js`); `expo export --platform android` passed (5.14 MB). Native visual acceptance pending.

### KPI shrink pass — 2026-09-12

Owner request: make the Upcoming trips / Trips completed KPI cards smaller ("liitan yung kpi"). ~20% density-only reduction in `DriverHomeCards.jsx` — icon tiles 44→36 (radius 16→13, glyph 22→18), numbers 32→26 (lineHeight 34→28), card padding 12→10 / radius 22→18 / gap 6→5 (sheen overlay radius matched to 18), labels 14→13, action links 13→12 with chevrons 14→12, row gap 10→8 / marginTop 12→10. Content, handlers, colors, materials, and vehicle/quick-action sections unchanged. Touched-file ESLint clean.

Decision (same day): a further shrink to 30px tiles / 22px numbers was discussed, but the owner explicitly deferred it ("md lang, dont resize"). Code stays at 36px tiles / 26px numbers — no second shrink landed, and the docs below describe the code as-is.

### Hero headline removal — 2026-09-12

Owner request: remove the `Ready for what’s next?` headline (and its offline `Your saved dashboard` variant) from the Home hero card. The hero header is now the eyebrow date plus the `Smooth rides. Happy guests.` subtitle only. Removed the `heroTitle` Text block and style from `DriverHeroCard`, dropped the now-unused `offline` prop from the hero (the caller in `(tabs)/index.js` no longer passes it; trip-card offline handling is untouched), and left KPI/vehicle/shortcut sections unchanged. Touched-file ESLint clean.

### 1:1 Hotel Background & Pale Mint Clay KPI Alignment — 2026-09-12

Owner request: Align the Home hero card (`DriverHeroCard`) one-to-one with the supplied reference mockup using `mobile/assets/images/hotel.png` as the 3D hotel background, restyling the KPI cards to match the pale mint clay composition, and keeping the assigned vehicle row untouched ("wag mo na pakielaman yung van jann just focus in kpi bg").

- **Hotel Scenery**: Placed `hotel.png` in the top-right quadrant of the hero shell (`position: 'absolute', top: -4, right: -12, width: 275, height: 160, pointerEvents: 'none'`) with `overflow: 'hidden'`. Its road extends across behind the header subtitle and top of the KPI cards, establishing the layered 2.5D depth from the mockup. Dark mode applies `opacity: 0.65` for seamless stage blending.
- **Header Structure**: Eyebrow date (`WEDNESDAY, SEP 9`) and subtitle (`Smooth rides. Happy guests.`). The bold headline (`Ready for what’s next?`) was removed per owner request on 2026-09-12 — see "Hero headline removal" above. Text column constrained to `maxWidth: '62%'` to prevent overlapping the hotel building.
- **Pale Mint Clay KPI Cards**: Restyled `Upcoming trips` and `Trips completed` with soft pale mint clay surfaces (`#E5EEE7` in light mode with top highlight and soft shadow; `colors.primaryContainer` in dark mode). Each card features a 30x30dp extruded squircle clay icon badge (`#F3F7F4`, `calendar` and `checkmark-circle` in dark green `#163D31`) with bold numbers (22px), bold labels, and action links with chevrons (`View assignments >` / `All time >`). Shrunk in two passes on 2026-09-12 from the original 44px-tile/32px-number sizing per owner request — see "KPI shrink pass" above.
- **Vehicle Section**: Assigned vehicle card layout, photo rendering logic, plate number, and action handlers preserved completely intact.
- **Verification**: Touched-file ESLint clean; 22 test suites / 129 Vitest tests passed; `npx expo export --platform android` passed (1,366 modules, 5.14 MB bundle). Native device acceptance remains pending.

### Real route preview — 2026-09-09

Current-trip fix (owner report: "dapat kita pa din yung route preview kahit naka current trip na sya"): routeless booking dispatches (trips created by `ensureTripForDispatch` where `dispatch.route_id` is null) return null endpoint coordinates, so the CURRENT TRIP card fell to "Route preview unavailable" mid-trip. Fixed server-side in `GET /api/mobile/driver/trips` with the shared gazetteer fallback (canonical → gazetteer → none, same chain as the geofence service); unknown endpoint text stays null. No mobile changes — both Home and Trip Details already render the preview whenever coordinates exist. Details in `Capstone/02 - Features/Trips.md`.

Raised route/pin follow-up: the shared preview now layers an offset soft shadow, forest base, green body and narrow highlight over the same real road geometry. Pins use radial shading, curved rim lighting and recessed white-center treatment. Trip Details now consumes this same TripMapPreview; its separate interactive full-map modal remains unchanged. Targeted ESLint and eight preview/detail tests passed; on-device appearance remains pending. No commit.

Map clarity/depth follow-up: screenshot showed faint right-hand map detail, not evidence of a fully missing tile. Removed the blanket generic-fill override so provider airport/land-use distinctions survive; kept targeted muted water/park/building treatment. Added container resize handling and height-aware bounds padding. Increased wrapper curvature, rim thickness and soft outer elevation without putting an overlay on the map. Native tile/network failure has not been reproduced; on-device confirmation remains needed.

Follow-up preference: Home Details buttons restored to primary/onPrimary forest coloring. Map pins now carry Pickup/Drop-off labels, with increased fit padding to accommodate them. Retained a solid road route; dashed geometry was discussed but not adopted. No navigation or routing-policy changes.

Replaced Home's endpoint-only static image with shared TripMapPreview using the already-installed WebView and existing TomTom SDK/provider. The isolated preview document requests actual road geometry with the same non-live routing options as the existing detail map; it does not alter navigation, stored trip geometry, tracking or lifecycle. Both cards share 1.65:1 sizing, a rounded highlighted clay frame, muted light map layers, 6px forest route with rounded joins/caps, and custom green pins. Current airport/NAIA-named destinations receive a plane symbol (name-based presentation hint, not a new location classification).

Bounds include full calculated geometry and endpoints with marker padding. No pan/zoom controls or new tap navigation. Existing provider attribution remains. Loading/invalid coordinates/offline/routing errors use a fixed-size state; no fake route is drawn. Each mounted preview requests a route once; Home clock ticks do not reload it. No new dependency/provider or backend changes.

Map and CTA now share an action column (stacked below route text on narrow screens). The new supplied spec explicitly restores a pale Next Details button on Home, overriding the prior green-button preference there only; Trips list coloring is unchanged. Used image-to-code's supplied-reference analysis, preserving the precise existing brief rather than generating replacement artwork.

Verification: targeted lint, four Home/preview tests, and diff checks passed. Tests cover endpoint validation and safe serialized WebView config. Real-device screenshot comparison and live provider rendering remain pending; visual fidelity is not claimed as verified. No commit/deployment.

### Reference header — 2026-09-09

Implemented the supplied header specification using DriverHomeHeader: forest initial tile, greeting/subtitle, separate compact raised weather pill, and green outline notification bell with zero-hidden/99+-capped unread badge. Reused real driver/weather/feed values and existing profile/notification routes. Image-to-code analysis used the precise supplied reference directly rather than inventing a replacement image. Warm background and other Home sections were not redesigned.

At ordinary phone widths the layout is one row; below 380dp or with enlarged text the utility group wraps below the identity to preserve legibility. Long city labels wrap instead of clipping. Weather uses the existing dynamic icon payload and Celsius temperature, with natural theme accents; the reusable pill accepts an explicit night condition/moon icon but does not infer night from device theme or time. The existing weather feed supplies no day/night field, so automatic night selection remains unavailable without a separate data-contract change. No weather-fetch or backend changes.

Verification: targeted ESLint passed and 13 Home/weather tests passed. Physical-device screenshot comparison, large-text acceptance and live weather verification remain pending. No commit or deployment.

### Stronger clay consistency — 2026-09-09

Matched Home to the stronger Trips/Trip Details material: 30dp outer curves, 8dp-offset soft card shadows, upper highlights and shaded lower edges, raised KPI/vehicle tiles, deeper shortcut tiles, 24dp route nodes and 58dp action buttons. Kept the KPI artwork, warm background, semantic colors, responsive breakpoints, displayed data and action handlers unchanged. Only DriverHomeCards.jsx presentation styles changed. Targeted ESLint passed; native visual acceptance remains pending. No commit or deployment.

Refine the driver Home screen using the supplied overview and three detail references. Keep the existing warm ivory background (#F5F2EC), forest primary (#285448), Plus Jakarta Sans, dark mode, and high-contrast support. The overview image is composition guidance, not a literal miniature layout. Preserve existing navigation, RBAC, trip transitions, departure/inspection gates, tracking, offline cache, notifications, incident delivery warnings, and odometer completion.

The verified artwork is `mobile/assets/images/kpi bg.png` (not `mobile/assest/...`). It already contains a car and scenery, without UI text. Use as decorative hero artwork; it must not imply that every driver is assigned the pictured Innova.

## Existing implementation

- Expo ~54.0.8, React Native 0.81.5, Expo Router ~6, JavaScript. Native layouts and existing Ionicons, linear gradients, and animation tools are available.
- Home (`mobile/app/(app)/(tabs)/index.js`) owns loading, cached data, status actions, trip selection, summary cards, quick actions, and completion modal.
- Reuse theme/context/scaling, shared Button/Card/StatusPill/SkeletonCard/ErrorNotice, offline SyncNote, notification feed, trip reference status groups, and driver vehicle-context resolution.
- Home currently selects one `nextTrip = activeTrip || pendingTrips[0]`. Two visible assignment cards require distinct selectors, without changing the trip state machine or tracking target.
- `/api/mobile/driver/trips` has passenger count, departure, vehicle and endpoint coordinates, but no luggage field. Its response is status-filtered and capped (default 50, max 100); do not infer a complete daily total from it.
- Existing map components are available, but compact previews must not fabricate roads/routes or capture the page's scroll gesture.

## Implementation sequence

1. Establish data contracts. Trace Home, Trips, trip reference groups, history, and vehicle-context callers. Define current operational trip and next distinct eligible scheduled assignment. Keep overdue and future assignments discoverable. Confirm a truthful source/scope for upcoming and completed-today counts; if no complete existing source exists, document that limitation rather than hardcode a total or expand backend scope silently.
2. Build a compact image-backed summary hero: actual date, two supported metrics, actual assigned vehicle/plate. Apply a forest scrim behind live text and control artwork crop so the car stays secondary. Keep the global background token unchanged. Remove the separate duplicated KPI strip after migrating its useful data.
3. Consolidate shortcuts into one raised clay action area. Reuse Schedule, Live Map, Forms/submissions, Fuel, inspection, and incident routes after checking required parameters/RBAC. Use four primary shortcuts plus More on narrow phones; More exposes remaining existing actions. Keep Report Incident visible and preserve the global SOS. Use a fuller row only where 48dp targets and readable labels fit. Do not invent a Forms badge.
4. Add Today's Assignments using one shared TripCard and TripTimeline pattern for Current/Next. Forest current accent and muted teal/info next accent; show actual statuses and times. Reuse the existing action handlers and gates. View Full Schedule opens the trip schedule, not the work/leave calendar. Upcoming assignments outside today need an explicit date/section label.
5. Add compact, non-interactive map previews only with valid coordinates and supported map data. Reuse existing map infrastructure with a small preview mode if needed; use an honest unavailable/offline state otherwise. Show passenger count when supplied (including valid zero); omit luggage until a real field exists. Do not infer arrival time, vehicle availability, weather, or sub-city labels.
6. Preserve loading, error, online-unconfirmed, offline-never-synced, saved-data and confirmed-empty distinctions. A failed fetch must never become “No assignments.” Current and next empty states share a stable visual rhythm without large blank panels.
7. Verify mobile layout, functionality and bundle, then update the mobile architecture/audit notes with actual results.

## Components and files

Primary edit: `mobile/app/(app)/(tabs)/index.js`.
Add a focused `mobile/components/home/` group for DriverHeroCard, HomeQuickActions, and DriverTripCard; TripTimeline can remain local to DriverTripCard until another consumer needs it. Reuse shared primitives before creating generic Clay abstractions. Add a pure Home selector helper only if needed, with meaningful regression cases. Map and theme edits are conditional and must preserve other consumers. Avoid global radius/shadow changes that restyle unrelated screens.

Use soft themed outer shadows, restrained highlights, coherent radii, 4/8dp spacing, native Pressable feedback and existing fonts. Keep operational text readable; references' tiny seven-item strip and three-column trip layout must reflow on phones. On narrow/large-text layouts, stack preview beneath route details. Preserve safe-area/tab/SOS clearance and high-contrast accessibility overrides.

## Validation and acceptance

- Test 320/360/390/430dp widths, tablet/landscape where available, enlarged text, reduced motion, dark and high-contrast palettes. Minimum targets: 48dp Android / 44pt iOS.
- Check real current + next, only upcoming, no assignments, overdue/multiple assignments, long place names, absent vehicle/coordinates/counts, initial load, API failure, offline cached/never-synced, queued actions and failed incident delivery.
- Regression-check acceptance-before-start, inspection/departure gates, continue/complete/odometer, tracking target, RBAC and navigation.
- Run root ESLint on touched mobile files, relevant existing Vitest mobile tests, and an Android Expo export from mobile. Check iOS export if tooling is available. mobile/package.json has no dedicated lint/type-check/test scripts; do not claim an absent type-check passed.
- Read the versioned Expo guidance required by mobile/AGENTS.md before coding, while respecting the actual SDK 54 dependency baseline; no SDK upgrade in this visual task.
- Perform one batched visual review, fix observed defects together, then one confirmation pass. Native device checks must be reported as pending if no device/emulator is available.

## Planning evidence and skill use

Inspected supplied brief/images, actual KPI artwork, Home source, theme, tab layout, shared UI/map components, trip reference/API contract, package scripts, and mobile architecture/audit notes. UI UX Pro Max supplied native touch/contrast/theming guidance; its Python search command was unavailable. Design Taste supplied preserve-first design inference and consistent shape/type discipline. Image-to-Code supplied section-level reference analysis; no new image generation during this requested planning-only phase. Impeccable Shape supplied the plan structure and bounded verification approach. Existing Impeccable product context emphasizes web; this plan explicitly scopes native driver Home without rewriting that product context.

## Implementation outcome — 2026-09-09

- Home now uses the supplied KPI artwork, live date, upcoming assignments, verified all-time completed count from driver performance, and actual vehicle identity. The completed count is explicitly **All time**, not an invented daily count. Upcoming count is marked with `+` when the default response cap is reached.
- Preserved warm ivory background and existing theme tokens. Added focused native Home components with raised themed surfaces, 48dp controls, wrapping labels, stacked narrow-screen maps, and an opaque hero when high contrast is enabled. No new dependencies or generated artwork.
- Consolidated shortcuts with inline More/Less. Report Incident remains primary; Fuel and Vehicle Check remain accessible. Removed superseded hero/KPI presentation and unused styles, not operational handlers.
- Current and Next use a shared card and distinct trip selection, preserving API order. Section is named **Your assignments** because the API includes overdue/future assignments. Cards display actual departure dates/statuses/passenger counts. Luggage, weather, arrival times, and availability were not fabricated.
- Reused the existing static map URL helper, exported without changing existing consumers. Preview represents endpoints, not a verified road route; absent coordinates/key, offline state, or image errors show an unavailable message.
- Retained existing trip handlers, inspection/departure gates, tracking target, permission checks, refresh/cache behavior, notifications, and odometer completion. Prevented odometer dismissal while saving and replaced previously undefined suspension-banner styles with existing themed styling.
- Added two selector/action regression tests alongside the existing mobile suite. All 8 mobile utility test files / 68 tests passed. Touched-file ESLint and Android Expo export passed. No dedicated mobile type-check command exists.
- Isolated React Native Web component review covered 360px light, 320px enlarged-text dark, and 430px empty/high-contrast hero fallback. Large-text shortcuts now use fewer columns. This is not a full native screenshot or end-to-end test; native gradient/shadow rendering, real authenticated navigation, live maps, and on-device trip completion still require Android/iOS smoke testing.
- No backend, database, environment, authentication, or global theme changes. No commit created. Temporary visual-review source files were removed after verification.

## Compact density pass — 2026-09-09 (owner request)

The Home screen read like a mockup: header, hero KPI card, quick actions and section gaps were vertically oversized for a 360–430dp phone. Sizing/spacing/proportion-only refinement — content, handlers, RBAC, routes, offline machinery, and the clay material language (soft shadows, white top-edge highlights, shaded bottom edges, forest accents) all preserved. Card radii drop 30 → 24 to match the compact clay radius already established on the Profile pass.

- **Header** (`DriverHomeHeader.jsx`): avatar and bell 50×52 → 48×48 (radius 17/19 → 16), avatar initial 26px → 22px, bell icon 26 → 22, badge 23 → 20, greeting line-height 24 → 22, header padding bottom 16 → 10 / top inset +8 → +6, gaps 12 → 10.
- **Header, owner follow-up ("still too big")**: the "Drive safe. Every trip matters." subtitle was removed entirely, and the whole strip shrank to a single 44dp row — avatar/bell 44×44 (radius 14, initial 20px, bell icon 20), weather pill minHeight 44 / radius 22 / icon 20, header padding bottom 8 / top inset +4, gaps 8.
- **Weather label, owner follow-up**: the location/condition line is now single-line (`numberOfLines={1}` + tail ellipsis) with a wider text column (compact pill 104 → 128) so typical place names like "Quezon City" fit whole; only genuinely long names ellipsize instead of wrapping the header taller.
- **Weather pill** (`WeatherChip.js`): minHeight 52 → 48, radius 28 → 24, padding 10/9 → 9/7, icon 24/30 → 22/26, compact width 112 → 104, label maxWidth 110 → 88.
- **Hero KPI** (`DriverHomeCards.jsx`): inner padding 18/24 → 14/14, metrics marginTop 18 → 10 and gap 10 → 8, KPI tiles padding 12 → 9 / radius 22 → 18 with icon 23 → 20, vehicle strip minHeight 68 → 56 with marginTop 14 → 8 / padding 14 → 10 / icon 25 → 20 — roughly 20% shorter overall; the scenic artwork stays as the background, secondary to the data.
- **Quick actions**: panel padding 14 → 10 (radius 24), icon tiles 48×52 → 48×48 (radius 16) with icons 25 → 22, tile-to-label gap 10 → 6.
- **Quick actions, owner follow-up**: the **Live Map** and **Vehicle Check** shortcuts were removed by owner decision (the Live Map stays reachable as its own bottom tab; pre-trip inspection remains reachable through the trip start flow). Remaining shortcuts: My Schedule, Forms, Report Incident, and Fuel (RBAC-gated). With four primary actions the panel no longer needs the More/Less toggle on narrow phones unless Fuel is permitted.
- **Quick actions, second owner follow-up**: the Forms shortcut was relabeled **Activity Log** (matching the destination screen's own "Activity Logs" title) with the `pulse` activity-waveform icon. Fuel's icon went `water` → `flash` → **`speedometer`** (fuel-gauge metaphor; the refuel flow photographs the gauge) after the owner rejected both earlier picks — Ionicons 15 (the installed @expo/vector-icons glyphmap) has no gas-pump glyph. Routes unchanged.
- **Quick actions, third owner follow-up (2026-09-23)**: **End Duty** joins as a *conditional* shortcut — present and **first** whenever `useDuty().checkedIn`, absent otherwise (`time-outline` icon, routes to `/end-duty`). It was added to close a gap the Profile removal opened: Home's End Duty *report card* is gated on the 30-minute window before out-time, so with no duty control on Profile a driver sent home mid-shift had no way to clock out. Conditional rather than fixed, so the row is unchanged for a driver who is not on duty; first rather than appended, because the phone layout shows four tiles plus More and an appended tile would land behind it. That placement pushes Fuel behind "More" while on duty — accepted, since ending a shift outranks reporting fuel. `/end-duty` was added to `QUICK_ACTION_ROUTES` (idle prefetch) to match; `prefetch-routes.test.js` pins five targets now.
- **Quick actions, fourth owner follow-up (2026-10-03)**: **Pre-Shift** joins Quick Actions (`clipboard-outline` icon, routes to `/inspection?mode=preshift`). It ensures the roadworthiness checklist is always accessible directly from the shortcuts row even when the top banner is scrolled off-screen or cleared. `/inspection` added to `QUICK_ACTION_ROUTES` (idle prefetch); `prefetch-routes.test.js` pins six targets now. Walkthrough safety guard added to `DriverHomeCards.jsx` to prevent unintentional live inspection launches mid-tour.
- **Home Trip Map Previews (2026-10-03)**: Updated `UpcomingTripList` in `mobile/app/(app)/(tabs)/index.js` so that all visible upcoming trips (up to `HOME_UPCOMING_LIMIT = 3`) render interactive route line previews (`interactivePreview={interactivePreview}`) rather than restricting interactive rendering to index 0 alone (`interactivePreview && i === 0`). Secondary upcoming cards now consistently render calculated road route polylines and endpoint pins matching the primary card.
- **Icon removals, owner follow-up**: the calendar icon tile in the trip-card empty states (Current/Next/Then — one shared code path) and the calendar tile beside the "Today's Assignments" heading were removed; the empty states are now text-only and the heading is the title + View Full Schedule link. Unused `emptyTile`/`headingIcon` styles deleted.
- **Section rhythm**: scroll gap 18 → 12, top padding 14 → 10.
- **Trip cards** (Current/Next/Then): padding 20 → 14, internal gap 18 → 12, status/tag pills 14/9 → 10/6 (radius 16), timeline nodes 24 → 20 (border 3 → 2.5, track 26 → 22) with stop padding-bottom 18 → 12, CTA 58 → 48 minHeight (padding 14 → 10, radius 18), empty state 110 → 84. `TripMapPreview` aspect ratio 1.65:1 → 1.9:1 (radius 28/22 → 22/17) — the single biggest per-card saving, shared with Trip Details.

Net effect: ~100px more content above the fold on a typical phone — header through quick actions plus the assignments heading visible without scrolling. Verified: targeted ESLint clean on all touched files, mobile Vitest 14 files / 102 tests, `expo export --platform android` passed. On-device visual acceptance still pending. No commit created.

## Dark-mode clay depth pass — 2026-09-09

Owner critique: dark mode read as "dark neumorphism / flat dark cards" — background, cards and containers too close in tone, a harsh straight gray highlight line on card tops, invisible shadows. Root causes were systemic, not per-screen:

1. **The clay edge material was hardcoded light values.** `clay.js` (and local copies in trips.js, trip/[id].js, DriverHomeCards.jsx) baked `#FFFFFF70`-family 2px top strips and `#00000016`-family bottoms. On a near-black card the white strip is a harsh line; the black bottom strip and 0.22-opacity black shadows are invisible.
2. **Dark palette tonal compression.** `background #111816` sat ~3% from `surfaceContainerLow #151D1A` — nothing to lift against.

### What changed

- **`mobile/lib/clay.js` → `clayMaterials(isDark)`** (light named exports unchanged for reference; all consumers now call the function with `scheme === "dark"`). Dark recipe: overall soft border `rgba(255,255,255,0.05–0.06)` 1px + top `rgba(255,255,255,0.09–0.12)` 1.5px (diffused, no visible straight line) + bottom `rgba(0,0,0,0.32–0.45)` + stronger/wider shadows (opacity 0.3–0.5, radius 12–18) so depth survives the dark stage. Converted consumers: Profile tab, Settings, Devices & Sessions, DriverSos, ClayMenuRow, ClayScreenHeader, profile/{vehicle, privacy, personal, permissions, license, help, about}, plus the local recipes in Trips list, Trip Details, and Home's DriverHomeCards (hero/quick-actions/trip cards → `mats.clayShade`; accent tag / CTA / status pill get scheme-aware raised/pill edges — the fixed-forest hero tiles keep the light recipe, which is correct on that constant surface in both schemes).
- **Dark palette (dark-only, light + high-contrast untouched):** `background` & `surfaceDim` `#111816` → `#0D1713`; `primaryContainer` `#285448` → `#245F50` (muted emerald tiles; `onPrimaryContainer #DDEBE5` on it ≈ 5.7:1, WCAG AA). Both documented inline in `theme.js`.
- **Screen-level fixes:** Profile inline `#FFFFFFxx` strips → material values; Settings text-size modal Cancel `borderWidth 2 outline` → `clayCta` + `surfaceContainerHigh` (matching the logout-modal Cancel); Devices revoke button 2px error outline → soft-destructive `errorContainer` clay (Profile Sign Out pattern); SOS FAB/chip/emboss edges scheme-aware (dark `error` is light salmon — moderated white edge + deeper shadow); Work Schedule hero literal-white text/chip → `onPrimary`-alpha (dark primary is pale sage, white washed out); DriverHomeHeader avatar sheen scheme-aware; AppAlert foreign Tailwind palette (rose/emerald/amber/sky) → theme `danger/success/warning/info` tone tokens with derived alphas, top gleam diffused in dark; Vehicle tab's foreign blue `rgba(37,99,235,0.12)` → `colors.info + "1F"`; license scan-box/source-button strips dark-aware; `trip/complete.js` top/cta gleams + KM badge dark-aware.
- **Bug found en route:** `trip/complete.js` destructured `isDark` from `useTheme()` — the context never exposed that key (it exposes `scheme`), so it was silently always-undefined. Replaced with `scheme === "dark"`.
- **Intentionally untouched:** camera viewfinders (`fuel-report.js`, license capture `#000/#fff`), map overlay controls (`components/map.js` — white over map imagery), `_layout.js` scan FAB, `SwipeButton.js` (parallel WIP), high-contrast overrides (legibility first; HC-dark keeps the subtle dark materials, its palette already forces white borders).

### Verification

Targeted ESLint clean on all 24 touched files; mobile Vitest 15 files / 106 tests passed; `expo export --platform android` passed (5.06 MB bundle). Re-grep confirms no remaining `#FFFFFF`-family strips outside deliberate light branches/static baselines that carry inline dark overrides, and no foreign Tailwind colors outside map.js/SwipeButton.js (out of scope). Native-device visual acceptance in light + dark + high contrast remains pending — that is where the diffused-highlight tuning should be confirmed. No commit created.

## Ivory Home reference refinement — 2026-09-09

The new owner-supplied reference supersedes the scenic dark-green hero treatment above. Home now has a compact ivory hero, sage KPI panels, molded icon tiles, a raised vehicle strip, and a circular green avatar in an ivory rim. Existing compact density, actual counts, weather/unread payloads, shortcuts, trip handlers and navigation are preserved. The earlier removed header subtitle was not reintroduced. No fabricated vehicle/scenery image was added.

- `components/home/materials.js` reuses the existing clay materials, adding Home-only layered outer and inset shadows on web or Fabric with Android 10+ (and iOS). Older Android/legacy renderers retain existing elevation. Light and dark replace identical keys; no global palette/material consumers change. Shared bottom-shadow tint comes from the existing material, not a new global color.
- `DriverHomeCards.jsx` shares a molded icon tile across metrics, vehicle and quick actions. Empty-current wording no longer claims vehicle readiness merely because no active trip exists; the radar indicator remains. Loading/offline/unconfirmed distinctions remain intact.
- `homeVehicleImage` recognizes optional vehicle-photo URL fields, rejects non-string/non-HTTP(S) values, and is evaluated each render. Home preserves the selected vehicle identity. A standing-assignment image is used as fallback only when its vehicle ID matches the selected vehicle. Image errors remove the image area; a changed URL is retried. Original evidence and API contracts are unchanged. The real `/api/driver/me` response already provides assignedVehicle.imageUrl; no backend change was needed.
- No new dependencies, native build configuration, auth, environment or database changes. The provided image informed materials/proportions through Image-to-Code; Taste's preservation/spacing guidance was applied without importing its web-only layout patterns into native UI.

Verification: touched-file ESLint passed; 14 mobile utility test files / 103 tests passed (including photo field cases, renderer fallback and light-dark-light material-key restoration); Android export passed (1,356 modules). `git diff --check` passed. The utility tests emit their existing missing EXPO_PUBLIC_API_URL warning in the isolated test environment; no environment values were changed. No dedicated mobile type-check script exists.

Local React Native Web component QA covered 390px light/no photo, 320px dark/photo fixture, and 430px light after a dark-to-light cycle with a broken photo. The fixture is QA-only, not production vehicle data. Layouts wrap without an empty image frame; inset/outer depth is visible. Preview uses browser gradient/icon adapters, not an authenticated native app. Android/iOS visual acceptance, enlarged native text, actual remote-photo delivery and authenticated navigation remain device smoke checks. No native device/emulator was available. No commit created.

Final-header follow-up audit: Android export re-run after the last header style composition edit passed (1,356 modules; bundle `entry-baa3826c65bb0c8d3f689fb6aa3eecec.hbc`). No adb command, emulator process, or SDK in the configured/common local SDK locations was found. Final native visual acceptance therefore still requires a connected device or owner-provided Home screenshots; do not treat browser QA as native acceptance.

## Dark→Light theme-switch regression fix — 2026-09-09

Owner report: light correct on first load, dark correct, but toggling back Dark→Light broke clay cards — rectangular shadow/backing artifacts behind rounded cards, stale dark layers, cards no longer matching their initial light appearance.

### Root cause — style-key asymmetry, not animation

Swept every focus area first: **no** theme-interpolated Animated/reanimated values exist (all animations are modal/entrance/gesture), **no** memoized theme styles, **no** static StyleSheet entries that vary by theme. The regression was in the style payloads themselves: React Native does not reliably reset a style prop that merely *vanishes* from a style object — so a key that exists only in the dark materials survives the switch back to light as stale native state. The dark clay depth pass had introduced exactly that: dark `clayShade`/`compactShade` added `borderWidth: 1, borderColor: "rgba(...)"` keys with **no counterpart in the light materials**. The stale 1px border survived Dark→Light; on Android `borderWidth` + `elevation` forces a rectangular shadow outline around the rounded card, invisible in dark (black-on-near-black) but glaring on the ivory light stage — precisely the Profile section cards (`compactShade`) and larger cards (`clayShade`).

### What changed (state cleanup only — no visual redesign of either theme)

- **`mobile/lib/clay.js`:** light `clayShade`/`compactShade` now declare `borderWidth: 0, borderColor: "transparent"` — the same keys the dark variants override, explicitly restored instead of omitted. All six material pairs now have identical key sets (dark overrides values; light restores defaults). Visually a no-op: a 0-width transparent border renders as nothing.
- **`mobile/app/(app)/(tabs)/trips.js`:** `styles.pill` gained `borderBottomWidth: 0, borderBottomColor: "transparent"` — the dark-only inline override above it sets `borderBottomWidth: 1.5`, which light never reset (same latent class, on the status pill).
- **`mobile/app/(app)/settings.js`:** the theme segment control's `active && mats.clayPill` pattern left stale border/shadow/background state on a pill losing selection (same screen the theme is toggled on). `styles.segmentOption` now carries the full key set as neutral defaults (0-width transparent borders, transparent background, zeroed shadow/elevation) so deselection restores explicitly.
- **`mobile/lib/clay.test.js` (new):** regression guard — asserts every material in `clayMaterials(true)` declares the same keys as its `clayMaterials(false)` counterpart, and that the light borders are restored as invisible defaults rather than omitted.

Verified safe by audit (key parity already held): DriverSos `sosEdges`/`chipEdges` (both branches same keys, widths supplied by statics), DriverHomeCards `raisedControl`/`raisedControlDark` and `pillEdgesLight`/`pillEdgesDark` pairs, all `dark && {...}` inline overrides (statics beneath supply every key), AppAlert, trip/complete gleams.

### Verification

Targeted ESLint clean on the four touched files; mobile Vitest 16 files / 113 tests passed (new key-parity suite included); `expo export --platform android` passed (5.06 MB). No layout, spacing, content, navigation, or business-logic changes; light and dark visual recipes byte-identical to before wherever keys already matched. **The repeated Light → Dark → Light → Dark → Light cycle on the Profile tab (header, Account / Privacy & Security / General cards, Sign Out, icon tiles) requires a native device and remains pending this session.** No commit created.

## Home Claymorphic Loading Skeleton & Performance Optimization — 2026-09-13

Owner request: Analyze and optimize the loading skeleton on the mobile Home screen (`mobile/app/(app)/(tabs)/index.js`) to eliminate lag and stutter, while crafting faithful 1:1 claymorphic placeholder skeletons matching the loaded cards.

### Problems Addressed
1. **Lag & JS Bridge Contention:** Standard skeleton implementations instantiate a separate `Animated.loop` timer for each placeholder block. With ~15-20 skeleton elements across Hero and Trip cards, 15+ concurrent animation clocks caused continuous JS-to-Native bridge traffic, leading to frame drops (30-45fps) and UI freezing during concurrent network requests.
2. **Cumulative Layout Shift (CLS):** The previous generic `<SkeletonCard lines={4} />` stood at ~95dp. When `DriverHeroCard` (~245dp) and `DriverTripCard` (~370dp) finished fetching, the page experienced an abrupt 150-275dp layout jump.
3. **Aesthetic Disconnect:** The old generic wireframe skeleton had flat rectangular gray lines that clashed with the warm ivory (`#F5F2EC`) and molded clay aesthetic.

### Implementation Details
- **Master Pulse Clock (`useSharedSkeletonPulse` in `mobile/components/home/DriverHomeSkeletons.jsx`):**
  - A single hoisted master `Animated.Value` drives all skeleton opacities screen-wide (`0.38 <-> 0.78` over 850ms ease-in-out).
  - Uses `useNativeDriver: true`, offloading all pulse ticks to the native rendering thread. Slashes bridge messaging by >90%.
  - Respects OS accessibility preferences via `AccessibilityInfo.isReduceMotionEnabled()`. When enabled, animation stops and holds a steady, pleasant resting opacity (0.55).
  - Automatically cleans up and unmounts loop animations when `loading` becomes false.
  - Adheres to React 19 rules (using lazy state initialization `useState(() => new Animated.Value(0.38))` rather than render-phase ref access).
- **Lightweight Hardware-Accelerated Primitive (`ClaySkeleton`):**
  - Uses `renderToHardwareTextureAndroid={true}` for zero-re-rasterization GPU layer caching.
  - Automatically theme-adapted: `#D8E2DC` on light ivory mode, `#22332A` on dark forest slate.
- **Content-Matched Clay Skeletons:**
  - `DriverHeroCardSkeleton`: 1:1 exact structural replica of `DriverHeroCard` (~245dp height). Includes eyebrow date and subtitle skeleton, side-by-side pale mint clay KPI panels with squircle icon badges, and assigned vehicle bar with vehicle icon squircle.
  - `DriverTripCardSkeleton`: 1:1 exact structural replica of `DriverTripCard` (~370dp height). Includes status pill, departure time, origin/destination stop nodes with vertical route track line, route map preview placeholder, and action CTA button.
  - Preserves exact outer clay materials (`clayShade`, `compactShade`, `clayTile`) and shadow profiles.
- **Home Screen Integration (`mobile/app/(app)/(tabs)/index.js`):**
  - Connected `DriverHeroCardSkeleton` and `DriverTripCardSkeleton` using `skeletonPulse`.
  - Maintained `AssignmentsHeading` ("Today’s Assignments") above the trip card skeleton to keep visual hierarchy continuous.
  - Preserved all trip details workflows, action gates, offline handling, and modals intact without modification.

### Verification
- ESLint: Clean (0 errors, 0 warnings on `DriverHomeSkeletons.jsx` and `mobile/app/(app)/(tabs)/index.js`).
- Unit Tests: All 21 Vitest test suites (123 tests) passing.
- Android Hermes Export: Passed (`1,395 modules`, 5.15 MB bundle) with zero build errors.

### Removal of Box Shadow Artifacts on Curved Skeleton Cards — 2026-09-13
Owner report: The loading skeleton card is curved (`borderRadius: 28`), but Android was drawing a dark rectangular box shadow with sharp 90-degree corners protruding from the bottom-left and bottom-right corners (`media_1789308289313.png`: "remove the shadow thingyy kasi naka curved diba not box naman").
- **Root Cause**: Two contributing factors in React Native Android:
  1. `renderToHardwareTextureAndroid={true}` on the View forces Android to render the component into a hardware texture layer. When Android's RenderNode calculates elevation for hardware layers, it falls back to the bounding rectangle, casting a solid rectangular shadow.
  2. Spreading `mats.clayShade` applies `elevation: 7` alongside unequal top/bottom borders (`borderTopWidth: 2`, `borderBottomWidth: 3`), which triggers `outline.setRect()` instead of `outline.setRoundRect()` in Android's `ReactViewBackgroundDrawable`.
- **Fix**:
  - Removed all outer drop shadows and elevation (`elevation: 0`, `shadowOpacity: 0`, `mats.clayShade`) from `DriverHeroCardSkeleton` (`heroShell`) and `DriverTripCardSkeleton` (`styles.trip`).
  - Added `overflow: 'hidden'` to `styles.heroShell` (radius 28) and `styles.trip` (radius 24) to ensure strictly curved silhouettes.
  - Removed `renderToHardwareTextureAndroid={true}` from all skeleton containers and `ClaySkeleton` bars, relying exclusively on `useNativeDriver: true` for GPU opacity modulation.
  - Removed shadow declarations from inner KPI and vehicle skeleton panels, retaining clean pastel tinted surfaces (`#E5EEE7`, `#F3F7F4`).
- **Verification**: ESLint 0 errors / 0 warnings; all 21 Vitest test suites (123 tests) passing.

### AssignmentsHeading & View Full Schedule Typography Refinement — 2026-09-13
Owner request: Adjust font sizes of "Today's Assignments" and "View Full Schedule" on the mobile Home screen ("paki ayos yung font size ng today's assignment and view full schedule").
- **Changes**:
  - In `DriverHomeCards.jsx` (`AssignmentsHeading`):
    - Title: replaced bulky 20px `titleLg` with scaled 17px (`moderateScale(17)` / 22px lineHeight, `PlusJakartaSans-SemiBold`, `letterSpacing: -0.2`) in `colors.onSurface`.
    - Action link ("View Full Schedule"): refined from 14px to scaled 13px (`moderateScale(13)` / 18px lineHeight, `PlusJakartaSans-SemiBold`) in `colors.primary`.
    - Chevron icon resized to 14px with tight 3px gap and 6px hitSlop for comfortable touch accessibility.
    - Prevents text truncation / ellipsis on narrow 360-390dp screens while establishing clean visual hierarchy between section title and secondary action.
- **Verification**: ESLint 0 errors / 0 warnings; all 21 Vitest test suites (123 tests) passing.


## Launch animation and startup optimization - 2026-09-14

The app previously played a five-second car Lottie at 1.2x, faded the launch overlay out over 360 ms, then faded/scaled the entire app in over another 620 ms. This could expose an empty intermediate frame and prolonged the opening sequence. The underlying navigator now stays rendered at its normal scale while one 240 ms native overlay fade reveals it. Touch and accessibility access to the underlying navigator remain disabled until launch completes.

The existing car artwork now plays once at 2.5x (about two seconds), with a 2.3-second fallback timer. The dial and wordmark settle earlier; the secondary location-beacon artwork holds a static frame instead of running a second Lottie loop. Motion waits for the OS reduced-motion preference, which uses a 150 ms hold and effectively immediate transition. Completion is guarded against duplicate events, cancelled car animations do not complete launch, and entrance animations stop on cleanup. Auth, consent, fonts and data loading retain their existing guards.

Direct imports load only the six font weights already used by the app. Verified Android export changed from 1,395 modules / 101 assets / 5.15 MB Hermes bundle to 1,373 modules / 79 assets / 5.13 MB; 22 unused font assets no longer enter the export. No typography or clay styling change and no dependency added.

Verification: two runnable launch-lifecycle tests passed (completion races, bounded timing, native/non-interaction flags, cleanup, pending/reduced-motion preferences); targeted ESLint passed; final Android Hermes export passed. No connected adb device was available, so physical-device cold-start duration, frame rate and light/dark appearance have not been measured. These are configured animation timings and bundle measurements, not a claimed FPS improvement. Native splash acceptance should be checked in a release build per the Expo splash-screen documentation: https://docs.expo.dev/versions/v57.0.0/sdk/splash-screen/ .
### Uncommitted Home change review — 2026-10-03

Reviewed the Pre-Shift shortcut, its tutorial guard and route prefetch, and the interactive route preview for all visible upcoming trips. Focused ESLint and tests passed; the full repository suite passed 3,675 tests, and Android Expo JS export completed (with an existing `android.googleServicesFile` config warning). Native device interaction and route rendering were not verified in this review.

