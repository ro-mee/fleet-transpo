---
type: moc
title: Learning Dashboard
tags: [moc, learning]
source:
  - (see individual notes)
last_verified: 2026-08-11
---

# Learning Dashboard

Every concept here is anchored to **a real file in this repository**. That's the point — general knowledge you can get anywhere; knowing where it lives in *your* code is what makes it stick.

## Concurrency & data integrity

| Concept | Where it appears in my project |
|---|---|
| [[TOCTOU And Advisory Locks]] | `023_dispatch_overlap_guard.sql` |
| [[Connection Pooling vs Transactions]] | `src/lib/db.js:56-72` |
| [[Half Open Intervals]] | the overlap test in migration 023 |
| [[Defence In Depth]] | app check + DB trigger → [[ADR-006 Dual Double-Booking Guard]] |

## Security

| Concept | Where it appears |
|---|---|
| [[Why RLS Is Not A Boundary]] | `002_rls_policies.sql:1-12`, `src/lib/db.js` |
| [[Fail Closed By Default]] | `DEFAULT_ROLES` excludes `driver` |
| [[Anti Enumeration 404 vs 403]] | `assertTripOwnership()` |
| [[Token Rotation And Refresh Races]] | `mobile/lib/api.js` |
| [[Client Side Role Decoding Is Not Security]] | `mobile/lib/rbac.js` |

## Architecture & design

| Concept | Where it appears |
|---|---|
| [[Anti-Corruption Layer]] | `src/lib/integration/` |
| [[Pure Core Imperative Shell]] | `src/lib/<domain>/` vs `src/services/` |
| [[State Machines]] | three of them, three different designs |
| [[Deterministic Core With Nullable Narration]] | `src/lib/ai/` |
| [[Graceful Degradation]] | OCR timeout, priority fallback, LLM null |

## Engineering practice

| Concept | Where it appears |
|---|---|
| [[Tests Can Encode Bugs]] | `grounding.test.js` |
| [[Verification Tooling Can Be Dead]] | `scripts/load-env.mjs` — 17 scripts, silently loading nothing |
| [[Documentation Rot]] | `docs/` vs docstrings |
| [[Framework Version Drift]] | `middleware.js` → `proxy.js` |

## The three highest-value lessons in this repository

If you take three things from this project into the next one:

### 1. A green signal is not evidence of correctness
`grounding.test.js` asserts that grounding every vehicle is correct behaviour. The test passes. The code is wrong. **Tests encode whatever the author believed, including their mistakes.** → [[Tests Can Encode Bugs]]

The same session found the tooling version: `load-env.mjs` had been loading
**zero** credentials for every verification script in the repo, and reported
success throughout, because "file absent" and "line didn't parse" were both
handled by carrying on. → [[Verification Tooling Can Be Dead]]

Both failures look identical from outside: green, and meaningless. Ask of any
check — *what does it do when it finds nothing?*

### 2. Write the "why" next to the "what"
Every well-documented decision in this repo is documented **in the code that implements it** — `db.js` docstrings, migration 023's header, `dispatch-advisor.js` lines 11–14. Every rotted document is a standalone `.md`. A reason next to its implementation shows up in the diff when the implementation changes. → [[Documentation Rot]]

### 3. Check-then-act across a network is always a race
The app-level conflict check in `conflicts.js` cannot prevent double-booking, no matter how carefully written, because another request can land between the check and the insert. Only the database — holding a lock — can. → [[TOCTOU And Advisory Locks]]

## What to learn next — INFERRED priority

1. **Postgres advisory locks and isolation levels** — you're already using them; understand `SERIALIZABLE` as the alternative
2. **The outbox pattern** — the answer to both [[integration_log]] reconciliation and push notifications
3. **Testing strategy** — property tests for the state machines, race tests for the trigger
4. **Next.js 16 specifics** — read `node_modules/next/dist/docs/` as `AGENTS.md` instructs

## Related

[[Home]] · [[Decision Log]] · [[Debugging Index]] · [[Codebase Map]] · [[Things I Should Not Forget]]
