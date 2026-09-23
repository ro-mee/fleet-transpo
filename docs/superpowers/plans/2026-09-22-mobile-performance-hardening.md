# Mobile Performance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut unnecessary network/storage work in the mobile driver app — a gated outbox drain, one publish per standby tick, a bounded offline queue — plus reconcile the launch-animation documentation and record a fresh Android bundle measurement.

**Revision (2026-09-22, user decision):** The duty-poll task (originally Task 2 — moving the idle duty GET from 30 s to the 60 s gate) was **removed before execution**: the standby-latency trade-off was not acceptable. The duty GET stays every 30 s as documented. Remaining tasks renumbered; doc-entry texts below reflect the removal.

**Architecture:** Three small, independent changes inside the existing mobile lib layer, each verified by vitest (where the file is pure enough to test) or ESLint + full suite (for RN-coupled hooks, matching how `tracking.js` has always been verified), plus a docs/measurement task. No new dependencies, no cadence changes to GPS posting or duty checks, no UI changes.

**Tech Stack:** Expo SDK 54, RN 0.81.5, React 19.1, vitest (repo root, `vitest.config.mjs` includes `mobile/lib/**`), AsyncStorage in-memory mocks, ESLint, `expo export -p android`.

## Global Constraints

- No new dependencies of any kind.
- GPS contract stays: POST every 30 s (`POST_INTERVAL_MS`), assignment refresh every 60 s (`TRIP_REFRESH_MS`), **idle duty GET every 30 s (unchanged — task removed by user decision)**.
- Queue semantics locked (do not weaken): auth paths and FormData are never queued; incident reports are never dropped on permanent failure (they quarantine to the dead-letter list); drains replay sequentially in order.
- `hasPendingWork()` must fail open while the count is unknown (cold start) — an unknown count allows the drain, which then converges the mirror.
- Outbox cap: **100** (`MAX_QUEUE = 100`), oldest non-incident dropped, incidents exempt (soft cap if all incidents).
- vitest coverage exists only for `mobile/lib/**`; `mobile/components/**` and `mobile/app/**` are verified by ESLint + `expo export` (root `vitest.config.mjs`).
- No fabricated benchmark numbers: bundle figures come verbatim from the export command's output; on-device FPS/cold-start remain explicitly unclaimed.
- Read versioned Expo docs (https://docs.expo.dev/versions/v57.0.0/) before touching any Expo API — this plan should not need to.
- Commit only if the user has explicitly authorized commits; otherwise leave changes in the working tree and say so.
- Task 4 updates the vault notes (`Capstone/…`) and `SYSTEM.md` — mandatory per `.agents/AGENTS.md`.

## Out of Scope (deliberate, with triggers)

- **FlatList conversion** of trips/history/notifications/submissions: revisit when any list routinely exceeds ~50 rows (2026-08-20 audit P2, still deferred).
- **Server-side active-only filter** for the 60 s trips GET: backend contract change; raise separately if field payloads grow.
- **Coach-mark settling-tick pause:** needs its own read of `CoachMarkProvider.jsx` timing code first; not safe to spec blind.
- **TomTomMap.js deep optimization:** 1667-line WebView module; no regression found beyond prop-injection patterns — leave until a device profile implicates it.
- **Focus-fetch deferral (trips/history/vehicle/profile + trip/[id] limit=100 revalidation + notification-feed identity-gated setState):** analyzed 2026-09-22 as the likely remaining tap-delay source; deliberately NOT in this plan (user deferred to focus on these tasks first; also needs release-build measurement before fixing).
- **Duty poll cadence change:** removed by user decision (standby response must stay ≤30 s).

---

### Task 1: Gate the outbox drain on an in-memory pending count

**Files:**
- Modify: `mobile/lib/sync.js` (add `knownPendingCount` + `hasPendingWork`; update `getPendingCount`, `enqueueRequest`, `syncQueue`)
- Modify: `mobile/lib/api.js:9` (import) and `mobile/lib/api.js:315-321` (drain gate)
- Create: `mobile/lib/sync.test.js`

**Interfaces:**
- Consumes: existing `enqueueRequest`, `syncQueue`, `getPendingCount`, `setApiFetch` from `sync.js`; `apiFetch` flow in `api.js`.
- Produces: `hasPendingWork(): boolean` exported from `sync.js` — returns `true` while the count is unknown (`null`) or `> 0`; `false` only after a known-zero count. `api.js` calls it instead of always calling `syncQueue()`.

- [ ] **Step 1: Write the failing tests**

Create `mobile/lib/sync.test.js`:

```js
/**
 * Outbox gate tests (sync.js): hasPendingWork() mirror + drain convergence.
 * AsyncStorage is an in-memory Map; apiFetch is injected (sync.js must never
 * import api.js). What is real: fail-open startup, enqueue/drain convergence.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const mem = new Map();
  return {
    default: {
      getItem: vi.fn(async (k) => (mem.has(k) ? mem.get(k) : null)),
      setItem: vi.fn(async (k, v) => {
        mem.set(k, v);
      }),
      removeItem: vi.fn(async (k) => {
        mem.delete(k);
      }),
      __clear: () => mem.clear(),
    },
  };
});

async function freshSync() {
  vi.resetModules();
  const mod = await import("./sync");
  const store = (await import("@react-native-async-storage/async-storage")).default;
  store.__clear();
  return { mod, store };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hasPendingWork", () => {
  it("fails open before the first count is known", async () => {
    const { mod } = await freshSync();
    expect(mod.hasPendingWork()).toBe(true);
  });

  it("is false after counting an empty queue", async () => {
    const { mod } = await freshSync();
    expect(await mod.getPendingCount()).toBe(0);
    expect(mod.hasPendingWork()).toBe(false);
  });

  it("flips true on enqueue and false after a successful drain", async () => {
    const { mod } = await freshSync();
    const apiFetch = vi.fn(async () => ({ ok: true }));
    mod.setApiFetch(apiFetch);

    await mod.enqueueRequest("POST", "/api/mobile/driver/trips/1/status", {
      status: "Started",
    });
    expect(mod.hasPendingWork()).toBe(true);
    expect(await mod.getPendingCount()).toBe(1);

    await mod.syncQueue();
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(mod.hasPendingWork()).toBe(false);
    expect(await mod.getPendingCount()).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from repo root: `npx vitest run mobile/lib/sync.test.js`
Expected: FAIL — `hasPendingWork` is not exported.

- [ ] **Step 3: Add the mirror to `sync.js`**

After the `let isSyncing = false;` line, insert:

```js
// In-memory mirror of the outbox length so api.js can skip the AsyncStorage
// read + JSON.parse on every successful request. null = not yet known (cold
// start): hasPendingWork() fails open, allows one drain, and the drain or
// the first getPendingCount() converges the mirror.
let knownPendingCount = null;

/**
 * Whether the outbox may hold work worth draining. Fails open while the
 * count is unknown so a pre-existing queue is never stranded by this gate.
 */
export function hasPendingWork() {
  return knownPendingCount === null || knownPendingCount > 0;
}
```

- [ ] **Step 4: Converge the mirror at every write site in `sync.js`**

In `getPendingCount`, set the mirror from the parsed length:

```js
export async function getPendingCount() {
  if (!isReady()) return 0;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = raw ? JSON.parse(raw) : [];
    const count = Array.isArray(queue) ? queue.length : 0;
    knownPendingCount = count;
    return count;
  } catch {
    return 0;
  }
}
```

In `enqueueRequest`, after the `setItem` and before `notifySync`:

```js
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
    knownPendingCount = queue.length;
    console.log(`[Sync] Queued ${method} ${path}`);
    notifySync({ pendingCount: queue.length });
