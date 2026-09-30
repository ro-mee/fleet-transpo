---
type: reference
title: drivers
tags: [database, table, drivers]
source:
  - src/lib/consent/driver-visibility.js
  - src/lib/driver/
last_verified: 2026-09-27
---

# Table: `drivers`

**23 rows** — CONFIRMED. The driver profile: licence, availability, and the fields a driver may see and edit about themselves.

## Relationship to `employees`

`drivers` is **not** the login. Authentication happens against `employees.password_hash`; `drivers` holds the operational profile. A driver has both records. → [[employees]] · [[Authentication]]

That split is why 23 drivers coexist with 47 employees (of which 29 are soft-deleted harness accounts).

## Consent and visibility — CONFIRMED

`src/lib/consent/driver-visibility.js` defines what a driver may see and change about their own record, as **allowlists**:

```js
DRIVER_VISIBLE_SECTIONS
DRIVER_SELF_EDITABLE_FIELDS = [
  "phone", "face_image_url", "license_image_url", "license_back_image_url"
]
LICENSE_REUPLOAD_WINDOW_DAYS = 30
```

Four editable fields — a phone number and three images. Everything else about a driver is set by fleet staff.

A column added to this table tomorrow is invisible and non-editable until someone adds it to those lists. That's the correct polarity: forgetting is safe. → [[Fail Closed By Default]] · [[Driver Consent]]

## Licence OCR — historical note, superseded 2026-09-27

The current licence scan uses Gemini OCR to suggest a licence number and expiry date; staff must compare those suggestions with the physical card before saving, and neither suggestion verifies authenticity or active status. → [[Graceful Degradation]]

`LICENSE_REUPLOAD_WINDOW_DAYS = 30` bounds how long a re-upload is accepted.

## License review and assignment fields — migration 137

`license_verified_at`, `license_verified_by` and `license_verification_method` record a staff
attestation after checking the physical card or LTO Digital ID. Any credential or card-image
change clears the attestation. It is not an LTO verification API result.

Dispatch eligibility requires a valid Professional license, supported class (B or B1), an
exact expiry date that has not passed in Asia/Manila, and staff review metadata. Student
Permits are ineligible. The full license number remains plaintext in `drivers.license_number`;
routine API serializers mask it. A driver can explicitly request only their own full number
through the authenticated `/api/driver/me?include_license=1` profile read; staff detail/edit reads
require `drivers.update`. This is access/display masking, not encryption. NULL verification
metadata on existing rows is intentional and blocks assignment until review.

## Personal and emergency contact exposure — 2026-09-30

`address`, `birthdate`, `sex`, `nationality`, `emergency_contact_name`, `emergency_contact_phone`, and `emergency_contact_address` columns are now exposed via `GET /api/driver/me` for the authenticated driver's self-view (rendered on both web `/driver/profile` and mobile `profile/personal.js`). When an operator edits a driver via `/drivers/[id]/edit`, optional fields that are cleared now send `null` so that database columns are properly set to `NULL` rather than being ignored.

## Vehicle pairing lives elsewhere

Which vehicle a driver is assigned is **not** a column here — it's [[driver_vehicle_assignments]], with partial unique indexes enforcing at most one active pairing per driver and per vehicle. That's what forces reassignment through `withTransaction`. → [[Connection Pooling vs Transactions]]

## `driver_stats` — a view, not a table

`driver_stats` is one of the 39+1 objects and is a **view** — the "+1". It still has no migration file: `034` backfilled the four undeclared *tables* and left the view alone. → [[DEBT Schema Drift From Migrations]]

## Grounding

`shouldGroundVehicle()` decides whether an incident takes a vehicle off the road. It currently **grounds everything**, ignoring `incidentType` and `severity`. Affects fleet availability continuously and silently. → [[BUG shouldGroundVehicle Is A Stub]]

## Related

[[Driver Management]] · [[Driver Consent]] · [[employees]] · [[driver_vehicle_assignments]] · [[vehicles]] · [[Database Overview]] · [[ERD]]
