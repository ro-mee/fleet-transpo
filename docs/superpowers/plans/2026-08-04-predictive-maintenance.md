# Predictive Maintenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the calendar-reminder "predictive maintenance" feature into a real prediction — two independent due-dates per vehicle (time and mileage), projected against a measured km/day burn rate — and fix the seven defects that make the current version read as empty rather than wrong.

**Architecture:** A pure-function engine (`src/lib/ai/predictive-maintenance.js`, no I/O) does all scoring. A single server endpoint (`GET /api/ai/predictive-maintenance`) runs one CTE query for usage and history, pipes rows through the engine, and returns rows plus a precomputed `summary`. The client service becomes a thin fetch. Odometer readings from trip start/complete write back to `vehicles.mileage`, which is what makes any mileage-based prediction non-stale.

**Tech Stack:** Next.js 16.2.11 (App Router route handlers), React 19.2.4, PostgreSQL via `pg` 8.22, TanStack Query 5, Vitest (added by Task 1), Tailwind 4.

## Global Constraints

- Risk bands are **lowercase** and exported from one shared constant. Never type a band string in two files.
- Band boundaries: `overdue` < 0, `critical` 0–7, `high` 8–30, `medium` 31–90, `low` > 90 days.
- `kmPerDay` divides `km_90d` by the **calendar window (90)**, never by `active_days`.
- Usage window: 90 days. Confidence floor: fewer than 5 completed trips, or zero distance, means `confidence: "low"` and no mileage projection.
- No `Math.max(0, ...)` clamp on day counts — overdue vehicles must report negative days.
- A dimension with no data does not participate in the `min()`; it is not treated as zero.
- The engine file performs **no I/O** — no `query`, no `fetch`, no `Date.now()` outside an injectable `now` parameter. (`@/lib/dates` is pure and may be imported.)
- All date normalization goes through `toCalendarDay` from `@/lib/dates`. Never `.toISOString().slice(0,10)` and never `getUTCDate()` on a value that came from the database: `pg` returns DATE columns as Dates at **local** midnight, so UTC reads shift the day backward at positive offsets and every day count lands one day early at UTC+8. `src/lib/dates.js:7` documents this as having already bitten this codebase.
- Date fixtures in tests are built from local components (`new Date(2026, 7, 4)`), not `new Date("2026-08-04T00:00:00Z")` — the latter is the previous day in negative-offset zones and would make assertions depend on where the suite runs.
- Odometer write-back uses `GREATEST(mileage, $1)`. Mileage must never walk backwards.
- Implausible odometer jump threshold: **1,500 km** in one trip.
- Migration file: `supabase/migrations/018_predictive_maintenance.sql`, wrapped in `BEGIN;`/`COMMIT;` (required by `scripts/apply-sql.mjs`), guarded with `IF NOT EXISTS`.
- Never interpolate raw request-body keys into SQL. Explicit column allowlists only.
- `GET /api/ai/predictive-maintenance` is gated `requireAuth(req, ["system_admin", "admin", "fleet_manager"])`.
- Read `node_modules/next/dist/docs/` before touching route or page conventions — this Next.js version differs from training data (`AGENTS.md`).
- `getPredictiveMaintenance()` keeps its exported name and signature; all four call sites stay unedited.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `vitest.config.mjs` | Test runner config; maps the `@/` alias to `./src`. |
| `supabase/migrations/018_predictive_maintenance.sql` | Adds `service_interval_km` / `service_interval_days` to `vehicles`. |
| `src/lib/ai/predictive-maintenance.js` | Pure engine: risk constants, usage rate, due-date resolution, risk band, health score, per-row prediction, sort, summary. |
| `src/lib/ai/predictive-maintenance.test.js` | Engine unit tests. No DB. |
| `src/app/api/ai/predictive-maintenance/route.js` | `GET`: role gate, one CTE query, engine pass, sorted rows + summary. |
| `src/services/maintenance-schedule.service.js` | `recomputeVehicleSchedule(vehicleId, maintenanceRow)` — derives next due from interval on completion. |
| `src/lib/vehicles/odometer.js` | Pure odometer validation: reject below-current readings, flag >1,500 km jumps. |
| `src/lib/vehicles/odometer.test.js` | Odometer validation unit tests. |

**Modified**

| Path | Change |
|---|---|
| `package.json` | `devDependencies`: vitest; `scripts`: `test`, `test:run`. |
| `src/services/ai.service.js:51-78` | `getPredictiveMaintenance()` becomes a one-line `apiFetch`. |
| `src/lib/ai/rule-engine.js:10-57` | Delete `calculatePredictiveMaintenance()`. `generateFleetInsights()` stays. |
| `src/app/api/trips/[id]/start/route.js:48` | Odometer validation + `vehicles.mileage` write-back. |
| `src/app/api/trips/[id]/complete/route.js:19` | Same. |
| `src/app/api/vehicle-maintenance/route.js:5-22,65-72` | Field mapping, column allowlist, schedule recompute on `Completed`. |
| `src/app/api/vehicle-maintenance/[id]/route.js:25-31` | Column allowlist + recompute on transition to `Completed`. |
| `src/app/api/vehicles/route.js:6-22` | Accept the two interval fields. |
| `src/lib/validation/schemas.js:38-77` | `vehicleSchema` gains the two interval fields. |
| `src/app/(dashboard)/fleet/vehicles/new/page.js` | Service-interval inputs. |
| `src/app/(dashboard)/fleet/vehicles/[id]/page.js:209-211` | Show resolved next-service basis. |
| `src/app/(dashboard)/maintenance/predictive/page.js` | Read `summary`; render basis, confidence, overdue. |
| `src/app/(dashboard)/ai/predictive-maintenance/page.js` | Redirect to `/maintenance/predictive`. |

---

## Task 1: Test harness

The repo has no test runner. Everything downstream depends on this.

- [ ] **Step 1.1 — Install Vitest**

```bash
npm install --save-dev vitest@^3
```

- [ ] **Step 1.2 — Write `vitest.config.mjs`**

The `@/` alias comes from `jsconfig.json`, which Vitest does not read. Map it explicitly or every engine import fails.

```js
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
```

- [ ] **Step 1.3 — Add scripts to `package.json`**

```json
"test": "vitest",
"test:run": "vitest run"
```

- [ ] **Step 1.4 — Prove the harness runs**

Create `src/lib/harness.test.js`:

```js
import { describe, it, expect } from "vitest";

describe("harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

Run `npm run test:run`. Expect 1 passing test. Then **delete `src/lib/harness.test.js`** — it was a harness check, not a kept test.

- [ ] **Step 1.5 — Commit**

```bash
git add -A && git commit -m "test: add vitest harness with @/ alias"
```

---

## Task 2: Migration — per-vehicle service intervals

- [ ] **Step 2.1 — Write `supabase/migrations/018_predictive_maintenance.sql`**

Two nullable columns. Nullable is deliberate: NULL means "this dimension does not participate in the prediction," which is different from 0 and is exactly what the engine's dimension-exclusion rule needs. Defaults are seeded only where the column is NULL, so a re-apply cannot overwrite a fleet manager's tuning.

```sql
-- ============================================
-- MIGRATION 018: Per-Vehicle Service Intervals
--
-- Predictive maintenance needs to answer "when is this vehicle next due"
-- along two independent axes: elapsed days and accumulated kilometres. The
-- existing next_service_date / next_service_mileage columns hold the *answer*
-- but nothing holds the *rule*, so once a service completes there is no way to
-- derive the following one — someone has to retype both fields by hand, and
-- when they don't, the vehicle silently stops being predicted.
--
-- These two columns hold that rule per vehicle. Per-vehicle rather than a
-- policy table keyed on category, because vehiclecategories encodes guest tier
-- (VIP / guest / ops / staff), not mechanical duty cycle — a VIP sedan and an
-- ops sedan share a service interval while a VIP sedan and a VIP coaster do
-- not. Two vans off the same lot also legitimately differ once one draws the
-- airport run: interval is a property of the individual vehicle.
--
-- NULL is meaningful and is NOT the same as 0: it means this axis does not
-- participate in the prediction. A vehicle with service_interval_km NULL is
-- predicted on days alone rather than being treated as due at 0 km. Both NULL
-- yields basis: null and is reported, not silently scored as healthy.
--
-- Purely additive: two nullable columns, one backfill of NULLs only. Alters no
-- existing values. Rollback is two DROP COLUMN statements.
--
-- House convention: guarded ADD COLUMN, wrapped in a transaction.
-- ============================================

BEGIN;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS service_interval_km   INT,
  ADD COLUMN IF NOT EXISTS service_interval_days INT;

COMMENT ON COLUMN vehicles.service_interval_km IS
  'Kilometres between services. NULL = do not predict on mileage.';
COMMENT ON COLUMN vehicles.service_interval_days IS
  'Days between services. NULL = do not predict on elapsed time.';

-- Seed a conventional PMS interval so existing vehicles start predicting
-- immediately. Guarded on IS NULL: a re-apply never clobbers tuned values.
UPDATE vehicles
   SET service_interval_km = 5000
 WHERE service_interval_km IS NULL
   AND deleted_at IS NULL;

UPDATE vehicles
   SET service_interval_days = 180
 WHERE service_interval_days IS NULL
   AND deleted_at IS NULL;

COMMIT;
```

- [ ] **Step 2.2 — Apply and verify**

```bash
node scripts/apply-sql.mjs supabase/migrations/018_predictive_maintenance.sql
```

Confirm the columns exist and are populated:

```sql
SELECT vehicle_id, service_interval_km, service_interval_days FROM vehicles LIMIT 5;
```

Every row must show `5000` / `180`, not NULL. If they are NULL the `UPDATE` did not match — check `deleted_at`.

- [ ] **Step 2.3 — Commit**

```bash
git add -A && git commit -m "feat(db): add per-vehicle service interval columns"
```

---

## Task 3: Prediction engine — constants and usage rate

**Files:**
- Create: `src/lib/ai/predictive-maintenance.js`
- Test: `src/lib/ai/predictive-maintenance.test.js`

**Interfaces:**
- Consumes: nothing (first engine task).
- Produces:
  - `RISK` — frozen object `{ OVERDUE: "overdue", CRITICAL: "critical", HIGH: "high", MEDIUM: "medium", LOW: "low" }`
  - `USAGE_WINDOW_DAYS` — `90`
  - `MIN_TRIPS_FOR_CONFIDENCE` — `5`
  - `computeUsageRate({ km_90d, trip_count, active_days })` → `{ kmPerDay, tripCount, activeDays, confidence }`

- [ ] **Step 3.1 — Write the failing test**

Create `src/lib/ai/predictive-maintenance.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  RISK,
  USAGE_WINDOW_DAYS,
  MIN_TRIPS_FOR_CONFIDENCE,
  computeUsageRate,
} from "@/lib/ai/predictive-maintenance";

describe("constants", () => {
  it("exposes lowercase risk bands", () => {
    expect(RISK).toEqual({
      OVERDUE: "overdue",
      CRITICAL: "critical",
      HIGH: "high",
      MEDIUM: "medium",
      LOW: "low",
    });
  });

  it("uses a 90 day window and a 5 trip confidence floor", () => {
    expect(USAGE_WINDOW_DAYS).toBe(90);
    expect(MIN_TRIPS_FOR_CONFIDENCE).toBe(5);
  });
});

