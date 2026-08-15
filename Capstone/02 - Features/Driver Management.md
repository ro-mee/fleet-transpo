---
type: feature
status: working
tags: [feature, drivers, ocr, consent]
source:
  - src/lib/driver/grounding.js
  - src/lib/consent/driver-visibility.js
  - src/app/api/driver
  - supabase/migrations/024_driverincidents.sql
  - supabase/migrations/049_driver_work_schedule_and_leave.sql
  - src/lib/scheduling/driver-schedule.js
  - src/services/driver-schedule.service.js
last_verified: 2026-08-15
related: ["[[Mobile Architecture]]", "[[Fleet And Vehicles]]"]
---

# Feature: Driver Management

## What it does

Driver records, licences (with OCR), documents, availability, incidents, consent, and performance. 23 drivers.

## Driver ≠ employee, exactly

A driver **is** an employee with a `drivers` row. Credentials and `role_id` live on [[employees]]; licence, availability and performance on `drivers`. Mobile login authenticates against `employees`, then resolves a `driverId`. → [[Authentication]]

## Licence OCR — CONFIRMED

`tesseract.js` ^7.0.0 + regex extraction for **Philippine LTO** licence cards, with a **6-second timeout that resolves `""`** rather than rejecting.

Resolving empty on timeout instead of throwing is the right call: OCR is a convenience that pre-fills a form. If it's slow, the user types the number. A rejection would surface an error for a feature that was only ever optional. → [[Graceful Degradation]]

`verify_ocr_timing.js` in the repo root suggests the timeout was tuned empirically.

## Consent and self-service visibility — CONFIRMED

`src/lib/consent/driver-visibility.js`:

```js
DRIVER_VISIBLE_SECTIONS = [profile, license, performance, trip_history, attendance]
DRIVER_SELF_EDITABLE_FIELDS = ["phone", "face_image_url",
                               "license_image_url", "license_back_image_url"]
LICENSE_REUPLOAD_WINDOW_DAYS = 30
```

An **allow-list**, not a deny-list. A driver can edit exactly four fields; anything new added to the table is not editable until someone deliberately adds it. That's the safe default. → [[Fail Closed By Default]]

`canUpdateLicenseScan()` enforces the 30-day re-upload window — INFERRED: to stop repeated re-scans being used to churn the licence record.

## The Sev-1 bug — FIXED 2026-08-11

`shouldGroundVehicle()` **grounded every vehicle on any incident**, ignoring `incidentType` and `severity` — and its test asserted that was correct. The rule it was supposed to implement was written in its own docstring the whole time.

Now: grounds on a breakdown-type report **or** Major/Critical severity, and never without a `vehicleId`.

→ [[BUG shouldGroundVehicle Is A Stub]] · [[Tests Can Encode Bugs]]

## Incidents were broken once already — CONFIRMED

Migration `024_driverincidents.sql` recreates a table that `005` dropped:

> *"The driver portal and /api/driver/incidents still reference it, so it was missing at runtime and incident reporting was broken."*

A migration removed a table that live code still used, and nothing caught it. → [[Migrations]]

## Database tables used

`drivers` (23) · [[employees]] (47) · [[driver_vehicle_assignments]] · `driverincidents` · `driver_documents` · `driver_consents` · `driverattendance` **0 rows** · `driver_stats` (view) · [[mobile_refresh_tokens]] (57)

## Weekly work schedules & leave — CONFIRMED 2026-08-15

Migration `049_driver_work_schedule_and_leave.sql` adds `driver_work_schedules`
(one row per driver per `day_of_week`, `shift_start`/`shift_end`/`break_start`/
`break_end` TIME, `is_rest_day`, unique `(driver_id, day_of_week)`) and
`driver_leave_requests` (`start_date`/`end_date`/`leave_type`/`reason`/`status`
Pending|Approved|Declined, reviewed_by/notes/at).

Rules:

- **Fleet manager owns the schedule.** Only `system_admin`/`fleet_manager` write
  (`PUT /api/driver-work-schedules`); admin observes. Write policies in 049 are
  `system_admin` + `fleet_manager` only — matching the directive that admin is
  never the schedule writer. → [[Why RLS Is Not A Boundary]]
- **Fail-closed availability.** A driver with no schedule row is **not assignable**
  ("No work schedule"). Fail-open only when a caller never loaded schedule context
  (`driverBlockReason` returns null on `!ctx?.schedules`); fail-closed whenever
  context was loaded and the map is empty. Pure core: `scheduleBlockReason`
  (`src/lib/scheduling/driver-schedule.js`). → [[Fail Closed By Default]]
- **Blocking rule order**: approved leave covers the date → block; no row for that
  `day_of_week` → block; rest day → block; window not fully inside shift
  (`!(pickup >= shift_start && returnAt <= shift_end)`) → block; half-open break
  overlap (`break_start < returnAt && break_end > pickup`) → block.
- **Leave lifecycle**: driver files via `POST /api/driver/leave` (self, Pending);
  fleet manager approves/declines via `PATCH /api/driver-leave-requests/[id]`
  (409 if an overlapping request is already Approved). Driver withdraws Pending
  via `DELETE /api/driver/leave`. Only **Approved** leave blocks assignment.
- **Server TZ is Asia/Manila.** `localDayOfWeek`/`localTimeOfDay` use Date local
  getters, consistent with the `toCalendarDay` convention.
- Backfilled **49 rows** (drivers 1, 2, 19, 20, 21, 22, 26 × 7 days, 06:00–22:00,
  break 12:00–13:00, no rest days) so live enforcement could be verified without
  inventing a rest-day policy.

Enforcement surfaces: `GET /api/drivers` (windowed), `GET /api/vehicles/available`
(windowed, effective driver from `ctx.pairings`), `pair-scoring.js`
(`isDriverUnavailableFor` + `resolveVehiclePairing` + `buildFleetPairRecommendations`),
`recommendation.service.js` `validatePairAvailability`, `dispatch-advisor.js`,
the transport-request recommendation route, `conflicts.js` (DRIVER_UNAVAILABLE),
`trips/[id]/start` gate, and the dispatch calendar probe.

UI: `WorkScheduleCard` on the driver detail page (schedule editor gated
fleet_manager), `/drivers/leave` review board (fleet_manager approves),
`/driver/schedule` self-service (view schedule, file/withdraw leave).

## Open questions

- `driverattendance` has 0 rows but is a `DRIVER_VISIBLE_SECTIONS` entry — is attendance actually implemented? **TODO:** check for a writer.
- The old "Standard Morning Shift" card was replaced by the real schedule; the
  static 06:00–02:00 assumption is gone. Backfilled hours are a neutral default,
  **not** a policy — the fleet manager should set real shifts via the editor.

## Related

[[employees]] · [[driver_vehicle_assignments]] · [[Mobile Architecture]] · [[Driver Consent]] · [[Feature Index]]
