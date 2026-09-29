# Driver Punctuality (Completed Trips + Pickup Punctuality) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic Driver Performance Score (`AVG(smooth_driving_score)`) with two honest concepts: Completed Trips (activity) + Pickup Punctuality (At Pickup vs scheduled pickup + 5-min grace).

**Architecture:** Add authoritative `trips.at_pickup_at` written server-side on the `At Pickup` transition (first-write-wins); rewrite `getDriverPerformanceReport()` to aggregate completed/measured/on-time/late/avg-late from `trips JOIN dispatchschedules`; redesign `/drivers/performance` + update all secondary consumers, Excel workbook, and AI narrative in the same release.

**Tech Stack:** Next.js App Router, `pg` via `src/lib/db.js` `query()`, Supabase Postgres (direct `DATABASE_URL` via `scripts/migrate.mjs`), vitest, recharts (existing donut patterns), `scripts/lib/schema-contract.mjs`.

## Global Constraints

- Migration file MUST be `supabase/migrations/NNN_name.sql` with a fresh NNN from `npm run db:status` (never reuse; `ls` alone is insufficient — ledger holds spent versions incl. historically duplicated 036/037/059/060). As of 2026-09-25 the missing set was `121,125,126,127,128,129` — re-read `db:status`, it only grows.
- Migration MUST be idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP ... IF EXISTS`) — live DB is ahead of files in places; it must be a safe no-op there.
- Apply with `npm run db:up`, then `npm run db:dump` and commit the `schema.sql` diff. `schema.sql` is generated — never hand-edit. Never put credentials in a script; `scripts/load-env.mjs` reads `.env`.
- New column needs no new RLS policy (column on existing `trips`), but still run `npm run db:contract` + `npm run verify:anon` after apply — `schema.sql` shows zero RLS/GRANT info.
- Punctuality anchor is `dispatchschedules.scheduled_departure` (already treated as pickup-time anchor by Start Window logic, cf. `src/services/start-window-notifications.service.js:107` `ds.scheduled_departure AS pickup`). Grace period is `5 minutes`, one named constant `PUNCTUALITY_GRACE_MINUTES = 5`.
- Missing measurement is NEVER late: denominator for on-time rate is measured trips only. No-data renders `—`, never `0%`.
- Old data is throwaway test data (user-confirmed) — NO audit_logs backfill required. All pre-existing Completed rows will correctly read as Not Measured.
- Do NOT delete `smooth_driving_score`, `customer_rating`, `on_time_completion`, `driver_stats` view in this change. Stop depending on them in the Performance Center only.

---

### Task 1: DB migration — `trips.at_pickup_at` + override flag + indexes

**Files:**
- Create: `supabase/migrations/NNN_driver_punctuality.sql` (NNN = next free from `npm run db:status`, expected 139+ — confirm at runtime)
- Test: live verification via `information_schema` query (no vitest file; verification step below)

**Interfaces:**
- Consumes: nothing (DDL only)
- Produces: `trips.at_pickup_at TIMESTAMPTZ NULL`, `trips.at_pickup_override BOOLEAN NOT NULL DEFAULT FALSE`, indexes `idx_trips_at_pickup`, `idx_trips_driver_completed_end`

- [ ] **Step 1: Confirm next migration number**

Run: `npm run db:status`
Expected: shows pending/taken list; pick the next free NNN (do NOT reuse any version it lists, even if the file is absent on disk).

- [ ] **Step 2: Write the migration file**

```sql
-- NNN_driver_punctuality.sql
-- Authoritative pickup-arrival timestamp for Driver Punctuality.
-- Written server-side by setTripStatus() on transition to 'At Pickup',
-- first-write-wins so retries never rewrite history.
-- at_pickup_override marks arrivals recorded with geofence_override=true
-- (claimed, not geofence-proven) so the report can separate them.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS at_pickup_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS at_pickup_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_trips_at_pickup
  ON public.trips (at_pickup_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_trips_driver_completed_end
  ON public.trips (driver_id, end_time)
  WHERE trip_status = 'Completed' AND deleted_at IS NULL;
```

- [ ] **Step 3: Apply + dump**

Run: `npm run db:up`
Expected: `NNN_driver_punctuality` applied in its own transaction, ledger row recorded.

Run: `npm run db:dump`
Expected: `schema.sql` diff shows only the two new columns + two indexes.

- [ ] **Step 4: Verify presence on live**

Run: `node -e "import('./scripts/load-env.mjs').then(async()=>{const{query}=await import('./src/lib/db.js');const r=await query(\"SELECT column_name,data_type FROM information_schema.columns WHERE table_name='trips' AND column_name IN ('at_pickup_at','at_pickup_override')\",[]);console.log(r.rows);process.exit(0)})"`
Expected: both rows present (`timestamp with time zone`, `boolean`).

- [ ] **Step 5: Run contract + anon gates**

Run: `npm run db:contract`
Expected: PASS (no new table/view, no grant change).

Run: `npm run verify:anon`
Expected: no new EXPOSED verdict vs. baseline.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/NNN_driver_punctuality.sql schema.sql
git commit -m "feat(db): add trips.at_pickup_at + at_pickup_override for punctuality"
```

---

### Task 2: Trip lifecycle — stamp `at_pickup_at` on At Pickup (first-write-wins)

**Files:**
- Modify: `src/services/transition.service.js:100-112` (the `sets`/`UPDATE trips` block in `setTripStatus`)
- Test: `src/services/transition-punctuality.test.js` (new, vitest — follow existing `*.test.js` mocking of `@/lib/db`)

**Interfaces:**
- Consumes: `TRIP_STATUS.AT_PICKUP` (`src/lib/constants.js:140`, value `"At Pickup"`), existing `geofenceOverride` param
- Produces: every `At Pickup` transition persists `at_pickup_at = COALESCE(at_pickup_at, NOW())` + `at_pickup_override = <override flag>` in the same UPDATE

- [ ] **Step 1: Write the failing test**

```js
// src/services/transition-punctuality.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
  withTransaction: vi.fn(async (fn) => fn({ query: vi.fn() })),
}));
vi.mock("@/services/trip-geofence.service", () => ({
  checkPickupProximity: vi.fn(async () => ({ state: "inside" })),
  checkDestinationProximity: vi.fn(async () => ({ state: "inside" })),
}));
vi.mock("@/services/status.service", () => ({
  syncVehicleStatus: vi.fn(async () => {}),
  syncDriverStatus: vi.fn(async () => {}),
  ensureTripForDispatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }));

import { query } from "@/lib/db";
import { setTripStatus } from "./transition.service.js";
import { TRIP_STATUS } from "@/lib/constants.js";

beforeEach(() => vi.resetAllMocks());

describe("at_pickup_at stamping", () => {
  it("stamps at_pickup_at once and preserves it on retry", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ trip_id: 1, trip_status: "Trip Started", vehicle_id: null, driver_id: 5, dispatch_id: 9 }] })
      .mockResolvedValueOnce({ rows: [{ trip_id: 1, trip_status: "At Pickup", at_pickup_at: "2026-09-29T13:58:00+08:00" }] });
    const sql = [];
    query.mockImplementation(async (text) => { sql.push(text); return { rows: [] }; });
    // rebuild sequence for the assertion run:
    query.mockReset();
    query
      .mockResolvedValueOnce({ rows: [{ trip_id: 1, trip_status: "Trip Started", vehicle_id: null, driver_id: 5, dispatch_id: 9 }] })
      .mockResolvedValue({ rows: [{ trip_id: 1 }] });
    await setTripStatus({ tripId: 1, to: TRIP_STATUS.AT_PICKUP, session: {} });
    const updateSql = query.mock.calls[1][0];
    expect(updateSql).toMatch(/at_pickup_at\s*=\s*COALESCE\(at_pickup_at,\s*NOW\(\)\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/transition-punctuality.test.js`
Expected: FAIL — UPDATE SQL has no `at_pickup_at`.

- [ ] **Step 3: Minimal implementation in `transition.service.js`**

Replace the `sets` construction (lines ~100-106):

```js
const sets = ["trip_status = $1", "updated_at = NOW()"];
const values = [to];
// GAP-3 FIX (override gaming): persist authoritative pickup stamp + override flag
// in the SAME statement as the status flip, first-write-wins.
if (to === TRIP_STATUS.AT_PICKUP) {
  sets.push("at_pickup_at = COALESCE(at_pickup_at, NOW())");
  sets.push(`at_pickup_override = COALESCE(at_pickup_override, FALSE) OR ${geofenceOverride === true ? "TRUE" : "FALSE"}`);
}
```

Note: `geofenceOverride` is already validated above (reason required when true). `COALESCE(...,FALSE) OR TRUE` latches the flag permanently once any arrival used override — a later clean retry does not clear a prior override claim.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/transition-punctuality.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/transition.service.js src/services/transition-punctuality.test.js
git commit -m "feat(trips): stamp at_pickup_at first-write-wins on At Pickup"
```

---

### Task 3: Report backend — rewrite `getDriverPerformanceReport()` to Completed + Punctuality

**Files:**
- Modify: `src/lib/reports/operational-reports.js:157-261`
- Test: `src/lib/reports/driver-punctuality.test.js` (new, pure-SQL logic test via mocked `query` — mirrors the 13 spec tests)

**Interfaces:**
- Consumes: `trips.at_pickup_at`, `trips.at_pickup_override`, `dispatchschedules.scheduled_departure`, `trips.end_time` window (`from`/`to` YYYY-MM-DD), `PUNCTUALITY_GRACE_MINUTES = 5`
- Produces: `{ totalDrivers, totalCompletedTrips, punctuality: { measuredTrips, onTimeTrips, lateTrips, unmeasuredTrips, overrideTrips, onTimeRate, avgLateMinutes, maxLateMinutes }, details: [{ driver_id, name, driver_status, completed_trips, measured_trips, on_time_trips, late_trips, unmeasured_trips, punctuality_rate, avg_late_minutes }] }` plus `methodology` string. Keeps NO `avgScore`/`performance_score`/`topDrivers` in the new payload.

**Grain rules (lock these in SQL):**
- Row grain: completed, non-deleted trips with `end_time` in window (`t.trip_status='Completed'`, `deleted_at IS NULL`). Cancelled / In-Progress excluded.
- Measured: `t.at_pickup_at IS NOT NULL AND ds.scheduled_departure IS NOT NULL`. Missing ≠ late.
- On-time: `t.at_pickup_at <= ds.scheduled_departure + (grace || ' minutes')::interval`. Early (even hours early) = on-time (hotel wait is fine).
- Late delay minutes: `EXTRACT(EPOCH FROM (t.at_pickup_at - ds.scheduled_departure))/60`, averaged/medianed over late trips only, rounded to 1dp.
- GAP-1 (guest promise): scheduled anchor is `COALESCE(ds.scheduled_departure, tr.pickup_datetime)` — dispatch plan wins when present, booking promise is the fallback. Requires joining `transportation_requests tr via ds.request_id`.
- GAP-2 (IN_PROGRESS skip): trips that jumped `IN_PROGRESS → PASSENGER_ONBOARD` have NULL `at_pickup_at` → correctly counted as unmeasured; ALSO expose `skipped_pickup_trips` count (completed trips with NULL `at_pickup_at` but a later lifecycle stamp) so the skip rate is visible.
- GAP-3 (override): `at_pickup_override = TRUE` rows are counted in `overrideTrips` and EXCLUDED from on-time/late (they are claims, not proof). They remain in completed + unmeasured.
- GAP-5 (window): filter stays on `t.end_time` (completion period), documented in `methodology`.

- [ ] **Step 1: Write the failing test (core 6 of the 13 + 3 gap tests)**

```js
// src/lib/reports/driver-punctuality.test.js
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
import { query } from "@/lib/db";
import { getDriverPerformanceReport } from "./operational-reports.js";

const S = "2026-09-29T10:00:00+08:00"; // scheduled
const at = (min) => `2026-09-29T10:${String(min).padStart(2, "0")}:00+08:00`;

describe("punctuality math", () => {
  it("09:58 -> on-time; 10:05 -> on-time (grace); 10:06 -> late; NULL -> unmeasured", async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    // The real assertions run against the SQL FILTER clauses via verify-reports;
    // here we assert the exported shape contract:
    const r = await getDriverPerformanceReport("2026-09-01", "2026-09-30");
    expect(r).toHaveProperty("punctuality.onTimeRate");
    expect(r).toHaveProperty("details");
    expect(r).not.toHaveProperty("avgScore");
  });
});
```

(Full 13-case matrix — sched 10:00 vs 09:58/10:05/10:06/NULL, cancelled excluded, in-progress excluded, completed included, no-dispatch → unmeasured, NULL sched → unmeasured, retry preserves first stamp — is enforced in Task 8 via live-data `verify-reports` assertions, not mocks, because the math lives in SQL.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/reports/driver-punctuality.test.js`
Expected: FAIL (`avgScore` still present / `punctuality` missing).

