---
type: architecture
title: Frontend
tags: [architecture, frontend, react, nextjs]
source:
  - src/app
  - src/components
  - package.json
last_verified: 2026-09-23
---

# Frontend

**61 pages** under `src/app/`, Next.js 16 App Router, React 19.2.4.

## Route groups — CONFIRMED

| Group | Audience |
|---|---|
| `(dashboard)/` | The five staff roles — fleet, drivers, dispatch, reservations, reports, settings |
| `(driver)/` | Driver web portal, mirroring part of the mobile app |
| `(auth)/` | Login |

Route groups `(name)` don't appear in the URL — they exist to give each audience its own layout.

## Data layer — CONFIRMED

| Concern | Library |
|---|---|
| Server state, caching, refetch | `@tanstack/react-query` |
| Tables (sort/filter/paginate) | `@tanstack/react-table` |
| Forms + validation | `react-hook-form` + `zod` via `@hookform/resolvers` |
| Client-only state | `zustand` |

**`zod` is used on both sides** — the same validation library that defines the integration contract validates the forms. Worth noticing: one schema language across the whole stack.

## UI — CONFIRMED

Radix UI primitives (17 packages) in the shadcn/ui pattern: unstyled accessible primitives wrapped in local components under `src/components/ui/`. Styling is **Tailwind v4**, which is **CSS-first** — there is no `tailwind.config.js`; configuration lives in the CSS via `@theme`. That trips people up coming from v3.

Charts: `recharts`. Maps: `leaflet` + `react-leaflet`. Motion: `framer-motion` (first used on the login surface, 2026-08-15).

**Add / Create page pattern (standardized 2026-08-17):** every record-creation page
uses the shared `HeroHeader` (`src/components/ui/hero-header.jsx`) as its top bar —
inverted-theme hero panel, icon, title, badge, description, and `Cancel`/primary
action buttons using the exported `heroButtonOutlineClass` / `heroButtonPrimaryClass`.
Below it, form sections live in `Card` components styled `rounded-3xl overflow-hidden`
with the floating `CARD_SHADOW` and a `bg-muted/20` header row
(`pb-3.5 border-b border-border/60`). Two shared primitives round it out:
`PageEntrance` (`src/components/ui/page-entrance.jsx`) fades the whole page up on
mount with the app's `[0.32,0.72,0,1]` ease under `MotionConfig reducedMotion="user"`,
and `StickyActionBar` (`src/components/ui/sticky-actions.jsx`) re-floats the same
Cancel/Save actions (automatically converting the inverted header classes to standard,
readable button styles for the non-inverted bottom bar) into a glass pill fixed to the bottom once the hero scrolls out
of view (IntersectionObserver sentinel, no scroll listener) — long forms never lose
their save button. `FloatingField` inputs get a soft primary focus ring.
Applies to `settings/users/new`, `reservations/new`, `drivers/new`,
`fleet/vehicles/new`, plus the shared `edit` variants of the last two.

**Form controls (same date, elevated 2026-09-23):** all floating controls in `src/components/ui/field.jsx`
share a single double-bezel `FloatingShell` — an outer tray (`p-[5px]`,
`bg-gradient-to-b from-border/70 to-border/30`, `ring-1 ring-border/70`) wrapping an
inner `bg-surface` core with a hairline inset highlight (`rounded-[11px] min-h-[42px]`,
`shadow-[inset_0_1px_0_rgba(255,255,255,0.55)]`); focus promotes the ring to the
primary hue with a soft glow, and `error` drives a `danger` ring + `AlertCircle` message.
The floating pill label bridges the seam. `FloatingSelect` is the design-system dropdown variant
wrapping Radix UI `Select` with a tactile trigger and `SelectItem` children (wired via `react-hook-form`
`Controller` on creation/edit pages such as `/drivers/new` and `/maintenance`).
All raw unstyled `<select>` elements and native OS combobox popups have been eradicated globally across
dashboard filters and forms (`/maintenance`, `/system/errors`, `/system/audit`, `/settings/ai`) in favor of
unified `Select` / `FloatingSelect` with glassmorphic menus (`bg-surface/95 backdrop-blur-md rounded-2xl border-border/80 shadow-2xl`,
theme-matching hover, active checks, and `.custom-scrollbar`). `DatePicker` and `DateTimePicker` triggers use the same
double-bezel tray for visual consistency, and their Month/Year selectors use `CalendarHeaderSelect` — an accessible
in-popover dropdown with smooth auto-scroll to the selected option, check indicators, rotating chevrons, and outside-click
dismissal that preserves the parent calendar popover state.

