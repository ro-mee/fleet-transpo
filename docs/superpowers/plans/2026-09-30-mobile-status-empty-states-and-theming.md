# Mobile Status Empty States & Light/Dark Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement status-aware empty states (Off Duty, Rest Day, On Leave) for the Trips Tab and Home Tab, and make the Map Tab empty state dynamically responsive to both Light Mode and Dark Mode.

**Architecture:** 
- Centralize duty status evaluation (`resolveDutyEmptyState`) and dictionary definitions in `mobile/lib/duty-empty-states.js` so Map, Trips, and Home tabs share unified gating logic.
- Update `mobile/app/(app)/(tabs)/map.js` to dynamically bind styles to `isDark` (`scheme === 'dark'`), switching seamlessly between the dark neon emerald theme and a warm, clean ivory/mint claymorphism palette in light mode.
- Update `mobile/app/(app)/(tabs)/trips.js` to display a status-aware empty card when `sections.length === 0` for non-operational states, while keeping the standby radar pulse for checked-in on-duty drivers.
- Update `mobile/components/home/DriverHomeCards.jsx` to display contextual empty states for the primary active assignment card on Home when no trip is assigned.

**Tech Stack:** React Native, Expo, Expo Vector Icons (`MaterialCommunityIcons`, `Ionicons`), Expo Linear Gradient, Vitest.

---

### Task 1: Centralized Duty Empty State Helper & Test Suite

**Files:**
- Create: `mobile/lib/duty-empty-states.js`
- Test: `mobile/lib/duty-empty-states.test.js`
- Modify: `mobile/app/(app)/(tabs)/map.js:370-428`

**Interfaces:**
- Produces: `DUTY_EMPTY_STATES`, `resolveDutyEmptyState({ duty, profile, user, paramStatus, activeTrip })`

- [ ] **Step 1: Write unit tests in `mobile/lib/duty-empty-states.test.js`**
- [ ] **Step 2: Create `mobile/lib/duty-empty-states.js` implementing evaluation hierarchy and copy dictionary**
- [ ] **Step 3: Update `map.js` to import and re-export `MAP_EMPTY_STATES` and `resolveMapEmptyState` for 100% backward compatibility**
- [ ] **Step 4: Run `npx vitest run mobile/lib/duty-empty-states.test.js` and `mobile/lib/map-empty-state.test.js` to verify all tests pass**

---

### Task 2: Map Tab Light Mode & Dark Mode Theming

**Files:**
- Modify: `mobile/app/(app)/(tabs)/map.js:1160-1280, 2770-2970`

- [ ] **Step 1: Add dynamic theme-aware styling variables in `map.js` based on `isDark = scheme === 'dark'`**
  - Dark mode: deep teal `#040D0A` canvas, emerald neon borders, white icons, glowing halo.
  - Light mode: warm ivory/mint canvas (`#F0FDF4` to `#F4F7F5`), soft forest ribbon arcs, `#17382F` typography, `#15803D` vector glyphs, and soft clay container.
- [ ] **Step 2: Update empty state JSX and cold-start loader in `map.js` to use dynamic light/dark tokens**
- [ ] **Step 3: Test with query param overrides `?status=off_duty`, `?status=rest_day`, `?status=on_leave` under both light and dark scheme**
- [ ] **Step 4: Run `npx eslint mobile/app/(app)/(tabs)/map.js` to verify zero lint errors**

---

### Task 3: Trips Tab Status-Aware Empty State

**Files:**
- Modify: `mobile/app/(app)/(tabs)/trips.js:1-260`
- Test: `mobile/lib/trips-empty-state.test.js`

- [ ] **Step 1: Write unit tests in `mobile/lib/trips-empty-state.test.js` for Trips queue empty-state resolution**
- [ ] **Step 2: Connect `useDuty` and `useDriverProfile` in `trips.js`**
- [ ] **Step 3: Update `sections.length === 0` render block in `trips.js`**:
  - If driver is Off Duty, Rest Day, or On Leave: render status pill, vector icon (`map-marker-off`, `calendar-minus`, or `calendar-slash`), title, and reassurance copy.
  - If driver is checked in on duty: retain the active `RadarPulse` and *"Your vehicle is active on standby"* message.
- [ ] **Step 4: Run `npx vitest run mobile/lib/trips-empty-state.test.js` and verify zero ESLint errors**

---

### Task 4: Home Tab Status-Aware Assignment Card

**Files:**
- Modify: `mobile/components/home/DriverHomeCards.jsx:250-270`
- Modify: `mobile/app/(app)/(tabs)/index.js:110-180, 480-550`

- [ ] **Step 1: Update `DriverHomeCards.jsx` `TripCard` component to accept `emptyState` config**
- [ ] **Step 2: When `!trip && isCurrent`:**
  - If `emptyState` is present: render the calm status icon and message (`You’re Off Duty`, `Today is Your Rest Day`, or `You’re Currently on Leave`) without the radar pulse animation.
  - If on active duty: keep the `RadarPulse` scanning indicator.
- [ ] **Step 3: Pass resolved empty state from `index.js` into `DriverHomeCards`**
- [ ] **Step 4: Run ESLint on touched Home files**

---

### Task 5: End-to-End Verification & Documentation

- [ ] **Step 1: Run full mobile test suite: `npx vitest run mobile/lib/`**
- [ ] **Step 2: Run full repository regression test: `npm test`**
- [ ] **Step 3: Update documentation in `Capstone/02 - Features/Live Map Radar.md`, `Capstone/02 - Features/Trips.md`, and `SYSTEM.md`**
