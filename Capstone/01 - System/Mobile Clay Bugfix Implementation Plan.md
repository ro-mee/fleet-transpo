# Mobile Clay Bugfix Implementation Plan

> **Status (2026-09-12, all tasks executed):** Tasks 1–7 fully implemented plus two B1 files discovered by audit (`work-schedule.js`, `submissions.js`). Task 6 resolved per git-history intent: `complete.js` got `dot` (pre-migration `pulseDot` existed → 2A), `fuel-report.js` dropped the dead `dotColor` (pre-migration badge used a `time-outline` icon, no dot → 2B). Static verification clean: zero bug-pattern remnants (grep), `node --check` passes on all 7 touched `.js` files, `git diff --check` clean on the 3 `.jsx` files, ESLint clean on all 10 touched files, all 19 mobile lib Vitest suites (117 tests) pass. Still pending: Expo device visual checks (Task 1 Step 4 dark-mode dividers, Task 5 spot-check tile sizes, Task 6 badge dots, Task 7 Step 4 nested-Pressable tap test — expected no code change).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 7 verified bug groups introduced by the uncommitted Clay migration on branch `perf/quick-actions`, with zero behavior change beyond restoring intended visuals.

**Architecture:** Single-file, pattern-level fixes — no component API redesign except `ClayTile`, which is extended to accept the numeric sizes call sites already pass. Each task is independently verifiable by grep + `node --check` + Expo visual check.

**Tech Stack:** Expo SDK ~54 / expo-router ~6, React Native 0.81.5, `mobile/components/clay/*`, `mobile/lib/theme.js`, `mobile/lib/theme-context.js`.

## Global Constraints

- Branch is `perf/quick-actions`; the uncommitted Clay migration MUST be present (all line numbers below are against that working copy).
- Do NOT commit anything — leave every change uncommitted (standing user instruction for this branch).
- Read https://docs.expo.dev/versions/v57.0.0/ before writing code (per `mobile/AGENTS.md`).
- No new test harness: `mobile/package.json` has no test script; vitest covers pure `mobile/lib/*` only. Verification for these UI fixes is static (grep / `node --check` / eslint) + Expo Go/dev-client visual check.
- `node --check` works for `.js` only — it rejects `.jsx` with `ERR_UNKNOWN_FILE_EXTENSION`. Never use it on `.jsx` files.

---

## Verified bug catalog (evidence, not speculation)

| # | Bug | Evidence |
|---|---|---|
| B1 | `isDark` destructured from `useTheme()` is always `undefined` | `mobile/lib/theme-context.js:65-76` provides `scheme, colorScheme, preference, toggleColorScheme, setColorScheme, colors, type, statusSurfaces, elevation, m3` — no `isDark`. 6 files destructure it. `settings.js:27` already guards (`isDark ?? (scheme === "dark")`) and works — reference pattern, untouched. |
| B2 | `trip/[id].js` status badge always renders neutral | `ClayBadge.jsx:8-24` accepts `label/text, tone/variant, dot/statusDot, dotColor, icon, size` — NOT `backgroundColor/textColor`, and `dotColor` needs `dot`. `trip/[id].js:263-268` passes all three dead props. |
| B3 | `inspection.js:164` references nonexistent `type.headlineSm` | `lib/theme.js` defines `headlineMd:293`, `titleLg:299` — no `headlineSm`. Style entry silently ignored. |
| B4 | License "Expires in N days" warning renders neutral instead of amber | `license.js:183-190` maps `warning → variant="tonal"`; `statusColorForTone(c, "tonal")` (`theme.js:452-457`: `bg = s[tone] \|\| s.neutral`) falls back to neutral. |
| B5 | Numeric `ClayTile size={…}` silently renders 48px | `ClayTile.jsx:24-29`: only `'sm'/'md'/'lg'` map to 38/48/56; any number falls through to `md`. 19 call sites pass numbers (32/38/40/44/48/56). |
| B6 | `dotColor` with no `dot` renders nothing | `fuel-report.js:698-702`, `complete.js:169-174`. `ClayBadge.jsx:61-63` only renders the dot when `dot \|\| statusDot`. |
| B7 | Three minor robustness issues | `trips.js:57` hook called inline as JSX prop; `TripMapPreview.jsx:72` hides "Loading route…" in staticMode; `RouteTimeline.jsx:24` `stops.map` crashes on `undefined` (pre-existing). `index.js:443,461` nested Pressable is verify-only (RN gives the touch to the innermost responder — likely no bug). |