describe("computeUsageRate", () => {
  it("divides distance by the calendar window, not by active days", () => {
    // 600 km over 5 active days = 120 km per *active* day but 6.67 per
    // calendar day. Projecting a future date is a calendar question, so
    // dividing by active_days would overstate the burn rate by the idle ratio
    // and pull every due date forward.
    const usage = computeUsageRate({ km_90d: 600, trip_count: 5, active_days: 5 });
    expect(usage.kmPerDay).toBeCloseTo(600 / 90, 5);
    expect(usage.activeDays).toBe(5);
  });

  it("marks high confidence at the trip floor", () => {
    const usage = computeUsageRate({ km_90d: 900, trip_count: 5, active_days: 20 });
    expect(usage.confidence).toBe("high");
  });

  it("marks low confidence below the trip floor", () => {
    const usage = computeUsageRate({ km_90d: 900, trip_count: 4, active_days: 3 });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
  });

  it("marks low confidence when trips exist but cover zero distance", () => {
    const usage = computeUsageRate({ km_90d: 0, trip_count: 12, active_days: 9 });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
  });

  it("treats missing usage rows as low confidence rather than throwing", () => {
    // A vehicle with no trips in the window LEFT JOINs to all NULLs.
    const usage = computeUsageRate({ km_90d: null, trip_count: null, active_days: null });
    expect(usage.confidence).toBe("low");
    expect(usage.kmPerDay).toBe(0);
    expect(usage.tripCount).toBe(0);
  });

  it("coerces numeric strings, which is what pg returns for SUM", () => {
    // node-postgres returns DECIMAL/BIGINT aggregates as strings. Unguarded,
    // "900" / 90 works but "900" + 0 does not, and tripCount comparisons
    // against a string silently misbehave.
    const usage = computeUsageRate({ km_90d: "900", trip_count: "10", active_days: "30" });
    expect(usage.kmPerDay).toBeCloseTo(10, 5);
    expect(usage.tripCount).toBe(10);
    expect(usage.confidence).toBe("high");
  });
});
```

- [ ] **Step 3.2 — Run to verify it fails**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: FAIL — `Failed to resolve import "@/lib/ai/predictive-maintenance"`.

- [ ] **Step 3.3 — Write the minimal implementation**

Create `src/lib/ai/predictive-maintenance.js`:

```js
/**
 * Predictive maintenance engine.
 *
 * Pure functions only — no database, no fetch, no ambient clock. Every input
 * arrives as an argument, including `now`, so each risk band boundary can be
 * tested exactly rather than approximately. The endpoint in
 * src/app/api/ai/predictive-maintenance/route.js does the I/O and pipes rows
 * through here.
 */

/** Lowercase, and defined once. Both the engine and the pages import this. */
export const RISK = Object.freeze({
  OVERDUE: "overdue",
  CRITICAL: "critical",
  HIGH: "high",
  MEDIUM: "medium",
  LOW: "low",
});

/** Trailing window for the usage-rate query, in days. */
export const USAGE_WINDOW_DAYS = 90;

/**
 * Below this many completed trips in the window there is no trustworthy burn
 * rate. A projection from two trips is a guess wearing a number's clothes;
 * presenting it with the same authority as one backed by 90 days of trips is
 * worse than not predicting at all.
 */
export const MIN_TRIPS_FOR_CONFIDENCE = 5;

/** pg returns SUM/COUNT as strings. Coerce, and treat unusable input as 0. */
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Derives km/day from a vehicle's trailing-window trip totals.
 *
 * kmPerDay divides by USAGE_WINDOW_DAYS — the calendar window — and not by
 * active_days. A vehicle that drives 600 km across 5 days averages 120 km per
 * active day but 6.7 km per calendar day; since a due-date projection is a
 * question about calendar days, dividing by active_days would overstate the
 * rate by the vehicle's idle ratio. activeDays is still returned: it is a
 * useful utilisation figure and distinguishes one long haul from steady daily
 * use, but it is not the projection denominator.
 */
export function computeUsageRate({ km_90d, trip_count, active_days } = {}) {
  const km = num(km_90d);
  const tripCount = num(trip_count);
  const activeDays = num(active_days);

  const hasEnoughTrips = tripCount >= MIN_TRIPS_FOR_CONFIDENCE;
  const hasDistance = km > 0;
  const confidence = hasEnoughTrips && hasDistance ? "high" : "low";

  return {
    kmPerDay: confidence === "high" ? km / USAGE_WINDOW_DAYS : 0,
    tripCount,
    activeDays,
    confidence,
  };
}
```

- [ ] **Step 3.4 — Run to verify it passes**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 3.5 — Commit**

```bash
git add src/lib/ai/predictive-maintenance.js src/lib/ai/predictive-maintenance.test.js
git commit -m "feat(ai): add risk constants and usage rate to prediction engine"
```

---

## Task 4: Prediction engine — due-date resolution

The predictive step. Two independent due-dates compete; the sooner wins.

**Files:**
- Modify: `src/lib/ai/predictive-maintenance.js`
- Test: `src/lib/ai/predictive-maintenance.test.js`

**Interfaces:**
- Consumes: `computeUsageRate`, `RISK` (Task 3).
- Produces:
  - `daysUntil(dateValue, now)` → integer days, negative when past, or `null` when the date is absent/unparseable.
  - `resolveDueDate({ vehicle, usage, now })` → `{ daysToService, kmToService, projectedDaysToService, effectiveDays, basis }` where `basis` is `"time" | "mileage" | null`.

- [ ] **Step 4.1 — Write the failing test**

Append to `src/lib/ai/predictive-maintenance.test.js`. Extend the existing import to add `daysUntil` and `resolveDueDate`:

```js
import {
  RISK,
  USAGE_WINDOW_DAYS,
  MIN_TRIPS_FOR_CONFIDENCE,
  computeUsageRate,
  daysUntil,
  resolveDueDate,
} from "@/lib/ai/predictive-maintenance";

// Fixed clock. Every day-count assertion below is exact, not approximate.
// Built from local components on purpose: `new Date("2026-08-04T00:00:00Z")`
// is 2026-08-03 in any negative-offset zone, which would slide every
// assertion here by a day depending on where the suite runs.
const NOW = new Date(2026, 7, 4);

const HIGH_CONF = { kmPerDay: 100, tripCount: 30, activeDays: 60, confidence: "high" };
const LOW_CONF = { kmPerDay: 0, tripCount: 2, activeDays: 2, confidence: "low" };

describe("daysUntil", () => {
  it("counts forward days", () => {
    expect(daysUntil("2026-08-24", NOW)).toBe(20);
  });

  it("returns negative days for a past date rather than clamping to zero", () => {
    // The old implementation wrapped this in Math.max(0, ...), so a vehicle
    // three weeks overdue displayed identically to one due today.
    expect(daysUntil("2026-07-17", NOW)).toBe(-18);
  });

  it("returns 0 on the due date itself", () => {
    expect(daysUntil("2026-08-04", NOW)).toBe(0);
  });

  it("returns null for an absent or unparseable date", () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil("", NOW)).toBeNull();
    expect(daysUntil("not-a-date", NOW)).toBeNull();
  });

  it("ignores the time component of a timestamp", () => {
    // vehicles.next_service_date may arrive as a Date or a timestamp string.
    // Comparing wall-clock instants would make "due today" flip to -1 or 1
    // depending on the hour the request lands.
    expect(daysUntil("2026-08-24T23:30:00Z", NOW)).toBe(20);
  });

  it("reads a pg DATE column as the calendar day it represents", () => {
    // `pg` hands back a DATE as a Date at *local* midnight, so reading UTC
    // components off it lands on the previous day at positive offsets. This
    // case fails if daysUntil ever goes back to getUTCDate()/toISOString().
    expect(daysUntil(new Date(2026, 7, 24), NOW)).toBe(20);
  });
});

describe("resolveDueDate", () => {
  it("lets mileage win when the burn rate arrives before the calendar date", () => {
    // 2,000 km remaining at 100 km/day = 20 days, vs 45 calendar days.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 52000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.daysToService).toBe(45);
    expect(out.kmToService).toBe(2000);
    expect(out.projectedDaysToService).toBe(20);
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("mileage");
  });

  it("lets time win when the calendar date arrives first", () => {
    // 12,000 km at 100 km/day = 120 days, vs 10 calendar days.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-14", next_service_mileage: 62000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.effectiveDays).toBe(10);
    expect(out.basis).toBe("time");
  });

  it("falls back to calendar only when confidence is low", () => {
    // kmToService is still reported — it is a real fact worth showing — but it
    // must not produce a projection, because there is no trustworthy rate.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 50100, mileage: 50000 },
      usage: LOW_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(100);
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(45);
    expect(out.basis).toBe("time");
  });

  it("excludes a missing calendar date from the minimum instead of scoring it as zero", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: null, next_service_mileage: 52000, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.daysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("mileage");
  });

  it("excludes a missing service mileage from the minimum", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-24", next_service_mileage: null, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBeNull();
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("time");
  });

  it("returns basis null when neither dimension is available", () => {
    // Must NOT collapse to a false `low` — no schedule is set at all, which is
    // a different statement from "healthy".
    const out = resolveDueDate({
      vehicle: { next_service_date: null, next_service_mileage: null, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.effectiveDays).toBeNull();
    expect(out.basis).toBeNull();
  });

  it("does not divide by zero when the vehicle is idle", () => {
    // kmPerDay 0 with high confidence cannot happen via computeUsageRate, but
    // an explicit guard is cheaper than an Infinity leaking into a sort.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-08-24", next_service_mileage: 52000, mileage: 50000 },
      usage: { kmPerDay: 0, tripCount: 30, activeDays: 60, confidence: "high" },
      now: NOW,
    });
    expect(out.projectedDaysToService).toBeNull();
    expect(out.effectiveDays).toBe(20);
    expect(out.basis).toBe("time");
  });

  it("reports an already-exceeded service mileage as overdue, not as a future projection", () => {
    // mileage past next_service_mileage means kmToService is negative; the
    // projection must go negative too rather than flipping sign into the future.
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: 49500, mileage: 50000 },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(-500);
    expect(out.projectedDaysToService).toBe(-5);
    expect(out.effectiveDays).toBe(-5);
    expect(out.basis).toBe("mileage");
  });

  it("coerces string mileage values from pg", () => {
    const out = resolveDueDate({
      vehicle: { next_service_date: "2026-09-18", next_service_mileage: "52000", mileage: "50000" },
      usage: HIGH_CONF,
      now: NOW,
    });
    expect(out.kmToService).toBe(2000);
    expect(out.basis).toBe("mileage");
  });
});
```

- [ ] **Step 4.2 — Run to verify it fails**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: FAIL — `daysUntil is not a function`.

- [ ] **Step 4.3 — Write the minimal implementation**

Add this import at the top of `src/lib/ai/predictive-maintenance.js`, directly under the module docstring:

```js
import { toCalendarDay } from "@/lib/dates";
```

`@/lib/dates` is itself pure — no I/O, no ambient clock — so importing it does not
compromise the engine's testability.

Then append to `src/lib/ai/predictive-maintenance.js`:

```js
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Midnight for a date-ish value, so day counts ignore wall-clock time.
 *
 * Routed through toCalendarDay because `pg` returns DATE columns as Dates
 * pinned to *local* midnight: reading UTC components off one shifts the day
 * backward at positive offsets, turning a 2026-07-31 due-date into 2026-07-30
 * at UTC+8 — see the note on src/lib/dates.js:7. toCalendarDay reads local
 * components from Dates and slices strings, which is the only handling that is
 * correct for both shapes the driver may hand back.
 */
