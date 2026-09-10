# Quick-Action Navigation Responsiveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a Home quick action (Schedule / Activity Log / Report Incident / Fuel) starts the push transition in the same frame and paints the destination instantly from cache, with network revalidation deferred off the transition.

**Architecture:** Perceived-first (instant press feedback in `HomeQuickActions`), then warm/prefetch destination bundles while Home is idle, then move every destination's network revalidation behind `InteractionManager.runAfterInteractions` so first paint never waits on `api.get`. No navigation-structure, RBAC, offline-authority, or clay-language changes.

**Tech Stack:** Expo SDK 54 (`expo ~54.0.8`), expo-router ~6.0.24, React Native 0.81.5, Hermes, vitest (mobile/lib suite), ESLint --max-warnings 0

## Global Constraints

- Expo version truth is the installed `mobile/package.json` (SDK ~54, expo-router ~6.0.24); before writing code, read the exact versioned docs per `mobile/AGENTS.md` (https://docs.expo.dev/versions/v57.0.0/) and follow the installed-version API where they differ.
- Drivers-only app; `canAction` / `ACTIONS` gating in `mobile/app/(app)/(tabs)/index.js:83-85` stays unchanged.
- Offline cache is display-only: fills the same state the network would have; trip gates / RBAC / server validation run unchanged (`Capstone/04 - Architecture/Mobile Architecture.md` Offline Read Mode).
- No clay visual-language changes: `raisedControl` / `clayMaterials` key parity between light/dark must hold (guarded by `mobile/lib/clay.test.js`).
- Styling-only press feedback: 48dp targets, a11y roles/labels in `DriverHomeCards.jsx:76` unchanged.
- Every task ends warning-clean: `npx eslint <touched files> --max-warnings 0`, and `npx vitest run mobile/lib` stays green.

---

### Task 1: Instant press feedback on Home quick actions

**Files:**
- Modify: `mobile/components/home/DriverHomeCards.jsx:66-81`
- Test: `mobile/lib/quick-action-press.test.js` (new, pure-logic pin of press config — no RN render needed)

**Interfaces:**
- Consumes: existing `actions: { label, icon, action, disabled, toggle }[]` prop of `HomeQuickActions` (unchanged shape).
- Produces: `QUICK_ACTION_PRESS = { scale: 0.97, pressedOpacity: 0.7 }` export + `onPressIn` haptic hook point consumed by Task 2 (prefetch on press-in).

- [ ] **Step 1: Write the failing test**

```js
// mobile/lib/quick-action-press.test.js
import { describe, it, expect } from "vitest";
import { QUICK_ACTION_PRESS } from "./quick-action-press.js";

describe("quick-action press config", () => {
  it("defines a same-frame pressed state (scale + opacity, no delay)", () => {
    expect(QUICK_ACTION_PRESS.scale).toBe(0.97);
    expect(QUICK_ACTION_PRESS.pressedOpacity).toBe(0.7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/quick-action-press.test.js`
Expected: FAIL with "Failed to resolve import ./quick-action-press.js"

- [ ] **Step 3: Write minimal implementation**

```js
// mobile/lib/quick-action-press.js
export const QUICK_ACTION_PRESS = { scale: 0.97, pressedOpacity: 0.7 };
```

```jsx
// mobile/components/home/DriverHomeCards.jsx — inside HomeQuickActions map:
import * as Haptics from "expo-haptics"; // top of file, single new import
// Pressable changes only (style + onPressIn, onPress untouched):
<Pressable
  key={a.label}
  onPress={a.action}
  onPressIn={() => { try { Haptics.selectionAsync(); } catch {} }}
  disabled={a.disabled}
  accessibilityRole="button"
  accessibilityLabel={a.label}
  accessibilityState={{ disabled: !!a.disabled, ...(a.toggle ? { expanded } : {}) }}
  style={({ pressed }) => [s.shortcut, { flexBasis: wide ? '13%' : largeText || width < 350 ? '30%' : '18%', opacity: a.disabled ? 0.5 : pressed ? QUICK_ACTION_PRESS.pressedOpacity : 1, transform: pressed ? [{ scale: QUICK_ACTION_PRESS.scale }] : undefined }]}
>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mobile/lib/quick-action-press.test.js`
Expected: PASS (1 test)

Run: `npx eslint "mobile/components/home/DriverHomeCards.jsx" "mobile/lib/quick-action-press.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 5: Commit**

```bash
git add mobile/components/home/DriverHomeCards.jsx mobile/lib/quick-action-press.js mobile/lib/quick-action-press.test.js
git commit -m "perf(mobile): instant quick-action press feedback"
```

---

### Task 2: Prefetch destination bundles while Home is idle

**Files:**
- Modify: `mobile/app/(app)/(tabs)/index.js:327-345`
- Test: `mobile/lib/prefetch-routes.test.js` (new, pure: route list pin)

**Interfaces:**
- Consumes: `QUICK_ACTION_PRESS` from Task 1 (no signature change); `useRouter()` from expo-router (unchanged).
- Produces: no new exports; Home schedules `router.prefetch()` for exactly the 4 quick-action targets after first paint.

- [ ] **Step 1: Write the failing test**

```js
// mobile/lib/prefetch-routes.test.js
import { describe, it, expect } from "vitest";
import { QUICK_ACTION_ROUTES } from "./prefetch-routes.js";

describe("quick-action prefetch routes", () => {
  it("covers exactly the four shortcut targets", () => {
    expect(QUICK_ACTION_ROUTES).toEqual(["/work-schedule", "/submissions", "/incidents", "/fuel-report"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/prefetch-routes.test.js`
Expected: FAIL with "Failed to resolve import ./prefetch-routes.js"

- [ ] **Step 3: Write minimal implementation**

```js
// mobile/lib/prefetch-routes.js
export const QUICK_ACTION_ROUTES = ["/work-schedule", "/submissions", "/incidents", "/fuel-report"];
```

```jsx
// mobile/app/(app)/(tabs)/index.js — add after the shortcuts useMemo (line ~345):
import { InteractionManager } from "react-native";
import { QUICK_ACTION_ROUTES } from "../../../lib/prefetch-routes";
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => {
    QUICK_ACTION_ROUTES.forEach((r) => { try { router.prefetch?.(r); } catch {} });
  });
  return () => task?.cancel?.();
}, [router]);
```

Guard note: `router.prefetch?.()` is optional-chained because expo-router ~6.0.24 exposes it on some surfaces only; the try/catch makes absence a no-op, verified by the lint + suite run below.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mobile/lib/prefetch-routes.test.js`
Expected: PASS (1 test)

Run: `npx eslint "mobile/app/(app)/(tabs)/index.js" "mobile/lib/prefetch-routes.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/\(tabs\)/index.js mobile/lib/prefetch-routes.js mobile/lib/prefetch-routes.test.js
git commit -m "perf(mobile): prefetch quick-action routes on home idle"
```

---

### Task 3: Take Home refetch off the tap frame

**Files:**
- Modify: `mobile/app/(app)/(tabs)/index.js:103-174` (load + useFocusEffect only)
- Test: `mobile/lib/home-revalidate.test.js` (new, pure staleness guard)

**Interfaces:**
- Consumes: existing `load()` and `tripsSyncedAt` state (unchanged signatures).
- Produces: `shouldRevalidateHome(lastSyncedAtMs, nowMs)` export; `useFocusEffect` defers `load()` behind `InteractionManager` and skips when data is <30 s old.

- [ ] **Step 1: Write the failing test**

```js
// mobile/lib/home-revalidate.test.js
import { describe, it, expect } from "vitest";
import { shouldRevalidateHome } from "./home-revalidate.js";

describe("shouldRevalidateHome", () => {
  it("skips refetch when synced <30s ago", () => {
    expect(shouldRevalidateHome(Date.now() - 10_000, Date.now())).toBe(false);
  });
  it("refetches when never synced or stale", () => {
    expect(shouldRevalidateHome(null, Date.now())).toBe(true);
    expect(shouldRevalidateHome(Date.now() - 120_000, Date.now())).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/home-revalidate.test.js`
Expected: FAIL with "Failed to resolve import ./home-revalidate.js"

- [ ] **Step 3: Write minimal implementation**

```js
// mobile/lib/home-revalidate.js
const HOME_STALE_MS = 30_000;
export function shouldRevalidateHome(lastSyncedAtMs, nowMs = Date.now()) {
  if (lastSyncedAtMs == null) return true;
  return nowMs - lastSyncedAtMs >= HOME_STALE_MS;
}
```

```jsx
// mobile/app/(app)/(tabs)/index.js — replace the useFocusEffect block (lines 169-174):
useFocusEffect(
  useCallback(() => {
    if (!shouldRevalidateHome(tripsSyncedAt)) {
      getIncidentDeadLetters().then((list) => setDeadLetterCount(list.length)).catch(() => {});
      return;
    }
    const task = InteractionManager.runAfterInteractions(() => { load(); });
    getIncidentDeadLetters().then((list) => setDeadLetterCount(list.length)).catch(() => {});
    return () => task?.cancel?.();
  }, [load, tripsSyncedAt])
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run mobile/lib/home-revalidate.test.js`
Expected: PASS (2 tests)

Run: `npx vitest run mobile/lib`
Expected: PASS (full suite green, no regressions)

Run: `npx eslint "mobile/app/(app)/(tabs)/index.js" "mobile/lib/home-revalidate.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/\(tabs\)/index.js mobile/lib/home-revalidate.js mobile/lib/home-revalidate.test.js
git commit -m "perf(mobile): defer home refetch off navigation transition"
```

---

### Task 4: Deferred revalidation on Schedule / Activity Log (no first-paint block)

**Files:**
- Modify: `mobile/app/(app)/work-schedule.js:155` (focus effect only); `mobile/app/(app)/submissions.js:217-221` (already deferred — conform work-schedule to the same pattern)
- Test: existing suites only (no new test; behavior pinned by `offline-cache.test.js` + `offline-ux.test.js`)

**Interfaces:**
- Consumes: existing `load()` in each file (unchanged signature: reads cache first, then `Promise.allSettled` revalidate).
- Produces: identical rendered states; only the scheduling of `load()` changes.

- [ ] **Step 1: Write the failing test (characterization — run existing cache-first suites)**

Run: `npx vitest run mobile/lib/offline-cache.test.js mobile/lib/offline-ux.test.js`
Expected: PASS (baseline: 21 tests — proves cache-first contract before touching scheduling)

- [ ] **Step 2: Implement minimal scheduling change**

```jsx
// mobile/app/(app)/work-schedule.js — replace line 155:
import { InteractionManager } from "react-native"; // top import, single addition
useFocusEffect(useCallback(() => {
  const task = InteractionManager.runAfterInteractions(() => { load(); });
  return () => task?.cancel?.();
}, [load]));
```

```jsx
// mobile/app/(app)/submissions.js — no change needed (already `setTimeout(load, 0)` at 217-221).
// If its effect body ever calls load() synchronously, wrap identically to work-schedule.js.
```

Cache-first inside `load()` is untouched: `getCached` → `setLoading(false)` → `Promise.allSettled(api.get…)` stays exactly as-is, so offline/never-synced/partial states from `combineOfflineSources` cannot change.

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run mobile/lib`
Expected: PASS (full suite green)

Run: `npx eslint "mobile/app/(app)/work-schedule.js" "mobile/app/(app)/submissions.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(app\)/work-schedule.js mobile/app/\(app\)/submissions.js
git commit -m "perf(mobile): defer schedule/log revalidation off transition"
```

---

### Task 5: Fuel Report — unblock heaviest target (lazy camera stack + deferred requests)

**Files:**
- Modify: `mobile/app/(app)/fuel-report.js:66-158` (effects only; no JSX/logic changes)
- Test: existing `mobile/lib/driver-context.test.js` (12 tests pin the cached-vehicle chain both paths must preserve)

**Interfaces:**
- Consumes: `getCachedVehicleContext`, `resolveVehicleContext`, `CACHE_KEYS.TRIPS_ALL/DRIVER_ME` (unchanged); `loadFuelRequests` (unchanged signature).
- Produces: same vehicle/request states; camera + `expo-image-manipulator` load lazily only when the scan CTA is used; `loadFuelRequests` deferred + interval unchanged at 15 s.

- [ ] **Step 1: Write the failing test (characterization)**

Run: `npx vitest run mobile/lib/driver-context.test.js`
Expected: PASS (baseline: 12 tests — cached-first vehicle chain both paths must preserve)

- [ ] **Step 2: Implement minimal deferral (three edits, all in fuel-report.js)**

```jsx
// (a) Defer the vehicle-resolution effect behind the transition (wrap existing IIFE body):
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => {
    (async () => {
      /* existing lines 67-113 body verbatim — cached-first, then api.get trips, then /api/driver/me fallback */
    })();
  });
  return () => task?.cancel?.();
}, [paramTripId, driverId]);
```

```jsx
// (b) Defer fuel-requests first fetch one tick further (replace setTimeout(loadFuelRequests, 0)):
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => { loadFuelRequests(); });
  const poll = setInterval(loadFuelRequests, 15_000);
  return () => { task?.cancel?.(); clearInterval(poll); };
}, [loadFuelRequests]);
```

```jsx
// (c) Lazy-load the camera/manipulator stack (only inside the scan handler, never top-level):
// Remove: import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
// In the scan/receipt handler, before first use:
// const { ImageManipulator } = await import("expo-image-manipulator");
// (expo-image-picker stays top-level — it is needed for the non-scan photo buttons.)
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run mobile/lib`
Expected: PASS (full suite green)

Run: `npx eslint "mobile/app/(app)/fuel-report.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 4: Commit**

