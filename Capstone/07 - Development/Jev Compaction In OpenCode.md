---
type: note
title: Jev-Guided Compaction In OpenCode
tags: [tooling, ai, context, opencode]
source:
  - ~/.config/opencode/plugin/jev-compaction.ts
  - ~/.config/opencode/lib/fast-jev-compaction/
  - ~/.config/opencode/opencode.json
  - ~/.config/opencode/opencode.jsonc
  - .agents/skills/fast-jev-compaction/
last_verified: 2026-09-29
---

# Jev-Guided Compaction In OpenCode

Session compaction in OpenCode runs through a **global plugin** that asks
TypeSafe Jev which tool calls still matter, then hands OpenCode's own summarizer a
Jev-reduced transcript. The summarizer is still OpenCode's; what changed is what it
is allowed to see.

## The problem this solves

OpenCode's built-in compaction is an LLM writing a lossy summary. It drops file
paths, exact error strings, and commands — the three things a next turn most needs.
`fast-jev-compaction` (already vendored at `.agents/skills/fast-jev-compaction/`)
solves this by **never rewriting user or assistant text**: it prunes tool calls and
tool results, and pins the first and newest messages untouched.

**The skill alone does nothing here.** Its automatic path is a *Claude Code
function-hook plugin* (`hooks/hooks.json` → `hooks/fast-jev.ts`, intercepting
`session.compact` and `turn.complete`). OpenCode does not load Claude Code function
hooks, so the library was present and inert. Before this change, compaction in
OpenCode was plain built-in LLM summarization.

## How it is wired

| Piece | Where | Role |
|---|---|---|
| `plugin/jev-compaction.ts` | `~/.config/opencode/plugin/` | The hook. Auto-loaded from the plugin dir. |
| `lib/fast-jev-compaction/` | `~/.config/opencode/lib/` | Vendored ESM build of the library + a hand-written `index.d.ts` shim. |
| `compaction` | `opencode.json` | `auto: true`, `prune: true`, `tail_turns: 6`. |
| `TYPESAFE_API_KEY` | user env var | Jev auth. Already set. |

The library is vendored rather than imported from the project because a **global**
plugin must not depend on one project's `.agents/` directory — it loads in every
directory. It is dependency-free ESM, so a file copy works.

## The hook, in order

`experimental.session.compacting` is the only compaction hook OpenCode 1.18 exposes.
It is genuinely limited: it can append to `output.context` or replace `output.prompt`
entirely, and **nothing else** — no transcript surgery. So the design is:

1. `client.session.messages({ path: { id: sessionID } })` — read the live transcript.
2. Map SDK parts → the library's `Message[]`. Each finished `ToolPart` becomes one
   `toolUse` **plus** one `toolResult` sharing a `callID` as `tool_use_id`, because
   the SDK keeps a call and its result inside a single part while the library pairs
   them by id. `compaction` parts are skipped.
3. `compact(messages, new JevClient({apiKey}), options)` — Jev returns two
   `noul` probabilities per tool call (`keepCall`, `keepResult`); the library applies
   `keepResult >= 0.5` → keep both, `keepCall >= 0.5` → truncate result to 300 chars +
   note, else drop the call and its result together.
4. Render the surviving transcript and append it to `output.prompt` under a
   `=== JEV-REDUCED TRANSCRIPT ===` header, with a note that dropped material should
   not be "recovered" — the agent can re-run the tool.

**This is a combination, not a replacement.** Jev decides; OpenCode still writes the
summary. `output.context` is *not* used for the transcript because it is ignored
whenever `output.prompt` is set — verified against the docs, and it is the reason the
transcript goes in the prompt.

## The goal override — the one non-obvious decision

The library defaults its Jev `goal` to **the last three user messages**. In a long
session those are acknowledgements ("ok", "thanks", "no"), which makes "does this
still matter?" unanswerable. `goalFrom()` overrides it with the **first substantive
user prompt** (>20 chars), which is the task the session is actually working on —
plus the Q&A ledger described below.

Measured on a synthetic transcript, anchoring the goal moved the relevant call's
`keepCall` from **0.30 → 0.43**. Trailing filler was tried first and *diluted* the
signal, so it is excluded. `keepThreshold` stays at the library's calibrated 0.5.

## Feature 1 — the Q&A ledger feeds the goal

The plugin hooks `tool.execute.before` / `tool.execute.after` for the built-in
`question` tool and keeps a per-session ledger of every clarifying question the agent
asked **and the answer the user gave**. That ledger is appended to the Jev `goal`.

Why this is the highest-signal thing available: by the time a clarifying question is
asked, the agent already knows the shape of the problem, so the question is a sharper
statement of intent than the opening prompt. Concretely, in the session that produced
this plugin, the fact that had to survive compaction was "the user wants the free
Muse Spark as default" — and that fact exists *only* as an answer to a question, never
as prose anyone typed.

The `question` tool call is itself just another tool call, so Jev is free to drop it as
stale. Capturing Q&A out-of-band keeps the answer alive independently of that verdict —
which is the same reason this exists rather than just letting the transcript speak.

`question.asked` / `question.replied` exist on the event bus but are **absent from the
plugin docs' event list**, so this hooks the tool and correlates before→after by
`callID`. Ledger is capped at 12 entries per session, trimmed from the front.

Verified end to end: the logged goal contained
`Decisions the user already made by answering questions: - Which OpenCode Zen model
should be the default? / user chose: ["opencode/muse-spark-1.3-contributor-free"]`.

The `goal` is now logged in full on every compaction. It decides every keep/drop
verdict, so when a drop looks wrong this is the first thing to check.

