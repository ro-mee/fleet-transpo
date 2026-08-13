---
type: moc
title: Home
tags: [moc, home]
source:
  - "(whole repository)"
last_verified: 2026-08-11
---

# Fleet Transpo — Second Brain

> GitHub holds the implementation. **This vault holds my understanding of it.**

**Start here if you have 2 minutes:** [[Current State]]
**Start here if you're lost in the code:** [[Where Is This]]
**Start here if you're new to the repo:** [[System Overview]] → [[Architecture]] → [[Codebase Map]]

---

## The three questions this vault exists to answer

| Question | Go to |
|---|---|
| **How does my project work?** | [[System Overview]] · [[Architecture]] · [[Feature Index]] · [[Database Overview]] |
| **Why does it work this way?** | [[Decision Log]] |
| **What have I learned building it?** | [[Learning Dashboard]] · [[Things I Should Not Forget]] |

---

## Maps of Content

- [[System Overview]] — what Fleet Transpo is and does
- [[Feature Index]] — every module, its files, its tables
- [[Database Overview]] — 37 live tables, verified against the running DB
- [[Codebase Map]] — the repo, directory by directory
- [[Decision Log]] — why things are the way they are
- [[Debugging Index]] — bugs, debt, and doc rot
- [[Learning Dashboard]] — engineering concepts, anchored to real files
- [[Journal Index]] — daily development log
- [[Memory Index]] — long-term project memory

---

## Working with the vault

- [[Daily Workflow]] — 5 minutes: 2 before you code, 3 before you stop
- [[Weekly Review Workflow]] — 20 minutes: the routine that stops this rotting
- [[Claude Workflow]] — how to use Claude *with* the vault

**Templates** (`99 - Templates/`): [[Feature Template]] · [[Bug Template]] · [[Decision Template]] · [[Learning Template]] · [[Daily Development Template]]

---

## Right now

- **Working:** reservation → dispatch → trip pipeline, RBAC, mobile driver app
- **Tests:** 186 passing across 15 files — [[Testing]]
- **Open:** 1 confirmed bug + lint debt — see [[Bugs]]
- **Fixed 2026-08-11:** grounding stub, 3 missing imports, dead root `proxy.js`, vitest install

Full picture: [[Current State]]

---

## Reading conventions

Every note carries an evidence label. **Never trust an unlabeled claim.**

| Label | Meaning |
|---|---|
| **CONFIRMED** | I read the code, the migration, or queried the live DB |
| **INFERRED** | Reasoned from evidence, but not stated anywhere explicitly |
| **UNKNOWN** | Genuinely undetermined — do not guess |
| **TODO** | Needs investigation |

Frontmatter on every code-related note:

```yaml
source:        # repo paths this note describes
last_verified: # when I last checked it against the code
```

When you change code, update the notes whose `source:` lists the file you touched. See [[Quick Reference]] for the upkeep routine.

---

## Vault map

```
00 - Home          entry points, current state, navigation
01 - System        what it is, how it's built
02 - Features      one note per module
03 - Database      schema, tables, migrations
04 - Architecture  frontend, backend, auth, mobile, AI
05 - Codebase      directory-by-directory map
06 - Decisions     ADRs — the "why" layer
07 - Development   debt, bugs, roadmap
08 - Debugging     one note per real problem
09 - Learning      concepts anchored to this codebase
10 - Journal       daily notes
11 - Memory        long-term project memory
99 - Templates     note scaffolds
```