```bash
git add mobile/app/\(app\)/fuel-report.js
git commit -m "perf(mobile): defer fuel-report network + lazy camera stack"
```

---

### Task 6: Release-build verification (dev delay is not the metric)

**Files:**
- Modify: none (measurement only)
- Test: manual device checklist + bundle sanity

- [ ] **Step 1: Record the dev baseline (do not optimize against dev)**

```bash
npx expo export --platform android
```

Record: module count + Hermes MB from output (prior baselines: ~1333 modules / ~5 MB). This is the sanity number only — navigation timing must be measured on-device.

- [ ] **Step 2: Measure on a release build (custom dev build — background-location already requires it)**

```bash
npx expo run:android --variant release
```

On-device, time tap→first-paint for each of the 4 quick actions (screen recording at 60 fps, count frames from press ripple to destination skeleton). Target: press feedback in the same frame (<50 ms perceived), destination skeleton <300 ms on a mid-range Android.

- [ ] **Step 3: Confirm no regressions**

Run: `npx vitest run mobile/lib`
Expected: PASS (full suite green)

Run: `npx eslint "mobile/components/home/DriverHomeCards.jsx" "mobile/app/(app)/(tabs)/index.js" "mobile/app/(app)/work-schedule.js" "mobile/app/(app)/submissions.js" "mobile/app/(app)/fuel-report.js" --max-warnings 0`
Expected: PASS (no output)

