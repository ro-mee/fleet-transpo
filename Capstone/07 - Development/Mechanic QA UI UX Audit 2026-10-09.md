# Mechanic QA and UI/UX Audit — 2026-10-09

## 1. Executive Summary

**Verdict: NOT READY** for a mechanic workflow demo that claims repair evidence can be saved. The role pages load and the work-order filters and notification read action worked, but the repair-evidence save path has a high-severity database parameter error when parts are included. The full assignment-to-history lifecycle was not completed in the browser.

Finding counts: **P0: 0 · P1: 1 · P2: 5 · P3: 0**.

Largest risk: mechanics cannot reliably save parts-replaced evidence. A read-only PostgreSQL parameter probe using the same JavaScript array shape returned error 22P02. The actual browser save request was not submitted, and no work-order data was changed.

One assignment notification for work order #83 was marked read while testing. The interface has no restore-as-unread action. The test account was signed out at the end.

## 2. Mechanic Feature Inventory

| Feature | UI | API | DB | Expected access | Tested | Result |
|---|---|---|---|---|---|---|
| Login and role routing | Login, /mechanic | Auth session | Employees and roles | Mechanic account only | Valid login, route, refresh, logout | PASS |
| Today’s Line dashboard | /mechanic | /api/mechanic/summary and mechanic-scoped maintenance reads | Assigned vehiclemaintenance rows | Read assigned jobs | Loaded in browser | PASS WITH UI ISSUE |
| My Work Orders | /mechanic/work-orders | GET /api/vehicle-maintenance | Assigned maintenance rows | Read own assigned jobs | All, Scheduled, In Progress, Pending Inspection filters | PASS |
| Work-order detail | /mechanic/work-orders/[id] | Scoped GET /api/vehicle-maintenance/[id] exists; page currently calls collection GET | Maintenance row and related vehicle | Read own assigned job | Assigned #81/#82 and unassigned #84 | PARTIAL |
| Repair findings | Detail evidence form | PUT /api/vehicle-maintenance/[id] | Diagnosis, parts_replaced, labor_hours, remarks | Update allowed fields on own assigned job | Read-only form inspection and DB parameter probe | FAIL for parts save |
| Vehicle history | Detail panel | /api/mechanic/vehicle-history | Vehicle maintenance, incidents, inspections | Read permitted history for assigned vehicle | Viewed on #81/#82 | PARTIAL |
| Problem queue | /mechanic/problems | Mechanic-scoped problem API | Problems linked to assigned work | Read-only | Empty state loaded | PASS for empty state |
| History | /mechanic/history | Mechanic-scoped maintenance reads | Own terminal work | Read own history | Empty state loaded | PASS for empty state only |
| Notifications | Header popover | Self-scoped notification read/update routes | Current user notifications | Read and mark own notifications | Marked WO #83 assignment notification read | PASS |
| Incidents and predictive maintenance | Scoped mechanic surfaces/endpoints | Mechanic-scoped reads | Related assigned-vehicle/assignment data | Read permitted related information | Source and authorization inspected; full records unavailable | PARTIAL |

Primary trace: mechanic page → mechanic-scoped summary/maintenance service → permission and assignment checks → vehiclemaintenance; detail evidence → maintenance service PUT → role whitelist, owner check, state-machine transaction → evidence columns. Notifications follow the signed-in employee scope.

## 3. Functional Test Results

