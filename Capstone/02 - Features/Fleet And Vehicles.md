---
type: feature
status: working
tags: [feature, vehicles, fleet]
source:
  - src/app/api/vehicles
  - src/app/(dashboard)/fleet
  - src/lib/vehicles/odometer.js
last_verified: 2026-08-11
related: ["[[Dispatch]]", "[[Maintenance]]"]
---

# Feature: Fleet And Vehicles

## What it does

The vehicle registry: 20 vehicles, their categories, documents, odometer readings, and availability status.

## Key pieces

| Piece | Where |
|---|---|
| Categories | `vehiclecategories` — used by [[transportation_requests]].`requested_category_id` |
| Odometer validation | `src/lib/vehicles/odometer.js` — pure, rejects readings below last known |
| Document expiry | `isExpired()` checked at trip start; drives `trigger_notify_document_expiry` |
| Status sync | `syncVehicleStatus()` in `src/services/status.service.js:11` |
| Number coding | last plate digit → [[UVVRP Number Coding]] |

## Availability is derived, not stored

A vehicle is unavailable if it has an overlapping [[dispatchschedules]] row, is grounded by an incident, or has an expired document. There's no single `available` boolean that could go stale.

Except — grounding is currently broken: **any** incident grounds **any** vehicle. → [[BUG shouldGroundVehicle Is A Stub]]

## Availability boards — MERGED INTO DISPATCH 2026-08-23

The standalone `/fleet/availability` and `/drivers/availability` pages were merged into the dispatch module as `/dispatch/availability` (one page, Drivers | Vehicles tabs; components `driver-availability-board.jsx` / `vehicle-availability-board.jsx`). Management gained Vehicles visibility in the merge. The planned 2026-08-15 removal never actually landed — the pages stayed live until this merge. Schedule-overlap and grounding remain the underlying answer to "is it available"; the board is the read-only projection.

## Document Expiration board — HIDDEN FROM NAV 2026-08-23

The `/fleet/documents` compliance page is **out of scope** and was removed from the sidebar (`workspaces.js`) and command palette. Nothing was deleted: the page, `getExpiringDocuments`, and all document APIs still work via direct URL (`permissions.js` unchanged). Expiry logic itself (`isExpired()` at trip start, status sync, notification triggers) is untouched and still in scope.

## LTO registration renewal — ADDED 2026-08-23

Post-renewal update flow on the vehicle detail page ("Renew" button in the Philippine LTO Renewal card): new expiry date (+1y default), optional OR/CR number, optional scan upload (base64 data URL, same convention as the vehicle form). **Since 2026-08-25** attaching a scan auto-runs Gemini extraction and pre-fills the expiry (replacing the +1y default until manually edited) and the OR/CR number (blanks only). One `PUT /api/vehicles/[id]` carries `registration_expiry` + an `OR_CR` document upsert; because that endpoint re-runs `syncVehicleStatus` when `registration_expiry` changes, a grounded vehicle returns to Available automatically. RBAC: `can("vehicles","update")` (admin/system_admin/fleet_manager). Component: `src/components/vehicles/renew-registration-dialog.jsx`.

**Plate-driven expiry — 2026-09-15:** the Renew default is no longer "today + 1 year" (which mismatched the plate window, e.g. a September renewal for an April-window plate). New pure helper `resolveRenewalExpiry(plate, actionDate)` in `src/lib/lto-renewal.js` returns the upcoming LTO window-end date; the dialog pre-fills it, still allows manual override with an off-window warning, and Gemini scan fills count as an override. Migration `112_backfill_registration_expiry.sql` backfilled all 24 NULL `vehicles.registration_expiry` rows (incl. ABC-1234 → 2027-04-07) from their plate windows and synced empty `OR_CR` `vehicledocuments.expiry_date` values; verified 0 NULLs remain, `src/lib/lto-renewal.test.js` 6/6, full suite 129 files / 1264 tests pass, ESLint clean on touched files.

Still true after this change: there is **no renewal history table** (previous expiry/OR number is overwritten), and a suspended driver's license renewal still has no self-serve update path (staff-only via driver edit). Also fixed 2026-08-23: `fleet/vehicles/new` was sending `issue_date`/`expiration_date` keys the API ignores — Insurance doc rows now correctly receive `expiry_date`.

## Document auto-scan + auto-fill — 2026-08-25

On the vehicle form (`fleet/vehicles/new`), attaching an OR/CR or Insurance file **triggers Gemini extraction automatically and fills the form directly** — no scan button press, no review modal. `handleFileUpload` fires the scan when the FileReader completes; extracted fields are written only into fields that are **empty or still pristine** (anything staff typed always wins), then a toast reports how many fields were filled. The manual "Scan & Auto-Fill" buttons remain for re-scans. PDFs are accepted end-to-end: `loadScanImage` handles `application/pdf` data URLs (Gemini reads them natively). The driver forms (`drivers/new`, `drivers/[id]/edit`) behave the same with a strict blanks-only rule. Scanning runs server-side via [[Driver Management]]'s shared `gemini-document.js` pipeline.