**Date-range floors on `DatePicker` (2026-09-23):** an optional `minAge` prop turns the picker
from a free calendar into a bounded one — the year list is capped at the legal-age
boundary year, the boundary year's later months are disabled in `CalendarHeaderSelect`
(new `disabledValues` prop), forward chevron navigation stops at the boundary, days past it
are unselectable, and the calendar **opens on the boundary year** rather than today (for a
birthdate, today is always out of range). The `Today` shortcut is withheld when `minAge` is
set, since it would only ever jump to an invalid date. `maxAge` bounds the oldest year
(default 80). The rule itself lives in `src/lib/validation/age.js`, not in the component —
see [[Driver Management]]. Without `minAge` the picker behaves exactly as before, so the
other ~16 call sites are unaffected. `DatePicker` also gained an `error` prop (danger ring +
`AlertCircle` message) so a validation failure is visible rather than silently blocking
submit.

**Tailwind v4 moved the important modifier — and the old form fails silently
(2026-09-23):** v4 parses importance as a **suffix** (`border-danger!`); the v3
leading form (`!border-danger`) is not a candidate it recognizes, so it emits
**no CSS and raises no error**. It reads as working code while doing nothing —
the worst failure mode available. Four such classes had accumulated on
`/settings/security`'s password fields, covering both the `invalid` and the Caps
Lock border; they were the only leading-`!` utilities in `src/`, and they were
removed. Prefer no `!` at all where `cn()` can do the job: `cn()` is
`tailwind-merge`, so a later conflicting class evicts the earlier one, and
`border-danger` alone drops `border-slate-200`. Mind the variants — a bare class
does *not* evict `dark:border-slate-800`, which wins on source order in dark
mode, so the dark counterpart has to be named explicitly.

**Pointer affordance (2026-09-23):** browsers give `<button>` `cursor: default`, so every
clickable control had to remember `cursor-pointer` by hand — and the ones that forgot read as
inert text. A rule in `globals.css` restores it app-wide for `button:not(:disabled)`,
`[role="button"]:not([aria-disabled="true"])`, `[role="tab"]`, `[role="menuitem"]` and
`[role="option"]`. It sits in **`@layer base`, not unlayered** — unlayered CSS beats Tailwind's
utilities, so an explicit `cursor-not-allowed` on a disabled control or `cursor-default` where
a pointer would be a lie would stop working. Per-component fixes alongside it: `SelectTrigger`
(the Sex/gender selector and every `FloatingSelect`), `TabsTrigger`, `DropdownMenuItem`
(was `cursor-default`), the command-palette result rows, and the checkbox label on
`/routes`.

**Theme switching (standardized 2026-08-23, reworked 2026-09-05):** `use-theme.js` (`ThemeProvider`, `toggle`, `setMode`) flips the `.dark` class on `<html>`; all theme colors are CSS variables (`--bg`, `--sf`, `--fg`, …) consumed via Tailwind v4 `@theme inline`, and `color-scheme` is set per theme so scrollbars/form controls match. The blocking pre-paint script (`fleetops-theme` from `localStorage` → `.dark` on `<html>`) is delivered via `<Script strategy="beforeInteractive">` in `src/app/layout.js` — a raw `<script>` in `<head>` triggered React 19's never-executed-on-client dev warning (fixed 2026-09-06; same synchronous before-paint execution, no theme flash).
- **View Transition path (supported browsers):** `document.startViewTransition()` + declarative CSS keyframes (`theme-reveal` / `theme-conceal` in `globals.css`) animating `clip-path: circle()` on the transition pseudo-layer (450ms, `cubic-bezier(0.22,1,0.36,1)`), expanding from the clicked toggle for light→dark and contracting back into it for dark→light. Origin/radius travel as `--theme-x/--theme-y/--theme-r`, set synchronously *before* `startViewTransition` with the initial clip in plain CSS — so the first paint is already a dot and the dark layer never flashes full-screen first. (An earlier WAAPI-after-`transition.ready` variant had exactly that pre-flash and was replaced.) Layering/`animation: none` resets live under `[data-theme-transition="expand"|"shrink"]`; cleanup is time-based (600ms) with a generation guard so a rapid re-toggle can't wipe the newer transition. (The old `@keyframes theme-expand/shrink` + `--theme-x/--theme-y`-only CSS approach is gone.)
- **Fallback fade (no View Transition API, hidden tab, or VT throw):** `commitWithFade()` adds `html.theme-fade` (~350ms of `background-color`/`border-color`/`color`/`fill`/`stroke` transitions, toggle button excluded, `box-shadow` excluded) so the page cross-fades instead of snapping. `prefers-reduced-motion` keeps the instant cut in every path.