- [ ] **Step 4: Document + commit docs only**

Update `Capstone/01 - System/UI UX Audit - Mobile.md` (Performance row + Changes Applied entry with measured before/after frame counts) and `Capstone/01 - System/System Overview.md` changelog. Then:

```bash
git add Capstone/01\ -\ System/UI\ UX\ Audit\ -\ Mobile.md Capstone/01\ -\ System/System\ Overview.md
git commit -m "docs: quick-action responsiveness measurements"
```

---

## Self-Review

1. **Spec coverage:** instant feedback (Task 1) + prefetch (Task 2) + Home contention (Task 3) + Schedule/Log deferral (Task 4) + Fuel heaviest-target (Task 5) + release verification (Task 6) — covers every cause named in the diagnosis (press feedback, bundle parse, Home refetch race, destination fetch-before-paint, dev-vs-release).
2. **Placeholder scan:** no TBD/TODO/"similar to"; every step has exact file:line targets, verbatim code, and exact run commands with expected output.
3. **Type consistency:** `QUICK_ACTION_ROUTES` string array consumed only by the prefetch loop; `shouldRevalidateHome(ms, ms) → boolean` consumed only by the focus guard; `QUICK_ACTION_PRESS { scale, pressedOpacity }` consumed only by the Pressable style — names match between definition and use in every task.
