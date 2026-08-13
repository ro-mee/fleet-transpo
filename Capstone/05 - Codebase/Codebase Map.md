---
type: reference
title: Codebase Map
tags: [codebase, navigation, reference]
source:
  - (whole repository)
last_verified: 2026-08-11
---

# Codebase Map

Top-to-bottom, with **what each directory actually contains** — not what its name suggests.

## Repository root

| Path | What it is |
|---|---|
| `src/` | The Next.js web app — all 113 API routes and 61 pages |
| `mobile/` | A **separate Expo app**. Own `package.json`, own `AGENTS.md`, own auth. |
| `supabase/migrations/` | 38 SQL files. **Not a faithful record** → [[DEBT Schema Drift From Migrations]] |
| `docs/` | Standalone markdown. **Substantially rotted** → [[Debugging Index]] |
| `scripts/` | 23 files, mostly `verify-*.mjs` harnesses |
| `resources/ai/instructions.md` | The LLM prompt, as **content** not code → [[AI Architecture]] |
| `workflow/` | One PDF: `Fleet Management System-2026-07-27-071922.pdf`. **UNKNOWN — never inspected.** |
| `Capstone/` | **This vault** |
| `apply029.js`, `run_migration*.mjs`, … | ~10 one-off migration scripts left in the root → [[DEBT Schema Drift From Migrations]] |
| ~~`proxy.js`~~ | Dead file at root — **deleted 2026-08-11**. Next only scans `src/` for it here. → [[BUG Root proxy.js Is Dead Code]] |
| `README.md` | Unmodified `create-next-app` boilerplate → [[DOC README Is Boilerplate]] |
| `AGENTS.md` / `CLAUDE.md` | Instructions for AI assistants. Two rules: read the bundled Next docs; use the `pg` migration path. |

## `src/` — the web app

```
src/
├── proxy.js              ← Next 16 middleware. CORS ONLY. No auth.
├── app/
│   ├── (auth)/           ← login
│   ├── (dashboard)/      ← staff UI: fleet, drivers, dispatch, reservations, reports
│   ├── (driver)/         ← driver web portal
│   └── api/              ← 113 route.js handlers
├── components/
│   └── ui/               ← Radix/shadcn primitives
├── services/             ← ⚠ TWO KINDS OF MODULE — see below
├── lib/
│   ├── db.js             ← the ONLY place DB connections are made
│   ├── auth.js           ← NextAuth config
│   ├── mobile-auth.js    ← the separate mobile JWT system
│   ├── api/utils.js      ← ⭐ requireAuth — THE authorization boundary
│   ├── scheduling/       ← pure: priority, conflicts, 3 state machines, sync, calendar
│   ├── integration/      ← pure: contracts, status-map, gateway, category-resolver
│   ├── ai/               ← pure: rule-engine, pair-scoring, predictive-maintenance
│   ├── uvvrp/policy.js   ← pure: number-coding rules
│   ├── vehicles/         ← pure: odometer validation
│   ├── consent/          ← pure: driver visibility allow-lists
│   └── driver/           ← grounding ⚠ STUB
└── hooks/                ← React Query wrappers
```

### `src/lib/api/utils.js` — read this first

Every one of the 113 routes passes through it. `requireAuth`, `requireDriver`, `resolveIdentity`, `parseBody`, `ok`, `err`, `handleError`. → [[Authentication]]

### `src/lib/db.js` — read this second

`getAdminClient()`, `query()`, `withTransaction()`. Both paths privileged. The `withTransaction` docstring is the best explanation of pooling-vs-transactions in the repo. → [[Connection Pooling vs Transactions]]

### `src/lib/<domain>/` — the pure core

No I/O, no imports of `db.js`, injected `now` for determinism. This is where the actual business logic lives, and why 15 test files can exist without a database. → [[Pure Core Imperative Shell]]

### ⚠ `src/services/` — two kinds of module, one name

| Reading | Kind |
|---|---|
| `reservation-lifecycle.service.js` | Server domain service — transactions, DB writes |
| `fuel.service.js` (33 lines) | Client fetch wrapper — `apiFetch` only |

Check the imports before assuming which you have. → [[DEBT Services Folder Mixes Two Concerns]]

## `mobile/` — the Expo app

```
mobile/
├── app/
│   ├── (auth)/login.js
│   └── (app)/(tabs)/_layout.js   ← Home · Trips · Vehicle · Alerts · Profile
├── lib/
│   ├── api.js         ← ⭐ single-flight refresh. Read the docstring.
│   ├── tracking.js    ← GPS: sensor → ref, uploader → 30s interval
│   └── rbac.js        ← decodes JWT WITHOUT verifying. Documented as such.
└── components/ui.js
```

## Where to start reading — a suggested order

1. `src/lib/api/utils.js` — how anything is allowed to happen
2. `src/lib/db.js` — how data is reached
3. `src/lib/scheduling/reservation-state.js` — the core domain model
4. `src/services/reservation-lifecycle.service.js` — how a request moves
5. `src/app/api/dispatch/route.js` + `supabase/migrations/023_dispatch_overlap_guard.sql` — the hardest problem, solved twice
6. `mobile/lib/api.js` — the best-documented file in the project

## Files whose names mislead

| File | Looks like | Actually |
|---|---|---|
| `fuel.service.js` | A domain service | A 33-line fetch wrapper |
| `services/integration.service.js` | Server-side ingest | **Client-side** — it calls `apiFetch`. Server ingest is `src/lib/integration/`. → [[DEBT Services Folder Mixes Two Concerns]] |

Four entries were removed from this table on 2026-08-11 because the mismatch was
fixed rather than documented: root `proxy.js` (deleted), `grounding.js` (now
implements the rule its name and docstring promise), `vehiclereservations`
(dropped in migration 036) and `docs/rbac-model.md` (rewritten — it now describes
the 6 roles that exist).

## Related

[[Important Files]] · [[Architecture]] · [[Where Is This]] · [[Backend]] · [[Frontend]] · [[Home]]