| ID | Page/feature | Test | Expected | Actual | Result | Evidence |
|---|---|---|---|---|---|---|
| F-01 | Login | Sign in with supplied local mechanic account | Redirect to mechanic area | Redirected to /mechanic | PASS | Browser |
| F-02 | Session | Navigate between mechanic pages and refresh queue | Session remains valid | Session remained valid; queue loaded after refresh | PASS | Browser |
| F-03 | Dashboard | Review counts and waiting-for-inspection area | Counts and queue labels agree | 4 assigned, 1 urgent, 3 overdue; Waiting for FM shows 2 while the inspection area says nothing is awaiting inspection | FAIL | Browser |
| F-04 | Work orders | Filter all four statuses | Each filter shows matching jobs | All 4; Scheduled 1; In Progress 1; Pending Inspection 2 | PASS | Browser |
| F-05 | Pagination | Move through multiple pages and mutate last-page data | Valid page counts and recovery | Only four records were available; no multi-page case | NOT VERIFIED | Insufficient records |
| F-06 | Detail | Open assigned #81 and #82 | Own work order and evidence display | Both loaded; #82 has saved parts in the source test data but the form shows a blank part row | FAIL | Browser and component state |
| F-07 | Detail access | Open unassigned test ID #84 | No record disclosure | Page displayed “Work order not found” | PASS in UI | Browser; HTTP status not captured |
| F-08 | Dashboard CTA | Click “Start next job” when Up Next is #81 | Start the scheduled next job | Opened #81 detail, whose status is already In Progress; status did not change | FAIL | Browser and route handler |
| F-09 | Evidence persistence | Submit parts evidence and read it back | Successful save and fresh GET | Not submitted in browser because controls were disabled at the available viewport; equivalent array-to-JSONB parameter probe failed with 22P02 | FAIL / API response NOT VERIFIED | Read-only DB parameter probe |
| F-10 | Problem queue | Open page | Scoped records or clear empty state | Clear “0 problems linked” empty state | PASS for empty state | Browser |
| F-11 | History | Open page | Own completed/cancelled work or clear empty state | “0 finished jobs” empty state | PASS for empty state | Browser; no terminal records |
| F-12 | Notifications | Mark assignment notification as read | Own notification becomes read | Read state changed; no restore-as-unread control | PASS | Browser |
| F-13 | Staff-only route | Open /maintenance as mechanic | Access denied/server redirect | Returned to mechanic area | PASS in UI | Browser; HTTP status not captured |
| F-14 | Responsive actions | Inspect detail at available narrow viewport | Explain unavailable actions and keep content usable | Form editing disabled below 1024 px with visible desktop-screen guidance; content wrapped without obvious horizontal overflow | PARTIAL | Browser at approximately 664 px wide |
| F-15 | Logout | Use account menu | End session and return to login | Returned to /login | PASS | Browser |

Invalid password, inactive account, API failure/loading scenarios, multi-page pagination, mutation double-submit, network interruption, and post-write read-back were not executed.

## 4. Permission / Security Results

| Test | Expected | Actual | HTTP status | Result |
|---|---|---|---|---|
| Mechanic collection read | Only assigned maintenance rows | Browser showed the four assigned work orders; route source filters by mechanic employee ID | Not captured | PASS with source review |
| Mechanic single-record read | Own assigned row only | Scoped route checks assignment; unassigned #84 detail showed not found | Not captured | PASS in UI / source |
| Fleet maintenance page | Deny mechanic | Redirected back to mechanic area | Not captured | PASS in UI |
| Create maintenance | Mechanic cannot create arbitrary orders | Permission gate requires maintenance create; mechanic role does not receive it | Not exercised | NOT VERIFIED at runtime |
| Protected fields and assignment edits | Mechanic cannot change cost, vehicle, priority, assignment, archive stamps | Mechanic PUT whitelist strips these fields; ownership check and transactional state rules are present | Not exercised | Source-verified only |
| Completion / self-approval | Mechanic cannot complete or approve own repair | State-machine role restrictions and self-approval guard are present | Not exercised | Source-verified only |
| Delete/archive | Mechanic cannot archive/delete assigned history | No mechanic archive permission; protected field is excluded from mechanic writable fields | Not exercised | Source-verified only |
| Direct API attack cases | Reject other mechanic IDs and forged/protected updates | Browser API client blocked direct API navigation; no crafted requests were sent | N/A | NOT VERIFIED at runtime |
| API auth coverage | Every exported API method has an auth guard | npm run verify:auth: 321/321 guarded, 0 failed | N/A | PASS |
| Database exposure | RLS and grants protect tables/views | npm run db:contract: 77 relations, 76 tables with RLS and one security-invoker view, 0 reported violations | N/A | PASS |

The application and catalog checks support the expected denial rules, but crafted malicious HTTP requests and response codes were not tested. Do not interpret UI hiding as runtime API proof.

## 5. Complete Workflow Result

Assignment → Start → Diagnose → Repair Evidence → Ready for Inspection → Rejection/Approval → History

- ✅ **Assignment:** The account received and displayed an assignment notification for #83. Existing assigned jobs were visible.
- ⚠️ **Start:** “Start next job” only opens #81, which is already In Progress. The Scheduled job Start control was disabled at the available viewport.
- ✅ **Diagnose:** Existing diagnosis is visible and prefilled.
- ❌ **Repair Evidence:** Existing parts evidence is hidden in the form, and the parts payload shape fails the read-only PostgreSQL JSONB parameter probe.
- ❓ **Ready for Inspection:** State transition is defined in the API, but no browser mutation was performed.
- ❓ **Rejection/Approval:** No rejected sample or Fleet Manager session was available; only source-level guards and rejection-reason requirements were reviewed.
- ⚠️ **History:** The empty state works, but no completed mechanic job was available to validate rows or sorting.

