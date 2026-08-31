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
- **Cards** (16px radius): Main content cards, dialogs, and large panels.
- **Primitives** (4-8px radius): Fallbacks for micro-elements.

## Components

Refined, restrained, and elegant. Micro-interactions take priority over stark contrast.

### KPI Stat Cards
- **Shape:** 16px radius (or larger 24px/3xl for some dashboard sheets).
- **Behavior:** Features a highly engineered hover state (`translateY(-3px) scale(1.004)`) with a deep shadow and a primary-tinted border mix. Active state depress to `translateY(-1px) scale(0.995)`.

### Status Chips / Badges
- **Style:** 10% tint of the signal color for the background, with the AA-safe 700-variant for text. 
- **Behavior:** Resolved strictly through `status-badge.jsx` entity maps. One state = one color, globally.

### Inputs / Fields
- **Shape:** 12px radius (`--radius-control`).
- **Focus:** 2px ring offset. Browser autofill overrides Chrome's yellow to match the native Surface color.

### Phase Rail
- **Behavior:** The lifecycle spine used across the app to visualize the unbroken chain of requests to completion.

## Do's and Don'ts

### Do:
- **Do** map all state colors through the global status palette.
- **Do** respect the AA-contrast 700 variants for text smaller than 14px.
- **Do** use the standard `chart-h-` utility classes for all recharts containers.

### Don't:
- **Don't** introduce custom border radii. Stick to the semantic tokens (control = 12px, card = 16px).
- **Don't** pulse or animate static records. Motion is reserved for genuinely live states or tactile hover feedback.
- **Don't** use ambient shadows on resting elements. Surfaces are flat by default.