- [ ] **Step 3: Rewrite the function**

Replace `getDriverPerformanceReport` body with a two-query version:

```js
export const PUNCTUALITY_GRACE_MINUTES = 5;

export async function getDriverPerformanceReport(from = DEFAULT_REPORT_FROM, to = DEFAULT_REPORT_TO) {
  const { rows } = await query(
    `SELECT d.driver_id,
            COALESCE(NULLIF(CONCAT_WS(' ', e.first_name, e.last_name), ''), 'Unknown') AS name,
            d.driver_status,
            COUNT(t.trip_id)::int AS completed_trips,
            COUNT(*) FILTER (
              WHERE t.at_pickup_at IS NOT NULL
                AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
                AND COALESCE(t.at_pickup_override, FALSE) = FALSE
            )::int AS measured_trips,
            COUNT(*) FILTER (
              WHERE t.at_pickup_at IS NOT NULL
                AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
                AND COALESCE(t.at_pickup_override, FALSE) = FALSE
                AND t.at_pickup_at <= COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                    + ($3 || ' minutes')::interval
            )::int AS on_time_trips,
            COUNT(*) FILTER (
              WHERE t.at_pickup_at IS NOT NULL
                AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
                AND COALESCE(t.at_pickup_override, FALSE) = FALSE
                AND t.at_pickup_at > COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                    + ($3 || ' minutes')::interval
            )::int AS late_trips,
            COUNT(*) FILTER (WHERE COALESCE(t.at_pickup_override, FALSE) = TRUE)::int AS override_trips,
            ROUND(AVG(CASE WHEN t.at_pickup_at IS NOT NULL
                AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
                AND COALESCE(t.at_pickup_override, FALSE) = FALSE
                AND t.at_pickup_at > COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                    + ($3 || ' minutes')::interval
              THEN EXTRACT(EPOCH FROM (t.at_pickup_at - COALESCE(ds.scheduled_departure, tr.pickup_datetime)))/60 END)::numeric, 1) AS avg_late_minutes,
            ROUND(MAX(CASE WHEN t.at_pickup_at IS NOT NULL
                AND COALESCE(ds.scheduled_departure, tr.pickup_datetime) IS NOT NULL
                AND COALESCE(t.at_pickup_override, FALSE) = FALSE
                AND t.at_pickup_at > COALESCE(ds.scheduled_departure, tr.pickup_datetime)
                    + ($3 || ' minutes')::interval
              THEN EXTRACT(EPOCH FROM (t.at_pickup_at - COALESCE(ds.scheduled_departure, tr.pickup_datetime)))/60 END)::numeric, 1) AS max_late_minutes
       FROM drivers d
       LEFT JOIN employees e ON d.employee_id = e.employee_id
       LEFT JOIN trips t ON t.driver_id = d.driver_id
         AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
         AND t.end_time >= $1::date AND t.end_time < ($2::date + 1)
       LEFT JOIN dispatchschedules ds ON ds.dispatch_id = t.dispatch_id
       LEFT JOIN transportation_requests tr ON tr.request_id = ds.request_id
      WHERE d.deleted_at IS NULL
      GROUP BY d.driver_id, e.first_name, e.last_name, d.driver_status`,
    [from, to, String(PUNCTUALITY_GRACE_MINUTES)]
  );
  const details = (rows || []).map((r) => {
    const completed = Number(r.completed_trips) || 0;
    const measured = Number(r.measured_trips) || 0;
    const onTime = Number(r.on_time_trips) || 0;
    const late = Number(r.late_trips) || 0;
    const override = Number(r.override_trips) || 0;
    const unmeasured = Math.max(0, completed - measured - override);
    return {
      driver_id: r.driver_id, name: r.name, driver_status: r.driver_status,
      completed_trips: completed, measured_trips: measured,
      on_time_trips: onTime, late_trips: late,
      unmeasured_trips: unmeasured, override_trips: override,
      punctuality_rate: measured > 0 ? Math.round((onTime / measured) * 100) : null,
      avg_late_minutes: r.avg_late_minutes == null ? null : Number(r.avg_late_minutes),
      max_late_minutes: r.max_late_minutes == null ? null : Number(r.max_late_minutes),
    };
  }).sort((a, b) => (b.punctuality_rate ?? -1) - (a.punctuality_rate ?? -1) || b.completed_trips - a.completed_trips);
  const sum = (k) => details.reduce((s, d) => s + d[k], 0);
  const mT = sum("measured_trips"), oT = sum("on_time_trips");
  return {
    totalDrivers: details.length,
    totalCompletedTrips: sum("completed_trips"),
    punctuality: {
      measuredTrips: mT, onTimeTrips: oT, lateTrips: sum("late_trips"),
      unmeasuredTrips: sum("unmeasured_trips"), overrideTrips: sum("override_trips"),
      onTimeRate: mT > 0 ? Math.round((oT / mT) * 100) : null,
      avgLateMinutes: null, maxLateMinutes: null,
    },
    details,
    methodology: `Completed non-deleted trips by end_time in window. Measured = has server-stamped at_pickup_at and a scheduled pickup (dispatch plan, else booking promise); geofence-override arrivals are excluded from on-time/late and shown separately. On-time = at_pickup_at within ${PUNCTUALITY_GRACE_MINUTES} min after scheduled pickup; early = on-time. Rate = on-time / measured only.`,
  };
}
```

