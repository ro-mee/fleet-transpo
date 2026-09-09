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

## Information architecture restructure (same day, owner request)

Date: 2026-09-09
Status: Implemented; automated checks passed. Native device acceptance remains pending.

### Goal and final structure

The owner asked to group related screens instead of the flat Profile list, add a privacy area, and add an About screen. Final approved structure:

```
Profile
├── Account
│   └── Personal Information      (details + phone edit, then rows → License & Compliance, Assigned Vehicle)
├── Privacy & Security
│   ├── Privacy & Consent         (new — read-only)
│   ├── App Permissions           (new — moved out of Settings)
│   └── Devices & Sessions        (retitled "Logged-in Devices"; entry moved out of Settings)
├── General
│   ├── Help Center
│   ├── About FleetOps            (new)
│   └── Settings                  (preferences-only: Display + Preferences)
└── Sign Out
```

### What shipped

- **`mobile/components/ClayMenuRow.jsx`** (new) — the Profile menu row extracted into a shared component (forest clayTile icon, ≥48dp row, softened divider, pressed/hover state). Used by `(tabs)/profile.js` and the Personal Information hub; no other row style invented.
- **`profile/personal.js`** — now a hub: below the details/phone card, a clay card with rows to `/profile/license` and `/profile/vehicle`. Phone PATCH flow unchanged.
- **`profile/privacy.js`** (new, replaces deleted `profile/safety.js`) — consent status card (GIVEN/NOT GIVEN clay pill, Date Accepted, Policy Version) plus a read-only accordion of the privacy policy & user agreement. **Single source of truth:** the policy text is `consent.policy` from the cached `/api/driver/me` payload (server-side `src/lib/consent/policies.js`); no mobile copy of the policy exists, so wording can never drift. Readable offline after one prior sync; if the profile was never synced, the screen says so honestly instead of inventing text. No second consent flow — the server-owned stale-version re-consent gate at login still applies.
- **`profile/permissions.js`** (new) — the app-permission management UI and machinery moved verbatim out of `settings.js` (tick cluster, expandable rows, request flows, AppState revive after device-settings trips, reduce-motion-guarded LayoutAnimation). Distinct from the first-run onboarding screen at `/permissions`.
- **`devices.js`** — retitled "Devices & Sessions" (header only); route, fetch/revoke/`clearAuth` logic unchanged.
- **`settings.js`** — now preferences-only (theme segment, text size, high contrast, push toggle with its permission gating, location toggle). The SECURITY and PERMISSIONS sections were removed with their machinery.
- **`app/consent.js`** — first-run gate summary wording reconciled with the authoritative `PRIVACY_POLICY`: location = live location while on duty (dropped the unsupported "between trips" claim); retention = "as long as you remain a driver and as required to meet legal and operational compliance obligations" (dropped the unsupported "90 days" claim); telematics card now names license details and attendance records per the policy's collection list. Flow, checkbox, POST, and navigation untouched.
- **`profile/about.js`** (new) — Logo component, App Version from `expo-constants`, a one-sentence description limited to functionality that verifiably exists (trips/navigation, incident reporting, fuel logging, pre-trip inspections, work schedule), and support rows reusing the Help Center contacts via `Linking.openURL`. No company history, statistics, or promises.
- Untouched: `mobile/lib/consent.js`, `mobile/lib/permissions.js`, `app/permissions.js` (onboarding), `license.js`, `vehicle.js`, `help.js`, and all backend/API/consent-acceptance logic.

### Owed before release

- **Support contacts are currently configured values, not verified ones** (`1-800-123-4567`, `support@fleetops.com` — Help Center and About both use them). Production verification is owed.
- Native device acceptance (permission flows on-device, visual widths, dark/high-contrast/large text) still pending — no device/emulator this session.

### Verification

- `npx vitest run mobile`: 14 files / 102 tests passed.
- Targeted ESLint on all 9 touched/new files: clean.
- `npx expo export --platform android`: passed (Hermes bundle).
- Grep: no remaining `/profile/safety` or "Logged-in Devices" references in `mobile/` (the `scripts/replace-alert.js` codemod list was updated too).
- No commit created.

## Mojibake cleanup (same day, owner request)

A focused encoding sweep of the entire `mobile/` source tree (every non-ASCII run attempted a CP1252→UTF-8 reverse decode) found corruption only in `mobile/app/(app)/(tabs)/map.js` — 11 CP1252-mojibake sequences across 9 lines, including three user-visible strings. Each was inspected in context and replaced only where the intended character was unambiguous; no global substitution, no other files touched, no behavior change:

- User-visible: "You are on duty • Waiting for assignments" (was `â€¢`), "NEXT TRIP · {time}" label (was `Â·`), "Pickup → Destination" template (was `â†’`).
- Comments: `≤` and `≈` in the GPS-jump-threshold comment, `→` in the background-tracking state comment, `—` in three comments/JSX comments.

Verified: re-scan of `mobile/` finds zero remaining decodable mojibake runs; git diff touches only the 11 intended lines; ESLint on map.js clean; mobile Vitest 102/102; `expo export --platform android` passed. SYSTEM.md left untouched (no documented behavior changed). No commit created.

## App Permissions hybrid + Settings trim + soft-destructive Sign Out (same day, owner request)

Date: 2026-09-09
Status: Implemented; automated checks passed. Native device acceptance remains pending.

### Design rationale

The OS, not FleetOps, owns Android/iOS permissions — the app can check, request, and open system settings (`mobile/lib/permissions.js`), but cannot revoke them. So the App Permissions screen must never present a device permission as an ON/OFF switch the app controls. The owner's approved design is a hybrid:

- **APP CONTROLS** — what FleetOps itself does with a capability. Genuine ON/OFF toggles: **Location Tracking** and **Push Notifications** (moved out of Settings). Each row shows its description while ON, "FleetOps will not use this feature while it is off." while OFF, and an always-visible `Device permission: <Approved/Denied/Blocked/Not asked>` line (tone-colored) so the OS state stays honest. The OFF wording never claims the permission was revoked.
  - Location Tracking ON → if the OS location permission is missing it is requested first; only a grant turns the setting on (blocked/denied paths explain and leave the setting off). OFF → `settings.locationTracking = false`; the OS permission is untouched.
  - Push Notifications ON → OS notification permission requested (same gating the Settings toggle had); OFF → setting off + `dismissAllLocalNotifications()`.
- **DEVICE ACCESS** — OS-level permission rows kept as status/manage (expandable, Allow / Open-device-settings CTAs, tick cluster): **Background Location, Camera, Photo Library**. Foreground location and notifications are *not* duplicated here — their device state lives under their app-control toggles. `mobile/lib/permissions.js` itself is unchanged.

### Settings

The push/location toggles moved out, so Settings is now **display-only**: Theme, Text Size, High Contrast. The empty PREFERENCES section was removed rather than kept for its own sake.

### Sign Out hierarchy

Profile's Sign Out is now a **soft destructive clay button**: full `errorContainer` surface (not a white center with a red outline), puffy clay edge strips (2px `#FFFFFF66` top-light, 2.5px `#00000016` shaded bottom over 1px `error + "24"` sides), a 34dp `error + "14"` icon tile with its own clay edges, `onErrorContainer` icon/label, soft 5dp shadow (elevation 3), 56dp min-height / 18 radius matching the clay control language, pressed = 0.985 scale + 0.92 opacity.

The logout confirm modal matches: a **raised clay card** (`clayShade` over `surfaceContainerLow`, radius 30) with a centered 64dp soft-destructive medallion (`errorContainer`, clay edges, logout icon), centered title/body, and clay CTAs — Cancel as a raised `surfaceContainerHigh` `clayCta`, Confirm as solid error-red `clayCta` carrying the actual destructive weight. So the hierarchy is: soft red clay to open the dialog, strong red clay inside it to confirm.

### Verification

- Targeted ESLint on `profile.js`, `settings.js`, `profile/permissions.js`: clean.
- `npx vitest run mobile`: 14 files / 102 tests passed.
- `npx expo export --platform android`: passed.
- On-device permission flows (toggle→OS prompt→status line, background-location row) remain pending — no device this session.
- No commit created.

## Compact density pass (same day, owner request)

The Profile tab was too tall for a normal phone viewport, forcing unnecessary scrolling. Density-only refinement — content, routes, icons, labels, fonts, and touch-target minimums unchanged:

- **Identity card**: 20px padding + 16 gap → 12px vertical padding, 12 gap — roughly 106px → ~92px (≈110px when the status pill is present, inside the 100–120px target). Avatar stays 64dp; name stays 20px.
- **Section rhythm**: scroll gap 22 → 14, label-to-card gap 10 → 6, top padding insets.top+20 → +12, bottom +40 → +24.
- **Cards**: radius 30 → 24, internal padding 8 → 4 vertical **+ 4 horizontal**, which also insets the row dividers from the card edges (dividers softened to `outlineVariant + "40"`).
- **Rows** (`ClayMenuRow`, shared with the Personal Information hub): paddingVertical 12 → 9 → **56px rows** (spec 56–64), icon gap 14 → 12, pressed-highlight radius 18 → 14. Icon tiles stay 38dp everywhere; labels stay 18px.
- **Clay depth**: `compactShade` (5dp offset, 0.15 opacity, radius 10, elevation 4) added to `mobile/lib/clay.js` — the same white-top/shaded-bottom edge language as `clayShade`, scaled down so the denser layout reads subtle instead of bulky. Modals keep full `clayShade` (an overlay earns more lift); content screens beyond the Profile area keep the reference depth.
- **Sign Out**: minHeight 56 → 52 (still ≥48dp touch target), marginTop 16 → 12.

Net effect: ~120–130px shorter; on a typical 6.5-inch phone the identity card, Account, Privacy & Security, and most of General are visible without scrolling, with only a short scroll to Sign Out on smaller devices.

**Refinement pass** (the requested extra pass): `compactShade` started as a local constant in profile.js and was promoted into `mobile/lib/clay.js` once three screens needed it. **Settings** and the **Personal Information hub** were harmonized to the same compact rhythm so the shared `ClayMenuRow` sits in identical frames everywhere: cards radius 30 → 24 with `compactShade` and 4px internal padding (inset dividers), row padding 20 → 12 with `moderateScale(9)` vertical (56px rows), dividers softened `outlineVariant + "55"` → `"40"`, scroll gap 22/24 → 14 and horizontal padding 18 → 16, Settings row labels bumped bodyMd → bodyLg to match the Profile menu rows. Settings' Text Size modal and Personal's phone save/cancel controls keep `clayShade`.

**Row label size, owner follow-up ("letters too big")**: the 18px (`bodyLg`) menu row labels were the oversized element. `ClayMenuRow` (Profile sections + Personal Information hub) and the Settings rows dropped to 16px `bodyMd` — the standard list-row size; the driver name (20px semibold), section labels (12px caps), and Sign Out (14px semibold) stay as they were, and the other Profile-area screens already used 14–16px.

Verified: targeted ESLint clean on all five touched files, mobile Vitest 14 files / 102 tests, `expo export --platform android` passed. On-device visual acceptance still pending. No commit created.
