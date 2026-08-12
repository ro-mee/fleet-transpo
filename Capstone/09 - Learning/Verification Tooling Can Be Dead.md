---
type: lesson
title: Verification Tooling Can Be Dead
tags: [lesson, tooling, verification, debugging]
source:
  - scripts/load-env.mjs
last_verified: 2026-08-11
---

# Verification Tooling Can Be Dead

**The lesson:** a script that verifies something can stop verifying it without
ever failing. It keeps exiting 0. Nothing tells you.

## What happened — CONFIRMED

`scripts/load-env.mjs` is the credential loader every verification script in
this repo calls before touching the database. It had three bugs stacked on top
of each other, and **17 pre-existing scripts** depended on it (19 now, counting
`dump-schema.mjs` and `migrate.mjs`). Verified with
`grep -rl loadEnvLocal scripts/`, discounting the defining file itself.

**Bug 1 — the wrong default file.** It read `.env.local`. This repo has `.env`.
There is no `.env.local`. So the loader read nothing, set no variables, and
returned normally.

**Bug 2 — a UTF-8 BOM.** After fixing the filename it *still* loaded zero keys.
`.env` begins with U+FEFF, so the first line's key parsed as `﻿DATABASE_URL`
— which is not the variable anyone reads.

**Bug 3 — CRLF against a regex that cannot match it.** The file has Windows line
endings and the parser split on `"\n"`, leaving a trailing `\r` on every line.
The value pattern ended in `(.*)$`, and **JavaScript's `.` does not match `\r`**.
So `$` could not be reached on any line that had one. Only the final line — the
one with no trailing CR — ever matched.

Each bug alone was enough to load nothing. Fixing one just exposed the next.

## Why it went unnoticed — CONFIRMED

Because failure looked exactly like success:

```js
try { raw = readFileSync(resolve(process.cwd(), file), "utf8"); }
catch { /* file absent — carry on */ }
```

A missing file was swallowed. A non-matching line was `continue`d. Both are
reasonable in isolation — you *do* want a missing optional env file to be
tolerable, and you *do* want to skip comments. Together they mean "loaded
nothing at all" and "loaded everything fine" are indistinguishable.

The scripts that called it then queried with `process.env.DATABASE_URL`
undefined and failed with a connection error, which reads like a *network*
problem. I spent the early part of the session treating it as one.

## The fix — CONFIRMED

```js
if (!loadedAny) throw new Error(`None of ${list.join(", ")} found — run this from the repo root.`);
```

Plus: a fallback list (`[".env.local", ".env"]`), a BOM strip via
`raw.charCodeAt(0) === 0xfeff`, and splitting on `/\r?\n/`.

The important line is the `throw`. **Loading zero files is now loud.** The other
two fixes are just correctness; that one is the difference between a tool that
can silently stop working and one that cannot.

## The general shape

Three conditions, and this repo had all three:

1. The tool's job is to *check* something, so nobody checks the tool.
2. Its failure mode is a no-op rather than an error.
3. Its output is consumed by something whose own error message points elsewhere.

Ask of anything in this category: **what does it do when it finds nothing, and
does that differ from what it does when it succeeds?** If the answer is "both
exit 0", the tool is not a check yet.

This is the tooling twin of [[Tests Can Encode Bugs]]. There, the suite ran and
asserted the wrong thing. Here, the script ran and asserted nothing. In both
cases the signal was green and meant nothing — and green-but-meaningless is
worse than red, because red gets investigated.

## Related

[[Testing]] · [[Tests Can Encode Bugs]] · [[Technical Debt]] · [[Debugging Index]] · [[Important Commands]]