function toMidnight(value) {
  const day = toCalendarDay(value);
  if (day === null) return null;
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * Whole days from `now` until `dateValue`. Negative when the date has passed —
 * deliberately unclamped, because "18 days overdue" and "due today" are
 * different operational states and the previous Math.max(0, ...) collapsed them.
 * Returns null when there is no usable date, which is how a dimension signals
 * that it should not participate in the minimum.
 */
export function daysUntil(dateValue, now = new Date()) {
  const target = toMidnight(dateValue);
  if (target === null) return null;
  const today = toMidnight(now);
  if (today === null) return null;
  return Math.round((target - today) / MS_PER_DAY);
}

/** Numeric or null — distinguishes "absent" from "zero". */
function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolves a vehicle's two independent due-dates and picks the sooner.
 *
 * Mileage alone is not a prediction: 3,000 km remaining means nothing without a
 * burn rate. Dividing the remaining distance by km/day converts it into days,
 * which is the only unit the two dimensions share and therefore the only one
 * they can be compared in.
 *
 * A dimension with no data is excluded from the minimum rather than counted as
 * zero — otherwise a vehicle with no service mileage set would read as due
 * today. When both are absent, effectiveDays and basis are null and the caller
 * reports "no schedule set" instead of ranking the vehicle as healthy.
 */
export function resolveDueDate({ vehicle = {}, usage = {}, now = new Date() } = {}) {
  const daysToService = daysUntil(vehicle.next_service_date, now);

  const nextServiceMileage = numOrNull(vehicle.next_service_mileage);
  const currentMileage = numOrNull(vehicle.mileage) ?? 0;
  const kmToService =
    nextServiceMileage === null ? null : nextServiceMileage - currentMileage;

  // A projection needs both a target and a trustworthy rate. kmPerDay > 0 also
  // guards the division; a negative kmToService stays negative, so an
  // already-exceeded service mileage reads as overdue rather than as a future date.
  const canProject =
    kmToService !== null && usage.confidence === "high" && usage.kmPerDay > 0;
  const projectedDaysToService = canProject
    ? Math.round(kmToService / usage.kmPerDay)
    : null;

  const candidates = [];
  if (daysToService !== null) candidates.push({ days: daysToService, basis: "time" });
  if (projectedDaysToService !== null) {
    candidates.push({ days: projectedDaysToService, basis: "mileage" });
  }

  // Sooner wins, so a heavily-used vehicle escalates on mileage before its
  // calendar date arrives.
  const winner = candidates.reduce(
    (best, c) => (best === null || c.days < best.days ? c : best),
    null
  );

  return {
    daysToService,
    kmToService,
    projectedDaysToService,
    effectiveDays: winner ? winner.days : null,
    basis: winner ? winner.basis : null,
  };
}
```

- [ ] **Step 4.4 — Run to verify it passes**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: PASS — 23 tests (8 from Task 3, 15 new).

- [ ] **Step 4.5 — Commit**

```bash
git add src/lib/ai/predictive-maintenance.js src/lib/ai/predictive-maintenance.test.js
git commit -m "feat(ai): resolve competing time and mileage due dates"
```

---

## Task 5: Prediction engine — risk band and health score

**Files:**
- Modify: `src/lib/ai/predictive-maintenance.js`
- Test: `src/lib/ai/predictive-maintenance.test.js`

**Interfaces:**
- Consumes: `RISK`, `resolveDueDate` (Tasks 3–4).
- Produces:
  - `riskForDays(effectiveDays)` → a `RISK` value. `null` days → `RISK.LOW`.
  - `healthScore({ effectiveDays, correctiveCount, totalCount })` → integer 0–100.

- [ ] **Step 5.1 — Write the failing test**

Add `riskForDays` and `healthScore` to the import, then append:

```js
describe("riskForDays", () => {
  it("bands each boundary exactly", () => {
    expect(riskForDays(-1)).toBe(RISK.OVERDUE);
    expect(riskForDays(-18)).toBe(RISK.OVERDUE);
    expect(riskForDays(0)).toBe(RISK.CRITICAL);
    expect(riskForDays(7)).toBe(RISK.CRITICAL);
    expect(riskForDays(8)).toBe(RISK.HIGH);
    expect(riskForDays(30)).toBe(RISK.HIGH);
    expect(riskForDays(31)).toBe(RISK.MEDIUM);
    expect(riskForDays(90)).toBe(RISK.MEDIUM);
    expect(riskForDays(91)).toBe(RISK.LOW);
    expect(riskForDays(9999)).toBe(RISK.LOW);
  });

  it("treats no schedule as low rather than throwing", () => {
    // basis null vehicles are excluded from the urgency sort separately; the
    // band still has to be a legal value so the badge renders.
    expect(riskForDays(null)).toBe(RISK.LOW);
  });
});

describe("healthScore", () => {
  it("scores an overdue vehicle far below a healthy one", () => {
    const overdue = healthScore({ effectiveDays: -18, correctiveCount: 0, totalCount: 0 });
    const healthy = healthScore({ effectiveDays: 200, correctiveCount: 0, totalCount: 0 });
    expect(overdue).toBeLessThan(healthy);
    expect(overdue).toBeLessThan(30);
    expect(healthy).toBeGreaterThan(90);
  });

  it("stays within 0 and 100 at the extremes", () => {
    const worst = healthScore({ effectiveDays: -900, correctiveCount: 40, totalCount: 40 });
    const best = healthScore({ effectiveDays: 9999, correctiveCount: 0, totalCount: 20 });
    expect(worst).toBeGreaterThanOrEqual(0);
    expect(best).toBeLessThanOrEqual(100);
  });

  it("penalises a corrective-heavy repair history", () => {
    // Three unplanned repairs is genuinely worse than none at the same urgency.
    // The old engine returned a hardcoded 95 for both.
    const clean = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 6 });
    const dirty = healthScore({ effectiveDays: 120, correctiveCount: 3, totalCount: 6 });
    expect(dirty).toBeLessThan(clean);
  });

  it("does not penalise a vehicle with no maintenance history", () => {
    // totalCount 0 must not divide by zero or read as 100% corrective.
    const noHistory = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 0 });
    const cleanHistory = healthScore({ effectiveDays: 120, correctiveCount: 0, totalCount: 6 });
    expect(noHistory).toBe(cleanHistory);
  });

  it("returns an integer", () => {
    expect(Number.isInteger(healthScore({ effectiveDays: 17, correctiveCount: 1, totalCount: 3 }))).toBe(true);
  });

  it("scores a vehicle with no schedule as unknown-but-not-perfect", () => {
    const none = healthScore({ effectiveDays: null, correctiveCount: 0, totalCount: 0 });
    expect(none).toBeGreaterThanOrEqual(0);
    expect(none).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 5.2 — Run to verify it fails**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: FAIL — `riskForDays is not a function`.

- [ ] **Step 5.3 — Write the minimal implementation**

Append to `src/lib/ai/predictive-maintenance.js`:

```js
/**
 * Bands the single effective day-count.
 *
 * overdue / critical / high keep the boundaries the existing tile labels
 * promise ("Critical (7 days)", "High (30 days)"). The medium/low cut moves
 * from 30 to 90 days: with a mileage projection in play, "more than 30 days"
 * spans five weeks to two years, which is too coarse to plan against.
 */
export function riskForDays(effectiveDays) {
  if (effectiveDays === null || effectiveDays === undefined) return RISK.LOW;
  if (effectiveDays < 0) return RISK.OVERDUE;
  if (effectiveDays <= 7) return RISK.CRITICAL;
  if (effectiveDays <= 30) return RISK.HIGH;
  if (effectiveDays <= 90) return RISK.MEDIUM;
  return RISK.LOW;
}

/**
 * 0–100, replacing the four hardcoded values (95/70/40/15) the old engine
 * returned. Three terms:
 *
 *  - urgency, dominant: how close the effective due-date is, ramped across the
 *    90-day planning horizon
 *  - overdue severity: an additional penalty that keeps growing past zero days,
 *    so three weeks overdue outranks one day overdue
 *  - corrective ratio: unplanned repairs as a share of the last year's records
 *
 * A vehicle with no schedule scores at the mid-point: it is not known-healthy,
 * and claiming 95 would be a lie about data that does not exist.
 */
export function healthScore({ effectiveDays, correctiveCount = 0, totalCount = 0 } = {}) {
  if (effectiveDays === null || effectiveDays === undefined) return 50;

  // Urgency: 0 at/past due, full marks beyond the 90-day horizon.
  const horizon = 90;
  const urgency = Math.min(Math.max(effectiveDays, 0), horizon) / horizon;
  let score = 15 + urgency * 85;

  // Overdue severity: capped so a long-abandoned vehicle bottoms out rather
  // than driving the score arbitrarily negative.
  if (effectiveDays < 0) {
    score -= Math.min(Math.abs(effectiveDays), 30) * 0.5;
  }

  // Corrective ratio, weighted lightly: history informs health but the
  // upcoming service is the actionable signal. No history means no penalty —
  // an unmaintained new vehicle is not the same as a repeatedly broken one.
  if (totalCount > 0) {
    score -= (correctiveCount / totalCount) * 15;
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}
```

- [ ] **Step 5.4 — Run to verify it passes**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: PASS — 31 tests (23 from Tasks 3-4, 8 new).

- [ ] **Step 5.5 — Commit**

```bash
git add src/lib/ai/predictive-maintenance.js src/lib/ai/predictive-maintenance.test.js
git commit -m "feat(ai): add risk banding and computed health score"
```

---

## Task 6: Prediction engine — row prediction, sort, summary

The public surface the endpoint calls. After this task the engine is complete.

**Files:**
- Modify: `src/lib/ai/predictive-maintenance.js`
- Test: `src/lib/ai/predictive-maintenance.test.js`

**Interfaces:**
- Consumes: everything from Tasks 3–5.
- Produces:
  - `predictVehicle(row, now)` → one prediction object with the exact keys listed in the spec's response shape.
  - `predictFleet(rows, now)` → `{ predictions, summary }`, predictions sorted by urgency, `summary` = `{ overdue, critical, high, medium, low, total, unscheduled }`.

- [ ] **Step 6.1 — Write the failing test**

Add `predictVehicle` and `predictFleet` to the import, then append:

```js
// Shape matches one row of the endpoint's CTE query.
function row(overrides = {}) {
  return {
    vehicle_id: 1,
    plate_number: "ABC-1234",
    vehicle_name: "HIACE COMMUTER",
    mileage: 50000,
    next_service_date: "2026-09-18",
    next_service_mileage: 52000,
    last_service_date: "2026-05-01",
    service_interval_km: 5000,
    service_interval_days: 180,
    vehicle_status: "Available",
    km_90d: 9000,
    trip_count: 30,
    active_days: 60,
    corrective_count: 0,
    total_count: 4,
    ...overrides,
  };
}

describe("predictVehicle", () => {
  it("returns the documented response shape", () => {
    const p = predictVehicle(row(), NOW);
    expect(Object.keys(p).sort()).toEqual(
      [
        "basis",
        "confidence",
        "daysToService",
        "effectiveDays",
        "kmPerDay",
        "kmToService",
        "last_service_date",
        "mileage",
        "next_service_date",
        "next_service_mileage",
        "plate_number",
        "projectedDaysToService",
        "recommendation",
        "risk",
        "score",
        "vehicle_id",
        "vehicle_name",
      ].sort()
    );
  });

  it("escalates on mileage before the calendar date arrives", () => {
    // 9,000 km / 90 days = 100 km/day. 2,000 km remaining = 20 days,
    // against 45 calendar days.
    const p = predictVehicle(row(), NOW);
    expect(p.kmPerDay).toBeCloseTo(100, 5);
    expect(p.effectiveDays).toBe(20);
    expect(p.basis).toBe("mileage");
    expect(p.risk).toBe(RISK.HIGH);
    expect(p.confidence).toBe("high");
  });

  it("reports an overdue vehicle with negative days", () => {
    const p = predictVehicle(
      row({ next_service_date: "2026-07-17", next_service_mileage: null }),
      NOW
    );
    expect(p.daysToService).toBe(-18);
    expect(p.effectiveDays).toBe(-18);
    expect(p.risk).toBe(RISK.OVERDUE);
  });

  it("falls back to calendar only and says so when trip data is thin", () => {
    const p = predictVehicle(row({ trip_count: 2, km_90d: 120 }), NOW);
    expect(p.confidence).toBe("low");
    expect(p.projectedDaysToService).toBeNull();
    expect(p.basis).toBe("time");
    expect(p.recommendation).toMatch(/not enough trip data/i);
  });

  it("states that no schedule is set when both dimensions are absent", () => {
    const p = predictVehicle(
      row({ next_service_date: null, next_service_mileage: null }),
      NOW
    );
    expect(p.basis).toBeNull();
    expect(p.effectiveDays).toBeNull();
    expect(p.recommendation).toMatch(/no service schedule/i);
  });

  it("names the mileage basis in the recommendation when mileage wins", () => {
    const p = predictVehicle(row(), NOW);
    expect(p.recommendation).toMatch(/km\/day|mileage/i);
  });
});

describe("predictFleet", () => {
  it("sorts by effective days, not by raw calendar days", () => {
    // The mileage-critical van has a LATER calendar date but is due sooner once
    // its burn rate is applied. Sorting on daysToService would bury it.
    const rows = [
      row({
        vehicle_id: 1,
        plate_number: "CAL-0001",
        next_service_date: "2026-08-29", // 25 calendar days
        next_service_mileage: null,
      }),
      row({
        vehicle_id: 2,
        plate_number: "MIL-0002",
        next_service_date: "2026-12-01", // 119 calendar days
        next_service_mileage: 50300, // 300 km at 100 km/day = 3 days
      }),
    ];
    const { predictions } = predictFleet(rows, NOW);
    expect(predictions.map((p) => p.plate_number)).toEqual(["MIL-0002", "CAL-0001"]);
    expect(predictions[0].effectiveDays).toBe(3);
  });

  it("sorts unscheduled vehicles last instead of ranking them as healthy", () => {
    const rows = [
      row({ vehicle_id: 1, plate_number: "NONE-01", next_service_date: null, next_service_mileage: null }),
      row({ vehicle_id: 2, plate_number: "DUE-02", next_service_date: "2026-08-09", next_service_mileage: null }),
    ];
    const { predictions } = predictFleet(rows, NOW);
    expect(predictions.map((p) => p.plate_number)).toEqual(["DUE-02", "NONE-01"]);
  });

  it("precomputes band counts so the stat cards read one number each", () => {
    const rows = [
      row({ vehicle_id: 1, next_service_date: "2026-07-17", next_service_mileage: null }), // overdue
      row({ vehicle_id: 2, next_service_date: "2026-08-06", next_service_mileage: null }), // critical (2)
      row({ vehicle_id: 3, next_service_date: "2026-08-24", next_service_mileage: null }), // high (20)
      row({ vehicle_id: 4, next_service_date: "2026-09-18", next_service_mileage: null }), // medium (45)
      row({ vehicle_id: 5, next_service_date: "2027-06-01", next_service_mileage: null }), // low
      row({ vehicle_id: 6, next_service_date: null, next_service_mileage: null }),         // unscheduled
    ];
    const { summary } = predictFleet(rows, NOW);
    expect(summary).toEqual({
      overdue: 1,
      critical: 1,
      high: 1,
      medium: 1,
      low: 2, // the low vehicle plus the unscheduled one, which bands as low
      total: 6,
      unscheduled: 1,
    });
  });

  it("returns empty results for an empty fleet without throwing", () => {
    const { predictions, summary } = predictFleet([], NOW);
    expect(predictions).toEqual([]);
    expect(summary.total).toBe(0);
    expect(summary.overdue).toBe(0);
  });

  it("does not mutate the input array", () => {
    const rows = [row({ vehicle_id: 1 }), row({ vehicle_id: 2 })];
    const before = rows.map((r) => r.vehicle_id);
    predictFleet(rows, NOW);
    expect(rows.map((r) => r.vehicle_id)).toEqual(before);
  });
});
```

- [ ] **Step 6.2 — Run to verify it fails**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: FAIL — `predictVehicle is not a function`.

- [ ] **Step 6.3 — Write the minimal implementation**

Append to `src/lib/ai/predictive-maintenance.js`:

```js
/** Whole-number km for display, tolerating pg's string aggregates. */
function roundKm(value) {
  return value === null || value === undefined ? null : Math.round(value);
}

/**
 * Prose that names the basis, so the number on screen is never unexplained.
 * The UI renders this directly; a reader must be able to tell a mileage-driven
 * escalation from a calendar one, and a projection from a guess.
 */
function buildRecommendation({ risk, basis, effectiveDays, kmToService, kmPerDay, confidence }) {
  if (basis === null) {
    return "No service schedule set — add a next service date or mileage to predict this vehicle.";
  }

  const overdueBy = Math.abs(effectiveDays);

  if (basis === "mileage") {
    const rate = `~${Math.round(kmPerDay)} km/day`;
    if (risk === RISK.OVERDUE) {
      return `Service mileage exceeded by ${Math.abs(roundKm(kmToService))} km (${rate}) — ground the vehicle and service it now.`;
    }
    return `${roundKm(kmToService).toLocaleString()} km to service at ${rate} — due in about ${effectiveDays} day${effectiveDays === 1 ? "" : "s"}.`;
  }

  // basis === "time"
  const thin = confidence === "low" ? " — calendar only, not enough trip data to project mileage" : "";
  if (risk === RISK.OVERDUE) {
    return `Service is ${overdueBy} day${overdueBy === 1 ? "" : "s"} overdue — ground the vehicle and service it now${thin}.`;
  }
  if (risk === RISK.CRITICAL) {
    return `Service due in ${effectiveDays} day${effectiveDays === 1 ? "" : "s"} — schedule it this week${thin}.`;
  }
  if (risk === RISK.HIGH) {
    return `Service due in ${effectiveDays} days — book it within the month${thin}.`;
  }
  return `Service due in ${effectiveDays} days${thin}.`;
}

/**
 * One CTE row in, one prediction out. Pure: the same row and clock always
 * produce the same result, which is why the boundary tests can be exact.
 */
export function predictVehicle(row = {}, now = new Date()) {
  const usage = computeUsageRate(row);
  const due = resolveDueDate({ vehicle: row, usage, now });

  const risk = riskForDays(due.effectiveDays);
  const correctiveCount = num(row.corrective_count);
  const totalCount = num(row.total_count);

  return {
    vehicle_id: row.vehicle_id,
    plate_number: row.plate_number,
    vehicle_name: row.vehicle_name,
    mileage: num(row.mileage),
    next_service_date: row.next_service_date ?? null,
    next_service_mileage: numOrNull(row.next_service_mileage),
    last_service_date: row.last_service_date ?? null,
    risk,
    score: healthScore({ effectiveDays: due.effectiveDays, correctiveCount, totalCount }),
    basis: due.basis,
    confidence: usage.confidence,
    daysToService: due.daysToService,
    kmToService: roundKm(due.kmToService),
    kmPerDay: usage.kmPerDay,
    projectedDaysToService: due.projectedDaysToService,
    effectiveDays: due.effectiveDays,
    recommendation: buildRecommendation({
      risk,
      basis: due.basis,
      effectiveDays: due.effectiveDays,
      kmToService: due.kmToService,
      kmPerDay: usage.kmPerDay,
      confidence: usage.confidence,
    }),
  };
}

/**
 * Scores the fleet and precomputes the band counts.
 *
 * The summary exists so the pages read one number per tile instead of
 * re-filtering the array — the re-filtering is where the capitalisation bug
 * lived, and four separate passes over the same array is how two of them
 * drifted apart.
 *
 * Vehicles with no schedule sort last: they have no urgency to rank, and
 * placing them among genuinely healthy vehicles would imply a clean bill of
 * health nobody established.
 */
export function predictFleet(rows = [], now = new Date()) {
  const predictions = rows.map((r) => predictVehicle(r, now));

  const sorted = [...predictions].sort((a, b) => {
    if (a.effectiveDays === null && b.effectiveDays === null) return 0;
    if (a.effectiveDays === null) return 1;
    if (b.effectiveDays === null) return -1;
    return a.effectiveDays - b.effectiveDays;
  });

  const summary = {
    overdue: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    total: predictions.length,
    unscheduled: 0,
  };
  for (const p of predictions) {
    summary[p.risk] += 1;
    if (p.basis === null) summary.unscheduled += 1;
  }

  return { predictions: sorted, summary };
}
```

- [ ] **Step 6.4 — Run to verify it passes**

Run: `npx vitest run src/lib/ai/predictive-maintenance.test.js`
Expected: PASS — 42 tests (31 from Tasks 3-5, 11 new). The engine is now complete.

- [ ] **Step 6.5 — Commit**

```bash
git add src/lib/ai/predictive-maintenance.js src/lib/ai/predictive-maintenance.test.js
git commit -m "feat(ai): add fleet prediction with urgency sort and band summary"
```

---

## Task 7: Odometer validation (pure)

Guards the load-bearing write. One fat-fingered reading pushes every due-date on the vehicle months out, so the check lives in its own tested unit rather than inline in two route handlers.

**Files:**
- Create: `src/lib/vehicles/odometer.js`
- Test: `src/lib/vehicles/odometer.test.js`

**Interfaces:**
- Produces:
  - `MAX_PLAUSIBLE_TRIP_KM` — `1500`
  - `validateOdometerReading({ reading, currentMileage })` → `{ ok, error, flagged, reason }`. `ok: false` means reject with 400; `flagged: true` means accept but record for review.

- [ ] **Step 7.1 — Write the failing test**

Create `src/lib/vehicles/odometer.test.js`:

```js
import { describe, it, expect } from "vitest";
import { validateOdometerReading, MAX_PLAUSIBLE_TRIP_KM } from "@/lib/vehicles/odometer";

describe("validateOdometerReading", () => {
  it("accepts a reading above the current mileage", () => {
    const r = validateOdometerReading({ reading: 50120, currentMileage: 50000 });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(false);
  });

  it("accepts a reading equal to the current mileage", () => {
    // A trip that moved the vehicle nowhere is odd but not invalid, and
    // rejecting it would block a legitimate cancelled-at-the-gate completion.
    const r = validateOdometerReading({ reading: 50000, currentMileage: 50000 });
    expect(r.ok).toBe(true);
  });

  it("rejects a reading below the current mileage", () => {
    // Accepting this would silently defer every due-date on the vehicle.
    const r = validateOdometerReading({ reading: 49000, currentMileage: 50000 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/below/i);
    expect(r.error).toMatch(/50,?000/);
  });

  it("flags an implausible jump without rejecting it", () => {
    // Long provincial transfers happen. Flag for review, do not block the trip.
    const r = validateOdometerReading({ reading: 50000 + MAX_PLAUSIBLE_TRIP_KM + 1, currentMileage: 50000 });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(true);
    expect(r.reason).toMatch(/1,?500/);
  });

  it("does not flag a jump exactly at the threshold", () => {
    const r = validateOdometerReading({ reading: 50000 + MAX_PLAUSIBLE_TRIP_KM, currentMileage: 50000 });
    expect(r.flagged).toBe(false);
  });

  it("rejects a missing or non-numeric reading", () => {
    expect(validateOdometerReading({ reading: undefined, currentMileage: 50000 }).ok).toBe(false);
    expect(validateOdometerReading({ reading: null, currentMileage: 50000 }).ok).toBe(false);
    expect(validateOdometerReading({ reading: "abc", currentMileage: 50000 }).ok).toBe(false);
  });

  it("rejects a negative reading", () => {
    expect(validateOdometerReading({ reading: -5, currentMileage: 0 }).ok).toBe(false);
  });

  it("accepts any reading when the vehicle has no recorded mileage", () => {
    // A brand-new vehicle row has mileage 0 or NULL; there is nothing to
    // regress against and the first reading establishes the baseline.
    expect(validateOdometerReading({ reading: 120, currentMileage: null }).ok).toBe(true);
    expect(validateOdometerReading({ reading: 120, currentMileage: undefined }).ok).toBe(true);
  });

  it("coerces numeric strings, which is what a JSON body carries", () => {
    const r = validateOdometerReading({ reading: "50120", currentMileage: "50000" });
    expect(r.ok).toBe(true);
    expect(r.flagged).toBe(false);
  });
});
```

- [ ] **Step 7.2 — Run to verify it fails**

Run: `npx vitest run src/lib/vehicles/odometer.test.js`
Expected: FAIL — `Failed to resolve import "@/lib/vehicles/odometer"`.

- [ ] **Step 7.3 — Write the minimal implementation**

Create `src/lib/vehicles/odometer.js`:

```js
/**
 * Odometer reading sanity checks.
 *
 * Pure and shared by both trip routes. Mileage is the input to every km-based
 * prediction, so a bad reading is not a cosmetic problem: a low one walks
 * mileage backwards and defers every due-date on the vehicle, and a high one
 * marks a healthy vehicle overdue. The write itself also uses GREATEST as a
 * second line of defence.
 */

/**
 * Above this many kilometres in one trip, a reading is more likely a typo than
 * a journey. Flagged for review rather than rejected — a genuine provincial
 * transfer must not be blocked by a heuristic.
 */
export const MAX_PLAUSIBLE_TRIP_KM = 1500;

export function validateOdometerReading({ reading, currentMileage } = {}) {
  const value = Number(reading);
  if (reading === null || reading === undefined || reading === "" || !Number.isFinite(value)) {
    return { ok: false, error: "Odometer reading is required and must be a number.", flagged: false, reason: null };
  }
  if (value < 0) {
    return { ok: false, error: "Odometer reading cannot be negative.", flagged: false, reason: null };
  }

  const current = Number(currentMileage);
  const hasCurrent = Number.isFinite(current) && current > 0;

  if (hasCurrent && value < current) {
    return {
      ok: false,
      error: `Odometer reading ${value.toLocaleString()} km is below the vehicle's recorded mileage of ${current.toLocaleString()} km.`,
      flagged: false,
      reason: null,
    };
  }

  const delta = hasCurrent ? value - current : 0;
  if (delta > MAX_PLAUSIBLE_TRIP_KM) {
    return {
      ok: true,
      error: null,
      flagged: true,
      reason: `Odometer jumped ${delta.toLocaleString()} km, above the ${MAX_PLAUSIBLE_TRIP_KM.toLocaleString()} km plausibility threshold for one trip. Flagged for review.`,
    };
  }

  return { ok: true, error: null, flagged: false, reason: null };
}
```

- [ ] **Step 7.4 — Run to verify it passes**

Run: `npx vitest run src/lib/vehicles/odometer.test.js`
Expected: PASS — 9 tests.

- [ ] **Step 7.5 — Commit**

```bash
git add src/lib/vehicles/odometer.js src/lib/vehicles/odometer.test.js
git commit -m "feat(fleet): add odometer reading sanity checks"
```

---

## Task 8: Odometer write-back in the trip routes

The load-bearing fix. Until this lands, every km-based interval computes off whatever was typed at vehicle creation. No `UPDATE vehicles SET mileage` exists anywhere in the codebase today.

**Files:**
- Modify: `src/app/api/trips/[id]/start/route.js`
- Modify: `src/app/api/trips/[id]/complete/route.js`

**Interfaces:**
- Consumes: `validateOdometerReading` (Task 7).

- [ ] **Step 8.1 — Read the route-handler docs**

Per `AGENTS.md` this Next.js version differs from training data. Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` and confirm the existing `(await params).id` pattern is still correct before editing. Both files already use it — do not "modernise" it.

