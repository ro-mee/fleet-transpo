---
name: FleetOps
description: Hotel fleet & transportation operations — the Dispatch Floor design system
colors:
  asphalt-ink: "#111827"
  ink-secondary: "#4b5563"
  ink-muted: "#6b7280"
  paper: "#f3f3f3"
  surface: "#ffffff"
  hairline: "#d1d5db"
  signal-green: "#10b981"
  signal-amber: "#f59e0b"
  signal-red: "#ef4444"
  signal-blue: "#3b82f6"
  green-tint: "#ecfdf5"
  amber-tint: "#fffbeb"
  red-tint: "#fef2f2"
  blue-tint: "#eff6ff"
typography:
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.3
  section:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  lead:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.05em"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  control: "12px"
  card: "16px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
  2xl: "48px"
components:
  button-primary:
    backgroundColor: "{colors.asphalt-ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-primary-hover:
    backgroundColor: "rgba(17, 24, 39, 0.9)"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-destructive:
    backgroundColor: "{colors.signal-red}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.asphalt-ink}"
    rounded: "{rounded.lg}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.asphalt-ink}"
    rounded: "12px"
    height: "40px"
    padding: "8px 12px"
  chip-success:
    backgroundColor: "rgba(16, 185, 129, 0.1)"
    textColor: "{colors.signal-green}"
---

# Design System: FleetOps

## Overview

**Creative North Star: "The Dispatch Floor"**

FleetOps looks like the place it serves: a hotel transport office's dispatch floor — asphalt, concrete, paper, and signal markings. Practical rather than decorative. Surfaces stay quiet so that data, status, and actions carry all of the color and all of the emphasis. Emphasis comes from **contrast, not hue**: the primary action color is near-black ink in light mode and near-white ink in dark mode, while a four-color signal family (green/amber/red/blue) marks operational meaning. Nothing pulses unless it is genuinely live; nothing decorates waiting time.

The feel is **calm operational clarity**: a dispatcher under time pressure can find the current state, decide, and act without decoding the interface. Hierarchy is communicated by type weight and size — never by a second typeface — and every number that gets compared across rows aligns on tabular figures.

**Key Characteristics:**
- Ink-on-surface primary; saturated color reserved exclusively for meaning (status)
- Single-typeface system (Inter) with a strict six-step size scale
- Flat sheets with 1px borders; elevation reserved for temporary layers
- Status grammar centralized in one authoritative component (`status-badge.jsx`)
- Motion explains state changes only: 150–280ms, no bounce, reduced-motion honored

## Colors

A near-monochrome ink-and-paper field where four signal colors do all of the talking.

### Primary