The complete lifecycle is not verified end to end.

## 6. CRUD / Capability Matrix

| Resource/action | Create | Read | Update | Delete/archive | Expected? | Working? |
|---|---:|---:|---:|---:|---|---|
| Assigned maintenance | No | Yes | Own status/evidence only | No | Read/update own work | Partial; parts save has P1 defect |
| Arbitrary maintenance order | No | No | No | No | Denied | Source-verified, runtime request NOT VERIFIED |
| Vehicle information | No | Assigned/permitted fields | No | No | Read-only scoped | Partial; only linked history UI tested |
| Incidents/predictive information | No | Mechanic-scoped | No | No | Read-only scoped | Source-verified; broader runtime NOT VERIFIED |
| Problem queue | No | Linked assigned work only | No | No | Read-only | Empty state verified |
| Mechanic history | No | Own terminal work | No | No | Read-only | Empty state verified |
| Own notifications | No | Yes | Mark read | Delete route is self-scoped; not exercised | Read/update own notification | Read action verified; delete NOT VERIFIED |
| Approve/complete own repair | No | N/A | No | No | Denied | Source-verified; direct API NOT VERIFIED |

## 7. Bugs Found

### [P1] Parts evidence is passed to JSONB as a PostgreSQL array parameter

**Location:** src/components/mechanic/mechanic-actions.js; src/app/api/vehicle-maintenance/[id]/route.js

**Steps to reproduce:**

1. Open an assigned In Progress work order on a supported desktop viewport.
2. Add a named part and quantity.
3. Save findings.

**Expected:** The parts list is saved to parts_replaced and appears after a fresh read.

**Actual:** The client builds an array of objects and the route passes it directly as a bound parameter. The PostgreSQL driver encodes JavaScript arrays as PostgreSQL array parameters, not JSON text. A read-only probe using the same array against a JSONB parameter returned 22P02. Browser/API response and row persistence were not submitted or verified.

**Impact:** The core mechanic repair-evidence flow cannot safely save parts.

**Likely cause:** Missing JSON serialization or explicit JSONB parameter casting at the route boundary.

**Recommended fix:** Serialize parts_replaced as JSON at the repository/API boundary or bind it as text and cast to JSONB. Add a regression test using the same real pg value conversion.

### [P2] “Start next job” opens an already-started work order

**Location:** src/app/(dashboard)/mechanic/page.js

**Steps to reproduce:**

1. Open /mechanic with #81 shown as Up Next.
2. Click “Start next job.”
3. Check the destination work-order status.

**Expected:** Start the next Scheduled job or clearly label the action as opening/continuing a job.

**Actual:** It navigates to #81, which is already In Progress, without changing the status.

**Impact:** The mechanic can mistake navigation for a successful state change.

**Likely cause:** The CTA is implemented as a detail-page navigation despite “Start” language.

**Recommended fix:** Use a real start mutation for a Scheduled job, or rename the action to “Open work order”/“Continue work” based on status.

### [P2] Dashboard says work is awaiting inspection and also says none is awaiting

**Location:** src/components/mechanic/job-queue.jsx and mechanic summary mapping

**Steps to reproduce:**

1. Open /mechanic with two Pending Inspection records assigned.
2. Compare the Waiting for FM count with the waiting section text.

**Expected:** Count, status label, and empty-state copy describe the same records.

**Actual:** Waiting for FM count is 2 while the area says “Nothing awaiting inspection.”

**Impact:** Mechanics may misunderstand whether submitted work is still awaiting Fleet Manager review.

**Likely cause:** Count uses waitingApproval, while the queue filters only by a different status key and hard-codes the empty copy.

**Recommended fix:** Map Pending Inspection into the same waiting queue, or rename the count/section so they refer to distinct stages.

### [P2] Previously saved parts are not loaded into the editor

**Location:** src/components/mechanic/work-order-detail.jsx

**Steps to reproduce:**

1. Open assigned work order #82, which has existing parts_replaced data.
2. Inspect the Parts replaced editor.

**Expected:** Saved parts appear in the editable list so the mechanic can confirm or amend them.

**Actual:** The browser shows a blank part name and quantity 1; component state initializes to one blank row instead of workOrder.parts_replaced. Remarks also initialize blank; no nonempty saved remarks case was available.

**Impact:** Existing evidence is hidden and could be lost on a future successful replacement save. This audit did not submit an update, and the current JSONB issue blocks a save.

