---
type: feature
status: working
tags: [feature, assignments, drivers, vehicles]
source:
  - src/app/(dashboard)/fleet/assignments/page.js
  - src/app/api/driver-assignments
  - src/app/api/substitute-driver-schedules
last_verified: 2026-10-02
related: ["[[Driver Management]]", "[[Fleet And Vehicles]]", "[[Dispatch]]"]
---

# Feature: Driver Assignments

## What it does

Centralized management module for two related concerns:

1. **Custodial pairings** (`driver_vehicle_assignments`, migration 020) — who is *normally* responsible for a vehicle (fuel, cleanliness, damage accountability). Deliberately NOT a double-booking guard: dispatch-time conflicts are caught by `evaluateRequestConflicts`.
2. **Substitute schedules** (`substitute_vehicle_schedules`, migration 040) — temporary driver coverage so a vehicle whose custodian is suspended/unavailable stays recommendable.

## The page — ENHANCED 2026-08-26

`/fleet/assignments` ("Driver Assignments", Fleet Operations group, admin + fleet_manager sidebars):

- **Tactical KPI Metrics Ribbon**:
  - *Active Custodial Pairings*: Real-time count of active pairings with custody responsibility overview.
  - *Fleet Custody Coverage*: Percentage of fleet vehicles assigned to designated custodians.
  - *Active Substitutes*: Live count of drivers currently covering vehicles today.
  - *Unassigned Fleet Units*: Interactive card jumping directly to the Matchmaking Assistant.
- **Multi-Tab Operational Workspace**:
  - **Overview (Dual Hub)**: Consolidated high-density view of both Custodial Pairings and Substitute Coverage in double-bezel cards.
  - **Custodial Pairings Tab**: High-density table with avatar chips, plate badges, status pills, assignment duration, notes, and release custody action.
  - **Substitute Coverage Tab**: Dedicated table with coverage timeline pills (Active Today, Upcoming, Expired, Open-Ended ∞), Edit modal, and Remove action.
  - **Matchmaking Assistant Tab**: Matchmaker studio displaying unassigned fleet units side-by-side with available unassigned drivers, complete with 1-click "Pair Selected" workflow.
- **Intelligent Pairing Studio** (`AssignDriverDialog`):
  - Rich driver selector (shows current assigned vehicle if held).
  - Rich vehicle selector (shows current driver if held).
  - **Proactive Displacement Detection**: Visual alert and live pairing preview before submitting.
  - Quick note presets ("Regular swap", "Permanent assignment").
  - 409 requires_force fallback confirmation.
- **Enhanced Substitute Scheduler** (`ScheduleDialog`):
  - Quick date presets ("Open-Ended", "7 Days", "30 Days").
  - Driver availability filtering.

Roles: write = system_admin/admin/fleet_manager; dispatcher & management get read-only view (sidebar hidden for them; reachable via command palette or URL).

## Detail pages became view-only — 2026-08-23

The embedded cards on `fleet/vehicles/[id]` (AssignedVehicleCard + SubstituteDriverCard) and `drivers/[id]` (AssignedVehicleCard) now render with `canManage={false}` — pairing/substitute management happens only in `/fleet/assignments`. Vehicle detail keeps a "Manage assignments →" link.

## Files involved

| Piece | Where |
|---|---|
| Page | `src/app/(dashboard)/fleet/assignments/page.js` |
| APIs | `/api/driver-assignments` (+ `[id]` DELETE), `/api/substitute-driver-schedules` (+ `[id]` PATCH/DELETE) |
| Services | `driver-assignment.service.js`, `substitute-driver.service.js` |
| View-only cards | `components/drivers/assigned-vehicle-card.jsx`, `components/drivers/substitute-driver-card.jsx` |
| Nav | `workspaces.js` · `command-palette.jsx` · `permissions.js` NAV_ROLES |

## Invariants worth remembering

- One active custodial pairing per driver AND per vehicle — enforced by partial unique indexes (`uq_dva_active_*`), not app code.
- One open-ended substitute per vehicle (`uq_sub_open_vehicle`); bounded-vs-bounded overlaps are caught by an app-layer guard on POST.
- Substitute picker only lists drivers with **no** assigned vehicle (`getDrivers({ status: "Available", unassigned: 1 })`).
- PATCH quirk: omitting `effective_until` KEEPS the stored end date (cannot clear to open-ended via edit).

## Route test fixture correction — 2026-10-05

The eligible POST pairing test previously returned a false 500: its `db.query` mock returned an empty result for **every** `FROM driver_vehicle_assignments` query, including the route's post-insert read by `assignment_id`. The route then attempted to serialize the missing `created[0]`. The mock now distinguishes that read from the pre-insert active-pairing lookup and returns a representative created row. The test asserts the 201 response includes the new pairing and omits `license_number`; the expired-license and insufficient-class rejection tests remain intact. No endpoint or eligibility behavior changed. Verified by reproducing the failure before the fixture correction and passing all three focused route tests afterward.

## License warning accuracy — 2026-10-02

The pairing and substitute tables calculate eligibility in the browser from redacted API rows. Their list endpoints, the substitute item endpoint, and the driver picker omit the full license number. They now return `license_number_present` alongside `license_number_valid`; the shared eligibility evaluator uses those flags only when the number itself is absent. This distinguishes a missing number from a malformed one without sending the credential to the browser. Assignment and substitute writes still evaluate the full stored driver row on the server. Other blockers (type, class, expiry, staff review, vehicle required class) are independent.

Focused eligibility and assignment-route tests passed 18/18; changed-source ESLint passed. A read-only query to the configured database returned no rows for the assignment IDs in the reported screenshot, so the stored values for that screenshot could not be confirmed here. No database records or migration changed.

## Related

[[Driver Management]] · [[Fleet And Vehicles]] · [[Dispatch]] · [[Feature Index]]

## Fleet Manager live-use remediation - 2026-10-03

Fleet custody coverage counts distinct vehicles with an open-ended assignment, intersected with the non-deleted, non-decommissioned fleet used as the denominator. The card shows the assigned/total count and percentage; zero active vehicles displays an em dash. Decommissioned and deleted vehicles are excluded from the matching unassigned-vehicle count. Substitute schedule date checks use the Asia/Manila calendar day. This changes presentation only and does not modify pairing rows.
