# Monday demo data analysis (2026-10-01)

**Reporting follow-up:** The small set below was an initial minimum. The richer Monday target, with about 32 connected requests and date-spread transactions for charts, is in [[Monday Demo Data and Reporting Plan]].

Analysis only. No Supabase rows, storage objects, accounts, or application behavior were changed.

## Read-only baseline

The live database has exactly two active `super_admin` employees (IDs 8 and 74), both with password hashes. It also has 6 role definitions, 22 non-deleted employees, 11 non-deleted drivers, 21 non-deleted vehicles, 24 non-deleted requests, 12 dispatches, and 36 total trip rows (11 non-deleted: 6 completed, 4 cancelled, 1 assigned). There are 143 migration ledger rows, 42,010 barangays, 4 vehicle categories, 11 locations, 19 routes, 6 system-setting rows, and 2 AI-provider rows. The historical totals are much larger (88 employee rows, 62 driver rows, 58 vehicle rows), so raw table counts overstate usable demo resources.

Only 1 non-deleted driver has a recorded staff license review, and only 1 non-deleted vehicle has `required_license_class`. Those fields are dispatch and trip-start gates; a visually full roster is not a ready fleet. `fuelrecords` has 50 total rows but only 1 non-deleted Pending row, so approved fuel analytics would be empty after a reset unless the demo actually completes the fuel review flow.

## Preserve through a proposed reset

- The two exact `super_admin` employee rows and their role definition. Verify both logins afterward. Keep the other role definitions so replacement staff and driver accounts can be created.
- Schema, constraints, triggers, RLS/grants, and `schema_migrations`. This is a data refresh, not a database rebuild.
- Geography (`ph_regions`, `ph_provinces`, `ph_cities`, `ph_barangays`, `phlpost_postal_codes`), and the address/route reference records that the demo will use, or recreate those deliberately before bookings.
- Vehicle categories and service types used by the demo; review the existing 4 categories instead of deleting and recreating identical rows.
- `system_settings` policy and hotel-location keys, plus working AI-provider configuration. Some settings have code defaults, but deleting configured values changes runtime behavior. Do not expose provider secrets in a seed file.
- A backup or export of all current records, audit evidence, and media references before any later deletion decision. Database row deletion and Supabase Storage cleanup are separate operations.

## Small, connected demo set to create later

| Layer | Suggested data | Demo purpose |
| --- | --- | --- |
| People | 1 dispatcher, 1 fleet manager, 1 management viewer, optionally 1 admin, and 4 drivers with controlled login inboxes | Show role access, approval, dispatch, mobile work, and management reports. Existing two super admins remain. |
| Fleet | 4 vehicles, each with a unique active custodial driver pairing; 2+ fully eligible pairs for the same request | Give FleetMate a real choice and leave a spare. Record category, seats, plate, mileage, fuel type, tank/efficiency, valid registration/insurance, and the LTO class from each registration. |
| Driver readiness | For all 4 drivers: Professional B/B1 license as applicable, future expiry, staff review, appropriate work schedule, account access, and Monday pre-shift/duty actions | A row with a license date alone cannot be assigned. Preserve the normal inspection and duty gates. |
| Geography | Hotel base plus 4-6 verified pickup/drop-off locations with real coordinates; 4-6 directional routes with estimates | Make booking resolution, maps, ETA, and navigation coherent. The reverse direction needs its own route. |
| Booking pipeline | About 14-18 synthetic requests total: 8-10 completed historical, 2-3 pending for the queue, 2 future assigned, 1 VIP/urgent, 1 cancelled or rejected | Populate current-period charts and leave a live approval/assignment story. Use matching request, event, dispatch, and trip records rather than isolated rows. |
| Trip evidence | Completed trips with realistic start/end time, distance, odometer and pickup-arrival evidence; one future trip for the Monday mobile run | Driver punctuality is measured only when `at_pickup_at` and scheduled pickup exist; unmeasured trips must stay unmeasured. Live GPS should come from the driver device during the demo. |
| Fuel and service | Monthly fuel budgets for active vehicles; 3-5 approved actual fuel transactions across at least 2 vehicles; 1 pending fuel request; 2 completed maintenance records with costs and 1 separate scheduled repair | Populate Fuel, Maintenance, Financial, and predictive views while leaving an approval/service action to demonstrate. Approved requests alone do not count as fuel consumed. |
| Incident | One resolved synthetic vehicle incident linked to a completed repair, or a live incident exercise on a spare vehicle | Show the incident-to-maintenance relationship without grounding the vehicle needed for the Monday trip. |

Use obviously synthetic guest details and clearly label exported metrics as demo data. Do not insert fabricated GPS fixes, receipt evidence, approval history, notification rows, AI advice, or audit events directly; let the app create those through the normal workflows. No company cards or expense rows are necessary unless that module is in the defense script.

## Suggested order and final checks

1. Back up the existing database and media references; decide precisely which activity records to archive or remove while preserving the foundation above. Foreign keys from trips, dispatches, audit rows, and other records to employees make a blanket `TRUNCATE ... CASCADE` unsafe.
2. Prepare roles/config/reference data, staff and driver accounts, vehicles, licenses/documents, pairings, schedules, locations, and routes.
3. Create requests through intake or the app workflow, then review/approve, assign, run trips, and add fuel, maintenance, and incident examples through their normal transitions.
4. Before Monday, verify both super-admin logins, each demo role, at least two eligible FleetMate pair options, no booking overlap or number-coding block, a working driver mobile login/OTP, one complete request-to-trip chain, and non-empty current-period reports. Keep one future request untouched for the live demonstration.

Sources: `Capstone/02 - Features/{Request Lifecycle,Reservations,Dispatch,Trips,Driver Management,Fleet And Vehicles,Fuel,Maintenance,Incidents,Reports,Routes}.md`, `Capstone/03 - Database/Database Overview.md`, `Capstone/04 - Architecture/{RBAC,Authentication}.md`, `schema.sql`, and read-only live PostgreSQL counts on 2026-10-01. Counts are a snapshot and may change.
