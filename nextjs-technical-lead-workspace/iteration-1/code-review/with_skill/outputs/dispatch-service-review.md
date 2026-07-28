# Code Review: Dispatch Service & Missing API Route

**Reviewed by:** Next.js Technical Lead (AI Skill)
**Date:** 2026-07-28
**Scope:** `src/services/dispatch.service.js`, `src/app/api/dispatch/route.js` (not found)

---

## Critical Finding: Missing API Route

The file `src/app/api/dispatch/route.js` **does not exist** in the codebase. There are only three API route files in the project:
- `src/app/api/auth/logout/route.js`
- `src/app/api/auth/callback/route.js`
- `src/app/api/manifest/route.js`

All dispatch operations (`getDispatches`, `getDispatch`, `createDispatch`, `updateDispatch`, `updateDispatchStatus`) are called **directly from client components** via `@/services/dispatch.service.js`, which uses the **browser Supabase client** (`createBrowserClient`). This is a working pattern for client-side Supabase apps with RLS, but it means:

1. There is no server-side API layer for dispatch operations.
2. All mutations run in the user's browser with the anon key.
3. There is no opportunity for server-side validation, audit logging, or orchestration logic (e.g., sending notifications on dispatch creation).

---

## 1. SECURITY ISSUES

### 1.1 No Input Validation (High)

`createDispatch(dispatch)` and `updateDispatch(id, dispatch)` accept raw objects with zero validation. A compromised client or XSS vector could insert arbitrary fields:

```js
// dispatch.service.js:50-58
export async function createDispatch(dispatch) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("dispatchschedules")
    .insert(dispatch)  // <-- no validation
    .select()
    .single();
}
```

**Fix:** Add Zod schemas for every mutation. Validate before sending to Supabase.

### 1.2 No Server-Side Authorization (High)

Authorization relies entirely on Supabase RLS policies. While the RLS policies on `dispatchschedules` look reasonable ("Dispatchers and admin can manage dispatch"), the service itself has **zero auth guards**. If RLS is ever misconfigured or bypassed (e.g., using the admin client in a future refactor), nothing stops unauthorized access.

**Fix:** Add explicit auth checks at the service level for critical operations. Use the server client (`@/lib/supabase/server.js`) when calling from server contexts.

### 1.3 Client-Side Data Mutations (Medium)

Mutations run client-side using the anon key. This exposes the Supabase API URL and anon key to the browser (acceptable by Supabase design with RLS), but it means:
- Any authenticated user can attempt any mutation; RLS is the sole gatekeeper.
- There is no server-side request sanitization, rate limiting, or audit logging for dispatch creation/updates.

**Fix:** Create a proper API route (`src/app/api/dispatch/route.js`) that uses the server client, validates input with Zod, checks authorization explicitly, and logs mutations.

### 1.4 Potential SQL Injection via `ilike` (Low)

```js
// dispatch.service.js:12
if (filters.dispatch_number) query = query.ilike("dispatch_number", `%${filters.dispatch_number}%`);
```

Supabase's JS client parameterizes queries, so this is **not** vulnerable to SQL injection in the traditional sense. However, it's worth noting that no sanitization is applied to filter values, which could cause unexpected behavior with special characters.

**Fix:** Add length limits and character filtering on search inputs.

---

## 2. ARCHITECTURAL ISSUES

### 2.1 No API Route / Server Action Layer (High)

The entire dispatch domain lacks a server-side entry point. This contradicts the Next.js App Router pattern where API routes should handle mutations. Currently:
- Client components import the service directly.
- The browser Supabase client makes queries directly from the client.
- No server-side validation, transformation, or orchestration exists.

**Fix:** Create `src/app/api/dispatch/route.js` with GET (list), POST (create), and PATCH (update) handlers. Move mutation logic behind the API. Use `@/lib/supabase/server.js` instead of the browser client.

### 2.2 Service Uses Browser Client (Medium)

`dispatch.service.js` imports from `@/lib/supabase/client.js` which creates a `createBrowserClient`. This means:
- If the service is ever imported in a Server Component, it will throw an error (browser client APIs like cookies are not available on the server).
- The service is coupled to the browser runtime.

