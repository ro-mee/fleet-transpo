---
type: workflow
title: Daily Workflow
tags: [workflow, process]
source:
  - (this vault)
last_verified: 2026-08-11
---

# Daily Workflow

**Five minutes total.** Two at the start, three at the end. If it ever costs more than that, cut something.

## Before you code (2 min)

1. Open [[Current State]] — what's broken, what's next
2. Create today's note: `10 - Project Journal/Daily Notes/YYYY-MM-DD.md` from [[Daily Development Template]]
3. Write **one line** under "What I worked on" — your intention for the session

That's it. Don't plan in the vault; plan in your head and record the outcome.

## While you code

Capture only when something **surprises** you. Surprise is the signal that you learned something.

| Surprise | Action |
|---|---|
| "That's not how I thought it worked" | Line in the daily note → later a note in `09 - Learning/` |
| "That's broken" | New note in `08 - Debugging/Problems/` from [[Bug Template]] |
| "I chose A over B" | ADR in `06 - Decisions/ADR/` from [[Decision Template]] |
| "Why is this like this?" | Line in [[Open Questions]] |
| "I'll regret this" | Line in [[Technical Debt]] |

**Don't stop to write a good note.** One line in the daily note, keep coding. Expanding it is the weekly job.

## Before you stop (3 min)

1. Fill in "What I learned" and "Problems encountered" — briefly
2. **Write "Next steps" while you still have the context.** This is the single highest-value thing in the whole routine. Tomorrow-you has forgotten everything except what's written here.
3. If you changed code that a note describes, update that note's `last_verified:` — or add it to the weekly list

## The rule that keeps this alive

**Only write an entry on days you actually worked on the project.** Gaps are honest. A journal you feel guilty about is one you abandon. → [[Journal Index]]

## What NOT to do

| Anti-pattern | Why it kills the vault |
|---|---|
| Writing a polished note mid-task | Breaks flow; the note gets abandoned half-written |
| Documenting what the code does | It rots, and the code already says it → [[Documentation Rot]] |
| Daily notes longer than a screen | They're holding something that belongs in a permanent note |
| Restructuring folders | Zero value. Never once helped anyone. |
| Writing notes on days you didn't code | Nothing happened; there's nothing to record |

## Related

[[Weekly Review Workflow]] · [[Claude Workflow]] · [[Journal Index]] · [[Daily Development Template]] · [[Current State]] · [[Home]]