## File map

- Task 1 (B1): `mobile/app/(app)/devices.js`, `mobile/app/(app)/incident/navigate.js`, `mobile/app/(app)/profile/about.js`, `help.js`, `license.js`, `personal.js` — **plus (found by 2026-09-12 audit, fixed same day): `mobile/app/(app)/work-schedule.js`, `mobile/app/(app)/submissions.js`**
- Task 2 (B2): `mobile/app/(app)/trip/[id].js`
- Task 3 (B3): `mobile/app/(app)/inspection.js`
- Task 4 (B4): `mobile/app/(app)/profile/license.js`
- Task 5 (B5): `mobile/components/clay/ClayTile.jsx`
- Task 6 (B6): `mobile/app/(app)/fuel-report.js`, `mobile/app/(app)/trip/complete.js`
- Task 7 (B7): `mobile/app/(app)/(tabs)/trips.js`, `mobile/components/TripMapPreview.jsx`, `mobile/components/RouteTimeline.jsx`, `mobile/app/(app)/(tabs)/index.js` (verify-only)

---

### Task 1: Fix `isDark` (always `undefined`) in 6 files

**Files:**
- Modify: `mobile/app/(app)/devices.js:32`, `mobile/app/(app)/incident/navigate.js:51`, `mobile/app/(app)/profile/about.js:30`, `mobile/app/(app)/profile/help.js:62`, `mobile/app/(app)/profile/license.js:76`, `mobile/app/(app)/profile/personal.js:29`

**Interfaces:**
- Consumes: `useTheme()` → `{ scheme: 'light' \| 'dark', colors, type }` (`mobile/lib/theme-context.js:65-76`).
- Produces: a real boolean `isDark` that existing prop-drilling (`InfoRow isDark=`, `SessionCard isDark=`, `FAQItem isDark=`, `devices.js:214`, `navigate.js:310-311`) consumes unchanged.

Verified collision-free: none of the 6 files contains the identifier `scheme` or `colorScheme` today, so this pattern introduces no shadowing.

- [x] **Step 1: Apply the fix in all 6 files** *(done 2026-09-12 audit; `incidents.js:45` and `inspection.js:29` also derive correctly)*

The exact replacement, per file (only the destructure line changes; everything downstream keeps working):

`devices.js:32` before:
```js
const { colors, type, isDark } = useTheme();
```
after:
```js
const { colors, type, scheme } = useTheme();
const isDark = scheme === "dark";
```

`navigate.js:51` before:
```js
const { colors, isDark } = useTheme();
```
after:
```js
const { colors, scheme } = useTheme();
const isDark = scheme === "dark";
```

