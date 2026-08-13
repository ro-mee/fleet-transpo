# Guest and Driver Mobile MVP

## First increment

The mobile app is one Expo client with two post-login experiences:

- **Guest:** request a ride, review/cancel an eligible request, see its status,
  track an assigned driver during an active trip, view history, rate completion.
- **Driver:** view only assigned trips, accept/decline, update trip progress,
  share active-trip location, and submit a fuel receipt report.
  (Tab structure is documented in code: `mobile/app/(app)/(tabs)/_layout.js`)

The Guest/Driver selector in the initial shell is a development preview only.
Production navigation must come from the authenticated account role.

## Fuel receipt contract

The driver submits an image and confirms the extracted fields before the API
creates a record. Required reviewed values are station, liters, total amount,
fuel type, fuel date, and odometer. The server derives the driver, vehicle,
and eligible active/recent trip from the authenticated driver identity.

Fuel-record states: `Draft`, `Submitted`, `Verified`, `Flagged`, `Rejected`.
OCR output is assistive only; it must not auto-submit a receipt.

## API work required before production mobile data

- Replace the broad `requireAuth` default with per-endpoint role and ownership
  authorization.
- Establish mobile-compatible token authentication shared by web and mobile.
- Add a `guests` identity table and link each reservation to its guest.
- Add an authenticated driver fuel endpoint that validates vehicle/trip
  ownership, odometer progression, and duplicate receipt signals.
- Store receipt files in private storage and issue signed URLs only to the
  record owner or authorized operations users.
