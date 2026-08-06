# FleetOps Integrity Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four critical data-integrity holes (trip-status sync, fuel module, cancellation cascade, legacy-reservation writes) plus the agreed quick wins, without touching the mock booking gateway or the advisory-only double-booking model.

**Architecture:** Route handlers keep their thin shape; shared DB-backed lifecycle logic moves into a new `trip-lifecycle.service.js`; pure transition rules get their own state modules with unit tests; DB hardening goes in one new migration. All route changes follow the existing `requireAuth` / `ok` / `err` / `writeAudit` conventions and are verified with in-process harness scripts (`node --import ./scripts/route-harness-loader.mjs scripts/verify-*.mjs`).

**Tech Stack:** Next.js App Router, raw `pg` pool (`@/lib/db`), Supabase migrations, Vitest, existing harness loader (`scripts/route-harness-loader.mjs`, `scripts/stub-auth.mjs`).

## Global Constraints

- **Booking gateway stays mock** — no HTTP transport work; `booking-gateway.js` is untouched.
- **Double-booking stays advisory** — no DB exclusion constraint; conflicts remain detection-only.
- **No hard DELETEs** — soft delete via `deleted_at` only.
- Follow repo conventions: `requireAuth(req, roles)`, `ok()`/`err()`/`errValidation()`/`handleError()`, `writeAudit` from `@/lib/audit`.
- `fuelrecords.station_id` was dropped in `005_schema_cleanup.sql:66`; the real column is `station_name`. `station_id` must be removed from every allowlist.
- `validateOdometerReading` (`@/lib/vehicles/odometer.js`) **requires a reading** — call it only when a value is present.
- Migration numbering: `019` is already taken by `019_service_interval_guards.sql`, so this plan's migration is **`020_fuel_hardening.sql`**.
- **Staging discipline:** the repo has unrelated uncommitted work on `main`. Implementers MUST stage only the files they touch (`git add <their files>`), never `git add -A` or `git commit -am`-style sweeping commits unless the message lists only their files.
- Read `node_modules/next/dist/docs/` before touching route conventions — this Next.js version differs from training data (`AGENTS.md`).

---

### Task 1: Migration `020_fuel_hardening.sql`

**Files:**
- Create: `supabase/migrations/020_fuel_hardening.sql`

**Produces:** `fuelrecords.rejection_reason`, `.approved_by`, `.approved_at`, `chk_fuel_status` — consumed by Tasks 2–3.

- [ ] **Step 1: Write the migration**

```sql
-- 020_fuel_hardening.sql
-- Hardening for the fuel review workflow: persistence for the rejection
-- reason (currently validated but dropped -> 500), an approval audit trail,
-- and a value-set guard on status.
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS approved_by INT REFERENCES employees(employee_id);
ALTER TABLE fuelrecords ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_fuel_status') THEN
    ALTER TABLE fuelrecords ADD CONSTRAINT chk_fuel_status
      CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Completed'));
  END IF;
END $$;
```

- [ ] **Step 2: Apply it** — use the repo's existing migration runner, matching how 017/018 were applied (e.g. `node run_migration.mjs supabase/migrations/020_fuel_hardening.sql`, or `node scripts/apply-sql.mjs supabase/migrations/020_fuel_hardening.sql`, or Supabase CLI `supabase db push`).
- [ ] **Step 3: Verify the columns/constraint exist** — run a `SELECT column_name FROM information_schema.columns WHERE table_name='fuelrecords'` and a check that `chk_fuel_status` is present.
- [ ] **Step 4: Commit** — `git add supabase/migrations/020_fuel_hardening.sql && git commit -m "feat(db): harden fuelrecords schema (rejection reason, approval audit, status check)"`

---

### Task 2: Fuel POST repair

**Files:**
- Modify: `src/app/api/fuel/route.js:8-27` (schema), `:94-107` (allowlist), `:109-149` (handler)

**Consumes:** Task 1 columns. **Produces:** a POST that accepts the real columns and returns 201 for the web/mobile clients.