```

In `syncQueue`, both empty early-exits and the post-loop:

```js
    const queueStr = await AsyncStorage.getItem(QUEUE_KEY);
    if (!queueStr) {
      knownPendingCount = 0;
      return;
    }

    let queue = JSON.parse(queueStr);
    if (!Array.isArray(queue) || queue.length === 0) {
      knownPendingCount = 0;
      return;
    }
```

```js
    // Save any remaining items back to the queue
    knownPendingCount = remainingQueue.length;
    if (remainingQueue.length !== queue.length) {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remainingQueue));
    }
    notifySync({ syncActive: false, pendingCount: remainingQueue.length });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run from repo root: `npx vitest run mobile/lib/sync.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Gate the drain in `api.js`**

Line 9 becomes:

```js
import { enqueueRequest, syncQueue, setApiFetch, hasPendingWork } from "./sync";
```

Replace lines 315-321 (the dead if/else that always drained) with:

```js
  // Drain the outbox only when something is waiting. The old code hit
  // AsyncStorage (read + JSON.parse) after EVERY success — both branches of
  // the if/else were identical — for a queue that is empty almost always.
  // hasPendingWork() fails open while the count is unknown, so the first
  // success after cold start still drains and converges the mirror.
  if (hasPendingWork()) {
    syncQueue().catch(() => {});
  }
