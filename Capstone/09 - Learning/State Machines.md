---
type: learning
tags: [learning, architecture, design, state-machines]
source:
  - src/lib/scheduling/trip-state.js
  - src/lib/scheduling/dispatch-state.js
  - src/lib/reservations/
last_verified: 2026-08-11
---

# Concept: State Machines

## What it is

An explicit list of the states a thing can be in, plus the rules for which moves between them are legal. The alternative — a status column plus scattered `if` statements — is a state machine too, just an undocumented one nobody can enumerate.

## Why it matters

Without one, "can this trip go from `ARRIVED` back to `PENDING`?" is answered by grepping for `status =` and hoping you found every write. With one, it's a lookup.

## How it appears in my project — CONFIRMED

Three machines, **three different designs**, and the difference is the interesting part.

| Machine | States | Design | Where |
|---|---|---|---|
| Reservation | 9 | adjacency map + BFS `transitionPath` | `src/lib/reservations/` |
| Trip | 16 | adjacency map | `src/lib/scheduling/trip-state.js` |
| Dispatch | 5 live (3 ranks) | rank + explicit terminal set | `src/lib/scheduling/dispatch-state.js` |

→ [[Reservation State Machine]] · [[Trip State Machine]] · [[Dispatch State Machine]]

## Two techniques worth stealing

### Adjacency map + BFS

The reservation machine stores legal edges and can compute a **path**:

```
transitionPath("Pending", "Dispatched") → the intermediate states to walk
```

Useful when a caller wants an end state and the machine has to legally get there. Costs more code; buys expressiveness.

### Rank monotonicity

The dispatch machine assigns each status a number and permits a move only if rank does not decrease:

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
```

Three things this buys, almost free:

1. **No adjacency table** — one number per state expresses every rule
2. **Equal ranks model aliases** — if two states share a rank, they're mutually reachable and neither can regress
3. **`COMPLETED: 100`** leaves room to insert states later without renumbering

The cost: it cannot express "you may go from A to C but not from B to C" when B sits between them. Ranks encode *ordering*, not arbitrary graphs. Pick the design to fit the shape of the rules. (The Trip machine used to use ranks, but as its lifecycle grew more complex with states like `AT_PICKUP`, it outgrew the pattern and was migrated to an explicit adjacency map).

## The gap worth knowing about — CONFIRMED

`dispatch-state.js`:

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);
export function isValidDispatchStatus(status) {
  return status === "Cancelled" || RANK[status] !== undefined;
}
```

`Cancelled` is special-cased because cancelling is legal from anywhere — a rank can't express that, so it's handled outside the ranking. Reasonable.

But the live DB's `chk_dispatch_status` permits **five** values including `'Pending Reassignment'`, which this function rejects. The database and the state machine disagree about what a dispatch can be. → [[BUG Pending Reassignment Not In State Machine]]

**The lesson:** a state machine in application code is only authoritative if the database agrees with it. Two lists of legal states will drift.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Status as a free-text column | Every typo is a new state |
| Validating transitions in the UI only | The API is the real entry point |
| Duplicating the state list in DB + code | They drift — exactly what happened here |
| No terminal set | "Completed → In Progress" quietly allowed |
| Renumbering ranks to insert a state | Use gaps: 0, 10, 20 |

## Related concepts

[[Reservation State Machine]] · [[Trip State Machine]] · [[Dispatch State Machine]] · [[Pure Core Imperative Shell]] · [[Trips]] · [[Learning Dashboard]]