- [ ] **Step 1: Fix the validation schema** so it matches the actual columns. Replace `cost_per_liter`→`price_per_liter`, `total_cost`→`amount`, `odometer_reading`→`odometer`, add `trip_id`, `receipt_url`; drop the schema-only fields (`notes`, `reimbursement_status`, `paid_by`, `payment_method`, `submitted_at`, `approved_by`, `rejected_reason` — those are PUT/review concerns):

```js
const fuelWriteSchema = {
  vehicle_id: { required: true, type: "id", label: "Vehicle" },
  driver_id: { type: "id", label: "Driver" },
  trip_id: { type: "id", label: "Trip" },
  fuel_date: { required: true, type: "date", label: "Fuel date" },
  fuel_type: { required: true, maxLength: 50, label: "Fuel type" },
  liters: { required: true, type: "positiveNumber", label: "Liters" },
  amount: { required: true, type: "positiveNumber", label: "Total amount" },
  price_per_liter: { type: "positiveNumber", label: "Price per liter" },
  odometer: { type: "positiveNumber", label: "Odometer" },
  station_name: { maxLength: 255, label: "Station name" },
  status: { maxLength: 30, label: "Status" },
  receipt_url: { maxLength: 2000, label: "Receipt image" },
};
```

- [ ] **Step 2: Remove `station_id` from `WRITABLE_COLUMNS`** (`fuel/route.js:96`) — it no longer exists in the table.
- [ ] **Step 3: Validate odometer when provided** — before the INSERT, when `body.odometer !== undefined`, look up `vehicles.mileage` and call `validateOdometerReading({ reading: body.odometer, currentMileage })`; return `err(odo.error, 400)` on failure. Import from `@/lib/vehicles/odometer`.
- [ ] **Step 4: Default new records to `Pending`** — after building `columns`/`values`, if `body.status === undefined` push `status`/`"Pending"` so every record enters the review queue (matches the mobile route and the UI copy "Approved fuel records populate this breakdown").
- [ ] **Step 5: Add audit** — `await writeAudit(req, session, { action: "create", resource: "fuelrecords", resourceId: rows[0]?.fuel_record_id, newValues: rows[0] })` (mirrors `reservations/route.js:104`).
- [ ] **Step 6: Commit** — stage only `src/app/api/fuel/route.js` and commit `fix(fuel): align POST schema/allowlist with real columns, validate odometer, default to Pending`

---

### Task 3: Fuel PUT repair (reject/approve + allowlist)

**Files:**
- Modify: `src/app/api/fuel/[id]/route.js:31-74`

**Consumes:** Task 1 columns. **Produces:** a reject flow that returns 200 and persists the reason; approval audit fields; no more arbitrary-column SQL.

- [ ] **Step 1: Replace the `Object.keys(body)` SET builder** (`fuel/[id]/route.js:58-67`) with an allowlist:

```js
const WRITABLE = new Set([
  "vehicle_id", "driver_id", "trip_id", "liters", "amount", "price_per_liter",
  "odometer", "fuel_type", "fuel_date", "station_name", "receipt_url",
  "status", "rejection_reason", "notes",
]);
```
Build `keys`/`values` from `Object.keys(body).filter((k) => WRITABLE.has(k))`; 400 if empty. Also align the validation schema at `:37-49` with the real columns (same rename as Task 2).
- [ ] **Step 2: Add the transition guard + approval side-effects** — load `before` (`status`, `approved_at`), then:

```js
const prev = before[0].status;
if (body.status && body.status !== prev) {
  if (prev === "Completed") return err("Completed fuel records cannot change status.", 409);
  if (body.status === "Rejected" && !(body.rejection_reason || "").trim()) {
    return err("A rejection reason is required when rejecting.", 400);
  }
}
if (body.status === "Approved") {
  body.approved_by = session.user.employeeId;
  body.approved_at = new Date().toISOString();
  body.rejection_reason = null;
}
body.updated_by = session.user.employeeId;
```
- [ ] **Step 3: Odometry on edit** — same optional `validateOdometerReading` check as Task 2 when `body.odometer !== undefined`.
- [ ] **Step 4: Commit** — stage only `src/app/api/fuel/[id]/route.js` and commit `fix(fuel): allowlist PUT, fix reject flow (persist reason, 200), set approval audit`

