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

## Related

[[Dispatch]] · [[Maintenance]] · [[Fuel]] · [[UVVRP Number Coding]] · [[Feature Index]]

## Road-readiness and commissioning — runtime gates, 2026-10-08

The pure readiness evaluator is now enforced by `readiness-server.js`, shared pair validation, strict conflict evidence, typed availability searches, and the locked dispatch/start commit path. Typed Passenger/Cargo requests require an asset code, real plate, category, supported license class, declared usable capacity, Ready commissioning, and exactly one verified live OR/CR plus Insurance document. Current time, departure, and the last instant of the service window must all be covered by the documents. Server queries derive maintenance and safety clearance; supplied booleans never clear them. Current overdue scheduled maintenance, active maintenance, service-window maintenance, and unresolved grounding incidents block. Query failures do not grant clearance.

Vehicle creation accepts a missing plate only with a real asset code. This creates a pending fleet record; it cannot pass dispatch readiness until a real plate and required evidence exist. The form saves the OR/CR expiry and never invents document numbers. Cargo vehicles save passenger seats as null.

The saved vehicle form exposes explicit **Verify documents and commission** confirmation to `admin` and `super_admin`. `POST /api/vehicles/[id]/commission` requires the two exact saved document IDs, official numbers and scans, complete static fleet evidence, and actual maintenance/safety clearance. It locks relevant records and atomically records the staff verifier/time, Ready state, and required audit event. Changes to a saved document number, scan, expiry or status reset its verification to Pending and clear the old verifier/time; unchanged documents keep their attestation. Commissioning does not fabricate or copy old expiry fields.

For typed requests, verified document rows are authoritative even if the old vehicle expiry columns or cached Registration Expired label are stale. Hard maintenance/decommissioned states, coding, driver license, pair and schedule restrictions still apply. Unclassified historical requests retain their old registration checks and passenger checklist. Final evidence revisions include document rows and the commit locks protect them against changes after validation.

Draft migration 153 permits missing plates for pending assets, adds verification/capability columns without inventing readiness, and validates existing check/index definitions against the actual relation. An invalid, partial, expression, wrong-column or extra-column asset index is a release blocker. Migration 151 adds nullable load type with no default or historical reclassification; new intake explicitly writes Passenger/Cargo.

**Offline verification.** Regression tests cover authentic complete cargo evidence, unchanged shared overload wording across assignment/start, changed stored weight despite stale caller/override, missing identity and road evidence, authorized commissioning, invalidated documents, null-classified legacy starts, renewed typed docs with stale legacy expiry, server-derived safety and overdue maintenance, and complete audit cohort admission. Targeted verification passed 25 files / 243 tests, strict lint on owned files, clean diff whitespace, 146 migration filename checks, and 300/300 route-auth guards; live catalog/apply verification and real browser/device verification remain release holds. No live database was contacted.

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
