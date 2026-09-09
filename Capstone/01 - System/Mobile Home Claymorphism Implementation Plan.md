# Mobile Home Claymorphism Implementation Plan

Date: 2026-09-09
Status: Implemented; automated checks and isolated component review completed. Native device acceptance remains pending.

## Direction and scope

### Real route preview — 2026-09-09

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
- **Icon removals, owner follow-up**: the calendar icon tile in the trip-card empty states (Current/Next/Then — one shared code path) and the calendar tile beside the "Today's Assignments" heading were removed; the empty states are now text-only and the heading is the title + View Full Schedule link. Unused `emptyTile`/`headingIcon` styles deleted.
- **Section rhythm**: scroll gap 18 → 12, top padding 14 → 10.
- **Trip cards** (Current/Next/Then): padding 20 → 14, internal gap 18 → 12, status/tag pills 14/9 → 10/6 (radius 16), timeline nodes 24 → 20 (border 3 → 2.5, track 26 → 22) with stop padding-bottom 18 → 12, CTA 58 → 48 minHeight (padding 14 → 10, radius 18), empty state 110 → 84. `TripMapPreview` aspect ratio 1.65:1 → 1.9:1 (radius 28/22 → 22/17) — the single biggest per-card saving, shared with Trip Details.

Net effect: ~100px more content above the fold on a typical phone — header through quick actions plus the assignments heading visible without scrolling. Verified: targeted ESLint clean on all touched files, mobile Vitest 14 files / 102 tests, `expo export --platform android` passed. On-device visual acceptance still pending. No commit created.