```

- [ ] **Step 7: Run the full mobile suite to catch regressions**

Run from repo root: `npx vitest run mobile/lib`
Expected: all files PASS (including the existing `api-refresh.test.js`, which exercises `apiFetch` end-to-end and must stay green).

- [ ] **Step 8: ESLint the touched files**

Run: `npx eslint mobile/lib/api.js mobile/lib/sync.js mobile/lib/sync.test.js --max-warnings 0`
Expected: no output (clean).

- [ ] **Step 9: Commit (only if the user authorized commits)**

```bash
git add mobile/lib/sync.js mobile/lib/api.js mobile/lib/sync.test.js
git commit -m "perf(mobile): gate outbox drain on in-memory pending count"
```

---

### Task 2: Publish standby status once per tick instead of twice

**Files:**
- Modify: `mobile/lib/tracking.js:305-315` (standby branch + trailing publish)

**Interfaces:**
- Consumes: existing `publishStatus`, `posterStatus` fields (`standbyObservedAt`, `lastSentAt`, `error`), `responderIncidentId`, `tripId`.
- Produces: per tick — trip path: one full publish (unchanged); responder path: one `lastSentAt` publish (unchanged); standby path: ONE combined publish carrying `standbyObservedAt` + `lastSentAt` + `error: null` (previously two).

**Why no new unit test:** `tracking.js` imports `expo-location` / `@react-navigation` / the api client and has never been in the vitest include list; every prior change to it was verified by ESLint + full suite (repo precedent). The behavioral trace is spelled out in Step 4.

- [ ] **Step 1: Merge the standby publish and narrow the trailing publish**

Replace `tracking.js:305-315` with:

```js
          } else {
            const res = await api.post('/api/mobile/driver/standby-location', {
              latitude: loc.coords.latitude, longitude: loc.coords.longitude,
              accuracy: loc.coords.accuracy, recorded_at: new Date(loc.timestamp).toISOString(),
            }, { queueOnFailure: false });
            if (!cancelled) {
              publishStatus({
                standbyObservedAt: res?.observedAt ?? null,
                lastSentAt: new Date().toISOString(),
                error: null,
              });
            }
          }
          // The trip branch publishes its full payload above; the responder
          // path carries no other publish, so it gets lastSentAt here.
          // Standby must be excluded: its branch already published — the old
          // `!tripId` condition covered standby too and re-rendered every
          // subscriber twice per 30s standby tick for free.
          if (!cancelled && responderIncidentId && !tripId) {
            publishStatus({ lastSentAt: new Date().toISOString(), error: null });
          }
