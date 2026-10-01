# FleetOps Pre-Shift & Pre-Trip Vehicle Inspection Update Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In-place replacement of the existing FleetOps vehicle inspection workflow to introduce the 5-question critical Pre-Shift daily baseline and the 3-section Pre-Trip readiness gate (Safety, Passenger Check, Cabin Ready acknowledgment) across mobile UI, API validation, server-side gating, and tests.

**Architecture:** Update the existing single source of truth in `src/lib/inspections/checklists.js` and its mobile mirror `mobile/lib/inspection-checklist.js`. Update `src/app/api/mobile/driver/inspections/route.js` and `src/services/standby.service.js` to enforce server-authoritative gating (Pre-Shift passing required for Start Duty; Pre-Trip safety passing required for Start Trip; passenger items treated as non-blocking findings). Update `mobile/app/(app)/inspection.js` in place with custom cards, large tap targets, and contextual prompts.

**Tech Stack:** Next.js (App Router), React Native (Expo), PostgreSQL (`pg`), Vitest.

## Global Constraints
- In-place replacement: NO new tables, NO duplicate routes, NO parallel checklist systems.
- Pre-Shift item IDs: `["sounds", "lights", "dashboard", "steering", "brakes_tires"]` — all 5 are blocking.
- Pre-Trip item IDs: `["brakes_tires", "passenger_items", "cabin_ready"]` — only `brakes_tires` is blocking.
- `passenger_items = ITEMS FOUND` requires remarks and does NOT fail the safety inspection.
- `cabin_ready` must be acknowledged (marked PASS) before completing Pre-Trip.
- Start Duty gate requires today's Pre-Shift row with `status = 'Passed'`.
- Start Trip gate requires trip's Pre-Trip row with `status = 'Passed'`.
- Historical inspection records must remain readable by `failedItemsFrom`.

---

### Task 1: Update Server Checklist Definitions & Validation

**Files:**
- Modify: `src/lib/inspections/checklists.js`
- Test: `src/lib/inspections/checklists.test.js`

**Interfaces:**
- Consumes: Existing exports from `src/lib/inspections/checklists.js`.
- Produces:
  - `PRE_SHIFT_ITEMS = ["sounds", "lights", "dashboard", "steering", "brakes_tires"]`
  - `PRE_TRIP_ITEMS = ["brakes_tires", "passenger_items", "cabin_ready"]`
  - `PRE_SHIFT_BLOCKING_ITEMS = ["sounds", "lights", "dashboard", "steering", "brakes_tires"]`
  - `PRE_TRIP_BLOCKING_ITEMS = ["brakes_tires"]`
  - `NON_BLOCKING_PRE_TRIP_ITEMS = ["passenger_items"]`
  - `CRITICAL_ITEM_IDS` (alias or union of blocking items)
  - `blockingItemIdsForType(type)`
  - `validateChecklist(type, items)`
  - `failedItemsFrom(checklist)` (safe with legacy & new items)

- [ ] **Step 1: Write failing tests for updated checklist definitions in `src/lib/inspections/checklists.test.js`**

Add tests asserting:
1. `PRE_SHIFT_ITEMS` equals `["sounds", "lights", "dashboard", "steering", "brakes_tires"]` (5 items).
2. `PRE_TRIP_ITEMS` equals `["brakes_tires", "passenger_items", "cabin_ready"]` (3 items).
3. `blockingItemIdsForType("Pre-Shift")` equals all 5 Pre-Shift items.
4. `blockingItemIdsForType("Pre-Trip")` equals `["brakes_tires"]`.
5. `validateChecklist("Pre-Shift", ...)` passes with valid 5 items, fails if item missing or if failed item lacks remarks.
6. `validateChecklist("Pre-Trip", ...)` passes when `passenger_items` has `status: "FAIL"` and remarks provided.
7. `validateChecklist("Pre-Trip", ...)` fails if `cabin_ready` is missing or has status `"FAIL"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/inspections/checklists.test.js`
Expected: FAIL due to item ID mismatch and checklist length.

