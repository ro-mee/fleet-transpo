---
type: learning
tags: [learning, testing, quality]
source:
  - src/lib/driver/grounding.js
  - src/lib/driver/grounding.test.js
last_verified: 2026-08-11
---

# Concept: Tests Can Encode Bugs

## What it is

A test asserts what its author **believed** correct behaviour was. If that belief was wrong, the test locks the wrong behaviour in — and then defends it, because changing the code now breaks a "passing" test.

A green suite proves *code matches its tests*. It says nothing about whether the tests match reality.

## Why it matters

This is worse than having no test, because a passing test is read as evidence. It converts a bug into a **specification**.

## How it appeared in my project — CONFIRMED

`src/lib/driver/grounding.js`, before the fix:

```js
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  return true;
}
```

`incidentType` and `severity` were destructured and **never read**. Every incident with a vehicle grounded that vehicle — and the caller then cancelled its trips, unassigned the pair, and reset the dispatch to `Pending Reassignment`.

The test file contained:

```js
it("grounds Minor/Moderate non-breakdown incidents as well", …)
```

Read that title. It didn't describe a bug — it described *intent*. Someone wrote the stub, wrote a test asserting the stub's behaviour, watched it pass, and moved on. **The suite passed 185/185 while this bug was live.** → [[BUG shouldGroundVehicle Is A Stub]]

## The twist — the rule was documented all along

The intended rule was written in the module's **own docstring**, in the caller's comment, and in `SYSTEM.md:457-459` — which even flagged the function as a stub. The bug survived because nobody read those, not because the requirement was missing. → [[Documentation Rot]]

## What makes this one hard to catch

The wrong answer is **plausible**. Grounding a vehicle after an incident isn't absurd; it's over-cautious. Nobody files a bug report for "the system was too careful." It surfaces months later as *"why is our fleet availability so low?"* → [[Bugs]]

## The fix — CONFIRMED, 2026-08-11

Both at once:

```js
export function shouldGroundVehicle({ incidentType, severity, vehicleId }) {
  if (!vehicleId) return false;
  if (SEVERE_SEVERITIES.has(severity)) return true;
  return BREAKDOWN_RE.test(incidentType ?? "");
}
```

and the test title now reads the rule, not the code: **"does not ground Minor/Moderate non-breakdown incidents"**. A case for a *missing* `incidentType` was added too — `BREAKDOWN_RE.test(undefined)` coerces to `"undefined"` which matches nothing, but `?? ""` makes the intent explicit instead of accidental.

No policy decision was needed — the requirement was already documented. See the bug note for how I initially got that wrong. → [[BUG shouldGroundVehicle Is A Stub]]

## Common mistakes

| Mistake | Better |
|---|---|
| Writing the test after the code, from the code | Write the assertion from the **requirement**, then the code |
| Test titles that restate the code | Titles that state the rule: *"Minor incidents do not ground"* |
| Treating "all green" as done | Ask what each test would catch if deleted |
| Testing that a stub stubs | If behaviour is undecided, `it.todo()` — don't assert the placeholder |

## The tell

**A test whose title describes an outcome rather than a rule.** "…as well" is a giveaway: it's reporting what happened, not specifying what should.

## The general lesson

When fixing a bug-encoding test, fix it **with** the code — one commit, or the suite turns red and the temptation is to revert the fix instead of the test. The only thing that makes a test trustworthy is that it encodes the requirement, not the implementation.

## Related concepts

[[Testing]] · [[Verification Tooling Can Be Dead]] · [[Documentation Rot]] · [[BUG shouldGroundVehicle Is A Stub]] · [[DEBT Vitest Not Installed]] · [[Learning Dashboard]] · [[Fail Closed By Default]]