`about.js:30`, `license.js:76`, `personal.js:29` before (same shape, check each file's exact destructured keys first):
```js
const { colors, isDark } = useTheme();
```
after:
```js
const { colors, scheme } = useTheme();
const isDark = scheme === "dark";
```
Keep any other keys each line already destructures (`type`, etc.) — only swap `isDark` out of the destructure and add the derivation line directly below.

`help.js:62`: same swap. `FAQItem({ item, colors, isLast, isDark })` (`help.js:34`) and its call site (`help.js:118`) need no change — they receive the now-correct value.

- [x] **Step 2: Verify no stale destructure remains** *(re-verified 2026-09-12: zero matches in the 6 files; `settings.js` guard intact; but `work-schedule.js:50` and `submissions.js:115` now carry the same bug — see status audit)*

- [x] **Step 3: Syntax-check the touched `.js` files** *(re-verified 2026-09-12: `node --check` passes on all 6)*

- [ ] **Step 4: Visual check in Expo (dark mode)**

Toggle device dark mode; confirm: devices footer divider visible, navigate bottom card uses dark surface, about/help/license/personal row dividers visible. Do NOT commit.

---

### Task 2: Fix `trip/[id].js` status badge (always neutral)

**Files:**
- Modify: `mobile/app/(app)/trip/[id].js:13,247,263-268`

**Interfaces:**
- Consumes: `tripStatusTone(status)` → `'success' \| 'warning' \| 'info' \| 'danger' \| 'neutral'` (`mobile/lib/theme.js:420-444`) — every return value is a valid `ClayBadge` tone.
- Produces: correct badge colors via `ClayBadge`'s own `statusColorForTone` path; no component change needed.

- [x] **Step 1: Swap the import** *(done)*

- [x] **Step 2: Swap the derivation (`trip/[id].js:247`)** *(done — `const tone = tripStatusTone(trip.trip_status)`)*

- [x] **Step 3: Fix the badge (`trip/[id].js:263-268`)** *(done — `<ClayBadge text={…} tone={tone} />`)*

- [x] **Step 4: Verify** *(static part re-verified 2026-09-12: no `statusColors`/`sc.` remnants in `trip/[id].js`, `node --check` passes; Expo visual check still pending. Note: `map.js:36` still calls `statusColors()` legitimately for its own pills — not part of this bug.)*

---

### Task 3: Fix `inspection.js` nonexistent `type.headlineSm`

**Files:**
- Modify: `mobile/app/(app)/inspection.js:164`

**Interfaces:**
- Consumes: `type.headlineMd` (`mobile/lib/theme.js:293`, used the same way by `inspection.js:137` for the top-bar title).
- Produces: nothing downstream — single call site.

- [x] **Step 1: Apply the fix** *(done — `headlineMd`)*

- [x] **Step 2: Verify** *(2026-09-12: no `headlineSm` remnant; `node --check` passes; Expo font visual check pending)*

---

### Task 4: Fix license warning badge (amber renders as neutral)

**Files:**
- Modify: `mobile/app/(app)/profile/license.js:183-190,209`

**Interfaces:**
- Consumes: `status.tone` (`license.js:178-181`: `'neutral' | 'danger' | 'warning' | 'success'`) — all four are valid `ClayBadge` tones (`ClayBadge.jsx:11,35-41`).
- Produces: correct badge via `ClayBadge`'s tone path; the `badgeVariant` indirection is deleted.

- [x] **Step 1: Delete the `badgeVariant` mapping (`license.js:183-190`)** *(done — block deleted)*

- [x] **Step 2: Fix the badge (`license.js:209`)** *(done — `<ClayBadge label={status.label} tone={status.tone} dot />`)*

- [x] **Step 3: Verify** *(2026-09-12: no `badgeVariant`/`tonal` remnant; `node --check` passes; amber/green/red Expo visual check pending)*

---

### Task 5: Extend `ClayTile` to accept numeric sizes

**Files:**
- Modify: `mobile/components/clay/ClayTile.jsx:8-9,24-29`

**Interfaces:**
- Consumes: existing call sites pass `size` as `'sm' | 'md' | 'lg'` or numbers 32/38/40/44/48/56 — no call-site changes needed.
- Produces: `dimension / radius / iconSize` resolved for both forms, preserving the component's own ratios (radius ≈ 0.375×, icon ≈ 0.5×: sm 38→14/20, md 48→18/24, lg 56→20/28).

Decision record: extending the component (1 file) beats converting 19 call sites across 8 files, because 32/40/44 have no exact string equivalent (38/48/56 do: `sm`/`md`/`lg`) — conversion would silently resize those tiles.

- [x] **Step 1: Apply the fix** *(done — `isCustom` guard + `dimension/radius/iconSize` ternaries; `size={48}` call sites keep the exact md values since `Math.round(48*0.375)=18` and `Math.round(48*0.5)=24`)*

- [x] **Step 2: Verify** *(2026-09-12: `git diff --check` clean; `about.js:40 size={64}` confirmed to be the `Logo` component, not `ClayTile`, so unaffected; Expo tile-size spot-check pending)*

---

### Task 6: Fix dead `dotColor` on two badges (check pre-migration intent first)

**Files:**
- Modify (pending Step 1 outcome): `mobile/app/(app)/fuel-report.js:698-702`, `mobile/app/(app)/trip/complete.js:169-174`

**Interfaces:**
- Consumes: `ClayBadge` `dot` prop (`ClayBadge.jsx:13-14,32,61-63`).
- Produces: a visible dot in the color already passed — IF the pre-migration UI had one.

- [x] **Step 1: Check what the pre-migration UI showed** *(resolved 2026-09-12 from `git show HEAD:./app/(app)/...`: `complete.js`'s MISSION COMPLETE eyebrow had a `pulseDot` → **Step 2A** (add `dot`); `fuel-report.js`'s status badge used a `time-outline` Ionicons icon, no dot → **Step 2B** (drop the dead `dotColor`; restoring the icon would be a behavior restoration but goes beyond this plan's minimal fix)*

Run:
```powershell
git show HEAD:mobile/app/fuel-report.js | Select-String -Pattern 'dot|Dot' | Select-Object -First 10
git show HEAD:mobile/app/trip/complete.js | Select-String -Pattern 'dot|Dot' | Select-Object -First 10
```
(Note: pre-migration paths are `mobile/app/…` — the `(app)` regrouping came with the migration diff. If a path misses, list it with `git show HEAD --name-only | Select-String -Pattern 'fuel-report|complete'`.)
- If the old UI rendered a dot/status-dot in that badge → go to Step 2A.
- If the old UI had no dot → go to Step 2B.

- [x] **Step 2A (old UI had a dot): add the missing `dot` prop** *(applied to `complete.js` — pre-migration `pulseDot` confirmed)*

`complete.js` — `dot` added, `dotColor={colors.primary}` kept.

- [x] **Step 2B (old UI had no dot): drop the dead prop instead** *(applied to `fuel-report.js` — pre-migration badge used a `time-outline` Ionicons icon, no dot; `statusColorForTone` import retained, still used at `fuel-report.js:793-796`)*

- [x] **Step 3: Verify** *(2026-09-12: no `dotColor` remnant in `fuel-report.js`; `node --check` passes both files; Expo badge visual check pending)*

---

### Task 7: Robustness trio + nested-Pressable verification

**Files:**
- Modify: `mobile/app/(app)/(tabs)/trips.js:55-61`, `mobile/components/TripMapPreview.jsx:72`, `mobile/components/RouteTimeline.jsx:24`
- Verify-only: `mobile/app/(app)/(tabs)/index.js:443,461`

**Interfaces:** none shared — three independent one-line fixes plus one device check.

- [x] **Step 1: Hoist the inline hook in `TripCard` (`trips.js:36-61`)** *(done — `stops` useMemo hoisted beside the other derivations; `useMemo` already imported)*

- [x] **Step 2: Show the loading state in static mode (`TripMapPreview.jsx:72`)** *(done — static-mode `Image.onLoad` sets `ready` and hides the overlay; blank-area-while-loading regression closed)*

- [x] **Step 3: Guard `RouteTimeline` against `undefined` stops (`RouteTimeline.jsx:24`)** *(done — `(stops ?? [])`)*

- [ ] **Step 4: Verify-only — nested Pressable in `index.js:443,461`** *(pending device check — expected no code change; RN awards the touch to the innermost responder)*

- [x] **Step 5: Verify all** *(2026-09-12: `node --check` passes on `trips.js`; `git diff --check` clean on all three files; Expo visual checks pending)*

---

## Self-review

1. **Spec coverage:** B1→Task 1 (6 files), B2→Task 2, B3→Task 3, B4→Task 4, B5→Task 5, B6→Task 6 (intent-gated 2A/2B), B7→Task 7 (3 fixes + 1 verify-only). The `settings.js` `isDark ??` guard is excluded deliberately (already correct). `ClayBadge` needs no API change (Tasks 2/4 route through existing `tone`). No gap.
2. **Placeholder scan:** no TBD/TODO/"similar to"; every step has exact before/after code or an exact command. The one conditional (2A/2B) is decided by an exact Step 1 command whose two outcomes each have full code.
3. **Type consistency:** `tripStatusTone` returns only `success/warning/info/danger/neutral`, all valid `ClayBadge` tones; `status.tone` is the same four-value set; `resolveTileSize` math reproduces the component's own 0.375/0.5 ratios; `scheme` is verified absent in all 6 Task-1 files.

## Execution handoff

Plan complete and saved to `Capstone/01 - System/Mobile Clay Bugfix Implementation Plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session, batch execution with checkpoints

**Which approach?**
