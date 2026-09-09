# Mobile Home Claymorphism Implementation Plan

Date: 2026-09-09
Status: Implemented; automated checks and isolated component review completed. Native device acceptance remains pending.

## Direction and scope

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
