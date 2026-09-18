---
name: FleetOps
description: Hotel guest transportation and fleet operations dashboard
colors:
  primary: "#111827"
  neutral-bg: "#f3f3f3"
  neutral-surface: "#ffffff"
  neutral-border: "#d1d5db"
  neutral-text: "#111827"
  neutral-text-secondary: "#4b5563"
  neutral-text-muted: "#6b7280"
  status-success: "#10b981"
  status-warning: "#f59e0b"
  status-danger: "#ef4444"
  status-info: "#3b82f6"
  accent-navy: "#0b132b"
typography:
  display:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: "600"
  title:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: "600"
  lead:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: "500"
  body:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: "400"
  label:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: "500"
  caption:
    fontFamily: "var(--font-inter), system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: "400"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  control: "12px"
  card: "16px"
  stat: "24px"
spacing:
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.neutral-surface}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.neutral-surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
---

# Design System: FleetOps

## Overview

**Creative North Star: "The Executive Dashboard"**

Authoritative, crisp, and tactile. Information is dense but perfectly structured. Actionable signals (like blockers) are impossible to miss, while ambient state stays quietly out of the way. The interface serves as a pitch-grade dashboard where operational truth wins over decorative flair.

> **Scope.** This system covers the web dashboard only. The Expo driver companion app ships a separate Claymorphism language (forest primary, warm ivory, Plus Jakarta Sans — see `mobile/lib/theme.js`, `mobile/components/clay/`, and the `Capstone/01 - System/Mobile *` plans). Do not apply web tokens to native surfaces or vice versa.

*Last re-synced 2026-09-17 against shipped web code (`src/app/globals.css`, `src/components/dashboard/*`, `src/components/ai/ai-analyst-card.jsx`, `src/components/maps/map-entity-marker.jsx`, `src/components/ui/stat-card.jsx`, `src/components/ui/caps-lock-hint.jsx`, `src/components/ui/page-entrance.jsx`, `src/lib/chart-tokens.js`).*

**Key Characteristics:**
- Unbroken chains of requests to completion
- High information density with clear typographic hierarchy
- Precise, tactile micro-interactions (e.g., hover physics on KPI cards)
- Extreme clarity on state and eligibility

## Colors

The palette is anchored by deep contrasts and specific status signaling.

