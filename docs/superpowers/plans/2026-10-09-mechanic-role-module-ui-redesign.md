# Mechanic Role Module UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Turn the mechanic workspace into a queue-first, responsive repair workflow with a selected vehicle snapshot and reliable evidence editing.

**Architecture:** Keep the existing mechanic-scoped endpoints and role guards. Use the assigned-work-order list for the filterable queue, the summary endpoint for counts and workspace context, and the existing scoped single-work-order endpoint for detail. Add only `vehicles.image_url` to the vehicle projection used by the mechanic snapshot; keep UI behavior inside existing mechanic components and routes.

**Tech Stack:** Next.js App Router, React, TanStack Query, Tailwind utility classes, existing FleetOps UI components and API routes.

## Global Constraints

- Preserve server-side mechanic assignment checks and existing mechanic status transitions.
- Do not add mechanic create, archive, completion, approval, cost-edit, or staff-assignment controls.
- Return only the existing lean vehicle fields plus `image_url` for the vehicle on an already-scoped assigned work order.
- Do not add a database migration; `vehicles.image_url` already exists.
- Keep FleetOps Inter typography, neutral surfaces and text, semantic status colors, existing spacing and radii, and flat cards.
- Support phones and tablets for work-order edits; do not disable actions only because the viewport is below 1024px.
- Preserve all existing unrelated and in-progress workspace changes; do not stage or commit them.
- Do not add or run automated tests for this task. Verify with source review, `git diff --check`, and a read-only visual review at desktop, tablet, and phone widths.

---

### Task 1: Extend the lean mechanic data for the queue and vehicle snapshot

**Files:**
- Modify: `src/app/api/mechanic/summary/route.js`
- Modify: `src/app/api/vehicle-maintenance/[id]/route.js`

**Interfaces:**
- Summary counts add `scheduled` alongside the existing `assigned`, `inProgress`, and `waitingApproval` counts.
- Summary queue vehicle shape becomes `{ plate_number, vehicle_name, image_url }`.
- Summary queue rows include the existing `description` and `mileage_at_service` fields needed by the selected snapshot.
- Single-work-order `vehicles` projection stays unchanged.

- [x] Add a `scheduled` aggregate using the same `assigned_mechanic_id` and `deleted_at IS NULL` scope as the existing summary counts.
- [x] Accept only `Scheduled`, `In Progress`, or `Pending Inspection` as a queue filter; an absent or unrecognized filter returns all three active mechanic statuses. Keep `upNext` based on the existing actionable Scheduled/In Progress query, independent of the selected filter.
- [x] Add only `v.image_url` to the JSON vehicle projection in the mechanic summary query. Keep all other vehicle columns excluded.
- [x] Correct `parts_replaced` JSONB parameter binding in the existing PUT field loop by serializing only that array as JSON text before passing it to PostgreSQL; keep validation and mechanic field filtering unchanged.
- [x] Inspect the two GET projections and PUT value construction to confirm no full vehicle row or new mechanic write permission was introduced.

Expected result: the queue can show accurate status tabs and a selected snapshot can render the assigned vehicle photo, while mechanic ownership and writable fields stay unchanged.

### Task 2: Make My Line a filterable queue with a selected-work-order snapshot

**Files:**
- Modify: `src/app/(dashboard)/mechanic/page.js`
- Modify: `src/components/mechanic/job-queue.jsx`
- Modify: `src/components/mechanic/side-rail.jsx`
- Reuse: `src/services/maintenance.service.js` (`getMaintenanceRecords` is already exported)

**Interfaces:**
- Queue filters: `All`, `Scheduled`, `In Progress`, and `Pending Inspection`.
- Queue selection: `selectedId` plus `onSelect(job)`; row actions remain separate from row selection.
- Snapshot: receives the selected assigned work order and reads `job.vehicles.image_url` or `job.vehicle.image_url`.

