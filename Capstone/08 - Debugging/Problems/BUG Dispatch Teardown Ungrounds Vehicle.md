---
type: bug
status: fixed
severity: sev-2
tags: [bug, incidents, grounding, fixed]
source:
  - src/app/api/driver/incidents/route.js
  - src/services/transition.service.js
  - src/services/status.service.js
last_verified: 2026-08-23
---

# BUG Dispatch Teardown Ungrounds Vehicle

**Found by the headless E2E rehearsal** (`scratch/qa_incidents_e2e.mjs`, scenario S2) — not by review, not by the unit suite. 18/19 checks passed with this live.

## What happened

Grounding automation writes `vehicle_status = 'Under Maintenance'` first, then tears down interrupted dispatches. But each teardown goes through `setDispatchStatus` → `syncVehicleStatus()`, which recomputes availability from maintenance records and live trips — **and seeing neither** (no repair record exists yet at report time), it reset the freshly-grounded vehicle straight back to `Available`.

A breakdown report that interrupted a dispatch left a broken vehicle marked available for new assignments. The window was small but the state was wrong in exactly the way this whole feature exists to prevent.

## The tell

The E2E suite's S2 assertion failed while every *adjacent* assertion passed — dispatch flipped to `Pending Reassignment`, audit reason matched, notifications fired. Only the vehicle status was wrong. That signature (automation ran; its first effect was silently overwritten by its second effect) is invisible to unit tests of `shouldGroundVehicle`, which passed throughout.

## Fix

After the teardown loop, `POST /api/driver/incidents` **re-asserts** `Under Maintenance`. Deliberately ordered after the loop rather than making `syncVehicleStatus` incident-aware: grounding is an explicit human-meaningful state here, and the re-assert documents the interaction instead of hiding it inside the derivation.

## Verified

19/19 harness checks pass post-fix, including S2 across a seeded `Scheduled` dispatch inside the Minor-breakdown safety window.

→ [[Debugging Index]] · [[Incidents]] · [[BUG shouldGroundVehicle Is A Stub]]
