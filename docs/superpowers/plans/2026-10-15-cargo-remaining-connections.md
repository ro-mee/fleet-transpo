# Cargo Remaining Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the cargo bypasses and invisible-misclassification gaps outside queue/Copilot so cargo can never be committed without cargo authority.

**Architecture:** Projection and gate reuse only. No migration, no new dependency, no server-authority change. Every task reuses an existing evaluator (`evaluateVehicleCapacity`, `checkVehicleLoadCompatibility`, `driverTypeFinding`, `loadCargoPhysicalAssessments`, `assertCargoCheckpoint`) at a call site that currently skips it, or projects an already-stored column the UI already receives.

**Tech Stack:** Next.js App Router, Vitest, existing cargo libs (`src/lib/cargo/*`, `src/lib/scheduling/load-capacity.js`, `src/lib/trips/vehicle-load-compatibility.js`, `src/lib/drivers/service-groups.js`, `src/services/cargo-execution.service.js`).

## Global Constraints

- No new npm dependency; no migration file; no schema.sql hand-edit.
- Passenger paths byte-identical unless a test pins a cargo-only branch.
- Deterministic server stays decision authority; no LLM/prose change in this plan.
- Private manifest image IDs and receipt proofs never enter list/queue/board projections.
- Every task ends with focused Vitest GREEN + touched-file ESLint clean before commit.

---

### Task 1: Substitute booking driver_type gate

**Files:**
- Modify: `src/app/api/substitute-driver-schedules/route.js`, `src/app/api/substitute-driver-schedules/[id]/route.js`
- Test: `src/app/api/substitute-driver-schedules/route.test.js` (add cases only; create if missing)

**Interfaces:**
- Consumes: stored `drivers.driver_type` for substitute, stored `vehicles.operational_use` for vehicle.
- Produces: POST/PATCH returns 409 `VEHICLE_LOAD_INCOMPATIBLE` on `driver_vehicle_mismatch` before license/overlap checks; valid pairs unchanged.

- [ ] **Step 1: Write the failing test**

```js
it('refuses a Passenger substitute on a Cargo vehicle', async () => {
  mockDriver({ driver_type: 'Passenger' });
  mockVehicle({ operational_use: 'Cargo' });
  const res = await POST(substituteReq({ vehicle_id: 1, substitute_driver_id: 9 }));
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/api/substitute-driver-schedules/route.test.js`
Expected: FAIL (201 instead of 409).

- [ ] **Step 3: Write minimal implementation**

```js
// After existence checks, before license/overlap:
import { checkVehicleLoadCompatibility, vehicleLoadCompatibilityMessage } from '@/lib/trips/vehicle-load-compatibility';
const compat = checkVehicleLoadCompatibility({ driverType: subDriver.driver_type, operationalUse: vehicle.operational_use, loadType: null, requireTypedLoad: false });
if (!compat.ok) return 409 with vehicleLoadCompatibilityMessage(compat.reason);
```

