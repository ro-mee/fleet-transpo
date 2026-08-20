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