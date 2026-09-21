# Remaining Coach-Mark Tooltips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every non-Map coach-mark presents reliably on a fresh install without changing any Map tooltip, copy, storage key, or safety rule.

**Architecture:** Apply the existing collision-recovery pattern (guard `!activeMilestone` + list `activeMilestone` in the trigger effect deps, as `DriverSos.js` and `ConnectivityBanner.jsx` already do) to the three triggers that lack it, add the missing step-1 target in the trip fallback branch, and sequence the fuel scan-card tap so the intro completes before the camera opens. All fixes are trigger/target-side; the provider, overlay, and milestone configs are untouched.

**Tech Stack:** Expo React Native (mobile/), expo-router, AsyncStorage-backed coach-mark storage, vitest source-text suite (`mobile/lib/coach-marks.test.js`).

## Global Constraints

- Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code (mobile/AGENTS.md).
- Map tooltips (`map_intro`, `live_trip`) are OUT OF SCOPE — already working, do not touch `map.js`, `CurvedPillTabBar.js`, or `MapIntroPractice.jsx`.
- Copy in `mobile/lib/coach-marks.js` is frozen — no text changes.
- Storage keys stay `fleetops.guide.<key>.v1_<driverId>` — no version bumps, no new keys.
- Protected actions (`blocked` steps) still advance only via `[ Got it ]` — never auto-tap, auto-submit, or mutate trip/inspection/fuel/incident state.
- Driving Safety Lock unchanged; `triggerMilestone` stays raw with deps `[driverId, isDriving]` (`CoachMarkProvider.jsx:551`).
- `inspection.js` and `incidents.js` must NEVER import `useCoachMarkState` or `useCoachMarks` — only `useCoachMarkActions` and `useCoachMarkStatus` (tripwire at `coach-marks.test.js:1037`).
- Perf budget (same wake-up-only discipline as the live-map tooltips): every new subscription in this plan is status-context ONLY (`useCoachMarkStatus` → `activeMilestone`). Status moves on milestone transitions alone — never on step changes or target re-measures — so the fixed screens re-render at most once per milestone claim/dismiss, exactly like `DriverSos.js`/`ConnectivityBanner.jsx`/`fuel-report.js` already do. No screen in this plan may subscribe to the volatile state context (`useCoachMarkState`/`useCoachMarks`); today only `map.js:370` (needs `currentStepIndex` for practice rendering) and `CoachMarkTarget.jsx:132` do, and that stays true. Guarded effects (`... || activeMilestone) return;`) run at most twice per trigger (fire, then one blocked re-run after the claim) — no loops, no polling, no new timers except the pre-existing SOS 2s and incident `runAfterInteractions` wrappers.
- The suite has no renderer: new tests are source-text assertions in the existing style, and every fix needs Metro dev-client device confirmation (`__DEV__` warnings).

---

### Task 1: `pretrip_complete` retries after `pretrip`/`remarks` dismiss

**Files:**
- Modify: `mobile/app/(app)/inspection.js:13` (import line)
- Modify: `mobile/app/(app)/inspection.js:55-56` (hook line)
- Modify: `mobile/app/(app)/inspection.js:68-73` (complete-trigger effect)
- Test: `mobile/lib/coach-marks.test.js` (append to `describe("A spotlight can never point at nothing")` or a new `describe("Inspection completion retry")`)

**Interfaces:**
- Consumes: `useCoachMarkStatus()` → `{ activeMilestone }`; existing `triggerMilestone("pretrip_complete")`.
- Produces: effect that fires only when `allAnswered && !activeMilestone`, re-evaluated on every milestone transition.

- [ ] **Step 1: Write the failing test**