## Feature 2 — advisory pre-flight on the question, never auto-answer

Before a question dialog renders, Jev is asked against the live transcript:

| Question | Type | Use |
|---|---|---|
| `already_answered` | `noul` | Append "this looks already answered by earlier context" when ≥ 0.6 |
| `recommend` | `choice` | Tag the winning option's description with its probability, when confidence ≥ 0.6 |

**It does not reorder, does not pick, and does not answer.** The user keeps the click.
This is a deliberate constraint rather than a missing feature: silently answering
"which model should be my default" on a hunch would take a decision away from the one
person entitled to it, and no confidence score makes that safe. The only mutations are
two appended strings.

Verified on a state where the user had already said "only free, and stop asking me to
confirm": `alreadyAnswered: 0.64`, `recommend: opencode/muse-spark-1.3-contributor-free`
at confidence 0.85. Result — option order unchanged, nothing pre-selected, exactly one
option tagged `(Jev: strongest match, p=0.91)`, and the redundancy note added to the
question text.

Threshold calibration is worth recording because it was wrong on the first guess: an
arbitrary 0.75 for `already_answered` would have **missed** the one measured case. It
is now 0.6, justified by that single observation rather than a distribution. The
failure is silent, so it should be revisited once real sessions exist.

Both question types were verified against live Jev first; `choice` returns `choice`,
`confidence`, **and** per-option `probabilities`, which is what makes a per-option tag
possible without a second call.

Gates before Jev is consulted at all: a key must exist, exactly one question, and at
least two options. A 2.5s `withTimeout` bounds the wait, because a hung advisory would
freeze the dialog with no way out. Every failure leaves the dialog exactly as the agent
wrote it.

## Fallback

Every failure path degrades to the previous prompt-only compaction rather than
blocking: no `TYPESAFE_API_KEY`, an empty transcript, a Jev HTTP/JSON error, or a
history too large to fit `maxStateTokens`. `keepThreshold` and the rest are the
library's `userConfig` defaults, not tuned.

Each run logs to `client.app.log` under service `jev-compaction`: on success the
counts, reduction ratio, state tokens/stage, request count, elapsed ms and the full
`goal`; on failure the reason. Advisory runs log separately as
`Jev advisory attached` with the scores and whether anything was annotated.

## Verified

- `tsc --noEmit` clean against `@opencode-ai/plugin` + `@opencode-ai/sdk` types.
- Live Jev call: 1 request, ~340–420 ms, real `noul` probabilities returned.
- Hook run against a stubbed client with a realistic 12-row transcript: prompt set,
  reduced section present, `compaction` parts excluded, tool output rendered, counts
  logged.
- Fallback with the key removed: prompt-only, no reduced section.
- Feature 1: the Q&A ledger appears in the logged `goal` (question + chosen answer).
- Feature 2: order unchanged, nothing pre-selected, exactly one option tagged; both
  the option tag and the redundancy note fire on a strong state; both correctly stay
  silent on a weak one (confidence 0.23 → `annotated: false`).
- `opencode debug config` shows the plugin resolved once (global scope) and the
  compaction block merged. `opencode run` completes with no plugin load error.

**Not verified:** a real auto-compaction inside a live long TUI session, and a real
question dialog rendering an annotation. Every test above drives the hooks directly
with a stubbed client. The honest statement is that the Jev calls, the mapping, the
prompt assembly, the Q&A capture and the fallback are proven; that OpenCode's real
compaction path fires the hook, and that the TUI renders a mutated
`options[].description`, is taken from the documented contract, not observed. The
second is the one to watch — `description` is the field the advisory writes to and the
only thing that would make the feature silently useless.

## Gotchas hit while building this

- **`output.context` is ignored when `output.prompt` is set.** The docs say so
  explicitly. Injecting the transcript as context alongside a replaced prompt
  silently does nothing.
- **Two config files, one directory.** `opencode.json` and `opencode.jsonc` both
  exist at `~/.config/opencode/` and they **merge** rather than one replacing the
  other. Model lives in the `.jsonc`, `compaction`/`plugin` in the `.json`. Editing
  the wrong one looks like it did nothing.
- **`npm install --no-save` prunes the other package.** Installing `typescript` and
  `@types/node` separately left the first one missing. Typechecking was done from a
  scratch prefix instead, to avoid mutating the `node_modules` OpenCode manages
  itself.
- **The `preserveRecentMessages` window can pin everything.** A short transcript
  where every tool call falls inside the newest 6 messages yields `0 Jev requests`
  and a 0% reduction. That is correct behaviour, not a failure — the first smoke
  test looked broken for exactly this reason.
- **A guessed threshold is worse than no threshold.** `already_answered >= 0.75` was
  picked out of thin air; the one measured case scored 0.64 and would have been
  silently missed. There was no error, no warning, and the feature would simply have
  done nothing most of the time.
- **A `tool.execute.before` hook is a network call in a UI path.** Anything awaited
  there delays the dialog. Hence the 2.5s bound and the deliberate decision to
  annotate rather than answer — the slower and more intrusive the change, the more
  it can cost the user when Jev is wrong.
- **Module-level `Map` state assumes one process per session.** True for the TUI and
  `opencode run`. It would not survive a long-lived server serving many sessions
  without a TTL, and `pendingCalls` grows unbounded if a `question` call never
  completes its `after` hook.

## Related

- `Capstone/07 - Development/Jev Dispatch Pair Ranking Implementation Plan.md` — the
  other use of Jev in this repo (ranking dispatch pairs in-product), which is a
  different integration entirely.
- `.agents/skills/fast-jev-compaction/SKILL.md` — the library's own docs.