**Fix:** Create a server-side version (`dispatch.service.server.js`) that uses `@/lib/supabase/server.js`, or use dependency injection to pass the Supabase client.

### 2.3 Coupled to Supabase Client Library (Medium)

Every function creates its own Supabase client instance:

```js
// dispatch.service.js:3-4
export async function getDispatches(filters = {}) {
  const supabase = createClient();
```

This means 6 database connections per page load (one per function call). The client is lightweight, but this pattern makes testing difficult and hides the dependency.

**Fix:** Accept the Supabase client as a parameter (dependency injection pattern). This makes the service testable and reusable across server/client contexts.

### 2.4 Dispatch Number Generation Conflict (High Bug)

There is a **logic conflict** between the client code and the database. The database has a trigger:

```sql
CREATE OR REPLACE FUNCTION generate_dispatch_number() ... END;
```

That auto-generates `DSP-YYYYMMDD-NNNN` on INSERT. However, the client code in `reservations/[id]/page.js` also generates a dispatch number:

```js
// reservations/[id]/page.js:107
const dispatchNumber = `DSP-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(reservationId).padStart(4, "0")}`;
```

If the trigger fires *after* the client-provided value is inserted, the trigger overwrites it. If the trigger fires *before*, the trigger's value is overwritten by the client. This is undefined behavior depending on the trigger execution order. The client-generated number and trigger-generated number will also differ in format (client uses reservation ID, trigger uses a sequence).

**Fix:** Pick one strategy. Either remove the client-side generation and let the database trigger handle it, or remove the trigger and generate entirely on the server side. Do not have both.

---

## 3. ERROR HANDLING

### 3.1 Raw Error Propagation (Medium)

All functions throw raw Supabase errors:

```js
// dispatch.service.js:16-17
const { data, error } = await query;
if (error) throw error;
```

The calling code (client components) catches these via TanStack Query's error handling, but the errors are opaque. A network timeout, RLS violation, or constraint error all look the same to the caller.

**Fix:** Wrap errors with contextual information:
```js
if (error) throw new Error(`Failed to fetch dispatches: ${error.message}`);
```

Or better, return a standardized error shape (`{ success, data, error }`).

### 3.2 No Retry or Resilience (Medium)

Transient failures (network blips, Supabase throttling) will crash the request. TanStack Query's `useQuery` has built-in retry, but the service layer itself has no resilience.

**Fix:** Consider adding retry logic in the service for read operations that are idempotent.

### 3.3 getDispatchesByStatus() Masks Individual Failures (Low)

```js
// dispatch.service.js:30-36
return {
  pending: data.filter((d) => d.status === "Pending"),
  ...
};
```

If a single dispatch somehow has a null or unexpected status, it's silently dropped from all groups. Not necessarily a bug, but worth being explicit about.

### 3.4 Fire-and-Forget Update in Reservation Page (High Bug)

In `reservations/[id]/page.js:118`:

```js
onSuccess: () => {
  updateReservation(reservationId, { status: "Dispatched" }); // NOT AWAITED, NO ERROR HANDLING
  ...
}
```

This `updateReservation` call is not awaited and has no `.catch()`. If it fails, the dispatch record is created but the reservation status is never updated, leaving the system in an inconsistent state. This is a **data consistency bug**.

**Fix:** Either make the server handle both operations atomically, or await the update and handle errors (roll back the dispatch if the reservation update fails).

---

## 4. PERFORMANCE ISSUES

### 4.1 Over-Fetching Related Data (High)

```js
// dispatch.service.js:6-7
.select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name)), vehiclereservations(*), routes(*)")
```

- `vehiclereservations(*)` and `routes(*)` pull **all columns** from those tables.
- `getDispatch()` (line 43) uses `*` for all subqueries: `"*, vehicles(*), drivers(*, employees(*)), vehiclereservations(*), routes(*)"`
- This is particularly wasteful for `vehiclereservations` and `routes` which may have many columns (JSONB fields, coordinates, etc.).

