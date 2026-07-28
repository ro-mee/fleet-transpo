# Code Review: Dispatch Service & API Route

**Reviewer:** Senior Technical Lead (nextjs-technical-lead skill)
**Date:** 2026-07-28
**Scope:** `src/services/dispatch.service.js`, `src/app/api/dispatch/route.js` (MIA), `src/app/(dashboard)/dispatch/page.js`, `src/app/(dashboard)/dispatch/[id]/page.js`, `src/app/(dashboard)/reservations/[id]/page.js`, `supabase/migrations/001_schema.sql`, `supabase/migrations/002_rls_policies.sql`, `supabase/migrations/003_notification_triggers.sql`

---

## 0. EXECUTIVE SUMMARY

This review covers the dispatch domain — service layer, client consumption, database schema, RLS policies, and notification triggers. The dispatch service is used by three client components: a kanban dispatch board, a dispatch detail page, and the reservation detail page (where dispatches are created). There is **no server-side API route** — all operations execute client-side via the browser Supabase client.

**Severity distribution of findings:**

| Severity | Count |
|----------|-------|
| Critical | 5 |
| High     | 7 |
| Medium   | 6 |
| Low      | 4 |

---

## 1. BUSINESS LOGIC REVIEW

### 1.1 State Machine: No Dispatch Status Validation (Critical Bug)

`dispatchschedules.status` is defined as `VARCHAR(50) DEFAULT 'Pending'` in `001_schema.sql:253`. There is:

- **No CHECK constraint** on the column
- **No trigger-based guard** for valid transitions
- **No application-level validation** in `updateDispatchStatus(id, status)` (`dispatch.service.js:73-83`)
- **No whitelist** of allowed values anywhere

This means any mutation can set status to any string — `"Flying"`, `"Cancelled"`, `"Deleted"`, empty string, or `null` (if the NOT NULL constraint is removed later). The status field is a free-text field with no enforcement.

The kanban board in `dispatch/page.js:34-38` encodes an implicit state machine:

```
Pending → Approved → Dispatched → In Progress → Completed
```

But `In Progress` in the UI groups three statuses (`dispatched.service.js:34`):

```
"In Progress" || "Driver Accepted" || "En Route"
```

This means the *actual* state machine has at least 7 states:

```
Pending → Approved → Dispatched → (Driver Accepted | En Route | In Progress) → Completed
```

But the service doesn't validate any of these transitions. A dispatch could go from `Pending` directly to `Completed`, or from `Dispatched` back to `Pending`. The kanban "Move forward" button only suggests the *next* status, but nothing prevents a direct API call from setting an invalid state.

**Fix:** Define the valid state machine explicitly:
1. Add a CHECK constraint or Enum type in the database
2. Add application-level validation in `updateDispatchStatus()` that rejects invalid transitions
3. Sync the data model with the UI state machine

### 1.2 Dispatch Created at "Dispatched" Status, Skipping Flow (Critical Bug)

In `reservations/[id]/page.js:114`, the `createDispatch` call sets `status: "Dispatched"` directly:

```js
return createDispatch({
  reservation_id: reservationId,
  vehicle_id: reservation.vehicle_id,
  driver_id: reservation.driver_id,
  dispatch_number: dispatchNumber,
  scheduled_departure: `${reservation.reservation_date}T${reservation.pickup_time}`,
  status: "Dispatched",           // <-- skips Pending → Approved
});
```

This violates the state machine. The dispatch is created at the **third** state (`Dispatched`), completely skipping `Pending` and `Approved`. This means:
- The kanban board will show it under the "Dispatched" column immediately
- No dispatcher ever reviews it
- The approval workflow is bypassed
- The `getNextStatus()` logic in the kanban board will move it to "In Progress" next, which may be incorrect if it needs human approval first

**Fix:** The dispatch creation should set `status: "Pending"` (or whatever the default is). Then the dispatcher uses the kanban board to advance it through the proper workflow. If reservations should auto-skip to "Dispatched", then the state machine definition needs to be updated to reflect that — but that's a business decision that should be explicit, not an implicit hardcode.

### 1.3 Fire-and-Forget Reservation Status Update (Critical Bug)

