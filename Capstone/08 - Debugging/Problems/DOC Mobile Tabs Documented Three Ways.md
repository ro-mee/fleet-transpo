---
type: debt
status: closed
severity: sev-3
tags: [debt, docs, mobile]
source:
  - SYSTEM.md
  - mobile/README.md
  - docs/mobile-mvp.md
  - mobile/app/(app)/(tabs)/_layout.js
last_verified: 2026-08-13
---

# Doc Rot: Mobile Tabs Documented Three Ways

## The problem — FIXED 2026-08-13

The mobile app's tab structure was described **differently by three documents**. They have now been aligned to the codebase (`Home`, `Trips`, `Vehicle`, `Alerts`, `Profile`).

**Actual tabs** (`mobile/app/(app)/(tabs)/_layout.js`):

| Route | Label |
|---|---|
| `index` | Home |
| `trips` | Trips |
| `vehicle` | Vehicle |
| `notifications` | Alerts |
| `profile` | Profile |

## Why it's dangerous

Navigation is the first thing a developer hits in a mobile codebase. Three conflicting descriptions guarantee the fourth (their own) reading is wrong. This is [[Documentation Rot]] in its purest form: the same fact, stated three ways, all stale.

## Fix

1. Make the code the source of truth (it is): the five routes above.
2. Fix all three docs in one pass.
3. If the tabs change again, the note's `last_verified` in the vault will flag it.

## Related

[[Mobile Architecture]] · [[Documentation Rot]] · [[Debugging Index]] · [[Technical Debt]]
