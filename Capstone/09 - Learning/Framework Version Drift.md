---
type: learning
tags: [learning, nextjs, maintenance]
source:
  - src/proxy.js
  - proxy.js
  - SYSTEM.md
  - package.json
last_verified: 2026-08-11
---

# Concept: Framework Version Drift

## What it is

A framework changes a convention between major versions. Your code follows the new one; your documentation, your habits, and every tutorial you've read still describe the old one.

The dangerous case isn't a renamed function — that errors loudly. It's a renamed **file convention**, because the old file keeps existing and simply stops being called.

## Why it matters

A file that is never loaded produces no error. It sits in the repo looking authoritative, gets read during onboarding, gets *edited* during debugging, and none of it does anything.

## How it appears in my project — CONFIRMED

Next.js 16 renamed `middleware.js` → **`proxy.js`**, and the exported function `middleware()` → `proxy()`.

Consequences in this repo:

| Fact | Status |
|---|---|
| `src/middleware.js` does not exist | CONFIRMED |
| `src/proxy.js` — 594 B, the **active** one | CONFIRMED |
| root `proxy.js` — 1989 B, **never loaded** | CONFIRMED |
| `SYSTEM.md` references `middleware.js` 3× | CONFIRMED |

The root `proxy.js` is the worst kind of dead file: it isn't a stub, it's a *complete, plausible implementation* using `@supabase/ssr` cookie auth — a model this project **does not use**. Read it and you'd conclude auth works in a way it doesn't. → [[BUG Root proxy.js Is Dead Code]] · [[Authentication]]

Only `src/proxy.js` is picked up, because the convention is rooted at `src/` when `src/` exists. The root file is invisible to the framework and visible to you. **Delete it.**

## Why this class of drift is hard to catch

| Signal you'd normally rely on | Why it's silent here |
|---|---|
| A crash | The file just isn't loaded |
| A lint error | It's valid JavaScript |
| A failing test | No test covers proxy behaviour → [[DEBT Vitest Not Installed]] |
| Types | Plain JS |
| Docs | They describe the *old* convention → [[Documentation Rot]] |

Every automatic signal is absent. That's why `AGENTS.md` opens with the instruction to read `node_modules/next/dist/docs/` before writing code: for a framework this far from its documented-on-the-internet self, the installed package is the only current source.

## The general rule

**On a major upgrade, grep for the old convention rather than trusting that the build passed.** A green build proves the new path works. It proves nothing about whether an old file is still lying to you.

Concretely, after any framework major bump: search for the old filenames, the old export names, and the old config keys, and delete or migrate every hit — including in documentation.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Assuming the build catches renamed conventions | It won't — the old file is just ignored |
| Keeping the old file "for reference" | Someone will read it as truth |
| Trusting tutorials over installed docs | Most of the internet predates the change |
| Not updating docs in the upgrade PR | Instant rot |
| Two files with the same name in different roots | Nobody can tell which one runs |

## Related concepts

[[Documentation Rot]] · [[BUG Root proxy.js Is Dead Code]] · [[Technology Stack]] · [[Architecture]] · [[Learning Dashboard]]