---

### Task 4: Mobile fuel route alignment (app-ready)

**Files:**
- Modify: `src/app/api/mobile/fuel/route.js:17-27`

- [ ] **Step 1: Remove `station_id`** from `WRITABLE_COLUMNS` (`mobile/fuel/route.js:18`).
- [ ] **Step 2: Optional odometer validation** — when `body.odometer !== undefined`, validate against the derived `trip.vehicle_id` mileage (same pattern as Task 2).
- [ ] **Step 3: Commit** — stage only `src/app/api/mobile/fuel/route.js` and commit `fix(fuel): align mobile route with schema, drop dead station_id, validate odometer`

---

### Task 5: Fuel analytics — Approved only

**Files:**
- Modify: `src/app/api/fuel/analytics/route.js:7`

- [ ] **Step 1:** Change the WHERE to `WHERE deleted_at IS NULL AND status = 'Approved'`.
- [ ] **Step 2: Commit** — stage only `src/app/api/fuel/analytics/route.js` and commit `fix(fuel): analytics aggregates approved records only`

---

### Task 6: `scripts/verify-fuel.mjs` (DB-backed harness)

**Files:**
- Create: `scripts/verify-fuel.mjs`

**Consumes:** Tasks 1–5. Pattern: copy the shape of `scripts/verify-rbac.mjs` (header comment, `loadEnvLocal()`, `app()` loader, `check()` helper, `__HARNESS_SESSION__`, run with `node --import ./scripts/route-harness-loader.mjs scripts/verify-fuel.mjs`). All writes are **rolled back or cleanable** — use a throwaway driver-less record and `UPDATE fuelrecords SET deleted_at=NOW()` at the end.

- [ ] **Step 1:** Create a record via `POST /api/fuel` with `{ vehicle_id, liters, amount, price_per_liter, odometer, fuel_date, fuel_type, station_name }` → assert 201 and `status === "Pending"`.
- [ ] **Step 2:** Reject it via `PUT /api/fuel/[id]` with `{ status: "Rejected", rejection_reason: "test" }` → assert **200** and returned row has `rejection_reason === "test"` (this is the bug being fixed).
- [ ] **Step 3:** Approve it via PUT `{ status: "Approved" }` → assert `approved_by` is set and `rejection_reason` is null.
- [ ] **Step 4:** Assert a PUT with an unknown key (`{ foo: 1 }` plus nothing else) → 400, and `UPDATE ... SET foo` never reaches Postgres.
- [ ] **Step 5:** Assert `GET /api/fuel/analytics` excludes the (now Approved) record's `Pending` sibling — insert one more `Pending` record and confirm it is not counted.
- [ ] **Step 6: Commit** — `git add scripts/verify-fuel.mjs && git commit -m "test(fuel): harness for create/reject/approve/allowlist/analytics"`

---

### Task 7: `dispatch-state.js` (pure) + unit tests

**Files:**
- Create: `src/lib/scheduling/dispatch-state.js`
- Test: `src/lib/scheduling/dispatch-state.test.js`

**Produces:** `canTransitionDispatch(from, to)` — consumed by Task 13.

- [ ] **Step 1: Write the failing test**