```js
describe("Inspection completion retry", () => {
  const inspectScreen = readFileSync(
    new URL("../app/(app)/inspection.js", import.meta.url),
    "utf8"
  );

  it("re-fires pretrip_complete once the blocking guide dismisses", () => {
    expect(inspectScreen).toContain('triggerMilestone("pretrip_complete")');
    expect(inspectScreen).toContain("if (allAnswered && !activeMilestone) {");
    expect(inspectScreen).toContain("[allAnswered, activeMilestone, triggerMilestone]");
  });

  it("stays off the volatile state context", () => {
    expect(inspectScreen).toContain("useCoachMarkStatus()");
    expect(inspectScreen).not.toContain("useCoachMarkState()");
    expect(inspectScreen).not.toContain("useCoachMarks()");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/coach-marks.test.js` (from repo root `C:\Users\lenovo\OneDrive\Desktop\capstone`)
Expected: FAIL on `if (allAnswered && !activeMilestone) {` (current source has bare `if (allAnswered) {`).

- [ ] **Step 3: Write minimal implementation**

In `mobile/app/(app)/inspection.js`, change the import:

```js
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from "../../components/coachmarks";
```

Change the hook (line 55):

```js
const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
const { activeMilestone } = useCoachMarkStatus();
```

Change the effect (lines 68-73):

```js
// Complete inspection guidance: triggered when all 7 items are answered.
// Guarded + re-evaluated on milestone transitions so answering everything
// while pretrip/remarks is still open retries after it dismisses instead of
// being refused once and lost.
useEffect(() => {
  if (allAnswered && !activeMilestone) {
    triggerMilestone("pretrip_complete");
  }
}, [allAnswered, activeMilestone, triggerMilestone]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS (all file suites green).

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/inspection.js mobile/lib/coach-marks.test.js
git commit -m "fix(mobile): retry pretrip_complete after blocking guide dismisses"
```

---

### Task 2: Trip fallback branch gains its step-1 target + retry guard

**Files:**
- Modify: `mobile/app/(app)/trip/[id].js:19` (import line)
- Modify: `mobile/app/(app)/trip/[id].js:35` (hook line)
- Modify: `mobile/app/(app)/trip/[id].js:154-163` (trigger effect)
- Modify: `mobile/app/(app)/trip/[id].js:386-396` (no-window fallback branch)
- Test: `mobile/lib/coach-marks.test.js` (extend `describe("Trip Readiness is a pre-start milestone")`)

**Interfaces:**
- Consumes: `readinessFor(trip)` fields (`earliestStart`, `preTripPassed`); `useCoachMarkStatus()` → `{ activeMilestone }`.
- Produces: fallback branch renders BOTH `trip.readiness` and `trip.pretrip_requirement` targets; trigger guarded by `!activeMilestone`.

- [ ] **Step 1: Write the failing test**

