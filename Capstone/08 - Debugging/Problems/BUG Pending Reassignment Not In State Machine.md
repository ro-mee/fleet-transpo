---
type: bug
status: fixed
severity: sev-2
tags: [bug, dispatch, state-machine, schema-drift]
source:
  - src/lib/scheduling/dispatch-state.js
  - src/lib/constants.js
  - src/app/(dashboard)/dispatch/page.js
  - src/app/api/dispatch/[id]/route.js
  - src/app/api/driver/incidents/route.js
  - supabase/migrations/012_status_constraints.sql
  - supabase/migrations/033_dispatch_pending_reassignment.sql
last_verified: 2026-08-11
---

# Bug: Pending Reassignment Not In State Machine

> **FIXED 2026-08-11** — both gaps closed, see [[BUG Pending Reassignment Not In State Machine#The fix as built]]. Kept
> because the reasoning error in the first version is the useful part.

> **Reframed 2026-08-11.** The first version of this note called `'Pending Reassignment'` an orphan state that "nothing sets" and that leaves rows in a dead end. **That was wrong on both counts** and is corrected below. The real defect is narrower and still open.

## What is actually true — CONFIRMED

`'Pending Reassignment'` is a **fully implemented, first-class product state**. It is written, read, displayed, and exited:

| Role | Location |
|---|---|
| Declared | `src/lib/constants.js:128` — `DISPATCH_STATUS.PENDING_REASSIGNMENT` |
| **Written** | `src/app/api/driver/incidents/route.js:175` — grounding automation sets it |
| Returned by API | `src/app/api/dispatch/by-status/route.js:92` |
| **First lane on the board** | `src/app/(dashboard)/dispatch/page.js:65` — tone `danger` |
| Stat card | `src/app/(dashboard)/dispatch/page.js:266` — trend "needs urgent action" |
| Card rendering | `src/components/dispatch/dispatch-card.jsx:207` |
| **Exited** | `src/app/api/dispatch/[id]/route.js:150-155` — auto-returns to `Scheduled` when a vehicle or driver is reassigned |

So it is not a dead end: assigning a replacement vehicle or driver transitions it back to `Scheduled` automatically. It is the most operationally urgent state on the dispatch board.

## The real defect — CONFIRMED

Two narrower gaps around an otherwise working feature:

**1. The state-machine validator rejects it.** `src/lib/scheduling/dispatch-state.js`:

```js
const RANK = { Scheduled: 0, "In Progress": 1, Completed: 100 };
const TERMINAL = new Set(["Completed", "Cancelled"]);

export function isValidDispatchStatus(status) {
  return status === "Cancelled" || RANK[status] !== undefined;
}
```

`isValidDispatchStatus('Pending Reassignment')` → **`false`**, for a value the app itself writes and the DB accepts. Any code path that validates before transitioning will refuse a legitimate row.

**2. Schema drift.** The live `chk_dispatch_status` constraint (queried 2026-08-11 via `pg_constraint`) permits **five** values including this one. `supabase/migrations/012_status_constraints.sql:56` permits only **four**:

```sql
chk_dispatch_status CHECK (status IN ('Scheduled','In Progress','Completed','Cancelled'))
```

The live constraint was widened outside the migration files. Rebuilding this DB from migrations would produce a schema that **rejects rows the application writes** — the grounding automation would start failing on insert. → [[DEBT Schema Drift From Migrations]]

## Why the first reading was wrong — worth recording

I searched `dispatch-state.js` and the migrations, found nothing, and concluded the state was vestigial. I had not grepped the whole `src/` tree. One grep for the literal string would have found six files.

**The lesson:** absence of a value from the state machine is not evidence of absence from the product. Grep the string across the entire codebase before calling anything dead. This is the same class of error as trusting a migration file over `pg_constraint` — reasoning from one authoritative-looking source instead of checking all of them. → [[Documentation Rot]]

## The fix as built

The planned fix above said "add it to `RANK`". **That turned out to be the
wrong shape**, and finding out why was the interesting part.

`RANK` encodes a monotonic ladder — `canTransitionDispatch` compares
`RANK[to] > RANK[from]`. But this status is entered from **either**
`Scheduled` or `In Progress`, and exits back to `Scheduled`. That is a
**cycle**, and no single integer can express a cycle on a ladder. Any rank
chosen would have permitted at least one nonsense transition.

So it is modelled as an **off-ladder interrupt state** instead:

```js
const INTERRUPT = new Set(["Pending Reassignment"]);

// enter: legal from any on-ladder state
if (INTERRUPT.has(to)) {
  if (RANK[from] === undefined) return { ok: false, ... };  // not from terminal
  return { ok: true };
}
// exit: never a bare status flip
if (INTERRUPT.has(from)) return {
  ok: false,
  reason: `Dispatch is ${from}; reassign resources to move it back to Scheduled.`,
};
```

`Cancelled` was already handled this way, so this follows the module's own
existing precedent rather than inventing a mechanism.

Deliberate design choice: **leaving the state requires a reassignment, not a
status edit.** A bare flip back to `Scheduled` is refused, because a dispatch
is in this state precisely because its driver or vehicle is gone — flipping
the label without attaching new resources would produce a "Scheduled"
dispatch with nothing scheduled.

- `isValidDispatchStatus` now accepts it (it previously returned `false`).
- Migration `033_dispatch_pending_reassignment.sql` declares the 5th value
  that live `chk_dispatch_status` already enforced and `012:55` never did.
- `dispatch-state.test.js` gained 5 tests: valid status, interrupt from both
  active states, cancellable while stranded, refuses the bare flip back,
  unreachable from terminal. Suite is 9 tests / 191 repo-wide.

**Verified no regression:** `updateDispatchStatus` has exactly 2 call sites
and both pass `D.CANCELLED`, so the stricter exit rule breaks no caller.

## Why it happened

The repository does not currently document why this decision was made. INFERRED: the state was added with the incident-grounding feature, wired through the API and UI, but the pure state-machine module and the migrations were never updated to match — the feature worked without them, so nothing forced the issue.

## How to prevent it

- **Never `ALTER` the live DB by hand.** Write a migration and run
  `npm run db:up` — see [[Migrations]].
- `npm run db:dump` makes this class of drift **visible in a git diff**: the
  widened constraint would have shown up in `schema.sql` the moment anyone
  regenerated it. That is the durable guard, not vigilance.
- Add a check that diffs live `CHECK` constraints against the state-machine constants — it would catch both gaps at once.
- Derive status lists from `src/lib/constants.js` rather than re-declaring them per module.

## Related

[[Dispatch State Machine]] · [[Dispatch]] · [[dispatchschedules]] · [[DEBT Schema Drift From Migrations]] · [[Debugging Index]] · [[BUG shouldGroundVehicle Is A Stub]] · [[State Machines]]
