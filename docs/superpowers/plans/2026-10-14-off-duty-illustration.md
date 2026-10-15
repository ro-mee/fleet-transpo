# Shared Off Duty Illustration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reuse the supplied Off Duty illustration in the mobile Home, Trips, and Map empty states without changing duty behavior.

**Architecture:** Add one local image asset and one small presentational `OffDutyIllustration` component that owns its source, decorative accessibility behavior, contain sizing, and three size variants. Existing screens select the component only when the resolved empty-state key is `off_duty`; Rest Day and On Leave retain their current vector icons.

**Tech Stack:** Expo 54, React Native 0.81, React 19, Vitest 3, esbuild source harnesses.

## Global Constraints

- Preserve all existing duty resolution, Pre-Shift, assignment, tracking, permissions, and API behavior.
- Keep `OFF DUTY`, title, supporting copy, and existing actions visible; the illustration is never the only state indicator.
- Use one optimized local asset under `mobile/assets/images/` with `resizeMode="contain"`.
- The illustration is decorative (`accessible={false}`) because adjacent text announces the state.
- Do not change Rest Day or On Leave visuals.
- Preserve unrelated work already present in the dirty working tree.
- Do not commit without an explicit follow-up request.

---

### Task 1: Shared Off Duty illustration

**Files:**
- Create: `mobile/assets/images/off-duty.webp`
- Create: `mobile/components/OffDutyIllustration.jsx`
- Create: `mobile/lib/off-duty-illustration.test.js`

**Interfaces:**
- Produces: `OffDutyIllustration({ size: "compact" | "card" | "hero", style?: StyleProp<ImageStyle> })`.
- Produces: a local `OFF_DUTY_IMAGE` source owned inside the component.

- [x] **Step 1: Write the failing component test**

Create a Vitest/esbuild harness that renders `OffDutyIllustration` and asserts its `Image` uses the shared WebP, `resizeMode="contain"`, `accessible={false}`, and distinct compact/card/hero dimensions.

- [x] **Step 2: Run the test to verify RED**

Run: `npm test -- mobile/lib/off-duty-illustration.test.js`

Expected: FAIL because `mobile/components/OffDutyIllustration.jsx` does not exist.

- [x] **Step 3: Add and optimize the supplied asset**

Convert `C:/Users/lenovo/AppData/Local/Temp/codex-clipboard-96773faa-9f97-4aa3-9845-484020d59cc5.png` to `mobile/assets/images/off-duty.webp`, preserving transparency and fitting mobile bundle needs.

- [x] **Step 4: Implement the component**

Create a memoized React Native `Image` component with a fixed aspect ratio, contain sizing, decorative accessibility, and the three tested size variants.

- [x] **Step 5: Run the test to verify GREEN**

Run: `npm test -- mobile/lib/off-duty-illustration.test.js`

Expected: PASS.

### Task 2: Integrate Home, Trips, and Map

**Files:**
- Modify: `mobile/components/home/DriverHomeCards.jsx`
- Modify: `mobile/app/(app)/(tabs)/index.js`
- Modify: `mobile/app/(app)/(tabs)/trips.js`
- Modify: `mobile/app/(app)/(tabs)/map.js`
- Modify: `mobile/lib/off-duty-illustration.test.js`

**Interfaces:**
- Consumes: `OffDutyIllustration` from Task 1.
- Preserves: `DUTY_EMPTY_STATES` and `resolveDutyEmptyState` contracts.

- [x] **Step 1: Extend the test to verify all three surfaces**

Assert that Home's current-assignment empty card, the Home Pre-Shift Off Duty prompt, Trips' Off Duty empty state, and Map's Off Duty empty state render the shared component, while Rest Day and On Leave keep their existing icon branches.

- [x] **Step 2: Run the test to verify RED**

Run: `npm test -- mobile/lib/off-duty-illustration.test.js`

Expected: FAIL because the screens still render their existing crossed-location glyphs or no illustration.

- [x] **Step 3: Implement the screen integrations**

Import and render `OffDutyIllustration` only in `off_duty` branches. Replace, rather than duplicate, crossed-location artwork. Use compact sizing in Home cards, card sizing in Trips, and hero sizing in Map. Preserve existing text, buttons, status pills, and layout semantics.

- [x] **Step 4: Run focused tests to verify GREEN**

Run: `npm test -- mobile/lib/off-duty-illustration.test.js mobile/lib/duty-empty-states.test.js mobile/lib/map-empty-state.test.js mobile/lib/trips-empty-state.test.js mobile/lib/cargo-home-render.test.js`

Expected: all selected tests PASS.

### Task 3: Documentation and verification

**Files:**
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/02 - Features/Live Map Radar.md`
- Modify: `SYSTEM.md`

**Interfaces:**
- Documents presentation-only behavior and evidence; no runtime interface changes.

- [x] **Step 1: Update the vault and system notes**

Record that Home, Trips, and Map reuse the shared supplied illustration for Off Duty only, preserve text/actions, and do not change duty semantics.

- [x] **Step 2: Run final focused verification**

Run the focused Vitest set from Task 2, scoped ESLint for touched JavaScript/JSX, `npm run verify:encoding`, and `git diff --check`.

- [x] **Step 3: Build the native bundle**

Run an Android Expo export using the repository's established temporary-output pattern. If environment limits block it, report the exact limitation without weakening the focused checks.

- [x] **Step 4: Inspect the final diff**

Confirm only the new asset/component/test, the four narrow screen integrations, and required documentation are included. Preserve all unrelated existing changes.
