# Mechanic Role + Workshop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 7th `mechanic` role with a web-only Workshop (Today's Line dashboard, My Work Orders, scoped reads, assignment lifecycle, mechanic notifications) reusing the existing maintenance state machine and four-eyes guard.

**Architecture:** No parallel maintenance system. One migration adds `assigned_mechanic_id` + evidence columns; the PUT handler gains a per-role transition map and field whitelist; reads gain assignee scoping; notifications fan out to the assignee via `resolveNotificationRecipients`; UI reuses `Card/StatCard/HeroHeader/StatusBadge/EmptyState` and theme tokens.

**Tech Stack:** Next.js App Router, `pg` via `@/lib/db`, Tailwind v4 theme tokens (`src/app/globals.css`), lucide-react, vitest, `scripts/migrate.mjs` ledger.

## Global Constraints

- Migrations: run `npm run db:status` first; next number is `143` (140 max on disk; 141/142 ledger-taken, do not reuse). Every migration idempotent (`IF NOT EXISTS`). Apply `npm run db:up`, then `npm run db:dump`, commit `schema.sql` diff. `schema.sql` is generated — never hand-edit. No credentials in scripts; `scripts/load-env.mjs` reads `.env`.
- RLS/PostgREST: no new table in this plan (columns only), but every task touching data ends with `npm run db:contract` + `npm run verify:anon` and records the verdict.
- RBAC: fail closed. Mechanic gets explicit grants only; every other resource denies by omission. `npm run verify:auth` and `npm run db:check` must pass per task.
- UI: Inter only; tokens `var(--bg/sf/br/fg)`, status + `-bg` + `-700` (small text uses `-700` for 4.5:1); `radius-card 16px`, `radius-control 12px`; `shadow-sm/md` only; no raw hex in components; 44px touch targets; focus-visible rings; `cubic-bezier(0.32,0.72,0,1)` 150–300ms, transform/opacity only; `prefers-reduced-motion` respected; no recharts in mechanic views (custom visuals only).
- Notifications: stable titles (never IDs/dates in title — `copy.test.js` enforces); dedupe key `(employee_id, title, reference_type, reference_id)`; best-effort (never fail the PUT on notify failure — `writeAppError` only).
- Tests: targeted `npx vitest run <path>` per task; full `npm run test:run` before handoff.

