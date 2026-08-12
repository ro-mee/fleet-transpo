---
type: memory
title: Things I Learned
tags: [memory, learning]
source:
  - (see linked notes)
last_verified: 2026-08-11
---

# Things I Learned

Running list. One line each — the detail lives in the linked note. Add to this whenever a daily note contains something under "What I learned."

## From this project

- **A green test suite proves the code matches its tests, nothing more.** `grounding.test.js` asserts a stub's behaviour is correct → [[Tests Can Encode Bugs]]
- **Documentation rots at a rate set by distance from the code.** Docstrings here are accurate; standalone `.md` files aren't → [[Documentation Rot]]
- **RLS enabled ≠ RLS enforcing.** 71 policies, zero effect, because both DB paths connect privileged → [[Why RLS Is Not A Boundary]]
- **Check-then-act across a network is always a race.** Only a lock-holding database can close it → [[TOCTOU And Advisory Locks]]
- **A pool hands out a *different connection per call*** — so `BEGIN`/`COMMIT` through a pool helper commits nothing → [[Connection Pooling vs Transactions]]
- **Rank monotonicity can replace an adjacency table** for linear workflows, and equal ranks express aliases for free → [[State Machines]]
- **Half-open intervals `[start, end)`** are why back-to-back bookings don't falsely conflict → [[Half Open Intervals]]
- **A nullable column in a safety check fails open** — SQL three-valued logic drops the row → [[Half Open Intervals]]
- **An LLM can be in a product without making it nondeterministic** — rules decide, the model narrates, narration is nullable → [[Deterministic Core With Nullable Narration]]
- **An anti-corruption layer's job is refusing concepts you don't have**, not just renaming fields → [[Anti-Corruption Layer]]
- **404-not-403 defeats id enumeration** when ids are sequential integers → [[Anti Enumeration 404 vs 403]]
- **Token rotation creates a concurrency bug** that looks like random logouts; single-flight is the fix → [[Token Rotation And Refresh Races]]
- **A renamed *file convention* fails silently** — the old file still exists and simply stops being called → [[Framework Version Drift]]
- **A layer you can't describe the failure of isn't a layer** → [[Defence In Depth]]
- **Defaults are what you get when someone forgets** — so `DEFAULT_ROLES` excluding `driver` is load-bearing → [[Fail Closed By Default]]

## About working on this codebase

- The **live database is the source of truth**, not the migration files → [[Debugging Techniques]]
- The best documentation in this repo is in **docstrings and migration headers**, not `docs/`
- Reading `src/lib/<domain>/` first is the fastest way to understand a feature — pure logic, no I/O → [[Pure Core Imperative Shell]]

## Related

[[Learning Dashboard]] · [[Mistakes I Made]] · [[Debugging Techniques]] · [[Journal Index]] · [[Home]]
