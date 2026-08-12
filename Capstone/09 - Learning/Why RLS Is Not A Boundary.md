---
type: learning
tags: [learning, security, database, rls]
source:
  - supabase/migrations/002_rls_policies.sql
  - src/lib/db.js
  - src/lib/api/utils.js
last_verified: 2026-08-11
---

# Concept: Why RLS Is Not A Boundary

## What it is

**Row Level Security** lets Postgres filter rows per-connection based on the connecting role and session variables. Done right, the database itself enforces "a driver can only see their own trips" — even if the application has a bug.

The catch: RLS only applies to roles that **aren't exempt**. The table owner and any `BYPASSRLS` role — including Supabase's `service_role` — skip every policy.

## Why it matters

RLS looks like security whether or not it's doing anything. Nothing warns you. A `SELECT * FROM pg_policies` returning 71 rows feels reassuring and means nothing on its own.

The real question is never *"is RLS enabled?"* It's **"which role does my application connect as?"**

## How it appears in my project — CONFIRMED

32 of 38 tables have RLS enabled, with 71 policies. **All of them are inert.**

Re-measured live on 2026-08-11 (`pg_class.relrowsecurity` + `pg_policies`). This
vault previously recorded **31 of 37 / 69 policies**; the earlier figures came
from a count taken before the schema was dumped, and **what they were measuring
is not recorded** — do not treat the delta as a change to the database. The
seven tables with RLS *off* are `ailogs`, `aiproviders`, `driverincidents`,
`mobile_refresh_tokens`, `schema_migrations`, `system_settings`, and
`vehicleinspection`.

Two of the 32 — `uvvrp_exemptions` and `uvvrp_violations` — have RLS enabled and
**zero policies**. Under a non-privileged role that is deny-all, not allow-all:
RLS on with no policy matching means every row is filtered out. It reads as the
strictest configuration in the database and is, like the other 30, currently
doing nothing. If the connection model is ever fixed, these two tables break
first.

Both database paths connect privileged:

| Path | Credential | Subject to RLS? |
|---|---|---|
| `getAdminClient()` | `SUPABASE_SERVICE_ROLE_KEY` | No — `BYPASSRLS` |
| `getPool()` / `query()` | `DATABASE_URL` | No — table owner |

→ [[ADR-004 Dual Database Access]]

The repository is honest about this. `supabase/migrations/002_rls_policies.sql:1-12` opens with:

> ⚠ **INERT AT RUNTIME — NOT THE SECURITY BOUNDARY.**

## Example from my codebase

The **actual** boundary is `src/lib/api/utils.js`, applied by hand in each of 113 route handlers:

```js
const DEFAULT_ROLES = ["system_admin","admin","fleet_manager","dispatcher","management"];

export async function requireAuth(req, allowedRoles = DEFAULT_ROLES) { … }
export async function requireDriver(req) { … }   // + guarantees driverId
```

That's application-layer RBAC. It works — and it fails **per route**. One handler that forgets to call it is an open endpoint, and nothing in the repo checks. → [[RBAC]] · [[Authentication]]

## Common mistakes

| Mistake | Reality |
|---|---|
| "RLS is on, so we're safe" | Not if you connect as owner or `service_role` |
| Using the service-role key in a browser | Total compromise — it bypasses everything |
| Assuming policies are tested because they exist | They've never executed here |
| Deleting the inert policies | They're the spec for a future move to per-user connections. Keep them; keep the warning header. |

## The lesson

**A security control you can't observe working is not a control.** If you can't write a test that fails when it's removed, you don't know it's there.

Every one of the 71 policies could be deleted right now with zero behavioural change. That's the definition of inert.

## Related concepts

[[Defence In Depth]] · [[Fail Closed By Default]] · [[Supabase]] · [[RBAC]] · [[ADR-004 Dual Database Access]] · [[Learning Dashboard]]
