# Predictive Maintenance — Design

**Date:** 2026-08-04
**Status:** Approved, pending implementation plan

## Problem

The feature named "predictive maintenance" is a calendar reminder. It compares
`vehicles.next_service_date` against today and nothing else. It is also broken in
ways that make it read as empty rather than wrong, so the breakage has gone
unnoticed.

### Defects

1. **Every stat card reads 0.** The service emits capitalised risk bands
   (`"Critical"`, `"High"`, `"Medium"`, `"Low"` — `src/services/ai.service.js:58-60`)
   while all four consumer pages filter on lowercase (`p.risk === "critical"` —
   `src/app/(dashboard)/maintenance/predictive/page.js:32-35`). No comparison ever
   matches. The counters are permanently zero on every page that shows them.

2. **The `overdue` band does not exist.** Pages branch on it
   (`predictive/page.js:89`, `analytics/page.js:43`) but the service never emits it.
   Worse, `Math.max(0, ...)` at `ai.service.js:55` clamps negative day counts to
   zero, so a vehicle three weeks overdue displays "0 days" — identical to one due
   today.

3. **`POST /api/vehicle-maintenance` writes columns that do not exist.** Its
   validation schema accepts `next_service_date`, `next_service_mileage`,
   `technician_name`, `service_center_name`, `assigned_to`, `completed_by` and
   `notes` (`route.js:5-22`), then interpolates raw body keys into
   `INSERT INTO vehiclemaintenance (${cols})` (`route.js:65-72`). The real columns
   are `next_schedule_date`, `next_schedule_mileage`, `service_provider`,
   `service_center` and `remarks`; `assigned_to` and `completed_by` have no column
   at all. Those writes fail at the database.

4. **`vehicles.mileage` is never updated.** No `UPDATE vehicles SET mileage`
   exists anywhere in the codebase. Odometer readings are captured at trip start
   and completion (`src/components/dispatch/trip-odometer-dialog.jsx`) and stored on
   `trips`, but never written back. The dialog's own comment states the reading feeds
   "mileage-based service scheduling" — that write-back was never built. The column
   holds whatever was typed at vehicle creation, forever.

5. **Two implementations, one dead.** `calculatePredictiveMaintenance()`
   (`src/lib/ai/rule-engine.js:10`) is exported and never imported. The live path is
   a near-duplicate in `ai.service.js`. Divergence between the copies is how the
   casing bug survived.

6. **Two identical pages.** `/ai/predictive-maintenance` and
   `/maintenance/predictive` are byte-identical files, separately registered in
   `permissions.js:32` and `:35`.

7. **Prediction runs in the browser.** `getPredictiveMaintenance()` fetches
   `/api/vehicles?limit=500` and computes client-side, shipping the whole fleet to
   perform a date comparison. `GET /api/vehicles` is bare `requireAuth(req)` with no
   role list (`vehicles/route.js:26`), so any authenticated user — including a
   driver — can retrieve it, even though the pages are role-gated.

### Unused signals

| Available in schema | Currently used |
|---|---|
| `vehicles.mileage`, `next_service_mileage` | displayed, never scored |
| `vehiclemaintenance.recurring_interval_days` / `_km` | never read |
| `vehiclemaintenance.next_schedule_date` / `_mileage` | never fed back to `vehicles` |
| `trips.end_odometer`, `distance` | never syncs `vehicles.mileage` |
| `fuelconsumption.avg_km_per_liter` | unused |
| maintenance cost and frequency history | unused |

## Scope

Fix the defects **and** make the prediction genuinely predictive. Mobile odometer
OCR capture was considered and deferred — see Deferred below.

## Section 1 — Data model and odometer write-back

Migration `018_predictive_maintenance.sql`:

```sql
ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS service_interval_km   DECIMAL(10,2) DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS service_interval_days INT           DEFAULT 180;
```

Per-vehicle intervals, with defaults so existing rows predict immediately rather
than sitting blank. A NULL interval means that dimension does not predict, rather
than guessing a value.

A fleet-wide interval policy table keyed by maintenance type was considered and
rejected for this iteration: it yields multiple concurrent due-dates per vehicle,
which restructures the page from one row per vehicle into a per-component list.
That is a different feature. Note that `vehiclecategories` is the guest tier
(VIP / guest / ops / staff), not the vehicle shape, so it is not a valid axis for
mechanical service intervals.