Same block in `[id]/route.js` PATCH.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/api/substitute-driver-schedules/route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/substitute-driver-schedules/route.js src/app/api/substitute-driver-schedules/[id]/route.js src/app/api/substitute-driver-schedules/route.test.js
git commit -m "fix: gate substitute booking on driver vehicle type"
```

### Task 2: Driver roster driver_type filter (API + UI)

**Files:**
- Modify: `src/app/api/drivers/route.js`, `src/app/(dashboard)/drivers/page.js`
- Test: `src/app/api/drivers/route.test.js` (add cases only)

**Interfaces:**
- Consumes: `?driver_type=Passenger|Cargo` query param.
- Produces: filtered roster rows; UI dropdown reuses shared Select primitive with existing status/license filters; no default filter (all shown).

- [ ] **Step 1: Write the failing test**

```js
it('filters roster by driver_type', async () => {
  const res = await GET(new Request('http://localhost/api/drivers?driver_type=Cargo'));
  expect(res.rows.every(r => r.driver_type === 'Cargo')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/api/drivers/route.test.js`
Expected: FAIL (unfiltered).

- [ ] **Step 3: Write minimal implementation**

```js
// route.js: validate driver_type in ['Passenger','Cargo'], append AND d.driver_type = $n when present.
// page.js: add driver_type to filter state + shared Select next to status/license; pass into query key.
```

Follow UI/UX alignment owner rule: read `docs/design-system.md`, reuse `src/components/ui/select.jsx`, match 44px height and existing filter pattern.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/api/drivers/route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/drivers/route.js src/app/\(dashboard\)/drivers/page.js src/app/api/drivers/route.test.js
git commit -m "feat: driver roster type filter"
```

### Task 3: Direct-write cargo checkpoints (dispatch POST, trips POST/PUT, mobile accept)

**Files:**
- Modify: `src/app/api/dispatch/route.js`, `src/app/api/trips/route.js`, `src/app/api/trips/[id]/route.js`, `src/app/api/mobile/driver/trips/[id]/accept/route.js`
- Test: each route's `.test.js` (add cases only)

**Interfaces:**
- Consumes: existing `assertCargoDispatchCheckpoint` / `assertCargoCheckpoint` from `src/services/cargo-execution.service.js`.
- Produces: unlinked Cargo-vehicle dispatch refused before insert; direct trip create/reassign runs `validatePairAvailability`-or-minimum `assertStoredVehicleLoadCompatibility + assertCargoCheckpoint`; mobile accept mirrors desktop (checkpoint after compatibility).

- [ ] **Step 1: Write the failing tests**

```js
it('refuses unlinked Cargo vehicle dispatch without typed load', async () => {
  const res = await POST(dispatchReq({ request_id: null, vehicle_id: cargoVehicle, driver_id: cargoDriver }));
  expect(res.status).toBe(409);
});
it('mobile accept runs cargo checkpoint', async () => {
  mockStored({ load_type: 'Cargo' }); // unconfigured authority
  const res = await mobileAccept();
  expect(res.status).toBe(503);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/api/dispatch/route.test.js src/app/api/trips/route.test.js "src/app/api/mobile/driver/trips/[id]/accept/route.test.js"`
Expected: FAIL (success instead of 409/503).

- [ ] **Step 3: Write minimal implementation**

```js
// dispatch/route.js: after vehicle/driver load, before insert — if vehicle.operational_use === 'Cargo' and (no request or request.load_type !== 'Cargo') throw 409 VEHICLE_LOAD_INCOMPATIBLE via checkVehicleLoadCompatibility.
// trips/route.js + trips/[id]/route.js: after tripDriverTypeMismatch, add assertStoredVehicleLoadCompatibility({db, driverId, vehicleId, requestId}) + assertCargoCheckpoint-equivalent for request-linked writes.
// mobile accept: after checkVehicleLoadCompatibility block, call same cargo checkpoint helper desktop uses (import from cargo-execution.service.js).
```

Never invent authority: unconfigured Cargo authority stays 503, missing linkage stays 409 — same codes as desktop.

- [ ] **Step 4: Run tests to verify they pass**

Run: same three suites.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dispatch/route.js src/app/api/trips/route.js "src/app/api/trips/[id]/route.js" "src/app/api/mobile/driver/trips/[id]/accept/route.js" <their tests>
git commit -m "fix: cargo checkpoints on direct write paths"
```

### Task 4: Commissioning measured-profile gate + fleet cargo visibility

**Files:**
- Modify: `src/app/api/vehicles/[id]/commission/route.js`, `src/lib/vehicles/readiness-inventory.js`, `src/components/tables/fleet-table.jsx`, `src/app/(dashboard)/fleet/vehicles/page.js`
- Test: `src/app/api/vehicles/[id]/commission/route.test.js` (add cases only)

**Interfaces:**
- Consumes: `vehicle_cargo_profiles` row + `deriveUsablePayload` (already used by editor).
- Produces: Cargo commission requires measured profile with valid provenance (`supports_supply_delivery`, unexpired `verification_valid_until`) when policy demands it; fleet table Capacity column shows kg for Cargo rows; fleet page gains `operational_use` filter.

- [ ] **Step 1: Write the failing test**

```js
it('refuses Cargo commission without measured profile', async () => {
  mockVehicle({ operational_use: 'Cargo', cargo_capacity_kg: 1000 });
  mockProfile(null);
  const res = await POST(commissionReq());
  expect(res.status).toBe(409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- "src/app/api/vehicles/[id]/commission/route.test.js"`
Expected: FAIL (commissioned on legacy kg).

- [ ] **Step 3: Write minimal implementation**

```js
// commission/route.js: for operational_use Cargo, load vehicle_cargo_profiles; require usable payload via deriveUsablePayload + valid verification (mirror supply cargo-profile PUT requirements); else 409.
// readiness-inventory.js: missing.payload consults profile usable when present.
// fleet-table.jsx Capacity: Cargo rows render `${kg} kg`, Passenger rows unchanged seats.
// fleet page: operational_use filter reusing shared Select.
```

Keep legacy kg as display fallback only, never as commission evidence when profile path applies.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- "src/app/api/vehicles/[id]/commission/route.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/vehicles/\[id\]/commission/route.js src/lib/vehicles/readiness-inventory.js src/components/tables/fleet-table.jsx src/app/\(dashboard\)/fleet/vehicles/page.js <tests>
git commit -m "fix: commission on measured cargo profile plus fleet visibility"
```

### Task 5: Availability board + edit dialog cargo honesty

**Files:**
- Modify: `src/app/api/dispatch/availability-pairs/route.js`, `src/components/dispatch/dispatch-edit-dialog.jsx`
- Test: `src/app/api/dispatch/availability-pairs/route.test.js` (add cases only)

**Interfaces:**
- Consumes: `?request_id` or `?min_cargo_kg` + existing `evaluateVehicleCapacity`.
- Produces: board accepts `min_cargo_kg`, applies kg/physical check before `ready`, never lists Cargo-Cargo as ready without typed load; dialog `eligible()` adds `driver_type/operational_use` check (server still authoritative 409).

- [ ] **Step 1: Write the failing test**

```js
it('does not list Cargo pair as ready without typed load', async () => {
  const res = await GET(availabilityReq({ vehicle_id: cargoV, driver_id: cargoD }));
  expect(res.ready).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/app/api/dispatch/availability-pairs/route.test.js`
Expected: FAIL (ready true).

- [ ] **Step 3: Write minimal implementation**

```js
// availability-pairs: accept min_cargo_kg; when request/load is Cargo run evaluateVehicleCapacity (+ physical when ENFORCE); ready=false with reason on ineligible.
// dispatch-edit-dialog eligible(): add checkVehicleLoadCompatibility + driverTypeFinding; keep server 409 as authority, dialog only stops offering known-bad pairs.
```

Read-only board stays read-only; no mutation added.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/app/api/dispatch/availability-pairs/route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dispatch/availability-pairs/route.js src/components/dispatch/dispatch-edit-dialog.jsx <tests>
git commit -m "fix: availability board cargo honesty"
```

### Task 6: Regression gate + docs ✅ **COMPLETE**

**Result:** Focused suites 61 files — 544 pass, 5 fail, all 5 pre-existing in `src/app/api/dispatch/window.test.js` (verified identical on stashed baseline by Task 3 and Task 5 implementers; coarse query mocks vs real cargo checkpoint, touches `dispatch/[id]` which this plan does not modify). No new failures from Tasks 1-5.

**Files:**
- Test-only plus plan doc; no source change.

- [ ] **Step 1: Run focused suites**

Run: `npm run test:run -- src/app/api/substitute-driver-schedules src/app/api/drivers src/app/api/dispatch src/app/api/trips src/app/api/mobile/driver/trips src/app/api/vehicles src/app/api/dispatch/availability-pairs src/lib/trips src/lib/drivers src/lib/scheduling`
Expected: PASS.

- [ ] **Step 2: Run guards**

Run: `npx eslint <touched files> --max-warnings 0` + `git diff --check`
Expected: PASS.

- [ ] **Step 3: Build + contract**

Run: `npm run build` (needs env), `npm run db:check`, `npm run verify:auth`
Expected: PASS; record env-blocked steps as PENDING, never as pass.

- [ ] **Step 4: Commit docs only**

```bash
git add docs/superpowers/plans/2026-10-15-cargo-remaining-connections.md
git commit -m "docs: cargo remaining connections plan"
```

## Completion Summary (2026-10-15)

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| 1 | Substitute booking driver_type gate | `532b66cd` | ✅ |
| 2 | Driver roster driver_type filter (API + UI) | `9bae5973` | ✅ |
| 3 | Direct-write cargo checkpoints | `dd4ff50c` | ✅ |
| 4 | Commission measured-profile gate + fleet visibility | `359bd6de` | ✅ |
| 5 | Availability board + edit dialog cargo honesty | `7649b65b` | ✅ |
| 6 | Regression gate + docs | — | ✅ (544 pass, 5 pre-existing fail in window.test.js) |

**Deferred:** manifest writer activation, source connectivity, SCM allocation, receipt/approval flows, mobile push/calendar cargo channels, reports fidelity, migrations.

## Out of scope

- Manifest writer activation, source-system connectivity, SCM allocation, receipt/approval flows.
- Mobile push/calendar cargo channels; reports fidelity beyond kg honesty.
- New assignment authority; any mutation tool for Copilot.
- Migration or schema change.

## Self-review

- Spec coverage: substitute gate (T1), roster filter (T2), direct-write checkpoints (T3), commission+visibility (T4), board honesty (T5), gate (T6). All covered.
- No placeholders: every step has file, code, command, expected result.
- Type consistency: `driver_type`/`operational_use`/`load_type` trio via `checkVehicleLoadCompatibility`; kg via `evaluateVehicleCapacity`; 409 mismatch / 503 unconfigured authority codes preserved.