- [ ] **Step 8.2 — Add the write-back to `complete/route.js`**

The vehicle row is already fetched at line 13. Extend that `SELECT` to bring back mileage rather than adding a second round-trip:

Replace line 13:

```js
const { rows: before } = await query(`SELECT vehicle_id, driver_id, dispatch_id, trip_status FROM trips WHERE trip_id = $1 LIMIT 1`, [id]);
```

with:

```js
const { rows: before } = await query(
  `SELECT t.vehicle_id, t.driver_id, t.dispatch_id, t.trip_status, v.mileage AS vehicle_mileage
     FROM trips t
     LEFT JOIN vehicles v ON v.vehicle_id = t.vehicle_id
    WHERE t.trip_id = $1
    LIMIT 1`,
  [id]
);
```

Add the import at the top of the file:

```js
import { validateOdometerReading } from "@/lib/vehicles/odometer";
```

Then, immediately after the existing `["Completed", "Cancelled"].includes(...)` guard and **before** the `const dist = ...` line, insert:

```js
    // Validate before writing. A reading below current mileage would walk the
    // odometer backwards and silently defer every due-date on this vehicle.
    const odo = validateOdometerReading({
      reading: body.end_odometer,
      currentMileage: before[0].vehicle_mileage,
    });
    if (!odo.ok) return err(odo.error, 400);
    if (odo.flagged) console.warn(`trip ${id} end odometer: ${odo.reason}`);
```