- [ ] **Step 3: Update `src/lib/inspections/checklists.js`**

Implement updated items, blocking lists, and validation logic:
- Update `PRE_SHIFT_ITEMS` and `PRE_TRIP_ITEMS`.
- Export `PRE_SHIFT_BLOCKING_ITEMS` and `PRE_TRIP_BLOCKING_ITEMS`.
- Export `blockingItemIdsForType(type)`.
- Update `CRITICAL_ITEM_IDS` to include blocking items.
- In `validateChecklist(type, items)`:
  - Verify exact expected length (5 for Pre-Shift, 3 for Pre-Trip).
  - Verify every expected item id is present.
  - Verify `cabin_ready` in Pre-Trip must have status `"PASS"` (`"cabin_ready must be acknowledged before completing pre-trip"`).
  - Verify any item with status `"FAIL"` has non-empty remarks.
- Keep `failedItemsFrom(checklist)` robust against any legacy or new items.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/inspections/checklists.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inspections/checklists.js src/lib/inspections/checklists.test.js
git commit -m "feat(inspections): update server checklist definitions and validation"
```

---

### Task 2: Update Mobile Checklist Mirror & Config

**Files:**
- Modify: `mobile/lib/inspection-checklist.js`
- Test: `mobile/lib/inspection-checklist.test.js`

**Interfaces:**
- Consumes: Item IDs and rules from `src/lib/inspections/checklists.js`.
- Produces:
  - `PRE_SHIFT_CHECKLIST` (5 items with questions, options, context-aware prompts):
    1. `sounds`: *"Does the vehicle make any unusual sounds?"* (`NO UNUSUAL SOUND` / `UNUSUAL SOUND HEARD`, prompt: *"Describe the unusual sound you heard."*)
    2. `lights`: *"Are the headlights, brake lights, and signal lights working?"* (`ALL WORKING` / `ISSUE FOUND`, prompt: *"Describe which light is not working."*)
    3. `dashboard`: *"Are there any critical warning lights on the dashboard?"* (`NONE` / `WARNING LIGHT PRESENT`, prompt: *"Describe the dashboard warning shown."*)
    4. `steering`: *"Is the steering working normally?"* (`NORMAL` / `ISSUE FOUND`, prompt: *"Describe the steering issue."*)
    5. `brakes_tires`: *"Are the brakes working properly and the tires in safe condition?"* (`SAFE` / `ISSUE FOUND`, prompt: *"Describe the brake or tire issue."*)
  - `PRE_TRIP_CHECKLIST` (3 items):
    1. `brakes_tires`: *"Are the brakes working properly and the tires in safe condition?"* (`SAFE` / `ISSUE FOUND`, prompt: *"Please describe the brake or tire issue."*)
    2. `passenger_items`: *"Are there any items left behind by the previous passenger?"* (`NO ITEMS LEFT` / `ITEMS FOUND`, prompt: *"Describe the items found (e.g., umbrella, bag, wallet)."*)
    3. `cabin_ready`: acknowledgment card metadata.

- [ ] **Step 1: Write failing tests in `mobile/lib/inspection-checklist.test.js`**

Update assertions for `PRE_SHIFT_CHECKLIST` and `PRE_TRIP_CHECKLIST` item IDs, labels, passLabels, and failLabels.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- mobile/lib/inspection-checklist.test.js`
Expected: FAIL.

- [ ] **Step 3: Update `mobile/lib/inspection-checklist.js`**

