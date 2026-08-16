# FleetOps Mobile — UI/UX Assessment Report (Android, Material Design 3)

Status: DRAFT for redesign. Scope: driver application UI/UX only. Guest mode is not
implemented (requires backend work, out of scope); the design system is built so a Guest
flow can be layered on later without a visual redesign.

## Home tab redesign — IMPLEMENTED 2026-08-16

The driver **Home tab** (`mobile/app/(app)/(tabs)/index.js`) was rebuilt as a premium
operational surface. Same data + RBAC logic; visual layer upgraded:

- **Hero panel** — linear-gradient indigo→near-black panel (light/dark/high-contrast
  consistent), daily-dispatch eyebrow, greeting + date, live-status chip with `PulsingDot`
  for an active trip, assigned vehicle row with the `Plate` component.
- **Trip card** — dominant, elevated; tonal badge, tabular departure-time pill, dashed
  route rail, guest row with "open in maps" action, full-width pill CTA with nested icon
  circle, `StatusPill`.
- **Stats strip** — two tiles with icons and animated `CountUpText` figures.
- **Quick actions** — 2×2 tiles with per-action tinted icon chips + chevron affordance.
- **Micro-motion** — staggered section entrance (RN `Animated`, `useNativeDriver`),
  press-scale feedback, live pulse only. No ambient/scroll decoration.
- **Typography** — switched the whole app to the design-system typeface spec (Archivo
  display + IBM Plex Sans interface + IBM Plex Mono data) in `app/_layout.js` + `lib/theme.js`.
- Added `expo-linear-gradient` (SDK 54).

Remaining P1/P2 items for future waves: unread badge on Alerts, skeletons on History /
Notifications / Profile, sectioned Profile cards, ETA/distance on trip cards.

Report follows.

---

## 1. Executive summary

The app is functionally complete for drivers (login, trips, GPS, fuel, incidents,
inspection, profile, consent) and already has a coherent "dispatch paper" visual identity.
The core weaknesses are **UX**, **Android-specific patterns**, and **accessibility**:

| Area | Grade | Key gap |
|---|---|---|
| Information hierarchy | C+ | Flat card stacks; active work not visually dominant |
| Android navigation | C | Text-only bottom bar; no top app bar, no FAB, no search |
| One-handed use | C | Reach targets at top; no bottom-anchored primary action |
| Accessibility | C− | Low-contrast greys, hardcoded sizes, no dark mode, weak scaling |
| Feedback states | D | No skeletons, no snackbars, empty/error states are plain text |
| Consistency | B | Theme tokens are consistent, but spacing is ad-hoc (12/16/20 mix) |
| Dark mode | F | Light-only hardcoded palette |
| Spacing system | C− | No 8pt discipline; `space` uses 12/16/20/24 |

---

## 2. Screen-by-screen audit

### 2.1 Login (`app/login.js`)
- **Good:** minimal, one job, keyboard handled.
- **Weak:** small brand block; no loading skeleton; single error line; no "secure" affordance; not MD3 (no tonal surface, no text-field containers with focus states).

### 2.2 Bottom navigation (`(tabs)/_layout.js`)
- **Good:** 4 tabs (Home/History/Alerts/Profile), hand-drawn glyphs.
- **Weak:** no MD3 bottom-app-bar semantics, no top app bar on tabs, no FAB, no badge on Alerts for unread count, active state is a faint pill.

### 2.3 Driver Home (`(tabs)/index.js`)
- **Good:** greeting header, active trip card, pending list, pull-to-refresh.
- **Weak:** **loading is a bare `<Text>`**, not a skeleton — a driver staring at "Loading…" on the road. No shift/availability summary. No FAB for "Report". Fuel/Tools buried in the scroll. Actions inside cards, not a persistent bottom CTA.

### 2.4 Active / Pending trip cards
- **Good:** route rail, plate, status pill, single advance button.
- **Weak:** primary action is mid-card and scrollable out of reach; no ETA/distance; no guest name/pax for pending (data not wired); touch targets ~40px.

### 2.5 History, Notifications, Profile, Incidents, Inspection
- **Good:** consistent cards, tone edges.
- **Weak:** history has **no search/filter**; notifications **no Today/Yesterday/Earlier grouping**, no unread badge; profile is a long vertical form (no sections, no grouped cards); no skeletons anywhere; empty/error states are plain text.

### 2.6 Consent (`app/consent.js`)
- **Good:** policy sourced from server, action clear.
- **Weak:** plain scroll of text; no section affordance; button at very bottom (scroll reach).

---

## 3. Prioritized recommendations

### P0 — Foundation (do first, unlocks everything)
1. **MD3 design tokens** with light + dark palettes (`theme.js`): tonal color roles
   (primary/onPrimary/primaryContainer/surface/background/surfaceVariant/outline),
   8pt spacing, MD3 elevation + shape, a proper type scale. Keep token names
   backward-compatible so screens keep working.
2. **Theme provider + `useTheme()`** and **dark mode** (follow system via `Appearance`).
3. **8-point spacing** refactor across all screens.

### P1 — Android navigation & feedback
4. **MD3 bottom app bar**: 4 destinations, **badge on Alerts** (unread count), larger touch targets.
5. **Top app bar** on tabs (title + avatar/actions) so screens have a stable header.
6. **Loading skeletons** for Home, History, Notifications, Profile (replace bare `<Text>`).
7. **Snackbar** for action feedback (saved / submitted / network error).
8. **Empty + error states** as proper MD3 components with icon + action.

### P2 — Driver workflow optimization
9. **Home**: add an availability/shift summary row; make active trip the dominant card;
   anchor primary action at the bottom (reachable one-handed).
10. **Trip cards**: show ETA/distance + passenger count when data is present; larger
    primary buttons (≥48dp), always-visible action bar.
11. **FAB** for quick "Report" (incident/fuel) on Home.
12. **Profile**: group into sectioned cards (Identity / Performance / Contact / License /
    Consent); keep it scannable, not a long form.

### P3 — Accessibility & consistency
13. Contrast: raise grey steps, ensure text ≥4.5:1 on surfaces.
14. Dynamic type: respect system font scaling (`allowFontScaling` default on; avoid
    fixed heights that clip).
15. Reduce motion: keep transitions short; avoid decorative animation.
16. iOS-ready: safe-area insets already used; keep MD3 tokens so iOS can map them later.

---

## 4. Navigation flow (target)

```
Login ─▶ Consent (if not accepted)
              │
              ▼
        Bottom Nav (4)
   ┌───────────┬────────────┬────────────┬────────────┐
   Home        History      Alerts       Profile
   (trips)     (completed)  (notif)      (identity)
   │  FAB: Report
   │  └▶ Fuel / Incident (stack)
   └▶ Trip detail / actions (stack)
```

Frequently used actions are ≤2 taps from Home: accept/advance a trip is one tap on the
card, "Report" is one FAB tap, Alerts unread count is one glance.

---

## 5. Design direction

**MD3 baseline, tempered for an operational tool.** MD3's tonal surfaces and elevation
improve hierarchy and dark-mode support without the decorative density of consumer apps.
The existing brand accents (terracotta primary, gold) map to MD3 primary/secondary. Type
stays Archivo (display) + IBM Plex Sans (body) + IBM Plex Mono (data) for the dispatch
character, retyped to an MD3 scale (display/headline/title/body/label).

**Signature:** the **active trip becomes a tonal MD3 card with an anchored bottom CTA** —
the one thing a driver must see and act on at a glance, kept in reach. Everything else
quiets to standard MD3 surfaces.