### Odometer write-back

The load-bearing fix. Every km-based interval computes off a stale value until
this lands. In `PUT /api/trips/[id]/complete` (`route.js:19`), after the trip
update:

```sql
UPDATE vehicles SET mileage = GREATEST(mileage, $1), updated_at = NOW()
WHERE vehicle_id = $2
```

`GREATEST` guards the real failure mode: a mistyped or late-arriving low reading
must never walk mileage backwards, because that silently defers every due-date on
the vehicle. `PUT /api/trips/[id]/start` (`start/route.js:48`) gets the same
write — a start reading is equally authoritative, and the odometer dialog seeds
its input from `vehicles.mileage`, so a stale value there means dispatchers
confirm a wrong number.

### Odometer sanity checks

Server-side, on both trip routes: reject a reading below the vehicle's current
`mileage`, and flag an implausible jump (>1,500 km in one trip) for review rather
than accepting it silently. This is what stops one fat-fingered entry from pushing
every due-date months out.

### Service completion recompute

When a maintenance record reaches `Completed`, derive the next due from the
interval instead of leaving it hand-typed:

- `last_service_date` = completed date
- `next_service_date` = completed date + `service_interval_days`
- `next_service_mileage` = `mileage_at_service` (falling back to current
  `mileage`) + `service_interval_km`

Lives in `src/services/`, alongside `status.service.js`, called from the
maintenance write routes. This is what makes the due-date self-maintaining.

### API correction

`/api/vehicle-maintenance` field mapping: `next_service_date` →
`next_schedule_date`, `next_service_mileage` → `next_schedule_mileage`,
`technician_name` → `service_provider`, `service_center_name` → `service_center`,
`notes` → `remarks`. `assigned_to` and `completed_by` have no column and are
removed from the schema. The raw-key INSERT is replaced with an explicit column
allowlist — currently any unknown body key reaches the SQL.

## Section 2 — Prediction engine

New file `src/lib/ai/predictive-maintenance.js`. Pure functions, no I/O: takes a
vehicle plus derived usage, returns a prediction. Testable without a database.

Two independent due-dates per vehicle, whichever is sooner wins:

- **Time:** `next_service_date` vs today → `daysToService`
- **Mileage:** `next_service_mileage − mileage` → `kmToService`

Mileage alone is not a prediction — 3,000 km remaining means nothing without a
burn rate.

### Usage rate

km/day from completed trips over a trailing 90-day window:

```sql
SELECT SUM(distance) AS km_90d,
       COUNT(*) AS trip_count,
       COUNT(DISTINCT DATE(end_time)) AS active_days
FROM trips
WHERE vehicle_id = $1 AND trip_status = 'Completed'
  AND end_time > NOW() - INTERVAL '90 days' AND deleted_at IS NULL
```

**`kmPerDay` divides by the calendar window (90), not by `active_days`.** A
vehicle that drives 600 km across 5 days averages 120 km per *active* day but
6.7 km per calendar day. Projecting a future due-date is a question about
calendar days, so dividing by `active_days` would overstate the burn rate by the
vehicle's idle ratio and pull every due-date forward. `active_days` is still
selected — it is a useful utilisation figure and distinguishes "one long trip"
from "steady daily use" — but it is not the projection denominator.

`projectedDaysToService = kmToService / kmPerDay`. This is the predictive step: a
van burning 120 km/day reaches a 3,000 km service in 25 days; one doing 20 km/day
has five months. Today both present identically.

**Effective days-to-due = `min(daysToService, projectedDaysToService)`.** Risk
bands apply to that single number, so a heavily-used vehicle escalates on mileage
before its calendar date arrives. `basis` records which of the two won.

When a dimension has no data it does not participate in the minimum, rather than
counting as zero: a NULL `next_service_date` yields no `daysToService`, a NULL
`next_service_mileage` or `confidence: "low"` yields no
`projectedDaysToService`. If neither dimension is available the vehicle is
returned with `risk: "low"`, `basis: null` and a recommendation stating that no
service schedule is set — it is excluded from the urgency sort rather than
ranked as healthy.

### Confidence

