# Monday demo data and reporting plan

**Prepared:** 2026-10-01. **Target:** Monday, 2026-10-05 (Asia/Manila). **Status:** plan only; no Supabase data or app behavior changed.

## Goal and approach

Populate the default Analytics **30 Days** view and Reports **This Month** view with varied, consistent data, while keeping one booking untouched for a live walkthrough. Use clearly labeled synthetic activity; use checked driver licenses and vehicle records for any real assignment or driving.

**Recommended: selective refresh.** Back up current records, preserve both active Super Admin accounts and the reference/configuration data, then prepare one connected demo set. An overlay of new rows is faster but leaves old test activity in totals. A whole-database rebuild risks login, migrations, geography, policies, and media references. The 2026-10-01 read-only check found only one current driver with a staff license review and one current vehicle with a required LTO class; that readiness gap matters more than row volume. See [[Monday Demo Data Analysis]].

## Target records

| Area | Target | Why |
| --- | ---: | --- |
| Accounts | Preserve 2 Super Admins; prepare 1 dispatcher, 1 fleet manager, 1 management viewer, and 4 drivers | Controlled inboxes must receive OTP. Add a separate Admin only if its role will be shown. |
| Fleet | 4 current driver/vehicle pairs | Each needs checked Professional license type/class/expiry and staff review, plus recorded vehicle LTO class, valid documents, seating, category, mileage, and schedule. At least 2 pairs must be free for the same Monday request. |
| Places | Keep 4 existing categories; use at least 3. Hotel plus 4-6 verified locations and 4-6 directional routes | Gives useful category comparisons, routing, maps, and ETA. Reverse journeys need their own routes. |
| Requests | About 32 unique, labeled synthetic bookings | 18 completed, 2 assigned for the future, 6 pending, 3 approved but unassigned, and 3 cancelled/rejected. Mix airport, restaurant, group, and VIP cases where supported. |
| Trips | 18 completed, linked to the 18 requests and their dispatches | Spread 10 over late September and 8 over October 1-4 across all four vehicles/drivers. Record coherent scheduled pickup, start/end, distance, and increasing odometers. |
| Punctuality | About 15 measured trips | For example, 12 on time within the 5-minute grace, 3 late, and 3 honestly unmeasured. Measurement requires `at_pickup_at`, a scheduled pickup, and no override. Do not invent GPS/pickup evidence for a real trip. |
| Fuel | 6 Approved fuel transactions: 3 in September, 3 in October; October budgets; 1 pending fuel **request** | Put fuel on at least 3 vehicles/categories. A vehicle needs at least 50 km of completed-trip distance and eligible fuel volume for the estimated efficiency metric. Do not create a pending fuel *record*: the current Financial/Fleet Cost reports still count its amount. |
| Maintenance | 4 completed records with recorded demo costs across the two months; 1 future scheduled record with zero incurred cost | Use at least two service types and realistic next-service dates/mileages. Keep the Monday candidate vehicles eligible. |
| Incident | 1 resolved historical vehicle incident linked to its completed repair | Shows the incident-to-maintenance relationship without grounding a Monday demo vehicle. |

These are presentation targets, not numbers to hard-code. Company cards and expenses can stay empty unless those screens are in the defense script. Do not directly plant AI conclusions, notifications, audit events, receipts, GPS trails, or a false license attestation. Use normal workflow paths where possible, and identify controlled historical fixtures as synthetic.

## Report data map

| Screen | What the current code reads | Data check |
| --- | --- | --- |
| Pickup trend/calendar | Request `created_at`; calendar shows the current month | Spread creation dates over late September and October 1-4. A single insert day would make a misleading spike even if pickup dates vary. |
| Fleet | Trip `start_time`, distance and vehicle; current `vehicle_status` for in-use rate | Link every trip to its vehicle. Completed history should not mark a vehicle In Use today. |
| Driver performance | Completed trip `end_time`, `at_pickup_at`, scheduled pickup | Reconcile measured, on-time, late and unmeasured counts. |
| Fuel | Approved or legacy Completed `fuelrecords` dated by `fuel_date`, plus completed-trip distance | Fuel budgets/requests alone cannot populate the chart. Show both September and October and multiple categories. |
| Maintenance and prediction | Maintenance `maintenance_date`, cost/status; vehicle next-service fields and recent trips | Set scheduled service cost to zero until incurred. Avoid an active repair on the live demo pair. |
| Financial/Fleet Cost | Fuel amounts, maintenance costs and trip distance in the date window | Reconcile all three sources. These reports currently count fuel-record amounts regardless of approval status, so use only Approved fuel records. |

On Monday, **This Month** includes October 1-4 history and **30 Days** includes September plus October. The Today preset may remain empty until a live Monday trip; do not open the demo there.

## Schedule

1. **Thu Oct 1 — freeze the story and protect data.** Agree on screens and accounts. Back up database and media references. Prepare the exact preserve list for both Super Admins, roles, migration ledger, geography, categories, useful locations, policies, hotel location, and working AI provider configuration. Inventory foreign-key and audit dependencies before any later deletion.
2. **Fri Oct 2 — master data.** After a separate execution decision, clear only chosen old activity/accounts in dependency order. Prepare four eligible pairs, work schedules, categories, locations, and routes. Confirm two options for one Monday booking, including number coding and time-window rules. Check the live driver mobile OTP.
3. **Sat Oct 3 — connected activity.** Prepare requests with distributed creation dates, valid event history, dispatches, and trips. Add measured pickup times, approved fuel transactions, completed maintenance, and the resolved incident/repair example. No orphan or contradictory rows.
4. **Sun Oct 4 — report and role rehearsal.** Open Analytics 30 Days and every Reports tab on This Month. Reconcile each headline number to source records, test CSV/Excel exports, check the management view, confirm FleetMate's two choices, and save an accepted backup and screenshots. Leave one request untouched.
5. **Mon Oct 5 — walkthrough.** Start with Analytics 30 Days and Reports This Month; then show request review, FleetMate comparison, dispatch assignment, driver mobile flow, and refreshed operations. Run a real GPS trip only if the driver, route, device, and connectivity are ready. Do not reset data during the presentation.

## Go/no-go checks

- Both preserved Super Admins and all demo roles can sign in; OTP reaches the driver.
- The selected request has at least two eligible driver/vehicle options without overlap, leave, license, document, capacity, maintenance, or UVVRP blockers.
- Analytics 30 Days and all five Reports tabs on This Month are non-empty and match the selected dates. Trip, fuel, maintenance, and financial totals reconcile to underlying records and exports.
- Punctuality includes honest measured/unmeasured counts. Fuel liters/cost reflect Approved transactions. Scheduled maintenance has no incurred cost. Cancelled trips have no invented timestamps.
- The live request remains untouched and a fallback walkthrough using completed records is ready if the mobile network, GPS, or AI narration is unavailable.

## Boundary and sources

This plan authorizes no deletion, seeding, direct data repair, or configuration change. Before any later destructive execution, prepare a reviewable preservation list and reset/seed preview. Leave existing unrelated worktree edits intact.

Checked: `Capstone/02 - Features/{Reports,Fuel,Maintenance,Trips,Request Lifecycle}.md`, [[Monday Demo Data Analysis]], `src/app/(dashboard)/analytics/page.js`, `src/app/(dashboard)/reports/page.js`, `src/lib/reports/{operational-reports,fuel-consumption}.js`, and `src/app/api/ai/predictive-maintenance/route.js`. Report mapping reflects source read on 2026-10-01; the proposed dataset has not been created or tested.