At `reservations/[id]/page.js:117-118`:

```js
onSuccess: () => {
  updateReservation(reservationId, { status: "Dispatched" }); // NOT AWAITED
  queryClient.invalidateQueries({ ... });
}
```

The `updateReservation` call is **not awaited** and has **no error handler**. If this update fails (network error, RLS policy violation, constraint violation), the dispatch record already exists but the reservation status remains unchanged. This leaves the system with:

- A dispatch record pointing to a reservation that still shows `"Approved"` or `"Pending"`
- Inconsistent status between the two related entities
- No rollback — the dispatch is orphaned

This is a **data consistency bug** that creates hard-to-detect discrepancies.

**Fix:** There are three approaches:
1. **Move to server** — have a server action that atomically creates the dispatch and updates the reservation in a transaction
2. **Await + rollback** — await the reservation update and manually delete the dispatch if it fails
3. **Database trigger** — use an AFTER INSERT trigger on `dispatchschedules` to update the linked reservation status

Option 1 (server-side transaction) is the most robust.

### 1.4 Driver/Vehicle Status Not Updated on Dispatch (High)

When a dispatch moves to `"Dispatched"` or `"In Progress"`, the associated:
- `vehicles.vehicle_status` should change from `"Available"` to `"In Use"` (or similar)
- `drivers.driver_status` should change from `"Available"` to `"On Trip"` (or similar)

Neither the service nor any client code does this. The database has no trigger for it either. This means:

- A vehicle can be dispatched multiple times simultaneously while still showing `"Available"`
- A driver can be assigned to multiple dispatches while still showing `"Available"`
- The fleet dashboard will show incorrect availability

**Fix:** Add a trigger on `dispatchschedules` that updates `vehicles.vehicle_status` and `drivers.driver_status` when status changes to dispatched/in-progress, and reverts them on completion. Alternatively, handle this in the service layer with explicit calls.

### 1.5 Race Condition: Multiple Dispatches for Same Reservation (High)

The `reservations/[id]/page.js` does a client-side check for an existing dispatch (`dispatchForReservation`), but this is a client-side read-then-write pattern with no locking:

```js
// Line 77-79: read
const dispatchForReservation = dispatches.find(
  (d) => d.reservation_id === reservationId
);
// ... later, if dispatchForReservation is undefined, the "Create Dispatch" button
// calls createDispatch() — but between the read and write, another tab/session
// could have already created one.
```

The `reservation_id` column in `dispatchschedules` does NOT have a UNIQUE constraint. So two people clicking "Create Dispatch" simultaneously would create two dispatch records for the same reservation.

**Fix:** Either:
1. Add a UNIQUE constraint on `dispatchschedules.reservation_id`
2. Use an upsert pattern (INSERT ... ON CONFLICT)
3. Use a server-side check within a transaction

### 1.6 Notifications Skip When driver_id Is Null (Medium)

The `notify_dispatch_created()` trigger in `003_notification_triggers.sql:44-61` runs AFTER INSERT on `dispatchschedules`:

```sql
INSERT INTO notifications (employee_id, ...)
SELECT d.employee_id, ...
FROM drivers dr JOIN employees d ON dr.employee_id = d.employee_id
WHERE dr.driver_id = NEW.driver_id;
```

If `NEW.driver_id` IS NULL (unassigned dispatch), the subquery returns zero rows and no notification is created. This means dispatchers don't get notified when a dispatch is created without a driver assigned. The notification is silently skipped.

**Fix:** The trigger should handle the null case — either skip silently (documented behavior) or notify someone else (e.g., all fleet managers). At minimum, document that unassigned dispatches produce no notification.

### 1.7 Data Invariant: dispatch_number UNIQUE But No Guarantee (Medium)

`dispatchschedules.dispatch_number` is `UNIQUE NOT NULL` but:
- The `generate_dispatch_number()` trigger is **defined but never created** (no `CREATE TRIGGER` statement in any migration)
- The client generates it using `DSP-YYYYMMDD-RRRR` format (reservation_id as sequence)
- If two dispatches are somehow created for the same reservation (see 1.5), the UNIQUE constraint will catch it — but only on the second INSERT, which will fail with a 23505 error
- There's no retry or fallback if the UNIQUE constraint fails

