---
name: rbac-implementation
description: Implementation of role-based access control for the FleetOps fleet transportation management system. Reads docs/rbac-model.md (the RBAC model document) and applies all changes: fixes constants.js (add missing roles), generates Supabase RLS migration SQL for all 36+ tables, creates frontend role-guard utility with nav gating and route protection, adds API middleware for server-side enforcement, and provides a validation checklist to verify every table has policies and every nav item is gated. Use this whenever the user asks to implement RBAC, apply the access control model, fix RLS policies, add role-based security, enforce permissions, set up frontend guards, create role-guard utilities, or secure the API routes. Do NOT use for: designing the RBAC model itself (that's docs/rbac-model.md), normalizing the database schema (use database-normalization skill), or general CRUD page building.
compatibility:
  requires: ["docs/rbac-model.md", "supabase/migrations/ directory", "src/lib/constants.js", "src/components/layout/app-shell.jsx", "src/services/auth.service.js"]
---

# RBAC Implementation

This skill implements the RBAC model defined in `docs/rbac-model.md` across the FleetOps codebase. It works across three layers: database (RLS policies), frontend (nav gating, route guards, component-level checks), and API/service (middleware enforcement).

## Workflow

### Step 1: Read the RBAC Model

Read these sections of `docs/rbac-model.md`:

- **Section 3** — Role definitions (who each role is)
- **Section 4** — Resource access matrix (what each role can do)
- **Section 5** — RLS policy design (per-table policies)
- **Section 6** — Frontend enforcement (nav, routes, components, API)
- **Section 7** — Implementation roadmap (phasing)

This tells you what to build. If sections 3-7 are still placeholders, the model has not been finalized — ask the user to complete them first.

### Step 2: Determine Which Layers Are Needed

Based on what the user asked, determine which reference files to load:

| User asks about | Reference file(s) |
|---|---|
| RLS policies, database security, migration | `references/database-layer.md` |
| Nav gating, route guards, component visibility | `references/frontend-layer.md` |
| API route security, server-side enforcement | `references/service-layer.md` |
| "Full RBAC" or "everything" | All three, in order: database → frontend → service |

### Step 3: Apply Layer Files

For each layer needed, load the matching reference file and apply its instructions in sequence.

### Step 4: Validation Checklist

After applying all layers, verify:

1. **Database**: Every table with RLS enabled has at least one policy. Query:
   ```sql
   SELECT relname FROM pg_class WHERE relkind = 'r'
   AND relhaspolicies = false
   AND relname NOT IN ('spatial_ref_sys');
   ```
2. **Constants**: `src/lib/constants.js` has all roles from the seed data.
3. **Frontend**: Every route in the sidebar corresponds to a role entry in `NAV_ROLES`.
4. **Middleware**: Every mutation API route is wrapped with `withRole()`.
5. **Seed consistency**: Every role in the seed `INSERT INTO roles` is referenced in at least one RLS policy.

### Step 5: Verify

Read the modified files back, ensure they compile/lint, and report what was changed. If the user wants to test with a seed user, ask which role to simulate.

## Key Principles

- **Database first, frontend second, API last.** Always apply changes in this order — frontend guards are a UX safety net, not a security boundary. The database is the source of truth.
- **RLS policies must cover all four operations** (SELECT, INSERT, UPDATE, DELETE). If a table doesn't need DELETE, still explicitly exclude it rather than leaving it missing.
- **Frontend guards mirror the RLS model, not exceed it.** Never deny a frontend action that RLS would permit — this creates confusion and support requests.
- **API middleware is the backstop.** Every mutation should be protected server-side even if frontend guards are bypassed.
