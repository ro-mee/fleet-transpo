---
type: bug
status: fixed
severity: sev-2
tags: [bug, drivers, compliance, fixed]
source:
  - src/services/status.service.js
  - src/app/api/drivers/[id]/route.js
  - src/lib/drivers/compliance.js
  - supabase/migrations/064_driver_suspension_reason.sql
last_verified: 2026-08-23
---

# GAP Compliance Suspension Had No Inverse

**Reported live by the operator**: a driver's license expired → system suspended them; the license was renewed → the driver stayed `Suspended` indefinitely.

## Root cause

`syncDriverStatus()` (`status.service.js`) was the only writer of `Suspended` — an automatic compliance rule with **no inverse anywhere**. Renewal (`PUT /api/drivers/[id]`) wrote `license_expiry` without touching `driver_status`, and re-running the sync was a no-op once the license was valid. Manual reinstatement existed (edit-form dropdown) but nothing distinguished a compliance suspension from a disciplinary one, which is what blocked any automatic fix.

## Fix — reason-tracked suspension

Migration 064 adds `drivers.suspension_reason`:

| Value | Written by | Auto-restorable |
|---|---|---|
| `license_expired` | compliance sync | ✅ yes — on saving a valid future expiry |
| NULL / `manual` | humans | ❌ never by code |

Pure rule: `suspensionAction()` in `src/lib/drivers/compliance.js` (On Leave keeps precedence; missing/malformed expiry never suspends). `PUT /api/drivers/[id]` runs it post-update: restore ⇒ `Available` + audit + ops notification; an explicit `driver_status` in the same request always wins. The sync also **notifies staff when it suspends** (previously silent). UI: driver page shows a "license renewed — still Suspended" banner with Reinstate; edit form explains both suspension kinds.

## Two extra bugs caught during verification

1. **pg returns DATE columns as Date objects** — slicing their `toString()` misparsed `"Sun Aug 22 2027…"` into a year-2001 date. `licenseExpired()` now branches on `instanceof Date`; regression test pins it.
2. **Snake_case row → camelCase helper**: passing the SQL row verbatim silently bound all three destructured params to `undefined`. Fixed at the call site with explicit mapping.

## Verified

Headless rehearsal `scratch/qa_suspension_e2e.mjs`: 6/6 over live HTTP — renewal reinstates + notifies; manual suspensions survive renewal; explicit admin status wins; expired dates never reinstate; `[QA]` rows restored afterwards.

→ [[Debugging Index]] · [[Driver Management]]