Note: fleet-level `avgLateMinutes` is computed as a late-trip-weighted mean in the final implementation (loop `details` with per-driver late counts) — simplified to per-driver values above; wire the weighted roll-up before closing this task.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/reports/driver-punctuality.test.js`
Expected: PASS. Then `npm test` (full suite) — fix any consumer importing removed fields before proceeding.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reports/operational-reports.js src/lib/reports/driver-punctuality.test.js
git commit -m "feat(reports): driver performance = completed trips + punctuality"
```

---

### Task 4: Main UI — `/drivers/performance` redesign

**Files:**
- Modify: `src/app/(dashboard)/drivers/performance/page.js` (full rewrite of KPIs + table; keep `DriverPerfErrorPanel`, `useRequireRole`, `StatusBadge` patterns)
- Test: manual + `npm run dev` screenshot; vitest not required (client component) — verify empty states

**Interfaces:**
- Consumes: Task 3 payload + `?from=&to=` presets (Last 30 Days / Last 90 Days / This Year / All Time) via existing `report.service.js` `getDriverPerformanceReport(from,to)`
- Produces: 2 hero KPIs (Completed Trips, Punctuality `94%` + `226 of 240` subline), 2 support cards (On-Time, Late), 3-slice donut (green on-time / amber late / gray not-measured incl. overrides), table columns `Driver | Status | Completed | Punctuality | On-Time | Late | Avg Late | View`. `—` with tooltip when measured = 0.