```

- [ ] **Step 2: ESLint the file**

Run: `npx eslint mobile/lib/tracking.js --max-warnings 0`
Expected: no output (clean).

- [ ] **Step 3: Run the full mobile suite**

Run from repo root: `npx vitest run mobile/lib`
Expected: all PASS.

- [ ] **Step 4: Publish-count trace (reviewer checklist — mutually exclusive branches, one publish each)**

1. `tripId` set → full publish in trip branch; trailing condition false (`!tripId` fails) → **1 publish**.
2. `responderIncidentId` set (no trip) → no publish in responder branch; trailing condition true → **1 publish**.
3. Standby (no trip, no responder, checked in) → combined publish in standby branch; trailing condition false (`responderIncidentId` null) → **1 publish**.
4. Error path (post threw) → catch publishes `{ error: … }` only → **1 publish**.

- [ ] **Step 5: Commit (only if the user authorized commits)**

```bash
git add mobile/lib/tracking.js
git commit -m "perf(mobile): stop double-publishing standby status each tick"
```

---

### Task 3: Bound the offline outbox at 100 entries, never dropping incidents

**Files:**
- Modify: `mobile/lib/sync.js` (add `MAX_QUEUE`; enforce in `enqueueRequest`)
- Modify: `mobile/lib/sync.test.js` (append cap describe block)

**Interfaces:**
- Consumes: `isIncidentReport` (already in `sync.js`), `MAX_QUEUE = 100` (new module constant).
- Produces: `enqueueRequest` never leaves more than 100 entries unless every entry is an incident (soft cap — safety records always win); `knownPendingCount` reflects the post-cap length.

- [ ] **Step 1: Write the failing tests**

Append to `mobile/lib/sync.test.js`:

```js
describe("outbox cap", () => {
  it("drops the oldest non-incident once the cap is exceeded", async () => {
    const { mod, store } = await freshSync();
    for (let i = 0; i < 101; i++) {
      await mod.enqueueRequest("POST", "/api/mobile/driver/trips/1/status", { i });
    }
    const queue = JSON.parse(await store.getItem("@offline_queue"));
    expect(queue).toHaveLength(100);
    expect(queue[0].body.i).toBe(1); // i=0 was the oldest and was dropped
    expect(mod.hasPendingWork()).toBe(true);
  });

  it("never drops an incident report, even past the cap", async () => {
    const { mod, store } = await freshSync();
    await mod.enqueueRequest("POST", "/api/driver/incidents", { kind: "collision" });
    for (let i = 0; i < 101; i++) {
      await mod.enqueueRequest("PUT", "/api/mobile/driver/trips/1/status", { i });
    }
    const queue = JSON.parse(await store.getItem("@offline_queue"));
    expect(queue).toHaveLength(100);
    expect(queue.some((r) => r.path === "/api/driver/incidents")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run mobile/lib/sync.test.js`
Expected: the two new tests FAIL (no cap exists yet — 101 and 102 entries respectively).

- [ ] **Step 3: Implement the cap**

In `sync.js`, next to `QUEUE_KEY`, add:

```js
// Bound the outbox: a long offline stretch grew one JSON array without
// limit (storage-quota risk). Incidents are safety records and are never
// dropped; the oldest non-incident action goes first.
const MAX_QUEUE = 100;
```

In `enqueueRequest`, after `queue.push({...})` and before `await AsyncStorage.setItem(...)`:

```js
    while (queue.length > MAX_QUEUE) {
      const victim = queue.findIndex((item) => !isIncidentReport(item));
      if (victim === -1) break; // all incidents — soft cap, keep them all
      console.warn(
        `[Sync] Dropping oldest queued ${queue[victim].method} ${queue[victim].path} (outbox cap ${MAX_QUEUE})`
      );
      queue.splice(victim, 1);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run mobile/lib/sync.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Run the full mobile suite + ESLint**

Run from repo root: `npx vitest run mobile/lib` then `npx eslint mobile/lib/sync.js mobile/lib/sync.test.js --max-warnings 0`
Expected: all PASS, ESLint clean.

- [ ] **Step 6: Commit (only if the user authorized commits)**

```bash
git add mobile/lib/sync.js mobile/lib/sync.test.js
git commit -m "perf(mobile): cap offline outbox at 100, incidents exempt"
```

---

### Task 4: Fresh Android export + reconcile the launch-animation docs

**Files:**
- Modify: `Capstone/01 - System/UI UX Audit - Mobile.md` (stale Round 7 claim + new Round 9 entry)
- Modify: `Capstone/04 - Architecture/Mobile Architecture.md` (gated drain, queue cap, standby publish)
- Modify: `SYSTEM.md` (new top entry, exact text in Step 4)

**Interfaces:**
- Consumes: Tasks 1-3 (their final state), export command output.
- Produces: recorded bundle numbers; vault notes matching the code; `SYSTEM.md` entry.

**Grounded facts (already verified this session — do not re-litigate):**
- `LaunchScreen.js:133` contains `require("../assets/car animation.json")`; `launch-animation.test.js:37` asserts `source` contains `car animation.json`. The car Lottie is **restored** (2026-09-19/20, per Mobile Architecture + SYSTEM.md entry "Mobile startup car animation restoration").
- The Round 7 audit entry (which says the Lottie was *removed* and cites a 4.58 MB bundle with no car asset) is therefore **stale**, superseded by the restoration.
- **Duty GET stays every 30 s** — the cadence-change task was removed by user decision; no duty bullet goes into Mobile Architecture.

- [ ] **Step 1: Run the Android export and capture the numbers verbatim**

Run from `mobile/`: `npx expo export --platform android`
Record the printed modules / assets / Hermes MB exactly as printed. Do not estimate or reuse older figures.

- [ ] **Step 2: Fix the stale Round 7 claim and append Round 9 in `Capstone/01 - System/UI UX Audit - Mobile.md`**

In the Round 7 section, directly under its heading, insert:

> **Superseded:** the car Lottie was **restored** on 2026-09-19 (see `Capstone/04 - Architecture/Mobile Architecture.md` § Launch Screen and `SYSTEM.md` "Mobile startup car animation restoration"); `launch-animation.test.js:37` now pins its inclusion. The 4.58 MB / no-car-asset figures below describe only the brief removal window and are not current.

Append at end of file:

```markdown
---

## Changes Applied — Round 9 (2026-09-22, Performance Hardening)

Static re-analysis pass (source-level; no device in environment). Plan: `docs/superpowers/plans/2026-09-22-mobile-performance-hardening.md`. Scope revised during planning: the idle-duty-to-60s task was **dropped by user decision** (standby response must stay ≤30 s); duty GET cadence unchanged.

| # | Bottleneck | File(s) | Fix Applied |
|---|------------|---------|-------------|
| 1 | Outbox drain hit AsyncStorage (read + JSON.parse) after **every** API success — dead if/else, queue empty almost always | `lib/sync.js`, `lib/api.js` | In-memory `knownPendingCount` mirror + `hasPendingWork()` gate; fails open while unknown (cold start), converges on enqueue/drain/count. New `sync.test.js`. |
| 2 | Standby path published status **twice** per tick (`!tripId` trailing publish also covered standby) — duplicate re-render of every subscriber each 30 s | `lib/tracking.js` | Standby's publish carries `lastSentAt` itself; trailing publish narrowed to responder-only. |
| 3 | Offline outbox unbounded (one JSON array, storage-quota risk on long offline stretches) | `lib/sync.js` | Cap 100; oldest non-incident dropped with a warn; incidents never dropped (soft cap if all incidents). |
| 4 | Round 7 claims the car Lottie is removed; it was restored 2026-09-19 (doc/code mismatch) | this note | Round 7 marked superseded; code + `launch-animation.test.js` are source of truth. |

**Verification:** `npx vitest run mobile/lib` all green (incl. new `sync.test.js`: fail-open gate, enqueue/drain convergence, cap + incident exemption); ESLint `--max-warnings 0` on touched files; Android export: <numbers recorded from Step 1>. On-device FPS / cold-start: **not claimed** (no device).

**Analyzed, not fixed this round (2026-09-22 tap-delay review):** focus-fetches on trips/history/vehicle/profile fire synchronously with no staleness guard (Home's `runAfterInteractions` + 30 s pattern was never ported); `trip/[id]` revalidates `?status=all&limit=100` during the push transition; `notification-feed.jsx` calls `setNotifications(list)` unconditionally every 30 s (new array identity → header re-render). Likely secondary: dev-build timing (release build not measured). Deferred pending a release-build measurement.

**Deferred with triggers:** FlatList lists if any list routinely exceeds ~50 rows; server-side active-only filter for the 60 s trips GET if field payloads grow; coach-mark settling-tick pause pending its own provider read; TomTomMap.js only if a device profile implicates it.
```

- [ ] **Step 3: Update `Capstone/04 - Architecture/Mobile Architecture.md`**

Under `## GPS tracking — CONFIRMED`, after the foreground/background bullets, add:

```markdown
- **Single publish per tick (2026-09-22):** trip → one full publish; responder → one `lastSentAt` publish; standby → one combined `{standbyObservedAt, lastSentAt, error:null}` publish (the old trailing `!tripId` publish double-fired on standby and re-rendered all subscribers every 30 s). Idle duty GET cadence is unchanged (every 30 s — a move onto the 60 s gate was planned and explicitly rejected to keep standby response ≤30 s).
```

Under `## Connectivity UX — PR #3.1 (2026-09-08)`, append:

```markdown
- **Outbox gate + cap (2026-09-22):** `sync.js` keeps an in-memory `knownPendingCount` with fail-open `hasPendingWork()`; `api.js` only calls `syncQueue()` when work may exist (was: every success, dead if/else). The queue is capped at 100 — oldest non-incident dropped with a warn, incidents never dropped (soft cap if all incidents). Semantics otherwise locked: auth/FormData never queued, sequential drain, incident dead-letter quarantine.
```

- [ ] **Step 4: Add the `SYSTEM.md` entry**

Insert directly below the `# FleetOps …` title line (newest-entry convention), exactly:

```markdown
**Mobile performance hardening (2026-09-22, implemented):** Static re-analysis of the driver app's network/tracking/cache layer turned three costs into fixes, one doc mismatch into a correction. (1) **Outbox drain was unconditional** — `api.js` called `syncQueue()` after *every* success (both branches of its if/else identical), paying an AsyncStorage read + JSON parse for a queue that is empty almost always; `sync.js` now keeps an in-memory `knownPendingCount` with fail-open `hasPendingWork()` (unknown count allows one drain, which converges the mirror) and the drain is gated on it. (2) **Standby double-published per tick** — the trailing `!tripId` publish covered standby too, re-rendering every subscriber twice each 30 s; standby's own publish now carries `lastSentAt` and the trailing publish is responder-only. (3) **Offline outbox was unbounded** — capped at 100 (user-confirmed), oldest non-incident dropped with a warn, incidents never dropped (soft cap if all incidents). (4) Doc mismatch: the Round 7 audit claim that the car Lottie was removed is superseded by its 2026-09-19 restoration (`LaunchScreen.js:133`, pinned by `launch-animation.test.js:37`); audit note corrected. A planned fourth change — moving the idle duty GET onto the 60 s assignment gate — was **dropped before execution by user decision** (standby response must stay ≤30 s); duty cadence unchanged. Also analyzed and deliberately deferred pending a release-build measurement: focus-fetches on trips/history/vehicle/profile with no staleness guard, `trip/[id]`'s `limit=100` revalidation during push, and `notification-feed.jsx`'s unconditional `setNotifications` every 30 s (see audit Round 9). Plan: `docs/superpowers/plans/2026-09-22-mobile-performance-hardening.md`. Docs: UI UX Audit - Mobile.md (Round 9), Mobile Architecture.md. Verification: `npx vitest run mobile/lib` green incl. new `sync.test.js`; ESLint `--max-warnings 0` on touched files; Android export recorded in the audit note (numbers verbatim from the run). On-device FPS/cold-start not claimed — no device in environment.
```

- [ ] **Step 5: Re-run the full suite + export as the final gate**

Run from repo root: `npx vitest run mobile/lib`
Run from `mobile/`: `npx eslint mobile/lib/api.js mobile/lib/sync.js mobile/lib/tracking.js mobile/lib/sync.test.js --max-warnings 0` and `npx expo export --platform android`
Expected: tests PASS, ESLint clean, export succeeds (same numbers as Step 1 — if they differ, record the newer run).

- [ ] **Step 6: Commit (only if the user authorized commits)**

```bash
git add "Capstone/01 - System/UI UX Audit - Mobile.md" "Capstone/04 - Architecture/Mobile Architecture.md" SYSTEM.md docs/superpowers/plans/2026-09-22-mobile-performance-hardening.md
git commit -m "docs: record mobile performance hardening round 9 + plan"
```

---

## Self-Review Record

- **Spec coverage:** the three surviving code findings (gated drain, standby publish, queue cap) have tasks; duty-cadence task removed by explicit user decision and recorded in header, Global Constraints, Task 4 texts, and Out of Scope; the launch-doc mismatch + bundle measurement + mandatory vault/System.md updates are Task 4. Out-of-scope items (including the 2026-09-22 tap-delay analysis) are listed with explicit triggers rather than silently dropped.
- **Placeholder scan:** every code step contains full code; verification steps name exact commands and expected outcomes; the only inserted-at-execution values are export numbers (must come verbatim from the run — fabricated figures are forbidden by Global Constraints).
- **Type consistency:** `hasPendingWork()` is defined in Task 1 and consumed identically in `api.js` and Task 3's tests; `MAX_QUEUE`, `knownPendingCount`, `isIncidentReport` all match across tasks; `freshSync()` helper defined in Task 1 is reused by Task 3's tests.
