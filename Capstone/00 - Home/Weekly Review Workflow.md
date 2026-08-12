---
type: workflow
title: Weekly Review Workflow
tags: [workflow, process, maintenance]
source:
  - (this vault)
last_verified: 2026-08-11
---

# Weekly Review Workflow

**Twenty minutes, once a week.** This is the routine that stops the vault becoming what it documents. → [[Documentation Rot]]

Create `10 - Project Journal/Weekly Reviews/YYYY-Www.md`.

## 1. Read the week's daily notes (5 min)

Scan for lines that recur. **A thing mentioned three days running is a real theme**, not a passing annoyance — that's the signal a permanent note is owed.

Promote:

| From a daily line | To |
|---|---|
| Something that clicked | a note in `09 - Learning/` |
| A confirmed defect | `08 - Debugging/Problems/` |
| A choice with alternatives | an ADR |
| A recurring irritation | [[Technical Debt]] |

## 2. Verify the two oldest notes (10 min)

Sort by `last_verified:`. Take the **two oldest** code-related notes. For each:

1. Open the files in its `source:` list
2. Does the note still describe them accurately?
3. Fix it, or delete it, then bump `last_verified:`

Two a week is ~100 a year. That's the whole vault, and it's the only mechanism that keeps `source:`/`last_verified:` honest rather than decorative.

**If a note is wrong and not worth fixing, delete it.** A deleted stale note beats a kept one.

## 3. Update [[Current State]] (3 min)

It must still answer, in under two minutes: what works, what's broken, what you're building, next priority. If it's stale, it's the one note whose staleness costs you the most.

## 4. Prune (2 min)

- [[Open Questions]] — anything answered? Move the answer into the note it belongs to and delete the question.
- [[Roadmap]] — anything done? Anything now obviously wrong?
- Notes you **never opened** this week and didn't need — candidates for deletion, not improvement.

## Write three lines in the weekly note

- What actually moved
- What I now understand that I didn't on Monday
- The one thing to do first next week

## The honest test, monthly

Ask: **"Did the vault save me time this week?"**

If no, three weeks running — cut it back. Keep [[Current State]], [[Things I Should Not Forget]], [[Debugging Index]], and the journal. Those four carry most of the value. Everything else is optional.

A small vault you use beats a complete one you don't. → [[Home]]

## Related

[[Daily Workflow]] · [[Claude Workflow]] · [[Journal Index]] · [[Current State]] · [[Documentation Rot]]