Finally, after the trip `UPDATE` succeeds (after the `if (!rows[0]) return err("Trip not found", 404);` line), add the write-back to the `p` array so it runs alongside the existing status syncs:

```js
    const p = [];
    // Feed the odometer back into the vehicle. GREATEST is a second guard
    // beyond the validation above: a late-arriving low reading from a retried
    // request must never regress mileage, because that defers every
    // mileage-based service due-date on the vehicle.
    if (before[0]?.vehicle_id && rows[0]?.end_odometer !== null) {
      p.push(query(
        `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
        [rows[0].end_odometer, before[0].vehicle_id]
      ));
    }
```

(The existing `if (before[0]?.vehicle_id) p.push(syncVehicleStatus(...))` lines follow unchanged.)

- [ ] **Step 8.3 — Add the same write-back to `start/route.js`**

A start reading is equally authoritative, and the odometer dialog seeds its input from `vehicles.mileage` (`src/components/dispatch/trip-odometer-dialog.jsx:58`), so a stale value there means dispatchers confirm a wrong number.

Add the import:

```js
import { validateOdometerReading } from "@/lib/vehicles/odometer";
```

The route already fetches the vehicle at lines 21-24 for the registration check. Extend that `SELECT` to include mileage:

```js
      const { rows: vehicles } = await query(
        `SELECT plate_number, registration_expiry, vehicle_status, mileage FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL`,
        [before[0].vehicle_id]
      );
```

That block is scoped inside `if (before[0].vehicle_id) { ... }`, so hoist the mileage out for later use. Declare `let vehicleMileage = null;` immediately before that `if`, and add `vehicleMileage = vehicle?.mileage ?? null;` after `const vehicle = vehicles[0];`.

Then, immediately before the trip `UPDATE` at line 48, insert:

```js
    const odo = validateOdometerReading({
      reading: body.odometer,
      currentMileage: vehicleMileage,
    });
    if (!odo.ok) return err(odo.error, 400);
    if (odo.flagged) console.warn(`trip ${id} start odometer: ${odo.reason}`);
```

And add the write-back to the `p` array after the `UPDATE`, matching Step 8.2:

```js
    if (before[0]?.vehicle_id && rows[0]?.start_odometer !== null) {
      p.push(query(
        `UPDATE vehicles SET mileage = GREATEST(COALESCE(mileage, 0), $1), updated_at = NOW() WHERE vehicle_id = $2`,
        [rows[0].start_odometer, before[0].vehicle_id]
      ));
    }
```

- [ ] **Step 8.4 — Verify manually against the database**

There is no HTTP-level test harness in this repo, so verify with a real request. Start the dev server (`npm run dev`), then:

1. Note a vehicle's current mileage: `SELECT vehicle_id, mileage FROM vehicles WHERE vehicle_id = <id>;`
2. Start a trip on it with an odometer above that value. Confirm `vehicles.mileage` now equals the reading.
3. Complete the trip with a **lower** `end_odometer` than the current mileage. Confirm the request returns **400** with the "below the vehicle's recorded mileage" message and that `vehicles.mileage` is unchanged.
4. Complete the trip with a reading more than 1,500 km above current. Confirm it succeeds and the server log carries the "Flagged for review" line.

Record the four results in the commit body.

- [ ] **Step 8.5 — Commit**

```bash
git add src/app/api/trips/[id]/start/route.js src/app/api/trips/[id]/complete/route.js
git commit -m "fix(trips): write odometer readings back to vehicles.mileage"
```

---

## Task 9: Service completion recompute

Makes the due-date self-maintaining. Without it, `next_service_date` is hand-typed once and never again, which is why vehicles silently stop being predicted.

**Files:**
- Create: `src/services/maintenance-schedule.service.js`
- Test: `src/services/maintenance-schedule.service.test.js`

**Interfaces:**
- Produces:
  - `deriveNextSchedule({ completedDate, mileageAtService, currentMileage, intervalDays, intervalKm })` → `{ last_service_date, next_service_date, next_service_mileage }` with a null field wherever the corresponding interval is null. Pure.
  - `recomputeVehicleSchedule(vehicleId, maintenanceRow)` → `Promise<void>`. Does the I/O; no-ops when the record is not `Completed`.

- [ ] **Step 9.1 — Write the failing test**

Only the pure function is unit-tested; `recomputeVehicleSchedule` is I/O and gets manual verification in Step 9.5. Create `src/services/maintenance-schedule.service.test.js`:

```js
import { describe, it, expect } from "vitest";
import { deriveNextSchedule } from "@/services/maintenance-schedule.service";