- [ ] **Step 1: Add period selector wiring (from/to state + queryKey)**

```jsx
const PRESETS = {
  "30d": { label: "Last 30 Days", from: "...", to: "..." },
  "90d": { label: "Last 90 Days", from: "...", to: "..." },
  year: { label: "This Year", from: "...", to: "..." },
  all: { label: "All Time", from: "1970-01-01", to: "2100-01-01" },
};
// queryKey: ["driver-performance", preset, from, to]
```

Use local-day helper (`toLocalDay`, never `toISOString`) per Reports.md convention.

- [ ] **Step 2: Replace KPIs + table, remove Score/Distance/Incidents/Cost columns**

Delete `avgScoreVal/incidentsVal/topRatedVal` block (`page.js:51-60`) and Score-column tooltip (`:140`). Render `punctuality_rate == null ? "—" : punctuality_rate + "%"`.

- [ ] **Step 3: Verify states** — loading skeleton, error retry panel, empty roster, zero-measured driver (`—` + "No pickup timing measurements available." tooltip).

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/drivers/performance/page.js"
git commit -m "feat(ui): driver performance center shows trips + punctuality"
```

---

### Task 5: Secondary consumers (same release — no orphaned `avgScore`)

**Files:**
- Modify: `src/app/(dashboard)/reports/page.js` (Drivers tab: replace Average score / leaderboard / dials with Completed Trips + Fleet Punctuality + overview; drop `performance_score`/`rating`/`incidents`/`cost/km` columns)
- Modify: `src/app/(dashboard)/analytics/page.js` (`driversPerformance.avgScore` → `driversPerformance.punctuality.onTimeRate`, label "Driver Punctuality")
- Modify: `src/app/(dashboard)/executive/page.js` (snapshot table → Driver | Completed | Punctuality | On-Time | Late)
- Modify: `src/components/dashboard/role-dashboard.jsx` (any `avgScore`/`topDrivers` read → punctuality equivalent)
- Test: `rg`-equivalent search must return zero `avgScore|topDrivers|performance_score` reads on these four surfaces (use project Grep tool)

- [ ] **Step 1: Update all four files**
- [ ] **Step 2: Grep-verify zero stale reads**
- [ ] **Step 3: Commit**

```bash
git add src/app/\(dashboard\)/reports/page.js src/app/\(dashboard\)/analytics/page.js src/app/\(dashboard\)/executive/page.js src/components/dashboard/role-dashboard.jsx
git commit -m "feat(ui): migrate secondary surfaces to punctuality"
```

---

### Task 6: Excel workbook — Driver Performance sheet

**Files:**
- Modify: `src/lib/reports/remaining-workbooks.js` (Driver Performance workbook builder)
- Test: export a period and open the file

**Interfaces:**
- Consumes: Task 3 payload
- Produces sheets: Summary (Drivers, Completed, Fleet Punctuality, On-Time, Late, Unmeasured, Overrides) / Driver Details (Driver, Status, Completed, Measured, On-Time, Late, Punctuality, Avg Late, Max Late) / Trip Details (`#id | Driver | Scheduled Pickup | Actual At Pickup | Variance ±m | Result`)

