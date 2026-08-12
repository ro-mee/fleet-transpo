---
type: debt
status: resolved
severity: sev-3
tags: [debt, docs, rbac, resolved]
source:
  - docs/rbac-model.md
  - supabase/migrations/022_remove_front_desk_roles.sql
resolved: 2026-08-11
resolved_by: a654018
last_verified: 2026-08-11
---

# Doc Rot: rbac-model Says 9 Roles

> **RESOLVED 2026-08-11** (roadmap Phase 3, item 13 — commit `a654018`).
> `docs/rbac-model.md` was rewritten around the six roles that exist.

## The problem — was CONFIRMED

`docs/rbac-model.md` self-labelled *"authoritative"* and described **9 roles**.
The live database has **6**.

Migration `022_remove_front_desk_roles.sql` dropped role ids 5, 6 and 8
(`reception_staff`, `restaurant_staff`, `concierge`) and disabled the three
employees who held them. Live `roles` table (queried 2026-08-11):

| id | name |
|---|---|
| 1 | system_admin |
| 2 | fleet_manager |
| 3 | dispatcher |
| 4 | driver |
| 7 | management |
| 9 | admin |

The gaps in the ID sequence (1,2,3,4,7,9) are exactly the deleted roles.

> The original note cited the migration as `022_role_system.sql`. The real
> filename is `022_remove_front_desk_roles.sql` — corrected above.

## Why it was dangerous

RBAC is the security surface. A doc naming roles that no longer exist sends a
developer down the wrong permission path — reasoning about a matrix that
includes ghosts.

## What was actually done

Rewritten from the live `roles` table and `src/lib/auth/permissions.js`:

- §1 the six roles with `role_id`, workspace and authority
- §2 **why enforcement is application-layer** — both DB paths hold elevated
  privileges (the `pg` pool connects as owner, Supabase uses the service-role
  key), so no end-user Postgres identity exists and RLS has no session to read
- §3 the matrix transcribed, `system_admin` omitted because `can()`
  short-circuits to `true` before the matrix is consulted
- §4 `NAV_ROLES`, §5 sessions, §6 known gaps

**One correction the note did not anticipate:** the old doc credited the matrix
to `role-guard.js`. The data lives in `src/lib/auth/permissions.js:79`;
`role-guard.js` re-exports it and adds the React hook. A note that cites the
wrong file is the same failure class as this one.

Verified with `node --import ./scripts/route-harness-loader.mjs
scripts/verify-rbac.mjs` — **78 passed**, including the check that the UI matrix
and the per-route role lists agree.

## Related

[[RBAC]] · [[Authentication]] · [[Documentation Rot]] · [[Technical Debt]] · [[Debugging Index]]
