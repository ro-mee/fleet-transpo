---
type: workflow
title: Claude Workflow
tags: [workflow, process, ai]
source:
  - (this vault)
last_verified: 2026-08-11
---

# Claude Workflow

How to use Claude **with** this vault rather than alongside it. The vault's job is to be the context you'd otherwise have to re-explain every session.

## Starting a session

Point Claude at the notes that make it useful immediately:

> Read `Capstone/00 - Home/Current State.md` and `Capstone/11 - Memory/Things I Should Not Forget.md` before we start.

Those two carry the traps that would otherwise be re-discovered: RLS is inert, the live DB ≠ the migrations, `middleware.js` doesn't exist (Next 16 → `src/proxy.js`), `no-undef` is off so unimported identifiers ship silently.

For focused work, add the relevant note — `Capstone/02 - Features/Dispatch.md` before touching dispatch.

## The rules that made this vault trustworthy

Hold Claude to the same standard the vault holds itself to:

| Rule | Why |
|---|---|
| **Label CONFIRMED / INFERRED / UNKNOWN** | Stops a plausible guess hardening into a fact you build on |
| **Cite file paths for claims** | Makes every claim checkable in ten seconds |
| **Verify against the live DB, not the migration files** | The single most valuable habit here → [[Debugging Techniques]] |
| **Don't assume filenames describe behaviour** | Root `proxy.js`, `vehiclereservations`, `services/` — all misleading |
| **"The repository does not document why"** over a plausible reason | A fabricated rationale is worse than an admitted gap |

## Good asks

- *"Verify `Capstone/02 - Features/Dispatch.md` against the current code and tell me what's stale."* — the weekly job, done fast
- *"I'm about to change `trip-state.js`. Which notes reference it?"* — `source:` frontmatter makes this a grep
- *"Draft a bug note from `99 - Templates/Bug Template.md` for what we just found."*
- *"Query `pg_constraint` for `dispatchschedules` and compare it to `isValidDispatchStatus`."* — the drift check
- *"What in `Things That Might Break` applies to the file I'm editing?"*

## Bad asks

| Ask | Why it goes wrong |
|---|---|
| "Document this codebase" | Produces generic prose. The value here was *verification*, not description. |
| "Fill in the empty notes" | Empty is honest. Invented content is the failure mode this vault exists to avoid. |
| "Explain how auth works" (no files) | You'll get NextAuth-in-general, not this project's Bearer-over-cookie precedence |
| "Make the graph look better" | Fake links destroy the graph's signal |

## After Claude changes code

Two steps, ~30 seconds:

1. Ask: *"Which notes list the files we just changed in `source:`?"*
2. Update those notes, bump `last_verified:`

That closes the loop that kills every other documentation system — the change happening without the doc knowing. → [[Documentation Rot]]

## Sync policy — how this vault stays true

**Nothing updates the vault automatically.** No git hook, no CI, no plugin. Verified 2026-08-11: `.git/hooks/` has only samples, there is no `.github/workflows/`, and `Capstone/` is untracked (0 files in `git ls-files`). Every note is as accurate as the last time a human or Claude touched it.

That is deliberate — the vault holds *understanding*, and understanding can't be generated from a diff. But it means staleness is the default, so the cadence below is the whole mechanism:

| When | What | Cost |
|---|---|---|
| **After any code change** | The 2 steps above — grep `source:`, bump `last_verified:` | 30 sec |
| **End of a work session** | Daily note: what surprised you, what's next → [[Daily Workflow]] | 3 min |
| **Weekly** | Verify the oldest `last_verified:` notes against code → [[Weekly Review Workflow]] | 20 min |
| **After a Roadmap phase** | Update [[Current State]], [[Bugs]], [[Roadmap]]; write a [[Journal Index]] milestone if your understanding changed | 15 min |

**The one non-negotiable:** [[Current State]] must be true. Everything else can lag a little; that note is what you and Claude both read first, so a stale line there propagates into every decision made afterwards.

### The failure this vault already caught

On 2026-08-11 this exact loop failed and was caught. The vault said the grounding rule was undocumented (it was documented in three places, including `SYSTEM.md:457-459`) and that `'Pending Reassignment'` was a status nothing sets (six files set, read, and display it). Both were written confidently, both were wrong, both were found only by running the code.

**So: treat the vault as a strong prior, not as truth.** When a note and the code disagree, the code wins and the note gets fixed — that is the *point* of `source:` and `last_verified:`, and it's the standing instruction in this project's memory. → [[Mistakes I Made]]

## Asking for a vault sync

When you want the vault caught up rather than the code changed:

> *"We changed X. Update the vault — find every note whose `source:` includes those files, verify the claims against the current code, and fix what's stale."*

Or scoped to a phase:

> *"Phase 2 is done. Update [[Current State]], [[Roadmap]], [[Bugs]], and any note referencing the migration files we touched."*

Expect the answer to include what was **removed** as well as added. A sync that only adds is a sync that didn't check.

## What the vault gives Claude that a fresh session lacks

- The **four silent behaviours** (mock gateway, null narration, OCR `""`, priority fallback) — none produce errors, all change conclusions
- The **open bugs**, so they aren't re-derived or worse, "fixed" incorrectly → [[Bugs]]
- The **established patterns** in [[Useful Code Patterns]], so new code matches existing code
- The **environment constraints** — no `psql`, no docker, no supabase CLI → [[Important Commands]]

## Related

[[Daily Workflow]] · [[Weekly Review Workflow]] · [[Things I Should Not Forget]] · [[Current State]] · [[Home]]