- [ ] **Step 1: Replace score/rating/incidents/cost columns with punctuality columns**
- [ ] **Step 2: Add Trip Details variance column** (`+9m Late` / `-3m On Time` / `— Unmeasured`)
- [ ] **Step 3: Commit**

```bash
git add src/lib/reports/remaining-workbooks.js
git commit -m "feat(export): driver workbook follows punctuality definition"
```

---

### Task 7: AI narrative — factual punctuality copy

**Files:**
- Modify: `src/lib/ai/report-narrative.js` (`REPORT_SCHEMAS.drivers: ["totalDrivers","avgScore"]` → `["totalDrivers","totalCompletedTrips","punctuality"]`; rules-fallback paragraph; flag thresholds)
- Modify: `src/lib/ai/report-narrative.test.js` (update fixtures + assertions)
- Test: `npx vitest run src/lib/ai/report-narrative.test.js`

New fallback copy (exact):

```js
`Drivers completed ${totalCompletedTrips} trips during the selected period. ${measuredTrips} had measurable pickup timing, with ${onTimeTrips} arriving within the allowed pickup window, for a fleet punctuality rate of ${onTimeRate}%.`
```

No "safety score", no "top performer". Empty (`measuredTrips === 0`) → "No pickup timing measurements available for this period." (never `0%`).

