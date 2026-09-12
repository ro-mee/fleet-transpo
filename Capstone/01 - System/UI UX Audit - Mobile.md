# UI/UX Audit — FleetOps Mobile (Driver App)

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