**Likely cause:** Form state is not initialized from the persisted parts list or remarks.

**Recommended fix:** Map saved evidence into form state on load, preserve it when untouched, and add open-edit-refresh tests.

### [P2] Vehicle history labels the current work order as previous maintenance

**Location:** src/app/api/mechanic/vehicle-history/route.js; src/components/mechanic/vehicle-history.jsx

**Steps to reproduce:**

1. Open assigned #81 or #82.
2. Read the Previous Maintenance list.

**Expected:** Previous Maintenance excludes the work order currently being viewed.

**Actual:** #81/#82 appears in its own Previous Maintenance list as the current In Progress or Pending Inspection record.

**Impact:** The mechanic may mistake the active repair for a separate prior event.

**Likely cause:** The history query includes all vehicle maintenance rows and does not exclude the current maintenance_id.

**Recommended fix:** Pass the current order ID and exclude it, or change the section label to accurately include the current order.

### [P2] Work-order detail fetches the full mechanic collection

**Location:** src/app/(dashboard)/mechanic/work-orders/[id]/page.js; src/services/maintenance.service.js

**Steps to reproduce:**

1. Open any assigned work-order detail page.
2. Inspect the page data query in source.

**Expected:** Fetch the assigned record by ID using the existing scoped single-record endpoint.

**Actual:** The detail page calls getMaintenanceRecords() without parameters, retrieves the complete mechanic-scoped collection, then searches it in the browser. A scoped getMaintenanceRecord(id) service and GET route already exist.

**Impact:** Each detail visit transfers and scans every assigned work order; this grows with mechanic history and can stale or duplicate collection data.

**Likely cause:** Detail page retained the list-query implementation after a scoped item endpoint was added.

**Recommended fix:** Use the scoped single-record service and cache by ID; keep collection queries for the queue only.

## 8. UI/UX Audit

### Keep

- Work-order status is shown in text as well as color.
- Queue filters are easy to find and show the assigned count.
- The mechanic navigation is focused on My Line, My Work Orders, Problem Queue, History, and Profile.
- Diagnosis, parts, and labor fields have visible labels; source includes accessible error/description hooks.
- Notification copy identifies the event and work-order reference.
- Narrow-screen disabled controls explain that a desktop screen is needed.

### Improve

- Correct “Start next job” so its label matches its effect; mechanics need confidence that a repair actually started.
- Make the waiting-for-inspection number and empty state agree.
- Prefill persisted parts and remarks; technicians need to see prior findings before editing.
- Exclude the current job from “Previous Maintenance.”
- Support or clearly scope the minimum viewport for editing. In this browser the form was viewable but every update action was disabled below 1024 px.
- Show failed-save feedback and saved state after a real request. These states were not exercised because editing was unavailable at the observed viewport.

### Remove/Simplify

- No broad interface removal is supported by the evidence. Avoid removing the focused mechanic navigation or visible status labels.

### Add

- Add a concise “Awaiting Fleet Manager inspection” queue row/link when Pending Inspection work exists.
- Show saved parts as rows before editing and preserve them when untouched.
- Add a visible save outcome and last-saved state after evidence persistence is fixed.

These changes reduce uncertainty during real repair handoff and help mechanics distinguish active work from waiting work.

## 9. UI/UX Priority List

1. **Must fix:** Make parts JSONB persistence succeed and prove it with a route/database regression test.
2. **High value:** Load existing parts and remarks into the form; keep saved evidence visible across refresh.
3. **High value:** Align dashboard waiting counts/queue and fix the Start next job wording/action.
4. **Useful polish:** Use the scoped single-record endpoint for detail, then remove the current order from Previous Maintenance.
5. **Useful polish:** Define and validate the supported mechanic editing viewport; the current page blocks editing below 1024 px.

## 10. Performance / Network Findings

- Work-order detail calls the unpaginated collection endpoint and finds one record client-side even though a scoped single-record GET exists. This is unnecessary payload and an O(number of assigned records) client scan per detail visit.
- Vehicle history is a separate query from the work-order read; a detail visit therefore needs multiple resource reads. Whether they are redundant depends on the vehicle-history panel.
- Browser network traces, request sizes, polling, query timing, and server errors were not available in the current browser controls. No N+1 or excessive-rerender finding is claimed.
- npm run db:status: 155 applied, 0 pending, 0 changed since applied at audit time. It lists three ledger-only pre-renumbering names; the current files are present at 114/115/116 as documented in the repository instructions. npm run db:contract: 77 relations checked, 0 reported violations. No migration was applied.

## 11. Accessibility Findings

