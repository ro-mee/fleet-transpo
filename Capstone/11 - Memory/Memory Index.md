---
type: moc
title: Memory Index
tags: [moc, memory]
source:
  - (see individual notes)
last_verified: 2026-08-11
---

# Memory Index

Project memory — the things that don't belong in code, don't belong in a feature note, and would otherwise be lost between sessions.

## If you're coming back after a break

1. **[[Things I Should Not Forget]]** ← start here, always
2. [[Current State]] — what works, what's broken, what's next
3. [[Important Commands]] — how to actually run things

## The sections

| Note | What goes in it |
|---|---|
| [[Things I Learned]] | Concepts that clicked. One line each, linked to `09 - Learning/` |
| [[Mistakes I Made]] | Errors and the lesson — written from repo evidence, not guessed intent |
| [[Bugs]] | Confirmed defects, with severity and fix order |
| [[Decision Log]] | Every ADR, with an evidence-quality column |
| [[Things I Still Don't Understand]] | Honest UNKNOWNs — what stops inference hardening into fact |
| [[Questions For Later]] | Non-blocking. Would change the *next* version |
| [[Technical Debt]] | Ranked by cost-of-leaving × cost-of-fixing |
| [[Things That Might Break]] | Ranked by likelihood × time-to-diagnose |
| [[Important Commands]] | Including the only working DB procedure |
| [[Environment Setup]] | What's in `.env`, what's missing, what it costs |
| [[Deployment Knowledge]] | Mostly UNKNOWN, and marked as such |
| [[Debugging Techniques]] | What actually worked on *this* codebase |
| [[Useful Code Patterns]] | Established patterns — reuse rather than reinvent |
| [[Things I Should Not Forget]] | The five things that will cost you hours |

## How this stays useful

**Append, don't rewrite.** These are logs. A [[Mistakes I Made]] you edit into a tidy summary loses the specifics that made it worth keeping.

**Move things out when they graduate.** A concept in [[Things I Learned]] that grows past a line becomes a note in `09 - Learning/`. A question in [[Questions For Later]] that starts blocking moves to [[Open Questions]].

**Delete what's resolved.** An answered UNKNOWN becomes a CONFIRMED sentence in the relevant note, and disappears from here. A shrinking list is the goal.

## Why memory is separate from documentation

The rest of this vault describes **the system**. This folder describes **you working on the system** — what confused you, what you tried, what you'd do differently. That's the part no amount of re-reading the code recovers. → [[Journal Index]]

## Related

[[Home]] · [[Journal Index]] · [[Current State]] · [[Learning Dashboard]] · [[Debugging Index]]