```js
import { describe, it, expect } from "vitest";
import { canTransitionDispatch } from "@/lib/scheduling/dispatch-state";

describe("canTransitionDispatch", () => {
  it("moves forward Scheduled -> In Progress -> Completed", () => {
    expect(canTransitionDispatch("Scheduled", "In Progress").ok).toBe(true);
    expect(canTransitionDispatch("In Progress", "Completed").ok).toBe(true);
  });
  it("rejects backwards moves", () => {
    expect(canTransitionDispatch("Completed", "Scheduled").ok).toBe(false);
    expect(canTransitionDispatch("In Progress", "Scheduled").ok).toBe(false);
  });
  it("allows Cancelled from any non-terminal state", () => {
    expect(canTransitionDispatch("Scheduled", "Cancelled").ok).toBe(true);
    expect(canTransitionDispatch("In Progress", "Cancelled").ok).toBe(true);
  });
  it("locks terminal states", () => {
    expect(canTransitionDispatch("Completed", "Cancelled").ok).toBe(false);
    expect(canTransitionDispatch("Cancelled", "Scheduled").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure** — `npx vitest run src/lib/scheduling/dispatch-state.test.js` → FAIL (module not found).
- [ ] **Step 3: Implement** (mirror `trip-state.js` style: rank map, terminal set, forward-only, `Cancelled` escape):

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);

export function isValidDispatchStatus(status) {
  return status === "Cancelled" || RANK[status] !== undefined;
}

export function canTransitionDispatch(from, to) {
  if (!isValidDispatchStatus(to)) {
    return { ok: false, reason: `"${to}" is not a valid dispatch status.` };
  }
  if (!from) return { ok: true };
  if (TERMINAL.has(from)) {
    return { ok: false, reason: `Dispatch is ${from} and can no longer change status.` };
  }
  if (to === "Cancelled") return { ok: true };
  if (RANK[to] < RANK[from]) {
    return { ok: false, reason: `Cannot move a dispatch from "${from}" back to "${to}".` };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run to confirm pass** — `npx vitest run src/lib/scheduling/dispatch-state.test.js` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/scheduling/dispatch-state.js src/lib/scheduling/dispatch-state.test.js && git commit -m "feat(dispatch): state machine for dispatch status transitions"`

---

### Task 8: `trip-lifecycle.service.js`

**Files:**
- Create: `src/services/trip-lifecycle.service.js`

**Consumes:** `advanceReservation`/`findRequestForDispatch`, `syncVehicleStatus`/`syncDriverStatus`/`syncDispatchReservation`, `validateOdometerReading`, `writeAudit`, `canTransitionTrip` already used by routes. **Produces:** `completeTrip`, `cancelTrip`, `syncBusyTrip` — consumed by Tasks 9 and 11.