Fewer than 5 completed trips in the window, or zero distance, means no
trustworthy rate: fall back to calendar-only and mark `confidence: "low"`. The UI
must state which basis was used. A projection from two trips is a guess wearing a
number's clothes; presenting it with the same authority as one backed by 90 days
of trips is worse than not predicting.

### Risk bands

Lowercase, exported as a shared constant that both the engine and the pages
import — not a string typed in two files. This is the fix for defect 1.

| Band | Effective days |
|---|---|
| `overdue` | < 0 |
| `critical` | 0–7 |
| `high` | 8–30 |
| `medium` | 31–90 |
| `low` | > 90 |

`overdue`, `critical` and `high` keep the existing boundaries, so the current tile
labels ("Critical (7 days)", "High (30 days)") stay accurate. The
`medium`/`low` boundary moves from 30 to 90 days: with a mileage projection in
play, "more than 30 days" spans everything from five weeks to two years, which is
too coarse to plan against. `medium` is computed but not tiled.

The `Math.max(0, ...)` clamp is dropped so overdue vehicles report negative days
(defect 2).

### Health score

Replaces the four hardcoded values (95/70/40/15) with a computed 0–100: urgency
as the dominant term, plus overdue severity, plus the corrective-vs-routine
maintenance ratio from history. A vehicle with three unplanned repairs in six
months is genuinely less healthy than one with none; today they score identically.

### Deletion

`calculatePredictiveMaintenance()` (`rule-engine.js:10`) is removed. Its one
unique behaviour — a low-fuel recommendation — is not maintenance, and
`generateFleetInsights()` in the same file already covers that class of alert and
stays.

## Section 3 — Server endpoint

`GET /api/ai/predictive-maintenance`, gated
`requireAuth(req, ["system_admin", "admin", "fleet_manager"])` to match
`permissions.js:35`. This also closes the exposure in defect 7 for this feature's
data path.

One query, two CTEs, no N+1:

```sql
WITH usage AS (
  SELECT vehicle_id,
         SUM(distance) AS km_90d,
         COUNT(*) AS trip_count,
         COUNT(DISTINCT DATE(end_time)) AS active_days
  FROM trips
  WHERE trip_status = 'Completed' AND deleted_at IS NULL
    AND end_time > NOW() - INTERVAL '90 days'
  GROUP BY vehicle_id
),
history AS (
  SELECT vehicle_id,
         COUNT(*) FILTER (WHERE maintenance_type <> 'Routine') AS corrective_count,
         COUNT(*) AS total_count,
         MAX(completed_date) AS last_completed
  FROM vehiclemaintenance
  WHERE deleted_at IS NULL AND status = 'Completed'
    AND maintenance_date > NOW() - INTERVAL '365 days'
  GROUP BY vehicle_id
)
SELECT v.vehicle_id, v.plate_number, v.vehicle_name, v.mileage,
       v.next_service_date, v.next_service_mileage, v.last_service_date,
       v.service_interval_km, v.service_interval_days, v.vehicle_status,
       u.km_90d, u.trip_count, u.active_days,
       h.corrective_count, h.total_count
FROM vehicles v
LEFT JOIN usage u   ON u.vehicle_id = v.vehicle_id
LEFT JOIN history h ON h.vehicle_id = v.vehicle_id
WHERE v.deleted_at IS NULL AND v.vehicle_status <> 'Decommissioned'
```

Explicit columns rather than `v.*`. Decommissioned vehicles are excluded —
predicting service for a retired unit is noise.

Rows pass through the Section 2 functions. The response is sorted by effective
urgency and includes a `summary` object with band counts precomputed, so stat
cards read one number each instead of re-filtering the array.

`getPredictiveMaintenance()` in `ai.service.js` becomes a thin
`apiFetch("/api/ai/predictive-maintenance")`. The exported name is unchanged, so
all four call sites keep working without edits.

### Response shape, per vehicle

```js
{
  vehicle_id, plate_number, vehicle_name, mileage,
  risk: "overdue" | "critical" | "high" | "medium" | "low",
  score: 0-100,
  basis: "mileage" | "time",       // which due-date won
  confidence: "high" | "low",       // low = insufficient trip data
  daysToService,                    // calendar, may be negative
  kmToService,
  kmPerDay,
  projectedDaysToService,
  effectiveDays,                    // what risk was computed from
  recommendation,
}
```

