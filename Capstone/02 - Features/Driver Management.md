---
type: feature
status: working
tags: [feature, drivers, ocr, consent]
source:
  - src/lib/driver/grounding.js
  - src/lib/consent/driver-visibility.js
  - src/app/api/driver
  - supabase/migrations/024_driverincidents.sql
last_verified: 2026-08-11
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

## Open questions

- `driverattendance` has 0 rows but is a `DRIVER_VISIBLE_SECTIONS` entry — is attendance actually implemented? **TODO:** check for a writer.

## Related

[[employees]] · [[driver_vehicle_assignments]] · [[Mobile Architecture]] · [[Driver Consent]] · [[Feature Index]]
