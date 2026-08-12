---
type: reference
title: drivers
tags: [database, table, drivers]
source:
  - src/lib/consent/driver-visibility.js
  - src/lib/driver/
last_verified: 2026-08-11
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

## Licence images and OCR

Licence uploads run through Tesseract.js OCR with a **6-second timeout that resolves to `""`** — a blank field the driver fills in by hand, never a half-parsed licence number. → [[Graceful Degradation]]

`LICENSE_REUPLOAD_WINDOW_DAYS = 30` bounds how long a re-upload is accepted.

## Vehicle pairing lives elsewhere

Which vehicle a driver is assigned is **not** a column here — it's [[driver_vehicle_assignments]], with partial unique indexes enforcing at most one active pairing per driver and per vehicle. That's what forces reassignment through `withTransaction`. → [[Connection Pooling vs Transactions]]

## `driver_stats` — a view, not a table

`driver_stats` is one of the 39+1 objects and is a **view** — the "+1". It still has no migration file: `034` backfilled the four undeclared *tables* and left the view alone. → [[DEBT Schema Drift From Migrations]]

## Grounding

`shouldGroundVehicle()` decides whether an incident takes a vehicle off the road. It currently **grounds everything**, ignoring `incidentType` and `severity`. Affects fleet availability continuously and silently. → [[BUG shouldGroundVehicle Is A Stub]]

## Related

[[Driver Management]] · [[Driver Consent]] · [[employees]] · [[driver_vehicle_assignments]] · [[vehicles]] · [[Database Overview]] · [[ERD]]