**Fix:** Specify only the columns actually needed by the UI:
```js
.select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name)), vehiclereservations(reservation_id, pickup_location, dropoff_location, guest_name), routes(route_id, route_name, origin, destination, estimated_distance)")
```

### 4.2 getDispatchesByStatus() Loads Everything (High)

```js
// dispatch.service.js:21-37
export async function getDispatchesByStatus() {
  ...
  .select("*, vehicles(...), drivers(...)")
  .is("deleted_at", null);
  // NO DATE FILTER — fetches ALL dispatches ever
```

This function fetches **all non-deleted dispatches** regardless of date, then performs client-side grouping. As the dispatch table grows (potentially thousands of records), this will:
- Increase payload size linearly
- Increase client memory usage
- Slow down the kanban board rendering
- Make the "No dispatches" empty state inaccurate (empty means no dispatches exist at all, not just none for today)

**Fix:** Add a date range filter (e.g., last 30 days) in the query, or pass a filter parameter. Alternatively, perform the grouping in PostgreSQL using a status-based COUNT query or window functions.

### 4.3 No Pagination (Medium)

`getDispatches()` has no limit or offset. A list page could receive thousands of rows. The UI currently renders all of them.

**Fix:** Add `query.range(from, to)` and return total count alongside data. Implement cursor-based or offset-based pagination.

### 4.4 Inefficient Select in getDispatchesByStatus() (Medium)

```js
// dispatch.service.js:25-26
.select("*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name))")
```

This is the same select as `getDispatches()` but without `vehiclereservations` and `routes`. The two functions duplicate the query structure. The kanban board (which calls this) doesn't need reservation or route data at the card level, which is correct, but the function is named confusingly — it groups but also fetches.

### 4.5 No React Cache / Server Cache (Low)

The service doesn't use React's `cache()` function or Supabase's built-in caching. Every call to `getDispatches()` with the same filters creates a fresh network request.

**Fix:** For Server Components (when created), wrap service calls with `React.cache()`. For client queries, TanStack Query handles caching already.

---

## 5. CODE QUALITY ISSUES

### 5.1 No TypeScript (High)

The file is `.js` with no type annotations. The rest of the project also uses `.js`, but the skill's convention is TypeScript strict mode. This means:
- No compile-time checking of filter shapes, return types, or parameter validation.
- No IDE autocompletion for database column names.
- Easy to pass wrong filter keys or miss required fields.

**Fix:** Rename to `.ts` and add interfaces for:
- `DispatchFilters` (the filters parameter)
- `Dispatch` (the return type)
- `CreateDispatchInput` and `UpdateDispatchInput` (validated with Zod)

### 5.2 Inconsistent Select Specificity (Medium)

Compare:
```js
// getDispatches() — specific columns for vehicles/drivers, * for reservations/routes
. * , vehicles(vehicle_id, plate_number, vehicle_name), drivers(...), vehiclereservations(*), routes(*)

// getDispatch() — * for everything
. * , vehicles(*), drivers(*, employees(*)), vehiclereservations(*), routes(*)
```

Different functions use different levels of column specificity for the same tables. This is confusing and wasteful.

**Fix:** Centralize select strings into a constant (as `reservation.service.js` does with `reservationSelect`):
```js
const dispatchListSelect = `*, vehicles(vehicle_id, plate_number, vehicle_name), drivers(driver_id, employee_id, employees(first_name, last_name))`;
const dispatchDetailSelect = `*, vehicles(vehicle_id, plate_number, vehicle_name, ...), drivers(driver_id, ..., employees(first_name, last_name)), ...`;
```

### 5.3 Duplicate Query Logic (Medium)

`getDispatches()` and `getDispatchesByStatus()` have nearly identical query structures (same base select, same `.is("deleted_at", null)` filter). The only differences are the joined tables and the return format. This violates DRY.

**Fix:** Create a private `buildDispatchQuery()` helper that both functions can use, accepting an optional select parameter.

### 5.4 Service Mixes Read and Write Operations (Low)

