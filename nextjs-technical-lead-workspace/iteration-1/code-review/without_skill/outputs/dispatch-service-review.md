# Code Review: Dispatch Service & API Route

**Review date:** 2026-07-28
**Files reviewed:**
- `src/services/dispatch.service.js`
- `src/app/api/dispatch/route.js` — **does not exist** (see Architectural Findings)

---

## 1. Critical Architectural Finding — Missing API Route

`src/app/api/dispatch/route.js` does not exist anywhere in the project. The dispatch service functions (`createDispatch`, `updateDispatchStatus`, `getDispatches`, etc.) are imported **directly into `"use client"` components** (e.g. `src/app/(dashboard)/dispatch/page.js` and `src/app/(dashboard)/reservations/[id]/page.js`) and executed in the browser against the Supabase client via the **anon key**.

This means all database operations happen entirely client-side. RLS policies are the only line of defense. There is no server-side validation, no audit logging, and no opportunity to enforce business rules in a trusted environment. A dispatch API route should be created to serve as a controlled gateway.

---

## 2. Security Issues

### 2.1 Direct Client-Side Database Access
Every function in `dispatch.service.js` uses `createBrowserClient` (`src/lib/supabase/client.js`). The anon key is exposed to the browser. If any RLS policy is missing or misconfigured, users can read, create, update, or delete dispatch records directly via browser DevTools.

**Fix:** Add an API route (`src/app/api/dispatch/route.js` and a `[id]` subroute) and move all data access behind it. Only the server-side Supabase client (`src/lib/supabase/server.js`) should perform write operations.

### 2.2 Raw Error Propagation
Every function does `if (error) throw error;`. Supabase error objects can leak internal schema details (table names, column constraints, relation IDs) directly to the client. The calling components have no error boundary or sanitization.

**Fix:** Wrap errors in a sanitized structure (e.g. `{ error: "Failed to create dispatch" }`) and log the raw error server-side.

### 2.3 No Authorization Checks
None of the service functions verify that the calling user has permission to read/write a given dispatch. There is no check for role (dispatcher vs. driver vs. admin) or ownership.

**Fix:** Add authorization checks — either at the API route level or via RLS policies that consider `auth.uid()`.

### 2.4 No Input Validation
`createDispatch` and `updateDispatch` accept raw objects and pass them directly to Supabase. A malicious client could inject unexpected fields (e.g. `is_admin: true` if such a column existed, or overwrite `created_at`).

**Fix:** Define a strict schema/validation layer (e.g. Zod) on the API route that whitelists allowed fields and validates types/values before passing them to the database.

---

## 3. Bugs

### 3.1 Fire-and-Forget `updateReservation` in `onSuccess`
In `src/app/(dashboard)/reservations/[id]/page.js` line 118:

```js
onSuccess: () => {
  updateReservation(reservationId, { status: "Dispatched" });
  // ...
}
```

`updateReservation` returns a Promise but is called without `await`. If it fails (network error, RLS violation, constraint), the failure is swallowed silently — the dispatch record exists but the reservation status is never updated, leaving the system in an inconsistent state.

**Fix:** Make the callback `async` and use `await`. Handle errors and possibly roll back the dispatch creation on failure.

### 3.2 Premature "Dispatched" Status on Create
The `createDispatch` call in `reservations/[id]/page.js` (line 114) sets `status: "Dispatched"` immediately, but this action is triggered from the "Approved" stage. The dispatch should logically start as `"Pending"` and only move to `"Dispatched"` after a separate action (e.g. assigning a vehicle/driver and confirming).

**Fix:** Start dispatch status as `"Pending"` and add a confirmation step or separate endpoint for transitioning to `"Dispatched"`.

### 3.3 Status Value Validation Gap
`updateDispatchStatus(id, status)` accepts any arbitrary string. There is no validation that the status is a valid value (e.g. one of: `Pending`, `Approved`, `Dispatched`, `In Progress`, `Completed`). A client could set a bogus status like `"Deleted"` or `"Hacked"`.

**Fix:** Validate status against a whitelist before executing the update.

### 3.4 Duplicate Dispatch Number Collision
The dispatch number format in `reservations/[id]/page.js` is:
```
DSP-YYYYMMDD-<padded-reservationId>
```
If a dispatch is created, then deleted (soft-delete), and another is created for the same reservation on the same day, the number collides. Also, if the system supports multiple dispatches per reservation, they would collide.

**Fix:** Include a random component or a database sequence/auto-increment in the dispatch number.

---

## 4. Performance Issues

### 4.1 In-Memory Filtering in `getDispatchesByStatus`
This function fetches **all** non-deleted dispatch records from the database and then partitions them in JavaScript with `.filter()`:

```js
const { data } = await supabase.from("dispatchschedules").select("...").is("deleted_at", null);
// then: data.filter((d) => d.status === "Pending") etc.
```