describe("deriveNextSchedule", () => {
  it("advances both dimensions from the interval", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50200,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBe("2027-01-31"); // 2026-08-04 + 180 days
    expect(out.next_service_mileage).toBe(55000);      // mileage AT service + 5000
  });

  it("measures the next service mileage from the service, not from today", () => {
    // The vehicle kept driving after the service. Basing the next interval on
    // current mileage would give away every kilometre driven since, shortening
    // the interval by exactly the delay in recording the record.
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 53000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.next_service_mileage).toBe(55000);
  });

  it("falls back to current mileage when the service record has none", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: null,
      currentMileage: 53000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.next_service_mileage).toBe(58000);
  });

  it("leaves the mileage dimension null when no km interval is set", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: null,
    });
    expect(out.next_service_mileage).toBeNull();
    expect(out.next_service_date).toBe("2027-01-31");
  });

  it("leaves the date dimension null when no day interval is set", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: null,
      intervalKm: 5000,
    });
    expect(out.next_service_date).toBeNull();
    expect(out.next_service_mileage).toBe(55000);
  });

  it("still records the service date when both intervals are null", () => {
    // The service happened; last_service_date is a fact regardless of whether
    // a following one can be derived.
    const out = deriveNextSchedule({
      completedDate: "2026-08-04",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: null,
      intervalKm: null,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBeNull();
    expect(out.next_service_mileage).toBeNull();
  });

  it("normalises a timestamp completed date to a calendar day", () => {
    const out = deriveNextSchedule({
      completedDate: "2026-08-04T13:45:00Z",
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBe("2026-08-04");
    expect(out.next_service_date).toBe("2027-01-31");
  });

  it("returns null throughout when there is no completed date", () => {
    const out = deriveNextSchedule({
      completedDate: null,
      mileageAtService: 50000,
      currentMileage: 50000,
      intervalDays: 180,
      intervalKm: 5000,
    });
    expect(out.last_service_date).toBeNull();
    expect(out.next_service_date).toBeNull();
  });
});
```

- [ ] **Step 9.2 — Run to verify it fails**

Run: `npx vitest run src/services/maintenance-schedule.service.test.js`
Expected: FAIL — `Failed to resolve import "@/services/maintenance-schedule.service"`.

- [ ] **Step 9.3 — Write the minimal implementation**

Create `src/services/maintenance-schedule.service.js`:

```js
import { query } from "@/lib/db";
import { toCalendarDay } from "@/lib/dates";

/**
 * Derives a vehicle's next service due-dates when a maintenance record
 * completes.
 *
 * Before this existed, next_service_date was hand-typed at vehicle creation
 * and never updated, so a vehicle serviced ten times still carried its original
 * due-date — or a blank one, at which point it silently dropped out of the
 * prediction entirely.
 *
 * A null interval yields a null due-date rather than a guessed one. That is the
 * same "this dimension does not participate" signal the engine consumes, so a
 * fleet manager who only tracks kilometres is not handed an invented date.
 */

/**
 * Adds whole days to a YYYY-MM-DD string, staying in calendar space.
 *
 * The arithmetic runs through a local Date and comes back out via
 * toCalendarDay rather than round-tripping through toISOString: at UTC+8 that
 * round-trip returns the day before the one requested, which would set every
 * derived due-date one day early. See the note on src/lib/dates.js:7.
 */
function addDays(isoDay, days) {
  const [y, m, d] = isoDay.split("-").map(Number);
  return toCalendarDay(new Date(y, m - 1, d + days));
}

function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function deriveNextSchedule({
  completedDate,
  mileageAtService,
  currentMileage,
  intervalDays,
  intervalKm,
} = {}) {
  const lastServiceDate = toCalendarDay(completedDate);
  if (!lastServiceDate) {
    return { last_service_date: null, next_service_date: null, next_service_mileage: null };
  }

  const days = numOrNull(intervalDays);
  const km = numOrNull(intervalKm);

  // Measured from the odometer AT the service, not from today. Using current
  // mileage would give away every kilometre driven since the service,
  // shortening the interval by however long the record took to be entered.
  const baseMileage = numOrNull(mileageAtService) ?? numOrNull(currentMileage);

  return {
    last_service_date: lastServiceDate,
    next_service_date: days === null ? null : addDays(lastServiceDate, days),
    next_service_mileage: km === null || baseMileage === null ? null : baseMileage + km,
  };
}

/**
 * Applies deriveNextSchedule to the vehicle. No-ops unless the maintenance
 * record is Completed — a Scheduled or In Progress record has not moved the
 * service clock and must not advance the due-date.
 *
 * Only non-null derived fields are written, so a vehicle with one interval set
 * keeps its other hand-entered due-date instead of having it blanked.
 */
export async function recomputeVehicleSchedule(vehicleId, maintenanceRow = {}) {
  if (!vehicleId) return;
  if (String(maintenanceRow.status || "").toLowerCase() !== "completed") return;

  const { rows } = await query(
    `SELECT mileage, service_interval_km, service_interval_days
       FROM vehicles WHERE vehicle_id = $1 AND deleted_at IS NULL LIMIT 1`,
    [vehicleId]
  );
  const vehicle = rows[0];
  if (!vehicle) return;

  const derived = deriveNextSchedule({
    // completed_date is the authority; maintenance_date is the fallback for
    // records completed without one being entered.
    completedDate: maintenanceRow.completed_date || maintenanceRow.maintenance_date,
    mileageAtService: maintenanceRow.mileage_at_service,
    currentMileage: vehicle.mileage,
    intervalDays: vehicle.service_interval_days,
    intervalKm: vehicle.service_interval_km,
  });

  const sets = [];
  const values = [];
  for (const [column, value] of Object.entries(derived)) {
    if (value === null) continue;
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) return;

  values.push(vehicleId);
  await query(
    `UPDATE vehicles SET ${sets.join(", ")}, updated_at = NOW() WHERE vehicle_id = $${values.length}`,
    values
  );
}
```

Note the `${column}` interpolation is safe here: the keys come from `deriveNextSchedule`'s own literal return object, never from a request body.

- [ ] **Step 9.4 — Run to verify it passes**

Run: `npx vitest run src/services/maintenance-schedule.service.test.js`
Expected: PASS — 8 tests.

- [ ] **Step 9.5 — Commit**

```bash
git add src/services/maintenance-schedule.service.js src/services/maintenance-schedule.service.test.js
git commit -m "feat(maintenance): derive next service schedule from vehicle intervals"
```

---

## Task 10: Fix the vehicle-maintenance API

Defect 3. The write schema accepts seven field names that do not exist as columns, then interpolates raw body keys into the `INSERT`. Those writes fail at the database.

**Files:**
- Modify: `src/app/api/vehicle-maintenance/route.js:5-22,65-72`
- Modify: `src/app/api/vehicle-maintenance/[id]/route.js:25-31`

**Interfaces:**
- Consumes: `recomputeVehicleSchedule` (Task 9).

- [ ] **Step 10.1 — Confirm the real column names before editing**

Do not trust the plan for this — verify against the live schema:

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'vehiclemaintenance' ORDER BY ordinal_position;
```

Expect `next_schedule_date`, `next_schedule_mileage`, `service_provider`, `service_center`, `remarks`, and **no** `assigned_to` or `completed_by`. If the live schema differs, follow the live schema and note the difference in the commit body.

- [ ] **Step 10.2 — Rewrite the schema and INSERT in `route.js`**

Replace the `maintenanceWriteSchema` object (lines 5-22) with the corrected schema plus an explicit mapping and allowlist:

```js
// The API's field names, kept as-is so existing clients do not break, mapped to
// the columns that actually exist. Before this map, the schema accepted
// next_service_date / next_service_mileage / technician_name /
// service_center_name / notes — none of which are columns — and assigned_to /
// completed_by, which have no column at all. Every such write failed at the DB.
const FIELD_TO_COLUMN = {
  vehicle_id: "vehicle_id",
  maintenance_date: "maintenance_date",
  maintenance_type: "maintenance_type",
  description: "description",
  cost: "cost",
  status: "status",
  mileage_at_service: "mileage_at_service",
  next_service_date: "next_schedule_date",
  next_service_mileage: "next_schedule_mileage",
  technician_name: "service_provider",
  service_center_name: "service_center",
  priority: "priority",
  completed_date: "completed_date",
  notes: "remarks",
};

const maintenanceWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  maintenance_date: { required: true, type: "date", label: "Maintenance date", validate: maintenanceDateRule },
  maintenance_type: { required: true, maxLength: 50, label: "Type" },
  description: { maxLength: 1000, label: "Description" },
  cost: { type: "positiveNumber", label: "Cost" },
  status: { maxLength: 30, label: "Status" },
  mileage_at_service: { type: "positiveNumber", label: "Mileage at service" },
  next_service_date: { type: "date", label: "Next service date" },
  next_service_mileage: { type: "positiveNumber", label: "Next service mileage" },
  technician_name: { maxLength: 255, label: "Technician name" },
  service_center_name: { maxLength: 255, label: "Service center" },
  priority: { maxLength: 30, label: "Priority" },
  completed_date: { type: "date", label: "Completed date" },
  notes: { maxLength: 1000, label: "Notes" },
};
```

Add the import:

```js
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
```

Then replace the `INSERT` block (lines 65-77) with an allowlisted build:

```js
    // Build from the allowlist, not from Object.keys(body). Previously any
    // unknown body key was interpolated straight into the column list.
    const columns = [];
    const values = [];
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (body[field] === undefined) continue;
      columns.push(column);
      values.push(body[field] === "" ? null : body[field]);
    }
    if (columns.length === 0) return err("No writable fields were provided", 400);

    const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await query(
      `INSERT INTO vehiclemaintenance (${columns.join(", ")}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
      // A record created already Completed advances the vehicle's due-dates.
      await recomputeVehicleSchedule(rows[0].vehicle_id, rows[0]);
    }
    return ok(rows[0], 201);
```

`err` is already imported in this file's sibling routes; confirm the import line at the top includes it and add it if not:

```js
import { requireAuth, parseBody, ok, err, errValidation, handleError } from "@/lib/api/utils";
```

- [ ] **Step 10.3 — Apply the same allowlist to `[id]/route.js`**

The `PUT` has the identical raw-key flaw at lines 25-31. Add both imports:

```js
import { recomputeVehicleSchedule } from "@/services/maintenance-schedule.service";
```

Define the same map at the top of the file (repeat it rather than sharing — the two routes accept different required fields and coupling them would make a `PUT`-only field silently writable on `POST`):

```js
const FIELD_TO_COLUMN = {
  vehicle_id: "vehicle_id",
  maintenance_date: "maintenance_date",
  maintenance_type: "maintenance_type",
  description: "description",
  cost: "cost",
  status: "status",
  mileage_at_service: "mileage_at_service",
  next_service_date: "next_schedule_date",
  next_service_mileage: "next_schedule_mileage",
  technician_name: "service_provider",
  service_center_name: "service_center",
  priority: "priority",
  completed_date: "completed_date",
  notes: "remarks",
};
```

Replace the `UPDATE` block (lines 25-36) with:

```js
    const sets = [];
    const values = [];
    for (const [field, column] of Object.entries(FIELD_TO_COLUMN)) {
      if (body[field] === undefined) continue;
      values.push(body[field] === "" ? null : body[field]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return err("No writable fields were provided", 400);

    values.push(id);
    const { rows } = await query(
      `UPDATE vehiclemaintenance SET ${sets.join(", ")} WHERE maintenance_id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return err("Maintenance record not found", 404);
    if (rows[0]?.vehicle_id) {
      const { syncVehicleStatus } = await import("@/services/status.service");
      await syncVehicleStatus(rows[0].vehicle_id);
      // Completing a record is what advances the vehicle's next due-dates.
      await recomputeVehicleSchedule(rows[0].vehicle_id, rows[0]);
    }
    return ok(rows[0]);
```

Also extend that route's inline validation object to cover the fields it now accepts, so a `PUT` is validated as strictly as a `POST`:

```js
    const errors = validateBody(body, {
      vehicle_id: { type: "id", label: "Vehicle" },
      maintenance_date: { type: "date", label: "Maintenance date", validate: maintenanceDateRule },
      maintenance_type: { maxLength: 50, label: "Type" },
      description: { maxLength: 1000, label: "Description" },
      cost: { type: "positiveNumber", label: "Cost" },
      status: { maxLength: 30, label: "Status" },
      mileage_at_service: { type: "positiveNumber", label: "Mileage at service" },
      next_service_date: { type: "date", label: "Next service date" },
      next_service_mileage: { type: "positiveNumber", label: "Next service mileage" },
      technician_name: { maxLength: 255, label: "Technician name" },
      service_center_name: { maxLength: 255, label: "Service center" },
      priority: { maxLength: 30, label: "Priority" },
      completed_date: { type: "date", label: "Completed date" },
      notes: { maxLength: 1000, label: "Notes" },
    });
```

- [ ] **Step 10.4 — Verify the round-trip manually**

With the dev server running:

1. `POST /api/vehicle-maintenance` with `next_service_date`, `next_service_mileage`, `technician_name`, `service_center_name` and `notes` set. Confirm **201** and that the returned row carries the values in `next_schedule_date`, `next_schedule_mileage`, `service_provider`, `service_center`, `remarks`. Before this task the same request failed.
2. `POST` with an unknown key such as `"dropped_column": 1`. Confirm it is ignored rather than reaching SQL, and the insert still succeeds.
3. `PUT /api/vehicle-maintenance/<id>` with `status: "Completed"`, a `completed_date` and a `mileage_at_service`. Confirm the vehicle's `last_service_date`, `next_service_date` and `next_service_mileage` all advance per its intervals.
4. Set a vehicle's `service_interval_km` to NULL, complete another record, and confirm `next_service_mileage` is left untouched rather than blanked.

- [ ] **Step 10.5 — Commit**

```bash
git add src/app/api/vehicle-maintenance/route.js src/app/api/vehicle-maintenance/[id]/route.js
git commit -m "fix(api): map maintenance fields to real columns and allowlist writes"
```

---

## Task 11: Server endpoint

Moves the computation off the browser (defect 7) and closes the data exposure — `GET /api/vehicles` is bare `requireAuth` with no role list, so today any authenticated user including a driver can pull the whole fleet.

**Files:**
- Create: `src/app/api/ai/predictive-maintenance/route.js`
- Modify: `src/services/ai.service.js:51-78`

**Interfaces:**
- Consumes: `predictFleet` (Task 6), `requireAuth` / `ok` / `handleError` from `@/lib/api/utils`.
- Produces: `GET /api/ai/predictive-maintenance` → `{ predictions: [...], summary: {...} }`.
- Produces: `getPredictiveMaintenance()` in `ai.service.js`, same exported name, now returning that object.

- [ ] **Step 11.1 — Write the endpoint**

Create `src/app/api/ai/predictive-maintenance/route.js`:

```js
import { query } from "@/lib/db";
import { requireAuth, ok, handleError } from "@/lib/api/utils";
import { predictFleet, USAGE_WINDOW_DAYS } from "@/lib/ai/predictive-maintenance";

/**
 * GET /api/ai/predictive-maintenance
 *
 * Scores every active vehicle on two independent service due-dates — elapsed
 * days and accumulated kilometres — and returns them sorted by whichever
 * arrives first.
 *
 * Computed server-side. The previous implementation fetched
 * /api/vehicles?limit=500 into the browser to perform a date comparison, which
 * shipped the whole fleet to any authenticated caller: that route is bare
 * requireAuth with no role list, so a driver could retrieve it even though the
 * pages consuming it are role-gated. This route matches the page gate in
 * src/lib/auth/permissions.js:32.
 *
 * Not persisted. Inputs change on every trip, so a stored snapshot would only
 * add staleness. The trade-off is no history or trending — that would need a
 * persistence layer and is deliberately out of scope.
 */

// Two CTEs and one pass over vehicles, rather than a query per vehicle.
// Explicit columns, not v.*: the row shape is the engine's input contract and a
// schema change should surface here, not silently alter a prediction.
const FLEET_SQL = `
WITH usage AS (
  SELECT vehicle_id,
         SUM(distance)                    AS km_90d,
         COUNT(*)                         AS trip_count,
         COUNT(DISTINCT DATE(end_time))   AS active_days
    FROM trips
   WHERE trip_status = 'Completed'
     AND deleted_at IS NULL
     AND end_time > NOW() - ($1 || ' days')::INTERVAL
   GROUP BY vehicle_id
),
history AS (
  SELECT vehicle_id,
         COUNT(*) FILTER (WHERE maintenance_type <> 'Routine') AS corrective_count,
         COUNT(*)                                             AS total_count
    FROM vehiclemaintenance
   WHERE deleted_at IS NULL
     AND status = 'Completed'
     AND maintenance_date > NOW() - INTERVAL '365 days'
   GROUP BY vehicle_id
)
SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.mileage,
       v.next_service_date, v.next_service_mileage, v.last_service_date,
       v.service_interval_km, v.service_interval_days, v.vehicle_status,
       u.km_90d, u.trip_count, u.active_days,
       h.corrective_count, h.total_count
  FROM vehicles v
  LEFT JOIN usage   u ON u.vehicle_id = v.vehicle_id
  LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
 WHERE v.deleted_at IS NULL
   AND v.vehicle_status <> 'Decommissioned'
`;

export async function GET(req) {
  try {
    await requireAuth(req, ["system_admin", "admin", "fleet_manager"]);
    const { rows } = await query(FLEET_SQL, [String(USAGE_WINDOW_DAYS)]);
    // One clock for the whole fleet, so two vehicles cannot be scored against
    // instants milliseconds apart and land on different sides of a boundary.
    const { predictions, summary } = predictFleet(rows, new Date());
    return ok({ predictions, summary });
  } catch (e) {
    return handleError(e);
  }
}
```

- [ ] **Step 11.2 — Replace the client-side computation**

In `src/services/ai.service.js`, replace the whole `getPredictiveMaintenance` function (lines 50-78, including the `// Predictive Maintenance` comment) with:

```js
// Predictive Maintenance
// Scoring lives in src/lib/ai/predictive-maintenance.js and runs server-side.
// Returns { predictions, summary } — summary carries precomputed band counts so
// pages read one number per stat card instead of re-filtering the array.
export async function getPredictiveMaintenance() {
  return apiFetch("/api/ai/predictive-maintenance");
}
```

The exported name and zero-argument signature are unchanged, so all four call sites still resolve. They read `predictions` in Task 13.

- [ ] **Step 11.3 — Verify the endpoint**

With the dev server running, as a `fleet_manager`:

1. `GET /api/ai/predictive-maintenance` → **200**, body has `predictions` and `summary`.
2. Confirm `summary.total` equals the number of non-decommissioned, non-deleted vehicles.
3. Confirm `predictions[0].effectiveDays` is the smallest non-null value in the array — the sort is by effective days, not by calendar date.
4. Confirm a vehicle with fewer than 5 completed trips in 90 days has `confidence: "low"` and `projectedDaysToService: null`.
5. As a **driver**, request the same URL → **403**.
6. Decommission a vehicle and confirm it drops out of the response.

- [ ] **Step 11.4 — Commit**

```bash
git add src/app/api/ai/predictive-maintenance/route.js src/services/ai.service.js
git commit -m "feat(api): add server-side predictive maintenance endpoint"
```

---

## Task 12: Delete the dead engine

Defect 5. `calculatePredictiveMaintenance()` is exported and never imported; divergence between it and the live copy in `ai.service.js` is how the capitalisation bug survived unnoticed.

**Files:**
- Modify: `src/lib/ai/rule-engine.js:9-57`

- [ ] **Step 12.1 — Confirm it has no callers**

```bash
grep -rn "calculatePredictiveMaintenance" src/ mobile/ scripts/ supabase/
```

Expect matches only in `src/lib/ai/rule-engine.js` itself. If anything else appears, stop and report it — the deletion assumption is wrong.

- [ ] **Step 12.2 — Delete the function**

Remove lines 9-57 of `src/lib/ai/rule-engine.js` — the `// 1. Predictive Maintenance Calculation` comment through the closing of `calculatePredictiveMaintenance`. Leave `calculateLtoRenewalSchedule`'s import, `scoreReservationVehicles`, `scoreDispatchDrivers`, `makeInsight` and `generateFleetInsights` untouched.

Its one unique behaviour, the low-fuel recommendation, is not maintenance, and `generateFleetInsights()` in the same file already covers that class of alert.

- [ ] **Step 12.3 — Verify nothing broke**

```bash
npx vitest run && npm run lint && npm run build
```

Expect all tests passing, no new lint errors, and a successful build. The build is the real check here — an unresolved import from a deleted export fails it.

- [ ] **Step 12.4 — Commit**

```bash
git add src/lib/ai/rule-engine.js
git commit -m "refactor(ai): delete unused calculatePredictiveMaintenance"
```

---

## Task 13: Update the consuming pages

Four call sites read the old array shape. `predictions` is now nested under an object, so all four break at once if any is missed.

**Files:**
- Modify: `src/app/(dashboard)/maintenance/predictive/page.js`
- Modify: `src/app/(dashboard)/ai/page.js:39-61,175-188`
- Modify: `src/app/(dashboard)/analytics/page.js:35-43`

- [ ] **Step 13.1 — Read the page conventions**

Per `AGENTS.md`, read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` before editing. All three files are `"use client"` components using TanStack Query; that pattern stays.

- [ ] **Step 13.2 — Rewrite the main page's data hook and stat cards**

In `src/app/(dashboard)/maintenance/predictive/page.js`, replace the query and the four filter lines (lines 27-35) with:

```js
  const { data, isLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });
  const predictions = data?.predictions ?? [];
  // Server-precomputed. The four client-side filters this replaces compared
  // against lowercase bands while the service emitted capitalised ones, so
  // every tile read 0 regardless of fleet state.
  const summary = data?.summary ?? { overdue: 0, critical: 0, high: 0, medium: 0, low: 0, total: 0, unscheduled: 0 };
```

Then update the `StatGrid` block (lines 45-50) to read from `summary`:

```js
      <StatGrid cols={4}>
        <StatCard icon={AlertTriangle} label="Overdue" value={summary.overdue} tone="danger" trend="service window passed" />
        <StatCard icon={CalendarDays} label="Critical (7 days)" value={summary.critical} tone="danger" trend="due within a week" />
        <StatCard icon={Activity} label="High (30 days)" value={summary.high} tone="warning" trend="due within a month" />
        <StatCard icon={CheckCircle2} label="Healthy" value={summary.low} tone="success" trend="in good standing" />
      </StatGrid>
```

- [ ] **Step 13.3 — Fix the row badge and add the basis line**

Defect 6: line 89 renders `${p.daysToService} days` for an overdue vehicle, which after the old `Math.max(0, ...)` clamp displayed as "0 days". Replace the `StatusBadge` children (lines 88-90) with:

```js
                        <StatusBadge status={p.risk} entity="risk" className="text-[11px]">
                          {p.effectiveDays === null
                            ? "No schedule"
                            : p.effectiveDays < 0
                            ? `${Math.abs(p.effectiveDays)} days overdue`
                            : `${p.effectiveDays} days`}
                        </StatusBadge>
```

`riskTone()` at lines 17-23 already lowercases its input and already handles `"overdue"`, so it needs no change — it was correct all along and only ever received capitalised values.

Then extend the metadata row (lines 93-102) so the number on screen is explained. A prediction the reader cannot interrogate gets ignored the first time it looks wrong:

```js
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-foreground-muted">
                        <span className="flex items-center gap-1">
                          <Gauge className="w-3.5 h-3.5" /> {p.mileage?.toLocaleString()} km
                        </span>
                        {p.next_service_date && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="w-3.5 h-3.5" /> Next: {formatDate(p.next_service_date)}
                          </span>
                        )}
                        {p.kmToService !== null && (
                          <span className="flex items-center gap-1">
                            <Wrench className="w-3.5 h-3.5" /> {p.kmToService.toLocaleString()} km to service
                          </span>
                        )}
                        {p.basis === "mileage" && (
                          <span className="flex items-center gap-1">
                            <Activity className="w-3.5 h-3.5" /> ~{Math.round(p.kmPerDay)} km/day
                          </span>
                        )}
                        {p.confidence === "low" && p.basis !== null && (
                          <span className="flex items-center gap-1 text-warning">
                            <AlertTriangle className="w-3.5 h-3.5" /> Calendar only — limited trip data
                          </span>
                        )}
                      </div>
```

Update the empty-state description (line 73) to stop promising a prediction that intervals may not support:

```js
              description="Add vehicles and set their service intervals to receive maintenance predictions."
```

- [ ] **Step 13.4 — Update the AI overview page**

In `src/app/(dashboard)/ai/page.js`, the query at lines 39-42 must unwrap the new shape:

```js
  const { data: predictionData, isLoading: predictionsLoading } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });
  const predictions = predictionData?.predictions ?? [];
  const predictionSummary = predictionData?.summary ?? { overdue: 0, critical: 0, high: 0 };
```

Replace the `overdueMaint` filter (lines 58-61) with the precomputed counts:

```js
  const overdueMaint = predictionSummary.overdue + predictionSummary.critical + predictionSummary.high;
```

And fix the badge at line 187, which shows "Overdue" only when days is exactly 0:

```js
                        <StatusBadge status={p.risk} entity="risk" className="text-[11px]">
                          {p.effectiveDays === null
                            ? "—"
                            : p.effectiveDays < 0
                            ? `${Math.abs(p.effectiveDays)}d over`
                            : `${p.effectiveDays}d`}
                        </StatusBadge>
```

- [ ] **Step 13.5 — Update the analytics page**

In `src/app/(dashboard)/analytics/page.js`, replace the query and `maintDue` (lines 35-43):

```js
  const { data: predictionData } = useQuery({
    queryKey: ["predictive-maintenance"],
    queryFn: () => getPredictiveMaintenance(),
  });
  const maintDue = (predictionData?.summary?.overdue ?? 0) + (predictionData?.summary?.critical ?? 0);
```

Verify no other line in that file reads `predictions` — if the local `predictions` binding is removed, its remaining references must go too.

- [ ] **Step 13.6 — Verify in the browser**

Run `npm run dev`, sign in as a `fleet_manager`, and confirm on `/maintenance/predictive`:

1. The stat cards show non-zero counts matching the fleet. **Before this change all four read 0** — this is the headline defect.
2. An overdue vehicle reads "18 days overdue", not "0 days".
3. A high-mileage vehicle shows a `~N km/day` chip and its recommendation names the mileage basis.
4. A vehicle with fewer than 5 trips shows the "Calendar only" warning.
5. `/ai` and `/analytics` render their maintenance counts without a console error.
6. `/ai/predictive-maintenance` still loads (it is deduplicated in Task 14, not here).

- [ ] **Step 13.7 — Commit**

```bash
git add "src/app/(dashboard)/maintenance/predictive/page.js" "src/app/(dashboard)/ai/page.js" "src/app/(dashboard)/analytics/page.js"
git commit -m "fix(ui): read server summary and render overdue and prediction basis"
```

---

## Task 14: Deduplicate the two pages

Defects 1 and 2. `src/app/(dashboard)/ai/predictive-maintenance/page.js` and `src/app/(dashboard)/maintenance/predictive/page.js` are byte-identical, so every fix has to be applied twice or the two silently diverge.

**Files:**
- Modify: `src/app/(dashboard)/ai/predictive-maintenance/page.js`

- [ ] **Step 14.1 — Confirm they are still identical**

```bash
diff "src/app/(dashboard)/ai/predictive-maintenance/page.js" "src/app/(dashboard)/maintenance/predictive/page.js"
```

After Task 13 this now differs — Task 13 edited only the `/maintenance` copy. That is expected and is exactly the divergence this task removes.

- [ ] **Step 14.2 — Replace the duplicate with a redirect**

Both routes are already gated to the same three roles (`src/lib/auth/permissions.js:32,35`), so redirecting loses no access. `/maintenance/predictive` is canonical: it sits with the other maintenance screens, and `/ai/...` framing implies an inference service that does not exist. Existing links to `/ai/predictive-maintenance` (`src/app/(dashboard)/ai/page.js:149`) keep working.

Replace the entire file contents with:

```js
import { redirect } from "next/navigation";

/**
 * Canonical location is /maintenance/predictive.
 *
 * This route was a byte-identical copy of that page, which meant every fix had
 * to be applied twice — and when one was missed, the two diverged silently.
 * Kept as a redirect because /ai links here and the path may be bookmarked.
 */
export default function AiPredictiveMaintenanceRedirect() {
  redirect("/maintenance/predictive");
}
```

Confirm the redirect import path against `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md` before running — this is a version-sensitive API.

- [ ] **Step 14.3 — Verify the redirect**

1. Visit `/ai/predictive-maintenance` → lands on `/maintenance/predictive`.
2. Click "View all →" on `/ai` (visible when there are more than 10 predictions) → same destination.
3. As a role outside the three, confirm access is still refused rather than redirected into a permitted page.

- [ ] **Step 14.4 — Commit**

```bash
git add "src/app/(dashboard)/ai/predictive-maintenance/page.js"
git commit -m "refactor(ui): redirect duplicate predictive maintenance page"
```

---

## Task 15: Service interval inputs

Closes the loop: the migration seeds defaults, but a fleet manager cannot yet change them.

**Files:**
- Modify: `src/lib/validation/schemas.js:38-77`
- Modify: `src/app/api/vehicles/route.js:6-22`
- Modify: `src/app/api/vehicles/[id]/route.js`
- Modify: `src/app/(dashboard)/fleet/vehicles/new/page.js`
- Modify: `src/app/(dashboard)/fleet/vehicles/[id]/page.js:209-211`

- [ ] **Step 15.1 — Add the fields to the Zod schema**

In `src/lib/validation/schemas.js`, add to `vehicleSchema` after `next_service_mileage` (line 76), following the existing `z.preprocess` idiom for optional numerics.

The floor is **1, not 0**. `0` is not an inert value here: `deriveNextSchedule` adds the interval to the completion date and to the odometer reading at the service, so a zero interval makes the vehicle due the instant it is serviced and overdue every day after — and re-servicing it reproduces the same value rather than clearing it. Migration 018 states the distinction the column encodes: "NULL is meaningful and is NOT the same as 0." Blank stays the way to opt an axis out. `.int()` matches the `INT` columns the migration declares.

```js
  service_interval_km: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number()
      .int("Service interval (km) must be a whole number.")
      .min(1, "Service interval (km) must be at least 1. Leave it blank to skip mileage-based prediction.")
      .optional()
  ),
  service_interval_days: z.preprocess(
    (v) => (v === "" || v === undefined || v === null ? undefined : Number(v)),
    z
      .number()
      .int("Service interval (days) must be a whole number.")
      .min(1, "Service interval (days) must be at least 1. Leave it blank to skip time-based prediction.")
      .optional()
  ),
