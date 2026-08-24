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

Post-renewal update flow on the vehicle detail page ("Renew" button in the Philippine LTO Renewal card): new expiry date (+1y default), optional OR/CR number, optional scan upload (base64 data URL, same convention as the vehicle form). One `PUT /api/vehicles/[id]` carries `registration_expiry` + an `OR_CR` document upsert; because that endpoint re-runs `syncVehicleStatus` when `registration_expiry` changes, a grounded vehicle returns to Available automatically. RBAC: `can("vehicles","update")` (admin/system_admin/fleet_manager). Component: `src/components/vehicles/renew-registration-dialog.jsx`.

Still true after this change: there is **no renewal history table** (previous expiry/OR number is overwritten), and a suspended driver's license renewal still has no self-serve update path (staff-only via driver edit). Also fixed 2026-08-23: `fleet/vehicles/new` was sending `issue_date`/`expiration_date` keys the API ignores — Insurance doc rows now correctly receive `expiry_date`.

## Database tables used

`vehicles` (20) · `vehiclecategories` · [[driver_vehicle_assignments]] · `vehicleinspection` **0 rows** · [[dispatchschedules]]

## Related

[[Dispatch]] · [[Maintenance]] · [[Fuel]] · [[UVVRP Number Coding]] · [[Feature Index]]
