# Mobile Pre-Shift & Pre-Trip Inspection UI/UX Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevate the FleetOps Mobile Pre-Shift and Pre-Trip Inspection screens (`mobile/app/(app)/inspection.js`) based on UI/UX Pro Max and Impeccable (Operate Mode) audit findings, introducing a sticky segmented progress bar, leading squircle category icons, semantic amber styling for benign passenger findings, keyboard avoidance, and tactile feedback.

**Architecture:** 
1. Enrich `mobile/lib/inspection-checklist.js` with category icons, labels, and semantic finding classifications (`tone: "safety"` vs `tone: "service"`).
2. Upgrade `mobile/app/(app)/inspection.js` with a sticky segmented progress bar (`2 of 5 Verified`), category anchor icons (`volume-high`, `bulb`, `warning`, `compass`, `disc`), non-punitive warm honey amber styling (`#D97706`) for `passenger_items` ("Items Found"), clean tactile Cabin Ready acknowledgment, `KeyboardAvoidingView` ergonomics, and native `Vibration` feedback.
3. Preserve all existing backend routes (`/api/mobile/driver/inspections`), submission schemas, coach mark targets (`inspection.pass_fail`, `inspection.remarks`, `inspection.complete`), and onboarding tour compatibility.

**Tech Stack:** React Native (Expo), `react-native` (`Vibration`, `KeyboardAvoidingView`, `ScrollView`, `StyleSheet`), Ionicons, Vitest.

## Global Constraints
- Strictly in-place UI/UX refinement: DO NOT alter database schemas, backend APIs, or migration ledgers.
- Keep exact item IDs: Pre-Shift `["sounds", "lights", "dashboard", "steering", "brakes_tires"]`, Pre-Trip `["brakes_tires", "passenger_items", "cabin_ready"]`.
- Maintain Coach Mark targets (`inspection.pass_fail`, `inspection.remarks`, `inspection.complete`) without moving or breaking onboarding tour steps.
- Maintain existing tutorial/quick-pass logic in `mobile/lib/inspection-tour.js`.
- Zero new third-party native dependencies (use built-in `Vibration` from `react-native`).

---

### Task 1: Enrich Inspection Checklist Definitions with UI/UX Metadata

**Files:**
- Modify: `mobile/lib/inspection-checklist.js`
- Test: `mobile/lib/inspection-checklist.test.js`

**Interfaces:**
- Consumes: Existing items in `mobile/lib/inspection-checklist.js`.
- Produces: Each checklist item enriched with:
  - `icon`: Ionicons glyph name (`volume-high`, `bulb`, `warning`, `compass`, `disc`, `briefcase`, `sparkles`).
  - `shortTitle`: 1–2 word category title for scannability (`Unusual Sounds`, `Lights & Signals`, `Dashboard Cluster`, `Steering Action`, `Brakes & Tires`).
  - `findingTone`: `"safety"` (red on fail) vs `"service"` (amber on finding, e.g. for `passenger_items`).
  - `helperNote`: brief operational tip.

- [x] **Step 1: Write failing unit test in `mobile/lib/inspection-checklist.test.js`**

Add assertions confirming each Pre-Shift and Pre-Trip item has `icon`, `shortTitle`, and `findingTone` defined.

- [x] **Step 2: Run test to confirm it fails**

Run: `npm run test:run -- mobile/lib/inspection-checklist.test.js`
Expected: FAIL due to missing metadata properties.

- [x] **Step 3: Update `mobile/lib/inspection-checklist.js` with metadata**

Enrich `PRE_SHIFT_CHECKLIST` and `PRE_TRIP_CHECKLIST` items with `icon`, `shortTitle`, and `findingTone`.

- [x] **Step 4: Re-run unit tests to verify they pass**

Run: `npm run test:run -- mobile/lib/inspection-checklist.test.js`
Expected: PASS.

---

### Task 2: Build Sticky Segmented Progress Tracker

**Files:**
- Modify: `mobile/app/(app)/inspection.js`

**Interfaces:**
- Consumes: `CHECKLIST`, `statuses`, `answeredCount`, `checklistTotal`.
- Produces: Visual progress component rendered beneath the top bar:
  - Horizontal segmented pill rail (5 segments for Pre-Shift, 3 segments for Pre-Trip).
  - Active filled segment color: `colors.primary` (Passed), `colors.error` (Failed safety), `colors.tertiary` (Items found).
  - Progress text: e.g. `"3 of 5 Verified"` or `"Ready to submit"`.
  - Tappable segments to auto-scroll to incomplete or flagged cards.

