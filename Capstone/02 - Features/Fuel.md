---
type: feature
status: unexercised
tags: [feature, fuel]
source:
  - src/services/fuel.service.js
  - src/app/api/fuel
last_verified: 2026-08-11
---

# Feature: Fuel

## Status: built, never used — CONFIRMED

`fuelrecords` has **0 rows**. The API routes, the service wrapper, and the UI exist; no fuel record has ever been created.

## What exists

| Piece | Note |
|---|---|
| `src/services/fuel.service.js` | **33 lines of `apiFetch`** — a client fetch wrapper, not a domain service → [[DEBT Services Folder Mixes Two Concerns]] |
| `/api/fuel/*` routes | CRUD |
| Dashboard page | Under `(dashboard)/` |
| `fuelstations` | Table **dropped** in an earlier migration; still appears in both stale ERDs → [[DOC ERDs Missing Core Table]] |

## Why it's worth a note despite being empty

`fuel.service.js` is the clearest example of the naming collision in `src/services/`: it sits alongside `reservation-lifecycle.service.js`, which does transactions and DB writes, but it is 33 lines of browser `fetch`. Same folder, same suffix, completely different kind of module.

## To exercise it

Create a fuel record against a real vehicle and confirm the row lands. Until then, "fuel tracking works" is an untested claim.

## Related

[[Fleet And Vehicles]] · [[DEBT Services Folder Mixes Two Concerns]] · [[Feature Index]] · [[Reports]]