- **Asphalt Ink** (#111827 light / #F5F5F5 dark): Primary text AND primary action color — buttons, active states, emphasis. It is deliberately not a brand hue; emphasis comes from contrast. Sidebar active items invert to a solid Asphalt Ink fill.
- **Ink Secondary** (#4B5563 light / #A3A3A3 dark): Supporting copy, descriptions — anything important-but-not-primary.
- **Ink Muted** (#6B7280 light / #8B909A dark): Genuinely optional information, captions, placeholders. Dark-mode value meets 4.5:1 body contrast.

### Neutral

- **Paper** (#F3F3F3 light / #111111 dark): Page background — the concrete floor.
- **Surface** (#FFFFFF light / #1A1A1A dark): Cards, sheets, dialogs — paper on concrete.
- **Hairline** (#D1D5DB light / #2A2A2A dark): All separators and control outlines. Every element borders with this token by global default (`* { border-color: var(--br) }`).
- **Hover Wash** (#F3F4F6 light / #242424 dark): Hover fills on ghost/outline controls and sidebar items.

### Tertiary

The **signal markings** — semantic status colors, identical in both themes, always paired with a tinted background variant for chips and fills:

- **Signal Green** (#10B981, tint #ECFDF5): complete, available, online, healthy.
- **Signal Amber** (#F59E0B, tint #FFFBEF): needs attention, in progress, pending review.
- **Signal Red** (#EF4444, tint #FEF2F2): failure, overdue, destructive, emergency.
- **Signal Blue** (#3B82F6, tint #EFF6FF): scheduled, planned, neutral system information.

Sub-14px status text uses darker AA-safe variants instead of the base colors: green-700 #047857, amber-700 #B45309, red-700 #B91C1C, blue-700 #1D4ED8 (light mode; lighter counterparts in dark). Base colors remain legal for chart fills, icons, and large graphic elements.

### Named Rules

**The Contrast-is-the-Accent Rule.** The primary accent is ink, not a hue. If a screen needs excitement, the answer is hierarchy and whitespace — never a new brand color.

**The Text+Shape Rule.** Color alone never communicates state. Every status ships as text + color + supporting shape or icon; the authoritative mapping lives in `src/components/ui/status-badge.jsx`.

**The One Palette Rule.** Charts read mirrors of these tokens from `src/lib/chart-tokens.js`. Pages may not declare private palettes or invent a local semantic color.

## Typography

**Display Font:** Inter (with system-ui fallback)
**Body Font:** Inter (same family)
**Label/Data Font:** Inter with tabular figures (`tabular-nums`, exposed as the `font-data` utility)

**Character:** One voice, many weights. The entire UI speaks Inter; hierarchy comes from weight and size alone, so operational values never look like they belong to a different app.

### Hierarchy

- **Title** (700, 22px, single H1 per page): rendered by HeroHeader; the page's name.
- **Section** (600, 18px): card titles and sub-section headings.
- **Lead** (400, 16px): paragraph leads, standout stats.
- **Body** (400, 14px): default interface text and input text.
- **Label** (500, 12px): badges, chips, secondary labels.
- **Caption** (600, 11px, uppercase, tracking-wider): eyebrows, table headers, KPI labels.
- **Data** (500, 12–13px, `font-data`): numbers, codes, plates, times — right-aligned in tables.

### Named Rules

**The One Voice Rule.** Never introduce a competing typeface — including monospace — for data. Weight and size carry hierarchy; `font-data` keeps values in-family while aligning them.

## Layout

Built on a 4px spacing scale (4, 8, 12, 16, 20, 24, 32, 40, 48). Standard page padding is 24px (`p-6`) on desktop; cards take 16–24px depending on density; controls hold 8px internal padding. Charts use the canonical height utilities — `chart-h-sm` (220px), `chart-h-md` (260px), `chart-h-lg` (300px) — instead of one-off pixel heights.

Page anatomy follows purpose: context (breadcrumb/eyebrow when real) → short task-oriented title → one supporting sentence only if it helps action → primary + secondary actions → work area. Recurring task patterns: instrument strip for monitoring, filterable data table for finding/comparing, record header + grouped sections for reviewing, board/phase rail for staged work, single-column task view for focused decisions. Grids create relationships, not novelty (two-thirds/one-third for work-plus-context).

Responsive behavior is a **change in priority, not a scaled-down desktop**: keep the primary task and current status visible at every width; collapse navigation before collapsing the work area; stack peer fields when readable width runs out; make dense tables scroll horizontally with a visible affordance rather than hiding critical columns. Touch targets aim for 44px and never drop below 32px.

## Elevation & Depth

Flat by default. A resting card is a flat sheet: 1px Hairline border plus the subtlest shadow (`shadow-xs`). Depth is communicated by layering (Paper under Surface) and borders, not by cast shadows.

### Shadow Vocabulary

- **Resting** (`0 1px 2px 0 rgb(0 0 0 / 0.03)`): every card, at rest. Barely there — the border does the separating.
- **Lifted** (`0 1px 3px 0 rgb(0 0 0 / 0.04)`): hovered cards and raised rows.
- **Temporary** (`0 4px 6px -1px rgb(0 0 0 / 0.05)`): menus, popovers, dialogs — layers that float above the floor.
- **Interactive KPI lift** (`0 10px 22px -12px rgb(17 24 39 / 0.32)`): reserved for clickable stat cards mid-hover, paired with a 3px rise and 35%-ink border blend.

Interactive KPI/stat cards move with a distinctive spring-less ease — `translateY(-1..3px)` over 280ms `cubic-bezier(0.22, 1, 0.36, 1)` — so the floor feels tactile without ever bouncing.

### Named Rules

**The Temporary-Layer Rule.** Strong elevation is spent only on things that appear and disappear: menus, popovers, dialogs. Persistent surfaces stay flat.

## Shapes

Form language is soft-edged rectangles — corners round, never pill-shaped (chips excepted), never sharp. Named radii tokens are the de-facto system: `--radius-control: 12px` for inputs and selects (inputs render `rounded-xl` = 12px), `--radius-card: 16px` for dialogs and large panels. Observed component reality: the Button primitive renders at 6px (`rounded-md`) and the Card primitive at 8px (`rounded-lg`), while dashboard KPI/stat sheets sit larger at 24px (`rounded-3xl`). Prefer the named tokens (`rounded-control`, `rounded-card`) for new work over raw arbitrary values.

Borders are uniformly 1px Hairline. Focus treatment is a consistent 2px ring with offset — foreground-toned on buttons, primary-toned on inputs. Invalid fields shift border and ring toward Signal Red (70% alpha). Browser autofill is force-painted with the Surface token so Chrome yellow never breaks the floor.

## Components

Components are interaction contracts: preserve appearance and behavior together.

### Buttons

- **Shape:** gently rounded (6px), 40px tall, medium-weight 14px labels
- **Primary:** solid Asphalt Ink on Surface text; hover dims to 90% opacity; 150ms transition
- **Destructive:** solid Signal Red, white text, hover 90%
- **Outline:** Surface fill, Hairline border, hover washes to Hover
- **Ghost / Link:** text-first; ghost washes on hover, link underlines with 4px offset
- **Status variants:** solid Success and Warning exist but are rare — most confirmations come from context, not colored buttons
- **Sizes:** default 40px · sm 32px · lg 44px · icon 36px square
- **Focus:** 2px foreground ring, 2px offset · disabled: 50% opacity, no pointer events · loading preserves the label

### Status Chips

- **Style:** 10% tint of the signal color as fill, base-or-700 signal color as text (AA-safe variant below 14px)
- **State grammar (the heat ladder):** danger = act now · warning = act this cycle · info = watch · success = healthy · primary = in motion · secondary/neutral = parked
- **Behavior:** every status string resolves through `status-badge.jsx` entity maps (vehicle, driver, trip, reservation, fuel, dispatch, incident, leave, priority) so the same state can never render two different colors in two places. Static records never pulse; only genuinely live states may.

### Cards

- **Corner Style:** 8px on the primitive; 24px sheets for dashboard KPI/stat cards
- **Background:** Surface on Paper
- **Shadow Strategy:** Resting shadow only; see Elevation
- **Border:** 1px Hairline, always
- **Internal Padding:** 20px header/content rhythm (p-5), header bottom-trimmed to 12px

### Inputs / Fields

- **Style:** 1px Hairline stroke, Surface fill, 12px radius, 40px tall
- **Focus:** 2px Asphalt Ink ring with offset; transition-all 200ms
- **Error:** border shifts to Signal Red/70, ring to Signal Red/60, `aria-invalid` set
- **Disabled:** 50% opacity, cursor-not-allowed

### Navigation

Sidebar on Surface with Hairline divider: idle items are secondary ink, hover washes to Hover, and the **active item inverts to solid Asphalt Ink with Surface-colored text** — the strongest single gesture in the system. Per-role workspaces swap navigation content, never chrome structure. Icon-only controls require tooltips and accessible names.

### Signature Components

- **Phase Rail** (`phase-rail.jsx`): the lifecycle spine — ordered trip/dispatch stages showing completed, current, pending, and blocked states. The visual expression of PRODUCT.md's "one chain" principle.
- **StatCard** (`stat-card.jsx`): KPI instrument with the tactile hover physics (lift + deep soft shadow + ink-border blend); interactive variants respond, static ones don't.
- **HeroHeader**: owns the single 22px/700 page title and its action row — pages don't hand-roll headers.
- **QueryFeedback / EmptyState**: loading, empty, and error behavior as shipped primitives, not per-page ad-hoc spinners.

## Do's and Don'ts

### Do:

- **Do** use `font-data` (tabular figures) for anything compared or scanned: tables, reports, currency, plates, IDs, timestamps.
- **Do** resolve every status through `status-badge.jsx` entity maps — one state, one color, everywhere.
- **Do** use the AA-safe `-700` text variants (`text-success-700`, etc.) for status text below 14px.
- **Do** name buttons after outcomes in sentence case: "Add vehicle", "Export report".
- **Do** use `chart-h-sm/md/lg` and the named radii tokens for any new chart or panel.
- **Do** confirm destructive actions with consequence-stated dialogs and prevent duplicate submissions.

### Don't:

- **Don't** invent page-local colors, arbitrary radii, or duplicate button variants — map to an existing role or propose a shared one.
- **Don't** declare a private chart palette; read `src/lib/chart-tokens.js`.
- **Don't** communicate state by color alone, and never pulse a static record.
- **Don't** introduce a second typeface for data or decoration.
- **Don't** animate ambiently (parallax, scroll reveals, decorative counters) in operational screens; micro-interactions run 150–200ms with no bounce.
- **Don't** hide the primary task behind a menu, or replace consequential action labels with icons.