**Fix:** Either create the trigger to use `dispatch_number_seq`, or add application-level checks. The trigger approach is cleaner — remove the client-side generation entirely and let the DB auto-generate it.

---

## 2. ARCHITECTURE & API REVIEW

### 2.1 No Server-Side Entry Point (Critical)

`src/app/api/dispatch/route.js` does **not exist**. The only API routes in the project are:

```
src/app/api/auth/logout/route.js
src/app/api/auth/callback/route.js
src/app/api/manifest/route.js
```

All dispatch operations execute client-side via `@/lib/supabase/client.js` (the browser client with anon key). This means:

- **No server-side validation** — anyone can send any payload
- **No server-side authorization** — RLS is the only gate (bypassable if service_role is ever used)
- **No audit logging** — no server to log mutations
- **No rate limiting** — clients can hammer the DB directly
- **No transformation** — responses are raw Supabase shapes

**Fix:** Create a proper API route hierarchy:

| Method | Path | Handler |
|--------|------|---------|
| GET | `/api/dispatch` | List dispatches (with filters + pagination) |
| GET | `/api/dispatch/[id]` | Get single dispatch |
| POST | `/api/dispatch` | Create dispatch (with reservation status update) |
| PATCH | `/api/dispatch/[id]` | Update dispatch fields |
| PATCH | `/api/dispatch/[id]/status` | Update status (with validation) |

Use `@/lib/supabase/server.js` for all API route handlers.

### 2.2 Client Calls Service Directly (High)

Three page components import from `@/services/dispatch.service.js` directly:

```
src/app/(dashboard)/dispatch/page.js         → getDispatchesByStatus, updateDispatchStatus
src/app/(dashboard)/dispatch/[id]/page.js    → getDispatch
src/app/(dashboard)/reservations/[id]/page.js → getDispatches, createDispatch
```

This couples the client UI directly to the database access layer. If you need to add server-side logic (notifications, validation, audit logging), every caller needs updating.

**Fix:** Introduce a thin API layer. Client components call `/api/dispatch/...`, the API route calls the service. The service should accept the Supabase client as a parameter (dependency injection).

### 2.3 Service Uses Browser Client (High)

`dispatch.service.js` imports from `@/lib/supabase/client.js` which creates a `createBrowserClient`. If this service is ever used in a Server Component (via React Server Components), it will throw because browser client APIs depend on browser globals.

**Fix:** Create a `dispatch.service.server.js` that uses `@/lib/supabase/server.js`, or make the service accept the client as a parameter.

---

## 3. SECURITY REVIEW

### 3.1 No Input Validation on Mutations (Critical)

`createDispatch(dispatch)` and `updateDispatch(id, dispatch)` accept raw objects with zero validation:

```js
// dispatch.service.js:50-58
export async function createDispatch(dispatch) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .insert(dispatch)  // <-- anything goes
    .select()
    .single();
}
```

A compromised client or XSS vector could:
- Set `created_by` to impersonate another user
- Set `priority` to "Critical" for every dispatch
- Inject arbitrary `notes` with XSS payloads
- Set future or past dates without restriction
- Omit required fields (causing a 23502 NOT NULL violation)

**Fix:** Add Zod schemas for `CreateDispatchInput` and `UpdateDispatchInput`. Validate before sending to Supabase.

### 3.2 Over-Reliance on RLS as Sole Gatekeeper (High)

All authorization relies on Supabase RLS policies (`002_rls_policies.sql:169-175`):

```sql
CREATE POLICY "Dispatchers and admin can manage dispatch"
  ON dispatchschedules FOR ALL
  USING (has_role(ARRAY['admin', 'dispatcher', 'fleet_manager', 'system_admin']));
```

While this is a valid Supabase pattern, there are risks:
- An RLS misconfiguration (e.g., a wildcard policy, a dropped policy) would expose all operations
- The `has_role()` function uses SECURITY DEFINER, which means it runs with elevated privileges — any bug in the role resolution could bypass auth
- No per-row ownership checks — dispatchers can modify dispatches from other branches

