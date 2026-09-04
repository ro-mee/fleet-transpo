---
type: memory
title: Useful Code Patterns
tags: [memory, patterns, reference]
source:
  - src/lib/api/utils.js
  - src/lib/db.js
  - supabase/migrations/023_dispatch_overlap_guard.sql
last_verified: 2026-08-11
---

# Useful Code Patterns

Patterns already established in this codebase. **Reuse these rather than inventing a parallel approach** — that's what keeps a codebase readable.

## The route handler — four steps, in order

```js
export async function POST(req) {
  const identity = await requireAuth(req);        // 1. auth — throws
  const body = Schema.parse(await req.json());    // 2. validate — throws
  const result = await withTransaction(async (client) => { … });  // 3. act
  return NextResponse.json(result);               // 4. respond
}
```

Errors are **thrown**, never returned, so the happy path stays linear. → [[Backend]] · [[Error Handling Patterns]]

## Auth — the two guards

```js
requireAuth(req)                 // DEFAULT_ROLES — driver NOT included
requireAuth(req, ["dispatcher"]) // narrower
requireDriver(req)               // driver only; guarantees driverId
```

`resolveIdentity()` gives **Bearer token priority over cookie session**, which is how one route serves both web and mobile. → [[Authentication]] · [[Fail Closed By Default]]

## Multi-statement writes

```js
await withTransaction(async (client) => {
  await client.query("UPDATE …");   // use client, NOT query()
  await client.query("INSERT …");
});
```

Calling `query()` inside the callback grabs a **different pooled connection** and silently escapes the transaction. → [[Connection Pooling vs Transactions]]

## Rank-based state validation

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);
```

Gaps (`100`) leave room to insert states. Equal ranks express aliases. → [[State Machines]]

## Serialising per-resource in a trigger

```sql
PERFORM pg_advisory_xact_lock(hashtext('dispatch_veh_' || NEW.vehicle_id));
-- lock BEFORE the check; _xact_ releases on commit or rollback
```

Per-resource key so unrelated rows never contend. → [[TOCTOU And Advisory Locks]]

## Overlap test

```sql
a_start < b_end AND COALESCE(a_end, a_start) > b_start
```

Strict comparisons; `COALESCE` because a NULL bound would make the whole predicate NULL and the guard would **pass**. → [[Half Open Intervals]]

## Allowlist, never denylist

```js
DRIVER_SELF_EDITABLE_FIELDS = ["phone","face_image_url", …];
```

A new column is non-editable until listed. → [[Fail Closed By Default]]

## Degrade, don't throw, for optional work

```js
// unknown priority → "Medium", never an exception
// LLM failure → null
// OCR timeout at 6s → ""
```

Lean **conservative**: the lower priority, the empty string. → [[Graceful Degradation]]

## Single-flight refresh

Store the in-progress refresh promise; concurrent 401s await it instead of starting their own. Required because refresh is single-use. → [[Token Rotation And Refresh Races]]

## Pure rules, effects at the edge

Business logic in `src/lib/<domain>/` with **no `await`, no `query()`, no `fetch()`**. Handlers fetch, call, respond. → [[Pure Core Imperative Shell]]

## Smart filter defaults — fetch-tab-first + deferred steer

When a tab/filter default depends on server-returned counts, the query needs the tab before counts exist. **Never derive the tab from counts textually above the query** — that reads a `const` before its declaration (TDZ `ReferenceError` on every render; invisible to curl, SSR shells, and `no-undef` — this exact crash shipped on the fuel console 2026-09-04):

```js
const [tabOverride, setTabOverride] = useState(null);
const steerTimer = useRef(null);
const pickTab = (id) => { clearTimeout(steerTimer.current); setTabOverride(id); setPage(1); };
const fetchTab = tabOverride ?? "today"; // concrete tab for the query key

const { data } = useQuery({ queryKey: [..., fetchTab, ...], queryFn: () => fetch(fetchTab) });
const counts = data?.counts ?? {};
const tab = tabOverride ?? smartTab(counts); // display value, defined AFTER counts

useEffect(() => {
  if (tabOverride) return;
  const smart = smartTab(counts); // pure helper in src/lib — unit-tested
  if (smart === "today") return;
  steerTimer.current = setTimeout(() => setTabOverride(smart), 0); // deferred: no set-state-in-effect warning
  return () => clearTimeout(steerTimer.current);
}, [tabOverride, counts]);
```

Rules: query keys on `fetchTab`, UI reads `tab`, pills call `pickTab` (which also cancels a pending steer), polls never yank a manual pick. Copy this shape; do not reinvent it. → [[Bugs]] (2026-09-04 TDZ entry)

## Related

[[Codebase Map]] · [[Important Files]] · [[Backend]] · [[Things I Should Not Forget]]