Implement the new definitions matching the spec exactly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- mobile/lib/inspection-checklist.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/inspection-checklist.js mobile/lib/inspection-checklist.test.js
git commit -m "feat(mobile): update mobile checklist definitions and labels"
```

---

### Task 3: Update API Inspection Submission & Server-Authoritative Duty Gating

**Files:**
- Modify: `src/app/api/mobile/driver/inspections/route.js`
- Modify: `src/services/standby.service.js`
- Test: `src/app/api/mobile/driver/inspections/route.test.js`
- Test: `src/services/standby.test.js`

**Interfaces:**
- Consumes: `blockingItemIdsForType` from `src/lib/inspections/checklists.js`.
- Produces:
  - Inspection submission:
    - Pre-Shift: Fails if ANY of the 5 items fail; blocks duty activation (`setDuty` not called or refused).
    - Pre-Trip: Fails ONLY if `brakes_tires` fails; if `passenger_items` fails (ITEMS FOUND), inspection status is `"Passed"` with findings stored.
  - Start Duty gate (`standbyState`): requires `preshift_baseline` to have `i.status = 'Passed'`.

- [ ] **Step 1: Write failing tests for route and standby service**

In `src/app/api/mobile/driver/inspections/route.test.js`:
- Test Pre-Shift pass: all 5 pass -> `status = 'Passed'`, duty started.
- Test Pre-Shift fail on any item (`sounds`, `lights`, `dashboard`, `steering`, `brakes_tires`) -> `status = 'Failed'`, duty NOT started.
- Test Pre-Trip normal: `brakes_tires = SAFE`, `passenger_items = NO ITEMS LEFT`, `cabin_ready = true` -> `status = 'Passed'`.
- Test Pre-Trip with lost items: `brakes_tires = SAFE`, `passenger_items = ITEMS FOUND` (with remarks) -> `status = 'Passed'`, findings stored.
- Test Pre-Trip safety fail: `brakes_tires = ISSUE FOUND` -> `status = 'Failed'`.

In `src/services/standby.test.js`:
- Test that `preshift_baseline` is false if today's Pre-Shift has `status = 'Failed'`.
- Test that `setDuty(driverId, true)` rejects with 409 `PRESHIFT_REQUIRED` if Pre-Shift is `Failed`.

- [ ] **Step 2: Run tests to verify failures**

Run: `npm run test:run -- src/app/api/mobile/driver/inspections/route.test.js src/services/standby.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement updates in `route.js` and `standby.service.js`**

1. In `src/services/standby.service.js`:
   Update `standbyState` SQL:
   ```sql
   EXISTS (SELECT 1 FROM vehicleinspection i WHERE i.driver_id=d.driver_id
     AND i.inspection_type='Pre-Shift'
     AND i.status='Passed'
     AND i.inspection_date=(NOW() AT TIME ZONE 'Asia/Manila')::date) AS preshift_baseline
   ```
2. In `src/app/api/mobile/driver/inspections/route.js`:
   - Compute blocking failures using `blockingItemIdsForType(inspectionType)`.
   - Set inspection `status = blockingFailures.length === 0 ? "Passed" : "Failed"`.
   - Set `severity = blockingFailures.length > 0 ? "High" : failures.length > 0 ? "Medium" : "None"`.
   - In Pre-Shift branch: only invoke `setDuty` if `blockingFailures.length === 0`. If failed, set `duty = { started: false, code: "PRESHIFT_FAILED", message: "Duty not started: pre-shift vehicle safety check failed." }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/api/mobile/driver/inspections/route.test.js src/services/standby.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/mobile/driver/inspections/route.js src/services/standby.service.js src/app/api/mobile/driver/inspections/route.test.js src/services/standby.test.js
git commit -m "feat(api): enforce server-authoritative safety gating for shift and trip inspections"
```

---

### Task 4: Update Mobile UI Screen & Tutorial Mode

**Files:**
- Modify: `mobile/app/(app)/inspection.js`
- Modify: `mobile/lib/inspection-tour.js`
- Test: `mobile/lib/coach-marks.test.js`