```js
it("covers step 2 even with no verified start window", () => {
  const matches = tripScreen.match(/targetId="trip\.pretrip_requirement"/g) || [];
  expect(matches.length).toBeGreaterThanOrEqual(2);
});

it("re-fires trip_readiness once the blocking guide dismisses", () => {
  expect(tripScreen).toContain("if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return;");
  expect(tripScreen).toContain("[loading, trip, isTerminal, isPreStart, activeMilestone, triggerMilestone]");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: FAIL — `trip.pretrip_requirement` appears once today (window-open branch only), and the guard line is absent.

- [ ] **Step 3: Write minimal implementation**

Import + hook:

```js
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from "../../../components/coachmarks";
```

```js
const { triggerMilestone, dismiss } = useCoachMarkActions();
const { activeMilestone } = useCoachMarkStatus();
```

Trigger effect:

```js
useEffect(() => {
  // Pre-start only (see existing comment). Guarded + re-evaluated on
  // milestone transitions so an offline-banner guide open on arrival does not
  // strand this tip.
  if (loading || !trip || isTerminal || !isPreStart || activeMilestone) return;
  triggerMilestone("trip_readiness");
}, [loading, trip, isTerminal, isPreStart, activeMilestone, triggerMilestone]);
```

Fallback branch — replace the single-target fallback (lines 386-396) with two stacked targets, each with its own honest copy (no fabricated window time):

```jsx
) : (
  // No verified start window — say so instead of guessing one. Both steps
  // keep a live target so the milestone can always advance.
  <>
    <CoachMarkTarget targetId="trip.readiness" scrollRef={scrollRef}>
      <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
        <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceVariant} />
        <Text style={[type.supporting, { flexShrink: 1 }]}>
          Start window isn&apos;t confirmed yet. Check with dispatch for your scheduled departure.
        </Text>
      </View>
    </CoachMarkTarget>
    <CoachMarkTarget targetId="trip.pretrip_requirement" scrollRef={scrollRef}>
      <View style={[styles.banner, { backgroundColor: colors.surfaceContainerHighest, borderColor: colors.outlineVariant + "55" }]}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.onSurfaceVariant} />
        <Text style={[type.supporting, { flexShrink: 1 }]}>
          Complete the required pre-trip inspection before departure. The start button unlocks once safety is confirmed.
        </Text>
      </View>
    </CoachMarkTarget>
  </>
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(app)/trip/[id].js" mobile/lib/coach-marks.test.js
git commit -m "fix(mobile): cover trip_readiness step 2 without a start window, retry on dismiss"
```

---

### Task 3: `fuel_scan_intro` retries after a blocking guide dismisses

**Files:**
- Modify: `mobile/app/(app)/fuel-report.js:174-183` (intro trigger effect only — `activeMilestone` is already imported at line 37)
- Test: `mobile/lib/coach-marks.test.js` (new `describe("Fuel intro retry")`)

**Interfaces:**
- Consumes: existing `mode`, `canLogFuel`, `cameraOpen`, `scanning`, `activeMilestone` (already in scope).
- Produces: intro effect guarded by `!activeMilestone` with `activeMilestone` in deps.

- [ ] **Step 1: Write the failing test**

```js
describe("Fuel intro retry", () => {
  const fuelScreen = readFileSync(
    new URL("../app/(app)/fuel-report.js", import.meta.url),
    "utf8"
  );

  it("re-fires fuel_scan_intro once the blocking guide dismisses", () => {
    expect(fuelScreen).toContain('triggerMilestone("fuel_scan_intro")');
    expect(fuelScreen).toContain("canLogFuel &&\n      !cameraOpen &&\n      !scanning &&\n      !activeMilestone");
    expect(fuelScreen).toContain("[mode, canLogFuel, cameraOpen, scanning, activeMilestone, triggerMilestone]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: FAIL on the `!activeMilestone` guard (today the effect checks only `mode && canLogFuel && !cameraOpen && !scanning`).

- [ ] **Step 3: Write minimal implementation**

```js
useEffect(() => {
  if (
    mode === "overview" &&
    canLogFuel &&
    !cameraOpen &&
    !scanning &&
    !activeMilestone
  ) {
    triggerMilestone("fuel_scan_intro");
  }
}, [mode, canLogFuel, cameraOpen, scanning, activeMilestone, triggerMilestone]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/fuel-report.js mobile/lib/coach-marks.test.js
git commit -m "fix(mobile): retry fuel_scan_intro after blocking guide dismisses"
```

---

### Task 4: Scan-card tap completes the intro before opening the camera

**Files:**
- Modify: `mobile/app/(app)/fuel-report.js:994-1008` (scan-card `onPress`)
- Test: `mobile/lib/coach-marks.test.js` (extend `describe("Fuel intro retry")`)

**Interfaces:**
- Consumes: `notifyInteraction("fuel.scan_entry", { action: "open_real_scanner" })` (returns a promise via the stable delegate) and `openReceiptCamera("scan")`.
- Produces: camera opens only after the intro's completion write resolves, so the capture effect (which already guards `!activeMilestone` and already lists it in deps at `fuel-report.js:86-94`) fires first-try instead of relying on its re-fire backstop.

- [ ] **Step 1: Write the failing test**

```js
it("sequences intro completion before the scanner opens", () => {
  expect(fuelScreen).toContain('await notifyInteraction?.("fuel.scan_entry", { action: "open_real_scanner" });');
  expect(fuelScreen).toContain('openReceiptCamera("scan");');
  const seq = fuelScreen.slice(
    fuelScreen.indexOf('await notifyInteraction?.("fuel.scan_entry"'),
    fuelScreen.indexOf('openReceiptCamera("scan");') + 1
  );
  expect(seq.indexOf("await notifyInteraction")).toBeLessThan(seq.indexOf("openReceiptCamera"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: FAIL — today `onPress` calls `notifyInteraction?.(...)` synchronously then `openReceiptCamera("scan")` with no `await`.

- [ ] **Step 3: Write minimal implementation**

```jsx
<ClayCard
  onPress={async () => {
    // Complete the intro first: its storage write is async, and opening the
    // camera synchronously wins the race so the capture trigger sees the
    // intro still active and must rely on its re-fire.
    await notifyInteraction?.("fuel.scan_entry", { action: "open_real_scanner" });
    openReceiptCamera("scan");
  }}
  disabled={scanning}
  style={[styles.methodCard, { backgroundColor: colors.primaryContainer, borderWidth: 1.5, borderColor: colors.primary }]}
>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/fuel-report.js mobile/lib/coach-marks.test.js
git commit -m "fix(mobile): complete fuel intro before opening scanner camera"
```

---

### Task 5: `incident` retries after an overlaying guide dismisses

**Files:**
- Modify: `mobile/app/(app)/incidents.js:18` (import line)
- Modify: `mobile/app/(app)/incidents.js:49-50` (hook line)
- Modify: `mobile/app/(app)/incidents.js:66-71` (trigger effect)
- Test: `mobile/lib/coach-marks.test.js` (new `describe("Incident retry")`)

**Interfaces:**
- Consumes: `useCoachMarkStatus()` → `{ activeMilestone }`; existing `InteractionManager.runAfterInteractions` wrapper stays.
- Produces: incident trigger guarded by `!activeMilestone`, re-evaluated when it changes.

- [ ] **Step 1: Write the failing test**

```js
describe("Incident retry", () => {
  const incidentsScreen = readFileSync(
    new URL("../app/(app)/incidents.js", import.meta.url),
    "utf8"
  );

  it("re-fires incident once the blocking guide dismisses", () => {
    expect(incidentsScreen).toContain('triggerMilestone("incident")');
    expect(incidentsScreen).toContain("if (!activeMilestone) {");
  });

  it("stays off the volatile state context", () => {
    expect(incidentsScreen).toContain("useCoachMarkStatus()");
    expect(incidentsScreen).not.toContain("useCoachMarkState()");
    expect(incidentsScreen).not.toContain("useCoachMarks()");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: FAIL on `if (!activeMilestone) {` (today the effect fires unconditionally after interactions).

- [ ] **Step 3: Write minimal implementation**

Import:

```js
import { useCoachMarkActions, useCoachMarkStatus, CoachMarkTarget } from '../../components/coachmarks';
```

Hook:

```js
const { triggerMilestone, notifyInteraction } = useCoachMarkActions();
const { activeMilestone } = useCoachMarkStatus();
```

Effect (keep the `InteractionManager` wrapper; add the guard + dep):

```js
useEffect(() => {
  const task = InteractionManager.runAfterInteractions(() => {
    if (!activeMilestone) {
      triggerMilestone("incident");
    }
  });
  return () => task?.cancel?.();
}, [activeMilestone, triggerMilestone]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/incidents.js mobile/lib/coach-marks.test.js
git commit -m "fix(mobile): retry incident guide after blocking guide dismisses"
```

---

### Task 6: Full verification — suite, lint, device

**Files:**
- Test: `mobile/lib/coach-marks.test.js` (no new edits; whole file must pass)
- Verify-only (no changes): `welcome`, `sos`, `offline`, `fuel_scan_capture`, `fuel_scan_verify` — capture/verify effects already guard `!activeMilestone` with it in deps; SOS/offline already re-evaluate on `activeMilestone`.

**Interfaces:**
- Consumes: all Tasks 1–5.
- Produces: green suite, clean lint on touched files, device confirmation.

- [ ] **Step 1: Run the full mobile lib suite**

Run: `npx vitest run mobile/lib` (from repo root)
Expected: PASS — every file green, including `coach-marks.test.js`, `map-intro.test.js`, `spotlight-geometry.test.js`.

- [ ] **Step 1b: Pin the perf budget — no screen joins the volatile state context**

Add this block to `mobile/lib/coach-marks.test.js` (new describe; uses the same `readFileSync` style):

```js
describe("Remaining tooltips keep the live-map wake-up-only discipline", () => {
  const entries = {
    inspection: "../app/(app)/inspection.js",
    trip: "../app/(app)/trip/[id].js",
    fuel: "../app/(app)/fuel-report.js",
    incidents: "../app/(app)/incidents.js",
  };

  for (const [name, rel] of Object.entries(entries)) {
    it(`${name} stays off the volatile step-driven context`, () => {
      const src = readFileSync(new URL(rel, import.meta.url), "utf8");
      expect(src).not.toContain("useCoachMarkState()");
      expect(src).not.toContain("useCoachMarks()");
    });
  }

  it("only the map screen and the target itself read step state", () => {
    const mapScreen = readFileSync(
      new URL("../app/(app)/(tabs)/map.js", import.meta.url),
      "utf8"
    );
    const target = readFileSync(
      new URL("../components/coachmarks/CoachMarkTarget.jsx", import.meta.url),
      "utf8"
    );
    expect(mapScreen).toContain("useCoachMarkState()");
    expect(target).toContain("useCoachMarkState()");
  });
});
```

Run: `npx vitest run mobile/lib/coach-marks.test.js`
Expected: PASS — proves Tasks 1–5 added status-only subscriptions (wake up on milestone transitions, like the live-map tooltips) and zero step-driven re-renders.

- [ ] **Step 2: Lint touched files with zero warnings**

Run (PowerShell, quoted paths):

```powershell
npx eslint "mobile/app/(app)/inspection.js" "mobile/app/(app)/trip/[id].js" "mobile/app/(app)/fuel-report.js" "mobile/app/(app)/incidents.js" "mobile/lib/coach-marks.test.js" --max-warnings 0
```

Expected: exit 0. Fix any `react-hooks/exhaustive-deps` or `react/no-unescaped-entities` findings in the touched regions before proceeding.

- [ ] **Step 3: Device confirmation on the Metro dev-client path (no EAS rebuild)**

1. Root terminal: `npm run dev`; mobile terminal: `npm start -- --dev-client --lan`.
2. Fresh state: Profile → Help & Support → Reset In-App Tips.
3. Walk each flow and confirm the spotlight + tooltip present: Home welcome → inspection (PASS one item, FAIL another, answer all 7) → trip detail with and without a start window → fuel request approval → scan-card tap → camera viewfinder → OCR verify → incidents screen → SOS 2s stationary tip → airplane-mode offline banner.
4. Watch logs for `[coachmarks] spotlight not presenting — <reason>`: any line is a failure of this plan — record its `targetId` + `detail` and return to the owning task.
5. Confirm no production mutation: no trip started, no inspection submitted, no fuel posted, no incident sent during the walkthrough.

- [ ] **Step 4: Commit any test-only adjustments separately**

```bash
git add mobile/lib/coach-marks.test.js
git commit -m "test(mobile): pin remaining tooltip retry and target coverage"
```

---

## Self-Review

1. **Spec coverage:** welcome (verify-only, works) → no task needed. `pretrip`/`pretrip_remarks` (delayed retry already covers) → no task. `pretrip_complete` → Task 1. `trip_readiness` missing target + retry → Task 2. `fuel_scan_intro` → Task 3. capture race → Task 4 (ordering) with its existing guard as backstop. `fuel_scan_verify` (guard + dep already present) → verify-only in Task 6. `sos`/`offline` (already recover via `activeMilestone` deps) → verify-only in Task 6. `incident` → Task 5. Map milestones → explicitly out of scope.
2. **Placeholder scan:** every step names exact files, lines, literal strings, commands, and expected outcomes — no TBD/TODO/generic validation steps.
3. **Type consistency:** all new subscriptions use `useCoachMarkStatus()` returning `{ activeMilestone }`; no task introduces `useCoachMarkState`/`useCoachMarks` on pinned screens; `triggerMilestone` deps untouched; storage keys/versions untouched.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-coachmark-remaining-tooltips.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