---

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/143_mechanic_assignment.sql` | `roles` row + `vehiclemaintenance` assignment/evidence columns + index |
| `src/lib/constants.js` | `ROLES.MECHANIC`, `ROLE_IDS.mechanic = 10`, `REGISTRATION_ROLES` entry, `MAINTENANCE_STATUS.PENDING_INSPECTION`, `NOTIFICATION_EVENTS` keys |
| `src/lib/auth/privilege.js` | `ROLE_NAME_BY_ID[10]`, assignable sets, `KNOWN_ROLES` |
| `src/lib/auth/permissions.js` | `KNOWN_ROLES`, `MATRIX.mechanic`, `NAV_ROLES` `/mechanic/*` |
| `src/lib/workspaces.js` | `WORKS.mechanic`, least-privilege `getWorkspace` fallback |
| `src/components/dashboard/dashboard-configs.js` | `mechanic` config |
| `src/app/(dashboard)/dashboard/page.js` | redirect mechanic → `/mechanic` |
| `src/app/api/vehicle-maintenance/route.js` | GET assignee scoping + lean projection for mechanic |
| `src/app/api/vehicle-maintenance/[id]/route.js` | transition map, field whitelist, stamps, Completed-freeze, notify wiring |
| `src/app/api/vehicle-inspections/problems/route.js` | mechanic scoping via linked assigned WO |
| `src/lib/inspections/problem-queue.js` | `opts.assignedMechanicId` filter |
| `src/app/api/mechanic/summary/route.js` (new) | Today's Line payload |
| `src/lib/notifications/copy.js` | 7 mechanic copy functions |
| `src/lib/notifications/target.js` | `MECHANIC_ROUTES` branch |
| `src/lib/notifications/presentation.js` | `mechanic_maintenance` chip (check file first) |
| `src/app/(dashboard)/mechanic/*` (new) | Workshop pages (verify router group placement first) |
| `src/components/mechanic/*` (new) | `shift-strip`, `hero-job-card`, `job-queue`, `side-rail`, `work-order-detail` |

---

### Task 1: Migration 143 — role row + assignment columns

**Files:**
- Create: `supabase/migrations/143_mechanic_assignment.sql`

**Interfaces:**
- Consumes: `roles(role_id, role_name)` (`schema.sql:858`), `vehiclemaintenance` def (`schema.sql:1137`)
- Produces: `roles` row `(10, 'mechanic')`; columns `assigned_mechanic_id, assigned_at, repair_started_at, diagnosis, parts_replaced, labor_hours, rejection_reason`

- [ ] **Step 1: Confirm next number is free**

Run: `npm run db:status`
Expected: `pending 0`, no `143_` file on disk, 141/142 still ledger-taken (skip them).

- [ ] **Step 2: Write the migration**

```sql
-- 143_mechanic_assignment.sql — mechanic assignment + repair evidence. Idempotent.
INSERT INTO roles (role_id, role_name, description)
VALUES (10, 'mechanic', 'Performs assigned vehicle repairs; cannot approve completion.')
ON CONFLICT (role_id) DO NOTHING;

ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS assigned_mechanic_id INT REFERENCES employees(employee_id);
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS repair_started_at TIMESTAMPTZ;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS diagnosis TEXT;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS parts_replaced JSONB DEFAULT '[]'::jsonb;
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS labor_hours NUMERIC(8,2);
ALTER TABLE vehiclemaintenance ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
CREATE INDEX IF NOT EXISTS idx_vm_assigned_mechanic
  ON vehiclemaintenance(assigned_mechanic_id) WHERE deleted_at IS NULL;
```

- [ ] **Step 3: Apply and dump**

Run: `npm run db:up`
Expected: `143_mechanic_assignment.sql` applied, no checksum errors.
Run: `npm run db:dump`
Expected: `schema.sql` diff shows only the new row-affecting DDL (roles is data — verify diff contains the 7 columns + index).

- [ ] **Step 4: Contract + anon gates**

Run: `npm run db:contract` then `npm run verify:anon`
Expected: no new table surface (columns inherit the table posture); record verdicts. If `db:contract` flags new grants, add explicit `REVOKE` to the migration and re-run.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/143_mechanic_assignment.sql schema.sql
git commit -m "feat(db): mechanic role row and work-order assignment columns"
```

---

### Task 2: Auth registry — constants, privilege, permissions, workspace

**Files:**
- Modify: `src/lib/constants.js:4-29`, `src/lib/constants.js:192-197`, `src/lib/constants.js:220-285`
- Modify: `src/lib/auth/privilege.js:17-52`
- Modify: `src/lib/auth/permissions.js:16-25`, `src/lib/auth/permissions.js:27-92`
- Modify: `src/lib/workspaces.js:314-319`, `src/components/dashboard/dashboard-configs.js`, `src/app/(dashboard)/dashboard/page.js:13-18`
- Test: `src/lib/auth/privilege.test.js`, `src/lib/notifications/recipients.test.js`

**Interfaces:**
- Consumes: Task 1 (`mechanic` role row id 10)
- Produces: `ROLES.MECHANIC`, `rolesFor`/`notificationRolesFor` entries, `WORKS.mechanic`, `/mechanic` landing

- [ ] **Step 1: Failing test — mechanic is assignable only by super_admin/admin**

```js
// privilege.test.js — append inside existing describe
expect(canAssignRole("super_admin", ROLE_IDS.mechanic)).toBe(true);
expect(canAssignRole("admin", ROLE_IDS.mechanic)).toBe(true);
expect(canAssignRole("fleet_manager", ROLE_IDS.mechanic)).toBe(false);
```

Run: `npx vitest run src/lib/auth/privilege.test.js`
Expected: FAIL (`ROLE_IDS.mechanic` undefined).

- [ ] **Step 2: Implement registry**

```js
// constants.js
MECHANIC: "mechanic",                    // ROLES
mechanic: 10,                            // ROLE_IDS (5/6/8 are retired — never reuse)
{ id: 10, name: "Mechanic", value: "mechanic" }, // REGISTRATION_ROLES
PENDING_INSPECTION: "Pending Inspection", // MAINTENANCE_STATUS (was missing)
// NOTIFICATION_EVENTS += work_assigned, work_reassigned, work_urgent,
//   work_returned, work_updated, work_ready, work_approved (labels + in_app/push defaults)
```

```js
// privilege.js
[ROLE_IDS.mechanic]: "mechanic",                       // ROLE_NAME_BY_ID
SUPER_ADMIN_ASSIGNABLE += "mechanic"; ADMIN_ASSIGNABLE += "mechanic";
KNOWN_ROLES += "mechanic";                             // fail-closed elsewhere unchanged
```

```js
// permissions.js
KNOWN_ROLES += ROLES.MECHANIC;   // AUTHENTICATED_ROLES (/notifications, /settings/profile) inherits automatically
mechanic: {
  vehicles: { read: true },
  incidents: { read: true, acknowledge: false, resolve: false, route_to_maintenance: false },
  maintenance: { read: true, update: true },   // create/delete absent = false; scope enforced in-route
  predictive_maintenance: { read: true },
  notifications: { read: true, update: true, delete: true },
  device_tokens: { create: true, delete: true },
  search: { read: true },
  employees: { read: true },
  system: { read: false, update: false },
},
// NAV_ROLES += "/mechanic", "/mechanic/work-orders", "/mechanic/problems",
//   "/mechanic/history" — each ["mechanic"]. No other path gains mechanic.
```

```js
// workspaces.js — add WORKS.mechanic (home "/mechanic", accent "warning",
// nav: Overview/My Line; Maintenance: My Work Orders, Problem Queue, History;
// Account: Profile) and replace the fail-open fallback:
export function getWorkspace(role) {
  const normalized = normalizeRoleName(role);
  if (WORKS[normalized]) return WORKS[normalized];
  return { name: "No Access", tagline: "Contact your administrator.",
    accent: "neutral", home: "/settings/profile",
    nav: [{ label: "Account", items: [{ href: "/settings/profile", label: "Profile" }] }] };
}
```

```js
// dashboard/page.js — extend the role redirect:
if (role === "mechanic") router.replace("/mechanic");
// dashboard-configs.js — add mechanic: { layout: ["shift-strip","up-next","queue","side-rail"], queries: ["mechanicSummary"] }
```

- [ ] **Step 3: Recipients test stays green — mechanic NOT in queue-owner broadcast**

```js
// recipients.test.js — append
expect(notificationRolesFor("incidents", "route_to_maintenance").sort()).toEqual(["admin", "fleet_manager"]);
```

Run: `npx vitest run src/lib/auth/privilege.test.js src/lib/notifications/recipients.test.js`
Expected: PASS.

- [ ] **Step 4: Gates**

Run: `npm run verify:auth` then `npm run db:check`
Expected: PASS (mechanic denied on create/delete/operational routes; new NAV keys recognised).

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.js src/lib/auth/privilege.js src/lib/auth/permissions.js src/lib/workspaces.js src/components/dashboard/dashboard-configs.js "src/app/(dashboard)/dashboard/page.js" src/lib/auth/privilege.test.js src/lib/notifications/recipients.test.js
git commit -m "feat(auth): mechanic role registry, matrix, and workspace shell"
```

---

### Task 3: PUT hardening — transitions, field whitelist, stamps, freeze

**Files:**
- Modify: `src/app/api/vehicle-maintenance/[id]/route.js:18-144`
- Test: `src/app/api/vehicle-maintenance/[id]/route.test.js` (append)

**Interfaces:**
- Consumes: Task 1 columns, Task 2 roles
- Produces: enforced mechanic/FM transition maps; server-stamped `assigned_at/repair_started_at/repair_completed_by-at`; Completed-row freeze

- [ ] **Step 1: Failing tests — mechanic cannot skip or complete; cannot touch cost/vehicle**

```js
// mechanic (employeeId 77, assigned to WO 9 which is Scheduled) PUT { status: "Completed" } → 403
// mechanic PUT { status: "Pending Inspection" } from Scheduled (skip) → 409
// mechanic PUT { cost: 9999, vehicle_id: 3 } → 200 but response row keeps old cost/vehicle_id
// FM PUT { cost: 1 } on Completed WO → 409 "Completed maintenance records are read-only."
```

Run: `npx vitest run "src/app/api/vehicle-maintenance/[id]/route.test.js"`
Expected: FAIL (transitions/whitelist do not exist yet).

- [ ] **Step 2: Implement guards (insert after `beforeRow` load, before SET build)**

```js
const MECHANIC_TRANSITIONS = { "Scheduled": ["In Progress"], "In Progress": ["Pending Inspection"] };
const STAFF_TRANSITIONS = {
  "Scheduled": ["In Progress", "Cancelled"], "In Progress": ["Pending Inspection", "Completed"],
  "Pending Inspection": ["Completed", "In Progress"], "Cancelled": [],
};
const MECHANIC_WRITABLE = new Set(["status","description","remarks","mileage_at_service",
  "service_provider","service_center","technician_name","service_center_name","notes",
  "diagnosis","parts_replaced","labor_hours"]);
const isMechanic = normalizeRoleName(session.user.role) === "mechanic";
// ownership: mechanic may touch only own rows
if (isMechanic && beforeRow.assigned_mechanic_id !== Number(session.user.employeeId)) → 403
// strip non-whitelisted fields for mechanic (incl. deleted_at, cost, vehicle_id, priority, next_schedule_*, assigned_mechanic_id)
// transition check against the map for the actor's role → 409 on illegal edge
// Completed freeze: if (beforeStatus === "Completed" && !body.deleted_at) → 409 (archive path keeps existing permission)
// stamps: Scheduled→In Progress sets repair_started_at (once); →Pending Inspection keeps repair_completed_by/at;
//   actor FM/admin setting assigned_mechanic_id also sets assigned_at = NOW() (strip client assigned_at);
//   Pending Inspection→In Progress requires rejection_reason (non-empty) or 400.
```

Keep the existing four-eyes block untouched. Extend the SELECT to include `assigned_mechanic_id`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run "src/app/api/vehicle-maintenance/[id]/route.test.js"`
Expected: PASS, existing 13+ tests unbroken.

- [ ] **Step 4: Gates**

Run: `npm run verify:auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/vehicle-maintenance/[id]/route.js" "src/app/api/vehicle-maintenance/[id]/route.test.js"
git commit -m "feat(maintenance): mechanic transition map, field whitelist, and completed freeze"
```

---

### Task 4: Scoped reads — work orders, problems, summary endpoint

**Files:**
- Modify: `src/app/api/vehicle-maintenance/route.js:111-186`
- Modify: `src/lib/inspections/problem-queue.js`, `src/app/api/vehicle-inspections/problems/route.js:25-37`
- Create: `src/app/api/mechanic/summary/route.js`
- Test: colocated `route.test.js` files

**Interfaces:**
- Consumes: Tasks 1–3
- Produces: mechanic-forced `assigned_mechanic_id = me` filter; lean projection always for mechanic; `GET /api/mechanic/summary` payload `{ counts, upNext, queue, attention, upcoming }`

- [ ] **Step 1: Failing tests**

```js
// GET /api/vehicle-maintenance as mechanic → every row assigned_mechanic_id === me; no row_to_json(v.*) full vehicle payload
// GET /api/vehicle-inspections/problems as mechanic → only problems with a linked WO assigned to me
// GET /api/mechanic/summary as non-mechanic → 403; as mechanic → counts { assigned, inProgress, waitingApproval, urgent, overdue } + upNext
```

Run: `npx vitest run src/app/api/vehicle-maintenance/route.test.js src/app/api/vehicle-inspections/problems/route.test.js`
Expected: FAIL (no scoping; summary route missing).

- [ ] **Step 2: Implement scoping**

```js
// vehicle-maintenance/route.js GET — after requirePermission:
const isMechanic = normalizeRoleName(session.user.role) === "mechanic";
if (isMechanic) { where += ` AND vm.assigned_mechanic_id = $${idx++}`; params.push(session.user.employeeId); }
// mechanic always takes the paginated lean branch (MT_LIST_SELECT + MT_COUNTS_SQL scoped with the same WHERE)
// problem-queue.js — listVehicleProblems({ limit, offset, assignedMechanicId }) adds:
//   AND EXISTS (SELECT 1 FROM vehiclemaintenance vm WHERE vm.source_inspection_id = i.inspection_id
//     AND vm.assigned_mechanic_id = $ AND vm.deleted_at IS NULL)
// summary route — requirePermission(req, "maintenance", "read"); if role !== "mechanic" → 403;
//   counts via FILTER aggregates on assigned rows; upNext = oldest urgent/in-progress assigned row + vehicle plate/name;
//   attention = latest 8 notifications for me; upcoming = predictive rows due ≤14d (read-only passthrough).
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/app/api/vehicle-maintenance/route.test.js src/app/api/vehicle-inspections/problems/route.test.js src/app/api/mechanic/summary/route.test.js`
Expected: PASS.

- [ ] **Step 4: Gates**

Run: `npm run verify:auth`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/vehicle-maintenance/route.js src/lib/inspections/problem-queue.js src/app/api/vehicle-inspections/problems/route.js src/app/api/mechanic/summary/route.js src/app/api/mechanic/summary/route.test.js
git commit -m "feat(mechanic): assignee-scoped reads and Today Line summary endpoint"
```

---

### Task 5: Notifications — copy, targets, wiring

**Files:**
- Modify: `src/lib/notifications/copy.js`, `src/lib/notifications/copy.test.js` (`ALL_CASES`), `src/lib/notifications/target.js:27-58`, `src/lib/notifications/presentation.js` (verify chip map first)
- Modify: `src/app/api/vehicle-maintenance/[id]/route.js` (post-commit fan-out), `src/lib/inspections/maintenance.js:140-203` (assignee extension only if assigned at creation — else skip)
- Test: `src/lib/notifications/copy.test.js`

**Interfaces:**
- Consumes: Tasks 1–4 (`resolveNotificationRecipients`, assignee ids, transition outcomes)
- Produces: 7 stable titles; `MECHANIC_ROUTES`; fan-out on assign/reassign/urgent/return/ready/approve/complete/update

- [ ] **Step 1: Failing test — new copy functions**

```js
// add to ALL_CASES: maintenanceAssigned, maintenanceReassigned, maintenanceUrgent,
// maintenanceReturned, maintenanceUpdated, maintenanceReady, maintenanceApproved — each ({ plate: "ABC 1234" })
```

Run: `npx vitest run src/lib/notifications/copy.test.js`
Expected: FAIL (functions undefined).

- [ ] **Step 2: Implement copy (titles stable, no IDs)**

```js
export function maintenanceAssigned({ plate }) { return { title: "Maintenance Work Assigned",
  message: `Work order for vehicle ${plate || "your assigned vehicle"} was assigned to you. Review the findings and start the repair.`,
  pushBody: `New repair assigned${plate ? `: ${plate}` : ""}.` }; }
// maintenanceReassigned → "Maintenance Reassignment" (distinct title so dedupe does not swallow reassigns)
// maintenanceUrgent → "Urgent Maintenance Assigned"; maintenanceReturned → "Maintenance Returned for Rework"
// maintenanceUpdated → "Assigned Maintenance Updated"; maintenanceReady → "Maintenance Ready for Inspection"
// maintenanceApproved → "Maintenance Work Approved"
```

```js
// target.js
const MECHANIC_ROUTES = {
  maintenance: (id) => `/mechanic/work-orders/${id}`,
  mechanic_maintenance: (id) => `/mechanic/work-orders/${id}`,
  incident: () => `/mechanic/problems`,
  vehicle: (id) => `/mechanic/vehicles/${id}`,
};
if (role === "mechanic") return MECHANIC_ROUTES[type] ? MECHANIC_ROUTES[type](id) : null;
// mechanic-audience rows are written with reference_type "mechanic_maintenance"
// so staff taps keep resolving to /fleet/vehicles/:id.
```

- [ ] **Step 3: Wire fan-out (post-commit, best-effort try/catch + writeAppError)**

| Trigger (in PUT) | Audience | Title |
|---|---|---|
| `assigned_mechanic_id` set/changed | new assignee (+ old on reassign) | Assigned / Reassignment |
| priority → High/Emergency on assigned WO | assignee + `route_to_maintenance` roles | Urgent |
| → Pending Inspection by mechanic | `route_to_maintenance` roles | Ready |
| → In Progress from Pending Inspection (FM, with `rejection_reason`) | assignee | Returned |
| → Completed | assignee | Approved; driver reporter (incident **or** inspection source) via `vehicleRepaired` |
| vehicle/date change or archive on assigned WO | assignee | Updated |

Extend the `[id]/route.js` completion block (currently `source_incident_id`-only) to also resolve the reporter via `source_inspection_id`.

- [ ] **Step 4: Run tests + gates**

Run: `npx vitest run src/lib/notifications/copy.test.js` then `npm run verify:auth`
Expected: PASS / PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/copy.js src/lib/notifications/copy.test.js src/lib/notifications/target.js src/lib/notifications/presentation.js "src/app/api/vehicle-maintenance/[id]/route.js" src/lib/inspections/maintenance.js
git commit -m "feat(notifications): mechanic fan-out on assign, return, ready, and approve"
```

---

### Task 6: Workshop UI — Today's Line + work-order detail (web-only)

**Files:**
- Create: `src/app/(dashboard)/mechanic/page.js` (confirm router group placement — driver lives outside `(dashboard)`; if the shell differs, colocate with the driver pattern), `src/app/(dashboard)/mechanic/work-orders/[id]/page.js`, `src/app/(dashboard)/mechanic/problems/page.js`, `src/app/(dashboard)/mechanic/history/page.js`
- Create: `src/components/mechanic/shift-strip.jsx`, `hero-job-card.jsx`, `job-queue.jsx`, `side-rail.jsx`, `work-order-detail.jsx`
- Reuse only: `Card, StatCard/StatGrid, HeroHeader, PageEntrance, EmptyState, CardSkeleton/StatsGridSkeleton, StatusBadge, Button`

**Interfaces:**
- Consumes: Task 4 summary payload; Task 3 PUT contract
- Produces: web-only Workshop; no mobile patterns (no bottom nav; <1024px read-only stacked fallback)

- [ ] **Step 1: Failing component tests (role-gate + data contract)**

```js
// mechanic page test: renders ShiftStrip + HeroJobCard + JobQueue + SideRail from a canned summary payload;
// work-order detail test: mechanic sees Start/Mark-Ready, never Approve; FM-only fields (cost, assign) absent.
```

Run: `npx vitest run src/components/mechanic`
Expected: FAIL (components missing).

- [ ] **Step 2: Build Today's Line** — ShiftStrip (Scheduled→In Progress→Waiting segments with plate chips), HeroJobCard (priority spine + segmented diagnosis/parts/labor dots + odometer tape + age + Start/Mark-Ready), JobQueue (spine rows, max 4 + view-all), SideRail (vehicle snapshot lean fields, last-3 history timeline, attention feed from Task 5, predictive whisper strip). Problems page read-only with "WO #" chips; history table via `StatusBadge`; detail form visible labels + inline errors + progressive disclosure (diagnosis → parts JSONB editor → labor → submit), sticky action bar ≥1024px.

- [ ] **Step 3: A11y/visual pass** — keyboard nav through queue, 44px targets, `-700` small text, `EmptyState` on zero jobs, skeletons while loading, `prefers-reduced-motion`, 1024/1280/1440 check, dark-mode check.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/mechanic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/mechanic src/components/mechanic
git commit -m "feat(ui): mechanic Workshop with Today Line dashboard"
```

---

### Task 7: Seed, docs, and final gates

**Files:**
- Modify: seed scripts (inspect via `npm run seed:plan` first — add 1 mechanic employee + 3 assigned WOs: Scheduled, In Progress, Pending Inspection), `Capstone/04 - Architecture/RBAC.md`, `Capstone/02 - Features/Maintenance.md`, `Capstone/02 - Features/Notifications.md`, `Capstone/06 - Decisions/Decision Log.md`, `SYSTEM.md` (role list)

**Interfaces:**
- Consumes: Tasks 1–6
- Produces: demo-able Workshop; vault in sync

- [ ] **Step 1: Seed mechanic demo data**

Run: `npm run seed:plan`
Expected: shows current seed sets; add mechanic set per its convention, then `npm run seed:up`.
Verify: sign in as mechanic → Today's Line shows 3 jobs across states.

- [ ] **Step 2: Update vault notes** — RBAC.md (7th role, MATRIX row, NAV keys, hierarchy), Maintenance.md (assignment columns, transition maps, Completed-freeze, return loop), Notifications.md (7 titles + audiences + `mechanic_maintenance` reference type), Decision Log (why web-only, why reassignment gets its own title, why fallback is least-privilege).

- [ ] **Step 3: Final gates (in order)**

Run: `npm run test:run` → PASS; `npm run verify:auth` → PASS; `npm run db:check` → PASS; `npm run db:contract` → record posture; `npm run verify:anon` → no EXPOSED.

- [ ] **Step 4: Commit**

```bash
git add Capstone SYSTEM.md <seed files>
git commit -m "docs(mechanic): seed demo data and sync vault notes"
```

---

## Self-Review

- **Spec coverage:** 7th role + minimal Workshop (Tasks 2, 6) · assignment lifecycle (Tasks 1, 3) · four-eyes preserved + Completed-freeze (Task 3) · scoped reads (Task 4) · 8 notifications (Task 5) · custom non-chart dashboard, web-only (Task 6) · seed/docs/gates (Task 7). Predictive stays read-only widget (no new prediction build). No mechanic mobile (explicit non-goal, enforced by bearer audience + web-only nav).
- **Placeholder scan:** every step names exact files/commands/titles; seed step delegates to `seed:plan` convention (verified to exist) rather than inventing schema.
- **Type consistency:** `assigned_mechanic_id` (INT → employees), `parts_replaced` (JSONB), `labor_hours` (NUMERIC), `MECHANIC_WRITABLE` reused by Task 6 detail form, `mechanic_maintenance` reference typeshared by Tasks 5–6.