**The address field (2026-09-23, superseded 2026-09-24):**
`src/components/address/address-form-dialog.jsx` is the **one** address input in the
application — there is no second implementation and no per-form address validation logic
anywhere else. It is a dialog wrapping `LocationCascade` (Region → Province →
City/Municipality → Barangay, off the `ph_*` tables) plus the detail fields, and it hands
the caller the composed `structured_address`. **Every surface that used to be described
here now mounts it:** the canonical-location dialog and the hotel settings call it
directly, and the four driver fields (`/drivers/new` and `/drivers/[id]/edit`, residential
and emergency contact) mount it through `address-picker-field.jsx`, a thin row that shows
the current address read-only with a **Pick** / **Replace** button and owns no form state
of its own.

**`address-validator.jsx`, the free-text combobox this paragraph used to name as the one
address input, is gone — deleted 2026-09-25.** It was a controlled `value`/`onChange` field
over `/api/address/search` and `/api/address/geocode` (`variant="plain"` for Label+Input
surfaces, `variant="floating"` for the `FloatingShell` forms, reusing the exported
`FloatingShell` chrome). Its last caller moved to the cascade on 2026-09-24, and it was
then kept as dead code "only because TomTom's Search API 403 blocks the path they
implement". That reason had no expiry: the 403 never lifted, and #29 (centring the pin map)
is blocked on the same portal permission, so "pending the 403" had no date attached to it.
It went with `use-address-search.js`, `address-map-preview.jsx` behind it, and
`src/lib/address/validate.js` — whose five exports nothing under `src/` imported. Two
things it established are still contract rather than styling, and the cascade honours both.
**Typed text is never verification** — in the cascade the one thing the client is believed
about is its choice of `psgc_barangay_code`, and the server derives the rest. And
**"location verified" and "ZIP code provided" render as two independent chips**, because a
confident position with no postal code on record is a normal Philippine outcome; the two
must never collapse into a single valid/invalid verdict. Every state carries an icon *and*
text inside an `aria-live="polite"` region, so colour is never the only signal.
`autoGeocode={false}` no longer applies anywhere — no mounted surface makes a network
request while typing, because none of them is a typing field.

**Open — the provider layer behind them is now unreferenced but still mounted.**
`/api/address/search` and `/api/address/geocode` lost their only client with that
component, and `src/lib/address/provider.js` + `providers/tomtom.js` lost their only
callers with the routes. They were deliberately left in place rather than deleted with the
rest: a route is a reachable endpoint rather than a dead file, and the provider is what a
lifted 403 would use — `scripts/check-address-provider.mjs` is the tool for testing that,
and it imports none of them, so it survives either way. `parse.js` is **not** part of this
island: `validate-structured.js` and `invalidate.js` both import `emptyAddressValue` from
it, and it carries the falsified-mapping fixtures from #30. `showPinMap={false}` on the
location surfaces
skips the pin only; see [[ADR-015 Address Owns Administration, Location Owns The Point]]
for why a canonical location has no address pin while a driver's home now does.

## Empty and missing routes — CONFIRMED

| Path | State |
|---|---|
| `/maintenance` | Full CRUD register — was `/fleet/maintenance`, relocated by `9c69f08` (2026-07-30) |

The standalone `/fleet/availability` and `/drivers/availability` boards were slated for removal 2026-08-15 but that never landed — both pages stayed live until **2026-08-23**, when they were merged into the dispatch module as `/dispatch/availability` (one page, Drivers | Vehicles tabs, components `driver-availability-board.jsx` / `vehicle-availability-board.jsx`). Management gained Vehicles visibility in the merge; all three backing GETs (`/api/drivers`, `/api/vehicles`, `/api/driver-leave-requests`) already allowed management. The shared `StatusBoard` component was deleted with them.

The empty `src/app/(dashboard)/fleet/maintenance/` directory left behind by that
relocation was removed 2026-08-12.

## How the frontend talks to the backend

Through `src/services/*.service.js` **client fetch wrappers** — thin `apiFetch()` calls. But that same folder also holds server-side domain services, which is a real hazard: importing the wrong one into a client component pulls `@/lib/db` toward the browser. → [[DEBT Services Folder Mixes Two Concerns]]

## Related

[[Architecture]] · [[Backend]] · [[Components]] · [[Technology Stack]] · [[Codebase Map]] · [[Mobile Architecture]]