**Fix:** Add explicit role checks in the service layer for critical mutations. When a server-side API route is created, verify the user's role from the session token.

### 3.3 Audit Logging Is Missing (High)

The database has an `audit_logs` table (`001_schema.sql:771-786`) but the dispatch service never writes to it. All mutations are invisible in the audit trail.

**Fix:** Log every mutation to `audit_logs` — who did what, when, and the before/after state.

### 3.4 Search Input Has No Sanitization (Low)

```js
// dispatch.service.js:12
if (filters.dispatch_number) query = query.ilike("dispatch_number", `%${filters.dispatch_number}%`);
```

Supabase's JS client parameterizes queries, so this is not SQL injection. However, the lack of length/sanitization could cause:
- Very long search strings causing performance issues
- Special LIKE characters (`%`, `_`) causing unexpected matching

**Fix:** Add length limits and strip/escape LIKE wildcards.

---

## 4. PERFORMANCE REVIEW

### 4.1 Over-Fetching with Wildcard Selects (High)

Two different select patterns exist, both over-fetching:

```js
// getDispatches() — line 7
.select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(...),
         vehiclereservations(*), routes(*)")

// getDispatch() — line 43
.select("*, vehicles(*), drivers(*, employees(*)), vehiclereservations(*), routes(*)")
```

- `vehiclereservations(*)` pulls all columns (including JSONB `ai_*_recommendation` fields, lat/lng, etc.)
- `routes(*)` pulls waypoints (JSONB), lat/lng, etc.
- `getDispatch()` uses `*` for vehicles — pulls insurance_expiry, purchase_price, etc. that aren't rendered

This wastes bandwidth and memory, especially on list views that render many cards.

**Fix:** Specify only needed columns. `reservation.service.js` already demonstrates this pattern with a central `reservationSelect` constant.

### 4.2 getDispatchesByStatus() Loads Everything Forever (High)

```js
// dispatch.service.js:21-37
export async function getDispatchesByStatus() {
  ...
  .select("*, vehicles(...), drivers(...)")
  .is("deleted_at", null);
  // NO DATE FILTER
```

This fetches **every non-deleted dispatch** since the beginning of time, then groups client-side. As the dispatch table grows:
- Payload size increases linearly
- Client memory usage grows
- The kanban board's `max-h` scroller becomes unusably slow

The "No dispatches" empty state is also misleading — it means "no dispatches exist at all," not "no dispatches for today."

**Fix:** Add a date filter (e.g., last 30 days by default). Consider using a Supabase RPC with status-based COUNT queries instead of client-side `.filter()`.

### 4.3 No Pagination on List Endpoints (Medium)

`getDispatches()` has no `limit`/`offset`. A table or list view could receive thousands of rows.

**Fix:** Add `query.range(from, to)` and return total count. Implement cursor-based pagination for large datasets.

### 4.4 N+1: Reservation Detail Fetches All Dispatches (High)

In `reservations/[id]/page.js:72-79`:

```js
const { data: dispatches = [] } = useQuery({
  queryKey: ["dispatches"],
  queryFn: () => getDispatches({}),  // Fetches ALL dispatches
});

const dispatchForReservation = dispatches.find(
  (d) => d.reservation_id === reservationId  // Just to find one
);
```

For every reservation detail page view, the app fetches **every dispatch in the system** just to find the one linked to this reservation. If there are 10,000 dispatches, each reservation page downloads 10,000 records to show one dispatch card.

The service doesn't even expose a `getDispatchByReservationId(reservationId)` function.

**Fix:** Either:
1. Add a `getDispatchByReservationId(reservationId)` function that filters server-side
2. Use Supabase's `select` with an inner join in the reservation query
3. Use the existing `reservation.dispatchschedules` relation (the `getReservation()` query already includes `dispatchschedules(*)`)

### 4.5 Multiple Supabase Client Instances (Low)

Every function in `dispatch.service.js` calls `createClient()` independently. This creates 6 Supabase client instances per page load (one per exported function call). While the client is lightweight, this is unnecessary overhead and makes testing harder.