## Database tables used

`vehicles` (20) · `vehiclecategories` · [[driver_vehicle_assignments]] · `vehicleinspection` **0 rows** · [[dispatchschedules]]

## Vehicle detail display — 2026-10-02

The Vehicle Specifications card on `/fleet/vehicles/[id]` no longer shows Purchase Date or Purchase Price. This is a display-only change; the vehicle fields and existing form/API behavior remain available. Verified with targeted ESLint and a source search confirming the labels and field references are absent from the detail page.

## Passenger capacity belongs to each vehicle — 2026-10-02

Removed seating capacity from the Vehicle Categories form and category cards. The category API no longer accepts, returns, or seeds `vehiclecategories.seating_capacity`; category records describe the service class, while passenger capacity is recorded on each vehicle in `vehicles.seating_capacity` through the vehicle form and API. The legacy nullable `vehiclecategories.seating_capacity` database column and its existing values are retained but are no longer selected or written by these category endpoints. No migration was needed. Static source review confirmed the vehicle form/API still use the per-vehicle field; automated tests were not run for this change.

## Related

[[Dispatch]] · [[Maintenance]] · [[Fuel]] · [[UVVRP Number Coding]] · [[Feature Index]]

## "Vehicle edit category and license class are blank" — 2026-10-01 (data, not a bug)

Reported as a prefill failure on the vehicle edit form. It is not one.

Read-only live probe on 2026-10-01 (`scratch/qa-remediation-baseline.mjs`):

```
vehicles (non-deleted): 21 total | 16 with NULL category_id | 20 with NULL required_license_class
```

`GET /api/vehicles/[id]` selects `v.*` (both columns included), and the form's `form.reset()` assigns exactly what the row holds (`category_id: vehicle.category_id || undefined`, `required_license_class: vehicle.required_license_class?.toUpperCase() || ""`). The controls were truthfully showing a column the system had **never recorded** for most of the fleet. This is the same dataset noted in the 2026-09-30 driver/licence review entry: 20/21 active vehicles lack a required license class.

There was, however, a real presentation defect: an empty control is indistinguishable from a failed prefill, so the next reader reports the same symptom again. The form now distinguishes the two states and names the one it is in:

- the trigger reads **"Not recorded — select a category"** / **"Not recorded — choose the code on the registration"** instead of the generic placeholder, and
- a hint appears beneath it: *"No category is stored on this vehicle — this control was never prefilled with one. Pick one and save to record it."* / *"No LTO code is stored on this vehicle, so it has to be chosen before this record can be saved."*

Both notices are computed from the **loaded row** (`storedCategoryMissing` / `storedLicenseMissing`), so a vehicle that *does* have the values shows neither, and neither appears while the row is still loading. The LTO code was already `required` in `vehicleSchema` and stays required — a deliberate selection is enforced on save, and the hint now explains why. `category_id` remains optional in the schema; making it mandatory would block unrelated edits on 16 vehicles, and that is a product decision, not a bug fix.

**Verification.** `src/app/(dashboard)/fleet/vehicles/new/page.test.js` (5 tests) renders the real form with a mocked query and pins: the missing-value notice and placeholder for each column, the notice being conditional on the loaded row (none while loading, none for a populated row), and each column being flagged independently. (The prefilled *values* land through `form.reset` inside an effect, which a static render does not run — what these tests assert is that the form never reports a value as missing when the record has one.)

**Save/reopen follow-up — 2026-10-02:** The initial direct load eventually showed the saved values, but the user-directed **View Vehicle → Edit Details** flow reproduced the blank controls while the form initialized. A read-only lookup confirmed the category and LTO code remained in the database; the issue was the edit form exposing default values before its `useEffect` called `form.reset()`.

The root cause of the reproducible path is a **warm react-query cache**: `/fleet/vehicles/[id]` and `/fleet/vehicles/[id]/edit` share the `["vehicle", id]` key, so "Edit Details" mounts the form with the row already available on the first render — before any effect can run. The form now derives its `useForm` `defaultValues` from that cached row (a shared `vehicleToFormValues` mapper also used by the reset effect), so the correct values are present from the first paint. A cold load, where the row is not cached, still gates on a loading state until the reset effect has run, and offers retry/back actions if loading fails. `vehicleId` is captured in the initial `initializedVehicleId` state so the gate is satisfied on the warm path without an effect.

No database change was needed. The 5 `fleet/vehicles/new/page.test.js` tests (which pin the "never recorded" copy and fail if the gate blocks the form) pass, along with scoped ESLint. A post-fix browser recheck remains pending because the local app session expired.