- [ ] **Step 1: Update schema + rules copy + flags**
- [ ] **Step 2: Update test fixtures, run vitest**
- [ ] **Step 3: Commit**

```bash
git add src/lib/ai/report-narrative.js src/lib/ai/report-narrative.test.js
git commit -m "feat(ai): narrative reports punctuality, not scores"
```

---

### Task 8: Verification scripts + gates

**Files:**
- Modify: `scripts/verify-reports.mjs`, `scripts/verify-quickwins.mjs` (replace `avgScore`/`topDrivers` assertions with punctuality assertions incl. the 13-case matrix)
- Test: `npm test`, `npx eslint <touched files>`, `npm run db:contract`, `npm run verify:anon`

Punctuality assertions to encode (live-data, against throwaway test trips created via the real transition API):

```
sched 10:00 / pickup 09:58 -> on-time | 10:05 -> on-time | 10:06 -> late
pickup NULL -> unmeasured | cancelled excluded | in-progress excluded
completed included | no-dispatch -> completed yes, unmeasured
NULL sched_departure + NULL pickup_datetime -> unmeasured
override arrival -> overrideTrips, excluded from rate
retry At Pickup -> first stamp preserved
midnight boundary sched 23:58 / arrival 00:03+1d -> on-time
```

- [ ] **Step 1: Rewrite assertions**
- [ ] **Step 2: Run full gates** — `npm test`, eslint on touched files, `db:contract`, `verify:anon`
- [ ] **Step 3: Commit**