```

- [ ] **Step 15.2 — Add them to both vehicle route schemas**

In `src/app/api/vehicles/route.js`, add to `vehicleWriteSchema` (after line 19). `min: 1` for the reason given in Step 15.1 — the helper's own `min` defaults to 0, so it has to be stated:

```js
  service_interval_km: { type: "positiveNumber", label: "Service interval (km)", min: 1, integer: true },
  service_interval_days: { type: "positiveNumber", label: "Service interval (days)", min: 1, integer: true },
```

Read `src/app/api/vehicles/[id]/route.js` and add the same two entries to its write schema. Both routes build their SQL from `Object.keys(body)`, so once validation accepts the fields the write follows — but confirm that route does not carry a separate column allowlist that also needs them.

- [ ] **Step 15.3 — Add the form inputs**

In `src/app/(dashboard)/fleet/vehicles/new/page.js`, add both fields to `defaultValues` (after line 131):

```js
      service_interval_km: undefined,
      service_interval_days: undefined,
```

and to the `form.reset` block (after line 153):

```js
        service_interval_km: vehicle.service_interval_km || undefined,
        service_interval_days: vehicle.service_interval_days || undefined,
```

Then add a section after the LTO block's closing `</div>` (line 424), before the Form Action Buttons. Each input renders its own validation message in the file's existing error style (see `plate_number` at lines 296-298) — without it, a rejected interval fails the resolver and blocks submit with nothing on screen, and Step 15.5's point 5 could not pass. For the two interval inputs the error replaces the helper text rather than stacking under it:

```jsx
                {/* Service Schedule — drives predictive maintenance */}
                <div className="border-t border-border pt-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground-secondary mb-3">
                    Preventive Maintenance Schedule
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="service_interval_km">Service Interval (km)</Label>
                      <Input id="service_interval_km" type="number" {...form.register("service_interval_km")} placeholder="5000" />
                      {form.formState.errors.service_interval_km ? (
                        <p className="text-xs text-danger">{form.formState.errors.service_interval_km.message}</p>
                      ) : (
                        <p className="text-[11px] text-foreground-muted">Leave blank to predict on elapsed time only.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="service_interval_days">Service Interval (days)</Label>
                      <Input id="service_interval_days" type="number" {...form.register("service_interval_days")} placeholder="180" />
                      {form.formState.errors.service_interval_days ? (
                        <p className="text-xs text-danger">{form.formState.errors.service_interval_days.message}</p>
                      ) : (
                        <p className="text-[11px] text-foreground-muted">Leave blank to predict on mileage only.</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="next_service_date">Next Service Date</Label>
                      <Input id="next_service_date" type="date" {...form.register("next_service_date")} />
                      {form.formState.errors.next_service_date && (
                        <p className="text-xs text-danger">{form.formState.errors.next_service_date.message}</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="next_service_mileage">Next Service Mileage</Label>
                      <Input id="next_service_mileage" type="number" {...form.register("next_service_mileage")} placeholder="55000" />
                      {form.formState.errors.next_service_mileage && (
                        <p className="text-xs text-danger">{form.formState.errors.next_service_mileage.message}</p>
                      )}
                    </div>
                  </div>
                </div>
```

`next_service_date` and `next_service_mileage` were already in `defaultValues` and the Zod schema but had **no inputs at all** — they were unreachable through the UI, which is a large part of why vehicles carried no schedule.

- [ ] **Step 15.4 — Surface the intervals on the detail page**

In `src/app/(dashboard)/fleet/vehicles/[id]/page.js`, after the "Next Service Mileage" block (lines 208-211), add:

```jsx
                <div>
                  <p className="text-xs text-foreground-muted">Next Service Date</p>
                  <p className="font-medium text-foreground">{vehicle.next_service_date ? formatDate(vehicle.next_service_date) : "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-foreground-muted">Service Interval</p>
                  <p className="font-medium text-foreground">
                    {[
                      vehicle.service_interval_km ? `${formatNumber(vehicle.service_interval_km)} km` : null,
                      vehicle.service_interval_days ? `${vehicle.service_interval_days} days` : null,
                    ].filter(Boolean).join(" / ") || "—"}
                  </p>
                </div>
```

- [ ] **Step 15.5 — Verify end to end**

1. Create a vehicle with `service_interval_km` 10000 and `service_interval_days` 90. Confirm both persist.
2. Edit an existing vehicle, clear `service_interval_km`, save. Confirm it stores NULL rather than 0 — NULL and 0 mean different things to the engine.
3. Confirm the detail page shows "10,000 km / 90 days".
4. Complete a maintenance record on that vehicle and confirm the next due-dates advance by 10000 km / 90 days.
5. Submit a negative interval and confirm the validation error surfaces.
6. Submit `0` and confirm it is rejected too, with the message pointing at blank as the way to opt the axis out.

- [ ] **Step 15.6 — Commit**

```bash
git add src/lib/validation/schemas.js src/app/api/vehicles/route.js "src/app/api/vehicles/[id]/route.js" "src/app/(dashboard)/fleet/vehicles/new/page.js" "src/app/(dashboard)/fleet/vehicles/[id]/page.js"
git commit -m "feat(fleet): expose service interval and next service fields in the UI"
```

---

## Task 16: Full verification

- [ ] **Step 16.1 — Run everything**

```bash
npx vitest run && npm run lint && npm run build
```

All engine, odometer and schedule tests pass; no new lint errors; build succeeds.

- [ ] **Step 16.2 — Walk the seven defects**

Confirm each original defect is closed, in order:

1. **Duplicate pages** — `/ai/predictive-maintenance` redirects; one implementation remains.
2. **Case mismatch** — stat cards show real counts. Bands come from `RISK`; `grep -rn '"Critical"\|"High"\|"Medium"' src/lib/ai src/services` returns nothing for risk bands.
3. **Broken maintenance API** — a `POST` carrying `next_service_date` / `technician_name` / `notes` returns 201 and persists to the real columns.
4. **Stale mileage** — completing a trip raises `vehicles.mileage`; a below-current reading is rejected with 400.
5. **Dead engine** — `grep -rn "calculatePredictiveMaintenance" src/` is empty.
6. **Overdue display** — an overdue vehicle reads "N days overdue", never "0 days".
7. **Client-side computation** — a driver gets 403 from `/api/ai/predictive-maintenance`; the page issues one request, not a fleet fetch.

- [ ] **Step 16.3 — Confirm it is actually predictive**

The point of the work, not just the bug fixes. Take a vehicle whose calendar date is months out but whose mileage burn rate brings it due within days:

1. Confirm it appears **above** vehicles with nearer calendar dates.
2. Confirm `basis: "mileage"` and that its recommendation names the km/day rate.
3. Zero out its trips in the last 90 days, refetch, and confirm it falls back to `confidence: "low"`, `basis: "time"`, and shows the "Calendar only" warning.

This is the behaviour the old implementation could not produce at all.

- [ ] **Step 16.4 — Final commit**

```bash
git add -A && git commit -m "test: verify predictive maintenance end to end"
```

---

## Notes for the Implementer

**Two things carry the most risk:**

1. **Task 8 (odometer write-back)** is the only task that writes to a column other systems read. Verify each of the four cases in Step 8.4 against the real database. `GREATEST` is deliberate: a retried request delivering a stale low reading must not regress mileage.

2. **Task 10 (field mapping)** changes what reaches SQL. Verify the live `information_schema` in Step 10.1 rather than trusting this document — if the real column names differ, the live schema wins and the difference goes in the commit body.

**Dev fixture dates expire.** Per project memory, dated driver and vehicle seeds lapse and then refuse every dispatch. If trips will not start during verification, check the fixture dates before suspecting this work.

**Band boundary change.** medium/low moves from 30 to 90 days. The "Healthy" tile now counts only vehicles more than 90 days out, so it will read lower than the old implementation would have — that is intended, not a regression.

**Out of scope, deliberately:**
- Mobile odometer OCR (deferred at the user's request; documented in the design spec).
- Historical trending or persisted prediction snapshots.
- Per-component intervals (tyres, brakes) — one prediction per vehicle.
- Category-based interval policy — rejected because `vehiclecategories` encodes guest tier, not duty cycle.