### Not persisted

Computed per request; no predictions table. Inputs change constantly and a stored
snapshot would add staleness. Consequence: no history or trending. If
"was this vehicle degrading over months" is wanted later, that needs a
persistence layer and is out of scope here.

## Section 4 — UI

### Deduplicate

`/maintenance/predictive` holds the real page — it is a maintenance function and
sits beside `/maintenance`. `/ai/predictive-maintenance` redirects to it. Both
routes stay valid so existing links, including the "View all" at `ai/page.js:149`,
keep working.

### Stat cards

Read `summary` from the response rather than re-filtering client-side. Four tiles
retained — Overdue, Critical, High, Healthy — with `overdue` finally backed by a
real count. `medium` is computed but not tiled; it is not actionable.

### Rows

Each row states the prediction and its basis:

- Mileage-driven: `2,400 km to service · ~118 km/day · due in ~20 days`
- Calendar-driven: `due in 45 days · 12,000 km to service`
- Low confidence: `due in 45 days · calendar only — not enough trip data to project`

Overdue renders as `18 days overdue` in danger tone, replacing the "0 days"
produced by the clamp (`predictive/page.js:89`).

Sort is by effective days, not raw `daysToService`, so a mileage-critical vehicle
outranks one whose calendar date is nearer.

### Interval fields

`service_interval_km` / `service_interval_days` added to the vehicle form
(`fleet/vehicles/new/page.js`), `vehicleSchema` (`schemas.js:73`) and the write
schema (`vehicles/route.js:6`). Without this the columns exist but are untunable.

The vehicle detail page shows the resolved next-service basis alongside the
existing mileage stat (`vehicles/[id]/page.js:210`).

`/analytics` and `/ai` tiles need no change beyond reading `summary`; their
`maintDue` filter (`analytics/page.js:43`) starts returning real numbers once
casing is consistent.

## Testing

- **Engine (pure, no DB):** each risk band boundary; overdue negative days;
  mileage-wins vs time-wins; low-confidence fallback at <5 trips; zero and NULL
  interval handling; division-by-zero when `kmPerDay` is 0; both dimensions
  absent yields `basis: null` rather than a false `low`.
- **Odometer write-back:** mileage advances on completion; a lower reading does
  not regress it (`GREATEST`); a reading below current mileage is rejected; a
  >1,500 km jump is flagged.
- **Service recompute:** completing maintenance sets all three vehicle fields
  from the interval; a NULL interval leaves them untouched.
- **API:** the corrected field mapping round-trips through
  `POST /api/vehicle-maintenance`; unknown body keys are rejected rather than
  reaching SQL; the endpoint 403s for a driver.

## Deferred

**Mobile odometer OCR capture.** The driver photographs the odometer, OCR
prefills the reading, the driver confirms, and the photo is stored as proof.
Deferred to keep this iteration web-only. Worth recording what it needs, since
the investigation is done:

- No upload infrastructure exists anywhere — `receipt_url` and `image_url` are
  text columns and nothing in the codebase writes to storage.
- `POST /api/ai/scan-document` is unusable by drivers: it is gated to
  `system_admin`/`admin`/`fleet_manager` (`route.js:205`) and its regexes parse
  OR/CR fields, not digit clusters.
- No mobile trip start/complete endpoints exist. Mobile has auth, `driver/me`,
  `driver/trips`, `trips/[id]/accept` and `trips/[id]/gps` — the odometer hop was
  never built. These are missing independently of OCR.
- `docs/mobile-mvp.md:23` requires that OCR output be assistive only and never
  auto-submit; line 32 lists odometer progression as a review signal. Any
  implementation must be scan → prefill → driver confirms → submit.
- Would add `start/end_odometer_photo_url` and `start/end_odometer_source`
  (`manual` | `scan_confirmed` | `scan_corrected`) to `trips`. The
  `scan_corrected` value is what makes OCR accuracy measurable in production.

**Alerting.** Routing predictions into the existing notification system is
valuable but premature — the numbers should be trusted in the UI first. Until the
odometer write-back has been running, any mileage-based alert would fire on stale
data.