- [ ] **Step 1: `completeTrip(tripId, session, { endOdometer, distance })`** — extract the body of `src/app/api/trips/[id]/complete/route.js:9-146` verbatim (same SELECT, odometer validation, the single UPDATE with `distance`/`actual_duration`, the GREATEST mileage feed, syncVehicleStatus/syncDriverStatus, dispatch→Completed + syncDispatchReservation, advanceReservation→`L.COMPLETED` best-effort, and both `writeAudit` calls including the flagged-odometer audit). Keep the `Trip not found`/already-terminal guards. Return the updated trip row.
- [ ] **Step 2: `cancelTrip(tripId, session, { reason = null })`** — load trip; reject if terminal; `UPDATE trips SET trip_status='Cancelled', updated_at=NOW() WHERE trip_id=$1 RETURNING *`; then best-effort: `UPDATE dispatchschedules SET status='Cancelled' WHERE dispatch_id=$1` (when the trip has one), `syncVehicleStatus(vehicle_id)`, `syncDriverStatus(driver_id)`, `syncDispatchReservation(dispatch_id)`, and `advanceReservation({ requestId, toStatus: L.CANCELLED, session, eventType: E.CANCELLED, description: reason || "Trip cancelled.", metadata: { trip_id, reason }, patch: { status_reason: reason } })` via `findRequestForDispatch`; `writeAudit` for the trip status change.
- [ ] **Step 3: `syncBusyTrip(tripId, session)`** — for non-terminal busy targets (`Trip Started`/`En Route`/`Arrived`/`In Progress`): `UPDATE dispatchschedules SET status='In Progress'` (when dispatch present) + `syncVehicleStatus` + `syncDriverStatus` + `syncDispatchReservation` + best-effort `advanceReservation` → `L.IN_PROGRESS` (mirrors the start route's tail, `start/route.js:77-109`).
- [ ] **Step 4: Commit** — `git add src/services/trip-lifecycle.service.js && git commit -m "feat(trips): shared complete/cancel/busy lifecycle service"`

---

### Task 9: Complete route → `completeTrip` + ownership

**Files:**
- Modify: `src/app/api/trips/[id]/complete/route.js`

- [ ] **Step 1:** Replace the handler body with: `const trip = await assertTripOwnership(session, id)` (import from `@/lib/api/ownership`), parse `{ end_odometer, distance }` from body, then `return ok(await completeTrip(id, session, { endOdometer: body.end_odometer, distance: body.distance }))` inside the same try/catch. Keep `requireAuth(req, ["system_admin","admin","fleet_manager","dispatcher","driver"])`.
- [ ] **Step 2: Commit** — stage only `src/app/api/trips/[id]/complete/route.js` and commit `fix(trips): complete route delegates to lifecycle service and enforces ownership`

---

### Task 10: Start route ownership

**Files:**
- Modify: `src/app/api/trips/[id]/start/route.js:10-16`

- [ ] **Step 1:** After `requireAuth`, call `const trip = await assertTripOwnership(session, id)` and use `trip` instead of the existing `before` SELECT (drop the duplicated query).
- [ ] **Step 2: Commit** — stage only `src/app/api/trips/[id]/start/route.js` and commit `fix(trips): start route enforces driver ownership`

---

### Task 11: Trip status route — sync + RBAC fix

**Files:**
- Modify: `src/app/api/trips/[id]/status/route.js`

- [ ] **Step 1:** Remove `"management"` from `ROLES` (`:7`).
- [ ] **Step 2:** After the existing `canTransitionTrip` gate, dispatch on the target (`next`):

```js
const TRIP_STATUS_ALIAS = (await import("@/lib/constants")).TRIP_STATUS;
if (next === TRIP_STATUS_ALIAS.COMPLETED) {
  return ok(await completeTrip(id, session, { endOdometer: body.end_odometer, distance: body.distance }));
}
if (next === TRIP_STATUS_ALIAS.CANCELLED) {
  return ok(await cancelTrip(id, session, { reason: body.reason }));
}
if (["Trip Started", "En Route", "Arrived", "In Progress"].includes(next)) {
  await syncBusyTrip(id, session);
  // fall through to the plain UPDATE so the requested status is recorded too
}
```
Keep the plain `UPDATE trips SET trip_status=...` + `writeAudit` for the non-terminal path (after the busy sync). Import `completeTrip`, `cancelTrip`, `syncBusyTrip` from `@/services/trip-lifecycle.service`.
- [ ] **Step 3: Commit** — stage only `src/app/api/trips/[id]/status/route.js` and commit `fix(trips): status route syncs dispatch/vehicle/driver/request on complete/cancel/busy; drop management write role`

---

### Task 12: Request cancel cascade

**Files:**
- Modify: `src/app/api/integration/transport-requests/[id]/cancel/route.js`

- [ ] **Step 1:** Before the existing `advanceReservation` call, cancel the request's open dispatches and their trips (both linkage legs — `request_id` or `reservation_id`, matching `findRequestForDispatch`'s join at `reservation-lifecycle.service.js:62-74`):

```js
const { rows: dispatches } = await query(
  `SELECT dispatch_id FROM dispatchschedules
    WHERE deleted_at IS NULL AND status IN ('Scheduled', 'In Progress')
      AND (request_id = $1 OR (request_id IS NULL AND reservation_id = $2))`,
  [id, before.reservation_id]
);
for (const d of dispatches) {
  await query(`UPDATE trips SET trip_status = 'Cancelled', updated_at = NOW() WHERE dispatch_id = $1 AND deleted_at IS NULL AND trip_status NOT IN ('Completed', 'Cancelled')`, [d.dispatch_id]);
  const { rows: disp } = await query(`SELECT vehicle_id, driver_id FROM dispatchschedules WHERE dispatch_id = $1`, [d.dispatch_id]);
  await query(`UPDATE dispatchschedules SET status = 'Cancelled' WHERE dispatch_id = $1`, [d.dispatch_id]);
  if (disp[0]?.vehicle_id) await syncVehicleStatus(disp[0].vehicle_id);
  if (disp[0]?.driver_id) await syncDriverStatus(disp[0].driver_id);
}
```
Keep the request `advanceReservation` → `L.CANCELLED` as the last step (it writes the timeline + notifies Booking).
- [ ] **Step 2: Commit** — stage only `src/app/api/integration/transport-requests/[id]/cancel/route.js` and commit `feat(reservations): cancelling a request cascades to its dispatches and trips`

