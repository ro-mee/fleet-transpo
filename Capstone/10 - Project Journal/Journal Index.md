---
type: moc
title: Journal Index
tags: [moc, journal]
source:
  - (this vault)
last_verified: 2026-08-22
---

# Journal Index

The journal is where **understanding accumulates**. Everything else in this vault describes the system as it is; this describes your learning as it happens.

## The rule that keeps this alive

Only write an entry on a day you **actually worked on the project**. A journal with gaps is honest. A journal you feel guilty about is one you abandon. → [[Home]]

## Daily Notes

`10 - Project Journal/Daily Notes/YYYY-MM-DD.md`, from [[Daily Development Template]].

Five headings, and the useful move is to write the last two first:

- What I worked on
- What I learned
- Problems encountered
- Decisions made
- **Next steps** ← write this before you stop, while you still have the context

Existing:
- [[2026-08-11 Phase 1 Roadmap]] — first code changes: grounding bug, three missing imports, dead `proxy.js`, vitest running
- [[2026-08-11 Phase 2 Schema Reproducibility]] — same day, continued: `no-undef` on (and a 4th missing import), `schema.sql` checked in, migrations 033–035, a `schema_migrations` ledger, and a leaked DB password found in git history
- [[2026-08-11 Phase 3 Deletion And Unification]] — same day, continued: `vehiclereservations` dropped, both ingest doors unified behind one writer, `README`/`rbac-model`/`SYSTEM` rewritten, four stale ERDs deleted. Lesson that cost the most: the test suite and lint both pass with a deleted symbol still imported
- [[2026-08-19]] — mobile real per-leg km + odometer (Phase 1), start-odometer capture, fresh-mileage-before-complete, and background GPS tracking (Phase 2) via `expo-task-manager`. Superseded [[ADR-010 Foreground Only GPS]] with [[ADR-011 Background GPS Tracking]]. Prebuild ran; device rebuild/reinstall pending.
- [[2026-08-22]] — security/CI hardening, Gemini-only mobile fuel receipt scanning, automatic fuel-log odometer, direct navigation camera shortcut, honest analytics empty states, and recoverable mobile location failures.
- [[2026-08-25]] — Tesseract fully replaced by Gemini structured extraction for licence/OR-CR/insurance scanning (shared `gemini-document.js`, server-only, tesseract.js removed).

## Weekly Reviews

`10 - Project Journal/Weekly Reviews/YYYY-Www.md`. Twenty minutes, once a week. → [[Weekly Review Workflow]]

## Milestones

`10 - Project Journal/Milestones/`. Not "finished a feature" — **the moments where your understanding of the system changed**. Those are rarer and worth more.

Existing:
- [[2026-08-11 Vault Established]]

## What belongs where

| Observation | Goes to |
|---|---|
| "Spent 2 hours on X today" | Daily note |
| "I now understand how Y works" | Daily note → then a note in `09 - Learning/` |
| "Found a bug" | `08 - Debugging/Problems/` from [[Bug Template]], linked from the daily note |
| "Chose approach A over B" | An ADR in `06 - Decisions/ADR/`, linked from the daily note |
| "I don't understand Z" | [[Open Questions]] |

**The daily note links; it doesn't duplicate.** A daily note that grows past a screen is holding something that belongs in a permanent note.

## Why this matters more than it looks

The journal is the only part of the vault that records **why you did things in the order you did**. Six months from now, the code shows what exists; the ADRs show what was decided; only the journal shows what you tried first, what confused you, and what you'd do differently. → [[Things I Learned]] · [[Mistakes I Made]]

## Related

[[Home]] · [[Daily Development Template]] · [[Weekly Review Workflow]] · [[Daily Workflow]] · [[Current State]]
