# UI/UX Audit — FleetOps Mobile (Driver App)

## Selected style rollback — owner instruction, 2026-10-30

Restored the original curved-wave navigation, shared clay card/button appearance and Home header decoration. Input styling/accessibility and popup changes were not selected for rollback; workflow/security/error-recovery fixes remain. This supersedes the earlier flat-navigation/material recommendations for those surfaces. Details, browser captures and final checks: [[Mobile Home Claymorphism Implementation Plan#Selected visual changes undone — 2026-10-30]].

## Home artwork restoration — owner correction, 2026-10-29

The audit's removal of the recent Cargo/Hotel illustrated Home design was not the intended enhancement. Restored the original scene images, headings/colors, top overview, summary/vehicle row, matching loading shapes and Home-only materials while retaining confirmed workflow/accessibility fixes. The earlier claim that an approved audit superseded the illustrated design is corrected by the owner's explicit instruction to preserve it. See [[Mobile Home Claymorphism Implementation Plan#Owner correction: restore the illustrated Home — 2026-10-29]] for scope/checks and visual limits.

## Approved mobile cleanup — 2026-10-29

Completed the existing 17-section source audit and its approved workflow/accessibility-first implementation. Home now prioritizes duty/current work and visible Incident; shared controls/materials, form feedback, policy reading, trip/Cargo recovery and responder identity are corrected. The current Elevated Clean direction supersedes older keep-clay and large illustrated Home entries below. See [[Mobile UI UX Audit 2026-10-29]] for findings, final checks and remaining device acceptance, and [[Mobile Architecture#Mobile usability implementation — 2026-10-29]] for the implemented contracts.

## FleetOps identity and route reveal - 2026-10-21

Implemented the owner-provided full mobile launch rebrand: open route ribbons with a brass connection point, shared semibold wordmark, forest/ivory/brass and monochrome variants, rebuilt local route-to-mark animation and native app/splash assets. Existing clay product surfaces remain in place; brand positions now share the custom mark. Normal configured handoff is at most 2,080 ms, with bounded reduced-motion/error fallback and preserved startup lifecycle. See [[FleetOps Mobile Identity]] for changed/removed files and full verification.

Passed 105 mobile/lib test files / 1,176 tests, strict touched lint, encoding and Android Hermes export. Browser fixtures use real components/JSON/fonts with mocked native boundaries; formation, dark final launch, 320 px / 2x text launch/Auth/onboarding and both high-contrast modes were inspected. Native device/release-build, screen-reader and frame-rate acceptance remains pending. The pre-existing Home identity row wraps heavily at 320 px / 2x text; its new brand signature fits, and this rebrand does not claim to fix the operational row.

## Keep claymorphism, reduce presentation work — 2026-10-21

The owner chose to retain claymorphism and optimize the app instead of adopting either replacement concept below. They requested a broad smoothing pass and identified their installed build as an EAS development build. Source inspection found that clay materials were already cached per scheme, shared clay primitives were memoized, and Android card sheen was already disabled; no speculative shadow flattening or blanket hardware-texture caching was added.

Implemented three bounded changes:

- Trips now hands grouped rows to React Native SectionList rather than eagerly building every loaded card inside ScrollView. Existing cards, Today/Upcoming/History, date groups, refresh, loading/error/offline/empty guidance and manual pagination are preserved. Initial and subsequent batches are configured at four items with a five-viewport window; actual mounted native counts are not measured. Clipping remains disabled to preserve clay shadows, and variable card/text heights are retained.
- NotificationFeedProvider retains its array when the complete ordered JSON response is unchanged and memoizes its context on all real fields/callbacks. Changed messages, read state, order, metadata, additions/removals and error recovery still publish. Delivery classification, seen-ID deduplication and polling cadence are unchanged.
- Shared useScreenClock owns the existing 30-second Home/Trips presentation cadence only while the screen is focused and the app is positively active. Blur/background removes the timer; focus/resume immediately refreshes time. Hidden Home also stops its loading pulse and unmounts its route-preview components with equal-aspect placeholders. All applicable road previews return when Home is active, including upcoming cards; their map documents reload on return. GPS, duty/inspection/trip enforcement and network ownership are untouched.

Repeatable work measurements: a 90-row history fixture produced 90 eager card descriptors before and zero afterward, with all 90 records passed to SectionList's row renderer. Six identical notification polls previously changed array/context identity six times and now change neither. A real Home component fixture retains four route-preview components when active and zero while hidden, with trip facts/actions still present. Clock tests verify one visible interval and zero blurred/background intervals. These demonstrate avoided application work, not Android frame rate or memory savings.

Verification: the full mobile-filtered run passed 112 files / 1,272 tests, strict lint passed for all nine touched source/test files, and independent review found no important issue (70 focused tests independently passed). Browser fixtures used the actual Trips/Clay components, RN Web SectionList, fonts and icon assets with substituted API/auth/cache/router/native boundaries. Visually checked Today/Upcoming/History at 320/390 px, light/dark, 320 px dark with simulated 1.6x text, empty/error states and scrolling. Screenshot: `scratch/mobile-clay-performance-trips.png`. Android Hermes export passed with 1,508 modules, a 5.93 MB bundle and 91 assets after retrying a sandbox-temp write failure with a workspace-local temporary directory. UTF-8/whitespace checks are recorded in the implementation plan.

Physical Android fast scrolling, native shadow/windowing behavior, WebView teardown/resume, actual OS text scaling, FPS and memory remain unverified. A release/preview build is needed for meaningful performance acceptance because development mode adds overhead. No dependency, database, cloud build, deployment, push or commit was made. Plan: `docs/superpowers/plans/2026-10-21-mobile-clay-performance.md`. This entry supersedes older claims below that Home is limited to one interactive road preview.

## Claymorphism replacement recommendation — 2026-10-21 (discussion only)

The owner asked which visual style would be a good replacement for claymorphism. Recommended soft minimalism: solid, clearly separated card surfaces, modest corner rounding, thin borders and light shadows, retaining the existing forest-green/warm-ivory palette and Plus Jakarta Sans. Preserve visible card grouping: earlier device feedback rejected an overly bare Trips layout. Emphasize readable text, one clear primary action and trip statuses with explicit labels/icons as well as color. A restrained Material 3 direction is an alternative for a more familiar Android appearance.

This is a recommendation awaiting the owner's choice, not an approved redesign or implementation. Reviewed existing product/design context, mobile theme tokens and prior mobile audit/Home notes; obtained an independent design second opinion and checked official Android color/theme guidance. No runtime/device verification was performed because no application code changed. Reference: https://developer.android.com/design/ui/mobile/guides/styles/themes

### Comparison visualization — 2026-10-21

At the owner's request, generated and visually inspected an inline side-by-side Home-screen concept using the built-in image generator. Left: soft minimalism with white bordered cards, light shadows and moderately rounded controls. Right: restrained Material 3 with sage tonal surfaces, rounder cards, a pill CTA and selected-navigation capsule. Both retain forest/ivory colors and the same clearly labeled sample driver, vehicle, metrics and trip details for comparison. Text, matching sample values, route labels and bottom navigation were checked in the generated image. This is a visual concept, not a runtime screenshot or an approved application change. The preview remains in Codex's generated-images storage; no app, data or workflow implementation was performed.

## Trips date tabs and off-duty browsing - 2026-10-17

Implemented the user's approved Today / Upcoming / History reference using UI/UX Pro Max and High-End Visual Design within the existing ivory/forest raised-card system. Off Duty no longer controls Trips presentation. The raised header contains the actual Manila date, a named 48 dp work-schedule calendar action and segmented tabs. Cards retain route, schedule, real status, passenger/cargo and vehicle facts; the whole card opens details with one View details cue, removing nested interactive buttons. Today prioritizes ongoing/overdue work and retains undated assignments; Upcoming groups by Tomorrow/actual date; History lists Completed/Cancelled newest first, with older-page access. Counts describe loaded rows, with a plus when more exist.

Separate server scopes prevent old history from pushing future assignments out of a capped mixed response. Per-tab empty messages replace the duty illustration; loading/error/offline and saved-date confirmation remain honest. Larger text at 320 px initially crowded the horizontal tab labels. The narrow/large-text variant now stacks them, with measured 231 x 51.66 px targets and explicit selected state. Standard-size tabs retain 48 dp minimum targets and the reference's quiet selected surface/forest indicator.

Verification: strict touched lint, encoding/whitespace checks and Android Hermes export passed (1,471 modules, 5.73 MB, 88 assets). Fixture review covered populated/empty Today, future date groups, mixed-status History/older-page loading, light/dark and simulated 1.6x text. Real screen/shared cards/fonts/Ionicons were used; API/auth/profile/cache/navigation/gradient were substituted. Existing layout expectations were revised without adding or running automated tests. Native/device/OS text scaling/screen-reader and live API/database acceptance remain unverified. Preview: `scratch/trips-tabs-preview.png`. No dependency, migration, operating write or deployment. This supersedes the Trips duty-empty/header behavior documented below; Home and Map duty presentations are unchanged.

## Notifications review and polish — 2026-10-17

Used UI/UX Pro Max and High-End Visual Design within the app's existing native ivory/forest, Plus Jakarta Sans and soft-card system. Source review found a separate FleetOps/Alerts header, squeezed one-line titles next to timestamps, truncated message bodies, small dismiss buttons nested inside the card navigation target, weak unread identification and time-only labels on older messages. The provider also swallowed retrieval failures while the screen displayed All Caught Up for an unsuccessful initial request.

Reused ClayScreenHeader for Notifications/back navigation and kept raised containers for the inbox summary, message cards, retry guidance and empty state. Mark all read has a full-width 48 dp control and pending feedback. Notification titles and messages now wrap in full; compact category/semantic icons and real severity labels sit above the title, while timestamps and explicit Read/Unread labels sit below the body. Old timestamps include the date, previous-year timestamps include the year and invalid timestamps have an honest fallback. Dismiss is a sibling 48×48 dp button outside the message action. The shared provider exposes refresh failure, preserves loaded messages on failure and clears the error on recovery; the screen offers Try again rather than claiming an empty inbox. Bottom padding clears the existing floating controls.

Verification: four new rendering regressions failed before implementation. Final 46 focused tests passed across six files, including full-copy rendering, dismiss/navigation isolation, existing deep links, refresh failure/recovery with retained rows, timestamp handling, delivery classification, push-permission behavior and clay primitives. Strict touched lint and Android Hermes export passed (1,469 modules, 5.72 MB, 88 assets). Fixture-backed browser review covered 320 px light, 390 px dark and failed/empty states; a 320 px 1.6× text simulation had no horizontal overflow and retained a measured 48×48 dp dismiss target. Fixture-only dismissal and Mark all read updated the expected row/count/status independently. Preview uses real screen/shared components/fonts and Ionicons glyph assets with fixture providers/data and substituted gradient rendering; no live notification was read or dismissed. Saved preview: `scratch/notifications-preview.png`. Native device/screen-reader/OS text-size acceptance remains pending. No database, API endpoint, delivery policy, dependency or deployment change.

## Trips card restoration after device feedback — 2026-10-17

The user rejected the plain Trips layout because removing its boxes made the screen look empty and white. Restored the shared raised ClayCard around the title/date/duty-badge header and around the centered duty illustration/title/explanation. Both cards fill the same content width, with the existing 12 dp gap. The header uses 16 dp padding; the empty-state card has 24 dp padding and a 240 dp minimum height that can grow for text. The badge stays beside Trips, and the bounded image, state precedence, scoped populated-queue counts and bottom clearance remain intact.

This supersedes the unraised header and bare empty-state container described below. Home and Map presentation are unchanged. Fifteen focused duty-layout/illustration checks passed. Browser review at 320/390/440 px and in light/dark confirmed the restored card surfaces, depth and alignment with no preview console errors. Native-device visual confirmation remains pending. This is a small presentation correction; no new Android export was run.

## Approved placement and color changes implemented — 2026-10-17

The user approved the recommendation below. Trips now has an unraised title/date header with one compact duty badge at the right when the corresponding empty state is visible. The zero-count panel is absent for an empty queue; populated queues retain the correctly scoped open-assignment count. A single centered artwork/title/explanation group begins 48 dp below the header area. Loading, errors and never-synced guidance retain precedence over duty artwork and its badge; Rest Day and On Leave keep their own symbols.

Map's non-operational/loading presentation now reads the app's semantic background, text, control and icon colors instead of its private mint palette. It reuses the same primary ClayBadge as Trips, with its existing centered placement. Shared badge labels now reference the installed `fonts.bodySemiBold` rather than an unregistered font alias. Measured preview colors match exactly: light badge forest `#285448` with white text; dark badge sage `#A6C7B8` with `#103A30` text. High-contrast colors resolve through the same existing semantic tokens.

Home keeps avatar, greeting/name, compact weather and notifications in one row. The greeting sits above the driver's name, and phone weather shows only its icon and temperature in a minimum 72 dp area. The full city/condition remains in its accessible description, and the full weather variant retains its visible city label on wider layouts. No weather payload produces no chip. Both 48 dp profile/notification targets remain intact; text can wrap within the identity for larger fonts.

Verification: two new regressions failed before implementation (the redundant empty-queue count and visible city in compact weather). Final 99 focused tests passed across nine files, including loading/error/offline precedence, counts, weather, duty artwork, Cargo Home, queue behavior and clay primitives. Strict touched ESLint passed. Android Hermes export passed (1,468 modules, 5.72 MB, 88 assets). Browser review used real Home header/WeatherChip/Trips/ClayBadge components and the extracted real Map empty-state JSX/styles, with fixture data/providers and substituted icon/gradient rendering. At 320/390/440 px, weather and bell are on the same row with 8 dp separation and no overlap; both themes have equal badge colors. A 320 px preview with simulated 1.6× text retained no horizontal overflow; native accessibility/device behavior remains unverified. The earlier explicit image dimensions and bottom clearance remain in place. No API, database, tracking, duty workflow or deployment change.

## Placement and color review after user feedback — 2026-10-17

Analysis only; the user dislikes the Trips Off Duty placement, Map's different colors and Home's weather row below the greeting. The weather-under-identity layout from the previous correction is not visually accepted.

Source findings: Trips stacks a raised title/date/zero-count summary above another raised empty-state card. Its scroll gap (12 dp) and empty-card top margin (24 dp) add separation. Inside that centered card, `ClayBadge` has its own `alignSelf: 'flex-start'`, overriding the parent's centering and placing OFF DUTY at the left while the artwork/title are centered. Map uses a separate hard-coded mint page gradient and pale-green status pill, whereas Trips uses the shared primary badge and the app's ivory background. These are actual styling differences, not different duty states.

Recommended next design: put the compact Off Duty badge at the right of the Trips title, keep the date beneath the title and group the small artwork, explanation and heading together in the upper-middle work area. Avoid the extra raised zero-count summary when the queue is empty; preserve count scope on populated queues and preserve truthful loading/offline/duty handling. Use one shared forest badge treatment and the app's semantic ivory/forest background and text colors across Trips and the non-operational Map. A centered badge directly above the empty-state title is a smaller alternative if the current header is retained, but the header placement is preferred because duty status is page context.

For Home, retain a single header row: avatar, a small greeting above the driver's name, a compact weather icon/temperature and the notification button. The 128/148 dp city pill is too wide for a phone header; use a narrower header-specific presentation and retain the full weather/location description for accessibility. Do not move weather below the greeting by default. Larger accessibility text may require a deliberate fallback after real measurement. This recommendation has not been implemented or visually accepted; no fresh app tests or build were run for this analysis.

## Phone layout correction — 2026-10-17

Applied UI/UX Pro Max and High-End Visual Design to the supplied Map, Trips and Cargo Home screenshots while retaining the existing Plus Jakarta Sans, forest/ivory palette and soft card materials. The earlier width-only illustration reduction was incomplete: React Native's Android and iOS Image implementations prepend the bundled asset's width and height, so leaving height unset retained the 800×714 asset's native height. The shared illustration now explicitly sets both dimensions for compact (44×39.27), card (88×78.54) and hero (132×117.81) variants, including the fallback size. Labels and explanations remain readable beside the decorative art.

Home now keeps the avatar, greeting and notification button in one explicit row; weather moves beneath the identity on phones below 600 dp and for larger text settings. This replaces the wrapped flex row that could squeeze the greeting between weather and notifications. Home, Trips and the Map empty state reserve 168 dp plus the bottom safe inset after their scrollable content, allowing the last content to scroll above the resting SOS button and floating navigation. A manually repositioned SOS can still overlap content during scrolling; its existing drag behavior is preserved.

Verification: four new regressions failed on the inherited 714-pixel height before the fix; all 73 focused illustration, Cargo Home, duty, Map and weather checks passed afterward. Browser component previews using the real header, weather and illustration components with actual fonts/assets showed readable layouts at 320, 390 and 440 px in light mode and 390 px in dark mode. Measured greeting/notification boxes do not intersect and weather is below both. Preview providers and the bell/gradient rendering were substituted, so this is component layout evidence, not native screen acceptance. Actual Android/device text scaling, shadows, SOS placement and complete-screen visual acceptance still require a device reload. Strict touched ESLint, UTF-8/mojibake and whitespace checks passed. Android Hermes export passed with 1,468 modules, a 5.72 MB bundle and 88 assets; after a sandbox temporary-folder write refusal, the export succeeded using a temporary folder inside the workspace.

## Cargo reference review — 2026-10-14

### Approved findings implemented

The six findings below were implemented on 2026-10-14. Shared SwipeButton waits for an explicit confirmed `true` from the real Map status handler, shows a readable neutral Submitting state, locks duplicate actions and keeps success hidden for queued/refused/held/navigation-only outcomes. It fences late replies/timers on unmount. A shared AccessibilityInfo hook handles system reduced-motion changes, stale initial results, query failures and listener cleanup; Home expansion and swipe confirmation use it.

Cargo keeps Pre-Shift, Schedule, Activity Log and Incident in its visible shortcuts; End Duty remains directly available as a separate tonal button when on duty and its report card is not already shown. Passenger order remains unchanged. A dedicated Pre-Shift prompt suppresses the duplicate Cargo duty band. Cargo overview/assignment elevation is lighter and metric/vehicle/shortcut inner surfaces no longer repeat the molded outer shadow. Compact Cargo Map keeps target, telemetry and consignment; vehicle information moves to expanded Details with schedule/capacity/stops. Source/Fleet/receiver, inspection, geofence, tracking and manual completion gates are preserved.

Verification: initial regressions demonstrated premature success and the duplicate/dense layout defects; final 1,091 affected tests passed across 85 files, strict touched lint and Android Hermes export passed (1,457 modules / 5.68 MB / 82 assets). Independent source review found no important regression. Two Pre-Shift source-contract assertions were updated to the named condition without removing the tour/duty checks. Native screenshots, largest text, small-phone/landscape/keyboard/screen-reader fit and iOS/web/device/deployment acceptance remain pending; these are implemented source fixes, not a claim of exact reference fidelity.

Requested skills: UI/UX Pro Max and High-End Visual Design. Analysis only; no app code changed. Compared both supplied Cargo image boards with current Home/Map/shared-control source and Mobile Architecture. This is source/reference analysis, not rendered native acceptance or a visual score. High-End's website glass/bento/huge-whitespace/entry-animation prescriptions do not override the pinned operational mobile references. The verified UX search matched mobile touch spacing/targets; React Native safe-area search had no verified relevant match after retry, so safe-area assessment uses the skill's explicit native checklist instead.

Verdict: Cargo is differentiated from hotel Passenger and the palette/type foundation is suitable, but the reference layout is not fully matched or visually accepted.

| Priority | Finding and evidence | Recommended correction |
| --- | --- | --- |
| P1 | Existing shared SwipeButton calls the asynchronous transition callback without awaiting it and immediately starts its success/checkmark overlay (`SwipeButton.js:146–147`, `:259–260`). This is gesture feedback, not server confirmation, and can imply success while a Cargo hold or refusal is pending. | Show pending feedback during submission; reserve the checkmark for confirmed success and retain the blocked reason on refusal. |
| P1 | On-duty Home prepends End Duty (`index.js:536`); phone shortcuts only show four items (`DriverHomeCards.jsx:171`), pushing Report Incident behind More. The reference keeps Incident directly visible. | Keep Incident in the visible four; retain accessible End Duty through a separate control or a different lower-priority shortcut. |
| P2 | Cargo Off Duty can show both the Pre-Shift prompt (`index.js:612`) and the hero duty band (`DriverHomeCards.jsx:60`), followed by counters/vehicle in the same overview. This duplicates hierarchy compared with the compact reference. | Use one primary duty block, with vehicle/counters arranged below; retain honest count scope rather than inventing the reference's three values. |
| P2 | Cargo Map keeps load and vehicle rows in the primary sheet for all stages (`TripOperationalSummary.jsx:45–56`), with more stop rows expanded below. The reference navigation states are shorter and prioritize target/action. Above-fold fit is an unverified risk, not a measured overflow. | Keep current target/status/route estimate/action primary; move vehicle/capacity/schedule and duplicate stops into Details. |
| P2 | Home reuses layered molded shadows on outer overview, metrics, vehicle, shortcuts and assignment (`DriverHomeCards.jsx:49`, `:78`, `:95`, `:178`, `:305`; `materials.js:21–23`). Source suggests a heavier embossed treatment than the quieter reference. | Consolidate Cargo elevation/radii; use one dominant raised surface and restrained inner groups, while preserving mobile theme tokens. Confirm with device captures. |
| P2 | Existing shared Home expansion unconditionally uses LayoutAnimation (`DriverHomeCards.jsx:174`), and SwipeButton uses springs/timing without a reduced-motion branch. | Honor the system motion preference; do not add the High-End skill's marketing-style scroll reveals to this operational interface. |

Strengths: shared TripCard and map/controller workflows avoid duplication; Cargo uses real consignment/weight and no guest counts; passed inspections/confirmed start timing and server authority remain explicit. Plus Jakarta Sans and forest/ivory/sage align with the references. Calculated token-pair contrast: light primary CTA 8.56:1, light muted/card 6.15:1, light mint label 10.23:1, dark mint label 6.04:1, dark muted/card 10.33:1. These solid-color calculations are not acceptance of all composed/disabled states.

The schedule link's 40dp visual height is not reported as an undersized target: it has 6dp hitSlop. SwipeButton has an accessibility activation action, so it is not reported as screen-reader gesture-only. Largest text, 360/375dp portrait, landscape, actual shadows, safe-area/CTA reach, keyboard and screen-reader behavior still require native screenshots/runtime checks. Existing 1,065-test/Android-export results establish regressions/build only, not reference fidelity. No implementation or fresh test run was needed for this read-only audit.

## Earlier audit — 2026-08-20

- **Date:** 2026-08-20
- **Method:** `impeccable` native `critique` + `audit.native` (source-level; no `detect.mjs` on native). Assessment A = design-director review; Assessment B = code-level deterministic scan. Method honest: dual-pass, driven inline (no dedicated detector agent available).
- **Scope:** `mobile/` driver app only. Web stays monochrome (product decision).
- **Deliverable:** report + implemented P0/P1 fixes (see "Changes Applied").

---

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 1/4 | Core trip loop + list rows unlabeled; nested pressables |
| 2 | Performance | 1/4 | Zero `FlatList`; every list is `ScrollView` + `.map()`; Home is 1,219 lines |
| 3 | Appearance & Theming | 2/4 | Excellent token system, but 8+ screens bypass it with light-only hex |
| 4 | Platform Conformance | 3/4 | Ionicons + tabs + insets correct; legacy `vehicle.js` uses Inter font |
| 5 | Adaptivity | 3/4 | `moderateScale` + insets everywhere; phone-first, no tablet/orientation handling |
| **Total** | | **10/20** | **Acceptable — significant work needed** |

---

## Platform Conformance Verdict

Reads as a **native app** (not a web port) on the core paths. Material Design 3 token system, proper insets, RN tabs, Ionicons, no HTML-style controls. Two conformance cracks: the legacy `vehicle.js` screen (Inter font, hard-coded colors) and dark-mode status-pill parity.

---

## Findings by Severity

### P0 — Blocking
None found. The app's core flows complete.

### P1 — Major (fixed)
- **`[P1] Hard-coded status colors break dark mode.** `trip/[id].js`, `map.js`, `trips.js` each re-implement the same status→color map with light-only Tailwind hex; `submissions.js`, `history.js`, `notifications.js`, `fuel-report.js` bake in light tints. All render incorrectly in dark/high-contrast. **Fixed** — now resolve via `statusColors`/`statusColorForTone` (theme.js) which are palette-aware.
- **`[P1] Foreign colors not in the palette.** `vehicle.js` used `#2563EB` (Tailwind blue) for buttons; `history.js` `#8690EE`/`#E0E0FF`; `notifications.js` `#E0E0FF`; `fuel-report.js` `#a7f3d0`/`#065f46`; `incidents.js` `#D97706` fallback. **Fixed** — mapped to semantic tokens (`primary`, `onPrimary`, `warning`, `success`).
- **`[P1] Core trip-loop controls unlabeled.** `trip/[id].js` accept/start and continue buttons, Home CTA, and `trips.js` trip cards had no `accessibilityRole`/`accessibilityLabel`. **Fixed.** The shared `Button`/`StatusPill` components and `DriverSos` FAB already had roles/labels; SOS inner actions (call 911 / share location / close) now labeled too.

### P2 — Minor (deferred / recommended)
- **`[P2] No list virtualization.**** `trips.js`, `history.js`, `notifications.js`, `submissions.js` all `ScrollView` + `.map()`. Deferred: driver lists are short per-day and converting the sectioned trip queue risks the verified bucket/overdue logic. **Recommend `$impeccable adapt`** on list screens if list volumes grow.
- **`[P2] Home hero assumes light `primary`.**** `index.js` renders `#FFFFFF` text on the `primary` hero card; in dark mode `primary` is a light green (`#A6C7B8`) → contrast fails. Not yet refactored (larger hero pass).
- **`[P2] Nested pressables.**** `trips.js` `TripItem` wraps the card in one `Pressable` containing another action `Pressable`. Confusing for screen readers; flagged, not restructured to avoid altering the working flow.

### P3 — Polish
- **`[P3] Legacy `vehicle.js`.**** Uses `Inter` font instead of Plus Jakarta Sans; hidden tab. Flagged for a future consistency pass.
- **`[P3] `settings.js:226`** static `#e2e8f0` border (elsewhere token-based).
- **`[P3] `statusSurfaces` dark detection** uses `c === dark`, so `highContrastDark` falls back to light tints. Pre-existing in `theme.js`; edge case.

---

## Positive Findings
- A genuinely crafted MD3 "FleetOps Tactical" token system: 4 palettes (light/dark/2× high-contrast), 8pt grid, 48pt `TOUCH_TARGET`, elevation levels, `statusSurfaces` + `tripStatusTone` — already ahead of most capstone work.
- Shared `Button`/`StatusPill`/`Chip` components carry correct `accessibilityRole`/`accessibilityState`.
- `DriverSos` FAB is properly `accessible` with label, hint, and drag affordance.
- Safe-area insets and `moderateScale` applied consistently for font scaling.

---

## Changes Applied (this session)

| File | Change |
|------|--------|
| `mobile/lib/theme.js` | Added `statusColorForTone(c, tone)` + `statusColors(c, status)` helpers (palette-aware). |
| `mobile/app/(app)/trip/[id].js` | Status pill via `statusColors`; star rating → `colors.warning`; a11y labels on accept/start + continue. |
| `mobile/app/(app)/(tabs)/map.js` | Status style via `statusColors`. |
| `mobile/app/(app)/(tabs)/trips.js` | `badgeColors` → `statusColorForTone` tone map; a11y labels on trip card + action. |
| `mobile/app/(app)/submissions.js` | Status display → token tones. |
| `mobile/app/(app)/(tabs)/history.js` | `statusColor` → tones; removed `#8690EE`/`#E0E0FF`. |
| `mobile/app/(app)/(tabs)/notifications.js` | Removed `#E0E0FF`/`#D97706` fallback → tokens. |
| `mobile/app/(app)/fuel-report.js` | Sync banner → `success` tone. |
| `mobile/app/(app)/incidents.js` | `#D97706` fallback → `colors.warning`. |
| `mobile/app/(app)/(tabs)/vehicle.js` | `#2563EB` buttons → `colors.primary`/`onPrimary`; container → `colors.background`; removed dead hard-coded StyleSheet colors; a11y label on complete-trip. |
| `mobile/app/(app)/(tabs)/index.js` | a11y label on Home trip CTA. |
| `mobile/components/DriverSos.js` | a11y labels on call-911 / share-location / cancel. |

**Verification:** no lint/test suite exists in `mobile/` (Expo app, core RN only). Changes are source-level, palette-driven, and preserve all business logic / RBAC / trip state transitions.

---

## Recommended Next Steps
1. Re-run the audit after the hero dark-mode refactor (`$impeccable adapt` on Home) to close P2 hero contrast.
2. Consider `$impeccable adapt` (FlatList) for list screens if data volumes grow.
3. Port the `vehicle.js` legacy screen to the Plus Jakarta design tokens (P3).
4. Refresh `schema.sql`/vault notes only if the backend changes — this audit is frontend-only.

> Follow-up: run `$impeccable audit` again after any fixes to track the score improving.

---

## Changes Applied — Round 2 (2026-08-23, UI/UX fix pass)

Follow-up round closing the deferred P2s plus honesty/accessibility gaps. Frontend-only; no dependency or business-logic changes.

| # | File(s) | Change |
|---|---------|--------|
| 1 | `components/SwipeButton.js` | Screen-reader activation: `accessible`/`role=button`/label/hint/state on the outer shell + `onAccessibilityAction("activate")` mirroring the gesture success branch. New optional `busy` prop. PanResponder untouched. |
| 2 | `(app)/incidents.js` | Offline queue honesty: `result?.queued === true` now renders "Report saved offline" overlay variant stating dispatch has NOT received it yet. Online copy unchanged. |
| 3 | `(tabs)/map.js` | Permission denial no longer spins forever: themed empty state (icon, exact message, Open Settings via `Linking.openSettings()`, Try Again re-runs permission effect via `permRetry` counter). |
| 4 | `lib/theme.js`, `(tabs)/index.js` | Hero contrast: `onPrimary` **already existed** in all four palettes (dark = `#103A30`, ≈6.9:1 on `#A6C7B8`) so theme.js needed no change. All hero text/badge/dot/route-viz whites converted to `colors.onPrimary` (+ alpha suffixes); static styles stripped of baked whites. White CTA pill label/icon/spinner use module constant `ON_LIGHT_INK = "#103A30"` (single token that stays dark in every palette). |
| 5 | `index.js` | Tracking status chip under the active-trip hero: warning-toned "Location not sending — will retry" on error, else neutral "Location updated Xs ago" (`caption` size, accessibilityLabel); hidden without an active trip. |
| 6 | `index.js` | Odometer modal: shows "Recorded: N km" (from `current_mileage`), client-side validation (positive AND ≥ recorded), confirm button disabled + spinner/"Completing..." while submitting; cancel also disabled mid-submit. |
| 7 | `(tabs)/map.js` | Single clock gate: OPENS AT label now derived from the same `earliest_start`/`windowOpen` expression as the disabled state (was `scheduled_time − 15min`). |
| 8 | `notifications.js`, `history.js` | Loading states use `SkeletonCard` (mirrors Home) instead of "Loading..." / spinner. |
| 9 | `components/AppAlert.js` | `isDark` was destructured from a context that never provides it → icon chip forced `#FFFFFF`. Now derived as `scheme === "dark"`. |
| 10 | `(app)/inspection.js` | Back icon `menu`→`arrow-back`; success alert split: all-passed vs FAIL ("dispatch has been notified" — verified true: backend inserts dispatcher notifications + push on any FAIL item); discard confirmation when leaving with answered items (AppAlert warning, Keep Editing/Discard). |
| 11 | `app/consent.js` | GPS copy now accurate: tracked "while you are signed in and on duty, including periodic location checks between trips". |
| 12 | `(tabs)/map.js` | Removed fabricated idle-dashboard distance (`completedCount * 8.4`). Remaining tile relabeled COMPLETED TRIPS (honest count). |
| 13 | `notifications.js` | Row taps deep-link via `mobileNotificationTarget()` (same map as banners) in addition to mark-read; cards get role+label (title+summary); Mark-all-read Pressable ≥48px (`TOUCH_TARGET`) with role+label. |
| 14 | `history.js` | Filter chips: `minHeight` 40, role=button, `accessibilityState.selected`; trip rows get role+label (route + status). |
| 15 | `fuel-report.js` | `styles.input` fixed `height: 48` → `minHeight: 48`. `login.js` checked — its input rows already use `minHeight: TOUCH_TARGET`; no change needed. |
| 16 | dead code | Removed: `STATUS_ORDER` (history.js), unused `actingOn` (map.js), unused `openMap` + then-unused `Linking` import (index.js), orphaned `statUnit` style (map.js). |

**Verification:** source-level only (no lint/test suite in `mobile/`); every modified file re-read top-to-bottom post-edit. Backend semantics confirmed before copy changes (inspections route notifies overseers on FAIL; apiFetch returns `{ queued: true }` when offline-queued).

---

## Changes Applied — Round 3 (2026-09-10, Home Performance & Lag Elimination Pass)

Comprehensive performance audit addressing owner report ("analyze why its so laggy in home in mobileee").

| # | Bottleneck | File(s) | Fix Applied |
|---|------------|---------|-------------|
| 1 | **Multiple WebViews / WebGL contexts on Home** | `components/TripMapPreview.jsx`, `lib/trip-map-preview.js`, `components/home/DriverHomeCards.jsx` | Added `staticMode` prop to `TripMapPreview` and `previewStaticImageUrl()` helper using TomTom's Static Map Image API. Home trip cards (`DriverTripCard`) now run in `staticMode` using native `<Image />` with markers. Zero WebViews and zero WebGL contexts mounted on Home; full interactive maps remain on `/trip/[id]`. |
| 2 | **Heavy 4-layer multi-blur inset `boxShadow` on Android** | `components/home/materials.js` | Optimized molded clay recipe on Android Fabric to 2-pass shadow (1 drop-shadow + 1 inset highlight), cutting Skia blur passes in half without compromising claymorphism or breaking tests. |
| 3 | **Redundant hardware GPS watcher** | `app/(app)/(tabs)/index.js` | Replaced `useTripTracking` (which spawned continuous `Location.watchPositionAsync` listener every 10m) with direct read from `usePosterStatus()`. |
| 4 | **`removeClippedSubviews` scroll hitching** | `app/(app)/(tabs)/index.js` | Removed `removeClippedSubviews` from `<ScrollView>` to stop Android from tearing down and rebuilding native card surfaces during scrolling. |
| 5 | **Mount-time duplicate render** | `app/(app)/(tabs)/index.js` | Initialized `nowMs` with `Date.now` and eliminated `setTimeout(tick, 0)` duplicate render on mount. |
| 6 | **Unmemoized stop nodes** | `components/home/DriverHomeCards.jsx` | Memoized `stops` array inside `DriverTripCard` via `useMemo`. |

**Route preview follow-up (2026-09-19):** Home's static-image optimization showed the
pickup/drop-off map but could not draw the road route. The primary Home card now uses
the existing deferred TomTom WebView route renderer. The later October 3 direction
restored road previews on upcoming cards as well. As of October 21, applicable cards
retain their road previews while Home is active and omit the preview renderers when
Home is hidden/backgrounded. The official TomTom Static Image endpoint documents
map-section parameters only, so endpoint-only static maps cannot replace these routes.

**Verification:**
- Vitest: 14 test files / 104 tests passed (`npm test -- mobile/lib`).
- ESLint: 0 errors, 0 warnings across all touched files.
- Export: `npx expo export --platform android` succeeded (1,356 modules, 5.16 MB bundle).

---

## Changes Applied — Round 4 (2026-09-10, Comprehensive Claymorphism Design Language Rollout)

Universal mobile UI overhaul establishing tactile **Claymorphism** design language across the driver companion app, modeled after the Home screen's tactile aesthetic.

### 1. Reusable Clay Primitives (`mobile/components/clay/`)
- `ClayCard.jsx`: Raised tactile card surface with light/dark adaptive shadows (`clayMaterials`), linear gradient top sheen, press scale micro-interaction (`0.985`), and variant presets (`standard`, `compact`, `hero`, `accent`, `flat`).
- `ClayButton.jsx`: Puffy tactile action control with directional light highlight / bottom shade (`raisedControl`), press scale (`0.98`), accessibility roles, loading indicator, and semantic variants (`primary`, `secondary`, `tonal`, `danger`, `outline`).
- `ClayTile.jsx`: Tactile icon tiles with 3 discrete sizes (`sm`: 38px, `md`: 48px, `lg`: 56px), clay corner radii, and theme-adaptive foreground/background.
- `ClayBadge.jsx`: Tactile status pills with tone support (`primary`, `success`, `danger`, `warning`, `info`, `neutral`), optional status dot or icon, and `pillEdges` highlight strip.
- `ClayInput.jsx`: Molded clay form input with light/dark directional borders, focus states, left icon, and right interactive toggle (e.g. password visibility).
- `ClaySection.jsx`: Grouping container with uppercase header label and tactile card container.
- `mobile/lib/clay.js`: Centralized helper functions (`raisedControl`, `pillEdges`, `clayMaterials`) ensuring style-key parity between light and dark themes to prevent Android Dark→Light theme ghost borders.

### 2. Full Screen Migration Across App Routes
- **Core Tabs:**
  - `(tabs)/index.js`: Existing Home benchmark preserved; weather chip and hero card verified.
  - `(tabs)/map.js`: Converted top weather chip, TomTom map controls, bottom navigation card, and status chips to Clay primitives.
  - `(tabs)/trips.js`: Full tactile conversion of trip queue cards, filter tabs, stats badges, and empty states.
  - `(tabs)/history.js`: Converted search input (`ClayInput`), filter chips (`ClayBadge`), and past trip cards (`ClayCard`).
  - `(tabs)/notifications.js`: Converted notification filter segments, alert cards, and empty states.
  - `(tabs)/profile.js`: Converted profile header avatar tile, menu groups (`ClayMenuRow`), and sign-out button.
  - `(tabs)/vehicle.js`: Converted vehicle specifications card, quick stats tiles, and maintenance alerts.
  - `(tabs)/_layout.js`: Converted center scan FAB with `raisedControl` and tactile press physics.
- **Trip Lifecycle:**
  - `trip/[id].js`: Converted trip summary hero, action bar, address tiles, route timeline, and odometer modal.
  - `trip/complete.js`: Converted completion card, Lottie container, issues card, and return button.
  - `trip/override.js`: Converted override authorization form, reason inputs, and approval cards.
- **Operations & Safety:**
  - `inspection.js`: Converted 7-point checklist items, pass/fail tactile controls, and submit button.
  - `fuel-report.js`: Converted assigned vehicle card, fuel request card, method picker, refuel inputs, and camera scan CTA.
  - `incidents.js`: Converted vehicle card, category grid tiles, severity chips, live location card, assistance chips, and submit CTA.
  - `incident/[id].js`: Converted status header, incident details card, timeline steps, and resolution notes.
  - `incident/navigate.js`: Converted rescue navigation card, status badge, ETA stats, manual arrival fallback, and open maps CTA.
  - `submissions.js`: Converted submission log cards, dead-letter banner, filter tabs, and empty states.
  - `work-schedule.js`: Converted segmented selector, hero banner, schedule table, leave balance chips, leave form, and request cards.
- **Settings & Profile Sub-pages:**
  - `settings.js`: Converted theme selector, font size selector, high-contrast toggle, and about section.
  - `devices.js`: Converted session cards, device tiles, and revoke buttons.
  - `profile/personal.js`: Converted driver info card, phone editor input, and navigation links.
  - `profile/license.js`: Converted license details card, status badge, and photo capture / scan CTA.
  - `profile/vehicle.js`: Converted assigned vehicle card, image container, and specifications list.
  - `profile/privacy.js`: Converted data privacy consent card, consent status badge, and expandable policy sections.
  - `profile/permissions.js`: Converted app controls card, device access permission rows, status pills, and toggle buttons.
  - `profile/about.js`: Converted app version card, platform specs, and branding tiles.
  - `profile/help.js`: Converted FAQ accordion cards, contact support CTA, and help center tiles.
- **Auth & Onboarding:**
  - `login.js`: Converted branding logo tile, login card wrapper, username/password/mfa inputs (`ClayInput`), and login button (`ClayButton`).
  - `consent.js`: Converted security shield tile, policy cards (`ClayCard`), terms checkbox card, and confirm CTA (`ClayButton`).
  - `permissions.js`: Converted device permission cards, status badges (`ClayBadge`), and enable CTA (`ClayButton`).

### 3. Verification & Regressions Guard
- **Zero Logic/API Impact:** Tracking loops (`useActiveTripGpsPoster`), offline queue (`sync.js`), auth refresh token rotations, and trip state machines left completely untouched.
- **Unit Testing:** 15 test files / 108 tests passing (`npx vitest run mobile/lib`).
- **Code Quality:** Zero ESLint warnings across the entire mobile codebase (`npx eslint "mobile/components/clay" "mobile/lib/clay.js" "mobile/app" --max-warnings 0`).

---

## Changes Applied — Round 5 (2026-09-10, Molded Inset Claymorphism Upgrade)

Aesthetic elevation replacing legacy directional borders (`borderTopWidth`, `borderBottomWidth`, `#FFFFFF75`, `#00000012`) across all reusable components with the Home screen notification bell's tactile dual-pass `boxShadow` (warm amber ambient drop-shadow + crisp specular inset highlight).

### 1. Engine & Primitive Upgrades
- `mobile/components/clay/molded-materials.js`:
  - Implemented `moldedMaterials(isDark)` with Fabric / Android 10+ / Web detection and memoized cache per scheme.
  - Light mode: warm amber shade `rgba(83,74,53,0.20)` + specular highlight `inset 1px 2px 4px rgba(255,255,255,0.92)`.
  - Dark mode: deep contrast shade `rgba(0,0,0,0.48)` + subtle whisper highlight `inset 1px 2px 4px rgba(220,240,229,0.07)`.
  - Exported recipes: `clayShade`, `compactShade`, `clayTile`, `clayButton`, `clayPill`, `clayInput`.
  - Guaranteed strict style-key parity between light and dark modes to prevent Android theme-switch ghost borders.
- `mobile/components/clay/ClayTile.jsx`: Converted to `mats.clayTile` (matching the notification bell).
- `mobile/components/clay/ClayCard.jsx`: Converted standard, hero, and compact cards to `mats.clayShade` / `mats.compactShade`.
- `mobile/components/clay/ClayButton.jsx`: Converted raised buttons to `mats.clayButton`.
- `mobile/components/clay/ClayBadge.jsx`: Converted status pills to `mats.clayPill`.
- `mobile/components/clay/ClayInput.jsx`: Converted input containers to `mats.clayInput` with recessed inset highlights and focused/error border states.
- `mobile/components/WeatherChip.js`: Upgraded outer chip to `mats.clayPill` and inner `iconDisc` to `mats.clayTile` for visual harmony with the adjacent notification bell in `DriverHomeHeader`.
- `mobile/app/(app)/(tabs)/_layout.js`: Fixed unclosed `<Tabs.Screen />` syntax for `fuel_action`.
- 2026-09-10: Fixed tab-bar crash — center scan FAB style referenced bare `raised` (undefined) instead of the imported `raisedControl(isDark)` function from `mobile/lib/clay.js`; every tab render threw `ReferenceError: Property 'raised' doesn't exist`. One-line fix, ESLint clean.

### 2. Verification
- **Unit Testing:** 16 test files / 112 tests passing (`npx vitest run mobile/lib`), including newly added `mobile/lib/molded-materials.test.js`.
- **Code Quality:** Zero ESLint errors or warnings (`npx eslint "mobile/components/clay" "mobile/components/WeatherChip.js" --max-warnings 0`).
- **Production Bundle:** Expo Android bundle compiled cleanly (`npx expo export --platform android` in `mobile/`, 1,364 modules, 5.13 MB Hermes bundle).

---

## Changes Applied — Round 6 (2026-09-10, Visual Polish & Theme Balance Pass)

Addressing the comprehensive mobile UI audit of Work Schedule, Leave Requests, Settings, Refuel Log, and Activity Logs:

### 1. Contrast & Theme Balance Fixes
- `mobile/app/(app)/work-schedule.js`:
  - **Hero Card Contrast:** Replaced white-on-ivory / teal-on-charcoal text failure with a solid Forest Green brand card (`isDark ? '#1B473A' : colors.primary`) and guaranteed high-contrast white text (`#FFFFFF` title, `rgba(255,255,255,0.75)` eyebrow, `rgba(255,255,255,0.90)` body, white icon tile).
  - **Segmented Control:** Replaced skeuomorphic beveled trough with a modern iOS/Linear pill container (`backgroundColor: colors.surfaceContainer`, 4px padding, clean active pill in `colors.primary`).
  - **Day Rows & Time Badges:** Removed puffy 3D `ClayBadge` from all 7 day rows; replaced with clean architectural `timeBadge` containers (`IBMPlexMono` font, flat surface container, 1px subtle stroke).
  - **Today Row:** Rounded highlight corners (`borderRadius: 10`, horizontal inset) and proper `tone="primary"` badge.
  - **Leave Type Selector:** Removed `raisedControl` bottom drop-shadows on unselected options ("Personal", "Medical"), restoring correct visual affordance.
  - **Header Polish:** Removed redundant decorative calendar tile from header.
- `mobile/app/(app)/settings.js`:
  - Converted theme selector to modern segmented pill container.
  - Added explicit high-contrast `trackColor` (`colors.surfaceContainerHighest` / `colors.primary`) and `thumbColor` to `Switch`.
  - Scaled settings row icon tiles to `size="sm"` with `variant="surface"`.
- `mobile/app/(app)/fuel-report.js`:
  - Fixed assigned vehicle card stray blue dot: corrected prop `<ClayBadge label="ASSIGNED VEHICLE" tone="info" statusDot />`.
  - Harmonized "Scan receipt" CTA card: primaryContainer background, 1.5px accent border, and high-contrast white scan icon tile.
- `mobile/app/(app)/submissions.js`:
  - Fixed `getBadge` mapping to pass semantic `tone` and `statusDot` (`success`, `primary`, `danger`, `warning`).

### 2. Component Primitive Resilience
- `mobile/components/clay/ClayBadge.jsx`: Added fallback support for `text`, `variant`, `dot`, and `dotColor` props to guarantee graceful rendering across legacy and third-party call sites.
- `mobile/components/clay/ClayTile.jsx`: Added `variant` support (`primary`, `secondary`, `danger`, `surface`) with auto-contrasting foreground icon colors.

### 3. Verification
- **Unit Testing:** 16 test files / 112 tests passing (`npx vitest run mobile/lib`).
- **ESLint:** 0 errors, 0 warnings across all touched components and screens.

## Quick-Action Responsiveness Plan — 2026-09-10 (complete: Tasks 1–6 of 6; on-device timing pending)

Driver report: tapping a Home quick action has a small delay before the destination opens. Diagnosis: `router.push()` waits on (a) destination bundle parse (fuel-report 60KB + camera stack is heaviest) and (b) fetch-before-paint (`api.get` in mount/focus effects) plus Home's own focus refetch racing the transition. Destinations already cache-first; the network revalidation just runs too early.
Plan: `docs/superpowers/plans/2026-09-10-quick-action-navigation-responsiveness.md` — (1) instant press feedback (scale 0.97 + pressed opacity; haptics deliberately omitted — expo-haptics not installed), (2) prefetch the 4 routes on Home idle, (3) defer Home refetch off-transition with a 30 s staleness guard, (4) defer Schedule/Log revalidation behind `runAfterInteractions`, (5) defer Fuel vehicle/requests + lazy-load `expo-image-manipulator`, (6) verify tap→skeleton on a release build (dev timing doesn't count). No RBAC, offline-authority, or clay-language changes.
- **Implemented (all 6 tasks):** T1 instant press feedback — `QUICK_ACTION_PRESS` (`mobile/lib/quick-action-press.js`, scale 0.97 + pressed opacity 0.7; haptics deliberately omitted — expo-haptics not installed; 43a9704). T2 idle route prefetch — `QUICK_ACTION_ROUTES` (`mobile/lib/prefetch-routes.js`) pins the 4 shortcut targets, Home prefetches via `InteractionManager.runAfterInteractions` + `router.prefetch?.()` (0e01ca6). T3 deferred Home refetch — `shouldRevalidateHome` (`mobile/lib/home-revalidate.js`), 30 s staleness guard off-transition (64c38e7). T4 deferred Schedule/Log revalidation behind `runAfterInteractions` in `work-schedule.js` (`submissions.js` already deferred; 38124c3). T5 deferred Fuel vehicle/requests + lazy `expo-image-manipulator` in `fuel-report.js` (76ffc5b). T6 release-build verification + docs (this entry).
- **Verification 2026-09-10 (Task 6, clean HEAD worktree):** release bundle sanity `npx expo export --platform android` → 1,359 modules, 5.15 MB Hermes hbc, bundles clean (Task 6 clean-HEAD measurement, vs Round 5 baseline 1,364 modules / 5.13 MB recorded at :217 above; cwd: clean `HEAD` worktree `mobile/` — the main working tree has unrelated uncommitted hunks, incl. a broken `</ClayCard>` in `fuel-report.js`, that fail the bundler; that breakage is pre-existing WIP, not from Tasks 1–5). `npx vitest run mobile/lib` → 17 files / 107 tests PASS (incl. new `quick-action-press`, `prefetch-routes`, `home-revalidate` suites). ESLint `--max-warnings 0` on the 5 touched files → clean, no output.
- **On-device timing PENDING:** no Android SDK/device in this environment (`adb` absent, no `ANDROID_HOME`/`ANDROID_SDK_ROOT`), so `expo run:android --variant release` was not attempted — nothing here is verified on-device. Procedure for a device pass: release build on a mid-range Android, 60 fps screen recording, count frames press-ripple → destination skeleton; targets: feedback same-frame (<50 ms perceived), skeleton <300 ms.
- **Re-integrated & Enhanced 2026-09-12:** Re-wired the 4-route idle prefetch (`router.prefetch?.()`) and 30s deferred focus revalidation (`shouldRevalidateHome` + `runAfterInteractions`) into `index.js`, deferred network fetches on `work-schedule.js`, `incidents.js`, and `fuel-report.js` so native push transitions never wait on `api.get`, and added `LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)` to `HomeQuickActions` for smooth panel expansion. Verified clean across ESLint and all 19 `mobile/lib` tests (117/117).

## Changes Applied — Round 7 (2026-09-19, Launch Animation Startup Lag)

> **Superseded:** the car Lottie was **restored** on 2026-09-19 (see `Capstone/04 - Architecture/Mobile Architecture.md` § Launch Screen and `SYSTEM.md` "Mobile startup car animation restoration"); `launch-animation.test.js:37` now pins its inclusion. The 4.58 MB / no-car-asset figures below describe only the brief removal window and are not current.

The launch path was still hitching despite native-driver animations. Source inspection found the 512x512 car Lottie carried about 588 KB of embedded raster data and was decoded during the first overlay frame; the native splash also hid at font-ready time while the persisted settings provider could still render no shell.

| File(s) | Change |
|---|---|
| `mobile/components/LaunchScreen.js` | Removed the heavy car Lottie from startup; kept the dial, route track, wordmark, and static location beacon. Reduced the normal hold to 1.1 s and exit fade to 180 ms; reduced-motion behavior remains intact. |
| `mobile/app/_layout.js` | Hide the native splash after `ThemedApp` commits, preventing the blank handoff. Defer notification channel setup until the launch overlay exits and interactions settle. |
| `mobile/lib/launch-animation.test.js` | Pin the shorter timing and prevent the removed car Lottie from returning to the launch path. |

**Verification:** 22 mobile library test files / 135 tests passed; targeted ESLint passed; Android export succeeded with 1,376 modules, 79 assets and a 4.58 MB Hermes bundle, with no `car animation.json` asset. Physical-device FPS and cold-start acceptance remain pending; the export is a compile/bundle check, not an on-device FPS claim.

## Changes Applied — Round 8 (2026-09-22, Type-Scale References That Never Resolved)

Reviewing the uncommitted guide work turned up five call sites referencing type-scale steps that do not exist in `lib/theme.js`: `type.titleMd` (four) and `type.bodySm` (one). A style array **silently ignores an `undefined` entry**, so these rendered at the bare React Native default instead of failing loudly — no warning, no crash, no failing test. `permissions.js:37` was the worst case: its key was missing *and* the style it was paired with is only `{ flexShrink: 1 }`, so that title got nothing from either source.

| File(s) | Change |
|---|---|
| `mobile/app/(app)/(tabs)/profile.js` | Duty card title `type.titleMd → type.cardTitle`; photo-sheet blurb `type.bodySm → type.supporting`. |
| `mobile/app/(app)/devices.js` | Empty-state heading and session row title `type.titleMd → type.cardTitle`. |
| `mobile/app/permissions.js` | Permission row title `type.titleMd → type.cardTitle`. |
| `mobile/lib/theme-scale.test.js` | New guard: reads the scale out of `lib/theme.js` as source text and fails on any `type.<key>` outside it, naming the file, line and key. |

Each replacement is the nearest existing step in the same family rather than a new scale entry — `cardTitle` (16, bodySemiBold) for `titleMd`, `supporting` (14, body) for `bodySm` — so the seventeen-step scale stays the single source of truth. Eleven further sites in the then-uncommitted guide files used `titleMd`, `bodySm`, `labelSm` and `headlineSm`; those names never existed at HEAD, so they were corrected inside the commits that introduced them (`labelSm → labelMd`, `headlineSm → titleLg`).

**Verification:** the guard was proven to fail on an injected bad key before being trusted; full suite **2195 pass across 186 files**; `eslint --max-warnings 0` clean. See `Bugs.md`, seventh report.

---

## Changes Applied — Round 9 (2026-09-22, Performance Hardening)

Static re-analysis pass (source-level; no device in environment). Plan: `docs/superpowers/plans/2026-09-22-mobile-performance-hardening.md`. Scope revised during planning: the idle-duty-to-60s task was **dropped by user decision** (standby response must stay ≤30 s); duty GET cadence unchanged.

| # | Bottleneck | File(s) | Fix Applied |
|---|------------|---------|-------------|
| 1 | Outbox drain hit AsyncStorage (read + JSON.parse) after **every** API success — dead if/else, queue empty almost always | `lib/sync.js`, `lib/api.js` | In-memory `knownPendingCount` mirror + `hasPendingWork()` gate; fails open while unknown (cold start), converges on enqueue/drain/count. New `sync.test.js`. |
| 2 | Standby path published status **twice** per tick (`!tripId` trailing publish also covered standby) — duplicate re-render of every subscriber each 30 s | `lib/tracking.js` | Standby's publish carries `lastSentAt` itself; trailing publish narrowed to responder-only. |
| 3 | Offline outbox unbounded (one JSON array, storage-quota risk on long offline stretches) | `lib/sync.js` | Cap 100; oldest non-incident dropped with a warn; incidents never dropped (soft cap if all incidents). |
| 4 | Round 7 claims the car Lottie is removed; it was restored 2026-09-19 (doc/code mismatch) | this note | Round 7 marked superseded; code + `launch-animation.test.js` are source of truth. |

**Verification:** `npx vitest run mobile/lib` all green (incl. new `sync.test.js`: fail-open gate, enqueue/drain convergence, cap + incident exemption); ESLint `--max-warnings 0` on touched files; Android export: 1,401 modules, 79 assets and a 5.38 MB Hermes bundle (verbatim from `npx expo export --platform android`, 2026-09-23). On-device FPS / cold-start: **not claimed** (no device).

**Analyzed, not fixed this round (2026-09-22 tap-delay review):** focus-fetches on trips/history/vehicle/profile fire synchronously with no staleness guard (Home's `runAfterInteractions` + 30 s pattern was never ported); `trip/[id]` revalidates `?status=all&limit=100` during the push transition; `notification-feed.jsx` calls `setNotifications(list)` unconditionally every 30 s (new array identity → header re-render). Likely secondary: dev-build timing (release build not measured). Deferred pending a release-build measurement.

**Deferred with triggers:** FlatList lists if any list routinely exceeds ~50 rows; server-side active-only filter for the 60 s trips GET if field payloads grow; coach-mark settling-tick pause pending its own provider read; TomTomMap.js only if a device profile implicates it.

---

## Changes Applied — Round 10 (2026-09-24, Pre-Shift Inspection UI Responsiveness & Back Button Fix)

Targeted polish pass on `mobile/app/(app)/inspection.js` following driver-side feedback: back button was pushed up into the device notch/status bar ("sobrang taas"), and the PASS button showed brownish secondary-container tint rather than the Forest Green brand color.

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| 1 | Back button pushed into notch — `styles.topBar` had a fixed `height: moderateScale(48)` that left zero inner height when `paddingTop: insets.top` was applied on notched devices (36–59dp) | `mobile/app/(app)/inspection.js` | Removed fixed `height: 48` from `styles.topBar`. JSX now uses `paddingTop: Math.max(insets.top, 16) + moderateScale(4)` so the bar grows as needed and the back button always sits comfortably below the status bar. |
| 2 | Back button had no tactile surface — bare circular pressable with no border or elevation gave no visual affordance | `mobile/app/(app)/inspection.js` | Upgraded `backBtn` to 40×40 squircle (`borderRadius: moderateScale(14)`, `borderWidth: 1`). JSX applies `borderColor: colors.outlineVariant`, ambient shadow elevation 3, and pressed-state feedback. |
| 3 | PASS button rendered brownish secondary-container tint (`#F1E7D6` Antique Brass) instead of brand Forest Green, and in dark mode suffered near-zero contrast due to dark `#103A30` text on dark green | `mobile/app/(app)/inspection.js` | When `isPass === true`: Light mode uses `backgroundColor: colors.primary` (`#285448`), `borderColor: colors.primary`, and `#FFFFFF` text/icon. Dark mode uses `backgroundColor: "#1E5647"` (rich Forest Green), `borderColor: "#3E8D75"` (emerald tactile edge), and `#FFFFFF` text/icon (>7:1 contrast ratio, WCAG AAA). Unselected buttons in dark mode gain `rgba(255,255,255,0.06)` border definition. Applied identically to both the `idx === 0` CoachMarkTarget branch and the `idx > 0` standard branch. |
| 4 | Top bar title was hardcoded "FleetOps" — unhelpful on this sub-screen | `mobile/app/(app)/inspection.js` | Title now reflects the current mode: `"Pre-Shift Check"` or `"Pre-Trip Check"`. Color changed from accent `primary` to neutral `onSurface` for clear hierarchy. |
| 5 | `styles.scroll` had `alignItems: "center"` which caused child cards to shrink or clip on narrow screens | `mobile/app/(app)/inspection.js` | Removed `alignItems: "center"` from scroll container; added explicit `width: "100%"` to `checkItem` so cards always fill the viewport width. |
| 6 | `styles.checkBtnText` was an empty object — label text had no typography, causing multi-word labels like "NO LIGHTS" to render at RN default weight | `mobile/app/(app)/inspection.js` | Added `fontSize: moderateScale(13)`, `fontWeight: "600"`, `letterSpacing: 0.3` so button labels are legible and consistent with the control-label design token. |

**Verification:** ESLint `--max-warnings 20` on `mobile/app/(app)/inspection.js` exits 0, no warnings. CoachMarkTarget bindings (`inspection.pass_fail`, `inspection.remarks`, `inspection.complete`) are structurally unchanged — all three IDs remain in their original positions. FAIL button behavior, remarks input, and submit logic are untouched.

---

## Changes Applied — Round 11 (2026-09-24, OTP Verification Screen Hierarchy & Clay Depth)

A hierarchy-first restructure of the mobile OTP step — **presentation only, verification behaviour frozen** — planned as `docs/superpowers/plans/2026-09-24-otp-redesign.md` from an approved 15-decision spec, implemented as 4 reviewed tasks on `feat/otp-redesign`.

| # | Issue | File(s) | Fix Applied |
|---|-------|---------|-------------|
| 1 | The auth brand block (`ClayTile` → title → tagline) was byte-identical across login / forgot-password / reset-password, so every screen re-maintained it | `mobile/components/auth/AuthHeader.jsx` (new) | Extracted as `<AuthHeader icon title tagline />` — brand block only, **no back button** (screens keep their own). All three screens now consume it; dead `brand`/`logoTile`/`appName`/`tagline` styles and unused `ClayTile` imports removed. Title 24→28 as specified. |
| 2 | OTP had no family brand block and two competing instructions (intro title + description *and* the pill) | `mobile/components/otp/OtpVerificationView.jsx` | Intro block replaced by `AuthHeader` (`shield-checkmark-outline` / "Verify your identity"), tagline = the **single** instruction with the mask inlined (``Enter the 6-digit code sent to ${masked}``) — exactly one instruction, no card info row. |
| 3 | **Root cause:** `resolveCellBg` returned the *identical* fill for filled and empty cells, so progress was only readable from the digits themselves | `mobile/lib/otp-cell-style.js` (new), `mobile/components/otp/OtpInput.jsx` | Recipe B — depth, not hue, carries progress: filled lifts to `surfaceContainerLowest`, empty carves to `surfaceContainerHigh`, mirrored light/dark; error/success keep their pre-existing tints; `focused` is deliberately not a parameter so focus can never introduce a third fill colour. Added a filled-only lift shadow (`shadowOpacity isDark ? 0.32 : 0.16`) so the lift reads even where the two fills sit close in value. |
| 4 | The 3\|4 group separator box was `width: 12` at `left: -12` in a `gap: 6` row — twice the slot, so the dash overran cell 3 | `mobile/lib/otp-cell-style.js`, `OtpInput.jsx` | New `OTP_DASH = { rowGap: 8, separatorLeft: -8, separatorWidth: 8, dashWidth: 7 }` — the box now equals the gap and the 7px dash fits with 0.5px clearance either side. |
| 5 | Footer was three rows (divider / expiry / "Didn't receive a code?" + resend), and the expired copy said "resend a new code **below**" only because resend was three rows down | `OtpVerificationView.jsx` | Collapsed into **one meta row** — expiry left, resend right, recovery below, **no divider**; expired copy shortens to `Code expired`. 12 dead styles removed, 5 `meta*` added at 14px/20. |
| 6 | Duplicate `notice` channel: `login.js` passed `notice={mfaNotice}` *and* the component set `infoMsg` itself for Resend | `OtpVerificationView.jsx`, `mobile/app/login.js` | `notice` prop removed and all four `mfaNotice` sites dropped **atomically in one commit**. `infoMsg` **stays as state**, only its seed changes to `useState(null)` — removing it would have silently silenced Resend. |
| 7 | App-tagline footer on the OTP branch failed WCAG AA at 4.41:1 on the light stage | `mobile/app/login.js` | OTP-branch footer `colors.outline` → `colors.onSurfaceVariant` = **6.21:1**. The form-branch footer copy of the same line **stays broken by explicit decision** (out of scope). |

Deliberately untouched: verification state machine, auto-submit, ≥500ms loader hold, transport-failure code retention, back clearing, resend/expiry timers, recovery path, the email mask contract (`otp-policy.js:104-105`, pinned by `otp.test.js`), card padding `18/14`, status band `minHeight: 26`, back button (already 44×44 / radius 14), and `src/` auth code.

**Verification:** `npx vitest run mobile/lib` **35 files / 395 tests** green (baseline unchanged by the refactors; +1 file / +6 tests from the new `otp-cell-style.test.js`, written TDD-first and confirmed failing before implementation; `otp.test.js` mask-parity pins green throughout); `npx eslint` on all 8 touched files `--max-warnings 0` exits 0. Note for future rounds: this repo's ESLint does **not** define `no-unused-vars`, so lint cannot catch an orphaned style or import — orphan sweeps must be greps (they were, and were clean). All four task reviews and a whole-branch review: **Approved**. Commits `72f7642`, `ee3575e`, `d00f974`, `f083b14`, `3767e85` on `feat/otp-redesign` (+227/−250 across 8 files).

**Still pending — device-only, not yet verified:** all four palettes (light / dark / HC light / HC dark) via Settings → Appearance; carved-vs-lifted legibility without reading digits; no stray mark over cell 3; error/success tints unchanged; focus ring + cursor present; one instruction and one meta row with no divider; reserved status band not moving the card; footer legibility in all four palettes; and the full frozen-behaviour list (auto-submit, ≥500ms hold, wrong-code shake + clear, network-kill keeps the code, back clears, resend resets both countdowns, cooldown→tappable Resend, recovery swap + return). Also flagged for a future AA sweep, **not fixed here**: the cooldown branch's `Resend in …` text still uses `colors.outline` (same 4.41:1 class, one line from the now-fixed footer).

---

## Modal & Overlay UI Audit — 2026-09-24 (findings only, no fixes applied)

Source-level audit of every modal-like surface in `mobile/`, requested as "analyze all the modal in mobile check if may problem sa ui". Inventory: **13 RN `<Modal>` usages in 11 files**, **3 fake modals** (absolute-fill `View` overlays that only look like modals), plus the custom coach-mark overlay system. No fixes were applied — this entry is the findings record; fixes are tracked in `Capstone/07 - Development/Bugs.md`.

### Inventory

| Surface | File:line |
|---|---|
| AppAlert (global dialog) | `components/AppAlert.js:142` |
| Pre-trip prompt | `components/MapIntroPractice.jsx:424` |
| Receipt scan tutorial | `components/coachmarks/simulation/ReceiptScanTutorialModal.jsx:84` |
| Fuel gauge tutorial | `components/coachmarks/simulation/FuelGaugeTutorialModal.jsx:70` |
| SOS dialog | `components/DriverSos.js:336` |
| Trip note / report issue | `app/(app)/trip/complete.js:436`, `:471` |
| Text-size picker | `app/(app)/settings.js:137` |
| License image viewer | `app/(app)/profile/license.js:266` |
| Odometer (Home) | `app/(app)/(tabs)/index.js:681` |
| Logout confirm / photo sheet | `app/(app)/(tabs)/profile.js:296`, `:335` |
| Odometer (Vehicle) | `app/(app)/(tabs)/vehicle.js:269` |
| **Fake modals:** tour-success overlays | `app/(app)/inspection.js:878`, `app/(app)/incidents.js:885`; incident report-success state `incidents.js:930` |
| Coach-mark overlay system | `components/coachmarks/CoachMarkOverlay.jsx` + `CoachMarkTooltip.jsx` + `CoachMarkProvider.jsx` |

No expo-router `presentation: "modal"` routes exist. `accessibilityViewIsModal` appears twice: `CoachMarkSimulationPanel.jsx:30` and the typed Critical confirmation in `app/(app)/incidents.js:850`.

### HIGH

1. **iOS keyboard covers every input-modal — no `KeyboardAvoidingView` inside any modal.** The four modals with `TextInput` (`trip/complete.js:436` and `:471` multiline, `index.js:681` numeric, `vehicle.js:269` decimal-pad with `autoFocus` at `:289` so the keyboard is already up on open) all render a centered card with buttons below the input and no keyboard accommodation. KAV exists only on full screens (login, fuel-report, incidents, end-duty, etc.). Android is partially saved by the default resize behaviour (`app.json` sets no `softwareKeyboardLayoutMode` override); iOS never auto-resizes, so the keyboard sits over the input and the Cancel/Confirm row.
2. **Both `trip/complete.js` modals omit `onRequestClose`** (`:436`, `:471`) — the only two of 13 RN modals without it. Android hardware back therefore cannot dismiss them and may navigate underneath the open modal (plus the RN dev warning). Every other modal wires it.
3. **Coach simulation panel is placed by a fixed 420dp height guess with no `maxHeight`/scroll** — `CoachMarkOverlay.jsx:824-829` positions with `Math.min(spotY+spotH+14, VIEW_H - safeBottom - 420)` while the panel's real content (`CoachMarkSimulationPanel.jsx:47-60`, incl. the 196dp scanner) already runs —460+dp, so the bottom crosses the home indicator on normal phones; on short viewports the top goes =0 (clipped above the notch). No `Math.max(safeTop+…)` floor.
4. **Coach tooltip card has no `maxHeight`, no ScrollView, no `flexShrink`** — `CoachMarkTooltip.jsx:329-339`. When the card is taller than `VIEW_H - safeTop - safeBottom` (short screens, large font scale), the placement clamp at `CoachMarkOverlay.jsx:799-805` pins to `safeTop+10` and the card runs off the bottom — **Next/Skip become unreachable**.

### MEDIUM

5. **Three existing fake modals are plain `absoluteFill` Views, not RN Modals** — `inspection.js:878`, `incidents.js:885`, `incidents.js:930`. Consequences: Android back pops/navigates the screen while the overlay is still up; no accessibility modality (TalkBack reads through to the content behind); no `onRequestClose` at all. Overlay zIndex also inconsistent (999 in inspection vs 100 in incidents).
6. **Pre-trip prompt is an escape-less trap on iOS** — `MapIntroPractice.jsx:424` has a single CTA (`:447-463`, pushes `/inspection`), a backdrop that is a plain `View` (no tap-dismiss, `:430`), and `onRequestClose` (`:428`) which is Android-only. On iOS the only way out is to navigate into the inspection screen.
7. **`statusBarTranslucent` on only 2 of 13 modals** — `AppAlert.js:146` and `profile.js:339` only. The other 11 leave the Android status bar undimmed and the modal window starting below it: a visible bright seam above every dialog, most jarring on the `license.js` black image viewer (`viewerContainer` at `:334`).
8. **AppAlert dismissal/overflow quirks** — Android back runs `dismiss(null)` (`:147`), closing even destructive-confirm alerts without any button action; the message body has no `maxHeight`/scroll (only `maxWidth: 290`, `:348-356`) so very long server messages can push the button row off small screens (the `centred` container at `:264` has no scroll); button labels are `numberOfLines={1}` (`:237`) so a long label truncates instead of wrapping.
9. **Tap-outside dismissal is inconsistent: 1 of 13.** Only the photo sheet's backdrop is pressable (`profile.js:342-348`, with correct `stopPropagation` on the sheet content). The other 12 backdrops are plain `View`s — tapping outside does nothing, Cancel/back only. Reasonable for AppAlert/SOS, surprising for dialogs like text-size/odometer/note.
10. **Coach dark-mode/high-contrast bypass + neon ring** — card/panel surfaces hardcode `#17221D`/`#FFFFFF` (`CoachMarkTooltip.jsx:41`, `CoachMarkOverlay.jsx:967`, `CoachMarkSimulationPanel.jsx:22`) instead of palette tokens, so `highContrastDark` (which forces pure black + white borders, `lib/theme.js:206-221`) never applies; the dark contour ring is neon `rgba(74, 222, 128, 0.85)` (`CoachMarkOverlay.jsx:940`) against the file's own no-neon rule; scrim ignores `colors.scrim` (`:540`).
11. **Coach safe-area gaps** — the centered Welcome/geometry-fallback card applies zero insets (`CoachMarkOverlay.jsx:586-600`, `centerCardWrap` `:1033-1037`), sitting under the notch on short cards; targeted tooltip clamps themselves are fine (`:789-806`).
12. **Coach SOS bubble primary button is under the 44dp minimum** — `minHeight: moderateScale(32)` + `hitSlop 4` = 40dp effective (`CoachMarkTooltip.jsx:465`, `:265`) — on an emergency flow.
13. **Coach placement: card can cover the hole it describes** — when neither side fits, the top branch pins at `safeTop+10` while the hole sits below (`CoachMarkOverlay.jsx:645-646`, `:797-806`); the bottom branch avoids this, the top branch does not. Floating-bubble docks can also overhang ~2dp (gate requires `space = bubbleWidth + 8` at `:663-665` but placement adds `+10` at `:685`/`:710`).
14. **Coach first-frame height guess** — `DEFAULT_CARD_HEIGHT = 200` (`CoachMarkOverlay.jsx:34`, used `:102`, corrected only after `onMeasure` `:1001`) ? visible jump when the real card is much taller.

### LOW

15. Cross-modal visual inconsistency: backdrop alpha spans 0.45–0.72, corner radius 20–30, maxWidth 350/360/380/400/420 with no shared dialog primitive.
16. Decorative `zIndex: 9999` inside RN Modals is a no-op (`MapIntroPractice.jsx:601`, `ReceiptScanTutorialModal.jsx:273`) — noise for future readers.
17. `FuelGaugeTutorialModal.jsx:67` `if (!visible) return null` is redundant in front of `<Modal visible={visible}>`.
18. Tutorial cards (`ReceiptScan` 270dp viewfinder + chrome, `FuelGauge`) have no `maxHeight`/scroll — currently mitigated by `"orientation": "portrait"` in `app.json:7`, still tight under large font scale.
19. Demo `skipLink` 40dp with no `hitSlop` (`FuelReceiptScanDemo.jsx:653-657`).

### What is fine (checked, no issue)

Settings text-size modal (small, centered, `onRequestClose`); profile logout dialog; photo sheet (the one correct tap-outside pattern + `onRequestClose` + `statusBarTranslucent`); license viewer close affordance (44×44, `insets.top`, absolute-fill tap-to-close, `onRequestClose`); DriverSos close/back handling and `TOUCH_TARGET` buttons; `trip/complete` and Home/vehicle modal card centering (`flex: 1` overlays); most modals correctly use theme tokens with `isDark` branches; overlay dark-mode text/CTA fills use palette tokens throughout.

### Verification

Read-only audit: `grep` inventory of `<Modal`, `onRequestClose`, `statusBarTranslucent`, `KeyboardAvoidingView`, `accessibilityViewIsModal` across `mobile/`, plus full reads of all 13 modals, the 3 fake modals, their style blocks, `app.json`, and the coach-mark overlay/tooltip/provider/simulation files (two explore-agent passes for the coach-mark system). No code was changed; no tests run (nothing to run). Device confirmation of any finding pending.

---

## Changes Applied — Round 12 (2026-09-24, Modal polish: logout size, status-bar seam, tap-outside, dark-mode tokens)

Follow-up fixes to the "Modal & Overlay UI Audit — 2026-09-24" findings above, on user request ("fix that and this Status bar seam, tap-outside, dark mode"). Four defect classes, 13 files touched:

| # | Issue (from the audit) | Fix applied |
|---|---|---|
| 1 | Logout confirm read oversized — `width: 100%` with **no `maxWidth`** (siblings cap at 350–380) and a 64dp medallion; absurd on tablet (`supportsTablet: true`) | `profile.js` `modalCard` gains `maxWidth: 360`; icon medallion 64?56 (radius 32?28), icon glyph 26?24 |
| 2 | **Status-bar seam**: `statusBarTranslucent` on only 2/13 modals — Android status bar stayed bright above the dimmed backdrop | Added `statusBarTranslucent` to the other **11 RN Modals** (`MapIntroPractice`, `ReceiptScanTutorialModal`, `FuelGaugeTutorialModal`, `DriverSos`, `trip/complete` —2, `settings`, `license`, `(tabs)/index`, `profile` logout, `(tabs)/vehicle`). All 13 now carry it. iOS ignores the prop — no behaviour change there |
| 3 | **Tap-outside inconsistent (1 of 13)**: backdrops were plain `View`s | Six dialog backdrops are now `Pressable` with an absorb wrapper (`modalAbsorb`, `stopPropagation` — the pattern `profile.js`'s photo sheet already used) so tapping the card itself does **not** dismiss: settings text-size, trip note, trip issue, Home odometer (via `closeOdometerModal`, which already guards `odometerSaving`), Vehicle odometer, logout confirm, **and the pre-trip prompt** — the last of which also closes the audit's "escape-less trap on iOS" finding, since backdrop tap is now an exit that does not depend on the Android-only `onRequestClose`. **Deliberately skipped:** AppAlert (alert semantics — backdrop never dismisses these), DriverSos (emergency dialog), the two tutorial modals (they already have an explicit X) |
| 4 | **Dark mode / neon hardcoded**: coach surfaces `#17221D`/`#FFFFFF` bypassed the palette (so `highContrastDark` never applied); dark contour ring and welcome/approval badges used neon `rgba(74, 222, 128, —)` against the overlay file's own no-neon rule; scrim ignored `colors.scrim` | Card fills ? `colors.surfaceContainerLow` (ClayCard's own default, `ClayCard.jsx:35`) in `CoachMarkTooltip` `cardBg` (arrows read the same token, continuity kept), `CoachMarkOverlay` handoff cue, `CoachMarkSimulationPanel`; tutorial modals (`ReceiptScan`, `FuelGauge`) and the pre-trip prompt **drop their hardcoded overrides** and take ClayCard/theme colour. Spotlight ring ? `colors.edge + (isDark ? "D9" : "E6")`; welcome badge + fuel-approval tint ? `colors.primary` hex-alpha (`1F`/`14`, `40`/`26`); scrim ? `colors.scrim + (isDark ? "C2" : "A6")` (same 0.76/0.65 densities as before, identifier `scrimBg` kept because `coach-marks.test.js:1474` counts it) |

Also while touching the two `trip/complete.js` Modal tags: they gained the `onRequestClose` they were missing (Android back now dismisses note/issue properly) — closing the audit HIGH #2 / Bugs.md entry.

**Not fixed in this round (still OPEN):** iOS keyboard-over-input in the four input-modals (needs `KeyboardAvoidingView` work), coach simulation-panel/tooltip `maxHeight`+scroll (audit HIGH #3–4), the three fake `absoluteFill` "success modals", `statusBarTranslucent` seam is fixed but the **fake modals still are not RN Modals**, and the LOW items (cross-modal radius/alpha inconsistency, no-op `zIndex: 9999`, demo skipLink hitSlop).

**Verification:** `npx eslint` on all 13 touched files `--max-warnings 0` ? clean (one intermediate JSX closing-tag mismatch in `MapIntroPractice.jsx` found by lint and fixed before the green run); `npx vitest run mobile/lib` ? **35 files / 395 tests PASS** (includes `coach-marks.test.js` source-text assertions and `theme-scale.test.js`). Greps: `statusBarTranslucent` = 13/13 modals; live `rgba(74, 222, 128` matches = only the explanatory comment in `CoachMarkOverlay.jsx`; `isDark ? "#17221D"` / `"#141D19"` card fills = 0. **Not device-verified** — Android status-bar dim, tap-outside feel, tablet logout width and the four palettes (light/dark/HC-light/HC-dark) still need a device pass.

---

## Changes Applied — Round 13 (2026-09-25, Driver Onboarding Overhaul: Data Privacy & App Permissions)

Rebuilt the two-step driver onboarding flow (`mobile/app/consent.js` and `mobile/app/permissions.js`) to precisely adopt the specification mockup (`media_1790350688783.jpg`) while ensuring full dark mode and light mode responsiveness.

| # | Screen / Component | Work Implemented |
|---|---|---|
| 1 | `OnboardingHeader.jsx` | Shared brand header squircle tile (`FleetOps` / `DRIVER COMPANION`) + step counter badge (`1/2` and `2/2`), fully responsive to safe-area insets and theme tokens. |
| 2 | `PrivacyHeroIllustration.jsx` | 3D layered split-faceted emerald shield emblem (`#34D399` / `#10B981` / `#064E3B` in dark mode, `#3B7A68` / `#285448` in light mode), specular top sheen, checkmark icon, concentric topographic contour wave rings, radar accent nodes, and ambient radial glow. |
| 3 | `PermissionsHeroIllustration.jsx` | Perspective angled street grid lines, 3D smartphone chassis with speaker pill, mini route preview (screen road grid, route polylines, destination pin), and floating/orbiting sensor badges (Location pin, Camera, Car). |
| 4 | `OnboardingCard.jsx` | Tactile squircle tile card supporting left icon tiles, titles, descriptions, status badges (`Not asked`, `Approved`, `Denied`, `Blocked`), trailing chevrons, and interactive checkbox mode. |
| 5 | `mobile/app/consent.js` (Step 1/2) | Rebuilt with `OnboardingHeader`, `PrivacyHeroIllustration`, two-tone headline ("Driver Data Privacy"), 3 info cards (Location Tracking, Telematics & Vehicle Data, Data Retention), interactive Terms & Conditions checkbox card, and full-width glowing pill button ("Confirm & Continue →"). Submits to `POST /api/driver/me/consent` and advances to `/permissions`. |
| 6 | `mobile/app/permissions.js` (Step 2/2) | Rebuilt with `OnboardingHeader`, `PermissionsHeroIllustration`, headline ("App Permissions"), permission cards with live status chips, single-card tap trigger, and full-width glowing pill button ("Enable Permissions →"). Traverses permissions sequentially and advances to dashboard (`/`). |

**Verification:**
- ESLint `--max-warnings 0` on all components and screens (`mobile/components/onboarding/`, `mobile/app/consent.js`, `mobile/app/permissions.js`) exits 0 with 0 errors / 0 warnings.
- Unit tests (`npx vitest run mobile/lib`): **36 files / 403 tests PASS** (includes `theme-scale.test.js`, `import-contract.test.js`, and all mobile test suites).
- Dark and light mode token verification: Theme-adaptive background fills, card borders, typography contrast (>7:1 on dark mode CTA text and status badges), and glow drop shadows.

## 2026-10-03 — Guided incident severity dialog

The typed Critical confirmation in mobile/app/(app)/incidents.js is a React Native Modal with accessibilityViewIsModal, statusBarTranslucent, and onRequestClose, so Android Back closes the dialog and returns to the form. This adds a native modal for the Critical confirmation; the three existing tutorial/report-success absoluteFill overlays listed above remain unchanged. The new form and dialog compiled in the Android Expo export, but TalkBack, VoiceOver, and small-device layout still need manual acceptance.

---

## Changes Applied — Round 14 (2026-09-26, Premium Dark-Green Onboarding Image-to-Code Redesign)

Comprehensive redesign of the FleetOps Mobile Onboarding flow (`mobile/app/consent.js` and `mobile/app/permissions.js`) to precisely match the user's reference mockup (`media_1790405542000.jpg`) as real React Native / Expo components, responsive on smaller Android devices.

| # | Screen / Component | Work Implemented |
|---|---|---|
| 1 | `onboardingTheme.js` | Dedicated design tokens for the onboarding aesthetic: deep emerald stage (`#031B1B` / `#021414`), surface `#0B2728` with subtle border `rgba(120, 224, 210, 0.18)`, icon tiles `#143C3A` with glowing mint border, text ladder (`#F4FAF8` / `#B9CFCA` / `#8FA9A4`), and status chips (`Approved` in `#114438`/`#55D4A7`, `Not asked` in `#133838`/`#A5CAC3`, `Denied` in `#3B1A1E`/`#F2A39C`). |
| 2 | `OnboardingBackground.jsx` | Full-screen container with deep green background `#031B1B`, top-right `map-bg.png` overlay (opacity 0.28, `pointerEvents="none"`), and safe-area top inset support. |
| 3 | `OnboardingHeader.jsx` | Responsive brand header: left squircle logo badge with `car-sport` icon, "FleetOps" display title, letter-spaced "DRIVER COMPANION" subtitle, and right step indicator pill badge (`1/2` and `2/2`). Automatically scales down padding, fonts, and squircle dimensions when `height < 740` (compact mode). |
| 4 | `OnboardingCard.jsx` | Modular info and permission card: squircle icon tile (50×50 normal, 42×42 compact), semi-bold title, secondary description, optional status chip with checkmark icon for "Approved", trailing chevron `›`, and pressable interaction support. |
| 5 | `OnboardingConsentRow.jsx` | Terms & Conditions row: styled squircle checkbox (24×24, rounded 7, mint checkmark when checked), responsive legal copy, and trailing chevron `›`. Entire row is accessible with `accessibilityRole="checkbox"`. |
| 6 | `OnboardingButton.jsx` | Full-width pill CTA button (height 54 normal, 48 compact, radius 999): vibrant mint/aqua gradient (`#88EED2` to `#52D4D0`) with dark pine text (`#032623`) and arrow icon when enabled; solid dark teal (`#173C38`) with muted text (`#45726B`) when disabled; activity indicator support during submission. |
| 7 | `mobile/app/consent.js` (Step 1/2) | Driver Data Privacy screen: centered 3D privacy shield asset (`privacy-shield.png`, 90×90 normal, 72×72 compact), two-tone headline ("Driver Data" in mint, "Privacy" in white), 3 info cards (Location Tracking, Telematics & Vehicle Data, Data Retention), consent row, and sticky bottom CTA ("Confirm & Continue →"). Fully preserves `POST /api/driver/me/consent` and navigation to `/permissions`. |
| 8 | `mobile/app/permissions.js` (Step 2/2) | App Permissions screen: top-right map lines overlay (`map-bg.png`), centered hero illustration asset (`permissions-hero.png`, 120×120 normal, 95×95 compact), two-tone headline ("App" in mint, "Permissions" in white), live permission cards (Location, Background Location, Camera, Photo Library) with dynamic status chips, single-card tap to request, and sticky bottom CTA ("Enable Permissions →"). Traverses permissions and navigates to `/`. |
| 9 | `onboarding-theme.test.js` | Unit test suite verifying all onboarding tokens, asset presence, and status mappings. |

### Device Feedback & Refinement Pass (from screenshots `media_1790407818546.png` and `media_1790408775900.png`):
- **Card Container Style Fix:** Fixed `OnboardingCard.jsx` where `<View>` received a functional `style={({ pressed }) => ...}` prop when `onPress` was absent, causing React Native to drop all container styles (`flexDirection: "row"`, background, borders, padding) and revert to a vertical column. Statically computed array styles are now passed to `<View>`.
- **Hero Image Proportion Scaling ("Sakto Lang"):** Following device feedback that the hero image appeared dwarfed, scaled `permissions-hero.png` from 95×95 → **136×136** (compact: **112×112**), and `privacy-shield.png` from 72×72 → **98×98** (compact: **80×80**). Central smartphone screen, route polyline, and orbiting satellite sensor bubbles now command crisp visual focal weight without crowding the cards.
- **Permission Card Scope (4 Core Cards):** Filtered `PermissionsScreen` to the 4 spec cards (Location, Background Location, Camera, Photo Library), removing the trailing 5th card (Notifications) that was submerged behind the bottom CTA.
- **Card Surface Contrast & Alignment:** Elevated card background to `#0C2B29` with border `rgba(120, 224, 210, 0.22)` and glowing squircle icon tiles (`#123B38` with `rgba(87, 215, 212, 0.35)` border). ScrollView bottom padding tuned to `insets.bottom + 90`.

**Verification:**
- ESLint `--max-warnings 0`: Exits 0 across all onboarding components, screens, and test files.
- Vitest (`npm test -- mobile/lib`): **38 files / 407 tests PASS** (100% green, including `import-contract.test.js` and `onboarding-theme.test.js`).
- Expo Export (`npx expo export --platform android` in `mobile/`): Succeeded cleanly with 1,419 modules bundled into Hermes `entry-1fa7e38d645114cafd335b6888e0b455.hbc` (5.42 MB) including all 3 onboarding assets.