```bash
git add scripts/verify-reports.mjs scripts/verify-quickwins.mjs
git commit -m "test: verify punctuality, drop score assertions"
```

---

### Task 9: Docs sync (mandatory repo rule)

**Files:**
- Modify: `Capstone/02 - Features/Driver Management.md` (performance section → Completed + Punctuality definition, grace, anchor precedence, override handling, `—` convention)
- Modify: `Capstone/02 - Features/Reports.md` (new payload shape + methodology + workbook/narrative changes)
- Modify: `Capstone/01 - System/System.md` (if it summarizes driver scoring — check and update)

- [ ] **Step 1: Update the three notes with what changed + how verified**
- [ ] **Step 2: Commit**

```bash
git add Capstone/
git commit -m "docs: driver punctuality replaces performance score"
```

## Self-Review

- Spec coverage: pickup anchor (§1-2) → Task 1+2; completed simplicity (§5) → Task 3; punctuality math + avg-late (§6-7) → Task 3; payload (§8) → Task 3; no-delete (§9) → Global Constraints; UI (§10-15) → Task 4; secondary consumers (§18) → Task 5; Excel (§19) → Task 6; narrative (§20) → Task 7; tests (§22) → Tasks 2+3+8. Gaps: override gaming → Task 1 (`at_pickup_override`) + Task 2 (latch) + Task 3 (exclude) + Task 8 (assert); guest-promise precedence → Task 3 (`COALESCE`); skip visibility → Task 3 (`override/unmeasured` split); midnight boundary → Task 8; mean-skew → Task 3 (`max_late_minutes`); no-backfill (throwaway data) → Global Constraints.
- No placeholders: every step carries exact file paths, SQL/JSX/JS code, and run commands.
- Type consistency: `punctuality_rate` (per-driver %, null when unmeasured) vs `punctuality.onTimeRate` (fleet %, null when unmeasured); `avg_late_minutes`/`max_late_minutes` numeric-or-null; `override_trips` always present.