---

### Task 13: Dispatch status route — guard + cascade

**Files:**
- Modify: `src/app/api/dispatch/[id]/status/route.js`

- [ ] **Step 1:** Add `assertDispatchOwnership(session, id)` (from `@/lib/api/ownership`) so the `driver` role can only touch its own dispatch.
- [ ] **Step 2:** Validate with `canTransitionDispatch(prev, next)` (Task 7); `err(check.reason, 409)` on failure.
- [ ] **Step 3:** When `next === "Cancelled"` — cancel the dispatch's trips, `syncVehicleStatus`/`syncDriverStatus`, `syncDispatchReservation`, and best-effort `advanceReservation` → `L.CANCELLED` (via `findRequestForDispatch`) with an `E.CANCELLED` event. (Reuses the loop shape from Task 12.)
- [ ] **Step 4:** Add `writeAudit` (this route currently has none).
- [ ] **Step 5: Commit** — stage only `src/app/api/dispatch/[id]/status/route.js` and commit `fix(dispatch): enforce ownership + transition machine; cancel cascades to trip and request`

---

### Task 14: Legacy reservations lockdown

**Files:**
- Modify: `src/app/api/reservations/route.js` (POST only), `src/app/api/reservations/[id]/route.js` (PUT), `src/app/api/reservations/[id]/cancel/route.js`
- Cleanup: `src/services/reservation.service.js:11-21` (remove dead write helpers), `src/services/integration.service.js:23-54` (remove dead `processInboundBooking` POST call — it 404s anyway)

- [ ] **Step 1:** Return **410 Gone** from the three write handlers with a pointer to the new flow, e.g.:

```js
return err("Legacy reservation writes are deprecated. Create/update reservations through the Booking integration flow (POST /api/integration/transport-requests and its lifecycle endpoints).", 410);
```
Keep all GET handlers untouched — the dashboard and analytics pages still read this table (`src/app/(dashboard)/dashboard/page.js:12`, `analytics/page.js:18`).
- [ ] **Step 2:** Delete the now-dead write helpers (`createReservation`, `updateReservation`, `cancelReservation`, and the `integration.service.js` `processInboundBooking` that targets the locked POST).
- [ ] **Step 3: Commit** — stage only the modified files and commit `feat(reservations): lock down legacy write endpoints (410), keep read-only legacy access`

---

### Task 15: Notifications scoped to caller

**Files:**
- Modify: `src/app/api/notifications/route.js:5-19`

- [ ] **Step 1:** Capture the session from `requireAuth`; scope the GET:

```js
const session = await requireAuth(req);
const own = session.user?.employeeId ?? session.user?.userId ?? null;
const canScopeAll = ["system_admin", "admin", "fleet_manager"].includes(session.user?.role);
const target = sp.get("employee_id");
if (target) {
  if (!canScopeAll) return err("Not authorized to view another user's notifications", 403);
  conditions.push(`employee_id = $${idx++}`); params.push(+target);
} else if (own) {
  conditions.push(`(employee_id = $${idx++} OR user_id = $${idx++})`); params.push(own, own);
}
```
(prepend these before the existing `type`/`is_read` conditions; keep `LIMIT 50`.)
- [ ] **Step 2: Commit** — stage only `src/app/api/notifications/route.js` and commit `fix(notifications): scope reads to the caller (or explicit id for ops roles)`

---

### Task 16: Driver-performance report honors date range

**Files:**
- Modify: `src/app/api/reports/driver-performance/route.js`

- [ ] **Step 1:** Read `from`/`to` from search params; replace the `driver_stats` view read with a direct aggregation that filters completed trips by `end_time`:

```sql
SELECT d.driver_id,
       COUNT(t.trip_id)::int AS total_trips,
       ROUND(AVG(t.customer_rating)::numeric, 1) AS rating,
       ROUND(AVG(t.smooth_driving_score)::numeric, 1) AS performance_score
  FROM drivers d
  LEFT JOIN trips t ON t.driver_id = d.driver_id
   AND t.trip_status = 'Completed' AND t.deleted_at IS NULL
   AND ($1::date IS NULL OR t.end_time >= $1::date)
   AND ($2::date IS NULL OR t.end_time < ($2::date + 1))
 WHERE d.deleted_at IS NULL
 GROUP BY d.driver_id
```
Build the same `{ totalDrivers, avgScore, topDrivers }` shape from the rows.
- [ ] **Step 2: Commit** — stage only `src/app/api/reports/driver-performance/route.js` and commit `fix(reports): driver performance honors from/to date range`