- **Keyboard:** Account menu could be reached and opened by keyboard; logout returned to login.
- **Labels:** Diagnosis, part name, quantity, labor, and handover note have visible labels in the inspected form.
- **Errors:** Diagnosis has source-level invalid/error associations. Error-state behavior was not triggered.
- **Screen reader:** Browser accessibility tree exposed page headings, status text, field names, button disabled reasons, and notification controls.
- **Target sizes:** Component styles provide workshop-sized controls; exact 44-pixel hit areas were not measured in the browser.
- **Focus:** Keyboard navigation reached the account menu. Validation focus and post-save focus behavior were not tested.
- **Contrast:** NOT VERIFIED; no contrast measurement was run.
- **Responsive:** Available in-app viewport was approximately 664 px wide. Text wrapped without obvious horizontal scrolling, but all work-order mutation controls were disabled with guidance below 1024 px. Other widths and touch behavior are NOT VERIFIED.

## 12. Missing Automated Tests

Recommended additions:

- src/app/api/vehicle-maintenance/[id]/route.test.js: use the real PostgreSQL parameter conversion path for a JSONB parts array; verify successful save and fresh GET.
- src/components/mechanic/work-order-detail.test.js: saved parts and remarks prefill, untouched data preservation, editing after refresh, max lengths and error copy.
- src/app/(dashboard)/mechanic/page.test.js or mechanic dashboard tests: CTA routes/mutates correctly for Scheduled vs In Progress and waiting counts match queue contents.
- src/app/api/mechanic/vehicle-history/route.test.js: excludes current work order from Previous Maintenance while retaining prior rows.
- Detail page tests: call scoped GET-by-ID, handle forbidden/nonexistent/stale IDs, and avoid collection-fetch behavior.
- Permission/API tests: mechanic cannot create, change protected fields, modify another assignee, archive, self-approve, or forge timestamps; assert actual status and response body.
- Persistence integration tests: save, fresh read, refresh UI, and verify state/counts for each allowed transition.
- Notification tests: mechanic scope, assignment links, duplicate fan-out prevention, read/delete policy.
- Browser tests at phone/tablet/desktop sizes: loading/failure states, keyboard focus, disabled help, and enabled mutation workflow.

Existing automated verification: npm run verify:auth passed 321/321 exported API methods guarded. The mechanic-focused Vitest run could not reach assertions: worker startup failed with Windows EPERM resolving a Vitest dependency across the OneDrive workspace, including alternate worker settings. Treat those tests as NOT VERIFIED, not passing.

## 13. Final Recommendation

**Is the mechanic role ready?** Not ready for a complete repair-evidence demo until the parts save path is corrected. Read-only views, status filters, notification read, login, and logout were verified.

**What is actually broken?** Parts JSONB parameter encoding, the misleading Start next job CTA, the waiting-count/empty-state mismatch, missing saved parts in the editor, current job shown as previous maintenance, and the unnecessary collection fetch on detail.

**What only needs UI improvement?** Queue terminology and Start CTA wording/action matching, saved-evidence visibility, the current-job history label/filter, and a clear supported editing viewport.

**What should not be changed?** Keep assignment scoping, read-only related resources, protected-field stripping, role-specific transitions, manager-only approval, and no mechanic create/archive permissions. These are expected RBAC boundaries, not CRUD gaps.

**What should be fixed first?** Parts JSONB persistence, with an integration regression test.

**Implementation order:**

1. Fix parts JSONB binding and add a regression test.
2. Prefill/preserve saved evidence and verify it after refresh.
3. Align dashboard counts, waiting queue, and Start CTA behavior.
4. Switch detail to scoped GET-by-ID.
5. Exclude the active order from Previous Maintenance and recheck narrow/desktop behavior.
6. Run direct API denial cases with response-code assertions, then complete an authorized seeded-job lifecycle with fresh-read persistence checks.

## Verification and limits

- Browser login, role routing, navigation, refresh, filters, unassigned detail message, notification read, and logout were observed.
- No work-order mutation, destructive action, test-data creation, direct malicious API call, production write, migration, or code fix was performed.
- Read-only PostgreSQL parameter conversion check reproduced error 22P02 for the parts array shape.
- npm run db:status, npm run db:contract, and npm run verify:auth were read-only checks. The mechanic Vitest worker error prevented test assertions.
- The browser console/network panel and wide viewport override were unavailable, so exact HTTP statuses, network timings, and full responsive matrix are NOT VERIFIED.
- The assignment notification for work order #83 was marked read as part of the UI check; the app offered no mark-unread action.