**Fix:** Accept the Supabase client as a parameter (dependency injection pattern).

---

## 5. ERROR HANDLING REVIEW

### 5.1 Raw Error Propagation (Medium)

All functions throw raw Supabase errors:

```js
// dispatch.service.js:17
if (error) throw error;
```

The caller receives an opaque error object. A network timeout, RLS policy denial, unique constraint violation, and NOT NULL violation all look the same to the calling code.

**Fix:** Wrap errors with context: `throw new Error("Failed to create dispatch: " + error.message)`. Better: return a standardized `{ success, data, error }` shape.

### 5.2 No Retry or Transient-Failure Handling (Medium)

Read operations (`getDispatches`, `getDispatch`, `getDispatchesByStatus`) are idempotent and safe to retry, but there's no retry logic. A network blip or Supabase throttling (429) will fail the request.

TanStack Query's `useQuery` has built-in retry at the client level, but if the service is ever called outside of TanStack Query (e.g., from a server action), there's no resilience.

**Fix:** Add retry logic to the service layer for read operations.

### 5.3 Null Data Returned Without Guarantee (Low)

`getDispatches()` could return `null` if Supabase returns null. The callers in `reservations/[id]/page.js` handle this with `= []` default, but `dispatch/page.js` uses optional chaining (`dispatchGroups?.[col.id]`). The service itself doesn't guarantee an array.

**Fix:** Return `data || []` in list functions.

---

## 6. CODE QUALITY REVIEW

### 6.1 No TypeScript / No Types (Medium)

The file is `.js` with no type annotations. This means no compile-time checking for:
- Filter shapes passed to `getDispatches()`
- The shape of objects passed to `createDispatch()` and `updateDispatch()`
- The structure of returned data
- Whether required fields are present

**Fix:** Rename to `.ts` and add interfaces for `DispatchFilters`, `CreateDispatchInput`, `UpdateDispatchInput`, `DispatchStatus`, and `Dispatch`.

### 6.2 Duplicate Query Logic (Medium)

`getDispatches()` and `getDispatchesByStatus()` have near-identical query structures:

```js
// Both:
.supabase.from("dispatchschedules").select("...").is("deleted_at", null)
```

Only the joined tables and return format differ. This is a DRY violation. If a new filter or condition needs adding, it must be updated in both places.

**Fix:** Create a private `buildDispatchQuery(supabase, selectString)` helper.

### 6.3 Inconsistent Select Specificity (Medium)

Same tables are queried with different column specificity in different functions. `getDispatches()` uses specific columns for vehicles/drivers but `*` for reservations/routes. `getDispatch()` uses `*` everywhere.

**Fix:** Centralize select strings into named constants (as `reservation.service.js` does with `reservationSelect`).

### 6.4 No getDispatchByReservationId Function (Low)

The only way to find a dispatch for a reservation is to fetch ALL dispatches and filter client-side (see 4.4). The service should expose a dedicated lookup function.

### 6.5 Service File Name Inconsistency (Low)

The file is named `dispatch.service.js` but other services follow the pattern `*.service.js` (e.g., `trip.service.js`, `driver.service.js`). Wait — looking again, it IS `dispatch.service.js`. The user asked for `dispatch-service.js` (with a hyphen). The actual file is `dispatch.service.js` (with a dot). No issue here, just noting the user's path request had a different naming convention.

---

## 7. MISSING API ROUTE: Spec

Since `src/app/api/dispatch/route.js` doesn't exist, here's what it should contain:

