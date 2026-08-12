---
type: learning
tags: [learning, documentation, practice]
source:
  - docs/rbac-model.md
  - SYSTEM.md
  - src/lib/db.js
  - supabase/migrations/023_dispatch_overlap_guard.sql
last_verified: 2026-08-11
---

# Concept: Documentation Rot

## What it is

Documentation decays at a rate set by **how far it sits from the code it describes**. Not by how well it was written.

## Why it matters

Rotted docs are worse than none. Absent documentation makes you read the code. Confident, wrong documentation makes you *skip* reading the code — and it's most convincing exactly where it's most dangerous, because the file that says "authoritative" is the one nobody re-checks.

## How it appears in my project — CONFIRMED

This repository is an unusually clean natural experiment. Every well-documented decision lives **inside the code that implements it**. Every rotted document is a standalone `.md`.

### Accurate — documented in place

| Where | What it explains |
|---|---|
| `src/lib/db.js:56-72` | why `withTransaction` exists, naming the exact constraint |
| `023_dispatch_overlap_guard.sql` header | why a trigger and not `EXCLUDE USING gist` |
| `src/lib/ai/dispatch-advisor.js:11-14` | that the advisor is deterministic and never writes |
| `002_rls_policies.sql:1-12` | ⚠ that RLS is inert |
| `mobile/lib/api.js` | the exact bug single-flight prevents |

### Rotted — standalone files

| Where | What was wrong | State |
|---|---|---|
| `docs/rbac-model.md` | self-labelled **"authoritative"**, claimed 9 roles; there are 6 | **rewritten 2026-08-11**, pinned by a 78-check harness |
| `SYSTEM.md` | referenced `middleware.js` 3× — Next 16 renamed it → [[Framework Version Drift]] | **corrected in place 2026-08-11** |
| four ERDs | included dropped tables; **none contained `transportation_requests`** | **deleted** — `schema.sql` is generated, so it can't rot silently |
| `README.md` | untouched `create-next-app` boilerplate | **rewritten 2026-08-11** |
| mobile tab docs | 3 files, 3 different wrong answers | **fixed 2026-08-13** |
| `AGENTS.md` | its stated reason the supabase CLI breaks is factually false | **fixed 2026-08-13** |

Two things that rewrite taught, both of which generalise:

- **The count in the note describing the rot was itself rotten.** The roadmap said
  two ERDs; there were four. Each schema change had produced a new diagram instead
  of an edited one — which is the rot mechanism reproducing inside the
  documentation *about* the rot.
- **A cited path is a claim.** Six notes in this vault cited
  `src/lib/scheduling/sync.js`, one of them in its `source:` frontmatter. That file
  has never existed. Six copies of one unchecked claim read exactly like six
  confirmations. → [[Mistakes I Made]]

→ [[Debugging Index]]

## The mechanism

A comment next to an implementation **appears in the diff** when that implementation changes. The reviewer sees the stale sentence while they're already thinking about the code. A separate `.md` doesn't appear in that diff, so nothing prompts anyone.

That's the whole difference. Not discipline — **proximity**.

## What this means for this vault

An Obsidian vault is, structurally, the rot-prone kind of documentation. Every note here is a standalone `.md` describing code it doesn't live next to.

The mitigations, all mechanical:

1. **`source:` frontmatter** — every note lists the paths it describes, so you can go check
2. **`last_verified:`** — a date, so staleness is *visible* rather than assumed
3. **CONFIRMED / INFERRED / UNKNOWN** — never lets a guess harden into fact → [[Things I Should Not Forget]]. The label only works if **CONFIRMED means "I opened the file today"**: [[DEBT Ingest Paths Diverge]] carried a CONFIRMED table with two false rows out of six, contradicted by the very file it named as its source.
4. **Explain "why", not "what"** — the *what* rots fastest; reasoning outlives line numbers
5. **The weekly pass** — pick the oldest `last_verified` and re-read the source → [[Weekly Review Workflow]]

**INFERRED but worth stating:** the notes most worth writing here are the ones that *can't* live in the code — cross-file reasoning, decision history, "where is this?" trails. Anything that could be a docstring should be a docstring.

## Common mistakes

| Mistake | Better |
|---|---|
| Labelling a doc "authoritative" | Date it and cite its sources |
| Documenting *what* the code does | Document *why* it does it that way |
| An ERD maintained by hand | Generate it from `information_schema` |
| A doc that duplicates a constant | Link to the file, don't copy the value |
| Never deleting | A deleted stale doc beats a kept one |
| Treating repetition as verification | Six notes repeating one unchecked path is one claim, not six |
| Reading a fixed doc as a fixed *property* | It is a snapshot dated 2026-08-11. Prefer the source. |

## Related concepts

[[Tests Can Encode Bugs]] · [[Framework Version Drift]] · [[Things I Should Not Forget]] · [[Debugging Index]] · [[Weekly Review Workflow]] · [[Learning Dashboard]]