- [x] Query `/api/mechanic/summary` with the selected status filter; return all active mechanic statuses for **All**, and one validated status for each other filter. Keep counts, attention, and upcoming data scoped to the caller as before.
- [x] Render filter buttons with status counts from the same summary response. Show **View all work orders** when the filter count exceeds the ten-row My Line limit.
- [x] Remove the duplicate `HeroJobCard` and `ShiftStrip` from My Line. On desktop and tablet, selecting a row updates the snapshot; on phones, the vehicle/job link opens that order’s detail route.
- [x] Keep actual status changes as explicit row actions and enable them at every viewport width. Replace **Start next job** with a navigation label such as **Open work order** or **Continue work order** that never changes status.
- [x] Redesign the shared queue rows as a compact desktop table and a stacked phone layout, without horizontal page scrolling or nested interactive controls. Keep the same component usable by My Work Orders.
- [x] Omit issue/description text from shared queue rows on My Line and My Work Orders; retain it in the vehicle snapshot and work-order details.
- [x] Add a compact vehicle photo in the selected snapshot. Use the stored URL with descriptive alt text, or a neutral vehicle silhouette with the visible label **Photo unavailable** when the URL is absent or fails to load.
- [x] Keep recent history, attention, and upcoming information as secondary context below the selected vehicle summary; retain their existing read-only behavior.

Expected result: My Line has one clear queue, the selected order appears once, the snapshot follows selection, and the queue works with touch and keyboard input.

### Task 3: Make work-order detail responsive and preserve saved repair evidence

**Files:**
- Modify: `src/app/(dashboard)/mechanic/work-orders/[id]/page.js`
- Modify: `src/components/mechanic/work-order-detail.jsx`
- Reuse: `src/services/maintenance.service.js` (`getMaintenanceRecord`, `getVehicleHistory`, and `updateMaintenanceRecord` are already exported)

**Interfaces:**
- Detail query key: `['mechanicWorkOrder', id]`.
- Evidence payload continues through `buildMechanicUpdateBody` with `parts_replaced` as an array and the existing mechanic field whitelist.
- History passed to `WorkOrderDetail` excludes the current `maintenance_id` from the maintenance list.

- [x] Fetch one work order with `getMaintenanceRecord(id)` instead of loading the mechanic’s full maintenance collection and searching in the browser.
- [x] Present Job type, Scheduled, Odometer at service, and Priority as four equal 2×2 tiles above the repair timeline.
- [x] Use independent desktop columns so Findings & evidence sits directly below the short timeline instead of after the taller neighboring panel; stack columns on phones and tablets.
- [x] Seed diagnosis, parts, labor hours, and handover note from the saved work-order response. Convert saved parts into the `{ name, qty }` editor rows without dropping existing values.
- [x] Show the saved completeness of diagnosis, parts, and labor with visible labels and a recorded count.
- [x] Remove desktop-width gating from diagnosis, parts, labor, save, and state-transition controls. Keep labels, keyboard focus, and at least 44px touch targets.
- [x] Keep local edits in place after a failed save, show the API error beside the form, and show success only after the mutation resolves.
- [x] In the detail page, filter the open maintenance ID from the maintenance-history list before passing it to `WorkOrderDetail`; leave incident and inspection history read-only.
- [x] Keep the back-to-queue action visible and preserve the existing status transition map and API whitelist.
- [x] Use the same responsive cards, columns, 2×2 work-detail tiles, timeline, and evidence-form structure in the loading skeleton and loaded work-order detail.

Expected result: mechanics can review and edit an assigned work order on phones, tablets, and desktop; saved data appears in the form; failed requests do not erase work.

### Task 4: Align the other mechanic pages and update product notes

**Files:**
- Modify: `src/app/(dashboard)/mechanic/work-orders/page.js`
- Modify: `src/app/(dashboard)/mechanic/problems/page.js`
- Modify: `src/app/(dashboard)/mechanic/history/page.js`
- Modify: `Capstone/02 - Features/Maintenance.md`
- Modify: `SYSTEM.md`

- [x] Reuse the responsive queue presentation on My Work Orders and retain its assigned-only filters and pagination.
- [x] Keep Problem Queue read-only while tightening its hierarchy around the reported vehicle, severity, finding, source, and linked work order.
- [x] Replace the 720px minimum-width history table with a responsive layout that keeps the existing Completed/Cancelled data and read-only cost visible without phone page scrolling.
- [x] Update the Maintenance feature note and `SYSTEM.md` with the queue-first snapshot, vehicle photo fallback, responsive editing, scoped detail fetch, and JSONB evidence-save correction.
- [ ] Review the rendered My Line, work-order detail, Problem Queue, and History at 1440px, 768px, and 390px. Confirm there is no horizontal page scroll, labels and status text stay visible, and no mechanic-only forbidden controls appear. The isolated local preview redirects `/mechanic` to `/login`, so authenticated visual review was unavailable.
- [x] Run `git diff --check` and inspect `git status --short`; do not run automated tests or include unrelated files in any commit.

Expected result: mechanic routes share the same calm task-first presentation, stay readable on phones, and the feature note matches the implemented UI and data behavior.
