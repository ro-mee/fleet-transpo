---
type: bug
status: fixed
severity: sev-1
fixed_on: 2026-08-11
tags: [bug, drivers, incidents, business-logic, fixed]
source:
  - src/lib/driver/grounding.js
  - src/lib/driver/grounding.test.js
  - src/app/api/driver/incidents/route.js
  - SYSTEM.md
last_verified: 2026-08-11
---

# Bug: shouldGroundVehicle Is A Stub

> **STATUS: FIXED 2026-08-11.** Kept in full — the *way* this bug survived is more instructive than the bug.

## Symptom — CONFIRMED

**Any** incident report on **any** vehicle grounded that vehicle. A cosmetic scratch removed a van from service exactly as a total engine failure would.

## Root cause — CONFIRMED

`src/lib/driver/grounding.js`, before the fix:

```js
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  return true;
}
```

`incidentType` and `severity` were **accepted and ignored**. The module also exported `BREAKDOWN_RE` and `SEVERE_SEVERITIES` — the two constants implementing the real rule — and **neither was referenced by the function**.

## The real blast radius — CONFIRMED

This was originally filed as "vehicle wrongly marked Under Maintenance". That was too small. The caller at `src/app/api/driver/incidents/route.js:118` does far more than set a status. On every incident, for every vehicle, this bug also:

1. set `vehicle_status` → **Under Maintenance**
2. alerted dispatchers and staff
3. if the vehicle had an active dispatch in the window — **cancelled its trips**
4. **unassigned the driver/vehicle pair**
5. reset the dispatch to **Pending Reassignment** (`route.js:172-178`)
6. sent **URGENT** interruption alerts

So a driver reporting a scratch tore down a live dispatch and paged staff. Sev-1 was the correct rating for the wrong reason.

## The part that makes this a learning moment — CONFIRMED

`grounding.test.js` contained:

```js
it("grounds Minor/Moderate non-breakdown incidents as well", ...)
```

**The test asserted the bug was correct behaviour**, and passed. When the suite was finally installed and run, all 185 tests passed — *including* this one. A green run was not evidence the logic was right.

This is the single most instructive thing in the repo → [[Tests Can Encode Bugs]].

## The intended rule was documented all along — CONFIRMED

My earlier note here said the requirement was unknown and warned to check with the business first. **That was wrong**, and worth recording as a mistake in its own right. The rule is written down in *three* places:

| Where | What it says |
|---|---|
| `src/lib/driver/grounding.js:3-6` | module docstring: "either a breakdown-type report or flagged Major/Critical severity" |
| `src/app/api/driver/incidents/route.js:114-115` | caller comment: "a breakdown-type report OR a Major/Critical severity incident" |
| `SYSTEM.md` §7.3 (at the time, line 457) | flagged the stub explicitly: "*`shouldGroundVehicle` is currently a **stub** … Intended rule in `grounding.js`, actual = always ground*" |

`SYSTEM.md` had **already caught this bug** and written it down. It sat documented and unfixed. No policy decision was ever needed — see [[Documentation Rot]] for the inverse case, where the docs were the thing that was wrong.

> **Pointer updated 2026-08-11.** That `SYSTEM.md` passage was replaced in Phase 3
> item 13 (commit `a654018`) and now describes the fixed rule, so the line
> reference above is historical. The quote is preserved here because it is the
> evidence for this note's central claim; do not go looking for it in the current
> file. Suite is now **197 tests**, not the 186 recorded below.

## The fix — CONFIRMED

```js
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  if (SEVERE_SEVERITIES.has(severity)) return true;
  return BREAKDOWN_RE.test(incidentType ?? "");
}
```

Severity is checked first: it's a `Set` lookup against a trusted enum, cheaper and less ambiguous than a regex over free text.

The bug-encoding test was inverted to assert the documented rule, and a case was added for a **missing** `incidentType` — `BREAKDOWN_RE.test(undefined)` would coerce to the string `"undefined"`, which matches nothing, but relying on coercion is not the same as testing intent. `?? ""` makes it explicit.

Result: **8 tests in this file, 186 across the suite, all passing.**

## Why it happened — INFERRED

The signature and helper constants exist, so the *design* was finished and the *body* was stubbed to unblock the incident-reporting flow. The test was then written against the stub instead of against the design — which is the failure mode that let it survive review and a green suite.

## How to prevent it

- Write the test from the **requirement**, before the implementation.
- Treat an exported-but-unreferenced constant as a smell — it usually means an unfinished body.
- Flag stub bodies with an explicit `// TODO` so grep finds them. This one had no marker anywhere in the source; only `SYSTEM.md` knew.
- When a doc file flags a bug, that flag needs to become a tracked item, or it rots in place.

## Related

[[Debugging Index]] · [[Tests Can Encode Bugs]] · [[Driver Management]] · [[Bugs]] · [[Dispatch State Machine]] · [[Fail Closed By Default]] · [[Documentation Rot]]
