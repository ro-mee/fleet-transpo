---
type: table
title: system_settings
tags: [database, table, settings, policy, security, runtime-config]
source:
  - src/lib/system-settings.js
  - src/lib/security-policy.js
  - src/services/dispatch-settings.service.js
  - src/lib/uvvrp/uvvrp.service.js
  - supabase/migrations/138_system_settings_grants.sql
last_verified: 2026-09-29
---

# Table: system_settings

**6 rows** — the whole runtime-configurable policy layer of FleetOps lives in six rows of `key → jsonb`.

| setting_key | updated_at | updated_by |
|---|---|---|
| `cron_sync_heartbeat` | 2026-09-06 | null (system) |
| `cron_sync_last_ok` | 2026-09-28 | null (system) |
| `dispatch_policy` | 2026-08-11 | 8 |
| `hotel_location` | 2026-08-31 | null (system) |
| `seed:phase4` | 2026-08-11 | null (system) |
| `uvvrp_policy` | 2026-08-10 | 8 |

*(live read, 2026-09-29. `security_policy` deliberately absent — see "A missing row is the default" below.)*

## Purpose

```sql
CREATE TABLE system_settings (
  setting_key   varchar(100) PRIMARY KEY,
  setting_value jsonb        NOT NULL,
  updated_at    timestamptz  DEFAULT now(),
  updated_by    integer               -- employees.employee_id, NULL for a system writer
);
```

Policy that an operator should be able to change without a deploy is stored as **one JSON document per policy**, keyed by a single string — not as a row per setting and not as columns. Five policies use this shape:

- **`dispatch_policy`** — dispatcher thresholds, read through `getDispatchPolicy()` (`src/services/dispatch-settings.service.js`, `src/lib/dispatch-policy.js`).
- **`uvvrp_policy`** — the coding/weekday rule set (`src/lib/uvvrp/uvvrp.service.js`, `src/lib/uvvrp/policy.js`).
- **`security_policy`** — session + lockout timings, read through `getSecurityPolicy()` (`src/services/security-policy.service.js`, `src/lib/security-policy.js`).
- **`work_shift_policy`** — fleet operating hours, default shift times, staggered lunch breaks (4 rotating slots: 11:30–12:30, 12:00–1:00, 12:30–1:30, 1:00–2:00), and staggered rest days across the 7 days of the week (`src/lib/work-shift-policy.js`, `src/services/work-shift-policy.service.js`). Managed via `/settings/dispatch` with batch-apply to all active drivers and one-click import into individual driver schedule editors.
- **`fuel_policy`** — refill, variance, auto-approval, budget, price, and fuel-type controls (`src/lib/fuel/fuel-policy.js`, `src/services/fuel-settings.service.js`). The mobile receipt photo remains mandatory regardless of policy.


The remaining keys (`cron_sync_*`, `hotel_location`, `seed:phase4`) are scalars written by code paths that have no UI: `src/lib/system-health.js`, the hotel/NAIA routes, and a seed marker.

Why jsonb rather than columns: a policy is a *coherent set* — every consumer wants the whole thing, and a partial save would produce a policy nobody can reason about. One `SELECT` returns the set. The cost is that the schema cannot enforce the shape, which is why the shape is enforced in code instead (`mergeSecurityPolicy` / `validateSecurityPolicy` in `src/lib/security-policy.js`).

## Security — closed by migration 138 (2026-09-28)

Measured live, not read off a migration: `anon` and `authenticated` each held `DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE` on this table, against `relrowsecurity = true` and **zero policies**. Every earlier grant fix (116, 117, 119, 122, 123) missed it.

`supabase/migrations/138_system_settings_grants.sql`:

```sql
REVOKE ALL PRIVILEGES ON public.system_settings FROM anon, authenticated;
```

**RLS alone was not the fix.** Row security does not apply to `TRUNCATE`, so with the `TRUNCATE` grant the public anon key could have emptied the table in one statement — silently resetting `dispatch_policy` and `uvvrp_policy` to code defaults. That is a data-destruction hole rather than a read hole, which is why `npm run verify:anon` reported this table `INCONCLUSIVE` before the revoke (rows filtered by an empty-policy RLS return `200 []`, indistinguishable from an empty table) and `PASS … HTTP 401 (42501) — refused` after it. `npm run db:contract` is the gate that resolves the inconclusive case from the DB side.

`postgres` and `service_role` keep their grants: `DATABASE_URL` authenticates as `postgres` (BYPASSRLS) and is the only path the application uses. The revoke is scoped to the two public PostgREST roles, matching 116/119.

Closing this table was a **prerequisite** for storing `security_policy` here rather than a cleanup that followed it — writing session and lockout policy into a table the anon key could truncate would have been the worst trade in the codebase.

## The cache: 30 seconds, per instance — `src/lib/system-settings.js`

There was previously no shared reader; each key grew its own hand-rolled `SELECT`, so `security_policy` would have added a round trip to the login path and to every session `INSERT`.

- `getSetting(key, fallback)` — read-through, **30s TTL**, caches the absence of a row as well as its value (the default path is the common path: before an admin ever saves, the row does not exist).
- `setSetting(key, value, actorId)` — upsert then `cache.delete(key)`. A save invalidates **on this instance only**. Every writer in the tree goes through here, so there is no separate invalidation entry point to expose.
- `warmSetting(key, fallback)` — background fill, never rejects.
- `clearSettingCache()` — tests and HMR-adjacent resets.

**Staleness is bounded and deliberate.** On serverless each instance has its own `Map`, so another instance can serve the previous value until its TTL lapses: **30 seconds is the ceiling**, and the settings card says so in its own footer text. A failed read is *not* cached — login already writes to the same database, so a settings read introduces no new failure mode.

`peekSetting(key)` is the one synchronous accessor: **`undefined` = never read here yet, `null` = read and there is no row.** Only the latter is an answer. It exists for the single consumer that cannot await — NextAuth spreads `authOptions.session` while building per-request options, before any application code runs, so the configured absolute session lifetime reaches it as a property getter over a value already in hand (`warmSetting` at startup). Every other caller uses `getSetting`.

## A missing row is the default

**As of 2026-09-29 no `security_policy` row exists**, and that is a supported state rather than an oversight: `DEFAULT_SECURITY_POLICY` in `src/lib/security-policy.js` carries exactly the values the code hard-coded before this existed (idle 300s from `session-policy.js`, absolute 43200s, lockout 10/15, temp password 7d, trusted device 7d, lookback 90d), and `mergeSecurityPolicy(stored)` clamps a null, corrupt, truncated or hand-edited row back into a usable, in-range policy instead of throwing on the login path.

So the queue never depends on an administrator having saved a policy.

## "New sessions only"

A saved policy governs sessions **created after the save**. An existing `web_sessions` row keeps the limits it was signed in with:

- `web_sessions.idle_timeout_seconds` (default 300) — written at session creation, read by `resolveCurrentIdentity()`.
- `expires_at − created_at` — the absolute TTL, derived per session rather than re-read from policy.

The client is told the same thing: `GET/POST /api/auth/heartbeat` return the **row's** `idle_timeout_seconds` and `absoluteTtlSeconds` (computed by `absoluteTtlSecondsOf()` in `src/lib/api/utils.js` from `created_at`/`expires_at`), never the live policy, so dialog copy can never name a limit the session never had. Derived values are cached in `session-manager.jsx` state behind a structural `sameWindows()` comparison so a heartbeat does not churn effect dependencies.

→ [[Authentication]] · [[RBAC]] · [[Security Audit]] · [[Database Overview]]