### Route Handlers

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dispatch` | List dispatches with pagination, filters, search |
| POST | `/api/dispatch` | Create dispatch + update reservation status atomically |

### Requirements

1. **`createServerClient`** — use `@/lib/supabase/server.js`
2. **Zod schemas** — validate query params (GET) and request body (POST)
3. **Auth check** — verify `auth.getUser()` and check role from session
4. **Standard response shape** — `{ success: boolean, data?: T, error?: string }`
5. **Audit logging** — write to `audit_logs` table
6. **Transactional** — create dispatch AND update reservation in one request

### Additional Route Files Needed

```
src/app/api/dispatch/[id]/route.js     → GET (single), PATCH (update), DELETE (soft)
src/app/api/dispatch/[id]/status/route.js → PATCH (status transition with validation)
```

---

## 8. SUMMARY TABLE

| # | Issue | Severity | Location |
|---|-------|----------|----------|
| 1 | No status validation or CHECK constraint on dispatchschedules | **Critical** | `dispatch.service.js:73-83`, `001_schema.sql:253` |
| 2 | Dispatch created at "Dispatched" skipping Pending/Approved | **Critical** | `reservations/[id]/page.js:114` |
| 3 | Fire-and-forget reservation update on dispatch creation | **Critical** | `reservations/[id]/page.js:118` |
| 4 | No server-side API route for dispatch operations | **Critical** | `src/app/api/dispatch/route.js` (MIA) |
| 5 | No input validation on create/update mutations | **Critical** | `dispatch.service.js:50-83` |
| 6 | Driver/vehicle status not updated when dispatch moves to active | **High** | `dispatch.service.js`, `001_schema.sql` |
| 7 | Race condition on reservation_id (no UNIQUE constraint) | **High** | `reservations/[id]/page.js:77-79`, `001_schema.sql:242` |
| 8 | Reservation detail fetches ALL dispatches to find one | **High** | `reservations/[id]/page.js:72-79` |
| 9 | getDispatchesByStatus loads all records with no date filter | **High** | `dispatch.service.js:21-37` |
| 10 | Over-fetching with wildcard selects | **High** | `dispatch.service.js:7,43` |
| 11 | No audit logging on dispatch mutations | **High** | `dispatch.service.js` |
| 12 | Service creates browser client internally (not injectable) | **High** | `dispatch.service.js:4,22,40,51,62,75` |
| 13 | No pagination on list endpoints | **Medium** | `dispatch.service.js:3-18` |
| 14 | Raw error propagation with no context | **Medium** | `dispatch.service.js:17,28,46,57,68,82` |
| 15 | Duplicate query structure across functions (DRY violation) | **Medium** | `dispatch.service.js:3-18,21-37` |
| 16 | No TypeScript / weak typing | **Medium** | `dispatch.service.js` |
| 17 | Notification trigger silently skips when driver_id is NULL | **Medium** | `003_notification_triggers.sql:44-61` |
| 18 | generate_dispatch_number trigger defined but never created | **Medium** | `001_schema.sql:844-855` (function only, no CREATE TRIGGER) |
| 19 | Null data return not guaranteed as array | **Low** | `dispatch.service.js:18` |
| 20 | No getDispatchByReservationId function | **Low** | `dispatch.service.js` |

---

## 9. PRIORITY ACTION ITEMS

### Critical (Fix Immediately)

1. **Add status validation** — define valid states and transitions. Add a CHECK constraint or Enum in the DB, and validate in `updateDispatchStatus()`.
2. **Fix dispatch creation status** — change `status: "Dispatched"` to `status: "Pending"` in `reservations/[id]/page.js:114`, or document the exception.
3. **Fix fire-and-forget** — make the reservation status update awaited with error handling and rollback logic.
4. **Create API route** — `src/app/api/dispatch/route.js` with Zod validation, server client, and audit logging.
5. **Add Zod validation** — to `createDispatch()` and `updateDispatch()`.

### High (Fix This Sprint)

6. **Add UNIQUE constraint** on `dispatchschedules.reservation_id`.
7. **Update driver/vehicle status** on dispatch status changes.
8. **Add date filter** to `getDispatchesByStatus()`.
9. **Add `getDispatchByReservationId()`** to stop the N+1 on reservation detail pages.
10. **Add audit logging** to all mutation functions.

### Medium (Next Sprint)

11. **Centralize select strings** into constants.
12. **Extract shared query builder** to eliminate duplication.
13. **Add pagination** to `getDispatches()`.
14. **Create the missing trigger** for `generate_dispatch_number()` and remove client-side generation.
15. **Wrap errors** with contextual messages.

### Low (Backlog)

16. **Add retry logic** for read operations.
17. **Guarantee array return** from list functions.
18. **Sanitize search input** for LIKE wildcards.
