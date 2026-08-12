---
type: debt
status: resolved
severity: sev-3
tags: [debt, docs, resolved]
source:
  - README.md
resolved: 2026-08-11
resolved_by: a654018
last_verified: 2026-08-11
---

# Doc Rot: README Is Boilerplate

> **RESOLVED 2026-08-11** (roadmap Phase 3, item 13 — commit `a654018`).

## The problem — was CONFIRMED

`README.md` is the default **`create-next-app`** output, unmodified.

It describes a fresh Next.js starter — generic `getting-started` instructions, the default Tailwind/next/fonts boilerplate. It says nothing about: what this system does (fleet & transportation for a hotel), how to run it against Supabase, the two-client mobile app, the migration procedure, or the auth model.

## Why it's dangerous

The README is the first file a new developer opens. This one teaches *nothing* about the system and wastes their time with instructions that don't apply (e.g. "run `npm run dev`" works, but setup is `AGENTS.md`'s story, and env setup is [[Environment Setup]]).

## What was actually done

Rewritten to roughly the shape this note proposed, drawing on [[System Overview]]:
the two-apps table (web `src/` Next.js 16 / mobile `mobile/` Expo SDK 54), the
six roles, setup, the command list, the database section, the layout tree, and
links onward to `SYSTEM.md` / `AGENTS.md` / `docs/rbac-model.md`.

Two things went in that the plan above did not anticipate:

- **The migration warning belongs in the README, not just `AGENTS.md`.** That the
  `supabase` CLI is unusable here and the web SQL editor silently targeted the
  wrong project is the kind of thing that costs an afternoon if you meet it by
  discovery. It is now stated where it will be read first.
- **The RLS caveat.** "RLS is inert and is not the security boundary" is stated
  in the database section, because a reader who assumes otherwise will
  mis-reason about every route.

One detail the old boilerplate had actively wrong: the title was mangled
mid-line. Worth noting because it means the file was edited *once*, badly, and
then abandoned — not simply left untouched.

**The Node floor needed sourcing.** The rewrite says Node 20.9+. That is Next
16's own `engines` requirement, not this repo's — `package.json` here declares no
`engines` field at all. Stating an unsourced version number would have been a
smaller version of the same rot this note is about, so the README attributes it.
Adding `engines` to `package.json` is a real (small) open item.

## Related

[[Documentation Rot]] · [[System Overview]] · [[Quick Reference]] · [[Debugging Index]] · [[Technical Debt]]