With thousands of records, this wastes bandwidth and memory, and degrades as the table grows. The client also receives records it may never render (e.g. completed dispatches in the pending column view).

**Fix:** Either run separate queries per status with `.eq("status", "Pending")` or use a single query with `.in("status", [...])` and group on the server side. Add pagination.

### 4.2 No Pagination or Limits
`getDispatches(filters)` and `getDispatchesByStatus()` have no `.range()` or `.limit()`. A large dataset will cause:
- Large payload sizes on the wire
- Memory pressure on the client
- Slow React re-renders from large arrays

**Fix:** Add `.range(page * pageSize, (page + 1) * pageSize - 1)` and return a count/next-page cursor.

### 4.3 Over-Fetching via Deeply Nested Selects
- `getDispatches` selects `vehiclereservations(*)` and `routes(*)` even when this data is not needed (e.g. on the kanban board).
- `getDispatch` (single record) uses `vehicles(*)` and `drivers(*, employees(*))` which can pull unnecessary columns.

**Fix:** Use explicit column lists in selects (as `getDispatches` and `getDispatchesByStatus` already do partially). Profile with large datasets to detect N+1 patterns — Supabase's REST client may issue multiple queries for nested relations.

---

## 5. Code Quality & Maintainability

### 5.1 Inconsistent Column Selection
| Function | Vehicle Select | Driver Select |
|---|---|---|
| `getDispatches` | `vehicles(vehicle_id, plate_number, vehicle_name)` | `drivers(driver_id, employee_id, employees(first_name, last_name))` |
| `getDispatchesByStatus` | Same | Same |
| `getDispatch` | `vehicles(*)` | `drivers(*, employees(*))` |

**Fix:** Standardize. Prefer explicit column lists (`getDispatch` should match the others) to avoid over-fetching and to make the contract between query and consumer explicit.

### 5.2 Missing Soft-Delete Filter on `getDispatch`
`getDispatches` and `getDispatchesByStatus` include `.is("deleted_at", null)`, but `getDispatch(id)`, `updateDispatch(id)`, and `updateDispatchStatus(id)` do not check `deleted_at`. This means:
- A soft-deleted dispatch can still be fetched by ID.
- A soft-deleted dispatch can be updated (reactivating it unintentionally via an update that doesn't touch `deleted_at`).

**Fix:** Add `.is("deleted_at", null)` to `getDispatch`. For updates, either block if `deleted_at` is set or explicitly exclude soft-deleted records.

### 5.3 Repetitive Error Handling
Every function repeats:
```js
if (error) throw error;
```
This is 5 occurrences in an 83-line file. A bug or logging change requires editing all of them.

**Fix:** Create a thin wrapper utility (e.g. `async function fromSupabase(promise) { const { data, error } = await promise; if (error) throw sanitizeError(error); return data; }`).

### 5.4 Inline Business Logic in UI Component
The `dispatchMutation` mutation function in `reservations/[id]/page.js` contains business logic (dispatch number generation, status assignment, date formatting) that belongs in the service or API layer. This makes the logic untestable in isolation and hard to reuse.

**Fix:** Move the dispatch-creation logic (number generation, default status, field mapping) into `dispatch.service.js` as a `createDispatchFromReservation(reservation)` function.

### 5.5 No Consistent Return Type for Error States
The service functions return data directly or throw. The calling components use React Query, so errors surface via `isError` / `error` — but there's no guarantee about the shape of the error. Sometimes it's a Supabase `PostgrestError`, sometimes it might be a network error.

**Fix:** Return a consistent result shape (e.g. `{ data, error }`) or throw typed/custom errors.

---

## 6. Summary of Recommendations (Priority Order)

| Priority | Issue | File/Line |
|---|---|---|
| **P0** | No API route — client-side DB access | Create `src/app/api/dispatch/route.js` |
| **P0** | `updateReservation` fire-and-forget (data inconsistency bug) | `reservations/[id]/page.js:118` |
| **P1** | No input validation on create/update | `dispatch.service.js:50-58` |
| **P1** | `getDispatchesByStatus` fetches all records, filters in-memory | `dispatch.service.js:21-36` |
| **P1** | Missing `deleted_at` check on get/update by ID | `dispatch.service.js:39,61,73` |
| **P2** | Status value not validated | `dispatch.service.js:73` |
| **P2** | Inconsistent column selection | `dispatch.service.js:7 vs 43` |
| **P2** | Dispatch starts at "Dispatched" instead of "Pending" | `reservations/[id]/page.js:114` |
| **P2** | No pagination on list queries | `dispatch.service.js:3,21` |
| **P3** | Duplicate dispatch number risk | `reservations/[id]/page.js:107` |
| **P3** | Repetitive error handling | `dispatch.service.js` (all functions) |
| **P3** | Business logic in UI component | `reservations/[id]/page.js:106-115` |

---

*Review generated by code review agent.*