**Interfaces:**
- Consumes: `PRE_SHIFT_CHECKLIST` and `PRE_TRIP_CHECKLIST` from `mobile/lib/inspection-checklist.js`.
- Produces:
  - Pre-Shift screen:
    - 5 Question cards with custom binary buttons.
    - Contextual remarks prompts.
    - Primary CTA: `[ START YOUR SHIFT ]`.
  - Pre-Trip screen:
    - Section 1: Safety Card (`brakes_tires` -> `[ SAFE ]` / `[ ISSUE FOUND ]`).
    - Section 2: Passenger Check Card (`passenger_items` -> `[ NO ITEMS LEFT ]` / `[ ITEMS FOUND ]`).
    - Section 3: CABIN READY? acknowledgment card (`[ ✓ CABIN READY ]`).
    - Primary CTA: `[ GOOD TO GO ]`.
  - Tutorial mode:
    - Quick pass sets `brakes_tires = "PASS"`, `passenger_items = "PASS"`, `cabin_ready = "PASS"`.

- [ ] **Step 1: Update `mobile/lib/inspection-tour.js` and coach marks tests**

- Set `QUICK_PASS_FAILED_ID = null` or appropriate tutorial behavior with `brakes_tires = SAFE`.
- Update coach marks tests in `mobile/lib/coach-marks.test.js` to match new item counts and copy.

- [ ] **Step 2: Run coach marks tests to verify failures/expectations**

Run: `npm run test:run -- mobile/lib/coach-marks.test.js`
Expected: See any outdated copy or total count expectations.

- [ ] **Step 3: Update `mobile/app/(app)/inspection.js`**

1. Maintain `statuses` state for checklist items.
2. For Pre-Trip mode:
   - Render Safety Card (`brakes_tires`).
   - Render Passenger Check Card (`passenger_items`).
   - Render Cabin Ready Acknowledgment Card (`cabin_ready`).
   - Button text: `"GOOD TO GO"`.
3. For Pre-Shift mode:
   - Render 5 question cards.
   - Button text: `"START YOUR SHIFT"`.
4. Ensure remarks inputs mount context-aware prompts when failure selected.
5. In `handleSubmit`:
   - Validate required fields and remarks.
   - Send payload formatted with `{ item_id, label, status, remarks }`.
   - Handle response messages appropriately.

- [ ] **Step 4: Run tests to verify mobile and coach-marks tests pass**

Run: `npm run test:run -- mobile/lib/coach-marks.test.js mobile/lib/inspection-checklist.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/app/\(app\)/inspection.js mobile/lib/inspection-tour.js mobile/lib/coach-marks.test.js
git commit -m "feat(mobile): update inspection UI cards, cabin acknowledgment, and tutorial mode"
```

---

### Task 5: End-to-End Regression Verification & Documentation Update

**Files:**
- Modify: `Capstone/02 - Features/Trips.md`
- Modify: `Capstone/02 - Features/Driver In-App Guide.md`
- Modify: `SYSTEM.md`

- [ ] **Step 1: Run full test suite across the entire repository**

Run: `npm run test:run`
Expected: All tests pass with zero regressions.

- [ ] **Step 2: Update Capstone documentation and SYSTEM.md**

- Update `Capstone/02 - Features/Trips.md`:
  - Document the updated 5-item Pre-Shift checklist and 3-item Pre-Trip checklist.
  - Document the blocking behavior: Pre-Shift failure blocks Start Duty; Pre-Trip `brakes_tires` failure blocks Start Trip; Pre-Trip `passenger_items` is non-blocking.
  - Document `cabin_ready` acknowledgment.
- Update `Capstone/02 - Features/Driver In-App Guide.md`:
  - Document updated checklist items and tutorial flow.
- Update `SYSTEM.md`:
  - Document the vehicle inspection update in place.

- [ ] **Step 3: Commit documentation**

```bash
git add Capstone/ SYSTEM.md
git commit -m "docs: sync Capstone notes and SYSTEM.md with updated inspection workflows"
```