---

### Task 17: Verify scripts (trip status, cancel cascade, quick wins)

**Files:**
- Create: `scripts/verify-trip-status.mjs`, `scripts/verify-cancel-cascade.mjs`, `scripts/verify-quickwins.mjs`

All follow the `verify-rbac.mjs` harness pattern; run with `node --import ./scripts/route-harness-loader.mjs scripts/verify-*.mjs` (live DB + `.env.local`).

- [ ] **Step 1: `verify-trip-status.mjs`** — set up a request→dispatch→trip via the real POST/PUT routes; (a) `PUT /api/trips/[id]/status {status:"Completed", end_odometer}` → assert dispatch `Completed`, vehicle/driver re-synced, request `Completed`, and a `trip_completed` event on the timeline; (b) a fresh trip via `{status:"Cancelled"}` → assert dispatch `Cancelled`, resources released, request `Cancelled`; (c) assert `management` gets 403 on the route; (d) assert a driver calling start/complete on another driver's trip gets 404. Clean up seeded rows (soft-delete).
- [ ] **Step 2: `verify-cancel-cascade.mjs`** — (a) cancel a request that has an open dispatch+trip → assert dispatch `Cancelled` and trip `Cancelled`; (b) cancel a dispatch directly → assert its trip `Cancelled` and, for a request-driven dispatch, the request `Cancelled`.
- [ ] **Step 3: `verify-quickwins.mjs`** — (a) notifications GET as a `driver` only returns their rows (seed two notifications for two employees, assert scoping); (b) legacy `POST /api/reservations` returns 410; (c) `GET /api/reports/driver-performance?from&to` returns the same shape as before (regression) — note it cannot be fully exercised without seeded trips, so assert the response shape only.
- [ ] **Step 4: Commit** — `git add scripts/verify-trip-status.mjs scripts/verify-cancel-cascade.mjs scripts/verify-quickwins.mjs && git commit -m "test: harnesses for trip-status sync, cancel cascade, quick wins"`

---

### Task 18: Docs + full suite

**Files:**
- Modify: `docs/architecture/sub-system-integration.md` (§8.3 flow + §8.5 API table)

- [ ] **Step 1:** Update §8.5 to mark the legacy `/api/reservations` write endpoints as deprecated (410), and note the cancellation cascade in §8.3 (cancel now closes open dispatches/trips).
- [ ] **Step 2:** Run the full suite: `npm run lint`, `npm run test:run`, then all three new verify scripts plus `scripts/verify-rbac.mjs`, `scripts/verify-round-trip.mjs`, `scripts/verify-calendar.mjs`. Fix any regressions before finishing.
- [ ] **Step 3: Commit** — stage only `docs/architecture/sub-system-integration.md` and commit `docs: reflect legacy lockdown and cancellation cascade`

---

## Self-review notes
- **Spec coverage:** Critical 4 ✓ (Tasks 8-13 = trip status/cancellation, Tasks 1-6 = fuel, Task 14 = legacy lockdown); quick wins ✓ (Task 15 notifications, Task 16 report dates, Task 10/11 ownership + RBAC). Booking gateway untouched ✓; double-booking advisory ✓.
- **Type consistency:** `completeTrip(tripId, session, { endOdometer, distance })`, `cancelTrip(tripId, session, { reason })`, `syncBusyTrip(tripId, session)` signatures are identical across Task 8 (def) and Tasks 9/11 (use). `canTransitionDispatch(from, to)` defined in Task 7, used in Task 13.
- **Out of scope (noted for the user):** `advanceReservation` transactionality, DB exclusion constraints, the mock gateway, driver ratings write path, `Off Duty` clobbering, maintenance-during-trip guard — these were either accepted by you or can be a follow-up plan.