The file exports 6 functions spread across reads (`getDispatches`, `getDispatchesByStatus`, `getDispatch`) and writes (`createDispatch`, `updateDispatch`, `updateDispatchStatus`). This is acceptable for a small service, but as the domain grows, consider splitting into `dispatch.read.service.js` and `dispatch.write.service.js`.

### 5.5 Null vs Empty Array Handling (Low)

`getDispatches()` could return `null` if Supabase returns null data, but the callers treat it as an array (`.find()`, `.length`). The `reservations/[id]/page.js` call:

```js
const { data: dispatches = [] } = useQuery({
  queryFn: () => getDispatches({}),
});
```

Defaults to an empty array, but this is in the caller, not the service. The service itself doesn't guarantee an array return.

**Fix:** In `getDispatches()`, return `data || []` instead of raw `data`.

---

## 6. MISSING API ROUTE ANALYSIS

Since `src/app/api/dispatch/route.js` doesn't exist, here's what should be created:

### Recommended Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/dispatch` | List dispatches with filters & pagination |
| `GET` | `/api/dispatch/[id]` | Get single dispatch detail |
| `POST` | `/api/dispatch` | Create dispatch |
| `PATCH` | `/api/dispatch/[id]` | Update dispatch fields |
| `PATCH` | `/api/dispatch/[id]/status` | Update dispatch status only |

### Requirements for Each Endpoint

1. **Use `@/lib/supabase/server.js`** — the server client, not the browser client.
2. **Zod validation** — validate query params for GET, body for POST/PATCH.
3. **Explicit auth check** — verify the user's role before allowing mutations (don't rely on RLS alone).
4. **Standardized response shape** — `{ success: boolean, data?: T, error?: string }`.
5. **Audit logging** — log dispatch mutations to the `audit_logs` table.
6. **Transactional updates** — when creating a dispatch, atomically update the reservation status.

---

## 7. SUMMARY TABLE

| # | Issue | Severity | File(s) |
|---|-------|----------|---------|
| 1 | No input validation on mutations | **Critical** | `dispatch.service.js:50-71` |
| 2 | Dispatch number generation conflict (client vs DB trigger) | **Critical** | `dispatch.service.js`, `reservations/[id]/page.js:107`, `001_schema.sql:844` |
| 3 | Fire-and-forget reservation update on dispatch creation | **Critical** | `reservations/[id]/page.js:118` |
| 4 | Missing API route — no server-side layer | **High** | `src/app/api/dispatch/route.js` |
| 5 | No server-side authorization checks | **High** | `dispatch.service.js` |
| 6 | Over-fetching with `*` in selects | **High** | `dispatch.service.js:7,43` |
| 7 | `getDispatchesByStatus()` loads all records with no date filter | **High** | `dispatch.service.js:21-37` |
| 8 | No pagination on list endpoint | **Medium** | `dispatch.service.js:3-18` |
| 9 | No TypeScript / weak typing | **Medium** | `dispatch.service.js` |
| 10 | Duplicate query structure across functions | **Medium** | `dispatch.service.js:3-18,21-37` |
| 11 | Inconsistent column selection | **Medium** | `dispatch.service.js:6-7,43` |
| 12 | Raw error propagation with no context | **Medium** | `dispatch.service.js:17,28,46,...` |
| 13 | Service creates Supabase client internally, not injected | **Low** | `dispatch.service.js` |
| 14 | No React Cache or server-side caching | **Low** | `dispatch.service.js` |

### Action Items (Priority Order)

1. **Fix the dispatch number generation conflict** — decide client-side vs DB trigger, remove the other.
2. **Fix the fire-and-forget reservation update** — make it atomic with proper error handling.
3. **Create `src/app/api/dispatch/route.js`** with Zod validation, server client, and standardized responses.
4. **Add input validation** (Zod schemas) to all mutation functions.
5. **Add date-range filter** to `getDispatchesByStatus()`.
6. **Optimize select strings** — specify only needed columns.
7. **Add pagination** to `getDispatches()`.
8. **Migrate to TypeScript** with proper interfaces.
9. **Add retry logic and error wrapping** to the service layer.
