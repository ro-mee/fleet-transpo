# Mobile Profile & Settings — Claymorphism Implementation Plan

Date: 2026-09-09
Status: Implemented; automated checks passed. Native device acceptance remains pending.

## Scope

Extend the Home/Trips claymorphism direction to the **Profile tab and everything reachable from it**, per the owner's request: "apply it in profile nav lahat ng nandun pati sa loob ng settings apply the same ui." Styling-only — no data, permission, navigation, upload, or auth logic changes.

Screens covered (8): `(tabs)/profile.js`, `settings.js`, `profile/personal.js`, `profile/license.js`, `profile/vehicle.js`, `profile/safety.js`, `profile/help.js`, `devices.js` (Logged-in Devices, reached from Settings).

Visual authority: the current Trips/Trip Details implementation (30dp cards, 8dp-offset soft shadows with white top / shaded bottom edge strips, raised status pills radius 20, ≥48dp tactile CTAs radius 18–22, warm ivory background, forest primary, existing dark/high-contrast themes and fonts preserved).

## Shared pieces added

- `mobile/lib/clay.js` — pure constant module (no imports, vitest-safe): `clayShade`, `clayCard`, `clayPill`, `clayCta`. Values match trips.js/trip/[id].js, which keep their local copies.
- `mobile/components/ClayScreenHeader.jsx` — the Trip Details headerBar pattern as a component: raised 48dp circular back control (`surfaceContainerHigh` + shade), centered title, transparent over the background (no bottom border). Replaces the flat bordered headers on all seven sub-screens.

## Per-screen outcome

- **Profile tab** — identity block is now a raised clay card (avatar with edge highlights, name, status pill shown only when the profile actually carries a status); Account/General menus are one clay card per section with circular icon tiles per row, softened dividers, clay "New" badge; Sign Out is a clay error-outlined CTA (minHeight 48). Logout confirm modal restyled; all routes, `useDriverProfile`, `signOut` untouched.
- **Settings** — every section card is clay (radius 30, `surfaceContainerLow`); theme segment control's selected segment is a raised primary pill; Text Size modal is a clay card with clay CTAs; permission rows use a local clay status pill (`statusColorForTone`) and local clay primary/outlined CTAs with loading state — `components/ui.js` itself was NOT modified (other screens depend on it). Native Switches kept with theme colors. All permission machinery (refresh, AppState listener, reduce-motion-guarded LayoutAnimation, request flows, push permission gating) unchanged.
- **personal** — clay info card; phone edit uses a rounded `surfaceContainerHigh` input + 44dp clay circle save/cancel controls. PATCH `/api/driver/me`, reload, toast flow unchanged.
- **license** — clay info card with clay compliance pill (existing `daysUntilExpiry` tone map); scan boxes are raised inner clay panels (radius 24); Take Photo / Gallery are clay CTAs (minHeight 48); preview radius 18. Camera/gallery picker, ImageManipulator resize/compress, `/api/driver/license-scan` verify-and-save, toasts, full-screen viewer unchanged.
- **vehicle** — clay card for image + info rows; empty state on a clay card. No data changes.
- **safety** — clay consent card; GIVEN / NOT GIVEN is a clay pill. Copy unchanged.
- **help** — hero stays a plain centered block; CONTACT and FAQ are clay cards with circular icon tiles; FAQ LayoutAnimation expansion preserved.
- **devices** — SessionCards are clay cards with circular icon tiles; Sign Out is a clay error-outlined CTA with a revoke spinner; retry is a clay CTA. Fetch/revoke/alert/`clearAuth` logic unchanged.

## Verification

- Full mobile Vitest suite: **14 files / 102 tests passed** (no test changes needed — styling only; `clay.js` is import-free so it cannot break the runner).
- Targeted ESLint on all 10 touched/new files: clean.
- `npx expo export --platform android`: passed (Hermes bundle, output in `.expo/profile-review-export`).
- Diff review confirmed styling-only changes across the 8 screens (581 insertions / 429 deletions); no handler, route, API, permission, or state changes.
- Native device checks (visual widths, permission flows on-device, camera upload) remain pending — no device/emulator available this session. No commit created.

## Forest accent refinement (same day, owner request)

The theme's identity color is forest green, but the menu icons and the affirmative badges were using either neutral gray or the theme's tan `secondary` pair (`secondaryContainer` `#F1E7D6` — reads brownish). Owner asked for forest instead. Changed to the `primaryContainer` (`#DCE9E3` pale sage) + `onPrimaryContainer` (`#17382F` deep forest) pair:

- Profile menu icon tiles, Settings row icon tiles (theme/text-size/contrast/push/location/devices/permission rows), Help contact tiles, Devices icon tiles — forest tiles instead of neutral gray.
- Profile "New" badge and the driver status pill, and Safety's "GIVEN" consent pill — forest instead of tan. "NOT GIVEN" keeps the error pair (a real warning, not a brand accent).

Styling-only again; targeted ESLint and the mobile lib tests (93) passed after the change.

## Raised clay icon tiles (same day, owner request)

The forest icon tiles were flat colored circles. Added `clayTile` to `mobile/lib/clay.js` — a softer raised treatment scaled to sit inside a clay card without competing with it (1.5px white top-light edge, 2px shaded bottom edge, 3dp-offset soft shadow, elevation 2) — and applied it to every icon tile: Profile menu rows, Settings rows (theme/text-size/contrast/push/location/devices/permission rows), Help contact tiles, Devices session tiles. The Profile "New" badge, driver status pill, and Safety consent pill got the matching small pill shadow. Colors stay the forest `primaryContainer`/`onPrimaryContainer` pair; permission status pills keep their semantic tones. Targeted ESLint and the mobile lib tests (93) passed after the change.