- [x] **Step 1: Add progress state and scroll-to-item refs in `inspection.js`**

Implement `itemRefs` mapping item IDs to layout coordinates or card refs.

- [x] **Step 2: Render segmented progress meter directly beneath header**

Add sticky progress header with smooth animated/clay pills and clear fraction counter.

- [x] **Step 3: Verify visual rendering on both dark and light themes**

Check color contrast and padding against `insets.top`.

---

### Task 3: Category Anchor Icons & Scannable Card Redesign

**Files:**
- Modify: `mobile/app/(app)/inspection.js`

**Interfaces:**
- Consumes: `item.icon`, `item.shortTitle`, `item.question`.
- Produces: Redesigned inspection card header:
  - Squircle icon container (40×40px, soft tinted clay background matching theme).
  - Category short title (`type.headlineSm` / `16px bold`) alongside sequential number.
  - Subordinate full question text (`type.bodyMd` / `14px` in `colors.onSurfaceVariant`).

- [x] **Step 1: Update card header JSX in `inspection.js`**

Replace plain text title with squircle icon badge, high-contrast category title, and readable question copy.

- [x] **Step 2: Adjust spacing, clay shadows, and touch margins**

Ensure minimum 48px tap heights (`TOUCH_TARGET`) and comfortable spacing on compact screens.

---

### Task 4: Semantic Semiotics — Amber Styling for Passenger Items

**Files:**
- Modify: `mobile/app/(app)/inspection.js`

**Interfaces:**
- Consumes: `item.findingTone` from `mobile/lib/inspection-checklist.js`.
- Produces: Dedicated color tokens for service findings:
  - When `item.id === "passenger_items"` and `status === "FAIL"` (Items Found):
    - Background: warm amber tint (`#FEF3C7` in light mode, `#78350F` in dark mode).
    - Border: amber highlight (`#D97706`).
    - Text / Icon: `#B45309` (light) / `#FDE68A` (dark).
    - Reassuring caption: *"Service finding — logged for dispatch and Lost & Found. Does not block your trip."*

- [x] **Step 1: Update button & input styling in `inspection.js` to branch on `findingTone`**

Conditionally apply amber styling when `item.findingTone === 'service'` and `isFail` is active.

- [x] **Step 2: Add reassuring helper text beneath the remarks input for lost items**

Clarify to the driver that reporting items is non-punitive and will not cancel their trip assignment.

---

### Task 5: Form Ergonomics, Keyboard Avoidance & Tactile Vibration

**Files:**
- Modify: `mobile/app/(app)/inspection.js`

**Interfaces:**
- Consumes: `Vibration` from `react-native`, `KeyboardAvoidingView`.
- Produces:
  - Gentle haptic feedback on button tap: `Vibration.vibrate(10)` (instant tactile response).
  - Submission completion pulse: `Vibration.vibrate([0, 20, 50, 20])`.
  - `KeyboardAvoidingView` with `Platform.OS === "ios" ? "padding" : "height"`.
  - `keyboardShouldPersistTaps="handled"` on `ScrollView`.
  - Safety lockout warning banner above submit button if any safety-critical item is failed.

- [x] **Step 1: Import `Vibration` and `KeyboardAvoidingView` from `react-native`**

Wire gentle vibrations to `setStatus` and `handleSubmit`.

- [x] **Step 2: Wrap screen body with `KeyboardAvoidingView`**

Prevent on-screen keyboard from occluding remarks inputs.

- [x] **Step 3: Add pre-submission safety alert banner**

When `failedCount > 0` on Pre-Shift (or brakes on Pre-Trip), render a clear yellow/red warning pill above the CTA:
`"⚠️ Safety issue reported — Submitting will notify dispatch and pause vehicle availability."`

---

### Task 6: Verification, Full Test Suite & Documentation

**Files:**
- Modify: `Capstone/02 - Features/Driver In-App Guide.md`
- Modify: `Capstone/01 - System/Mobile Pre-Shift and Pre-Trip Inspection UI UX Enhancement Plan.md`
- Modify: `SYSTEM.md`

- [x] **Step 1: Run mobile and repo-wide test suites**

Run: `npm run test:run`
Expected: All 256 test files, 3,257+ tests pass.

- [x] **Step 2: Run linter and route-auth verification**

Run: `npm run lint:ci` and `npm run verify:auth`.
Expected: 0 errors, 0 warnings.

- [x] **Step 3: Update documentation notes in `Capstone/` and `SYSTEM.md`**

Record the UI/UX enhancement, scannability improvements, and semantic color separation.