### Primary
- **Midnight Ink** (#111827): The dominant interactive and typographic color. Used for active navigation, primary buttons, and primary text.

### Neutral
- **Cool Paper** (#f3f3f3): The absolute background floor.
- **Surface White** (#ffffff): The card and panel background.
- **Slate Border** (#d1d5db): The structural divider separating surfaces.

### Status
- **Success** (#10b981): Used for healthy, completed states.
- **Warning** (#f59e0b): Used for items needing attention this cycle.
- **Alert Red** (#ef4444): Used for blockers and danger (acts now).
- **Info** (#3b82f6): Used for active or moving items.

### Accent
- **Deep Navy** (#0b132b): Reserved for the AI Analyst identity — the "Intelligence Engine" pill and workload rank badges. Not a general emphasis color; primary carries action everywhere else.
- **Sky tints** (Tailwind `sky-*` scale): The AI Analyst header squircle and narrative icon badge. Used straight from the Tailwind scale, not a custom token.
- **Session peach** (#fff8f3, dark `#27150a`): A one-off surface for the expired-session banner only — deliberately outside the semantic palette so an expired session never reads as a `danger` failure. Do not reuse it.

### Named Rules
**The Strict Status Contrast Rule.** Base status colors (#10b981, #f59e0b) may only be used for fills or large graphical elements. For sub-14px text or chips, the AA-safe 700-level variant (e.g., #047857, #b91c1c) must be used.

## Typography

**Display/Body Font:** Inter (with system-ui fallback)
**Data Font:** Inter (tabular figures applied)

**Character:** Utilitarian, readable, and perfectly balanced. The entire UI relies on Inter. Hierarchy is achieved solely through weight and size, never by introducing a competing typeface.

### Hierarchy
- **Display** (600, 22px): Single H1 per page, used in HeroHeaders.
- **Title** (600, 18px): Sub-section titles and panel headers.
- **Lead** (500, 16px): Paragraph leads and major statistics.
- **Body** (400, 14px): Default UI text and input values.
- **Label** (500, 12px): Badges, chips, and tab labels.
- **Caption** (400, 11px): Micro-labels, eyebrows, and table metadata.

### Named Rules
**The Data Alignment Rule.** Always use `font-data` (tabular figures) for anything compared or scanned vertically, including tables, reports, currency, plates, IDs, and timestamps.

## Layout

The application utilizes a dense, grid-based dashboard structure. Containers have distinct boundaries. Chart vertical rhythm is strictly maintained through canonical height classes (`chart-h-sm` for 220px, `chart-h-md` for 260px, `chart-h-lg` for 300px). Scrollbars are custom-styled to be ultra-thin (6px) but highly visible so interactive overflow is discoverable.

## Elevation & Depth

Tactile Lift: Surfaces are flat at rest, but elevate firmly with soft shadows on hover/interaction. Shadows are structural, not ambient.

### Shadow Vocabulary
- **Resting** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.03)`): Barely there, structural separation.
- **Lifted** (`box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.04)`): Slight hover states.
- **Floating** (`box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.05)`): Menus, dropdowns, and temporary layers.

### Named Rules
**The Tactile Physics Rule.** Interactive KPI stat cards must spring effortlessly. Hover states use a `translateY(-3px)` lift combined with an expansive shadow, transitioning over a highly specific 280ms cubic-bezier curve.

## Shapes

Soft-edged rectangles with distinct, semantic corner radii. Sharp corners are avoided.

- **Controls** (12px radius): Inputs, selects, buttons.
- **Cards** (16px radius): Panels, dialogs, and large surfaces.
- **Stats** (24px radius): KPI stat cards (`rounded-3xl`).
- **Primitives** (4-8px radius): Fallbacks for micro-elements.

## Components

Refined, restrained, and elegant. Micro-interactions take priority over stark contrast.

### KPI Stat Cards
- **Shape:** 24px stat radius, 10% tone icon chip (`rounded-2xl`), value in 30px semibold, 11px `valueNote` pill, 11px muted `trend` caption.
- **Behavior:** Two variants share one shell. Base cards rest flat (`translateY(-1px)` hover). Interactive cards (`href`, `onClick`, or `interactive`) spring with `translateY(-3px) scale(1.004)`, a deep shadow, and a primary-tinted border; press depresses to `translateY(-1px) scale(0.995)`. Linked cards carry a visible focus ring and an `aria-label` naming the destination ("Label: value. Open label.").

### Dashboard Panels
- **Surface:** 16px radius, tactile inset top highlight (`shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]`, `0.06` in dark), header with 15px semibold title + 12px secondary description over a `hover/30` wash.
- **Behavior:** Action links ("View … →") sit in the header. Panels never fail silently: `FeedState` renders a skeleton while loading, a `danger-bg` `role="alert"` panel naming the failed feed on error, and honest empty copy — never an empty dataset.

### Meters: Donut, Distribution, Bars
- **DonutMeter** (recharts donut + center total + text legend): for true partitions only — values that sum to a whole (fleet statuses, roster, compliance buckets). Hex fills from `src/lib/chart-tokens.js`, tooltips in the `--sf`/`--br` style, animation gated on `prefers-reduced-motion`, neutral ring + total when empty. Named exceptions render as max-3 chips + "+N more".
- **DistributionMeter:** single stacked bar, `role="img"` with a text summary; decorative segments are `aria-hidden`.
- **StatusBars:** overlapping counts that would lie as a donut (incident risk) stay labeled bars with severity icon chips + tabular values.

### LivePulseBeacon
- **Form:** 10px dot with a ping ring in the row's severity color.
- **Behavior:** Rendered only beside genuinely live-critical rows (integration failures, blocked vehicles, overdue dispatches). Static records never pulse or beacon.

### PageEntrance
- **Behavior:** One authored entrance per page: 0.6s fade-up (`y: 16`, ease `[0.32, 0.72, 0, 1]`), collapsed for reduced-motion via `MotionConfig`. Record-creation pages share the floating-card shadow (`CARD_SHADOW` in `page-entrance.jsx`).

### Operations Cards (Admin 2x2)
- **Request Pipeline:** header summary (total, week delta, completion pill) over a 6-stage interlocking chevron ribbon (`clip-path` polygons, 2px angled slit). The active stage ("In Progress") is saturated blue with white tabular text; Assigned is info blue — no black slices. Status-dot legend underneath.
- **Document Compliance:** dual visualization — summary box (% valid) beside a 4-segment stacked bar (Expired rose / Due ≤30d amber / Due 31–90d blue / Valid emerald) with count + percent columns; expiring-soon unit badges below.
- **Maintenance & Incident Pressure:** enterprise activity list — top-3 records with a status border strip, wrench tile, plate + type, status badge, relative time, and chevron.
- **Incident Risk:** 4 compact metric tiles over one summary state — calm emerald "No active incident risks" at zero, rose alert card with count above zero.

### AI Analyst Card
- **Header:** sky-tint squircle Sparkles icon, bold title, deep-navy "Intelligence Engine" pill, muted subtitle, outline pill Regenerate button.
- **Insight panel:** inset `#f8fafd` rounded container with a faint sky contour-wave treatment along the lower half; status pills (Healthy emerald / Monitoring amber / Needs Attention rose + `DETERMINISTIC` mode pill); 3-bar badge leading the number-grounded narrative; `RECOMMENDED ACTIONS` numbered list with sky circle markers; calendar footer with the analyzed range. A narrative never renders under a mismatched title — report identity must match first.

### Map Entity Markers
- **Anatomy:** 30px state-color pin with white ring + anchor tip at `[15, 35]`, attached floating card (`rounded-xl`, 12px bold label + 10.5px semibold status). Minimal pill legend (Active trip / At pickup / Available / idle / Maintenance / Incident).
- **Grammar:** green active trip, blue at-pickup/rescue, slate idle, rose maintenance/critical incident, amber delayed/moderate, gray stale GPS (>10 min, semi-transparent "No signal"). Resolved strictly through `map-entity-marker.jsx`.
- **Priority:** critical incidents (2500) > selected (2000) > rescue (1500) > active trips (1000–1200) > maintenance (800) > idle (500) > stale (400). Pulse rings only on unacknowledged critical or assistance-needed markers.

### Auth Feedback Surfaces
- **Caps Lock hint:** quiet contextual state, never an error — ~32px pill (`rounded-[10px]`, pale-red `danger-bg/70`, hairline border, "Aa" glyph + "Caps Lock is on"), `aria-live="polite"`, 220ms enter / 180ms exit, reduced-motion exempt. The field border tint lives in unlayered `.caps-field-active` because the global `* { border-color }` reset outranks layered danger utilities.
- **Session Expired banner:** the one-off peach surface above (`rounded-2xl`, hairline orange border, dismissible, motion-collapsed).
- **Lockout honesty:** wrong passwords read "Incorrect email or password. Please check and try again." Locked accounts get a live countdown with submit blocked until zero, then a retry invitation. The status peek is enumeration-safe (unlocked accounts always answer `locked:false`).
- **Session idle countdown chip** (`session-countdown.jsx`): a 28px readout in the `TopNav` action cluster, first in the `ml-auto` group so its arrival never shifts the actions to its right. Non-interactive — a `<span role="timer">`, no click target, no focus ring; `title` carries the rule ("expires after N minutes of inactivity"), `aria-label` carries the spoken value (`formatCountdownSpoken`) since a screen reader reads "4:32" as "four colon thirty-two". Digits are `font-data tabular-nums` per the Data Alignment Rule, so a value that changes every second never reflows. Neutral is `border-border bg-background/60 text-foreground-muted`; the warning tone is `border-warning/30 bg-warning/10` with the **700 variant** text, required by the Strict Status Contrast Rule at this size. It escalates 2× earlier than the expiry modal opens — see Authentication.md for why the modal's own threshold would be unreachable. No animation and no pulsing: it is a readout, not a live beacon.

### Status Chips / Badges
- **Style:** 10% tint of the signal color for the background, with the AA-safe 700-variant for text. 
- **Behavior:** Resolved strictly through `status-badge.jsx` entity maps. One state = one color, globally.

### Inputs / Fields
- **Shape:** 12px radius (`--radius-control`).
- **Focus:** 2px ring offset. Browser autofill overrides Chrome's yellow to match the native Surface color.

### Phase Rail
- **Behavior:** The lifecycle spine used across the app to visualize the unbroken chain of requests to completion.

### Named Rules
**The Partition-Only Donut Rule.** Donuts are for values that sum to a whole. Overlapping counts stay bars — a donut would lie.
**The No-Severity-Border Rule.** Severity is carried by tinted icon chips + `role="alert"`, never by colored `border-left` bars.
**The Honest Feed Rule.** Every data panel owns loading (skeleton), failure (named alert + retry pointer), and empty (truthful copy + next action) states.

## Do's and Don'ts

### Do:
- **Do** map all state colors through the global status palette.
- **Do** respect the AA-contrast 700 variants for text smaller than 14px.
- **Do** use the standard `chart-h-` utility classes for all recharts containers.
- **Do** read chart fills from `src/lib/chart-tokens.js`; never declare a private palette inside a page.
- **Do** wrap queue/timeline text with `line-clamp-2` instead of `truncate` so content wraps instead of disappearing.
- **Do** give linked KPI cards a destination `aria-label` and a visible focus ring.

### Don't:
- **Don't** introduce custom border radii. Stick to the semantic tokens (control = 12px, card = 16px, stat = 24px).
- **Don't** pulse, beacon, or animate static records. Motion is reserved for genuinely live states (`LivePulseBeacon`, critical map markers) or tactile hover feedback.
- **Don't** use ambient shadows on resting elements. Surfaces are flat by default.
- **Don't** render black donut slices. Deepen blues instead (Assigned info, In Progress saturated blue).
- **Don't** use colored `border-left` bars for severity. Use tinted icon chips + `role="alert"`.
